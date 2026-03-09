import { useState, useEffect, useRef, useCallback } from "react";
import type { SlotsLineWin, SlotsBonusInfo } from "@/lib/api";
import type { SlotTheme } from "./themes";
import { slotsSfx, slotsHaptics } from "./sounds";

function makeEmptyGrid(theme: SlotTheme): string[][] {
  const s = theme.symbols;
  return [
    [s[3]!, s[1]!, s[4]!],
    [s[2]!, s[3]!, s[0]!],
    [s[4]!, s[1]!, s[3]!],
  ];
}

// Payline cell indices: [col, row]
const PAYLINE_CELLS: [number, number][][] = [
  [[0,1], [1,1], [2,1]], // middle
  [[0,0], [1,0], [2,0]], // top
  [[0,2], [1,2], [2,2]], // bottom
  [[0,0], [1,1], [2,2]], // diag ↘
  [[0,2], [1,1], [2,0]], // diag ↗
];

const LINE_COLORS = ["#a78bfa", "#22c55e", "#3b82f6", "#f97316", "#ec4899"];

interface Particle {
  id: number;
  x: number;
  y: number;
  char: string;
  delay: number;
}

let pid = 0;

interface SlotMachineProps {
  spinId: number;
  grid: string[][] | null;
  wins: SlotsLineWin[];
  hasJackpot: boolean;
  isFreeSpin: boolean;
  freeSpinsRemaining: number;
  freeSpinsAwarded: number;
  onSpinComplete: () => void;
  theme: SlotTheme;
  message: string | null;
  messageType: "win" | "lose" | "jackpot" | "freespin" | "error";
  totalPayout: number;
  winCount: number;
  busy: boolean;
  isNB?: boolean;
  bonus: SlotsBonusInfo | null;
  bonusAnnounce: SlotsBonusInfo | null;
  bonusComplete: SlotsBonusInfo | null;
}

type Phase = "idle" | "spinning" | "stopping" | "result";

