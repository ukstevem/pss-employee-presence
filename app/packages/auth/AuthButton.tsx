"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@platform/supabase";

type Session = Awaited<
  ReturnType<typeof supabase.auth.getSession>
>["data"]["session"];

type AuthButtonProps = {
  /** Where to redirect after login. Defaults to "/dashboard". */
  redirectTo?: string;
};

export function AuthButton({ redirectTo = "/dashboard" }: AuthButtonProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  useEffect(() => {
    let subscribed = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!subscribed) return;
      setSession(data.session);
      setLoading(false);

      if (data.session) router.replace(redirectTo);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!subscribed) return;
      setSession(newSession);
      if (newSession) router.replace(redirectTo);
    });

    return () => {
      subscribed = false;
      subscription.unsubscribe();
    };
  }, [router, redirectTo]);

  async function handleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email profile",
        redirectTo: `${APP_URL}${redirectTo}`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  if (loading) return <button disabled>Checking login...</button>;
  if (session)
    return <div className="text-sm text-gray-600">Redirecting…</div>;

  return (
    <button
      type="button"
      onClick={handleLogin}
      className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium shadow-sm hover:opacity-90 cursor-pointer"
    >
      Sign in with Azure
    </button>
  );
}
