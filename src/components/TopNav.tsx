"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/militars", label: "Militares" },
  { href: "/scales", label: "Escalas" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="topnav">
      <div className="container-app topnav-inner">
        <div className="brand">
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: "var(--primary)",
              display: "inline-block",
            }}
          />
          <span>Escalas</span>
        </div>

        <nav className="navlinks">
          {links.map((l) => {
            const active =
              pathname === l.href || (l.href !== "/" && pathname?.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`navlink ${active ? "navlink-active" : ""}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
