/**
 * Tests for the department isolation engine.
 *
 * This is the most important test file in the repository. If accessScope is
 * wrong, a Tech Lead reads another department's timesheets — and that is a data
 * breach, not a bug. Everything here is a security assertion, not a nicety.
 *
 * Run: npm run test:unit
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveScope,
  scopeWhere,
  scopedWhereWithFilters,
  assertCanActOn,
  SCOPE_KIND,
} from '../../src/core/accessScope.js';
import { ForbiddenError } from '../../src/core/errors.js';
import {
  roleHasPermission,
  PERMISSIONS,
  assertPermissionsWired,
  ROLE_PERMISSIONS,
} from '../../src/core/permissions.js';

const management = { id: 'mgmt-1', role: 'MANAGEMENT', departmentId: null, teamId: null };
const techLead = { id: 'lead-1', role: 'TECH_LEAD', departmentId: 'dept-tech', teamId: 'team-1' };
const employee = { id: 'emp-1', role: 'EMPLOYEE', departmentId: 'dept-tech', teamId: 'team-1' };
const videoLead = { id: 'lead-2', role: 'TECH_LEAD', departmentId: 'dept-video', teamId: 'team-9' };

describe('resolveScope', () => {
  test('Management resolves to GLOBAL', () => {
    const scope = resolveScope(management);
    assert.equal(scope.kind, SCOPE_KIND.GLOBAL);
    assert.equal(scope.isGlobal, true);
  });

  test('Tech Lead resolves to DEPARTMENT, pinned to their own department', () => {
    const scope = resolveScope(techLead, ['team-1']);
    assert.equal(scope.kind, SCOPE_KIND.DEPARTMENT);
    assert.equal(scope.isGlobal, false);
    assert.equal(scope.departmentId, 'dept-tech');
    assert.deepEqual(scope.ledTeamIds, ['team-1']);
  });

  test('Employee resolves to SELF', () => {
    const scope = resolveScope(employee);
    assert.equal(scope.kind, SCOPE_KIND.SELF);
    assert.equal(scope.isGlobal, false);
  });

  test('a Tech Lead with NO department is demoted to SELF, never escalated to GLOBAL', () => {
    // The dangerous failure mode: a misconfigured lead falling through to an
    // empty filter and seeing the whole company. Must fail CLOSED.
    const scope = resolveScope({ ...techLead, departmentId: null });
    assert.equal(scope.kind, SCOPE_KIND.SELF);
    assert.equal(scope.isGlobal, false);
  });

  test('the scope object is frozen — nothing downstream can widen it', () => {
    const scope = resolveScope(employee);
    assert.throws(() => {
      scope.isGlobal = true;
    }, TypeError);
  });
});

describe('scopeWhere', () => {
  test('GLOBAL produces an unconstrained filter', () => {
    assert.deepEqual(scopeWhere(resolveScope(management)), {});
  });

  test('DEPARTMENT constrains to exactly one departmentId', () => {
    assert.deepEqual(scopeWhere(resolveScope(techLead)), { departmentId: 'dept-tech' });
  });

  test('SELF constrains to the caller’s own rows', () => {
    assert.deepEqual(scopeWhere(resolveScope(employee)), { userId: 'emp-1' });
  });

  test('SELF with selfSeesDepartment widens to reference data only', () => {
    const where = scopeWhere(resolveScope(employee), { selfSeesDepartment: true });
    assert.deepEqual(where, { departmentId: 'dept-tech' });
  });

  test('an unknown scope kind matches NOTHING (fails closed, never open)', () => {
    // The single most important assertion in this file. A future refactor that
    // introduces a new scope kind must return zero rows, not every row.
    const where = scopeWhere({ kind: 'SOMETHING_NEW', userId: 'x' });
    assert.deepEqual(where, { id: '__scope_denied__' });
    assert.notDeepEqual(where, {}, 'an unhandled scope must NOT produce an empty filter');
  });

  test('a DEPARTMENT scope with a null departmentId matches nothing', () => {
    const where = scopeWhere({ kind: SCOPE_KIND.DEPARTMENT, departmentId: null });
    assert.equal(where.departmentId, '__scope_denied__');
  });
});

describe('scopedWhereWithFilters — the Management dropdown', () => {
  test('Management may narrow to any department', () => {
    const where = scopedWhereWithFilters(resolveScope(management), { departmentId: 'dept-video' });
    assert.equal(where.departmentId, 'dept-video');
  });

  test('a Tech Lead may narrow WITHIN their own department', () => {
    const where = scopedWhereWithFilters(resolveScope(techLead), {
      departmentId: 'dept-tech',
      teamId: 'team-2',
    });
    assert.equal(where.departmentId, 'dept-tech');
    assert.equal(where.teamId, 'team-2');
  });

  test('a Tech Lead CANNOT widen to another department — the request is rejected', () => {
    assert.throws(
      () => scopedWhereWithFilters(resolveScope(techLead), { departmentId: 'dept-video' }),
      ForbiddenError,
      'a lead requesting another department must be denied, not silently rewritten',
    );
  });

  test('an Employee CANNOT request another employee’s rows', () => {
    assert.throws(
      () => scopedWhereWithFilters(resolveScope(employee), { userId: 'emp-2' }),
      ForbiddenError,
    );
  });

  test('an Employee CAN request their own rows explicitly', () => {
    const where = scopedWhereWithFilters(resolveScope(employee), { userId: 'emp-1' });
    assert.equal(where.userId, 'emp-1');
  });
});

describe('assertCanActOn — the guard on single-record reads and writes', () => {
  test('Management may act on anything', () => {
    assert.doesNotThrow(() =>
      assertCanActOn(resolveScope(management), { userId: 'anyone', departmentId: 'dept-video' }),
    );
  });

  test('a Tech Lead may act within their department', () => {
    assert.doesNotThrow(() =>
      assertCanActOn(resolveScope(techLead), { userId: 'emp-1', departmentId: 'dept-tech' }),
    );
  });

  test('THE BREACH TEST: a Video Editing lead cannot touch a Tech record', () => {
    assert.throws(
      () => assertCanActOn(resolveScope(videoLead), { userId: 'emp-1', departmentId: 'dept-tech' }),
      ForbiddenError,
    );
  });

  test('an Employee may act on their own record', () => {
    assert.doesNotThrow(() =>
      assertCanActOn(resolveScope(employee), { userId: 'emp-1', departmentId: 'dept-tech' }),
    );
  });

  test('an Employee cannot act on a colleague’s record, even in the same department', () => {
    assert.throws(
      () => assertCanActOn(resolveScope(employee), { userId: 'emp-2', departmentId: 'dept-tech' }),
      ForbiddenError,
    );
  });

  test('allowSelf:false blocks self-access where ownership is irrelevant (e.g. approving your own sheet)', () => {
    assert.throws(
      () =>
        assertCanActOn(
          resolveScope(employee),
          { userId: 'emp-1', departmentId: 'dept-tech' },
          { allowSelf: false },
        ),
      ForbiddenError,
    );
  });
});

describe('permissions', () => {
  test('every declared permission is wired to at least one role', () => {
    assert.doesNotThrow(assertPermissionsWired);
  });

  test('an Employee cannot approve, and cannot write another person’s tasks', () => {
    assert.equal(roleHasPermission('EMPLOYEE', PERMISSIONS.TASK_APPROVE), false);
    assert.equal(roleHasPermission('EMPLOYEE', PERMISSIONS.TASK_WRITE_ANY), false);
    assert.equal(roleHasPermission('EMPLOYEE', PERMISSIONS.AUDIT_READ), false);
    assert.equal(roleHasPermission('EMPLOYEE', PERMISSIONS.USER_CREATE), false);
  });

  test('a Tech Lead can approve and can correct a team member’s entry', () => {
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.TASK_APPROVE), true);
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.TASK_WRITE_ANY), true);
  });

  test('a Tech Lead cannot create users, assign roles, or read the audit log', () => {
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.USER_CREATE), false);
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.ROLE_ASSIGN), false);
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.AUDIT_READ), false);
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.SETTINGS_MANAGE), false);
  });

  test('a Tech Lead still logs their own hours (they are an employee too)', () => {
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.TASK_WRITE_OWN), true);
    assert.equal(roleHasPermission('TECH_LEAD', PERMISSIONS.TASK_SUBMIT), true);
  });

  test('Management holds a strict superset of the Tech Lead bundle', () => {
    const lead = new Set(ROLE_PERMISSIONS.TECH_LEAD);
    const mgmt = new Set(ROLE_PERMISSIONS.MANAGEMENT);
    for (const p of lead) {
      assert.ok(mgmt.has(p), `Management is missing the Tech Lead permission "${p}"`);
    }
    assert.ok(mgmt.size > lead.size);
  });

  test('an unknown role holds no permissions at all', () => {
    assert.equal(roleHasPermission('SUPER_ADMIN', PERMISSIONS.TASK_READ), false);
  });
});
