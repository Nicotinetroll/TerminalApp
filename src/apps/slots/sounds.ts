import { WebHaptics } from "web-haptics";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// ── Haptics ──
const haptics = new WebHaptics();

function vibe(pattern: number | number[]) {
  void haptics.trigger(pattern);
}

function vibePattern(vibrations: { duration: number; intensity?: number; delay?: number }[]) {
  void haptics.trigger(vibrations);
}

// Exported haptic-only effects for use in SlotMachine etc.
export const slotsHaptics = {
  // Lucky counter tick — each number change
  counterTick: () => vibe(8),
  // Lucky counter landed — satisfying thump
  counterLand: () => vibePattern([
    { duration: 40, intensity: 0.7 },
    { delay: 30, duration: 80, intensity: 1 },
  ]),
  // All 3 reels stopped — the "reveal" moment
  reelsComplete: () => vibePattern([
    { duration: 50, intensity: 0.8 },
    { delay: 20, duration: 80, intensity: 1 },
  ]),
  // Spin starting — pull the lever
  spinStart: () => vibe([30, 20, 50]),
  // Result: big win flash
  resultFlash: () => vibe(60),
};

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.07, delay = 0) {
  try {
    const c = getCtx();
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* audio not available */ }
}

// Sweep: freq slides from start to end
function sweep(from: number, to: number, dur: number, type: OscillatorType = "sine", vol = 0.05, delay = 0) {
  try {
    const c = getCtx();
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* audio not available */ }
}

// Noise burst (for impacts / reel stops)
function noise(dur: number, vol = 0.03, delay = 0) {
  try {
    const c = getCtx();
    const t = c.currentTime + delay;
    const bufSize = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    }
    const src = c.createBufferSource();
    const g = c.createGain();
    const filt = c.createBiquadFilter();
    src.buffer = buf;
    filt.type = "bandpass";
    filt.frequency.value = 2000;
    filt.Q.value = 0.5;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(c.destination);
    src.start(t);
  } catch { /* audio not available */ }
}

// Chord: play multiple tones at once
function chord(freqs: number[], dur: number, type: OscillatorType = "triangle", vol = 0.04, delay = 0) {
  const perVol = vol / Math.sqrt(freqs.length);
  for (const f of freqs) {
    tone(f, dur, type, perVol, delay);
  }
}

// Arpeggio: ascending notes with timing
function arp(freqs: number[], spacing: number, dur: number, type: OscillatorType = "triangle", vol = 0.05) {
  freqs.forEach((f, i) => {
    tone(f, dur, type, vol, i * spacing);
  });
}

