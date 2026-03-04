import { useState, useCallback, useRef, useEffect } from "react";

interface MinesweeperProps {
  onGameOver: (score: number, metadata?: Record<string, unknown>) => void;
  onBack: () => void;
}

type CellState = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
};

type Difficulty = "easy" | "medium" | "hard";

const CONFIGS: Record<Difficulty, { rows: number; cols: number; mines: number; multiplier: number }> = {
  easy: { rows: 9, cols: 9, mines: 10, multiplier: 1 },
  medium: { rows: 16, cols: 16, mines: 40, multiplier: 2 },
  hard: { rows: 16, cols: 20, mines: 60, multiplier: 3 },
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "baby mode (9x9)",
  medium: "average (16x16)",
  hard: "masochist (20x16)",
};

const WIN_MESSAGES = [
  "you cleared the field. military would be proud.",
  "no mines detonated. unlike your social life.",
  "mine-sweeping legend. put it on your resume.",
  "clean sweep. now clean your room.",
];

const LOSE_MESSAGES = [
  "BOOM. you're dead.",
  "you stepped on it. literally.",
  "mine go brr.",
  "that was the wrong cell, genius.",
  "you just got blow'd up.",
  "skill issue. the mine was RIGHT there.",
  "rest in pieces.",
  "the mine was inevitable. you were not.",
];

function createBoard(rows: number, cols: number, mines: number, safeR: number, safeC: number): CellState[][] {
  const board: CellState[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, revealed: false, flagged: false, adjacent: 0 }))
  );

  // Place mines avoiding safe cell and its neighbors
  const safeSet = new Set<string>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      safeSet.add(`${safeR + dr},${safeC + dc}`);
    }
  }

  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!board[r]![c]!.mine && !safeSet.has(`${r},${c}`)) {
      board[r]![c]!.mine = true;
      placed++;
    }
  }

  // Calculate adjacency
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r]![c]!.mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr]![nc]!.mine) count++;
        }
      }
      board[r]![c]!.adjacent = count;
    }
  }

  return board;
}

