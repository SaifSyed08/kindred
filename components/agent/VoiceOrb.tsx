"use client";

import { motion } from "framer-motion";
import type { VoiceState } from "./useVoice";

// A glossy gradient orb that breathes when idle and swells with voice level.
export function VoiceOrb({ state, level, thinking, size = 180 }: { state: VoiceState; level: number; thinking: boolean; size?: number }) {
  const active = state === "listening" || state === "speaking";
  const scale = 1 + (active ? level * 0.28 : 0);
  const palette =
    state === "listening"
      ? "conic-gradient(from 0deg, #0866ff, #22c3ff, #7b4dff, #0866ff)"
      : "conic-gradient(from 0deg, #0866ff, #7b4dff, #c040ff, #ff6bd6, #0866ff)";
  return (
    <div className="relative flex items-center justify-center" style={{ width: size * 1.5, height: size * 1.5 }}>
      <motion.div
        className="absolute rounded-full blur-2xl"
        style={{ width: size * 1.15, height: size * 1.15, background: palette, opacity: 0.35 }}
        animate={{ scale: active ? 1 + level * 0.5 : thinking ? [1, 1.12, 1] : [1, 1.05, 1] }}
        transition={active ? { duration: 0.1 } : { repeat: Infinity, duration: thinking ? 1.2 : 3.5, ease: "easeInOut" }}
      />
      <motion.div
        className="relative overflow-hidden rounded-full shadow-[0_20px_60px_-15px_rgba(91,60,255,0.6)]"
        style={{ width: size, height: size }}
        animate={{ scale: active ? scale : thinking ? [1, 0.96, 1] : [1, 1.02, 1] }}
        transition={active ? { type: "spring", stiffness: 300, damping: 15 } : { repeat: Infinity, duration: thinking ? 0.9 : 3.5, ease: "easeInOut" }}
      >
        <div className="orb-spin absolute -inset-1/4" style={{ background: palette, filter: "blur(14px)", animationDuration: thinking ? "2s" : state === "speaking" ? "4s" : "9s" }} />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.85)_0%,rgba(255,255,255,0.15)_28%,transparent_55%)]" />
        <div className="absolute inset-0 rounded-full shadow-[inset_0_-12px_30px_rgba(40,0,120,0.35)]" />
      </motion.div>
    </div>
  );
}
