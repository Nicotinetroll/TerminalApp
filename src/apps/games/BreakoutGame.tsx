import { useState, useEffect, useCallback, useRef } from "react";
import { sfx } from "./sounds";

interface BreakoutGameProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

const COLS = 24;
const ROWS = 20;
const PADDLE_ROW = ROWS - 1;
const PADDLE_WIDTH = 5;
const BRICK_ROWS = 4;
const BRICK_START_ROW = 2;
const BRICK_START_COL = 2;
const BRICK_COLS = 20;
const TICK = 80;

// Points per brick row (top rows worth more)
const ROW_POINTS = [40, 30, 20, 10];

interface Brick {
  row: number;
  col: number;
  points: number;
  colorIdx: number;
  alive: boolean;
}

interface Ball {
  row: number;
  col: number;
  dr: number;
  dc: number;
}

const DEATH_MESSAGES = [
  "you had ONE ball. and you lost it.",
  "the bricks are still standing. like your failures.",
  "paddle? more like saddle. cause you got ridden.",
  "you couldn't break a KitKat with those reflexes.",
  "the bricks send their thanks for the free entertainment.",
  "that ball had more direction in life than you.",
  "congratulations, you played yourself.",
  "even pong paddles are embarrassed for you.",
  "404: skill not found.",
  "your paddle is filing for divorce.",
  "the ball left you on read.",
  "the bricks are throwing a party rn.",
  "breakout? more like breakdown.",
  "you break hearts, not bricks.",
];

function randomDeathMessage(): string {
  return DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)]!;
}

const ROW_INDICES = Array.from({ length: ROWS }, (_, i) => i);
const COL_INDICES = Array.from({ length: COLS }, (_, i) => i);

let popupIdCounter = 0;

function createBricks(): Brick[] {
  const bricks: Brick[] = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      bricks.push({
        row: BRICK_START_ROW + r,
        col: BRICK_START_COL + c,
        points: ROW_POINTS[r] ?? 10,
        colorIdx: r,
        alive: true,
      });
    }
  }
  return bricks;
}

