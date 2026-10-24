"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useKindred } from "@/components/Providers";
import { AgentAvatar, Avatar, Button, Chip, cn, Spinner, TypingDots } from "@/components/ui";
import type { AgentMessage, ChatMessage, Match, User, Activity } from "@/lib/types";

type MatchView = Match & { other: User; transcript: AgentMessage[] };

export default function ConnectionsPage() {
  return (
    <Suspense>
      <Connections />
    </Suspense>
  );
}

const myStatus = (m: Match, me: string) => (m.a === me ? m.statusA : m.statusB);
const theirStatus = (m: Match, me: string) => (m.a === me ? m.statusB : m.statusA);

function Connections() {
  const { me, meId, refreshInvites } = useKindred();
  const [matches, setMatches] = useState<MatchView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const params = useSearchParams();

  const load = useCallback(async () => {
    const res = await fetch(`/api/matches?userId=${meId}`, { cache: "no-store" });
    if (res.ok) setMatches((await res.json()).matches);
  }, [meId]);

  useEffect(() => {
    setMatches(null);
    setSelected(null);
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!matches?.length) return;
    const wanted = params.get("m");
    setSelected((cur) => {
      if (cur && matches.some((m) => m.id === cur)) return cur;
      if (wanted && matches.some((m) => m.id === wanted)) return wanted;
      return matches[0].id;
    });
  }, [matches, params]);

  const respond = async (m: MatchView, accept: boolean) => {
    await fetch(`/api/matches/${m.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: meId, accept }) });
    await load();
    await refreshInvites();
  };

  const groups = matches
    ? [
        { title: "Invitations", items: matches.filter((m) => myStatus(m, meId) === "pending") },
        { title: "Waiting on them", items: matches.filter((m) => myStatus(m, meId) === "accepted" && !m.chatId) },
        { title: "Connected", items: matches.filter((m) => m.chatId) },
      ].filter((g) => g.items.length)
    : [];
  const current = matches?.find((m) => m.id === selected) ?? null;

  if (matches && !matches.length) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-10 text-center">
        <div className="bg-gradient-brand mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white">✦</div>
        <h2 className="mt-4 text-xl font-bold">No connections yet</h2>
        <p className="mt-2 text-sm text-ink-2">When your agent finds someone worth your time, their invitation shows up here.</p>
        <Link href="/discover?go=1">
          <Button className="mt-6">Find connections</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 pt-2 lg:grid-cols-12">
      <aside className="space-y-4 lg:col-span-4">
        <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
        {!matches && <div className="card h-40 animate-pulse" />}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-2 px-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">{g.title}</div>
            <div className="space-y-2">
              {g.items.map((m) => (
                <motion.button
                  layout
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={cn("card flex w-full items-center gap-3 p-3 text-left transition-shadow", selected === m.id && "ring-2 ring-brand/40")}
                >
                  <Avatar user={m.other} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{m.other.name}</span>
                      {m.kind === "reconnect" && <Chip tone="amber">Reconnect</Chip>}
                    </div>
                    <div className="truncate text-xs text-ink-2">{m.headline}</div>
                  </div>
                  {myStatus(m, meId) === "pending" && <span className="bg-gradient-brand h-2.5 w-2.5 rounded-full" />}
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <section className="lg:col-span-8">
        <AnimatePresence mode="wait">
          {current && me && (
            <motion.div key={current.id + (current.chatId ? "-chat" : "")} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
              {current.chatId ? <SharedChat match={current} me={me} /> : <Invitation match={current} me={me} onRespond={respond} />}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function Invitation({ match: m, me, onRespond }: { match: MatchView; me: User; onRespond: (m: MatchView, accept: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const mine = myStatus(m, me.id);
  const theirs = theirStatus(m, me.id);
  const invite = m.a === me.id ? m.inviteA : m.inviteB;
  const act = async (accept: boolean) => {
    setBusy(true);
    await onRespond(m, accept);
    setBusy(false);
  };

  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden px-6 pt-8 pb-6 sm:px-8">
        <div className="bg-gradient-brand absolute inset-x-0 top-0 h-28 opacity-[0.12]" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="flex items-center">
            <Avatar user={me} size={64} ring />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring" }}
              className="bg-gradient-brand z-10 -mx-2 flex h-8 w-8 items-center justify-center rounded-full text-sm text-white ring-4 ring-white"
            >
              ✦
            </motion.div>
            <Avatar user={m.other} size={64} ring />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={m.kind === "reconnect" ? "amber" : "brand"}>{m.kind === "reconnect" ? "Reconnection" : "New connection"}</Chip>
              <Chip tone="green">{m.score}% compatible</Chip>
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{m.headline}</h2>
            <div className="text-sm text-ink-2">
              {m.other.name} · {m.other.city}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 pb-6 sm:px-8">
        <div className="flex gap-3 rounded-2xl bg-[#f5f6fa] p-4">
          <AgentAvatar user={me} size={34} />
          <div>
            <div className="text-xs font-semibold text-ink-3">Your agent</div>
            <p className="mt-0.5 text-[15px] leading-relaxed">{invite}</p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">Why your agents think you&apos;ll click</div>
          <p className="text-sm leading-relaxed text-ink-2">{m.explanation}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.shared.map((s) => (
              <Chip key={s} tone="brand">
                {s}
              </Chip>
            ))}
          </div>
        </div>

        <ActivityCard activity={m.activity} />

        <div>
          <button onClick={() => setShowTranscript((s) => !s)} className="text-sm font-semibold text-brand hover:underline">
            {showTranscript ? "Hide" : "See"} how your agents found this ({m.transcript.length} messages)
          </button>
          <AnimatePresence>
            {showTranscript && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-3 space-y-2 rounded-2xl border border-line p-4">
                  {m.transcript.map((t) => {
                    const fromMe = t.sender === me.id;
                    return (
                      <div key={t.id} className="flex gap-2 text-[13px]">
                        <span className={cn("shrink-0 font-semibold", fromMe ? "text-brand" : "text-brand-2")}>{fromMe ? "Your agent" : `${m.other.firstName}'s agent`}:</span>
                        <span className="text-ink-2">
                          {t.text}
                          {t.discoveries.map((d) => (
                            <Chip key={d.label} tone="brand" className="ml-1.5">
                              ✦ {d.label}
                            </Chip>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <div className="text-sm text-ink-2">
            {mine === "accepted" ? (
              <span className="flex items-center gap-2">
                <TypingDots className="text-brand-2" /> You said yes. Waiting for {m.other.firstName}; your chat opens when they accept.
              </span>
            ) : theirs === "accepted" ? (
              <span>
                <span className="font-semibold text-[#1a7f37]">{m.other.firstName} already said yes.</span> Your chat opens as soon as you accept.
              </span>
            ) : (
              <span>Nothing is shared with {m.other.firstName} unless you both accept.</span>
            )}
          </div>
          {mine === "pending" && (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => act(false)}>
                Not now
              </Button>
              <Button disabled={busy} onClick={() => act(true)}>
                {busy ? <Spinner /> : m.kind === "reconnect" ? `Reconnect with ${m.other.firstName}` : `Meet ${m.other.firstName}`}
              </Button>
            </div>
          )}
        </div>
        {mine === "accepted" && (
          <p className="text-xs text-ink-3">Demo tip: switch to {m.other.firstName} from the menu in the top right to accept as them.</p>
        )}
      </div>
    </div>
  );
}

function ActivityCard({ activity, compact }: { activity: Activity; compact?: boolean }) {
  return (
    <div className={cn("border-gradient rounded-2xl", compact ? "p-3.5" : "p-4")}>
      <div className="flex items-start gap-3">
        <div className="bg-gradient-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg text-white">📍</div>
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-brand-2 uppercase">Suggested plan</div>
          <div className="text-[15px] font-semibold">{activity.title}</div>
          <div className="mt-0.5 text-xs text-ink-2">
            {activity.when} · {activity.where}
          </div>
          <p className="mt-1.5 text-sm text-ink-2">{activity.why}</p>
        </div>
      </div>
    </div>
  );
}

function SharedChat({ match: m, me }: { match: MatchView; me: User }) {
  const { usersById } = useKindred();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const chatId = m.chatId!;

  useEffect(() => {
    setMsgs([]);
    const es = new EventSource(`/api/chats/${chatId}/stream`);
    es.addEventListener("messages", (e) => {
      const batch = JSON.parse((e as MessageEvent).data) as ChatMessage[];
      setMsgs((cur) => {
        const ids = new Set(cur.map((x) => x.id));
        return [...cur, ...batch.filter((x) => !ids.has(x.id))];
      });
    });
    return () => es.close();
  }, [chatId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await fetch(`/api/chats/${chatId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: me.id, text: t }) });
  };

  const introDone = msgs.some((x) => x.kind === "activity");

  return (
    <div className="card flex h-[calc(100vh-140px)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="flex -space-x-2">
          <Avatar user={me} size={36} ring />
          <Avatar user={m.other} size={36} ring />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {me.firstName} & {m.other.firstName}
          </div>
          <div className="truncate text-xs text-ink-3">{m.headline}</div>
        </div>
        <Chip tone={m.kind === "reconnect" ? "amber" : "brand"}>{m.kind === "reconnect" ? "Reconnected" : "Introduced"}</Chip>
      </div>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#fafbfc] px-5 py-5">
        <AnimatePresence initial={false}>
          {msgs.map((x) => {
            if (x.sender === "system" && x.kind === "activity" && x.meta) {
              return (
                <motion.div key={x.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-md">
                  <ActivityCard activity={x.meta} compact />
                </motion.div>
              );
            }
            if (x.sender === "system") {
              return (
                <motion.div key={x.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs text-ink-3">
                  {x.text}
                </motion.div>
              );
            }
            const isAgent = x.sender.startsWith("agent:");
            const ownerId = isAgent ? x.sender.slice(6) : x.sender;
            const owner = usersById[ownerId];
            const mine = !isAgent && ownerId === me.id;
            return (
              <motion.div
                key={x.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className={cn("flex gap-2.5", mine && "flex-row-reverse")}
              >
                {isAgent ? <AgentAvatar user={owner} size={32} /> : <Avatar user={owner} size={32} />}
                <div className={cn("max-w-[75%]", mine && "text-right")}>
                  <div className="mb-0.5 text-[11px] font-semibold text-ink-3">{isAgent ? `${owner?.firstName}'s agent` : owner?.firstName}</div>
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed",
                      isAgent ? "border-gradient text-ink" : mine ? "bg-brand text-white" : "bg-[#e9ebef] text-ink",
                    )}
                  >
                    {x.text}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {!introDone && msgs.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <TypingDots className="text-brand-2" /> agents are writing
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-line px-4 py-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${m.other.firstName}…`}
          className="h-11 flex-1 rounded-full bg-[#f0f2f5] px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30"
        />
        <Button type="submit" disabled={!text.trim()} className="h-11 px-5">
          Send
        </Button>
      </form>
    </div>
  );
}
