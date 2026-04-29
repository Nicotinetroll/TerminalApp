import { useState, useEffect, useRef, useCallback } from "react";
import { chessGet, chessPoll, chessMove, chessResign, chessDraw } from "@/lib/api";
import type { ChessGameState } from "./types";
import { BOT_LEVELS } from "./types";
import { useStockfish } from "./useStockfish";

interface UseChessGameOpts {
  gameId: string;
  token: string;
  botToken?: string;
  myColor: "white" | "black";
}

interface UseChessGameReturn {
  game: ChessGameState | null;
  loading: boolean;
  error: string | null;
  makeMove: (from: string, to: string, promotion?: string) => Promise<boolean>;
  resign: () => Promise<void>;
  offerDraw: () => Promise<void>;
  isMyTurn: boolean;
  myColor: "white" | "black";
}

export function useChessGame({ gameId, token, botToken, myColor }: UseChessGameOpts): UseChessGameReturn {
  const [game, setGame] = useState<ChessGameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const waitPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botMovingRef = useRef(false);
  const botFailCount = useRef(0);
  const gameRef = useRef(game);
  gameRef.current = game;
  const stockfish = useStockfish();

  const isBot = !!botToken;

  // Determine whose turn it is from FEN
  const turnColor = game?.fen.split(" ")[1] === "w" ? "white" : "black";
  const isMyTurn = game?.status === "active" && turnColor === myColor;

  // Fetch initial state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await chessGet(gameId);
        if (!cancelled) {
          setGame(data.game as ChessGameState);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load game");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  // Poll for opponent joining (waiting status) — simple GET to detect status change
  useEffect(() => {
    if (!game || isBot) return;
    if (game.status !== "waiting") return;

    const poll = async () => {
      try {
        const data = await chessGet(gameId);
        if (data.game && (data.game as ChessGameState).status !== "waiting") {
          setGame(data.game as ChessGameState);
        }
      } catch { /* ignore */ }
    };

    waitPollRef.current = setInterval(poll, 2000);
    return () => {
      if (waitPollRef.current) clearInterval(waitPollRef.current);
    };
  }, [game?.status, gameId, isBot]);

  // Poll for game updates (active games, multiplayer only)
  // Catches opponent moves, resign, draw offers
  useEffect(() => {
    if (!game || isBot) return;
    if (game.status !== "active") return;

    const moveCount = game.moveCount;
    const drawOffer = game.drawOfferBy || "";

    const poll = async () => {
      try {
        const data = await chessPoll(gameId, token, moveCount, drawOffer);
        if (data.updated && data.game) {
          setGame(data.game as ChessGameState);
        }
      } catch { /* ignore poll errors */ }
    };

    activePollRef.current = setInterval(poll, 1000);
    return () => {
      if (activePollRef.current) clearInterval(activePollRef.current);
    };
  }, [game?.moveCount, game?.status, game?.drawOfferBy, gameId, token, isBot]);

  // Bot move logic
  const stockfishRef = useRef(stockfish);
  stockfishRef.current = stockfish;

  useEffect(() => {
    if (!game || !isBot || game.status !== "active" || !stockfishRef.current.isReady) return;
    if (turnColor === myColor) return; // It's human's turn
    if (botMovingRef.current) return;
    // Stop retrying after 3 consecutive failures (stockfish broken)
    if (botFailCount.current >= 3) return;

    const botLevel = game.botLevel ?? 0;
    const cfg = BOT_LEVELS[botLevel];
    if (!cfg) return;

    botMovingRef.current = true;
    const fenAtStart = game.fen;

    const delay = 300 + Math.random() * 700;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) { botMovingRef.current = false; return; }
      try {
        const bestMove = await stockfishRef.current.getBestMove(fenAtStart, cfg.depth, cfg.skill);
        if (cancelled || gameRef.current?.fen !== fenAtStart) {
          botMovingRef.current = false;
          return;
        }
        // Stockfish returned null — engine failed, don't retry endlessly
        if (!bestMove) {
          botFailCount.current++;
          botMovingRef.current = false;
          return;
        }
        botFailCount.current = 0;
        const from = bestMove.slice(0, 2);
        const to = bestMove.slice(2, 4);
        const promotion = bestMove.length > 4 ? bestMove[4] : undefined;

        const data = await chessMove(gameId, botToken!, from, to, promotion);
        if (data.ok) {
          setGame(data as unknown as ChessGameState);
        }
      } catch { /* bot move failed */ }
      botMovingRef.current = false;
    }, delay);

    return () => { cancelled = true; clearTimeout(timer); botMovingRef.current = false; };
  }, [game?.fen, game?.status, turnColor, myColor, isBot, stockfish.isReady, gameId, botToken, game?.botLevel]);

  // Reset bot fail count when FEN changes (human moved)
  useEffect(() => {
    botFailCount.current = 0;
  }, [game?.fen]);

  const makeMove = useCallback(async (from: string, to: string, promotion?: string): Promise<boolean> => {
    const g = gameRef.current;
    if (!g || g.status !== "active") return false;
    try {
      const data = await chessMove(gameId, token, from, to, promotion);
      if (data.ok) {
        setGame(data as unknown as ChessGameState);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [gameId, token]);

  const resign = useCallback(async () => {
    const g = gameRef.current;
    if (!g || g.status !== "active") return;
    try {
      const data = await chessResign(gameId, token);
      if (data.ok) {
        setGame(data as unknown as ChessGameState);
      }
    } catch { /* */ }
  }, [gameId, token]);

  const offerDraw = useCallback(async () => {
    const g = gameRef.current;
    if (!g || g.status !== "active") return;
    try {
      const data = await chessDraw(gameId, token);
      if (data.ok) {
        const fresh = await chessGet(gameId);
        setGame(fresh.game as ChessGameState);
      }
    } catch { /* */ }
  }, [gameId, token]);

  return { game, loading, error, makeMove, resign, offerDraw, isMyTurn, myColor };
}
