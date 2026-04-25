"use client";

import Link from "next/link";

interface PageHeaderProps {
  title: string;
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, backHref, backLabel, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
      <div className="flex items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
          >
            {backLabel ?? "← Back"}
          </Link>
        )}
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-3 sm:ml-auto">{children}</div>}
    </div>
  );
}
