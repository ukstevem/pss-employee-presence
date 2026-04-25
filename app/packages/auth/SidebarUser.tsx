"use client";

import { useAuth } from "./AuthProvider";

export function SidebarUser() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return <div className="text-[0.65rem] text-white/30">Loading...</div>;
  }

  if (!user) {
    return <div className="text-[0.65rem] text-white/40">Not signed in</div>;
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
        <span className="text-white/70 truncate text-[0.65rem]">
          {user.fullName ?? user.email}
        </span>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="text-white/40 hover:text-white text-[0.65rem] cursor-pointer"
      >
        Sign out
      </button>
    </div>
  );
}
