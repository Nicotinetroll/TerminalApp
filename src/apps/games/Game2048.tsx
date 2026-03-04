import { useState, useEffect, useCallback, useRef } from "react";

interface Game2048Props {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

type Grid = number[][];

function createEmptyGrid(): Grid {
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));
}

function addRandom(grid: Grid): Grid {
  const newGrid = grid.map(row => [...row]);
  const empty: [number, number][] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (newGrid[r]![c] === 0) empty.push([r, c]);
    }
  }
  if (empty.length === 0) return newGrid;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)]!;
  newGrid[r!]![c!] = Math.random() < 0.9 ? 2 : 4;
  return newGrid;
}

function slideRow(row: number[]): { newRow: number[]; points: number } {
  let points = 0;
  const filtered = row.filter(v => v !== 0);
  const merged: number[] = [];
  let i = 0;
  while (i < filtered.length) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const val = filtered[i]! * 2;
      merged.push(val);
      points += val;
      i += 2;
    } else {
      merged.push(filtered[i]!);
      i++;
    }
  }
  while (merged.length < 4) merged.push(0);
  return { newRow: merged, points };
}

function moveLeft(grid: Grid): { grid: Grid; points: number; moved: boolean } {
  let points = 0;
  let moved = false;
  const newGrid = grid.map((row, r) => {
    const { newRow, points: p } = slideRow([...row]);
    points += p;
    if (newRow.some((v, c) => v !== grid[r]![c])) moved = true;
    return newRow;
  });
  return { grid: newGrid, points, moved };
}

function rotateRight(grid: Grid): Grid {
  const n = grid.length;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => grid[n - 1 - c]![r]!)
  );
}

function move(grid: Grid, dir: "left" | "right" | "up" | "down"): { grid: Grid; points: number; moved: boolean } {
  let g = grid.map(r => [...r]);
  let rotations = 0;
  if (dir === "right") rotations = 2;
  else if (dir === "up") rotations = 1;
  else if (dir === "down") rotations = 3;

  for (let i = 0; i < rotations; i++) g = rotateRight(g);
  const result = moveLeft(g);
  let out = result.grid;
  for (let i = 0; i < (4 - rotations) % 4; i++) out = rotateRight(out);
  return { grid: out, points: result.points, moved: result.moved };
}

function canMove(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r]![c] === 0) return true;
      if (c < 3 && grid[r]![c] === grid[r]![c + 1]) return true;
      if (r < 3 && grid[r]![c] === grid[r + 1]![c]) return true;
    }
  }
  return false;
}

function hasWon(grid: Grid): boolean {
  return grid.some(row => row.some(v => v >= 2048));
}

const WIN_MESSAGES = [
  "2048! you actually did it. respect.",
  "winner winner chicken dinner.",
  "big brain energy right here.",
  "you just peaked. it's all downhill from here.",
];

const LOSE_MESSAGES = [
  "no more moves. just like your love life.",
  "board's full. brain's empty.",
  "you tried. that's... something.",
  "git gud.",
  "maybe try tic-tac-toe first?",
  "the tiles have spoken. you're done.",
];

export function Game2048({ onGameOver, onBack }: Game2048Props) {
  const [grid, setGrid] = useState<Grid>(() => addRandom(addRandom(createEmptyGrid())));
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [continueAfterWin, setContinueAfterWin] = useState(false);
  const [endMsg, setEndMsg] = useState("");
  const [newTiles, setNewTiles] = useState<Set<string>>(new Set());

  const gridRef = useRef(grid);
  const scoreRef = useRef(0);
  const gameOverRef = useRef(false);
  const wonRef = useRef(false);
  const continueRef = useRef(false);

  gridRef.current = grid;
  scoreRef.current = score;
  gameOverRef.current = gameOver;
  wonRef.current = won;
  continueRef.current = continueAfterWin;

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (gameOverRef.current) return;
    if (showWin) return;

    const dirMap: Record<string, "left" | "right" | "up" | "down"> = {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      a: "left", d: "right", w: "up", s: "down",
      A: "left", D: "right", W: "up", S: "down",
    };

    const dir = dirMap[e.key];
    if (!dir) return;
    e.preventDefault();

    const result = move(gridRef.current, dir);
    if (!result.moved) return;

    const withNew = addRandom(result.grid);
    const newScore = scoreRef.current + result.points;

    // Track new tiles for animation
    const newSet = new Set<string>();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (result.grid[r]![c] === 0 && withNew[r]![c] !== 0) {
          newSet.add(`${r},${c}`);
        }
      }
    }
    setNewTiles(newSet);

    setGrid(withNew);
    setScore(newScore);
    if (newScore > best) setBest(newScore);

    // Check win
    if (!wonRef.current && hasWon(withNew)) {
      setWon(true);
      if (!continueRef.current) {
        setShowWin(true);
        return;
      }
    }

    // Check game over
    if (!canMove(withNew)) {
      setGameOver(true);
      const msgs = LOSE_MESSAGES;
      setEndMsg(msgs[Math.floor(Math.random() * msgs.length)]!);
      onGameOver(newScore, { maxTile: Math.max(...withNew.flat()) });
    }
  }, [best, onGameOver, showWin]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const handleContinue = () => {
    setContinueAfterWin(true);
    setShowWin(false);
  };

  const handleWinStop = () => {
    setShowWin(false);
    setGameOver(true);
    setEndMsg(WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)]!);
    onGameOver(scoreRef.current, { maxTile: Math.max(...gridRef.current.flat()), won: true });
  };

  return (
    <div className="games-container">
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">2048</span>
        <span className="games-hud-score">score: {score}</span>
        <span className="games-hud-info">best: {best}</span>
      </div>

      {showWin && (
        <div className="games-over-overlay">
          <div className="games-over-title games-win-title">YOU WON!</div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)]}</div>
          <div className="games-over-actions">
            <button className="games-btn" onClick={handleContinue}>keep going</button>
            <button className="games-btn games-btn-secondary" onClick={handleWinStop}>i'm done</button>
          </div>
        </div>
      )}

      {gameOver && (
        <div className="games-over-overlay">
          <div className={`games-over-title ${won ? "games-win-title" : ""}`}>
            {won ? "GAME OVER (winner)" : "GAME OVER"}
          </div>
          <div className="games-over-score">score: {score}</div>
          <div className="games-over-roast">{endMsg}</div>
        </div>
      )}

      <div className="g2048-grid">
        {grid.map((row, r) =>
          row.map((val, c) => (
            <div
              key={`${r}-${c}`}
              className={`g2048-cell${val > 0 ? " g2048-filled" : ""}${newTiles.has(`${r},${c}`) ? " g2048-pop" : ""}`}
              data-value={val || undefined}
            >
              {val > 0 ? val : ""}
            </div>
          ))
        )}
      </div>

      <div className="games-hint">arrow keys or WASD to slide tiles</div>
    </div>
  );
}
