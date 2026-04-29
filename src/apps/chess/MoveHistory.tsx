import { useEffect, useRef } from "react";
import type { MoveEntry } from "./types";

interface MoveHistoryProps {
  moves: MoveEntry[];
}

export function MoveHistory({ moves }: MoveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [moves.length]);

  // Group moves into pairs (white, black)
  const pairs: { num: number; white: string; black?: string }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      num: Math.floor(i / 2) + 1,
      white: moves[i]!.san,
      black: moves[i + 1]?.san,
    });
  }

  if (pairs.length === 0) {
    return (
      <div className="chess-moves-panel">
        <div className="chess-moves-header">Moves</div>
        <div className="chess-moves-empty">no moves yet.<br />someone make the first one, coward.</div>
      </div>
    );
  }

  return (
    <div className="chess-moves-panel">
      <div className="chess-moves-header">Moves</div>
      <div className="chess-moves-list" ref={scrollRef}>
        {pairs.map((p) => (
          <div key={p.num} className="chess-move-row">
            <span className="chess-move-num">{p.num}.</span>
            <span className="chess-move-white">{p.white}</span>
            <span className="chess-move-black">{p.black || ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
