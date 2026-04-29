import { useCallback, useRef } from "react";

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function isEnabled(): boolean {
  try {
    return localStorage.getItem("mynigga-typing-sounds") === "1";
  } catch {
    return false;
  }
}

export function toggleTypingSounds(): boolean {
  const next = !isEnabled();
  try {
    localStorage.setItem("mynigga-typing-sounds", next ? "1" : "0");
  } catch { /* */ }
  return next;
}

export function getTypingSoundsEnabled(): boolean {
  return isEnabled();
}

export function useTypingSounds() {
  const lastPlayRef = useRef(0);

  const playKeySound = useCallback((key: string) => {
    if (!isEnabled()) return;
    const ctx = getCtx();
    if (!ctx) return;

    // Throttle: max one sound per 25ms
    const now = performance.now();
    if (now - lastPlayRef.current < 25) return;
    lastPlayRef.current = now;

    // Resume if suspended (browser autoplay policy)
    if (ctx.state === "suspended") {
      void ctx.resume();
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "square";

    if (key === "Enter") {
      osc.frequency.value = 200 + Math.random() * 40;
      gain.gain.value = 0.025;
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } else if (key === "Backspace") {
      osc.frequency.value = 300 + Math.random() * 50;
      gain.gain.value = 0.02;
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.04);
    } else if (key.length === 1) {
      // Regular character key
      osc.frequency.value = 400 + Math.random() * 100;
      gain.gain.value = 0.03;
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.03);
    } else {
      // Modifier/special key — skip
      gain.disconnect();
      return;
    }

    // Cleanup
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }, []);

  return { playKeySound };
}
