import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { User } from "@nuoma/contracts";

import { trpc } from "../lib/trpc.js";
import { AuthContext, type AuthContextValue } from "./auth-context.js";

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loginMutation = trpc.auth.login.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const refreshMutation = trpc.auth.refresh.useMutation();

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const result = await utils.auth.me.fetch();
        if (!cancelled) setUser(result.user);
      } catch {
        try {
          const session = await refreshMutation.mutateAsync();
          if (!cancelled) setUser(session.user);
        } catch {
          if (!cancelled) setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await loginMutation.mutateAsync({ email, password });
      setUser(session.user);
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      setUser(null);
      await utils.invalidate();
    }
  }, [logoutMutation, utils]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
