let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.07) {
  try {
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch { /* audio not available */ }
}

export const coinSfx = {
  flip: () => {
    // whoosh - ascending sweep
    tone(200, 0.08, "sawtooth", 0.03);
    setTimeout(() => tone(400, 0.06, "sawtooth", 0.025), 40);
    setTimeout(() => tone(600, 0.05, "sawtooth", 0.02), 80);
    setTimeout(() => tone(800, 0.04, "triangle", 0.02), 120);
  },

  win: () => {
    // bright ding
    tone(880, 0.08, "triangle", 0.06);
    setTimeout(() => tone(1100, 0.08, "triangle", 0.05), 80);
    setTimeout(() => tone(1320, 0.12, "triangle", 0.06), 160);
    setTimeout(() => tone(1760, 0.15, "sine", 0.04), 250);
  },

  lose: () => {
    // dull thud
    tone(150, 0.15, "sine", 0.06);
    setTimeout(() => tone(100, 0.2, "sine", 0.04), 80);
    setTimeout(() => tone(70, 0.25, "sine", 0.02), 160);
  },
};
