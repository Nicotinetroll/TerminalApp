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

function noise(dur: number, vol = 0.05) {
  try {
    const c = getCtx();
    const bufSize = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(g);
    g.connect(c.destination);
    src.start();
  } catch { /* audio not available */ }
}

export const sfx = {
  eat: () => {
    tone(660, 0.07, "square", 0.06);
    setTimeout(() => tone(880, 0.09, "square", 0.06), 50);
  },
  death: () => {
    tone(200, 0.15, "sawtooth", 0.08);
    setTimeout(() => tone(100, 0.3, "sawtooth", 0.06), 80);
  },
  flap: () => tone(480, 0.05, "triangle", 0.06),
  pipeScore: () => {
    tone(880, 0.06, "square", 0.04);
    setTimeout(() => tone(1100, 0.08, "square", 0.04), 40);
  },
  boom: () => {
    noise(0.25, 0.08);
    tone(80, 0.35, "sawtooth", 0.08);
  },
  click: () => tone(1200, 0.025, "square", 0.03),
  flag: () => tone(600, 0.04, "triangle", 0.05),
  win: () => {
    tone(523, 0.1, "square", 0.05);
    setTimeout(() => tone(659, 0.1, "square", 0.05), 100);
    setTimeout(() => tone(784, 0.12, "square", 0.05), 200);
    setTimeout(() => tone(1047, 0.18, "square", 0.06), 300);
  },
  reveal: () => tone(900 + Math.random() * 300, 0.02, "sine", 0.02),
};
