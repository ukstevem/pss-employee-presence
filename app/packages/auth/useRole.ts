"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase";
import { useAuth } from "./AuthProvider";
import type { ProjectRole } from "./types";

/**
 * Returns the current user's role for a given project number.
 * Returns "none" when not a member or not signed in.
 */
export function useRole(projectNumber: string | null) {
  const { user } = useAuth();
  const [role, setRole] = useState<ProjectRole>("none");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !projectNumber) {
      setRole("none");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("jobcard_project_members")
        .select("role")
        .eq("projectnumber", projectNumber)
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("useRole fetch failed", error);
        setRole("none");
      } else {
        setRole((data?.role as ProjectRole) ?? "none");
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, projectNumber]);

  return { role, loading };
}
