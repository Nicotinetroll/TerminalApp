import { useState, useEffect, useCallback, useRef } from "react";
import { sfx } from "./sounds";

interface RacingGameProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

const ROWS = 20;
const COLS = 5;
const PLAYER_ROW = ROWS - 2;
const INITIAL_TICK = 220;
const MIN_TICK = 80;

interface EnemyCar {
  id: number;
  row: number;
  col: number;
}

const DEATH_MESSAGES = [
  "your insurance company called. they dropped you.",
  "that's not how you parallel park.",
  "skill issue on wheels.",
  "you drive like you code — into walls.",
  "even a self-driving car would crash with your luck.",
  "license: revoked. dignity: gone.",
  "the car survived. you didn't.",
  "max verstappen is rolling in his grave (he's alive btw).",
  "that crash was so bad it lowered everyone's FPS.",
  "turn left to go right. wait, that's Cars.",
  "did you confuse the brake with the gas? there is no brake.",
  "you need a bus pass, not a race car.",
  "the guardrail had a family.",
  "bro thought he was playing mario kart.",
];

function randomDeathMessage(): string {
  return DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)]!;
}

const ROW_INDICES = Array.from({ length: ROWS }, (_, i) => i);
const COL_INDICES = Array.from({ length: COLS }, (_, i) => i);

let enemyId = 0;
let popupId = 0;

