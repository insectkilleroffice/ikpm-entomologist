import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./portal.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "IKPM Entomologist", template: "%s · IKPM Entomologist" },
  description: "Job verification, site reports, complaints and requests for IKPM entomologists",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={geist.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
