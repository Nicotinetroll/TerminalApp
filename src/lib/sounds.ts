let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

type SoundType = "ping" | "blip" | "knock" | "none";

function playPing(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
  osc.type = "sine";
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}

function playBlip(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
  osc.type = "square";
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.12);
}

function playKnock(ctx: AudioContext) {
  // Two quick taps
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.12;
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.06);
    osc.type = "triangle";
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.start(t);
    osc.stop(t + 0.08);
  }
}

export function playSound(soundType: SoundType): void {
  if (soundType === "none") return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    switch (soundType) {
      case "ping": playPing(ctx); break;
      case "blip": playBlip(ctx); break;
      case "knock": playKnock(ctx); break;
    }
  } catch {
    // audio not available
  }
}