function fmtMB(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtNB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} NB`;
}

function fmtBonusPayout(bonus: SlotsBonusInfo): string {
  if (bonus.currency === "niggabytes") return `${bonus.total_bonus} NB`;
  return fmtMB(bonus.total_bonus);
}

// Per-symbol hunt names — the dumber the better
const HUNT_NAMES: Record<string, string> = {
  filler2: "CODE BROWN",       // 💩
  filler1: "LEMON PARTY",      // 🍋
  mid1: "CHERRY POPPER",       // 🍒
  mid2: "COIN GOBLIN",         // 🪙
  premium3: "FIRE SALE",       // 🔥
  premium2: "BONE ZONE",       // 💀
  premium1: "DIAMOND HANDS",   // 💎
  jackpot: "LUCKY STALKER",    // 7️⃣
};

function getHuntName(tier: string): string {
  return HUNT_NAMES[tier] ?? "HUNT";
}

// Lucky spin counter — cycles rapidly through numbers before landing on final
function LuckySpinCounter({ target }: { target: number }) {
  const [display, setDisplay] = useState(1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const delay = 40 + i * 14; // slows down: 40ms → 222ms, total ~1.8s
      elapsed += delay;
      const t = setTimeout(() => {
        if (i === steps - 1) {
          setDisplay(target);
          setSettled(true);
          slotsHaptics.counterLand();
        } else {
          setDisplay(1 + Math.floor(Math.random() * 20));
          slotsHaptics.counterTick();
        }
      }, elapsed);
      timeouts.push(t);
    }
    return () => timeouts.forEach(clearTimeout);
  }, [target]);

  return (
    <span className={`slots-lucky-counter ${settled ? "slots-lucky-counter-settled" : "slots-lucky-counter-spinning"}`}>
      {display}
    </span>
  );
}

export function SlotMachine({
  spinId, grid, wins, hasJackpot, isFreeSpin, freeSpinsRemaining, freeSpinsAwarded, onSpinComplete,
  theme, message, messageType, totalPayout, busy, isNB,
  bonus, bonusAnnounce, bonusComplete,
}: SlotMachineProps) {
  const [displayGrid, setDisplayGrid] = useState<string[][]>(() => makeEmptyGrid(theme));
  const [colPhases, setColPhases] = useState<Phase[]>(["idle", "idle", "idle"]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [winLines, setWinLines] = useState<number[]>([]);
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showEffect, setShowEffect] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState<"win" | "jackpot" | "bonus" | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [huntHitCells, setHuntHitCells] = useState<Set<string>>(new Set());

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastSpinIdRef = useRef(0);
  const onCompleteRef = useRef(onSpinComplete);
  onCompleteRef.current = onSpinComplete;
  const stoppedColsRef = useRef<Set<number>>(new Set());
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const bonusRef = useRef(bonus);
  bonusRef.current = bonus;

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const clearInterval_ = useCallback(() => {
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearInterval_();
    clearTimers();
  }, [clearInterval_, clearTimers]);

  useEffect(() => cleanup, [cleanup]);

  // Reset grid when theme changes while idle
  useEffect(() => {
    if (phase === "idle") {
      setDisplayGrid(makeEmptyGrid(theme));
    }
  }, [theme, phase]);

  const spawnParticles = useCallback((type: "win" | "jackpot" | "bonus", emoji?: string) => {
    const t = themeRef.current;
    const count = type === "jackpot" ? 50 : type === "bonus" ? 60 : 20;
    const chars = type === "bonus" && emoji
      ? [emoji, emoji, emoji, "✨", "🎯"]
      : type === "jackpot"
        ? t.jackpotParticles
        : t.winParticles;
    const p: Particle[] = [];
    for (let i = 0; i < count; i++) {
      p.push({
        id: ++pid,
        x: 5 + Math.random() * 90,
        y: 10 + Math.random() * 80,
        char: chars[Math.floor(Math.random() * chars.length)]!,
        delay: Math.random() * 0.8,
      });
    }
    setParticles(p);
    const t2 = setTimeout(() => setParticles([]), 3500);
    timeoutsRef.current.push(t2);
  }, []);

  // Phase 1: New spinId → start spinning
  useEffect(() => {
    if (spinId === 0 || spinId === lastSpinIdRef.current) return;
    lastSpinIdRef.current = spinId;

    cleanup();
    stoppedColsRef.current = new Set();
    setWinLines([]);
    setWinCells(new Set());
    setHuntHitCells(new Set());
    setShowEffect(null);
    setShowFlash(null);
    setShowOverlay(false);
    setParticles([]);
    setPhase("spinning");
    setColPhases(["spinning", "spinning", "spinning"]);
    slotsHaptics.spinStart();

    const t = themeRef.current;
    const syms = t.symbols;

    let tick = 0;
    spinIntervalRef.current = setInterval(() => {
      tick++;
      if (tick % 4 === 0) slotsSfx.reelTick();
      const stopped = stoppedColsRef.current;
      setDisplayGrid(prev => {
        const next = prev.map((c, i) => {
          if (stopped.has(i)) return c;
          return [
            syms[Math.floor(Math.random() * syms.length)]!,
            syms[Math.floor(Math.random() * syms.length)]!,
            syms[Math.floor(Math.random() * syms.length)]!,
          ];
        });
        return next;
      });
    }, 55);
  }, [spinId, cleanup]);

  // Phase 2: Got grid → stop columns sequentially
  useEffect(() => {
    if (phase !== "spinning" || !grid) return;

    setPhase("stopping");
    const delays = [300, 650, 1050];

    delays.forEach((delay, col) => {
      const t = setTimeout(() => {
        slotsSfx.reelStop();
        stoppedColsRef.current.add(col);

        setColPhases(prev => {
          const next = [...prev];
          next[col] = "stopping";
          return next as [Phase, Phase, Phase];
        });
        setDisplayGrid(prev => {
          const next = prev.map(c => [...c]);
          next[col] = [...grid[col]!];
          return next;
        });

        if (col === 2) {
          clearInterval_();
          slotsHaptics.reelsComplete();

          const t2 = setTimeout(() => {
            setColPhases(["result", "result", "result"]);
            setPhase("result");

            const wl = wins.map(w => w.line);
            setWinLines(wl);
            const cells = new Set<string>();
            for (const w of wins) {
              const lineCells = PAYLINE_CELLS[w.line];
              if (lineCells) {
                for (const [c, r] of lineCells) {
                  cells.add(`${c},${r}`);
                }
              }
            }
            setWinCells(cells);

            // Hunt hit detection — find cells with the bonus target symbol
            const currentBonus = bonusRef.current;
            if (currentBonus) {
              const huntCells = new Set<string>();
              for (let c = 0; c < 3; c++) {
                for (let r = 0; r < 3; r++) {
                  if (grid[c]?.[r] === currentBonus.symbol) {
                    huntCells.add(`${c},${r}`);
                  }
                }
              }
              setHuntHitCells(huntCells);
              // Play hunt hit sound for each hit
              if (huntCells.size > 0) {
                let i = 0;
                huntCells.forEach(() => {
                  setTimeout(() => slotsSfx.huntHit(), i * 120);
                  i++;
                });
                // Spawn bonus particles on hits
                const hitParticles: Particle[] = [];
                huntCells.forEach((key) => {
                  const [cx, cy] = key.split(",").map(Number) as [number, number];
                  for (let j = 0; j < 4; j++) {
                    hitParticles.push({
                      id: ++pid,
                      x: (cx / 2) * 80 + 10 + (Math.random() - 0.5) * 20,
                      y: (cy / 2) * 80 + 10 + (Math.random() - 0.5) * 20,
                      char: currentBonus.emoji,
                      delay: Math.random() * 0.3,
                    });
                  }
                });
                if (hitParticles.length > 0) {
                  setParticles(prev => [...prev, ...hitParticles]);
                  const tc = setTimeout(() => setParticles([]), 2500);
                  timeoutsRef.current.push(tc);
                }
              }
            }

            // Effects — tiered sounds
            if (hasJackpot) {
              slotsSfx.jackpot();
              setShowEffect("jackpot");
              setShowFlash("jackpot");
              spawnParticles("jackpot");
            } else if (freeSpinsAwarded > 0) {
              slotsSfx.freeSpin();
              if (wins.length > 0) {
                setTimeout(() => slotsSfx.multiWin(), 500);
              }
              setShowEffect("win");
              spawnParticles("win");
            } else if (wins.length >= 3) {
              slotsSfx.bigWin();
              setShowEffect("win");
              setShowFlash("win");
              spawnParticles("win");
            } else if (wins.length >= 2) {
              slotsSfx.multiWin();
              setShowEffect("win");
              spawnParticles("win");
            } else if (wins.length === 1) {
              const isPair = wins[0]!.multiplier <= 2;
              if (isPair) {
                slotsSfx.pairWin();
              } else {
                slotsSfx.win();
              }
              setShowEffect("win");
              spawnParticles("win");
            } else if (!currentBonus || (currentBonus && huntHitCells.size === 0)) {
              slotsSfx.lose();
              setShowEffect("lose");
            }

            // Show message overlay
            setShowOverlay(true);
            onCompleteRef.current();

            // Clear flash quickly
            const tFlash = setTimeout(() => setShowFlash(null), 400);
            timeoutsRef.current.push(tFlash);

            const t3 = setTimeout(() => {
              setShowEffect(null);
              setWinLines([]);
              setWinCells(new Set());
              setHuntHitCells(new Set());
              setShowOverlay(false);
            }, 2800);
            timeoutsRef.current.push(t3);
          }, 200);
          timeoutsRef.current.push(t2);
        }
      }, delay);
      timeoutsRef.current.push(t);
    });
  }, [phase, grid, wins, hasJackpot, freeSpinsAwarded, spawnParticles, clearInterval_]);

  const machineClass = [
    "slots-machine",
    showEffect === "jackpot" ? "slots-machine-jackpot" : "",
    showEffect === "win" ? "slots-machine-win" : "",
    showEffect === "lose" ? "slots-machine-lose" : "",
    isFreeSpin ? "slots-machine-freespin" : "",
    bonus ? "slots-machine-bonus" : "",
  ].filter(Boolean).join(" ");

  const colX = [15.83, 50, 84.17];
  const rowY = [16.67, 50, 83.33];

  return (
    <div
      className={machineClass}
      style={{
        "--theme-accent": theme.accent,
        "--theme-accent-rgb": theme.accentRgb,
        "--theme-win": theme.winColor,
        "--theme-jackpot": theme.jackpotColor,
      } as React.CSSProperties}
    >
      {/* Bonus announcement overlay */}
      {bonusAnnounce && (
        <div className="slots-bonus-announce">
          <div className="slots-bonus-announce-inner">
            <div className="slots-bonus-announce-title">🎯 {getHuntName(bonusAnnounce.tier)}</div>
            <div className="slots-bonus-announce-emoji">{bonusAnnounce.emoji}</div>
            <div className="slots-bonus-announce-info">
              hunt every {bonusAnnounce.emoji} for {bonusAnnounce.multiplier}x per hit
            </div>
            <div className="slots-bonus-announce-spins">
              <LuckySpinCounter target={bonusAnnounce.spins_total} /> spins
            </div>
          </div>
        </div>
      )}

      {/* Bonus complete overlay */}
      {bonusComplete && (
        <div className="slots-bonus-complete">
          <div className="slots-bonus-complete-inner">
            <div className="slots-bonus-complete-title">{getHuntName(bonusComplete.tier)} OVER</div>
            <div className="slots-bonus-complete-emoji">{bonusComplete.emoji}</div>
            <div className="slots-bonus-complete-total">+{fmtBonusPayout(bonusComplete)}</div>
            <div className="slots-bonus-complete-sub">total bonus payout</div>
          </div>
        </div>
      )}

      {/* Free spins banner */}
      {!bonus && (isFreeSpin || freeSpinsRemaining > 0) && (
        <div className="slots-freespin-banner">
          {theme.symbolMap[theme.scatter]} FREE SPIN{freeSpinsRemaining > 1 ? `S: ${freeSpinsRemaining}` : freeSpinsRemaining === 1 ? ": LAST ONE" : ""}
        </div>
      )}

      {/* Bonus hunt banner */}
      {bonus && (
        <div className="slots-bonus-banner">
          <span className="slots-bonus-banner-emoji">{bonus.emoji}</span>
          <span className="slots-bonus-banner-label">{getHuntName(bonus.tier)}</span>
          <span className="slots-bonus-banner-progress">{bonus.spins_total - bonus.spins_remaining}/{bonus.spins_total}</span>
          <span className="slots-bonus-banner-payout">+{fmtBonusPayout(bonus)}</span>
        </div>
      )}

      {/* 3x3 grid */}
      <div className="slots-grid-window">
        <div className="slots-grid">
          {[0, 1, 2].map(col => (
            <div key={col} className="slots-col">
              {[0, 1, 2].map(row => {
                const sym = displayGrid[col]?.[row] ?? theme.symbols[3]!;
                const isWinCell = winCells.has(`${col},${row}`);
                const isHuntHit = huntHitCells.has(`${col},${row}`);
                const isHuntTarget = bonus && sym === bonus.symbol && phase === "result";
                const colPhase = colPhases[col];
                const cellClass = [
                  "slots-cell",
                  colPhase === "spinning" ? "slots-cell-spin" : "",
                  colPhase === "stopping" ? "slots-cell-land" : "",
                  isWinCell ? "slots-cell-win" : "",
                  isWinCell && hasJackpot ? "slots-cell-jackpot" : "",
                  isHuntHit ? "slots-cell-hunt" : "",
                  isHuntTarget ? "slots-cell-hunt-target" : "",
                ].filter(Boolean).join(" ");

                return (
                  <div key={row} className={cellClass}>
                    <span className="slots-cell-sym">{theme.symbolMap[sym] ?? "?"}</span>
                    {/* Hunt hit floater */}
                    {isHuntHit && bonus && (
                      <span className="slots-hunt-hit-float">+{bonus.multiplier}x</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Payline SVG overlay */}
        {winLines.length > 0 && (
          <svg className="slots-lines-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            {winLines.map(lineIdx => {
              const cells = PAYLINE_CELLS[lineIdx]!;
              const points = cells.map(([c, r]) => `${colX[c]},${rowY[r]}`).join(" ");
              const color = LINE_COLORS[lineIdx] ?? "#fff";
              return (
                <g key={lineIdx}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.7"
                    className="slots-line-glow"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/* Row markers */}
        <div className="slots-row-markers">
          <div className="slots-row-mark" style={{ top: "4px" }}>-</div>
          <div className="slots-row-mark slots-row-mark-mid" style={{ top: "calc(33.3% + 2px)" }}>-</div>
          <div className="slots-row-mark" style={{ top: "calc(66.6%)" }}>-</div>
        </div>

        {/* Message overlay bubble */}
        {showOverlay && message && !busy && (
          <div className={`slots-msg-overlay slots-msg-overlay-${messageType}`}>
            <div className="slots-msg-bubble">
              <div className="slots-msg-text">{message}</div>
              {totalPayout > 0 && (
                <div className="slots-msg-payout">+{isNB ? fmtNB(totalPayout) : fmtMB(totalPayout)}</div>
              )}
            </div>
          </div>
        )}

        {/* Screen flash */}
        {showFlash && (
          <div className={`slots-screen-flash slots-screen-flash-${showFlash}`} />
        )}
      </div>

      {/* Particles */}
      {particles.length > 0 && (
        <div className="slots-particles" aria-hidden="true">
          {particles.map(p => (
            <span
              key={p.id}
              className="slots-particle"
              style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${p.delay}s` }}
            >
              {p.char}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
