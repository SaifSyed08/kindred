"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useKindred } from "@/components/Providers";
import { Network } from "@/components/discover/Network";
import { ConversationPanel } from "@/components/discover/ConversationPanel";
import { AgentAvatar, Avatar, Button, Spinner } from "@/components/ui";
import { initialRun, runReducer } from "@/lib/runState";
import type { RunEvent } from "@/lib/types";

export default function DiscoverPage() {
  return (
    <Suspense>
      <Discover />
    </Suspense>
  );
}

function Discover() {
  const { me, meId, users, usersById, refreshInvites } = useKindred();
  const [run, dispatch] = useReducer(runReducer, initialRun);
  const [pinned, setPinned] = useState<{ id: string; at: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const params = useSearchParams();
  const router = useRouter();

  const others = useMemo(() => users.filter((u) => u.id !== meId), [users, meId]);

  const subscribe = useCallback(
    (runId: string, allFresh: boolean) => {
      esRef.current?.close();
      // Events replayed from before we connected are history (no typing, packets or toasts);
      // the server marks where the replay ends.
      let caughtUp = allFresh;
      const es = new EventSource(`/api/discover/${runId}`);
      esRef.current = es;
      es.addEventListener("caught_up", () => {
        caughtUp = true;
      });
      es.addEventListener("run", (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as RunEvent;
        dispatch({ kind: "event", ev, fresh: caughtUp });
        if (ev.type === "match") void refreshInvites();
        if (ev.type === "run_done" || ev.type === "run_error") es.close();
      });
      es.addEventListener("server_error", (e) => {
        es.close();
        const { error } = JSON.parse((e as MessageEvent).data) as { error: string };
        dispatch({ kind: "event", ev: { type: "run_error", runId, error }, fresh: true });
      });
      // A dropped connection would auto-reconnect and replay the whole run on top of the current state.
      // Instead: close, clear, and resubscribe so the backlog comes back as history.
      es.onerror = () => {
        if (esRef.current !== es || es.readyState === EventSource.CLOSED) return;
        es.close();
        setTimeout(() => {
          if (esRef.current !== es) return;
          dispatch({ kind: "reset" });
          subscribe(runId, false);
        }, 1500);
      };
    },
    [refreshInvites],
  );

  // Null the ref too, so a pending reconnect timer (which checks esRef.current === its stream) stands down.
  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  // Arriving with ?go=1 starts a new run, so skip replaying the previous one (it could race the new stream).
  const autoStart = useRef(params.get("go") === "1");
  // The user a run was started for on this page. The load effect skips them, so a remount (React StrictMode
  // runs effects twice in dev) can't reset or replace a run that is just starting.
  const startedFor = useRef<string | null>(null);

  // Load the most recent run for this user (replays instantly).
  useEffect(() => {
    if (autoStart.current || startedFor.current === meId) return closeStream;
    startedFor.current = null;
    dispatch({ kind: "reset" });
    setPinned(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/discover?userId=${meId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { run: latest } = (await res.json()) as { run: { id: string } | null };
        if (latest && !cancelled && startedFor.current !== meId) subscribe(latest.id, false);
      } catch {}
    })();
    return () => {
      cancelled = true;
      closeStream();
    };
  }, [meId, subscribe, closeStream]);

  const start = useCallback(async () => {
    const userId = meId;
    startedFor.current = userId;
    dispatch({ kind: "starting" });
    setPinned(null);
    try {
      const res = await fetch("/api/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: meId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to start");
      // The viewer switched user while the request was in flight.
      if (startedFor.current !== userId) return;
      // Joining a run that was already going: its backlog is history, only what follows is live.
      subscribe(data.runId, !data.resumed);
    } catch (e) {
      if (startedFor.current !== userId) return;
      dispatch({ kind: "event", ev: { type: "run_error", runId: "", error: e instanceof Error ? e.message : "failed to start" }, fresh: true });
    }
  }, [meId, subscribe]);

  useEffect(() => {
    if (autoStart.current && me) {
      autoStart.current = false;
      router.replace("/discover");
      void start();
    }
  }, [me, router, start]);

  // Stay on one conversation until it wraps up, then follow the next live one. A viewer's click wins.
  const convs = run.order.map((id) => run.convs[id]);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (pinned) return;
    const cur = focus ? run.convs[focus] : null;
    if (cur && !cur.outcome) return;
    const live = convs.filter((c) => !c.outcome);
    if (live.length) {
      if (!cur || Date.now() - cur.lastActivity > 3500) setFocus(live[0].id);
      return;
    }
    if (!cur) {
      const matched = convs.find((c) => c.outcome?.matchId);
      setFocus(matched?.id ?? convs[0]?.id ?? null);
    }
  }, [run, convs, focus, pinned]);
  // Let the auto-follow take back over once the conversation the viewer picked has finished.
  useEffect(() => {
    if (pinned && run.convs[pinned.id]?.outcome && Date.now() - pinned.at > 6000) setPinned(null);
  }, [run, pinned]);

  const onFocus = (id: string) => {
    setFocus(id);
    setPinned({ id, at: Date.now() });
  };

  const running = run.status === "starting" || run.status === "scanning" || run.status === "running";
  const talking = convs.filter((c) => !c.outcome).length;
  // A reconnection is the headline moment, so it takes the toast over a new-connection match.
  const freshMatches = run.matches.filter((m) => run.freshMatchIds.includes(m.id));
  const freshMatch = freshMatches.find((m) => m.kind === "reconnect") ?? freshMatches[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            Let your agent <span className="text-gradient">find your people</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {running
              ? run.status === "running" && convs.length
                ? `${talking} live agent conversation${talking === 1 ? "" : "s"} · ${run.matches.length} intro${run.matches.length === 1 ? "" : "s"} so far`
                : "Scanning the network for people you'd click with…"
              : run.status === "done"
                ? `Last run: ${convs.length} conversations, ${run.matches.length} introduction${run.matches.length === 1 ? "" : "s"}. Agents pass on most people, on purpose.`
                : run.status === "error"
                  ? `Something went wrong: ${run.error}`
                  : `${me?.firstName ?? "Your"}'s agent will talk to other agents on your behalf.`}
          </p>
        </div>
        <Button onClick={start} disabled={running || !me} className="h-11 px-6 text-[15px]">
          {running ? (
            <>
              <Spinner /> Agents talking…
            </>
          ) : (
            <>✦ {run.status === "done" ? "Find more connections" : "Find connections"}</>
          )}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card relative h-[560px] overflow-hidden lg:col-span-7 lg:h-[640px]">
          <Network me={me} others={others} run={run} focusedConv={focus} onFocus={onFocus} />
          {run.status === "idle" && (
            <div className="absolute inset-x-0 bottom-6 flex justify-center">
              <div className="glass rounded-full px-4 py-2 text-xs font-medium text-ink-2 shadow-sm">{others.length} agents on the network · press Find connections</div>
            </div>
          )}
        </div>
        <div className="card h-[560px] overflow-hidden lg:col-span-5 lg:h-[640px]">
          <ConversationPanel
            me={me}
            usersById={usersById}
            conv={focus ? run.convs[focus] ?? null : null}
            convs={convs}
            onFocus={onFocus}
            shortlist={run.shortlist}
            status={run.status}
          />
        </div>
      </div>

      <AnimatePresence>
        {freshMatch && (
          <motion.div
            key={freshMatch.id}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="fixed bottom-6 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2"
          >
            <div className="card border-gradient relative overflow-hidden p-5">
              <Sparkles />
              <div className="relative flex items-center gap-4">
                <div className="flex -space-x-3">
                  <Avatar user={me} size={48} ring />
                  <Avatar user={usersById[freshMatch.a === meId ? freshMatch.b : freshMatch.a]} size={48} ring />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-gradient text-xs font-bold tracking-wide uppercase">
                    {freshMatch.kind === "reconnect" ? "Reconnection found" : "New connection found"} · {freshMatch.score}
                  </div>
                  <div className="truncate text-[15px] font-semibold">{freshMatch.headline}</div>
                  <div className="truncate text-xs text-ink-2">with {usersById[freshMatch.a === meId ? freshMatch.b : freshMatch.a]?.name}</div>
                </div>
              </div>
              <div className="relative mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => dispatch({ kind: "dismissMatch", id: freshMatch.id })}>
                  Later
                </Button>
                <Link href={`/connections?m=${freshMatch.id}`}>
                  <Button>See invitation →</Button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {run.status === "done" && run.matches.length > 0 && !freshMatch && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-wrap items-center gap-4 p-4">
          <AgentAvatar user={me} size={36} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{me?.firstName}&apos;s agent:</span> I talked to {convs.length} agents and found {run.matches.length} {run.matches.length === 1 ? "person" : "people"} worth your time.
          </div>
          <Link href="/connections">
            <Button>Review invitations →</Button>
          </Link>
        </motion.div>
      )}
    </div>
  );
}

function Sparkles() {
  const dots = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0">
      {dots.map((i) => (
        <motion.span
          key={i}
          className="bg-gradient-brand absolute h-1.5 w-1.5 rounded-full"
          style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%` }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1.4, 0], y: -20 }}
          transition={{ duration: 1.6, delay: i * 0.07, repeat: 1 }}
        />
      ))}
    </div>
  );
}