export const slotsSfx = {
  // ── Coin drop: satisfying metallic clink ──
  coinInsert: () => {
    tone(2400, 0.03, "triangle", 0.04);
    tone(3200, 0.02, "square", 0.02, 0.015);
    tone(1800, 0.05, "sine", 0.03, 0.04);
    noise(0.02, 0.02, 0.01);
    vibePattern([{ duration: 30, intensity: 0.8 }]);
  },

  // ── Reel tick: subtle click during spin ──
  reelTick: () => {
    const freq = 800 + Math.random() * 1200;
    tone(freq, 0.012, "square", 0.012);
    // light tick every few frames (called externally with throttle)
  },

  // ── Reel stop: chunky mechanical thud ──
  reelStop: () => {
    tone(180, 0.05, "triangle", 0.06);
    tone(120, 0.04, "sine", 0.04, 0.01);
    noise(0.03, 0.025);
    vibePattern([{ duration: 60, intensity: 1 }]);
  },

  // ── Pair win: small satisfying ding ──
  pairWin: () => {
    tone(880, 0.06, "triangle", 0.05);
    tone(1100, 0.08, "sine", 0.04, 0.06);
    tone(660, 0.04, "sine", 0.02, 0.03);
    vibePattern([
      { duration: 50, intensity: 0.8 },
      { delay: 30, duration: 50, intensity: 1 },
    ]);
  },

  // ── Single line win: classic casino cha-ching ──
  win: () => {
    // C-E-G ascending
    tone(523, 0.08, "triangle", 0.05);
    tone(659, 0.08, "triangle", 0.05, 0.08);
    tone(784, 0.1, "triangle", 0.05, 0.16);
    // High sparkle
    tone(1568, 0.06, "sine", 0.03, 0.22);
    tone(2093, 0.04, "sine", 0.02, 0.26);
    // Coin sounds
    noise(0.02, 0.015, 0.20);
    noise(0.02, 0.015, 0.28);
    vibePattern([
      { duration: 60, intensity: 0.8 },
      { delay: 30, duration: 60, intensity: 0.9 },
      { delay: 30, duration: 80, intensity: 1 },
    ]);
  },

  // ── Multi-line win: bigger, more exciting ──
  multiWin: () => {
    // Fast ascending arpeggio C-E-G-C'-E'
    arp([523, 659, 784, 1047, 1319], 0.06, 0.1, "triangle", 0.05);
    // Triumphant chord
    chord([1047, 1319, 1568], 0.25, "triangle", 0.05, 0.35);
    // Sparkle cascade
    tone(2637, 0.04, "sine", 0.025, 0.38);
    tone(3136, 0.03, "sine", 0.02, 0.42);
    tone(2093, 0.05, "sine", 0.025, 0.46);
    // Coin shower
    for (let i = 0; i < 4; i++) {
      noise(0.02, 0.012, 0.35 + i * 0.06);
    }
    vibePattern([
      { duration: 70, intensity: 0.8 },
      { delay: 25, duration: 70, intensity: 0.9 },
      { delay: 25, duration: 70, intensity: 0.9 },
      { delay: 25, duration: 100, intensity: 1 },
    ]);
  },

  // ── Big win: 3+ lines or high multiplier ──
  bigWin: () => {
    // Dramatic sweep up
    sweep(300, 1200, 0.3, "sawtooth", 0.03);
    // Fanfare: C-E-G-C' rapid then sustained chord
    arp([523, 659, 784, 1047], 0.05, 0.1, "triangle", 0.05);
    chord([1047, 1319, 1568, 2093], 0.4, "triangle", 0.05, 0.25);
    // High sparkle rain
    const sparkles = [2637, 3136, 2093, 3520, 2637, 4186];
    sparkles.forEach((f, i) => {
      tone(f, 0.04, "sine", 0.02, 0.3 + i * 0.05);
    });
    // Coin avalanche
    for (let i = 0; i < 6; i++) {
      noise(0.025, 0.015, 0.25 + i * 0.07);
    }
    // Sub bass hit
    tone(80, 0.3, "sine", 0.04, 0.2);
    vibePattern([
      { duration: 80, intensity: 0.8 },
      { delay: 25, duration: 80, intensity: 0.9 },
      { delay: 25, duration: 80, intensity: 0.9 },
      { delay: 25, duration: 100, intensity: 1 },
      { delay: 30, duration: 150, intensity: 1 },
    ]);
  },

  // ── JACKPOT: absolute banger ──
  jackpot: () => {
    // Sub bass impact
    tone(60, 0.5, "sine", 0.06);
    sweep(200, 2000, 0.4, "sawtooth", 0.035);

    // Triple fanfare — each wave bigger
    // Wave 1
    arp([523, 659, 784], 0.05, 0.08, "triangle", 0.05);
    // Wave 2
    arp([784, 1047, 1319], 0.05, 0.08, "triangle", 0.055, 0.2);
    // Wave 3 — highest
    arp([1047, 1319, 1568, 2093], 0.04, 0.1, "triangle", 0.055, 0.4);

    // Sustained victory chord
    chord([1047, 1319, 1568, 2093], 0.6, "triangle", 0.06, 0.6);
    chord([523, 784, 1047], 0.6, "sine", 0.03, 0.6);

    // Sparkle explosion
    const sparkleFreqs = [2637, 3136, 3520, 4186, 3136, 2637, 3520, 4186, 2093, 3136];
    sparkleFreqs.forEach((f, i) => {
      tone(f, 0.05, "sine", 0.025, 0.55 + i * 0.04);
    });

    // Coin explosion
    for (let i = 0; i < 10; i++) {
      noise(0.03, 0.018, 0.5 + i * 0.06);
      tone(2000 + Math.random() * 2000, 0.02, "triangle", 0.01, 0.5 + i * 0.06);
    }

    // Final stinger
    chord([2093, 2637, 3136], 0.3, "triangle", 0.04, 1.1);
    tone(4186, 0.15, "sine", 0.02, 1.15);
    // Jackpot haptic: escalating bursts — MAXIMUM
    vibePattern([
      { duration: 100, intensity: 0.7 },
      { delay: 30, duration: 100, intensity: 0.8 },
      { delay: 30, duration: 120, intensity: 0.9 },
      { delay: 25, duration: 150, intensity: 1 },
      { delay: 25, duration: 200, intensity: 1 },
      { delay: 30, duration: 300, intensity: 1 },
    ]);
  },

  // ── Lose: sad but short, not annoying ──
  lose: () => {
    tone(400, 0.1, "triangle", 0.035);
    tone(320, 0.12, "triangle", 0.03, 0.08);
    tone(250, 0.18, "sine", 0.02, 0.16);
    vibePattern([{ duration: 40, intensity: 0.5 }]);
  },

  // ── Near miss: tease — almost got it ──
  nearMiss: () => {
    tone(523, 0.06, "triangle", 0.04);
    tone(659, 0.06, "triangle", 0.04, 0.06);
    // Drop down at the end
    tone(440, 0.15, "sine", 0.035, 0.14);
    tone(350, 0.1, "sine", 0.02, 0.22);
    vibePattern([
      { duration: 40, intensity: 0.7 },
      { delay: 40, duration: 60, intensity: 0.5 },
    ]);
  },

  // ── Free spins awarded: magical, exciting ──
  freeSpin: () => {
    // Magical sweep
    sweep(400, 3000, 0.35, "sine", 0.035);
    // Twinkle arpeggio
    arp([1047, 1319, 1568, 2093, 2637], 0.07, 0.1, "triangle", 0.04);
    // Shimmering chord
    chord([1568, 2093, 2637], 0.35, "sine", 0.04, 0.4);
    // High sparkles
    tone(3520, 0.04, "sine", 0.02, 0.45);
    tone(4186, 0.03, "sine", 0.018, 0.5);
    tone(3136, 0.05, "sine", 0.02, 0.55);
    vibePattern([
      { duration: 60, intensity: 0.8 },
      { delay: 30, duration: 60, intensity: 0.9 },
      { delay: 30, duration: 80, intensity: 1 },
    ]);
  },

  // ── Free spin: each free spin starts with this ──
  freeSpinTick: () => {
    tone(1200, 0.04, "triangle", 0.04);
    tone(1600, 0.03, "sine", 0.03, 0.03);
    sweep(800, 1400, 0.06, "sine", 0.02, 0.01);
    vibePattern([{ duration: 25, intensity: 0.7 }]);
  },

  // ── Bonus trigger: dramatic fanfare announcing hunt ──
  bonusTrigger: () => {
    // Dramatic sweep up
    sweep(200, 1600, 0.4, "sawtooth", 0.04);
    // Power chord
    chord([440, 554, 659], 0.3, "triangle", 0.05, 0.1);
    // Ascending fanfare
    arp([659, 784, 1047, 1319, 1568], 0.06, 0.12, "triangle", 0.05, 0.25);
    // Sustained victory chord
    chord([1047, 1319, 1568], 0.5, "triangle", 0.06, 0.6);
    // Sparkle cascade
    const sparkles = [2637, 3136, 3520, 2093, 2637, 3136, 4186];
    sparkles.forEach((f, i) => {
      tone(f, 0.04, "sine", 0.02, 0.55 + i * 0.05);
    });
    // Sub impact
    tone(80, 0.4, "sine", 0.05);
    // Coin shower
    for (let i = 0; i < 5; i++) {
      noise(0.02, 0.015, 0.6 + i * 0.06);
    }
    // Dramatic escalating haptic — CRANKED
    vibePattern([
      { duration: 80, intensity: 0.7 },
      { delay: 30, duration: 80, intensity: 0.8 },
      { delay: 30, duration: 100, intensity: 0.9 },
      { delay: 25, duration: 150, intensity: 1 },
      { delay: 30, duration: 250, intensity: 1 },
    ]);
  },

  // ── Hunt hit: satisfying rising ding per symbol hit ──
  huntHit: () => {
    tone(1047, 0.06, "triangle", 0.05);
    tone(1319, 0.08, "triangle", 0.045, 0.05);
    tone(1568, 0.06, "sine", 0.03, 0.1);
    noise(0.015, 0.01, 0.08);
    vibePattern([
      { duration: 35, intensity: 0.8 },
      { delay: 15, duration: 60, intensity: 1 },
    ]);
  },

  // ── Bonus complete: triumphant completion ──
  bonusComplete: () => {
    // Ascending arpeggio
    arp([523, 659, 784, 1047, 1319, 1568], 0.07, 0.12, "triangle", 0.05);
    // Sustained major chord
    chord([1047, 1319, 1568, 2093], 0.6, "triangle", 0.06, 0.5);
    chord([523, 784, 1047], 0.5, "sine", 0.03, 0.5);
    // High sparkles
    tone(2637, 0.05, "sine", 0.025, 0.55);
    tone(3136, 0.04, "sine", 0.02, 0.6);
    tone(3520, 0.05, "sine", 0.025, 0.65);
    tone(4186, 0.04, "sine", 0.02, 0.7);
    // Coin celebration
    for (let i = 0; i < 8; i++) {
      noise(0.025, 0.015, 0.5 + i * 0.05);
    }
    // Final stinger
    chord([2093, 2637, 3136], 0.3, "triangle", 0.04, 0.9);
    // Victory buzz — BEEFY
    vibePattern([
      { duration: 60, intensity: 0.7 },
      { delay: 25, duration: 70, intensity: 0.8 },
      { delay: 25, duration: 80, intensity: 0.9 },
      { delay: 25, duration: 120, intensity: 1 },
      { delay: 30, duration: 200, intensity: 1 },
    ]);
  },
};
