"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@platform/supabase";
import type { UserInfo } from "./types";

type AuthContextValue = {
  user: UserInfo | null;
  isSuperuser: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isSuperuser: false,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const clearUser = () => {
      setUser(null);
      setIsSuperuser(false);
    };

    const loadForUserId = async (
      userId: string,
      email: string | null,
      meta: Record<string, unknown> | undefined
    ) => {
      // Profile row (optional)
      const { data: profile, error: profErr } = await supabase
        .from("auth_users")
        .select("full_name,email")
        .eq("id", userId)
        .maybeSingle();

      if (profErr) console.error("auth_users profile load failed", profErr);

      const metaName = meta?.full_name ?? meta?.name ?? null;
      const fullName =
        profile?.full_name?.trim() ||
        (typeof metaName === "string" ? metaName.trim() : null) ||
        null;

      if (!cancelled) {
        setUser({
          id: userId,
          email: email ?? profile?.email ?? null,
          fullName,
        });
      }

      // Superuser check
      const { data: su, error: suErr } = await supabase.rpc(
        "jobcard_is_superuser"
      );
      if (suErr) {
        console.error("jobcard_is_superuser rpc failed", suErr);
        if (!cancelled) setIsSuperuser(false);
        return;
      }
      if (!cancelled) setIsSuperuser(!!su);
    };

    const loadUserAndRole = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;

      if (error || !data.user) {
        if (error) console.error("getUser error", error);
        clearUser();
        setLoading(false);
        return;
      }

      await loadForUserId(
        data.user.id,
        data.user.email ?? null,
        data.user.user_metadata
      );
      if (!cancelled) setLoading(false);
    };

    loadUserAndRole();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        clearUser();
        return;
      }
      void loadForUserId(
        session.user.id,
        session.user.email ?? null,
        session.user.user_metadata
      );
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, isSuperuser, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
