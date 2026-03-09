import { useState, useEffect, useCallback, useRef } from "react";
import { sfx } from "./sounds";

interface SnakeGameProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

type Direction = "up" | "down" | "left" | "right";
type Pos = [number, number];

interface Particle {
  id: number;
  row: number;
  col: number;
  dx: number;
  dy: number;
}

const GRID = 20;
const INITIAL_SPEED = 200;
const MIN_SPEED = 80;
const SPEED_STEP = 5;

const DEATH_MESSAGES = [
  "skill issue.",
  "you played yourself.",
  "rip bozo.",
  "the snake died of embarrassment.",
  "did you even try?",
  "my grandma plays better. she's dead.",
  "uninstall your keyboard.",
  "that was painful to watch.",
  "the snake committed suicide rather than be controlled by you.",
  "have you considered tic-tac-toe?",
  "even the food was rooting against you.",
  "F in chat.",
  "you zigged when you should've zagged.",
  "natural selection at work.",
];

function randomDeathMessage(): string {
  return DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)]!;
}

let particleId = 0;
let popupId = 0;

export function SnakeGame({ onGameOver, onBack }: SnakeGameProps) {
  const [snake, setSnake] = useState<Pos[]>([[10, 10]]);
  const [food, setFood] = useState<Pos>([5, 5]);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");
  const [shaking, setShaking] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);

  const dirRef = useRef<Direction>("right");
  const snakeRef = useRef<Pos[]>([[10, 10]]);
  const foodRef = useRef<Pos>([5, 5]);
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const queuedDir = useRef<Direction | null>(null);

  const spawnFood = useCallback((snakeBody: Pos[]): Pos => {
    const occupied = new Set(snakeBody.map(([r, c]) => `${r},${c}`));
    let pos: Pos;
    do {
      pos = [Math.floor(Math.random() * GRID), Math.floor(Math.random() * GRID)];
    } while (occupied.has(`${pos[0]},${pos[1]}`));
    return pos;
  }, []);

  const spawnParticles = useCallback((row: number, col: number) => {
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    const newParticles: Particle[] = dirs.map(([dy, dx]) => ({
      id: particleId++,
      row, col,
      dx: dx!,
      dy: dy!,
    }));
    setParticles(newParticles);
    setTimeout(() => setParticles([]), 500);
  }, []);

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }, []);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (gameOverRef.current) return;

    const keyMap: Record<string, Direction> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right",
      W: "up", S: "down", A: "left", D: "right",
    };

    const newDir = keyMap[e.key];
    if (!newDir) return;
    e.preventDefault();

    if (!started) {
      setStarted(true);
    }

    const opposites: Record<Direction, Direction> = {
      up: "down", down: "up", left: "right", right: "left",
    };

    if (opposites[newDir] !== dirRef.current) {
      queuedDir.current = newDir;
    }
  }, [started]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // Game loop: recursive setTimeout — speed adjusts naturally
  useEffect(() => {
    if (!started || gameOver) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (gameOverRef.current) return;

      if (queuedDir.current) {
        dirRef.current = queuedDir.current;
        queuedDir.current = null;
      }

      const currentSnake = snakeRef.current;
      const head = currentSnake[0]!;
      const dir = dirRef.current;

      let newHead: Pos;
      switch (dir) {
        case "up": newHead = [head[0] - 1, head[1]]; break;
        case "down": newHead = [head[0] + 1, head[1]]; break;
        case "left": newHead = [head[0], head[1] - 1]; break;
        case "right": newHead = [head[0], head[1] + 1]; break;
      }

      // Wall collision
      if (newHead[0] < 0 || newHead[0] >= GRID || newHead[1] < 0 || newHead[1] >= GRID) {
        gameOverRef.current = true;
        setGameOver(true);
        setDeathMsg(randomDeathMessage());
        setFlashing(true);
        setTimeout(() => setFlashing(false), 150);
        setTimeout(() => triggerShake(), 150);
        sfx.death();
        onGameOver(scoreRef.current, { cause: "wall", length: currentSnake.length });
        return;
      }

      // Self collision
      if (currentSnake.some(([r, c]) => r === newHead[0] && c === newHead[1])) {
        gameOverRef.current = true;
        setGameOver(true);
        setDeathMsg(randomDeathMessage());
        setFlashing(true);
        setTimeout(() => setFlashing(false), 150);
        setTimeout(() => triggerShake(), 150);
        sfx.death();
        onGameOver(scoreRef.current, { cause: "self", length: currentSnake.length });
        return;
      }

      const currentFood = foodRef.current;
      const ate = newHead[0] === currentFood[0] && newHead[1] === currentFood[1];
      const newSnake: Pos[] = [newHead, ...currentSnake];
      if (!ate) newSnake.pop();

      snakeRef.current = newSnake;
      setSnake([...newSnake]);

      if (ate) {
        scoreRef.current += 1;
        setScore(scoreRef.current);
        spawnParticles(currentFood[0], currentFood[1]);
        sfx.eat();
        setScoreFlash(true);
        setTimeout(() => setScoreFlash(false), 200);
        const id = popupId++;
        setPopups(prev => [...prev, { id, text: "+1" }]);
        setTimeout(() => setPopups(prev => prev.filter(p => p.id !== id)), 600);
        const newFood = spawnFood(newSnake);
        foodRef.current = newFood;
        setFood(newFood);
      }

      const speed = Math.max(MIN_SPEED, INITIAL_SPEED - scoreRef.current * SPEED_STEP);
      timeoutId = setTimeout(tick, speed);
    };

    const speed = Math.max(MIN_SPEED, INITIAL_SPEED - scoreRef.current * SPEED_STEP);
    timeoutId = setTimeout(tick, speed);
    return () => clearTimeout(timeoutId);
  }, [started, gameOver, onGameOver, spawnFood, spawnParticles, triggerShake]);

  const speed = Math.max(MIN_SPEED, INITIAL_SPEED - score * SPEED_STEP);

  // Precompute segment distances for glow trail
  const segmentMap = new Map<string, number>();
  snake.forEach(([r, c], i) => {
    segmentMap.set(`${r},${c}`, i);
  });

  const intensity = (INITIAL_SPEED - speed) / (INITIAL_SPEED - MIN_SPEED);
  const isRainbow = score >= 15;

  return (
    <div
      className={`games-container${shaking ? " games-shake" : ""}`}
      style={{ "--intensity": intensity } as React.CSSProperties}
    >
      {flashing && <div className="games-death-flash" />}
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">SNAKE</span>
        <span className={`games-hud-score${scoreFlash ? " games-score-flash" : ""}`}>
          score: {score}
          {popups.map(p => (
            <span key={p.id} className="games-score-popup">{p.text}</span>
          ))}
        </span>
        <span className="games-hud-info">speed: {Math.round((1000 / speed) * 10) / 10}/s</span>
      </div>

      {!started && !gameOver && (
        <div className="games-start-overlay">
          <div className="games-start-text">press WASD or arrow keys to start</div>
          <div className="games-start-sub">don't hit the walls. don't eat yourself. basic survival skills.</div>
        </div>
      )}

      {gameOver && (
        <div className="games-over-overlay">
          <div className="games-over-title">GAME OVER</div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{deathMsg}</div>
        </div>
      )}

      <div className={`snake-grid${isRainbow ? " snake-rainbow" : ""}`}>
        {Array.from({ length: GRID }, (_, r) => (
          <div key={r} className="snake-row">
            {Array.from({ length: GRID }, (_, c) => {
              const isHead = snake[0]?.[0] === r && snake[0]?.[1] === c;
              const segIdx = segmentMap.get(`${r},${c}`);
              const isBody = segIdx !== undefined && segIdx > 0;
              const isFood = food[0] === r && food[1] === c;
              return (
                <div
                  key={c}
                  className={`snake-cell${isHead ? " snake-head" : ""}${isBody ? " snake-body" : ""}${isFood ? " snake-food" : ""}`}
                  data-segment={isBody ? Math.min(segIdx, 5) : undefined}
                  style={isBody && isRainbow ? { "--hue": segIdx * 30 } as React.CSSProperties : undefined}
                />
              );
            })}
          </div>
        ))}
        {particles.map(p => (
          <div
            key={p.id}
            className="snake-particle"
            style={{
              left: `${p.col * 22 + 11}px`,
              top: `${p.row * 22 + 11}px`,
              ["--dx" as string]: p.dx,
              ["--dy" as string]: p.dy,
            }}
          />
        ))}
      </div>
    </div>
  );
}
