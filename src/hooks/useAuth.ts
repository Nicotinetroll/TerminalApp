import { useState, useCallback, useEffect, useRef } from "react";
import type { User } from "@/types/terminal";
import { AUTH_MAX_ATTEMPTS, AUTH_LOCKOUT_MS, THEMES } from "@/config";
import * as api from "@/lib/api";

export interface LoginResult {
  ok: boolean;
  error?: string;
  has_subscription?: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
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
            email: sessionUser.email,
            role: sessionUser.role as User["role"],
            id: String(sessionUser.id),
            permissions: sessionUser.permissions,
          });
          setUserId(String(sessionUser.id));
          setHasSubscription(!!sessionUser.has_subscription);

          // Apply saved theme from DB so picker is skipped on new devices
          if (sessionUser.theme_name && THEMES[sessionUser.theme_name]) {
            const theme = THEMES[sessionUser.theme_name]!;
            try {
              localStorage.setItem("mynigga-theme-chosen", "1");
              localStorage.setItem("mynigga-theme", JSON.stringify(theme));
              localStorage.setItem(`mynigga-theme-name:${sessionUser.id}`, sessionUser.theme_name);
              // Apply immediately so there's no flash
              const root = document.documentElement;
              root.style.setProperty("--accent", theme.accent);
              root.style.setProperty("--accent-soft", theme.accentSoft);
              root.style.setProperty("--accent-mid", theme.accentMid);
              if (theme.bgPrimary) root.style.setProperty("--bg-primary", theme.bgPrimary);
              if (theme.bgSurface) root.style.setProperty("--bg-surface", theme.bgSurface);
              if (theme.bgElevated) root.style.setProperty("--bg-elevated", theme.bgElevated);
              if (theme.textPrimary) root.style.setProperty("--text-primary", theme.textPrimary);
              if (theme.textSecondary) root.style.setProperty("--text-secondary", theme.textSecondary);
              if (theme.textMuted) root.style.setProperty("--text-muted", theme.textMuted);
            } catch { /* localStorage unavailable */ }
          }
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
    async (email: string, password: string): Promise<LoginResult> => {
      const lockError = checkLockout();
      if (lockError) return { ok: false, error: lockError };

      setIsAuthenticating(true);
      try {
        const result = await api.login(email, password);
        if (!result.ok) {
          trackFailure();
          return { ok: false, error: result.error };
        }

        failedAttempts.current = 0;
        lockedUntil.current = null;

        setUser({
          email: result.user.email,
          role: result.user.role as User["role"],
          id: String(result.user.id),
        });
        setUserId(String(result.user.id));
        setHasSubscription(!!result.user.has_subscription);
        return { ok: true, has_subscription: !!result.user.has_subscription };
      } catch {
        trackFailure();
        return { ok: false, error: "Authentication failed." };
      } finally {
        setIsAuthenticating(false);
      }
    },
    [checkLockout, trackFailure]
  );

  const registerUser = useCallback(
    async (email: string, invite?: string): Promise<LoginResult> => {
      const lockError = checkLockout();
      if (lockError) return { ok: false, error: lockError };

      setIsAuthenticating(true);
      try {
        const result = await api.register(email, invite);
        if (!result.ok) {
          trackFailure();
          return { ok: false, error: result.error };
        }

        failedAttempts.current = 0;
        lockedUntil.current = null;

        const hasSub = !!result.user.has_subscription;
        setUser({
          email: result.user.email,
          role: result.user.role as User["role"],
          id: String(result.user.id),
        });
        setUserId(String(result.user.id));
        setHasSubscription(hasSub);
        return { ok: true, has_subscription: hasSub };
      } catch {
        trackFailure();
        return { ok: false, error: "Registration failed." };
      } finally {
        setIsAuthenticating(false);
      }
    },
    [checkLockout, trackFailure]
  );

  const setupPassword = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      return api.setupPassword(password);
    },
    []
  );

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setUserId(null);
    setHasSubscription(false);
    failedAttempts.current = 0;
    lockedUntil.current = null;
  }, []);

  const setUserFromSession = useCallback((authUser: api.AuthUser) => {
    setUser({
      email: authUser.email,
      role: authUser.role as User["role"],
      id: String(authUser.id),
      permissions: authUser.permissions,
    });
    setUserId(String(authUser.id));
    setHasSubscription(!!authUser.has_subscription);
  }, []);

  return {
    user,
    userId,
    hasSubscription,
    setHasSubscription,
    isLoading,
    isAuthenticating,
    login,
    register: registerUser,
    setupPassword,
    logout,
    setUserFromSession,
  };
}
