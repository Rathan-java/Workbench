import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth as authApi } from '../api/endpoints.js';
import { clearAccessToken, setAccessToken, setAuthFailureHandler } from '../api/client.js';

const AuthContext = createContext(null);

const EMPTY_PERMISSIONS = Object.freeze([]);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState(EMPTY_PERMISSIONS);
  const [scope, setScope] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const queryClient = useQueryClient();
  const bootstrapped = useRef(false);

  const clearAuth = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setPermissions(EMPTY_PERMISSIONS);
    setScope(null);
    queryClient.clear();
  }, [queryClient]);

  /** Pulls the canonical permission list — the server is the authority, not the role name. */
  const loadSession = useCallback(async () => {
    const me = await authApi.me();
    setUser(me.data.user);
    setPermissions(me.data.permissions ?? EMPTY_PERMISSIONS);
    setScope(me.data.scope ?? null);
    return me.data.user;
  }, []);

  /**
   * Session restore.
   *
   * There is no token in storage by design, so a page reload starts with an
   * empty in-memory token. The httpOnly refresh cookie is the only thing that
   * survived — trade it for a fresh access token, then hydrate /auth/me. A 401
   * here just means "not signed in", which is not an error worth surfacing.
   *
   * ── DO NOT ADD A `cancelled` FLAG HERE. ─────────────────────────────────
   * The obvious "cleanup" pattern is actively broken in combination with the
   * `bootstrapped` ref, and it fails in a way that looks like a dead app:
   *
   *   1. StrictMode runs the effect. `bootstrapped` becomes true; the refresh
   *      request is in flight.
   *   2. StrictMode immediately unmounts and remounts, running the cleanup —
   *      which sets `cancelled = true`.
   *   3. The effect runs a second time, sees `bootstrapped` is already true,
   *      and returns early. No new request, no new cleanup closure.
   *   4. The ORIGINAL request resolves, sees `cancelled === true`, and skips
   *      `setIsLoading(false)`.
   *
   * `isLoading` is now stuck at `true` forever. Every route renders the loading
   * screen, and the whole application is a blank page — with no console error to
   * explain why. It only bites in development (StrictMode does not double-invoke
   * in a production build), which is the worst possible place for it to hide.
   *
   * The `bootstrapped` ref ALREADY guarantees this runs exactly once, which is
   * the only thing the cancellation flag was there to do. Redundant guards that
   * disagree with each other are worse than no guard at all.
   */
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      try {
        const refreshed = await authApi.refresh();
        setAccessToken(refreshed.data.accessToken);
        await loadSession();
      } catch {
        clearAuth();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [clearAuth, loadSession]);

  // When the interceptor's refresh finally fails, the session is unrecoverable.
  useEffect(() => {
    setAuthFailureHandler(() => {
      clearAuth();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    });
    return () => setAuthFailureHandler(null);
  }, [clearAuth]);

  const login = useCallback(
    async (credentials) => {
      const response = await authApi.login(credentials);
      setAccessToken(response.data.accessToken);
      setUser(response.data.user);

      // Login returns the user but not the permission list; fetch it before the
      // app renders, or Guards would flicker closed on the first paint.
      await loadSession();
      return response.data.user;
    },
    [loadSession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // A failed logout must still clear the client — the cookie is dead either way.
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const refreshUser = useCallback(() => loadSession(), [loadSession]);

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const can = useCallback((permission) => permissionSet.has(permission), [permissionSet]);

  const hasRole = useCallback(
    (...roles) => {
      const list = roles.flat();
      return Boolean(user) && list.includes(user.role);
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      permissions,
      scope,
      isLoading,
      isAuthenticated: Boolean(user),
      mustChangePassword: user?.mustChangePassword === true,
      login,
      logout,
      refreshUser,
      setUser,
      can,
      hasRole,
    }),
    [user, permissions, scope, isLoading, login, logout, refreshUser, can, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
