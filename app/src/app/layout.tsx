import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--display", subsets: ["latin"], weight: ["500", "700"] });
const body = Figtree({ variable: "--body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = { title: "Soba", description: "The after-hours sales desk for produce" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
