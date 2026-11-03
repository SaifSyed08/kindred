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
  // Set synchronously so a second tap during the permission prompt can't open a second recorder.
  const starting = useRef(false);
  // Bumped by stopSpeaking; a reply still downloading checks it and stays silent if interrupted.
  const speakGen = useRef(0);
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
    speakGen.current += 1;
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
    if (!mounted.current || starting.current || (recRef.current && recRef.current.state !== "inactive")) return;
    starting.current = true;
    setError(null);
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
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
      // Frames from the first ~150 ms (a fresh analyser reads all zeros) are skipped; the floor is a low
      // percentile of the next ~450 ms (the gaps between syllables if they start talking right away), and the
      // threshold is clamped so a loud start can't push it above normal speech.
      let spoke = false;
      let quietSince = 0;
      let smooth = 0;
      const samples: number[] = [];
      let floor = -1;
      const started = performance.now();
      meter(analyser, (rms) => {
        const t = performance.now();
        smooth = smooth * 0.8 + rms * 0.2;
        if (t - started > 20000 && rec.state === "recording") rec.stop();
        if (t - started < 150 || rms < 0.001) return;
        if (t - started < 600) {
          samples.push(rms);
          return;
        }
        if (floor < 0) floor = samples.length ? [...samples].sort((x, y) => x - y)[Math.floor(samples.length * 0.1)] : 0.01;
        const threshold = Math.min(0.12, Math.max(0.03, floor * 2.5));
        if (smooth > threshold) {
          spoke = true;
          quietSince = 0;
        } else if (spoke) {
          if (!quietSince) quietSince = t;
          else if (t - quietSince > 1400 && rec.state === "recording") rec.stop();
        }
      });
      rec.start(250);
      setState("listening");
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission denied" : "Couldn't access the microphone");
      setState("idle");
    } finally {
      starting.current = false;
    }
  }, [meter, stopSpeaking]);

  const speak = useCallback(
    async (text: string) => {
      if (!mounted.current) return;
      stopSpeaking();
      const gen = speakGen.current;
      const interrupted = () => !mounted.current || speakGen.current !== gen;
      setState("speaking");
      try {
        const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error("tts failed");
        const blob = await res.blob();
        if (interrupted()) return;
        const url = URL.createObjectURL(blob);
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
        // Interrupted: a recording may own the meter now, so touch nothing.
        if (interrupted()) return;
        // Fall back to the browser's own voice.
        if (!interrupted() && typeof speechSynthesis !== "undefined") {
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text);
            u.onend = () => resolve();
            u.onerror = () => resolve();
            speechSynthesis.speak(u);
          });
        }
      }
      if (interrupted()) return;
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
