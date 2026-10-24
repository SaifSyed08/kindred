"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@/lib/types";

type Ctx = {
  users: User[];
  usersById: Record<string, User>;
  me: User | null;
  meId: string;
  setMeId: (id: string) => void;
  refreshUsers: () => Promise<void>;
  pendingInvites: number;
  refreshInvites: () => Promise<void>;
};

const UserCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "kindred.me";
const DEFAULT_ME = "u_maya";

export function Providers({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [meId, setMeIdState] = useState(DEFAULT_ME);
  const [pendingInvites, setPending] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMeIdState(saved);
    } catch {}
  }, []);

  const setMeId = useCallback((id: string) => {
    setMeIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }, []);

  const refreshUsers = useCallback(async () => {
    const res = await fetch("/api/users", { cache: "no-store" });
    if (res.ok) setUsers((await res.json()).users);
  }, []);

  const refreshInvites = useCallback(async () => {
    const res = await fetch(`/api/matches?userId=${meId}`, { cache: "no-store" });
    if (!res.ok) return;
    const { matches } = (await res.json()) as { matches: { a: string; statusA: string; statusB: string }[] };
    setPending(matches.filter((m) => (m.a === meId ? m.statusA : m.statusB) === "pending").length);
  }, [meId]);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  useEffect(() => {
    void refreshInvites();
    const t = setInterval(refreshInvites, 4000);
    return () => clearInterval(t);
  }, [refreshInvites]);

  const value = useMemo<Ctx>(() => {
    const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
    return { users, usersById, me: usersById[meId] ?? null, meId, setMeId, refreshUsers, pendingInvites, refreshInvites };
  }, [users, meId, setMeId, refreshUsers, pendingInvites, refreshInvites]);

  return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}

export function useKindred() {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useKindred outside Providers");
  return ctx;
}
