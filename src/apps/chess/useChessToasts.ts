import { useState, useEffect, useRef, useCallback } from "react";
import type { ChessGameState } from "./types";

export interface ChessToast {
  id: number;
  text: string;
  type: "hype" | "burn" | "info" | "legendary";
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function countPiece(fen: string, piece: string): number {
  const board = fen.split(" ")[0] || "";
  let n = 0;
  for (const ch of board) if (ch === piece) n++;
  return n;
}

// ── Toast message pools ──

const GAME_START = [
  "let's fucking go",
  "may the best degen win",
  "time to ruin someone's day",
  "violence incoming",
  "gentlemen, start your engines",
  "this board ain't big enough for the two of us",
] as const;

const I_CHECK = [
  "check yourself before you wreck yourself",
  "knock knock, it's danger",
  "your king is sweating",
  "surprise motherfucker",
  "watch your back, king",
  "that king looking NERVOUS",
] as const;

const THEY_CHECK = [
  "uh oh. might wanna move that king",
  "your king is in the spotlight and not in a good way",
  "panic mode: engaged",
  "you're cooked. maybe.",
  "that's not ideal chief",
] as const;

const FIRST_BLOOD = [
  "FIRST BLOOD",
  "and so it begins...",
  "first casualty of war",
  "somebody had to die first",
] as const;

const I_CAPTURE_QUEEN = [
  "OFF WITH HER HEAD",
  "queen deleted. no backup.",
  "imagine losing your queen lmaooo",
  "that queen had a family...",
  "QUEEN DOWN. absolutely disgusting.",
  "you just decapitated royalty",
  "regicide but make it girlboss",
] as const;

const THEY_CAPTURE_MY_QUEEN = [
  "your queen is in the shadow realm now",
  "rip queen. she served well.",
  "pain. agony, even.",
  "that's gonna leave a mark",
  "the kingdom mourns",
  "she's gone. let it go.",
] as const;

const I_CAPTURE_ROOK = [
  "rook obliterated",
  "tower go boom",
  "one less castle in the kingdom",
] as const;

const THEY_CAPTURE_MY_ROOK = [
  "there goes your tower",
  "rook: deleted from existence",
  "that rook had so much potential",
] as const;

const I_CAPTURE = [
  "yoink",
  "GET THAT OUTTA HERE",
  "piece acquired.",
  "that's mine now, thanks",
  "om nom nom",
  "deleted.",
  "another one bites the dust",
  "taken. no refunds.",
] as const;

const THEY_CAPTURE = [
  "ouch",
  "that piece is gone forever",
  "rip in peace",
  "collateral damage",
  "acceptable losses... right?",
] as const;

const CASTLING_ME = [
  "safety first, aggression second",
  "king goes to his panic room",
  "tactical retreat engaged",
  "hiding like a true leader",
] as const;

const CASTLING_THEM = [
  "opponent's king went into hiding",
  "they're bunkering down",
  "coward move but ok",
] as const;

const PROMOTION_ME = [
  "a pawn becomes a QUEEN. capitalism.",
  "glow up of the century",
  "evolution complete",
  "rags to riches, baby",
  "humble pawn → absolute menace",
  "promotion arc completed",
] as const;

const PROMOTION_THEM = [
  "oh no they got a new queen",
  "enemy pawn just hit different",
  "that pawn had a character arc and you let it happen",
] as const;

const EN_PASSANT = [
  "holy hell",
  "google en passant",
  "en passant deez nuts",
  "that's the fanciest shit in chess",
  "bet they didn't see that coming",
] as const;

const MOVE_MILESTONES: Record<number, readonly string[]> = {
  10: ["10 moves deep. the foreplay is over."],
  20: ["20 moves in. this is getting serious."],
  30: ["30 moves. y'all really going at it huh."],
  50: ["50 moves. is anyone even winning??", "this is a marathon not a sprint apparently"],
  69: ["nice.", "nice. (the move count, not the position)"],
  100: ["100 MOVES. WHAT IS THIS GAME.", "touch grass holy shit"],
};

export function useChessToasts(game: ChessGameState | null, myColor: "white" | "black") {
  const [toasts, setToasts] = useState<ChessToast[]>([]);
  const prevMoveCount = useRef(-1);
  const prevFen = useRef("");
  const idRef = useRef(0);
  const shownStart = useRef(false);
  const hasHadCapture = useRef(false);

  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const addToast = useCallback((text: string, type: ChessToast["type"] = "info") => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(timer);
    }, 3500);
    timersRef.current.add(timer);
  }, []);

  useEffect(() => {
    if (!game) return;

    // Game start
    if (game.status === "active" && !shownStart.current && game.moveCount === 0) {
      shownStart.current = true;
      addToast(pick(GAME_START), "hype");
      prevFen.current = game.fen;
      prevMoveCount.current = 0;
      return;
    }

    // No new move
    if (game.moveCount <= prevMoveCount.current) {
      prevFen.current = game.fen;
      return;
    }

    // Mark start as shown if we jumped into a game already in progress
    if (!shownStart.current) shownStart.current = true;

    const lastMoveIdx = game.moveCount - 1;
    const lastMove = game.moves[lastMoveIdx];
    if (!lastMove) {
      prevMoveCount.current = game.moveCount;
      prevFen.current = game.fen;
      return;
    }

    const san = lastMove.san;
    // White moves at even indices (0, 2, 4...), black at odd
    const movedWhite = lastMoveIdx % 2 === 0;
    const iMoved = (movedWhite && myColor === "white") || (!movedWhite && myColor === "black");

    const oldFen = prevFen.current;

    // ── Check detection ──
    if (san.includes("+") && !san.includes("#")) {
      if (iMoved) {
        addToast(pick(I_CHECK), "burn");
      } else {
        addToast(pick(THEY_CHECK), "info");
      }
    }

    // ── Capture detection ──
    if (san.includes("x")) {
      // First blood?
      if (!hasHadCapture.current) {
        hasHadCapture.current = true;
        addToast(pick(FIRST_BLOOD), "legendary");
      } else {
        // Check for queen/rook captures
        const oldWQ = countPiece(oldFen, "Q");
        const newWQ = countPiece(game.fen, "Q");
        const oldBQ = countPiece(oldFen, "q");
        const newBQ = countPiece(game.fen, "q");
        const oldWR = countPiece(oldFen, "R");
        const newWR = countPiece(game.fen, "R");
        const oldBR = countPiece(oldFen, "r");
        const newBR = countPiece(game.fen, "r");

        const whiteQueenDied = oldWQ > newWQ;
        const blackQueenDied = oldBQ > newBQ;
        const whiteRookDied = oldWR > newWR;
        const blackRookDied = oldBR > newBR;

        if (whiteQueenDied || blackQueenDied) {
          const myQueenDied = (myColor === "white" && whiteQueenDied) || (myColor === "black" && blackQueenDied);
          if (myQueenDied) {
            addToast(pick(THEY_CAPTURE_MY_QUEEN), "burn");
          } else {
            addToast(pick(I_CAPTURE_QUEEN), "legendary");
          }
        } else if (whiteRookDied || blackRookDied) {
          const myRookDied = (myColor === "white" && whiteRookDied) || (myColor === "black" && blackRookDied);
          if (myRookDied) {
            addToast(pick(THEY_CAPTURE_MY_ROOK), "info");
          } else {
            addToast(pick(I_CAPTURE_ROOK), "hype");
          }
        } else {
          // Generic capture
          if (iMoved) {
            addToast(pick(I_CAPTURE), "hype");
          } else {
            addToast(pick(THEY_CAPTURE), "info");
          }
        }
      }

      // En passant: check if pawn captured onto the FEN's en passant target square
      const oldEpSquare = oldFen.split(" ")[3];
      if (oldEpSquare && oldEpSquare !== "-") {
        const pawnCapMatch = san.match(/^[a-h]x([a-h][1-8])/);
        if (pawnCapMatch && pawnCapMatch[1] === oldEpSquare) {
          addToast(pick(EN_PASSANT), "legendary");
        }
      }
    }

    // ── Castling ──
    if (san.startsWith("O-O")) {
      if (iMoved) {
        addToast(pick(CASTLING_ME), "info");
      } else {
        addToast(pick(CASTLING_THEM), "info");
      }
    }

    // ── Promotion ──
    if (san.includes("=")) {
      if (iMoved) {
        addToast(pick(PROMOTION_ME), "legendary");
      } else {
        addToast(pick(PROMOTION_THEM), "burn");
      }
    }

    // ── Move milestones ──
    const milestone = MOVE_MILESTONES[game.moveCount];
    if (milestone) {
      addToast(pick(milestone), "info");
    }

    prevMoveCount.current = game.moveCount;
    prevFen.current = game.fen;
  }, [game?.moveCount, game?.fen, game?.status, myColor, addToast]);

  // Cleanup toast timers on unmount
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
    };
  }, []);

  // Reset on game change
  useEffect(() => {
    hasHadCapture.current = false;
    shownStart.current = false;
    prevMoveCount.current = -1;
    prevFen.current = "";
  }, [game?.id]);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, dismissToast };
}
