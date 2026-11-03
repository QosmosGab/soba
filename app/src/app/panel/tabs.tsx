"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/panel", "Performance"], ["/panel/controls", "Controls"], ["/panel/settings", "Settings"]] as const;

export function Tabs() {
  const path = usePathname();
  const active = (href: string) => href === "/panel" ? path === "/panel" || path.startsWith("/panel/requests") || path.startsWith("/panel/summary") : path.startsWith(href);
  return (
    <nav className="tabs" role="tablist">
      {TABS.map(([href, label]) => <Link key={href} href={href} className="tab" role="tab" aria-selected={active(href)} style={{ textDecoration: "none" }}>{label}</Link>)}
    </nav>
  );
}
