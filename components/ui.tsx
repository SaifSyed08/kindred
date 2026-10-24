"use client";

import type { User } from "@/lib/types";

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function avatarGradient(hue: number) {
  return `linear-gradient(135deg, hsl(${hue} 85% 62%), hsl(${(hue + 40) % 360} 80% 52%))`;
}

export function Avatar({ user, size = 40, ring = false, className }: { user?: Pick<User, "name" | "hue"> | null; size?: number; ring?: boolean; className?: string }) {
  if (!user) return <div className={cn("rounded-full bg-line", className)} style={{ width: size, height: size }} />;
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", ring && "ring-[3px] ring-white", className)}
      style={{ width: size, height: size, background: avatarGradient(user.hue), fontSize: size * 0.36 }}
      aria-label={user.name}
    >
      {initials(user.name)}
    </div>
  );
}

// An agent is drawn as the person's avatar inside a soft gradient halo with a small spark badge.
export function AgentAvatar({ user, size = 40 }: { user?: Pick<User, "name" | "hue"> | null; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar user={user} size={size} />
      <div
        className="bg-gradient-brand absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full text-white ring-2 ring-white"
        style={{ width: size * 0.42, height: size * 0.42, fontSize: size * 0.24 }}
      >
        ✦
      </div>
    </div>
  );
}

export function Chip({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "brand" | "green" | "amber"; className?: string }) {
  const tones = {
    neutral: "bg-[#f0f2f5] text-ink-2",
    brand: "bg-[#ebf2ff] text-brand",
    green: "bg-[#e7f6ec] text-[#1a7f37]",
    amber: "bg-[#fff4e0] text-[#a15c00]",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-[#0759e0] shadow-[0_6px_16px_-6px_rgba(8,102,255,0.6)]",
    secondary: "bg-[#e4e6eb] text-ink hover:bg-[#d8dadf]",
    ghost: "text-ink-2 hover:bg-[#f0f2f5]",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}
