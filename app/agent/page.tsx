"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKindred } from "@/components/Providers";
import { useVoice } from "@/components/agent/useVoice";
import { VoiceOrb } from "@/components/agent/VoiceOrb";
import { AgentAvatar, Avatar, Button, Chip, cn, TypingDots } from "@/components/ui";
import type { Friendship, Memory, User } from "@/lib/types";

type Turn = { role: "user" | "agent"; text: string; createdAt?: string };

function timeAgo(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export default function AgentPage() {
  const { me, meId, usersById, refreshUsers } = useKindred();
  const [user, setUser] = useState<User | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  // Read at the end of a spoken reply, so turning Hands-free off mid-reply takes effect.
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const prevProfile = useRef<User | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/users/${meId}`, { cache: "no-store" });
    if (!res.ok) return;
    const d = await res.json();
    setUser(d.user);
    prevProfile.current = d.user;
    setMemories(d.memories);
    setFriends(d.friendships);
    setTurns(d.history);
  }, [meId]);

  useEffect(() => {
    setTurns([]);
    setUser(null);
    void load();
  }, [load]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, thinking]);

  const sendRef = useRef<(t: string, viaVoice: boolean) => Promise<void>>(async () => {});
  const voice = useVoice((t) => void sendRef.current(t, true));

  const send = useCallback(
    async (text: string, viaVoice: boolean) => {
      const t = text.trim();
      if (!t && turns.length) return;
      setErr(null);
      if (t) setTurns((cur) => [...cur, { role: "user", text: t }]);
      setThinking(true);
      try {
        const res = await fetch("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: meId, message: t }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "agent failed");
        setTurns((cur) => [...cur, { role: "agent", text: d.reply }]);
        // Highlight profile fields the agent just learned.
        const before = prevProfile.current?.profile;
        const after = (d.user as User).profile;
        const diff = new Set<string>();
        if (before) {
          for (const k of ["interests", "values", "recent"] as const) for (const x of after[k]) if (!before[k].includes(x)) diff.add(x);
          for (const k of ["about", "lookingFor", "vibe"] as const) if (before[k] !== after[k]) diff.add(k);
        }
        setChanged(diff);
        setUser(d.user);
        prevProfile.current = d.user;
        setMemories(d.memories);
        void refreshUsers();
        setThinking(false);
        if (voiceOn && (viaVoice || !t)) {
          await voice.speak(d.reply);
          if (handsFreeRef.current && viaVoice) void voice.startListening();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "agent failed");
        setThinking(false);
      }
    },
    [meId, turns.length, voiceOn, voice, refreshUsers],
  );
  sendRef.current = send;

  const forget = async (id: number) => {
    const res = await fetch(`/api/users/${meId}?memory=${id}`, { method: "DELETE" });
    if (res.ok) setMemories((await res.json()).memories);
  };

  const status =
    voice.state === "listening"
      ? "Listening… pause or tap to send"
      : voice.state === "transcribing"
        ? "Got it…"
        : thinking
          ? "Thinking…"
          : voice.state === "speaking"
            ? "Speaking… tap to interrupt"
            : turns.length
              ? "Tap the orb to talk"
              : "Tap the orb to meet your agent";

  const onOrb = () => {
    if (voice.state === "listening") voice.stopListening();
    else if (voice.state === "speaking") voice.stopSpeaking();
    else if (!turns.length) void send("", false);
    else if (!thinking && voice.state === "idle") void voice.startListening();
  };

  const p = user?.profile;
  const userTurns = turns.filter((t) => t.role === "user").length;

  return (
    <div className="grid gap-4 pt-2 lg:grid-cols-12">
      <section className="card flex h-[calc(100vh-120px)] min-h-[620px] flex-col overflow-hidden lg:col-span-7">
        <div className="flex items-center justify-between px-6 pt-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{me ? `${me.firstName}'s agent` : "Your agent"}</h1>
            <p className="text-xs text-ink-3">Talk naturally. It builds your profile and remembers.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Toggle on={voiceOn} onChange={setVoiceOn} label="Voice replies" />
            <Toggle on={handsFree} onChange={setHandsFree} label="Hands-free" />
          </div>
        </div>

        <div className="flex flex-col items-center pt-2 pb-1">
          <button onClick={onOrb} className="rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand/30" aria-label="Talk to your agent">
            <VoiceOrb state={voice.state} level={voice.level} thinking={thinking || voice.state === "transcribing"} size={turns.length > 2 ? 120 : 170} />
          </button>
          <div className="-mt-2 flex items-center gap-2 text-sm font-medium text-ink-2">
            {(thinking || voice.state === "transcribing") && <TypingDots className="text-brand-2" />}
            {status}
          </div>
          {(voice.error || err) && <div className="mt-1 text-xs text-red-500">{voice.error || err}</div>}
        </div>

        <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <AnimatePresence initial={false}>
            {turns.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2.5", t.role === "user" && "flex-row-reverse")}
              >
                {t.role === "agent" ? <AgentAvatar user={me} size={30} /> : <Avatar user={me} size={30} />}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    t.role === "agent" ? "rounded-tl-md bg-[#f0f2f5]" : "bg-gradient-brand rounded-tr-md text-white",
                  )}
                >
                  {t.text}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {thinking && (
            <div className="flex gap-2.5">
              <AgentAvatar user={me} size={30} />
              <div className="rounded-2xl bg-[#f0f2f5] px-4 py-3 text-ink-3">
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = input;
            setInput("");
            void send(t, false);
          }}
          className="flex items-center gap-2 border-t border-line px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={turns.length ? "Or type to your agent…" : "Say hi to your agent…"}
            className="h-11 flex-1 rounded-full bg-[#f0f2f5] px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
          <Button type="submit" disabled={thinking || (!input.trim() && turns.length > 0)} className="h-11 px-5">
            Send
          </Button>
        </form>
      </section>

      <aside className="space-y-4 lg:col-span-5">
        <div className="card overflow-hidden">
          <div className="bg-gradient-brand h-20 opacity-90" />
          <div className="-mt-10 px-5 pb-5">
            <Avatar user={user} size={76} ring />
            <div className="mt-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-bold">{user?.name}</div>
                <motion.div key={user?.tagline} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="text-sm text-ink-2">
                  {user?.tagline}
                </motion.div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {[user?.pronouns, user?.city].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Link href="/discover?go=1">
                <Button className="shrink-0 whitespace-nowrap">✦ Find connections</Button>
              </Link>
            </div>

            {p && (
              <div className="mt-4 space-y-4 text-sm">
                <Field label="About" hot={changed.has("about")}>
                  <p className="leading-relaxed text-ink-2">{p.about}</p>
                </Field>
                <Field label="Interests">
                  <div className="flex flex-wrap gap-1.5">
                    {p.interests.map((x) => (
                      <motion.span key={x} layout initial={changed.has(x) ? { scale: 0.6, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}>
                        <Chip tone={changed.has(x) ? "brand" : "neutral"}>{x}</Chip>
                      </motion.span>
                    ))}
                  </div>
                </Field>
                <Field label="Right now" hot={p.recent.some((r) => changed.has(r))}>
                  <ul className="space-y-1 text-ink-2">
                    {p.recent.map((r) => (
                      <li key={r} className={cn("flex gap-2", changed.has(r) && "font-medium text-brand")}>
                        <span className="text-brand-2">•</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </Field>
                <Field label="Looking for" hot={changed.has("lookingFor")}>
                  <p className="text-ink-2">{p.lookingFor}</p>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Values">
                    <p className="text-ink-2">{p.values.join(", ")}</p>
                  </Field>
                  <Field label="Vibe" hot={changed.has("vibe")}>
                    <p className="text-ink-2">{p.vibe}</p>
                  </Field>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Agent memory</div>
            <div className="text-xs text-ink-3">{memories.length} items</div>
          </div>
          <ul className="scroll-thin mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {[...memories].reverse().map((m) => (
                <motion.li
                  key={m.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group flex items-start gap-2 rounded-xl bg-[#f7f8fa] px-3 py-2 text-xs"
                >
                  <span className="mt-px shrink-0" title={m.kind}>
                    {m.kind === "private" ? "🔒" : m.kind === "agent_note" ? "✦" : "•"}
                  </span>
                  <span className="flex-1 leading-relaxed text-ink-2">{m.text}</span>
                  <button onClick={() => forget(m.id)} className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink" title="Forget this">
                    ✕
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <p className="mt-3 text-[11px] text-ink-3">🔒 Private: your agent uses these to judge fit but never shares them. ✦ Notes from agent conversations.</p>
        </div>

        {friends.length > 0 && (
          <div className="card p-5">
            <div className="text-sm font-semibold">Friends</div>
            <ul className="mt-3 space-y-2.5">
              {friends.map((f) => {
                const other = usersById[f.a === meId ? f.b : f.a];
                const stale = Date.now() - new Date(f.lastSpoke).getTime() > 45 * 86400000;
                return (
                  <li key={f.a + f.b} className="flex items-center gap-3">
                    <Avatar user={other} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{other?.name}</div>
                      <div className="truncate text-xs text-ink-3">{f.context}</div>
                    </div>
                    <Chip tone={stale ? "amber" : "neutral"}>{timeAgo(f.lastSpoke)}</Chip>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {userTurns === 0 && <p className="px-1 text-xs text-ink-3">Tip: your agent already knows the basics. Tell it what you&apos;ve been up to and watch your profile update live.</p>}
      </aside>
    </div>
  );
}

function Field({ label, hot, children }: { label: string; hot?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl transition-colors duration-700", hot && "-mx-2 bg-[#ebf2ff] px-2 py-1")}>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", on ? "bg-[#ebf2ff] text-brand" : "bg-[#f0f2f5] text-ink-3")}>
      {label}
    </button>
  );
}
