import { useState, useMemo, useCallback } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import { themedPieces } from "./pieces";

interface ChessBoardProps {
  fen: string;
  orientation: "white" | "black";
  onMove?: (from: string, to: string, promotion?: string) => Promise<boolean>;
  disabled?: boolean;
  lastMove?: { from: string; to: string } | null;
  hintMove?: { from: string; to: string } | null;
}

const PROMO_PIECES = ["q", "n", "r", "b"] as const;
const PROMO_LABELS: Record<string, string> = { q: "\u265B", n: "\u265E", r: "\u265C", b: "\u265D" };

export function ChessBoard({ fen, orientation, onMove, disabled, lastMove, hintMove }: ChessBoardProps) {
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [promoMove, setPromoMove] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);

  const isInCheck = chess.inCheck();
  const kingSquare = isInCheck ? findKingSquare(chess) : null;

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (lastMove) {
      styles[lastMove.from] = { backgroundColor: "rgba(139, 92, 246, 0.25)" };
      styles[lastMove.to] = { backgroundColor: "rgba(139, 92, 246, 0.35)" };
    }

    if (kingSquare) {
      styles[kingSquare] = {
        backgroundColor: "rgba(239, 68, 68, 0.5)",
        boxShadow: "inset 0 0 12px rgba(239, 68, 68, 0.8)",
      };
    }

    if (moveFrom) {
      styles[moveFrom] = {
        ...styles[moveFrom],
        backgroundColor: "rgba(139, 92, 246, 0.5)",
      };
    }

    // God mode hint
    if (hintMove) {
      styles[hintMove.from] = {
        ...styles[hintMove.from],
        boxShadow: `${styles[hintMove.from]?.boxShadow ? styles[hintMove.from]!.boxShadow + ", " : ""}inset 0 0 6px 1px rgba(34, 197, 94, 0.35)`,
      };
      styles[hintMove.to] = {
        ...styles[hintMove.to],
        boxShadow: `${styles[hintMove.to]?.boxShadow ? styles[hintMove.to]!.boxShadow + ", " : ""}inset 0 0 8px 2px rgba(34, 197, 94, 0.45)`,
      };
    }

    return { ...styles, ...optionSquares };
  }, [lastMove, kingSquare, moveFrom, optionSquares, hintMove]);

  const getMoveOptions = useCallback((square: string) => {
    const moves = chess.moves({ square: square as Square, verbose: true });
    if (moves.length === 0) {
      setOptionSquares({});
      return false;
    }

    const newSquares: Record<string, React.CSSProperties> = {};
    for (const move of moves) {
      newSquares[move.to] = {
        background: move.captured
          ? "radial-gradient(circle, rgba(139, 92, 246, 0.6) 85%, transparent 85%)"
          : "radial-gradient(circle, rgba(139, 92, 246, 0.4) 25%, transparent 25%)",
        borderRadius: "50%",
      };
    }
    setOptionSquares(newSquares);
    return true;
  }, [chess]);

  const tryMove = useCallback((from: string, to: string) => {
    if (!onMove) return;
    const moves = chess.moves({ square: from as Square, verbose: true });
    const isPromotion = moves.some(m => m.to === to && m.promotion);

    if (isPromotion) {
      setPromoMove({ from, to });
    } else {
      onMove(from, to);
    }

    setMoveFrom(null);
    setOptionSquares({});
  }, [chess, onMove]);

  const handlePromoChoice = useCallback((piece: string) => {
    if (!promoMove || !onMove) return;
    onMove(promoMove.from, promoMove.to, piece);
    setPromoMove(null);
  }, [promoMove, onMove]);

  const handleSquareClick = useCallback(({ square }: { square: string }) => {
    if (disabled || !onMove || promoMove) return;

    if (moveFrom) {
      tryMove(moveFrom, square);
      return;
    }

    const piece = chess.get(square as Square);
    if (piece && piece.color === chess.turn()) {
      setMoveFrom(square);
      getMoveOptions(square);
    }
  }, [disabled, onMove, moveFrom, chess, getMoveOptions, tryMove, promoMove]);

  const handlePieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null; piece: unknown }): boolean => {
    if (disabled || !onMove || !targetSquare || promoMove) return false;

    tryMove(sourceSquare, targetSquare);
    return false; // We handle position updates via FEN
  }, [disabled, onMove, tryMove, promoMove]);

  // Get promo square position for the dialog
  const promoSquareFile = promoMove ? promoMove.to.charCodeAt(0) - 97 : 0;
  const promoIsTop = promoMove ? (orientation === "white" ? promoMove.to[1] === "8" : promoMove.to[1] === "1") : true;

  return (
    <div className="chess-board-wrapper">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          pieces: themedPieces,
          onSquareClick: handleSquareClick,
          onPieceDrop: handlePieceDrop,
          squareStyles: customSquareStyles,
          darkSquareStyle: { backgroundColor: "var(--chess-dark, #6d28d9)" },
          lightSquareStyle: { backgroundColor: "var(--chess-light, #1e1b2e)" },
          boardStyle: {
            borderRadius: "6px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          },
          animationDurationInMs: 200,
          allowDragging: !disabled && !promoMove,
        }}
      />
      {promoMove && (
        <div className="chess-promo-overlay" onClick={() => setPromoMove(null)}>
          <div
            className={`chess-promo-dialog ${promoIsTop ? "top" : "bottom"}`}
            style={{ left: `${(orientation === "white" ? promoSquareFile : 7 - promoSquareFile) * 12.5}%` }}
            onClick={e => e.stopPropagation()}
          >
            {PROMO_PIECES.map(p => (
              <button
                key={p}
                className="chess-promo-btn"
                onClick={() => handlePromoChoice(p)}
              >
                {PROMO_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function findKingSquare(chess: Chess): string | null {
  const turn = chess.turn();
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r]?.[c];
      if (piece && piece.type === "k" && piece.color === turn) {
        const file = String.fromCharCode(97 + c);
        const rank = String(8 - r);
        return `${file}${rank}`;
      }
    }
  }
  return null;
}
