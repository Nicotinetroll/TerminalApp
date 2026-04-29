import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "./ChessBoard";
import { PlayerBar } from "./PlayerBar";
import { MoveHistory } from "./MoveHistory";
import { GameOverlay } from "./GameOverlay";
import { ChessToasts } from "./ChessToasts";
import { useChessGame } from "./useChessGame";
import { useGodMode } from "./useGodMode";
import { useChessToasts } from "./useChessToasts";

interface ChessGameProps {
  gameId: string;
  token: string;
  botToken?: string;
  myColor: "white" | "black";
  onBack: () => void;
  isAdmin?: boolean;
}

const PIECE_SYMBOLS: Record<string, string> = {
  p: "\u265F", n: "\u265E", b: "\u265D", r: "\u265C", q: "\u265B", k: "\u265A",
  P: "\u2659", N: "\u2658", B: "\u2657", R: "\u2656", Q: "\u2655", K: "\u2654",
};

function getCapturedPieces(fen: string, color: "white" | "black"): string[] {
  const initial: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const current: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  const boardPart = fen.split(" ")[0] || "";
  for (const ch of boardPart) {
    const lower = ch.toLowerCase();
    if (!"pnbrqk".includes(lower)) continue;
    const isWhite = ch === ch.toUpperCase();
    const isOpponent = color === "white" ? !isWhite : isWhite;
    if (isOpponent && current[lower] !== undefined) {
      current[lower]!++;
    }
  }

  const captured: string[] = [];
  for (const piece of ["q", "r", "b", "n", "p"]) {
    const missing = (initial[piece] ?? 0) - (current[piece] ?? 0);
    const sym = color === "white" ? PIECE_SYMBOLS[piece]! : PIECE_SYMBOLS[piece.toUpperCase()]!;
    for (let i = 0; i < missing; i++) {
      captured.push(sym);
    }
  }
  return captured;
}

function countPiece(fen: string, piece: string): number {
  const board = fen.split(" ")[0] || "";
  let n = 0;
  for (const ch of board) if (ch === piece) n++;
  return n;
}

const WAITING_QUOTES = [
  "your opponent is probably overthinking whether to click the link...",
  "waiting... like your code waiting for a review that never comes",
  "any second now. or minute. or hour. who knows.",
  "the link has been sent. their move now. literally.",
  "patience is a virtue you clearly have too much of",
];

function pickQuote(): string {
  return WAITING_QUOTES[Math.floor(Math.random() * WAITING_QUOTES.length)]!;
}

type BoardEffect = "capture" | "check" | "promote" | null;

