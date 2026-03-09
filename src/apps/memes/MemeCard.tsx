import { useState } from "react";

export interface MemeData {
  id: number;
  username: string;
  upvotes: number;
  downvotes: number;
  score: number;
  my_vote: number;
  time_ago: string;
  created_at: string;
  image_url: string;
}

interface MemeCardProps {
  meme: MemeData;
  currentUsername: string;
  isAdmin: boolean;
  isGuest: boolean;
  onVote: (memeId: number, value: 1 | -1) => Promise<void>;
  onDelete: (memeId: number) => Promise<void>;
  onLightbox: (src: string) => void;
}

function scoreBadge(score: number): string | null {
  if (score === 69) return "nice.";
  if (score === 420) return "blazed";
  if (score === -69) return "oof";
  return null;
}

export function MemeCard({ meme, currentUsername, isAdmin, isGuest, onVote, onDelete, onLightbox }: MemeCardProps) {
  const [voting, setVoting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = currentUsername === meme.username;
  const canDelete = isAdmin || isOwner;
  const badge = scoreBadge(meme.score);

  const handleVote = async (value: 1 | -1) => {
    if (voting || isGuest) return;
    setVoting(true);
    try { await onVote(meme.id, value); }
    finally { setVoting(false); }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try { await onDelete(meme.id); }
    catch { setDeleting(false); }
  };

  const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";
  const imgSrc = `${API_BASE}/memes/${meme.id}/image`;

  return (
    <div className="meme-card">
      <img
        className="meme-card-img"
        src={imgSrc}
        alt="meme"
        loading="lazy"
        onClick={() => onLightbox(imgSrc)}
      />
      <div className="meme-card-overlay">
        <div className="meme-vote-col">
          <button
            className={`meme-vote-btn meme-vote-up ${meme.my_vote === 1 ? "active" : ""}`}
            onClick={() => void handleVote(1)}
            disabled={voting || isGuest}
            title={isGuest ? "log in to vote" : "upvote"}
          >▲</button>
          <span className={`meme-score ${meme.score > 0 ? "positive" : meme.score < 0 ? "negative" : ""}`}
            title={badge ? badge : `${meme.upvotes}↑ ${meme.downvotes}↓`}>
            {badge ?? meme.score}
          </span>
          <button
            className={`meme-vote-btn meme-vote-down ${meme.my_vote === -1 ? "active" : ""}`}
            onClick={() => void handleVote(-1)}
            disabled={voting || isGuest}
            title={isGuest ? "log in to vote" : "downvote"}
          >▼</button>
        </div>
        <div className="meme-meta">
          <span className="meme-meta-user">{meme.username}</span>
          <span className="meme-meta-time">{meme.time_ago}</span>
        </div>
        {canDelete && (
          <button
            className="meme-delete-btn"
            onClick={handleDelete}
            disabled={deleting}
            title="delete meme"
          >{deleting ? "..." : "×"}</button>
        )}
      </div>
    </div>
  );
}
