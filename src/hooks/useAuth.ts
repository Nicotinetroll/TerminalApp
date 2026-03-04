import { useState, useCallback, useEffect, useRef } from "react";
import type { User } from "@/types/terminal";
import { AUTH_MAX_ATTEMPTS, AUTH_LOCKOUT_MS } from "@/config";
import * as api from "@/lib/api";

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const failedAttempts = useRef(0);
  const lockedUntil = useRef<number | null>(null);

  // Session restore on boot
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const sessionUser = await api.getSession();
        if (sessionUser && !cancelled) {
          setUser({
            username: sessionUser.username,
            role: sessionUser.role,
            id: String(sessionUser.id),
          });
          setUserId(String(sessionUser.id));
        }
      } catch {
        // Session restore failed — continue to login
      }

      if (!cancelled) setIsLoading(false);
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkLockout = useCallback((): string | null => {
    if (lockedUntil.current && Date.now() < lockedUntil.current) {
      const remaining = Math.ceil((lockedUntil.current - Date.now()) / 1000);
      return `Too many attempts. Try again in ${remaining}s.`;
    }
    if (lockedUntil.current && Date.now() >= lockedUntil.current) {
      lockedUntil.current = null;
      failedAttempts.current = 0;
    }
    return null;
  }, []);

  const trackFailure = useCallback(() => {
    failedAttempts.current++;
    if (failedAttempts.current >= AUTH_MAX_ATTEMPTS) {
      lockedUntil.current = Date.now() + AUTH_LOCKOUT_MS;
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const lockError = checkLockout();
      if (lockError) return { ok: false, error: lockError };

      setIsAuthenticating(true);
      try {
        const result = await api.login(username, password);
        if (!result.ok) {
          trackFailure();
          return { ok: false, error: result.error };
        }

        failedAttempts.current = 0;
        lockedUntil.current = null;

        setUser({
          username: result.user.username,
          role: result.user.role,
          id: String(result.user.id),
        });
        setUserId(String(result.user.id));
        return { ok: true };
      } catch {
        trackFailure();
        return { ok: false, error: "Authentication failed." };
      } finally {
        setIsAuthenticating(false);
      }
    },
    [checkLockout, trackFailure]
  );

  const loginAsGuest = useCallback(() => {
    setUser({ username: "guest", role: "guest" });
    setUserId(null);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setUserId(null);
    failedAttempts.current = 0;
    lockedUntil.current = null;
  }, []);

  const setUserFromRegister = useCallback((authUser: api.AuthUser) => {
    setUser({
      username: authUser.username,
      role: authUser.role,
      id: String(authUser.id),
    });
    setUserId(String(authUser.id));
  }, []);

  return {
    user,
    userId,
    isLoading,
    isAuthenticating,
    login,
    loginAsGuest,
    logout,
    setUserFromRegister,
  };
}
