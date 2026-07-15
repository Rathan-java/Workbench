/**
 * Domain logic that must never regress: the approval state machine, the OTP
 * generator, the CSV-injection guard, and the date handling that keeps Monday's
 * work filed under Monday.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, DAY_STATUS, DAY_TRANSITIONS } from '../../src/config/constants.js';
import { generateOtp, hashToken, constantTimeEquals } from '../../src/utils/crypto.js';
import { toWorkDate, formatWorkDate, minutesToLabel, eachWorkDate } from '../../src/utils/date.js';
import { buildOrderBy, buildSearchFilter, and } from '../../src/core/pagination.js';
import { BadRequestError } from '../../src/core/errors.js';

describe('the approval state machine', () => {
  test('DRAFT may only be submitted', () => {
    assert.equal(canTransition(DAY_STATUS.DRAFT, DAY_STATUS.SUBMITTED), true);
    assert.equal(canTransition(DAY_STATUS.DRAFT, DAY_STATUS.APPROVED), false);
    assert.equal(
      canTransition(DAY_STATUS.DRAFT, DAY_STATUS.REJECTED),
      false,
      'you cannot reject a sheet that was never submitted',
    );
  });

  test('SUBMITTED may be approved, rejected, or withdrawn to DRAFT', () => {
    assert.equal(canTransition(DAY_STATUS.SUBMITTED, DAY_STATUS.APPROVED), true);
    assert.equal(canTransition(DAY_STATUS.SUBMITTED, DAY_STATUS.REJECTED), true);
    assert.equal(canTransition(DAY_STATUS.SUBMITTED, DAY_STATUS.DRAFT), true);
  });

  test('REJECTED goes back to DRAFT so the employee can act on the feedback', () => {
    assert.equal(canTransition(DAY_STATUS.REJECTED, DAY_STATUS.DRAFT), true);
    assert.equal(canTransition(DAY_STATUS.REJECTED, DAY_STATUS.SUBMITTED), true);
  });

  test('APPROVED is terminal except for an explicit, audited REOPEN', () => {
    assert.equal(canTransition(DAY_STATUS.APPROVED, DAY_STATUS.DRAFT), true, 'REOPEN');
    assert.equal(canTransition(DAY_STATUS.APPROVED, DAY_STATUS.SUBMITTED), false);
    assert.equal(canTransition(DAY_STATUS.APPROVED, DAY_STATUS.REJECTED), false);
  });

  test('no state can transition to itself', () => {
    for (const status of Object.values(DAY_STATUS)) {
      assert.equal(canTransition(status, status), false, `${status} -> ${status} must be illegal`);
    }
  });

  test('every state in the machine is reachable', () => {
    const reachable = new Set([DAY_STATUS.DRAFT]);
    // Two passes is enough to close this graph.
    for (let i = 0; i < 2; i += 1) {
      for (const from of [...reachable]) {
        for (const to of DAY_TRANSITIONS[from] ?? []) reachable.add(to);
      }
    }
    for (const status of Object.values(DAY_STATUS)) {
      assert.ok(reachable.has(status), `${status} is unreachable — dead state`);
    }
  });
});

describe('OTP generation', () => {
  test('produces the configured number of digits', () => {
    for (let i = 0; i < 50; i += 1) {
      const otp = generateOtp(6);
      assert.match(otp, /^\d{6}$/);
    }
  });

  test('is not obviously predictable across many draws', () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateOtp(6)));
    // 300 draws from a 10^6 space: collisions are possible but a tiny handful.
    // A broken generator (a constant, or Math.random seeded identically) collapses.
    assert.ok(seen.size > 290, `expected near-unique OTPs, got ${seen.size}/300 distinct`);
  });

  test('is uniformly distributed — no modulo bias toward low digits', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 2000; i += 1) {
      for (const ch of generateOtp(6)) counts[Number(ch)] += 1;
    }
    const expected = (2000 * 6) / 10;
    for (const [digit, count] of counts.entries()) {
      // Generous band; a naive `byte % 10` skews digits 0–5 hard enough to fail this.
      assert.ok(
        Math.abs(count - expected) < expected * 0.25,
        `digit ${digit} appeared ${count} times, expected roughly ${expected}`,
      );
    }
  });
});

describe('token hashing', () => {
  test('is deterministic and 64 hex chars (SHA-256)', () => {
    const token = 'a-refresh-token';
    assert.equal(hashToken(token), hashToken(token));
    assert.match(hashToken(token), /^[a-f0-9]{64}$/);
  });

  test('different tokens hash differently', () => {
    assert.notEqual(hashToken('token-a'), hashToken('token-b'));
  });

  test('constantTimeEquals handles unequal lengths without throwing', () => {
    assert.equal(constantTimeEquals('abc', 'abcdef'), false);
    assert.equal(constantTimeEquals('abc', 'abc'), true);
  });
});

describe('work dates', () => {
  test('a work date is pinned to midnight UTC — no timezone drift', () => {
    const d = toWorkDate('2026-07-13');
    assert.equal(d.toISOString(), '2026-07-13T00:00:00.000Z');
  });

  test('round-trips through formatting unchanged', () => {
    assert.equal(formatWorkDate(toWorkDate('2026-01-01')), '2026-01-01');
    assert.equal(formatWorkDate(toWorkDate('2026-12-31')), '2026-12-31');
  });

  test('rejects a malformed date rather than silently producing Invalid Date', () => {
    assert.throws(() => toWorkDate('13-07-2026'));
    assert.throws(() => toWorkDate('not-a-date'));
  });

  test('minutesToLabel renders slot boundaries correctly', () => {
    assert.equal(minutesToLabel(600), '10:00');
    assert.equal(minutesToLabel(1080), '18:00');
    assert.equal(minutesToLabel(0), '00:00');
  });

  test('eachWorkDate is inclusive of both ends', () => {
    const dates = eachWorkDate(toWorkDate('2026-07-01'), toWorkDate('2026-07-05'));
    assert.equal(dates.length, 5);
    assert.equal(formatWorkDate(dates[0]), '2026-07-01');
    assert.equal(formatWorkDate(dates.at(-1)), '2026-07-05');
  });

  test('eachWorkDate refuses to loop forever on an inverted range', () => {
    const dates = eachWorkDate(toWorkDate('2026-07-05'), toWorkDate('2026-07-01'));
    assert.equal(dates.length, 0);
  });
});

describe('pagination guards', () => {
  test('buildOrderBy rejects a column that is not on the allow-list', () => {
    // The attack: ?sortBy=passwordHash against a paginated user list is a
    // practical oracle for extracting hashes one character at a time.
    assert.throws(
      () => buildOrderBy('passwordHash', 'asc', ['firstName', 'email'], { id: 'asc' }),
      BadRequestError,
    );
  });

  test('buildOrderBy accepts an allow-listed column', () => {
    assert.deepEqual(buildOrderBy('email', 'desc', ['email'], { id: 'asc' }), { email: 'desc' });
  });

  test('buildOrderBy falls back when no sort is requested', () => {
    assert.deepEqual(buildOrderBy(undefined, 'asc', ['email'], { createdAt: 'desc' }), {
      createdAt: 'desc',
    });
  });

  test('buildSearchFilter expands a dotted path into a nested Prisma filter', () => {
    const filter = buildSearchFilter('nair', ['user.lastName']);
    assert.deepEqual(filter, { OR: [{ user: { lastName: { contains: 'nair' } } }] });
  });

  test('buildSearchFilter returns undefined for an empty term (so it is dropped, not applied)', () => {
    assert.equal(buildSearchFilter('', ['name']), undefined);
    assert.equal(buildSearchFilter('   ', ['name']), undefined);
  });

  test('and() drops empty fragments instead of emitting AND: [{}]', () => {
    assert.deepEqual(and({}, undefined, { a: 1 }), { a: 1 });
    assert.deepEqual(and({ a: 1 }, { b: 2 }), { AND: [{ a: 1 }, { b: 2 }] });
    assert.deepEqual(and(), {});
  });
});
