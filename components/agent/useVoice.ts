"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "transcribing" | "speaking";

// Mic capture with silence auto-stop, server transcription, and TTS playback.
// `level` (0-1) is the live loudness of whichever is active, for the orb.
export function useVoice(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const mounted = useRef(true);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  const ctx = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  };

  const meter = useCallback((analyser: AnalyserNode, onFrame?: (rms: number) => void) => {
    const buf = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 4));
      onFrame?.(rms);
      rafRef.current = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(rafRef.current);
    loop();
  }, []);

  const stopMeter = () => {
    cancelAnimationFrame(rafRef.current);
    setLevel(0);
  };

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    stopMeter();
    setState((s) => (s === "speaking" ? "idle" : s));
  }, []);

  const stopListening = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  const startListening = useCallback(async () => {
    // A second start while the mic is open would orphan the first recorder (and leave the mic on).
    if (recRef.current && recRef.current.state !== "inactive") return;
    setError(null);
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const ac = ctx();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);

      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stopMeter();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!mounted.current) return;
        if (blob.size < 2000) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const form = new FormData();
          form.append("audio", blob, "speech");
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          const data = await res.json();
          if (!mounted.current) return;
          setState("idle");
          if (!res.ok) throw new Error(data.error ?? "transcription failed");
          if (data.text) cbRef.current(data.text);
        } catch (e) {
          setState("idle");
          setError(e instanceof Error ? e.message : "transcription failed");
        }
      };

      // Auto-stop after ~1.4 s of silence once the person has started talking. "Silence" is relative to the
      // room: the quietest level seen in the first half second sets the floor, so a noisy hall still works.
      // Tapping the orb always sends, and a 20 s cap stops runaway recordings.
      let spoke = false;
      let quietSince = 0;
      let floor = Infinity;
      const started = performance.now();
      meter(analyser, (rms) => {
        const t = performance.now();
        if (t - started < 500) floor = Math.min(floor, rms);
        const threshold = Math.max(0.03, (Number.isFinite(floor) ? floor : 0) * 2.5);
        if (rms > threshold) {
          spoke = true;
          quietSince = 0;
        } else if (spoke) {
          if (!quietSince) quietSince = t;
          else if (t - quietSince > 1400 && rec.state === "recording") rec.stop();
        }
        if (t - started > 20000 && rec.state === "recording") rec.stop();
      });
      rec.start(250);
      setState("listening");
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission denied" : "Couldn't access the microphone");
      setState("idle");
    }
  }, [meter, stopSpeaking]);

  const speak = useCallback(
    async (text: string) => {
      stopSpeaking();
      setState("speaking");
      try {
        const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error("tts failed");
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        try {
          const ac = ctx();
          const src = ac.createMediaElementSource(audio);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 1024;
          src.connect(analyser);
          analyser.connect(ac.destination);
          meter(analyser);
        } catch {}
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onpause = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      } catch {
        // Fall back to the browser's own voice.
        if (typeof speechSynthesis !== "undefined") {
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text);
            u.onend = () => resolve();
            u.onerror = () => resolve();
            speechSynthesis.speak(u);
          });
        }
      }
      if (audioRef.current) audioRef.current = null;
      stopMeter();
      setState((s) => (s === "speaking" ? "idle" : s));
    },
    [meter, stopSpeaking],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimationFrame(rafRef.current);
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  return { state, level, error, startListening, stopListening, speak, stopSpeaking };
}
