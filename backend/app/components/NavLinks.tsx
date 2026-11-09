"use client";

import { usePathname } from "next/navigation";
import { activeHref, NAV } from "@/app/lib/nav";
import type { Role } from "@/app/types";

/** Horizontal role-based navigation for SimpleShell pages. */
export default function NavLinks({ role, unread }: { role: Role; unread: number }) {
  const pathname = usePathname();
  const items = NAV[role];
  const active = activeHref(items, pathname);
  return (
    <nav className="flex flex-wrap gap-1 border-b border-[#e5eaf1] bg-white px-5 md:px-9" aria-label="Main">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.href === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium ${
            item.href === active
              ? "border-[#315ee7] text-[#172b4d]"
              : "border-transparent text-slate-500 hover:text-[#172b4d]"
          }`}
        >
          {item.label}
          {item.href === "/notifications" && unread > 0 && (
            <span className="ml-1.5 rounded-md bg-[#dbe6ff] px-1.5 py-0.5 text-[10px] font-bold text-[#2446a5]">
              {unread}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
