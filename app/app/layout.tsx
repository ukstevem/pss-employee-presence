import "./globals.css";
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
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

// Bare root layout: only the <html>/<body> shell. App chrome (auth +
// sidebar) lives in the (main) route group so the public /board kiosk
// page can render full-screen without it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body style={{ fontFamily: "var(--font-montserrat), 'Montserrat', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
