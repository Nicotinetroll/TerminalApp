import { useState } from "react";
import {
  voteNigdit, deleteNigditPost, editNigditPost, pinNigditPost,
  giveNigditAward, voteNigditPoll, getNigditAwardTypes, ApiError,
} from "@/lib/api";
import type { NigditPost, NigditAwardType } from "@/lib/api";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";

interface PostCardProps {
  post: NigditPost;
  currentUserId: number;
  isAdmin: boolean;
  onOpenThread: (postId: number) => void;
  onPostUpdated: (postId: number, updates: Partial<NigditPost>) => void;
  onPostDeleted: (postId: number) => void;
  onBookmark: (postId: number) => void;
  onOpenProfile: (username: string) => void;
  onLightbox?: (src: string) => void;
}

function scoreBadge(score: number): string | null {
  if (score === 69) return "nice.";
  if (score === 420) return "blazed";
  if (score === -69) return "deserved lmao";
  return null;
}

function fmtTimeRemaining(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function PostCard({
  post, currentUserId, isAdmin, onOpenThread, onPostUpdated, onPostDeleted,
  onBookmark, onOpenProfile, onLightbox,
}: PostCardProps) {
  const [voting, setVoting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editBody, setEditBody] = useState(post.body);
  const [editSaving, setEditSaving] = useState(false);
  const [showAwardMenu, setShowAwardMenu] = useState(false);
  const [awardTypes, setAwardTypes] = useState<NigditAwardType[]>([]);
  const [awarding, setAwarding] = useState(false);

  const handleVote = async (value: 1 | -1) => {
    if (voting || post.user_id === currentUserId) return;
    setVoting(true);
    try {
      const result = await voteNigdit(post.id, "post", value);
      onPostUpdated(post.id, { score: result.score, my_vote: result.my_vote });
    } catch { /* silent */ }
    finally { setVoting(false); }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteNigditPost(post.id);
      onPostDeleted(post.id);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "delete failed");
      setDeleting(false);
    }
  };

  const handleEdit = async () => {
    if (editSaving) return;
    setEditSaving(true);
    try {
      await editNigditPost(post.id, { title: editTitle.trim(), body: editBody.trim() });
      onPostUpdated(post.id, { title: editTitle.trim(), body: editBody.trim(), is_edited: true });
      setEditing(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "edit failed");
    } finally { setEditSaving(false); }
  };

  const handlePin = async () => {
    try {
      const result = await pinNigditPost(post.id);
      onPostUpdated(post.id, { is_pinned: result.is_pinned });
    } catch { /* silent */ }
  };

  const openAwardMenu = async () => {
    if (awardTypes.length === 0) {
      try {
        const types = await getNigditAwardTypes();
        setAwardTypes(types);
      } catch { return; }
    }
    setShowAwardMenu(!showAwardMenu);
  };

  const handleAward = async (awardType: string) => {
    if (awarding) return;
    setAwarding(true);
    try {
      await giveNigditAward(awardType, post.id);
      // Refresh awards locally
      const existing = post.awards.find(a => a.award_type === awardType);
      const newAwards = existing
        ? post.awards.map(a => a.award_type === awardType ? { ...a, count: a.count + 1 } : a)
        : [...post.awards, { award_type: awardType, count: 1 }];
      onPostUpdated(post.id, { awards: newAwards });
      setShowAwardMenu(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "award failed");
    } finally { setAwarding(false); }
  };

  const handlePollVote = async (optionId: number) => {
    if (!post.poll || post.poll.my_vote !== null) return;
    try {
      const result = await voteNigditPoll(post.id, optionId);
      onPostUpdated(post.id, { poll: result.poll });
    } catch { /* silent */ }
  };

  const badge = scoreBadge(post.score);
  const canDelete = post.user_id === currentUserId || isAdmin;
  const canEdit = post.user_id === currentUserId;

  if (editing) {
    return (
      <div className="nigdit-post-card editing" onClick={(e) => e.stopPropagation()}>
        <div className="nigdit-edit-form">
          <input
            className="nigdit-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="title"
          />
          <textarea
            className="nigdit-textarea"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            placeholder="body"
            rows={4}
          />
          <div className="nigdit-edit-actions">
            <button className="btn" onClick={() => setEditing(false)}>cancel</button>
            <button className="btn btn-primary" onClick={() => void handleEdit()} disabled={editSaving}>
              {editSaving ? "..." : "save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nigdit-post-card" onClick={() => onOpenThread(post.id)}>
      <div className="nigdit-vote-col" onClick={(e) => e.stopPropagation()}>
        <button
          className={`nigdit-vote-btn nigdit-vote-up${post.my_vote === 1 ? " active" : ""}`}
          onClick={() => void handleVote(1)}
          disabled={voting || post.user_id === currentUserId}
          title="upvote"
        >
          ▲
        </button>
        <span className={`nigdit-score${post.score > 0 ? " positive" : post.score < 0 ? " negative" : ""}`}>
          {post.score}
        </span>
        <button
          className={`nigdit-vote-btn nigdit-vote-down${post.my_vote === -1 ? " active" : ""}`}
          onClick={() => void handleVote(-1)}
          disabled={voting || post.user_id === currentUserId}
          title="downvote"
        >
          ▼
        </button>
      </div>

      <div className="nigdit-post-content">
        <div className="nigdit-post-title">
          {post.is_pinned && <span className="nigdit-pin-badge">pin</span>}
          {post.post_type === "hottake" && <span className="nigdit-hottake-badge">{post.time_remaining != null ? fmtTimeRemaining(post.time_remaining) : "hot"}</span>}
          {post.post_type === "poll" && <span className="nigdit-poll-badge">poll</span>}
          {post.title}
          {badge && <span className="nigdit-badge">{badge}</span>}
          {post.is_edited && <span className="nigdit-edited-badge">edited</span>}
        </div>

        {post.body_preview && (
          <div className="nigdit-post-preview">{post.body_preview}</div>
        )}

        {/* Poll preview */}
        {post.poll && (
          <div className="nigdit-poll-preview" onClick={(e) => e.stopPropagation()}>
            {post.poll.options.map((opt) => {
              const pct = post.poll!.total_votes > 0 ? Math.round((opt.vote_count / post.poll!.total_votes) * 100) : 0;
              const isMyVote = post.poll!.my_vote === opt.id;
              const canVote = post.poll!.my_vote === null;
              return (
                <div
                  key={opt.id}
                  className={`nigdit-poll-option${isMyVote ? " voted" : ""}${canVote ? " clickable" : ""}`}
                  onClick={() => { if (canVote) void handlePollVote(opt.id); }}
                >
                  <div className="nigdit-poll-bar" style={{ width: `${pct}%` }} />
                  <span className="nigdit-poll-label">{opt.label}</span>
                  <span className="nigdit-poll-pct">{pct}%</span>
                </div>
              );
            })}
            <div className="nigdit-poll-total">{post.poll.total_votes} votes</div>
          </div>
        )}

        {/* Awards */}
        {post.awards.length > 0 && (
          <div className="nigdit-awards-row" onClick={(e) => e.stopPropagation()}>
            {post.awards.map((a) => (
              <span key={a.award_type} className={`nigdit-award-badge award-${a.award_type}`}>
                {a.award_type}{a.count > 1 ? ` x${a.count}` : ""}
              </span>
            ))}
          </div>
        )}

        {post.attachments && post.attachments.length > 0 && (
          <div className="nigdit-post-thumbs" onClick={(e) => e.stopPropagation()}>
            {post.attachments.filter(a => a.mime_type.startsWith("image/")).slice(0, 3).map((a) => (
              <img
                key={a.id}
                src={`${API_BASE}/nigdit/attachments/${a.id}`}
                alt=""
                className="nigdit-post-thumb"
                onClick={() => onLightbox?.(`${API_BASE}/nigdit/attachments/${a.id}`)}
              />
            ))}
            {post.attachments.some(a => a.mime_type.startsWith("video/")) && (
              <span className="nigdit-post-video-badge">vid</span>
            )}
          </div>
        )}

        <div className="nigdit-post-meta" onClick={(e) => e.stopPropagation()}>
          <span className="nigdit-board-tag">{post.board}</span>
          <span
            className={`nigdit-author${post.is_anonymous ? " anon" : ""}`}
            onClick={() => { if (!post.is_anonymous) onOpenProfile(post.username); }}
            style={{ cursor: post.is_anonymous ? "default" : "pointer" }}
          >
            @{post.username}
            {post.is_anonymous && <span className="nigdit-anon-badge">anon</span>}
            <span className="nigdit-aura">{post.author_aura}</span>
          </span>
          <span className="nigdit-time">{post.time_ago}</span>
          <span className="nigdit-comments">{post.comment_count} comments</span>
          <button
            className={`nigdit-action-btn${post.bookmarked ? " bookmarked" : ""}`}
            onClick={() => onBookmark(post.id)}
          >
            {post.bookmarked ? "saved" : "save"}
          </button>
          {post.user_id !== currentUserId && (
            <button className="nigdit-action-btn" onClick={() => void openAwardMenu()}>award</button>
          )}
          {canEdit && (
            <button className="nigdit-action-btn" onClick={() => { setEditing(true); setEditTitle(post.title); setEditBody(post.body); }}>edit</button>
          )}
          {isAdmin && (
            <button className="nigdit-action-btn" onClick={() => void handlePin()}>
              {post.is_pinned ? "unpin" : "pin"}
            </button>
          )}
          {canDelete && (
            <button
              className="nigdit-delete-btn"
              onClick={() => void handleDelete()}
              disabled={deleting}
              title="delete post"
            >
              x
            </button>
          )}
        </div>

        {/* Award menu */}
        {showAwardMenu && (
          <div className="nigdit-award-menu" onClick={(e) => e.stopPropagation()}>
            {awardTypes.map((t) => (
              <button
                key={t.key}
                className={`nigdit-award-option award-${t.key}`}
                onClick={() => void handleAward(t.key)}
                disabled={awarding}
              >
                <span className="nigdit-award-label">{t.label}</span>
                <span className="nigdit-award-cost">{Math.round(t.cost / 1024 / 1024)}MB</span>
                <span className="nigdit-award-aura">{t.aura > 0 ? "+" : ""}{t.aura} aura</span>
              </button>
            ))}
            <button className="nigdit-award-option" onClick={() => setShowAwardMenu(false)}>cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
