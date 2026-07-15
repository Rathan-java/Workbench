import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Renders children only if the signed-in user holds the permission.
 *
 * This is a UI affordance, never a security boundary — the server authorises
 * every request independently. Hiding a button the user cannot use is courtesy;
 * it is not what stops them.
 *
 * <Guard permission="task:approve"> <ApproveButton/> </Guard>
 * <Guard anyOf={['task:approve','task:reject']}> ... </Guard>
 */
export default function Guard({ permission, anyOf, allOf, fallback = null, children }) {
  const { can } = useAuth();

  const allowed = (() => {
    if (permission) return can(permission);
    if (anyOf?.length) return anyOf.some(can);
    if (allOf?.length) return allOf.every(can);
    return true;
  })();

  return allowed ? children : fallback;
}

/** <RoleGuard roles={['MANAGEMENT','TECH_LEAD']}> ... </RoleGuard> */
export function RoleGuard({ roles = [], fallback = null, children }) {
  const { hasRole } = useAuth();
  return hasRole(roles) ? children : fallback;
}
