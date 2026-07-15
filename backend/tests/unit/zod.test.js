/**
 * Regression tests for query-string boolean parsing.
 *
 * THE BUG THESE LOCK DOWN:
 * `z.coerce.boolean()` applies JavaScript's `Boolean()`, and `Boolean("false")`
 * is `true` — every non-empty string is truthy. So a filter written the obvious
 * way silently inverts itself:
 *
 *     GET /audit?success=false      → "show me failed events"
 *     …arrives at the service as    → { success: true }
 *     …and returns                  → only the SUCCESSFUL events
 *
 * Nothing throws. The filter just lies. Every boolean query param in the API had
 * this bug (?isLate=false, ?unreadOnly=false, ?includeInactive=false, …) until
 * queryBoolean replaced them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { queryBoolean, bodyBoolean } from '../../src/core/zod.js';

const schema = z.object({ flag: queryBoolean() });
const parse = (value) => schema.parse({ flag: value }).flag;

describe('queryBoolean', () => {
  test('THE BUG: the string "false" parses to false, not true', () => {
    assert.equal(parse('false'), false);

    // Proof that the naive version really is broken — this is the assertion that
    // justifies the whole file existing.
    const naive = z.object({ flag: z.coerce.boolean().optional() });
    assert.equal(
      naive.parse({ flag: 'false' }).flag,
      true,
      'z.coerce.boolean() turns "false" into true — this is exactly why queryBoolean exists',
    );
  });

  test('parses the truthy strings HTTP actually sends', () => {
    assert.equal(parse('true'), true);
    assert.equal(parse('1'), true);
    assert.equal(parse('yes'), true);
    assert.equal(parse('on'), true);
    assert.equal(parse('TRUE'), true, 'case-insensitive');
    assert.equal(parse(' true '), true, 'tolerates whitespace');
  });

  test('parses the falsy strings HTTP actually sends', () => {
    assert.equal(parse('false'), false);
    assert.equal(parse('0'), false);
    assert.equal(parse('no'), false);
    assert.equal(parse('off'), false);
    assert.equal(parse(''), false, 'an empty param means "not set", i.e. false');
    assert.equal(parse('FALSE'), false);
  });

  test('passes a real boolean straight through (JSON bodies, tests)', () => {
    assert.equal(parse(true), true);
    assert.equal(parse(false), false);
  });

  test('is optional — an absent param is undefined, NOT false', () => {
    // This distinction matters: `undefined` means "do not filter at all", while
    // `false` means "filter to the false ones". Collapsing them would make
    // ?isLate absent behave like ?isLate=false and hide every late entry.
    assert.equal(schema.parse({}).flag, undefined);
  });

  test('rejects garbage instead of silently coercing it', () => {
    // ?isLate=maybe deserves a 422, not a `true`.
    assert.throws(() => parse('maybe'), z.ZodError);
    assert.throws(() => parse('null'), z.ZodError);
  });
});

describe('bodyBoolean', () => {
  test('applies its default when absent', () => {
    const s = z.object({ notify: bodyBoolean(true) });
    assert.equal(s.parse({}).notify, true);
  });

  test('honours an explicit false', () => {
    const s = z.object({ notify: bodyBoolean(true) });
    assert.equal(s.parse({ notify: false }).notify, false);
    assert.equal(s.parse({ notify: 'false' }).notify, false);
  });
});