export function ChessGame({ gameId, token, botToken, myColor, onBack, isAdmin }: ChessGameProps) {
  const [waitingQuote] = useState(() => pickQuote());
  const { game, loading, error, makeMove, resign, offerDraw, isMyTurn } = useChessGame({
    gameId, token, botToken, myColor,
  });

  const godMode = useGodMode(game?.fen ?? "", !!isAdmin && game?.status === "active");
  const { toasts } = useChessToasts(game, myColor);

  // Board effects — triggered briefly on events
  const [boardEffect, setBoardEffect] = useState<BoardEffect>(null);
  const prevFenRef = useRef("");
  const prevMoveCountRef = useRef(0);

  // Detect events for board effects
  useEffect(() => {
    if (!game || game.moveCount <= prevMoveCountRef.current) {
      if (game) {
        prevFenRef.current = game.fen;
      }
      return;
    }

    const lastMove = game.moves[game.moveCount - 1];
    if (lastMove) {
      const san = lastMove.san;

      if (san.includes("#") || san.includes("+")) {
        setBoardEffect("check");
      } else if (san.includes("=")) {
        setBoardEffect("promote");
      } else if (san.includes("x")) {
        // Big captures get bigger effect
        const oldFen = prevFenRef.current;
        const lostQ = countPiece(oldFen, "Q") > countPiece(game.fen, "Q") ||
                      countPiece(oldFen, "q") > countPiece(game.fen, "q");
        if (lostQ) {
          setBoardEffect("promote"); // reuse the bigger effect for queen captures
        } else {
          setBoardEffect("capture");
        }
      }
    }

    prevMoveCountRef.current = game.moveCount;
    prevFenRef.current = game.fen;
  }, [game?.moveCount, game?.fen]);

  // Clear effect after animation
  useEffect(() => {
    if (!boardEffect) return;
    const timer = setTimeout(() => setBoardEffect(null), 400);
    return () => clearTimeout(timer);
  }, [boardEffect]);

  const lastMove = useMemo(() => {
    if (!game || game.moves.length === 0) return null;
    const last = game.moves[game.moves.length - 1]!;
    return { from: last.from, to: last.to };
  }, [game]);

  const isCheck = useMemo(() => {
    if (!game) return false;
    try { return new Chess(game.fen).inCheck(); } catch { return false; }
  }, [game]);

  const handleMove = useCallback(async (from: string, to: string, promotion?: string): Promise<boolean> => {
    if (!isMyTurn) return false;
    return makeMove(from, to, promotion);
  }, [isMyTurn, makeMove]);

  const whiteCaptured = useMemo(() => game ? getCapturedPieces(game.fen, "white") : [], [game?.fen]);
  const blackCaptured = useMemo(() => game ? getCapturedPieces(game.fen, "black") : [], [game?.fen]);

  if (loading) return <div className="chess-loading">loading game... hold on to your pieces</div>;
  if (error) return <div className="chess-error">{error}</div>;
  if (!game) return <div className="chess-error">game not found. it probably rage quit.</div>;

  if (game.status === "waiting") {
    return (
      <div className="chess-waiting">
        <div className="chess-waiting-title">waiting for opponent...</div>
        <div className="chess-waiting-quote">{waitingQuote}</div>
        <div className="chess-waiting-link">
          Share this link: <code onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/c/${gameId}`);
          }}>{window.location.origin}/c/{gameId}</code>
        </div>
        <div className="chess-waiting-hint">click the link to copy</div>
        <button className="chess-btn" onClick={onBack}>fuck this, go back</button>
      </div>
    );
  }

  const opponentColor = myColor === "white" ? "black" : "white";
  const opponentName = opponentColor === "white" ? game.whiteName : game.blackName;
  const myName = myColor === "white" ? game.whiteName : game.blackName;
  const turnColor = game.fen.split(" ")[1] === "w" ? "white" : "black";

  const layoutClasses = [
    "chess-game-layout",
    isMyTurn ? "my-turn" : "their-turn",
    isCheck && turnColor === myColor ? "in-check" : "",
    boardEffect === "capture" ? "fx-capture" : "",
    boardEffect === "check" ? "fx-check" : "",
    boardEffect === "promote" ? "fx-promote" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={layoutClasses}>
      <div className="chess-game-main">
        <PlayerBar
          name={opponentName || "Opponent"}
          timeLeft={opponentColor === "white" ? game.whiteTimeLeft : game.blackTimeLeft}
          isActive={game.status === "active" && turnColor === opponentColor}
          color={opponentColor}
          isBot={game.isBot}
          botLevel={game.isBot ? game.botLevel : null}
          capturedPieces={opponentColor === "white" ? whiteCaptured : blackCaptured}
          isMyBar={false}
        />

        <div className="chess-board-container">
          <ChessBoard
            fen={game.fen}
            orientation={myColor}
            onMove={handleMove}
            disabled={!isMyTurn || game.status !== "active"}
            lastMove={lastMove}
            hintMove={godMode.peeking ? (isMyTurn ? godMode.bestMove : godMode.responseMove) : null}
          />
          {game.status === "finished" && (
            <GameOverlay game={game} myColor={myColor} onNewGame={onBack} />
          )}
          <ChessToasts toasts={toasts} />
        </div>

        <PlayerBar
          name={myName || "You"}
          timeLeft={myColor === "white" ? game.whiteTimeLeft : game.blackTimeLeft}
          isActive={game.status === "active" && isMyTurn}
          color={myColor}
          capturedPieces={myColor === "white" ? whiteCaptured : blackCaptured}
          isMyBar={true}
        />

        {game.status === "active" && (
          <div className="chess-actions">
            <button className="chess-btn danger" onClick={resign}>Resign</button>
            {!game.isBot && (
              <button
                className="chess-btn"
                onClick={offerDraw}
                disabled={game.drawOfferBy === myColor}
              >
                {game.drawOfferBy === myColor ? "Draw Offered" : game.drawOfferBy ? "Accept Draw" : "Offer Draw"}
              </button>
            )}
            {isMyTurn && <span className="chess-turn-indicator">your move</span>}
            {godMode.peeking && godMode.eval !== null && <span className="chess-eval-ghost"> d{godMode.depth} {godMode.eval > 0 ? "+" : ""}{(godMode.eval / 100).toFixed(1)}</span>}
          </div>
        )}
      </div>

      <div className="chess-game-sidebar">
        <MoveHistory moves={game.moves} />
      </div>

    </div>
  );
}
