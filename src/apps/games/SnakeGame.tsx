import { useState, useEffect, useCallback, useRef } from "react";

interface SnakeGameProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

type Direction = "up" | "down" | "left" | "right";
type Pos = [number, number];

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

export function SnakeGame({ onGameOver, onBack }: SnakeGameProps) {
  const [snake, setSnake] = useState<Pos[]>([[10, 10]]);
  const [food, setFood] = useState<Pos>([5, 5]);
  const [direction, setDirection] = useState<Direction>("right");
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");

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

  useEffect(() => {
    if (!started || gameOver) return;

    const speed = Math.max(MIN_SPEED, INITIAL_SPEED - scoreRef.current * SPEED_STEP);

    const timer = setInterval(() => {
      if (gameOverRef.current) return;

      // Apply queued direction
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
        onGameOver(scoreRef.current, { cause: "wall", length: currentSnake.length });
        return;
      }

      // Self collision
      if (currentSnake.some(([r, c]) => r === newHead[0] && c === newHead[1])) {
        gameOverRef.current = true;
        setGameOver(true);
        setDeathMsg(randomDeathMessage());
        onGameOver(scoreRef.current, { cause: "self", length: currentSnake.length });
        return;
      }

      const currentFood = foodRef.current;
      const ate = newHead[0] === currentFood[0] && newHead[1] === currentFood[1];
      const newSnake: Pos[] = [newHead, ...currentSnake];
      if (!ate) newSnake.pop();

      snakeRef.current = newSnake;
      setSnake([...newSnake]);
      setDirection(dirRef.current);

      if (ate) {
        scoreRef.current += 1;
        setScore(scoreRef.current);
        const newFood = spawnFood(newSnake);
        foodRef.current = newFood;
        setFood(newFood);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [started, gameOver, score, onGameOver, spawnFood]);

  const speed = Math.max(MIN_SPEED, INITIAL_SPEED - score * SPEED_STEP);

  return (
    <div className="games-container">
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">SNAKE</span>
        <span className="games-hud-score">score: {score}</span>
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

      <div className="snake-grid">
        {Array.from({ length: GRID }, (_, r) => (
          <div key={r} className="snake-row">
            {Array.from({ length: GRID }, (_, c) => {
              const isHead = snake[0]?.[0] === r && snake[0]?.[1] === c;
              const isBody = !isHead && snake.some(([sr, sc]) => sr === r && sc === c);
              const isFood = food[0] === r && food[1] === c;
              return (
                <div
                  key={c}
                  className={`snake-cell${isHead ? " snake-head" : ""}${isBody ? " snake-body" : ""}${isFood ? " snake-food" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
