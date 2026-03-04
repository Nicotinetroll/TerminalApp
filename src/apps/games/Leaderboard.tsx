import { useState, useEffect } from "react";
import type { GameScore } from "@/lib/api";
import { getLeaderboard } from "@/lib/api";

interface LeaderboardProps {
  game: string;
  compact?: boolean;
  scores?: GameScore[];
}

export function Leaderboard({ game, compact, scores: propScores }: LeaderboardProps) {
  const [scores, setScores] = useState<GameScore[]>(propScores ?? []);
  const [loading, setLoading] = useState(!propScores);

  useEffect(() => {
    if (propScores) {
      setScores(propScores);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getLeaderboard(game, compact ? 5 : 10)
      .then((s) => { if (!cancelled) setScores(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [game, compact, propScores]);

  if (loading) return <div className="games-lb-loading">loading scores...</div>;
  if (scores.length === 0) return <div className="games-lb-empty">no scores yet. be the first, legend.</div>;

  const medals = ["[#1]", "[#2]", "[#3]"];

  return (
    <div className={`games-lb ${compact ? "games-lb-compact" : ""}`}>
      {!compact && <div className="games-lb-title">{game} leaderboard</div>}
      <table className="games-lb-table">
        <thead>
          <tr>
            <th>#</th>
            <th>player</th>
            <th>score</th>
            {!compact && <th>date</th>}
          </tr>
        </thead>
        <tbody>
          {scores.map((s, i) => (
            <tr key={i} className={i < 3 ? `games-lb-top-${i + 1}` : ""}>
              <td>{medals[i] ?? i + 1}</td>
              <td className="games-lb-player">{s.username}</td>
              <td className="games-lb-score">{s.score.toLocaleString()}</td>
              {!compact && (
                <td className="games-lb-date">
                  {new Date(s.created_at + "Z").toLocaleDateString()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
