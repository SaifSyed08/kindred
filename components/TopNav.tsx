"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useKindred } from "./Providers";
import { Avatar, cn } from "./ui";

const TABS = [
  { href: "/agent", label: "My Agent" },
  { href: "/discover", label: "Discover" },
  { href: "/connections", label: "Connections" },
];

export function TopNav() {
  const path = usePathname();
  const { me, users, setMeId, pendingInvites } = useKindred();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <header className="glass sticky top-0 z-40 border-b border-line/70">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/agent" className="flex items-center gap-2">
          <div className="bg-gradient-brand flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold text-white shadow-md">K</div>
          <span className="hidden text-lg font-bold tracking-tight sm:block">Kindred</span>
        </Link>

        <nav className="mx-auto flex min-w-0 items-center gap-0.5 rounded-full bg-[#f0f2f5] p-1 sm:gap-1">
          {TABS.map((t) => {
            const active = path.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} className="relative rounded-full px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap sm:px-5 sm:text-sm">
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-white shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className={cn("relative", active ? "text-brand" : "text-ink-2")}>{t.label}</span>
                {t.href === "/connections" && pendingInvites > 0 && (
                  <span className="bg-gradient-brand relative ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] text-white">
                    {pendingInvites}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div ref={ref} className="relative">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-[#f0f2f5]">
            <Avatar user={me} size={32} />
            <span className="hidden text-sm font-semibold md:block">{me?.firstName ?? "…"}</span>
            <span className="hidden text-xs text-ink-3 sm:inline">▾</span>
          </button>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="card absolute right-0 mt-2 w-72 overflow-hidden p-2"
            >
              <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Demo: view as</div>
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setMeId(u.id);
                    setOpen(false);
                  }}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[#f0f2f5]", u.id === me?.id && "bg-[#ebf2ff]")}
                >
                  <Avatar user={u} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{u.name}</div>
                    <div className="truncate text-xs text-ink-2">{u.tagline}</div>
                  </div>
                </button>
              ))}
              <div className="mt-1 border-t border-line px-3 pt-2 pb-1">
                <button
                  onClick={async () => {
                    if (!confirm("Reset all demo data (profiles, matches, chats)?")) return;
                    await fetch("/api/reset", { method: "POST" });
                    location.reload();
                  }}
                  className="text-xs font-medium text-ink-3 hover:text-ink"
                >
                  Reset demo data
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </header>
  );
}
