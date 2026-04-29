import { useState, useEffect, useRef, useCallback } from "react";

/**
 * God mode: a hidden Stockfish instance that continuously analyzes
 * the current position at max depth. Only activated for admin.
 * Hold backtick (`) to reveal the best move.
 *
 * Tracks both the engine's top move AND the response move (2nd in PV).
 * When it's your turn → show top move (your best move).
 * When it's opponent's turn → show response move (your best reply).
 */

interface ParsedMove {
  from: string;
  to: string;
  promo?: string;
}

interface GodModeState {
  /** Engine's top move for current side to move */
  bestMove: ParsedMove | null;
  /** 2nd move in PV — your best response when opponent is to move */
  responseMove: ParsedMove | null;
  eval: number | null;
  depth: number;
  peeking: boolean;
}

function parseUci(uci: string): ParsedMove | null {
  if (uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promo: uci.length > 4 ? uci[4] : undefined,
  };
}

export function useGodMode(fen: string, active: boolean): GodModeState {
  const [bestMove, setBestMove] = useState<ParsedMove | null>(null);
  const [responseMove, setResponseMove] = useState<ParsedMove | null>(null);
  const [eval_, setEval] = useState<number | null>(null);
  const [depth, setDepth] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const fenRef = useRef(fen);

  fenRef.current = fen;

  // Spawn dedicated Stockfish worker
  useEffect(() => {
    if (!active) return;

    let worker: Worker;
    try {
      worker = new Worker("/stockfish/stockfish.js");
    } catch {
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : "";

      if (line === "uciok") {
        worker.postMessage("setoption name Skill Level value 20");
        worker.postMessage("isready");
      } else if (line === "readyok") {
        readyRef.current = true;
        worker.postMessage(`position fen ${fenRef.current}`);
        worker.postMessage("go depth 22");
      } else if (line.startsWith("info") && line.includes("score")) {
        const depthMatch = line.match(/depth (\d+)/);
        const scoreMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        const pvMatch = line.match(/ pv (.+)/);

        if (depthMatch) {
          setDepth(parseInt(depthMatch[1]!, 10));
        }
        if (scoreMatch) {
          setEval(parseInt(scoreMatch[1]!, 10));
        } else if (mateMatch) {
          const m = parseInt(mateMatch[1]!, 10);
          setEval(m > 0 ? 99999 : -99999);
        }
        if (pvMatch) {
          const moves = pvMatch[1]!.trim().split(/\s+/);
          const first = moves[0];
          const second = moves[1];
          if (first) setBestMove(parseUci(first));
          setResponseMove(second ? parseUci(second) : null);
        }
      } else if (line.startsWith("bestmove")) {
        const parts = line.split(" ");
        const uci = parts[1] || "";
        if (uci.length >= 4) {
          setBestMove(parseUci(uci));
        }
      }
    };

    worker.onerror = () => { /* worker crashed */ };
    worker.postMessage("uci");

    return () => {
      worker.terminate();
      workerRef.current = null;
      readyRef.current = false;
    };
  }, [active]);

  // Re-analyze when FEN changes
  useEffect(() => {
    if (!active || !readyRef.current || !workerRef.current) return;

    setBestMove(null);
    setResponseMove(null);
    setEval(null);
    setDepth(0);

    const worker = workerRef.current;
    worker.postMessage("stop");
    const timer = setTimeout(() => {
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage("go depth 22");
    }, 50);

    return () => clearTimeout(timer);
  }, [fen, active]);

  // Key listener: hold backtick to peek
  useEffect(() => {
    if (!active) return;

    const GOD_KEYS = ["`", "§", "Dead"];
    const onDown = (e: KeyboardEvent) => {
      if (GOD_KEYS.includes(e.key)) {
        e.preventDefault();
        setPeeking(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (GOD_KEYS.includes(e.key)) {
        setPeeking(false);
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [active]);

  const handleBlur = useCallback(() => setPeeking(false), []);
  useEffect(() => {
    if (!active) return;
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [active, handleBlur]);

  return { bestMove, responseMove, eval: eval_, depth, peeking };
}
