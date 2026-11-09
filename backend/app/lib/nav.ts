/** Navigation per role. Shared by server and client components (no server imports). */
import type { Role } from "@/app/types";

export interface NavItem {
  href: string;
  label: string;
}

export const NAV: Record<Role, NavItem[]> = {
  POLICYHOLDER: [
    { href: "/my-claims", label: "My claims" },
    { href: "/my-claims/new", label: "New claim" },
    { href: "/notifications", label: "Notifications" },
  ],
  CLAIMS_ADJUSTER: [
    { href: "/", label: "Dashboard" },
    { href: "/adjuster/queue", label: "Review queue" },
    { href: "/similar", label: "Similarity search" },
    { href: "/notifications", label: "Notifications" },
  ],
  ADMIN: [
    { href: "/", label: "Dashboard" },
    { href: "/admin", label: "Reports" },
    { href: "/adjuster/queue", label: "Review queue" },
    { href: "/admin/reference-cases", label: "Reference cases" },
    { href: "/admin/policies", label: "Policies" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/audit", label: "Audit log" },
    { href: "/similar", label: "Similarity search" },
    { href: "/notifications", label: "Notifications" },
  ],
};

/** Longest matching prefix wins, so /my-claims/new highlights "New claim", not "My claims". */
export function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of items) {
    const match =
      item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}
