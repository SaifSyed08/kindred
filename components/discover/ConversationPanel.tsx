"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { convPhase, interestOf, type Candidate, type ConvState } from "@/lib/runState";
import { AgentAvatar, Avatar, Chip, cn, TypingDots } from "../ui";

const TYPE_LABEL: Record<string, string> = {
  greet: "Opening",
  ask: "Asking",
  share: "Sharing",
  discover: "Discovery",
  propose: "Proposal",
  conclude: "Wrapping up",
};

// Messages that have already been typed once; switching tabs remounts them and they should not retype.
const typed = new Set<number>();

// Reveals text word by word for messages that just arrived; older ones render instantly.
function Typewriter({ id, text, fresh, onTick }: { id: number; text: string; fresh: boolean; onTick?: () => void }) {
  const words = text.split(" ");
  const [animate] = useState(() => fresh && !typed.has(id));
  const [n, setN] = useState(animate ? 0 : words.length);
  useEffect(() => {
    typed.add(id);
    if (!animate) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      onTick?.();
      if (i >= words.length) clearInterval(t);
    }, 38);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, text]);
  return (
    <>
      {words.slice(0, n).join(" ")}
      {n < words.length && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand-2" />}
    </>
  );
}

export function ConversationPanel({
  me,
  usersById,
  conv,
  convs,
  onFocus,
  shortlist,
  status,
}: {
  me: User | null;
  usersById: Record<string, User>;
  conv: ConvState | null;
  convs: ConvState[];
  onFocus: (id: string) => void;
  shortlist: Candidate[];
  status: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(stick, [conv?.id, conv?.messages.length, conv?.thinking, conv?.deliberating, conv?.outcome]);

  if (!convs.length) {
    return (
      <div className="flex h-full flex-col p-5">
        <div className="text-sm font-semibold">{status === "idle" ? "How discovery works" : "Building a shortlist"}</div>
        {status === "idle" ? (
          <ol className="mt-4 space-y-4 text-sm text-ink-2">
            {[
              ["Shortlist", "Your agent ranks everyone on the network by semantic overlap with your profile, and flags old friends you've drifted from."],
              ["Conversations", "It opens live conversations with the most promising agents. They trade specifics, ask follow-ups, and chase overlaps."],
              ["Private verdicts", "Afterwards each agent decides on its own whether the intro is worth its person's time. Both must say yes."],
              ["Introduction", "You both get an invitation. Accept, and your agents introduce you in a shared chat."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="bg-gradient-brand flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{i + 1}</span>
                <span>
                  <span className="font-semibold text-ink">{t}.</span> {d}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 space-y-2">
            {(shortlist.length ? shortlist : Array.from({ length: 6 }, () => null)).map((c, i) =>
              c ? (
                <motion.div key={c.userId} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center gap-3">
                  <Avatar user={usersById[c.userId]} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{usersById[c.userId]?.firstName}</span>
                      <span className="text-ink-3">{Math.round(c.similarity * 100)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef0f4]">
                      <motion.div className="bg-gradient-brand h-full" initial={{ width: 0 }} animate={{ width: `${Math.round(c.similarity * 100)}%` }} />
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div key={i} className="h-7 animate-pulse rounded-lg bg-[#f0f2f5]" />
              ),
            )}
          </div>
        )}
      </div>
    );
  }

  const other = conv ? usersById[conv.b] : null;
  const phase = conv ? convPhase(conv) : "talking";
  const interest = conv ? interestOf(conv) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* tabs */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5">
        {convs.map((c) => {
          const u = usersById[c.b];
          const ph = convPhase(c);
          return (
            <button
              key={c.id}
              onClick={() => onFocus(c.id)}
              className={cn("flex shrink-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-semibold transition-colors", conv?.id === c.id ? "bg-[#ebf2ff] text-brand" : "text-ink-2 hover:bg-[#f0f2f5]")}
            >
              <Avatar user={u} size={22} />
              {u?.firstName}
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  ph === "matched" ? "bg-[#1a7f37]" : ph === "passed" ? "bg-[#c4c7cc]" : "animate-pulse bg-brand-2",
                )}
              />
            </button>
          );
        })}
      </div>

      {conv && other && (
        <>
          <div className="flex items-center gap-3 px-5 pt-4 pb-3">
            <div className="flex -space-x-2">
              <AgentAvatar user={me} size={34} />
              <AgentAvatar user={other} size={34} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {me?.firstName}&apos;s agent ↔ {other.firstName}&apos;s agent
              </div>
              <div className="text-xs text-ink-3">{conv.relation === "friend" ? "Existing friends · looking for a reason to reconnect" : `Strangers · ${Math.round(conv.similarity * 100)}% profile overlap`}</div>
            </div>
            <div className="text-right">
              <div className="text-gradient text-lg leading-none font-bold">{interest}%</div>
              <div className="text-[10px] text-ink-3">promising</div>
            </div>
          </div>
          <div className="mx-5 h-1 overflow-hidden rounded-full bg-[#eef0f4]">
            <motion.div className="bg-gradient-brand h-full" animate={{ width: `${interest}%` }} transition={{ duration: 0.6 }} />
          </div>

          <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <AnimatePresence initial={false}>
              {conv.messages.map((m) => {
                const mine = m.sender === conv.a;
                const sender = mine ? me : other;
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className={cn("flex gap-2.5", mine && "flex-row-reverse")}
                  >
                    <AgentAvatar user={sender} size={28} />
                    <div className={cn("max-w-[84%]", mine && "items-end text-right")}>
                      <div className={cn("mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-ink-3 uppercase", mine && "justify-end")}>
                        {sender?.firstName}&apos;s agent
                        <span className={cn("rounded-full px-1.5 py-0.5 normal-case", m.type === "discover" || m.type === "propose" ? "bg-gradient-brand text-white" : "bg-[#f0f2f5]")}>
                          {TYPE_LABEL[m.type] ?? m.type}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "inline-block rounded-2xl px-3.5 py-2.5 text-left text-[13px] leading-relaxed",
                          mine ? "bg-gradient-brand rounded-tr-md text-white" : "rounded-tl-md bg-[#f0f2f5] text-ink",
                        )}
                      >
                        <Typewriter id={m.id} text={m.text} fresh={m.fresh} onTick={stick} />
                      </div>
                      {m.thought && (
                        <div className={cn("mt-1 flex items-start gap-1 text-[11px] text-ink-3 italic", mine && "justify-end")}>
                          <span className="not-italic">💭</span>
                          <span>{m.thought}</span>
                        </div>
                      )}
                      {m.discoveries.length > 0 && (
                        <div className={cn("mt-1.5 flex flex-wrap gap-1", mine && "justify-end")}>
                          {m.discoveries.map((d) => (
                            <motion.span key={d.label} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: m.fresh ? 0.6 : 0 }} title={d.detail}>
                              <Chip tone="brand">✦ {d.label}</Chip>
                            </motion.span>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {conv.thinking && (
              <div className={cn("flex items-center gap-2.5", conv.thinking === conv.a && "flex-row-reverse")}>
                <AgentAvatar user={conv.thinking === conv.a ? me : other} size={28} />
                <div className="rounded-2xl bg-[#f0f2f5] px-4 py-3 text-ink-3">
                  <TypingDots />
                </div>
              </div>
            )}

            {(phase === "deliberating" || phase === "matched" || phase === "passed") && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-white p-4">
                <div className="mb-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">Private verdicts</div>
                <div className="space-y-3">
                  {[conv.a, conv.b].map((uid) => {
                    const v = conv.verdicts[uid];
                    const u = uid === conv.a ? me : other;
                    return (
                      <div key={uid} className="flex gap-2.5">
                        <AgentAvatar user={u} size={26} />
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{u?.firstName}&apos;s agent</span>
                            {v ? (
                              <Chip tone={v.recommend ? "green" : "neutral"}>
                                {v.recommend ? "Recommends" : "Passes"} · {v.score}
                              </Chip>
                            ) : (
                              <span className="flex items-center gap-1.5 text-ink-3">
                                deciding <TypingDots />
                              </span>
                            )}
                          </div>
                          {v && <p className="mt-1 leading-relaxed text-ink-2">{v.reason}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {conv.outcome && (
                  <div
                    className={cn(
                      "mt-3 rounded-xl px-3 py-2 text-center text-xs font-semibold",
                      conv.outcome.matchId ? "bg-gradient-brand text-white" : "bg-[#f0f2f5] text-ink-2",
                    )}
                  >
                    {conv.outcome.matchId ? `✦ Both agents said yes. Invitations sent to ${me?.firstName} and ${other.firstName}.` : conv.outcome.summary}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
