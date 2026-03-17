import { useState, useEffect, useCallback, useRef } from "react";
import { sfx } from "./sounds";

interface InvadersGameProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

const COLS = 24;
const ROWS = 20;
const PLAYER_ROW = ROWS - 2;
const ALIEN_ROWS = 5;
const ALIEN_COLS = 10;
const ALIEN_START_ROW = 2;
const ALIEN_START_COL = 2;
const INITIAL_TICK = 500;
const MIN_TICK = 100;
const BULLET_TICK = 60;
const ENEMY_FIRE_CHANCE = 0.015;

// Points per alien row (top rows worth more, classic style)
const ROW_POINTS = [50, 40, 30, 20, 10];

interface Alien {
  row: number;
  col: number;
  points: number;
  alive: boolean;
}

interface Bullet {
  row: number;
  col: number;
  dir: -1 | 1; // -1 = up (player), 1 = down (enemy)
}

const DEATH_MESSAGES = [
  "the aliens send their regards.",
  "you got probed. in the bad way.",
  "earth is cooked. thanks to you.",
  "the mothership sends its condolences.",
  "even the aliens felt bad for you.",
  "intergalactic skill issue.",
  "houston, we have a massive L.",
  "they didn't come in peace. neither did you. you both lost.",
  "space force rejected your application.",
  "the void stared back. and shot you.",
  "your K/D is embarrassing even for a human.",
  "alien twitter is laughing at you rn.",
  "you made humanity look bad. impressive.",
  "the federation regrets to inform you: you suck.",
];

function randomDeathMessage(): string {
  return DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)]!;
}

const ROW_INDICES = Array.from({ length: ROWS }, (_, i) => i);
const COL_INDICES = Array.from({ length: COLS }, (_, i) => i);

let popupIdCounter = 0;

function createAliens(): Alien[] {
  const aliens: Alien[] = [];
  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      aliens.push({
        row: ALIEN_START_ROW + r,
        col: ALIEN_START_COL + c * 2,
        points: ROW_POINTS[r] ?? 10,
        alive: true,
      });
    }
  }
  return aliens;
}

