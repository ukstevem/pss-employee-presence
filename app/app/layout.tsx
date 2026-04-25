import "./globals.css";
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { AuthProvider } from "@platform/auth";
import { ReactNode } from "react";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "Employee Presence | PSS",
  description: "Employee presence tracking — PSS",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body style={{ fontFamily: "var(--font-montserrat), 'Montserrat', system-ui, sans-serif" }}>
        <AuthProvider>
          <main className="min-h-screen">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
