import { AuthProvider } from "@platform/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { ReactNode } from "react";

// Authenticated app shell: everything except the public /board kiosk.
export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <AppSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </AuthProvider>
  );
}
