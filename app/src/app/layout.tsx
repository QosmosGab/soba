import type { Metadata } from "next";
import { Inter, Quicksand } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const quicksand = Quicksand({ variable: "--font-quicksand", subsets: ["latin"], weight: ["700"] });

export const metadata: Metadata = { title: "Soba", description: "The after-hours sales desk for produce" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${quicksand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
