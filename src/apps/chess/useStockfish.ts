import { useState, useEffect, useRef, useCallback } from "react";

interface StockfishState {
  isReady: boolean;
  getBestMove: (fen: string, depth: number, skillLevel: number) => Promise<string | null>;
  stop: () => void;
}

export function useStockfish(): StockfishState {
  const [isReady, setIsReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const resolveRef = useRef<((move: string | null) => void) | null>(null);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker("/stockfish/stockfish.js");
    } catch {
      // Worker failed to load — stockfish unavailable
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (line === "uciok") {
        worker.postMessage("isready");
      } else if (line === "readyok") {
        setIsReady(true);
      } else if (line.startsWith("bestmove")) {
        const parts = line.split(" ");
        const move = parts[1];
        if (resolveRef.current) {
          resolveRef.current(move && move.length >= 4 ? move : null);
          resolveRef.current = null;
        }
      }
    };

    worker.onerror = () => {
      // Worker crashed — resolve with null (no fallback)
      if (resolveRef.current) {
        resolveRef.current(null);
        resolveRef.current = null;
      }
    };

    worker.postMessage("uci");

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const getBestMove = useCallback(
    (fen: string, depth: number, skillLevel: number): Promise<string | null> => {
      return new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) { resolve(null); return; }

        resolveRef.current = resolve;
        worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth}`);

        // Safety timeout
        setTimeout(() => {
          if (resolveRef.current === resolve) {
            worker.postMessage("stop");
            // Give 500ms for the stop to produce a bestmove, then give up
            setTimeout(() => {
              if (resolveRef.current === resolve) {
                resolveRef.current = null;
                resolve(null);
              }
            }, 500);
          }
        }, 10000);
      });
    },
    []
  );

  const stop = useCallback(() => {
    workerRef.current?.postMessage("stop");
  }, []);

  return { isReady, getBestMove, stop };
}
