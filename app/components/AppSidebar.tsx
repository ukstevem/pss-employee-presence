"use client";

import { SidebarUser } from "@platform/auth";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Employee Presence"
      logoSrc="/employee-presence/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Presence",
          items: [
            { label: "Who's In", href: "/employee-presence/" },
            { label: "Roll Call", href: "/employee-presence/roll-call/" },
            { label: "Hours", href: "/employee-presence/hours/" },
          ],
        },
        {
          heading: "Admin",
          items: [
            { label: "Cards", href: "/employee-presence/admin/cards/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