export function BreakoutGame({ onGameOver, onBack }: BreakoutGameProps) {
  const [paddleCol, setPaddleCol] = useState(Math.floor((COLS - PADDLE_WIDTH) / 2));
  const [ball, setBall] = useState<Ball>({ row: ROWS - 3, col: Math.floor(COLS / 2), dr: -1, dc: 1 });
  const [bricks, setBricks] = useState<Brick[]>(createBricks);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");
  const [shaking, setShaking] = useState(false);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const [wave, setWave] = useState(1);

  const paddleColRef = useRef(Math.floor((COLS - PADDLE_WIDTH) / 2));
  const ballRef = useRef<Ball>({ row: ROWS - 3, col: Math.floor(COLS / 2), dr: -1, dc: 1 });
  const bricksRef = useRef<Brick[]>(createBricks());
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const waveRef = useRef(1);
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
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
      bricks_broken: scoreRef.current,
      waves_cleared: waveRef.current - 1,
      lives_left: 0,
    });
  }, [triggerShake]);

  const resetBall = useCallback(() => {
    const b: Ball = {
      row: ROWS - 3,
      col: paddleColRef.current + Math.floor(PADDLE_WIDTH / 2),
      dr: -1,
      dc: Math.random() > 0.5 ? 1 : -1,
    };
    ballRef.current = b;
    setBall({ ...b });
    startedRef.current = false;
    setStarted(false);
  }, []);

  const spawnWave = useCallback(() => {
    waveRef.current += 1;
    setWave(waveRef.current);
    const fresh = createBricks();
    bricksRef.current = fresh;
    setBricks([...fresh]);
    resetBall();
  }, [resetBall]);

  // Game tick
  useEffect(() => {
    if (!started || gameOver) return;

    const interval = setInterval(() => {
      if (gameOverRef.current || !startedRef.current) return;

      const b = { ...ballRef.current };
      const currentBricks = bricksRef.current;
      let addedScore = 0;

      // Step through each cell the ball passes (handles dc=±2 tunneling)
      const steps = Math.max(Math.abs(b.dr), Math.abs(b.dc));
      const stepDr = b.dr / steps;
      const stepDc = b.dc / steps;

      for (let s = 0; s < steps; s++) {
        const nr = Math.round(b.row + stepDr);
        const nc = Math.round(b.col + stepDc);

        // Wall bounces (left/right)
        if (nc < 0 || nc >= COLS) {
          b.dc *= -1;
          b.col = nc < 0 ? 0 : COLS - 1;
          b.row = nr;
          continue;
        }

        // Ceiling bounce
        if (nr < 0) {
          b.dr = Math.abs(b.dr); // always go down
          b.row = 0;
          b.col = nc;
          continue;
        }

        // Ball fell below paddle
        if (nr > PADDLE_ROW) {
          livesRef.current -= 1;
          setLives(livesRef.current);
          sfx.boom();
          triggerShake();
          if (livesRef.current <= 0) {
            die();
            return;
          }
          resetBall();
          return;
        }

        // Paddle bounce — check before moving into paddle row
        const pCol = paddleColRef.current;
        if (nr === PADDLE_ROW && nc >= pCol && nc < pCol + PADDLE_WIDTH) {
          b.dr = -1;
          // Angle based on where ball hits paddle
          const hitPos = (nc - pCol) / (PADDLE_WIDTH - 1); // 0..1
          if (hitPos < 0.2) b.dc = -2;
          else if (hitPos < 0.4) b.dc = -1;
          else if (hitPos > 0.8) b.dc = 2;
          else if (hitPos > 0.6) b.dc = 1;
          else b.dc = b.dc > 0 ? 1 : -1;
          b.row = PADDLE_ROW - 1;
          b.col = nc;
          sfx.click();
          break; // stop stepping, bounced
        }

        // Brick collision at this step
        let hitBrick = false;
        for (const brick of currentBricks) {
          if (!brick.alive) continue;
          if (nr === brick.row && nc === brick.col) {
            brick.alive = false;
            addedScore += brick.points;
            b.dr *= -1;
            hitBrick = true;
            sfx.boom();
            break;
          }
        }

        b.row = nr;
        b.col = nc;
        if (hitBrick) break; // stop stepping, bounced off brick
      }

      // Clamp final position
      b.col = Math.max(0, Math.min(COLS - 1, b.col));
      b.row = Math.max(0, b.row);

      if (addedScore > 0) {
        scoreRef.current += addedScore;
        setScore(scoreRef.current);
        setScoreFlash(true);
        setTimeout(() => setScoreFlash(false), 200);
        const id = popupIdCounter++;
        setPopups((prev) => [...prev, { id, text: `+${addedScore}` }]);
        setTimeout(() => setPopups((prev) => prev.filter((p) => p.id !== id)), 600);
      }

      // Check if all bricks destroyed
      if (currentBricks.every((brick) => !brick.alive)) {
        spawnWave();
        return;
      }

      ballRef.current = b;
      setBall({ ...b });
      setBricks([...currentBricks]);
    }, TICK);

    return () => clearInterval(interval);
  }, [started, gameOver, die, resetBall, spawnWave, triggerShake]);

  const movePlayer = useCallback((dir: -1 | 1) => {
    if (gameOverRef.current) return;
    const next = paddleColRef.current + dir;
    if (next < 0 || next + PADDLE_WIDTH > COLS) return;
    paddleColRef.current = next;
    setPaddleCol(next);
  }, []);

  const startGame = useCallback(() => {
    if (gameOverRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
  }, []);

  // Hold-key tracking for smooth movement
  const heldKeys = useRef(new Set<string>());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("left"); }
      if (["ArrowRight", "d", "D"].includes(e.key)) { e.preventDefault(); heldKeys.current.add("right"); }
      if (e.key === " ") { e.preventDefault(); startGame(); }
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) heldKeys.current.delete("left");
      if (["ArrowRight", "d", "D"].includes(e.key)) heldKeys.current.delete("right");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [startGame]);

  useEffect(() => {
    if (gameOver) return;
    const iv = setInterval(() => {
      if (heldKeys.current.has("left")) movePlayer(-1);
      else if (heldKeys.current.has("right")) movePlayer(1);
    }, 40);
    return () => clearInterval(iv);
  }, [gameOver, movePlayer]);

  // Touch: tap left/right to move, tap center to launch
  const handleGridClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const third = rect.width / 3;
      if (x < third) movePlayer(-1);
      else if (x > third * 2) movePlayer(1);
      else startGame();
    },
    [movePlayer, startGame]
  );

  // Build lookup sets
  const paddleSet = new Set<string>();
  for (let i = 0; i < PADDLE_WIDTH; i++) {
    paddleSet.add(`${PADDLE_ROW},${paddleCol + i}`);
  }

  const brickMap = new Map<string, number>();
  for (const brick of bricks) {
    if (brick.alive) {
      brickMap.set(`${brick.row},${brick.col}`, brick.colorIdx);
    }
  }

  const intensity = Math.min(score / 500, 1);
  const livesStr = "♥".repeat(lives) + "♡".repeat(3 - lives);

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
        <span className="games-hud-title">BREAK SHIT</span>
        <span className={`games-hud-score${scoreFlash ? " games-score-flash" : ""}`}>
          score: {score}
          {popups.map((p) => (
            <span key={p.id} className="games-score-popup">{p.text}</span>
          ))}
        </span>
        <span className="games-hud-info">
          {livesStr} · wave {wave}
        </span>
      </div>

      {!started && !gameOver && (
        <div className="games-start-overlay">
          <div className="games-start-text">A/D to move · SPACE to launch</div>
          <div className="games-start-sub">
            break every last brick. channel your inner rage. therapy is expensive.
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

      <div className="breakout-grid" onClick={handleGridClick}>
        {ROW_INDICES.map((r) => (
          <div key={r} className="breakout-row">
            {COL_INDICES.map((c) => {
              const key = `${r},${c}`;
              const isPaddle = paddleSet.has(key);
              const isBall = ball.row === r && ball.col === c;
              const brickColor = brickMap.get(key);
              const isBrick = brickColor !== undefined;
              return (
                <div
                  key={c}
                  className={`breakout-cell${isPaddle ? " breakout-paddle" : ""}${isBall ? " breakout-ball" : ""}${isBrick ? ` breakout-brick breakout-brick-${brickColor}` : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="games-hint">A/D or ←/→ to move · SPACE to launch · tap on mobile</div>
    </div>
  );
}