export function InvadersGame({ onGameOver, onBack }: InvadersGameProps) {
  const [playerCol, setPlayerCol] = useState(Math.floor(COLS / 2));
  const [aliens, setAliens] = useState<Alien[]>(createAliens);
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");
  const [shaking, setShaking] = useState(false);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);

  const playerColRef = useRef(Math.floor(COLS / 2));
  const aliensRef = useRef<Alien[]>(createAliens());
  const bulletsRef = useRef<Bullet[]>([]);
  const scoreRef = useRef(0);
  const waveRef = useRef(1);
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
  const alienDirRef = useRef<1 | -1>(1);
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }, []);

  const die = useCallback(() => {
    gameOverRef.current = true;
    setGameOver(true);
    setDeathMsg(randomDeathMessage());
    setFlashing(true);
    setTimeout(() => setFlashing(false), 150);
    setTimeout(() => triggerShake(), 150);
    sfx.death();
    onGameOverRef.current(scoreRef.current, {
      aliens_killed: scoreRef.current,
      waves_survived: waveRef.current,
    });
  }, [triggerShake]);

  const spawnWave = useCallback(() => {
    waveRef.current += 1;
    setWave(waveRef.current);
    alienDirRef.current = 1;
    const fresh = createAliens();
    aliensRef.current = fresh;
    setAliens([...fresh]);
    // Clear all bullets so stray enemy shots don't kill on new wave
    bulletsRef.current = [];
    setBullets([]);
  }, []);

  // Alien movement tick
  useEffect(() => {
    if (!started || gameOver) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (gameOverRef.current) return;

      const currentAliens = aliensRef.current;
      const alive = currentAliens.filter((a) => a.alive);

      if (alive.length === 0) {
        spawnWave();
        const speed = Math.max(MIN_TICK, INITIAL_TICK - (waveRef.current - 1) * 40);
        timeoutId = setTimeout(tick, speed);
        return;
      }

      // Check if aliens need to reverse & drop
      const dir = alienDirRef.current;
      const willHitWall = alive.some((a) => {
        const next = a.col + dir;
        return next < 0 || next >= COLS;
      });

      if (willHitWall) {
        // Drop down + reverse
        alienDirRef.current = (dir * -1) as 1 | -1;
        for (const a of currentAliens) {
          if (a.alive) a.row += 1;
        }
      } else {
        // Move horizontally
        for (const a of currentAliens) {
          if (a.alive) a.col += dir;
        }
      }

      // Check if any alien reached player row
      if (alive.some((a) => a.row >= PLAYER_ROW)) {
        die();
        return;
      }

      // Enemy fire — random bottom-row aliens shoot
      const colGroups = new Map<number, Alien>();
      for (const a of alive) {
        const existing = colGroups.get(a.col);
        if (!existing || a.row > existing.row) {
          colGroups.set(a.col, a);
        }
      }
      for (const [, bottom] of colGroups) {
        if (Math.random() < ENEMY_FIRE_CHANCE) {
          bulletsRef.current.push({ row: bottom.row + 1, col: bottom.col, dir: 1 });
        }
      }

      setAliens([...currentAliens]);
      setBullets([...bulletsRef.current]);

      // Speed up based on how many killed + wave
      const killRatio = 1 - alive.length / (ALIEN_ROWS * ALIEN_COLS);
      const waveBonus = (waveRef.current - 1) * 40;
      const speed = Math.max(
        MIN_TICK,
        INITIAL_TICK - Math.floor(killRatio * 300) - waveBonus
      );
      timeoutId = setTimeout(tick, speed);
    };

    const speed = Math.max(MIN_TICK, INITIAL_TICK - (waveRef.current - 1) * 40);
    timeoutId = setTimeout(tick, speed);
    return () => clearTimeout(timeoutId);
  }, [started, gameOver, die, spawnWave]);

  // Bullet movement tick (faster than aliens)
  useEffect(() => {
    if (!started || gameOver) return;

    const interval = setInterval(() => {
      if (gameOverRef.current) return;

      const currentBullets = bulletsRef.current;
      const currentAliens = aliensRef.current;
      const pCol = playerColRef.current;
      let addedScore = 0;

      // Move bullets
      for (const b of currentBullets) {
        b.row += b.dir;
      }

      // Check player bullet hits on aliens
      const survivingBullets: Bullet[] = [];
      for (const b of currentBullets) {
        if (b.row < 0 || b.row >= ROWS) continue; // off screen

        let hit = false;

        if (b.dir === -1) {
          // Player bullet — check alien hits
          for (const a of currentAliens) {
            if (a.alive && a.row === b.row && a.col === b.col) {
              a.alive = false;
              addedScore += a.points;
              hit = true;
              sfx.boom();
              break;
            }
          }
        } else {
          // Enemy bullet — check player hit
          if (b.row === PLAYER_ROW && b.col === pCol) {
            die();
            return;
          }
        }

        if (!hit) {
          survivingBullets.push(b);
        }
      }

      if (addedScore > 0) {
        scoreRef.current += addedScore;
        setScore(scoreRef.current);
        setScoreFlash(true);
        setTimeout(() => setScoreFlash(false), 200);
        const id = popupIdCounter++;
        setPopups((prev) => [...prev, { id, text: `+${addedScore}` }]);
        setTimeout(
          () => setPopups((prev) => prev.filter((p) => p.id !== id)),
          600
        );
      }

      bulletsRef.current = survivingBullets;
      setAliens([...currentAliens]);
      setBullets([...survivingBullets]);
    }, BULLET_TICK);

    return () => clearInterval(interval);
  }, [started, gameOver, die]);

  const shoot = useCallback(() => {
    if (gameOverRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
    // Only 1 player bullet on screen at a time
    const hasPlayerBullet = bulletsRef.current.some((b) => b.dir === -1);
    if (hasPlayerBullet) return;

    bulletsRef.current.push({
      row: PLAYER_ROW - 1,
      col: playerColRef.current,
      dir: -1,
    });
    setBullets([...bulletsRef.current]);
    sfx.shoot();
  }, []);

  const movePlayer = useCallback((dir: -1 | 1) => {
    if (gameOverRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
    const next = playerColRef.current + dir;
    if (next < 0 || next >= COLS) return;
    playerColRef.current = next;
    setPlayerCol(next);
  }, []);

  // Hold-key tracking for smooth movement
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("left"); }
      if (["ArrowRight", "d", "D"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("right"); }
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") { e.preventDefault(); shoot(); }
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) heldKeys.current.delete("left");
      if (["ArrowRight", "d", "D"].includes(e.key)) heldKeys.current.delete("right");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [shoot]);

  useEffect(() => {
    if (gameOver) return;
    const iv = setInterval(() => {
      if (heldKeys.current.has("left")) movePlayer(-1);
      else if (heldKeys.current.has("right")) movePlayer(1);
    }, 50);
    return () => clearInterval(iv);
  }, [gameOver, movePlayer]);

  // Touch controls
  const handleGridClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const half = rect.width / 2;
      if (x < half) {
        movePlayer(-1);
      } else {
        movePlayer(1);
      }
      shoot();
    },
    [movePlayer, shoot]
  );

  // Build lookup sets for rendering
  const alienSet = new Map<string, number>(); // key -> row index for color
  for (const a of aliens) {
    if (a.alive) alienSet.set(`${a.row},${a.col}`, a.points);
  }

  const playerBulletSet = new Set<string>();
  const enemyBulletSet = new Set<string>();
  for (const b of bullets) {
    if (b.dir === -1) playerBulletSet.add(`${b.row},${b.col}`);
    else enemyBulletSet.add(`${b.row},${b.col}`);
  }

  const aliensAlive = aliens.filter((a) => a.alive).length;
  const intensity = Math.min(score / 500, 1);

  return (
    <div
      className={`games-container${shaking ? " games-shake" : ""}`}
      style={{ "--intensity": intensity } as React.CSSProperties}
    >
      {flashing && <div className="games-death-flash" />}
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>
          &lt; back
        </button>
        <span className="games-hud-title">ALIEN PURGE</span>
        <span
          className={`games-hud-score${scoreFlash ? " games-score-flash" : ""}`}
        >
          score: {score}
          {popups.map((p) => (
            <span key={p.id} className="games-score-popup">
              {p.text}
            </span>
          ))}
        </span>
        <span className="games-hud-info">
          wave {wave} · {aliensAlive} left
        </span>
      </div>

      {!started && !gameOver && (
        <div className="games-start-overlay">
          <div className="games-start-text">
            A/D to move · SPACE to shoot
          </div>
          <div className="games-start-sub">
            they came in peace. you didn't. purge them all.
          </div>
        </div>
      )}

      {gameOver && (
        <div className="games-over-overlay">
          <div className="games-over-title">GAME OVER</div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{deathMsg}</div>
        </div>
      )}

      <div className="invaders-grid" onClick={handleGridClick}>
        {ROW_INDICES.map((r) => (
          <div key={r} className="invaders-row">
            {COL_INDICES.map((c) => {
              const key = `${r},${c}`;
              const isPlayer = r === PLAYER_ROW && c === playerCol;
              const alienPoints = alienSet.get(key);
              const isAlien = alienPoints !== undefined;
              const isPlayerBullet = playerBulletSet.has(key);
              const isEnemyBullet = enemyBulletSet.has(key);
              const alienTier =
                alienPoints === 50
                  ? 5
                  : alienPoints === 40
                    ? 4
                    : alienPoints === 30
                      ? 3
                      : alienPoints === 20
                        ? 2
                        : 1;
              return (
                <div
                  key={c}
                  className={`invaders-cell${isPlayer ? " invaders-player" : ""}${isAlien ? ` invaders-alien invaders-alien-${alienTier}` : ""}${isPlayerBullet ? " invaders-bullet-up" : ""}${isEnemyBullet ? " invaders-bullet-down" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="games-hint">
        A/D or ←/→ to move · SPACE/W/↑ to shoot · tap to play on mobile
      </div>
    </div>
  );
}
