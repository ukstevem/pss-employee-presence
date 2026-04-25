"use client";

import { useSearchParams } from "next/navigation";
import { ReactNode } from "react";

type LayoutShellProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

export function LayoutShell({ sidebar, children }: LayoutShellProps) {
  const searchParams = useSearchParams();
  const kiosk = searchParams.get("kiosk") === "true";

  if (kiosk) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="flex min-h-screen">
      {sidebar}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