export function MinesweeperGame({ onGameOver, onBack }: MinesweeperProps) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [board, setBoard] = useState<CellState[][] | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [firstClick, setFirstClick] = useState(true);
  const [timer, setTimer] = useState(0);
  const [endMsg, setEndMsg] = useState("");
  const [revealed, setRevealed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const gameOverRef = useRef(false);

  const config = difficulty ? CONFIGS[difficulty] : null;

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startGame = (diff: Difficulty) => {
    setDifficulty(diff);
    const cfg = CONFIGS[diff];
    // Create empty board first (mines placed on first click)
    const emptyBoard: CellState[][] = Array.from({ length: cfg.rows }, () =>
      Array.from({ length: cfg.cols }, () => ({ mine: false, revealed: false, flagged: false, adjacent: 0 }))
    );
    setBoard(emptyBoard);
    setGameOver(false);
    setWon(false);
    setFirstClick(true);
    setTimer(0);
    setRevealed(0);
    setEndMsg("");
    gameOverRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const floodReveal = useCallback((b: CellState[][], r: number, c: number, rows: number, cols: number): number => {
    const stack: [number, number][] = [[r, c]];
    let count = 0;
    while (stack.length > 0) {
      const [cr, cc] = stack.pop()!;
      if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) continue;
      const cell = b[cr]![cc]!;
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      count++;
      if (cell.adjacent === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            stack.push([cr + dr, cc + dc]);
          }
        }
      }
    }
    return count;
  }, []);

  const handleClick = (r: number, c: number) => {
    if (gameOverRef.current || !board || !config || !difficulty) return;

    let currentBoard = board;

    if (firstClick) {
      // Place mines now with first click safety
      currentBoard = createBoard(config.rows, config.cols, config.mines, r, c);
      setFirstClick(false);
      // Start timer
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    }

    const cell = currentBoard[r]![c]!;
    if (cell.revealed || cell.flagged) return;

    if (cell.mine) {
      // Reveal all mines
      gameOverRef.current = true;
      const newBoard = currentBoard.map(row => row.map(cell => ({ ...cell })));
      for (const row of newBoard) for (const c of row) if (c.mine) c.revealed = true;
      setBoard(newBoard);
      setGameOver(true);
      if (timerRef.current) clearInterval(timerRef.current);
      const msgs = LOSE_MESSAGES;
      setEndMsg(msgs[Math.floor(Math.random() * msgs.length)]!);
      onGameOver(revealed * config.multiplier, { difficulty, time: timer, cause: "mine" });
      return;
    }

    const newBoard = currentBoard.map(row => row.map(cell => ({ ...cell })));
    const newRevealed = revealed + floodReveal(newBoard, r, c, config.rows, config.cols);
    setBoard(newBoard);
    setRevealed(newRevealed);

    // Check win
    const totalSafe = config.rows * config.cols - config.mines;
    if (newRevealed >= totalSafe) {
      gameOverRef.current = true;
      setGameOver(true);
      setWon(true);
      if (timerRef.current) clearInterval(timerRef.current);
      const msgs = WIN_MESSAGES;
      setEndMsg(msgs[Math.floor(Math.random() * msgs.length)]!);
      const finalScore = totalSafe * config.multiplier;
      onGameOver(finalScore, { difficulty, time: timer, won: true });
    }
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (gameOverRef.current || !board) return;
    const cell = board[r]![c]!;
    if (cell.revealed) return;
    const newBoard = board.map(row => row.map(cell => ({ ...cell })));
    newBoard[r]![c]!.flagged = !newBoard[r]![c]!.flagged;
    setBoard(newBoard);
  };

  // Difficulty selector
  if (!difficulty || !board || !config) {
    return (
      <div className="games-container">
        <div className="games-hud">
          <button className="games-back-btn" onClick={onBack}>&lt; back</button>
          <span className="games-hud-title">MINESWEEPER</span>
        </div>
        <div className="games-difficulty-select">
          <div className="games-difficulty-title">pick your poison</div>
          {(Object.keys(CONFIGS) as Difficulty[]).map((diff, i) => (
            <button
              key={diff}
              className="games-difficulty-btn"
              onClick={() => startGame(diff)}
            >
              <span className="games-difficulty-key">[{i + 1}]</span>
              <span className="games-difficulty-label">{DIFFICULTY_LABELS[diff]}</span>
              <span className="games-difficulty-info">{CONFIGS[diff].mines} mines</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const flagCount = board.flat().filter(c => c.flagged).length;

  return (
    <div className="games-container">
      <div className="games-hud">
        <button className="games-back-btn" onClick={onBack}>&lt; back</button>
        <span className="games-hud-title">MINESWEEPER</span>
        <span className="games-hud-score">mines: {config.mines - flagCount}</span>
        <span className="games-hud-info">time: {timer}s</span>
      </div>

      {gameOver && (
        <div className="games-over-overlay">
          <div className={`games-over-title ${won ? "games-win-title" : ""}`}>
            {won ? "CLEARED!" : "BOOM!"}
          </div>
          <div className="games-over-score">
            score: {won ? (config.rows * config.cols - config.mines) * config.multiplier : revealed * config.multiplier}
          </div>
          <div className="games-over-roast">{endMsg}</div>
          <div className="games-over-stat">time: {timer}s | revealed: {revealed}</div>
        </div>
      )}

      <div
        className="mines-grid"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
          maxWidth: `${config.cols * 28}px`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              className={`mines-cell${cell.revealed ? " mines-revealed" : ""}${cell.revealed && cell.mine ? " mines-mine" : ""}${cell.flagged && !cell.revealed ? " mines-flagged" : ""}`}
              data-adjacent={cell.revealed && !cell.mine && cell.adjacent > 0 ? cell.adjacent : undefined}
              onClick={() => handleClick(r, c)}
              onContextMenu={(e) => handleRightClick(e, r, c)}
            >
              {cell.revealed && cell.mine ? "*" :
               cell.flagged && !cell.revealed ? "F" :
               cell.revealed && cell.adjacent > 0 ? cell.adjacent : ""}
            </div>
          ))
        )}
      </div>

      <div className="games-hint">click to reveal | right-click to flag</div>
    </div>
  );
}