export function RacingGame({ onGameOver, onBack }: RacingGameProps) {
  const [playerCol, setPlayerCol] = useState(2);
  const [enemies, setEnemies] = useState<EnemyCar[]>([]);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");
  const [shaking, setShaking] = useState(false);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);

  const playerColRef = useRef(2);
  const enemiesRef = useRef<EnemyCar[]>([]);
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
  const tickRef = useRef(0);
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
    onGameOverRef.current(scoreRef.current, { cars_dodged: scoreRef.current });
  }, [triggerShake]);

  const gameTick = useCallback(() => {
    tickRef.current += 1;
    const currentEnemies = enemiesRef.current;

    // Move enemies down
    for (const e of currentEnemies) {
      e.row += 1;
    }

    // Check collisions after move (player + enemy are both 2 rows tall)
    const col = playerColRef.current;
    for (const e of currentEnemies) {
      if (e.col === col && (e.row === PLAYER_ROW || e.row === PLAYER_ROW - 1 || e.row - 1 === PLAYER_ROW || e.row - 1 === PLAYER_ROW - 1)) {
        die();
        return;
      }
    }

    // Score for enemies that passed us
    let scored = 0;
    const alive: EnemyCar[] = [];
    for (const e of currentEnemies) {
      if (e.row >= ROWS) {
        scored++;
      } else {
        alive.push(e);
      }
    }

    // Spawn new enemies — avoid impossible configs (don't block all lanes)
    const spawnRate = Math.max(3, 6 - Math.floor(scoreRef.current / 15));
    if (tickRef.current % spawnRate === 0) {
      // Pick 1-2 lanes to spawn in, but always leave at least 2 lanes open
      const laneCount = scoreRef.current > 30 ? 2 : 1;
      const lanes = new Set<number>();
      while (lanes.size < laneCount) {
        lanes.add(Math.floor(Math.random() * COLS));
      }

      // Ensure we don't spawn on top of a recently spawned car
      for (const lane of lanes) {
        const tooClose = alive.some((e) => e.col === lane && e.row < 3);
        if (!tooClose) {
          alive.push({ id: enemyId++, row: 0, col: lane });
        }
      }
    }

    if (scored > 0) {
      scoreRef.current += scored;
      setScoreFlash(true);
      setTimeout(() => setScoreFlash(false), 200);
      const id = popupId++;
      setPopups((prev) => [...prev, { id, text: `+${scored}` }]);
      setTimeout(() => setPopups((prev) => prev.filter((p) => p.id !== id)), 600);
      sfx.pipeScore();
    }

    enemiesRef.current = alive;
    setEnemies([...alive]);
    setScore(scoreRef.current);
  }, [die]);

  // Game loop
  useEffect(() => {
    if (!started || gameOver) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (gameOverRef.current) return;
      gameTick();
      const speed = Math.max(MIN_TICK, INITIAL_TICK - Math.floor(scoreRef.current / 3) * 5);
      timeoutId = setTimeout(tick, speed);
    };

    const speed = Math.max(MIN_TICK, INITIAL_TICK - Math.floor(scoreRef.current / 3) * 5);
    timeoutId = setTimeout(tick, speed);
    return () => clearTimeout(timeoutId);
  }, [started, gameOver, gameTick]);

  const move = useCallback((dir: -1 | 1) => {
    if (gameOverRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
    const next = playerColRef.current + dir;
    if (next < 0 || next >= COLS) return;

    // Check if moving into an enemy (both cars are 2 rows tall)
    const hitEnemy = enemiesRef.current.some(
      (e) => e.col === next && e.row >= PLAYER_ROW - 1 && e.row <= PLAYER_ROW + 1
    );

    playerColRef.current = next;
    setPlayerCol(next);

    if (hitEnemy) {
      die();
    }
  }, [die]);

  // Hold-key tracking for smooth movement
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("left"); }
      if (["ArrowRight", "d", "D"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("right"); }
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) heldKeys.current.delete("left");
      if (["ArrowRight", "d", "D"].includes(e.key)) heldKeys.current.delete("right");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    if (gameOver) return;
    const iv = setInterval(() => {
      if (heldKeys.current.has("left")) move(-1);
      else if (heldKeys.current.has("right")) move(1);
    }, 60);
    return () => clearInterval(iv);
  }, [gameOver, move]);

  // Touch controls
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? 0;
    const diff = endX - touchStartX.current;
    if (Math.abs(diff) > 20) {
      move(diff > 0 ? 1 : -1);
    }
    touchStartX.current = null;
  }, [move]);

  // Build enemy lookup
  const enemySet = new Set<string>();
  for (const e of enemies) {
    enemySet.add(`${e.row},${e.col}`);
    // Car is 2 rows tall visually
    if (e.row > 0) enemySet.add(`${e.row - 1},${e.col}`);
  }

  const intensity = Math.min(score / 30, 1);

  // Road markings — dashed center lines
  const isRoadMark = (r: number, c: number): boolean => {
    if (c === 0 || c === COLS - 1) return false;
    // Animate: shift based on tick
    return (r + tickRef.current) % 4 === 0;
  };

  return (
    <div
      className={`games-container${shaking ? " games-shake" : ""}`}
      style={{ "--intensity": intensity } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {flashing && <div className="games-death-flash" />}
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">RACING</span>
        <span className={`games-hud-score${scoreFlash ? " games-score-flash" : ""}`}>
          score: {score}
          {popups.map((p) => (
            <span key={p.id} className="games-score-popup">{p.text}</span>
          ))}
        </span>
        <span className="games-hud-info">
          {Math.max(MIN_TICK, INITIAL_TICK - Math.floor(score / 3) * 5)}ms
        </span>
      </div>

      {!started && !gameOver && (
        <div className="games-start-overlay">
          <div className="games-start-text">press A/D or arrow keys to steer</div>
          <div className="games-start-sub">dodge the cars. don't crash. your insurance won't cover this.</div>
        </div>
      )}

      {gameOver && (
        <div className="games-over-overlay">
          <div className="games-over-title">GAME OVER</div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{deathMsg}</div>
        </div>
      )}

      <div className="racing-grid">
        {ROW_INDICES.map((r) => (
          <div key={r} className="racing-row">
            {COL_INDICES.map((c) => {
              const isPlayer = r === PLAYER_ROW && c === playerCol;
              const isPlayerTop = r === PLAYER_ROW - 1 && c === playerCol;
              const isEnemy = enemySet.has(`${r},${c}`);
              const isWall = c === 0 || c === COLS - 1;
              const isMark = !isWall && isRoadMark(r, c);
              return (
                <div
                  key={c}
                  className={`racing-cell${isPlayer ? " racing-player" : ""}${isPlayerTop ? " racing-player-top" : ""}${isEnemy ? " racing-enemy" : ""}${isWall ? " racing-wall" : ""}${isMark ? " racing-mark" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="games-hint">A/D or ←/→ to steer · swipe on mobile</div>
    </div>
  );
}
