"use client";

import type { ReactNode } from "react";

export type NavItem = {
  label: string;
  href: string;
};

export type NavSection = {
  heading: string;
  items: NavItem[];
};

type SidebarProps = {
  /** App label shown under logo, e.g. "Timesheets" */
  appLabel: string;
  /** Logo image src (must include basePath prefix) */
  logoSrc: string;
  /** App-specific navigation sections */
  navSections: NavSection[];
  /** Render slot for user status / sign-out (provided by each app) */
  userSlot?: ReactNode;
};

const PLATFORM_APPS: NavItem[] = [
  { label: "Portal Home", href: "/" },
  { label: "Timesheets", href: "/timesheets/" },
  { label: "Documents", href: "/documents/" },
  { label: "Job Cards", href: "/jobcards/" },
  { label: "QR Scanner", href: "/scanner/" },
];

export function Sidebar({ appLabel, logoSrc, navSections, userSlot }: SidebarProps) {
  return (
    <aside className="pss-sidebar w-52 p-3 shrink-0 hidden sm:flex flex-col">
      {/* Logo + app label */}
      <div className="pb-3 mb-3 border-b border-white/15">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <a href="/">
          <img
            src={logoSrc}
            alt="Power System Services"
            className="h-16 w-auto mb-1"
          />
        </a>
        <div className="text-[0.65rem] text-white/50 mt-1">{appLabel}</div>
      </div>

      <nav className="flex-1 flex flex-col gap-4">
        {/* App-specific navigation */}
        {navSections.map((section) => (
          <div key={section.heading}>
            <div
              className="text-[0.65rem] font-semibold uppercase tracking-wider px-2 mb-1"
              style={{ color: "var(--pss-sky)" }}
            >
              {section.heading}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block px-2 py-1.5 rounded text-sm text-white/80 hover:text-white hover:bg-white/10"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Platform navigation */}
        <div className="mt-auto">
          <div
            className="text-[0.65rem] font-semibold uppercase tracking-wider px-2 mb-1"
            style={{ color: "var(--pss-sky)" }}
          >
            Platform
          </div>
          <ul className="space-y-0.5">
            {PLATFORM_APPS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block px-2 py-1.5 rounded text-sm text-white/60 hover:text-white hover:bg-white/10"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* User + sign out */}
      <div className="pt-3 border-t border-white/10">
        {userSlot}
      </div>
    </aside>
  );
}
