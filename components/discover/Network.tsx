"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { convPhase, interestOf, type RunState } from "@/lib/runState";
import { AgentAvatar, cn, TypingDots } from "../ui";

type Pt = { x: number; y: number };
type Packet = { id: string; from: Pt; to: Pt; hue: number };

const CENTER: Pt = { x: 50, y: 50 };

function ringPositions(n: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + 0.25;
    return { x: 50 + Math.cos(ang) * 37, y: 50 + Math.sin(ang) * 36 };
  });
}

export function Network({
  me,
  others,
  run,
  focusedConv,
  onFocus,
}: {
  me: User | null;
  others: User[];
  run: RunState;
  focusedConv: string | null;
  onFocus: (convId: string) => void;
}) {
  const pos = useMemo(() => {
    const pts = ringPositions(others.length);
    return Object.fromEntries(others.map((u, i) => [u.id, pts[i]])) as Record<string, Pt>;
  }, [others]);

  // Fire a packet along the edge whenever a fresh message lands.
  const [packets, setPackets] = useState<Packet[]>([]);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const fresh: Packet[] = [];
    for (const c of Object.values(run.convs)) {
      for (const m of c.messages) {
        if (seen.current.has(m.id)) continue;
        seen.current.add(m.id);
        if (!m.fresh || !pos[c.b]) continue;
        const fromMe = m.sender === c.a;
        const sender = others.find((u) => u.id === m.sender) ?? me;
        fresh.push({ id: `p${m.id}`, from: fromMe ? CENTER : pos[c.b], to: fromMe ? pos[c.b] : CENTER, hue: sender?.hue ?? 230 });
      }
    }
    if (fresh.length) setPackets((p) => [...p, ...fresh]);
  }, [run.convs, pos, others, me]);
  useEffect(() => {
    if (run.status === "starting" || run.status === "idle") seen.current.clear();
  }, [run.status]);

  const active = run.status === "scanning" || run.status === "running" || run.status === "starting";
  const shortlist = Object.fromEntries(run.shortlist.map((c) => [c.userId, c]));

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* soft background field */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#eef3ff_0%,#ffffff_60%)]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="edge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0866ff" />
            <stop offset="60%" stopColor="#7b4dff" />
            <stop offset="100%" stopColor="#c040ff" />
          </linearGradient>
        </defs>
        {/* orbit guide */}
        <ellipse cx="50" cy="50" rx="37" ry="36" fill="none" stroke="#e4e6eb" strokeDasharray="0.6 1.2" vectorEffect="non-scaling-stroke" strokeWidth="1" />
        {others.map((u) => {
          const convId = run.byUser[u.id];
          const c = convId ? run.convs[convId] : null;
          const p = pos[u.id];
          if (!c) return null;
          const phase = convPhase(c);
          return (
            <g key={u.id}>
              {phase === "matched" ? (
                <motion.line
                  x1={CENTER.x} y1={CENTER.y} x2={p.x} y2={p.y}
                  stroke="url(#edge-grad)" strokeWidth={3.5} vectorEffect="non-scaling-stroke" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }}
                />
              ) : (
                <line
                  x1={CENTER.x} y1={CENTER.y} x2={p.x} y2={p.y}
                  stroke={phase === "passed" ? "#d0d3d9" : "url(#edge-grad)"}
                  strokeWidth={phase === "passed" ? 1.2 : focusedConv === c.id ? 2.6 : 1.8}
                  strokeDasharray={phase === "passed" ? "3 5" : "6 6"}
                  className={phase === "passed" ? "" : "edge-flow"}
                  vectorEffect="non-scaling-stroke" strokeLinecap="round"
                  opacity={phase === "passed" ? 0.8 : 0.9}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* scanning radar while the shortlist is computed */}
      <AnimatePresence>
        {(run.status === "starting" || run.status === "scanning") && (
          <motion.div
            key="radar"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute"
            style={{ left: "50%", top: "50%", width: "78%", aspectRatio: "1", transform: "translate(-50%,-50%)" }}
          >
            <div className="orb-spin h-full w-full rounded-full" style={{ background: "conic-gradient(from 0deg, transparent 0deg, rgba(123,77,255,0.18) 50deg, transparent 70deg)", animationDuration: "2.2s" }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* packets travelling along edges */}
      {packets.map((pk) => (
        <motion.div
          key={pk.id}
          className="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: `hsl(${pk.hue} 90% 60%)`, boxShadow: `0 0 0 4px hsl(${pk.hue} 90% 60% / 0.18), 0 0 18px hsl(${pk.hue} 90% 60% / 0.9)` }}
          initial={{ left: `${pk.from.x}%`, top: `${pk.from.y}%`, scale: 0.4, opacity: 0 }}
          animate={{ left: `${pk.to.x}%`, top: `${pk.to.y}%`, scale: [0.4, 1.2, 0.8], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.0, ease: "easeInOut" }}
          onAnimationComplete={() => setPackets((ps) => ps.filter((x) => x.id !== pk.id))}
        />
      ))}

      {/* discovery chips at edge midpoints */}
      {others.map((u) => {
        const convId = run.byUser[u.id];
        const c = convId ? run.convs[convId] : null;
        if (!c || !c.discoveries.length) return null;
        const p = pos[u.id];
        const mid = { x: (CENTER.x + p.x) / 2, y: (CENTER.y + p.y) / 2 };
        const shown = c.discoveries.slice(-2);
        return (
          <div key={`d-${u.id}`} className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: `${mid.x}%`, top: `${mid.y}%` }}>
            <AnimatePresence initial={false}>
              {shown.map((d) => (
                <motion.span
                  key={d.label}
                  layout
                  initial={{ opacity: 0, scale: 0.6, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 24 }}
                  className="border-gradient rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-brand-2 shadow-sm"
                >
                  ✦ {d.label}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        );
      })}

      {/* center: my agent */}
      <div className="absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: "50%", top: "50%" }}>
        <div className="relative flex flex-col items-center">
          {active && (
            <>
              <span className="soft-pulse bg-gradient-brand absolute top-0 left-1/2 h-[88px] w-[88px] -translate-x-1/2 rounded-full" />
              <span className="soft-pulse bg-gradient-brand absolute top-0 left-1/2 h-[88px] w-[88px] -translate-x-1/2 rounded-full" style={{ animationDelay: "1.2s" }} />
            </>
          )}
          <div className="rounded-full bg-white p-1 shadow-[0_10px_30px_-10px_rgba(8,102,255,0.6)]">
            <AgentAvatar user={me} size={80} />
          </div>
          <div className="mt-2 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold shadow-sm">{me ? `${me.firstName}'s agent` : "Your agent"}</div>
        </div>
      </div>

      {/* other agents */}
      {others.map((u) => {
        const p = pos[u.id];
        const convId = run.byUser[u.id];
        const c = convId ? run.convs[convId] : null;
        const sl = shortlist[u.id];
        const phase = c ? convPhase(c) : null;
        const interest = c ? interestOf(c) : 0;
        const lastMsg = c?.messages[c.messages.length - 1];
        const dim = run.status !== "idle" && !c && run.shortlist.length > 0;
        const ringColor = phase === "matched" ? "#1a7f37" : `hsl(${u.hue} 80% 58%)`;
        const above = p.y > 50;
        return (
          <div
            key={u.id}
            className={cn("absolute z-30 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500", dim && "opacity-40", c && "cursor-pointer")}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onClick={() => c && onFocus(c.id)}
          >
            <div className="relative flex flex-col items-center">
              {/* interest arc */}
              <svg className="absolute -top-[7px] left-1/2 -translate-x-1/2" width="70" height="70" viewBox="0 0 70 70">
                <circle cx="35" cy="35" r="32" fill="none" stroke="#eef0f4" strokeWidth="3.5" />
                {c && (
                  <motion.circle
                    cx="35" cy="35" r="32" fill="none" stroke={ringColor} strokeWidth="3.5" strokeLinecap="round"
                    transform="rotate(-90 35 35)"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: phase === "passed" ? 0.05 : Math.max(0.04, interest / 100) }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                )}
              </svg>
              <motion.div
                animate={c?.thinking === u.id ? { scale: [1, 1.07, 1] } : { scale: 1 }}
                transition={c?.thinking === u.id ? { repeat: Infinity, duration: 1.1 } : {}}
                className={cn("rounded-full bg-white p-[3px]", focusedConv && c?.id === focusedConv && "shadow-[0_0_0_3px_rgba(123,77,255,0.35)]")}
              >
                <AgentAvatar user={u} size={50} />
              </motion.div>
              {phase === "matched" && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2 -right-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#1a7f37] text-xs text-white ring-2 ring-white">
                  ✓
                </motion.div>
              )}
              <div className="mt-2 text-center">
                <div className="text-xs font-semibold whitespace-nowrap">{u.firstName}</div>
                <div className="text-[10px] whitespace-nowrap text-ink-3">
                  {phase === "matched" ? "Intro proposed" : phase === "passed" ? "No intro" : phase === "deliberating" ? "Deciding…" : c ? `${interest}% promising` : sl ? (sl.selected ? "" : `${Math.round(sl.similarity * 100)}% overlap`) : ""}
                </div>
              </div>

              {/* speech bubble */}
              <AnimatePresence mode="wait">
                {c && (c.thinking || (lastMsg && phase === "talking")) && (
                  <motion.div
                    key={c.thinking ? `t-${c.thinking}-${c.messages.length}` : `m-${lastMsg!.id}`}
                    initial={{ opacity: 0, y: above ? 6 : -6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25 }}
                    className={cn(
                      "pointer-events-none absolute left-1/2 w-[200px] -translate-x-1/2 rounded-2xl bg-white px-3 py-2 text-[11px] leading-snug text-ink shadow-[0_8px_24px_-8px_rgba(16,24,40,0.25)]",
                      above ? "bottom-[calc(100%+12px)]" : "top-[calc(100%+6px)]",
                    )}
                  >
                    {c.thinking ? (
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="font-semibold">{c.thinking === c.a ? me?.firstName : u.firstName}&apos;s agent</span>
                        <TypingDots className="text-brand-2" />
                      </span>
                    ) : (
                      <span className="line-clamp-3">
                        <span className="font-semibold">{lastMsg!.sender === c.a ? me?.firstName : u.firstName}:</span> {lastMsg!.text}
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}
