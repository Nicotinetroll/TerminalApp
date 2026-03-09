import { useState, useEffect, useCallback, useRef } from "react";
import { sfx } from "./sounds";

interface FlappyBirdProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

const COLS = 28;
const ROWS = 16;
const GRAVITY = 1;
const FLAP_FORCE = -3;
const PIPE_GAP = 5;
const PIPE_WIDTH = 2;
const PIPE_INTERVAL = 12;
const INITIAL_TICK = 140;
const MIN_TICK = 85;
const BIRD_COL = 5;

interface Pipe {
  id: number;
  col: number;
  gapTop: number;
  scored: boolean;
}

const DEATH_MESSAGES = [
  "you flew like a brick.",
  "flap harder next time, dumbass.",
  "gravity: 1, you: 0.",
  "even pigeons do better.",
  "you made icarus look competent.",
  "the pipes send their regards.",
  "skill issue (bird edition).",
  "that bird had a family.",
  "uninstall your spacebar.",
  "ctrl+w for flight lessons.",
  "the ground was inevitable.",
  "you clipped your own wings, genius.",
  "ornithology isn't your strong suit.",
  "bird.exe has stopped working.",
];

function randomDeathMessage(): string {
  return DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)]!;
}

const ROW_INDICES = Array.from({ length: ROWS }, (_, i) => i);
const COL_INDICES = Array.from({ length: COLS }, (_, i) => i);

let pipeIdCounter = 0;
let popupId = 0;

export function FlappyBird({ onGameOver, onBack }: FlappyBirdProps) {
  const [birdRow, setBirdRow] = useState(8);
  const [pipes, setPipes] = useState<Pipe[]>([]);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);
  const [deathMsg, setDeathMsg] = useState("");
  const [shaking, setShaking] = useState(false);
  const [scoreFlash, setScoreFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);

  const birdRowRef = useRef(8);
  const birdVelRef = useRef(0);
  const pipesRef = useRef<Pipe[]>([]);
  const scoreRef = useRef(0);
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
    onGameOverRef.current(scoreRef.current, { pipes_passed: scoreRef.current });
  }, [triggerShake]);

  const gameTick = useCallback(() => {
    const newVel = birdVelRef.current + GRAVITY;
    const newRow = Math.round(birdRowRef.current + newVel);

    if (newRow < 0 || newRow >= ROWS) {
      die();
      return;
    }

    const currentPipes = pipesRef.current;
    let i = 0;
    while (i < currentPipes.length) {
      currentPipes[i]!.col -= 1;
      if (currentPipes[i]!.col < -PIPE_WIDTH) {
        currentPipes.splice(i, 1);
      } else {
        i++;
      }
    }

    const lastPipe = currentPipes[currentPipes.length - 1];
    if (!lastPipe || lastPipe.col <= COLS - PIPE_INTERVAL) {
      const gapTop = 2 + Math.floor(Math.random() * (ROWS - PIPE_GAP - 4));
      currentPipes.push({ id: pipeIdCounter++, col: COLS - 1, gapTop, scored: false });
    }

    let newScore = scoreRef.current;
    for (const pipe of currentPipes) {
      const pipeRight = pipe.col + PIPE_WIDTH - 1;
      if (BIRD_COL >= pipe.col && BIRD_COL <= pipeRight) {
        if (newRow < pipe.gapTop || newRow >= pipe.gapTop + PIPE_GAP) {
          die();
          return;
        }
      }
      if (!pipe.scored && pipeRight < BIRD_COL) {
        pipe.scored = true;
        newScore += 1;
        sfx.pipeScore();
        setScoreFlash(true);
        setTimeout(() => setScoreFlash(false), 200);
        const id = popupId++;
        setPopups(prev => [...prev, { id, text: "+1" }]);
        setTimeout(() => setPopups(prev => prev.filter(p => p.id !== id)), 600);
      }
    }

    birdRowRef.current = newRow;
    birdVelRef.current = newVel;
    scoreRef.current = newScore;

    setBirdRow(newRow);
    setPipes([...currentPipes]);
    setScore(newScore);
  }, [die]);

  // Game loop: recursive setTimeout — speed adjusts naturally, no dep recreation
  useEffect(() => {
    if (!started || gameOver) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (gameOverRef.current) return;
      gameTick();
      const speed = Math.max(MIN_TICK, INITIAL_TICK - Math.floor(scoreRef.current / 5) * 8);
      timeoutId = setTimeout(tick, speed);
    };

    const speed = Math.max(MIN_TICK, INITIAL_TICK - Math.floor(scoreRef.current / 5) * 8);
    timeoutId = setTimeout(tick, speed);
    return () => clearTimeout(timeoutId);
  }, [started, gameOver, gameTick]);

  const flap = useCallback(() => {
    if (gameOverRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
    birdVelRef.current = FLAP_FORCE;
    sfx.flap();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flap]);

  // Pre-compute pipe cell lookup
  const pipeSet = new Set<string>();
  const pipeEdgeSet = new Set<string>();
  for (const pipe of pipes) {
    for (let r = 0; r < ROWS; r++) {
      if (r < pipe.gapTop || r >= pipe.gapTop + PIPE_GAP) {
        for (let w = 0; w < PIPE_WIDTH; w++) {
          const col = pipe.col + w;
          if (col >= 0 && col < COLS) pipeSet.add(`${r},${col}`);
        }
      }
    }
    // Edge caps (top/bottom of gap)
    for (let w = 0; w < PIPE_WIDTH; w++) {
      const col = pipe.col + w;
      if (col < 0 || col >= COLS) continue;
      if (pipe.gapTop > 0) pipeEdgeSet.add(`${pipe.gapTop - 1},${col}`);
      if (pipe.gapTop + PIPE_GAP < ROWS) pipeEdgeSet.add(`${pipe.gapTop + PIPE_GAP},${col}`);
    }
  }

  const intensity = Math.min(score / 20, 1);

  return (
    <div
      className={`games-container${shaking ? " games-shake" : ""}`}
      style={{ "--intensity": intensity } as React.CSSProperties}
    >
      {flashing && <div className="games-death-flash" />}
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">FLAPPY BIRD</span>
        <span className={`games-hud-score${scoreFlash ? " games-score-flash" : ""}`}>
          score: {score}
          {popups.map(p => (
            <span key={p.id} className="games-score-popup">{p.text}</span>
          ))}
        </span>
      </div>

      {!started && !gameOver && (
        <div className="games-start-overlay">
          <div className="games-start-text">press SPACE / W / click to flap</div>
          <div className="games-start-sub">dodge the pipes. don't hit the floor. it's not rocket science.</div>
        </div>
      )}

      {gameOver && (
        <div className="games-over-overlay">
          <div className="games-over-title">GAME OVER</div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{deathMsg}</div>
        </div>
      )}

      <div className="flappy-grid" onClick={flap}>
        {ROW_INDICES.map(r => (
          <div key={r} className="flappy-row">
            {COL_INDICES.map(c => {
              const isBird = r === birdRow && c === BIRD_COL;
              const key = `${r},${c}`;
              const isPipe = pipeSet.has(key);
              const isEdge = pipeEdgeSet.has(key);
              return (
                <div
                  key={c}
                  className={`flappy-cell${isBird ? " flappy-bird" : ""}${isPipe ? " flappy-pipe" : ""}${isEdge ? " flappy-pipe-edge" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="games-hint">space / W / click to flap</div>
    </div>
  );
}
