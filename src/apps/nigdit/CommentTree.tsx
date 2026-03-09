import { useState } from "react";
import {
  voteNigdit, createNigditComment, deleteNigditComment, editNigditComment,
  giveNigditAward, getNigditAwardTypes, ApiError,
} from "@/lib/api";
import type { NigditComment, NigditAwardType } from "@/lib/api";

const MAX_RENDER_DEPTH = 5;

interface CommentTreeProps {
  comments: NigditComment[];
  postId: number;
  postAuthorId: number;
  currentUserId: number;
  isAdmin: boolean;
  onCommentAdded: (comment: NigditComment) => void;
  onCommentDeleted: (commentId: number) => void;
  onCommentVoted: (commentId: number, score: number, myVote: number) => void;
  onCommentUpdated: (commentId: number, body: string) => void;
  onOpenProfile: (username: string) => void;
}

function scoreBadge(score: number): string | null {
  if (score === 69) return "nice.";
  if (score === 420) return "blazed";
  if (score === -69) return "deserved lmao";
  return null;
}

function buildTree(comments: NigditComment[]): Map<number | null, NigditComment[]> {
  const map = new Map<number | null, NigditComment[]>();
  for (const c of comments) {
    const parentKey = c.parent_id;
    const existing = map.get(parentKey) ?? [];
    existing.push(c);
    map.set(parentKey, existing);
  }
  return map;
}

interface SingleCommentProps {
  comment: NigditComment;
  tree: Map<number | null, NigditComment[]>;
  postId: number;
  postAuthorId: number;
  currentUserId: number;
  isAdmin: boolean;
  onCommentAdded: (comment: NigditComment) => void;
  onCommentDeleted: (commentId: number) => void;
  onCommentVoted: (commentId: number, score: number, myVote: number) => void;
  onCommentUpdated: (commentId: number, body: string) => void;
  onOpenProfile: (username: string) => void;
}

function SingleComment({
  comment, tree, postId, postAuthorId, currentUserId, isAdmin,
  onCommentAdded, onCommentDeleted, onCommentVoted, onCommentUpdated, onOpenProfile,
}: SingleCommentProps) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyAnon, setReplyAnon] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [editSaving, setEditSaving] = useState(false);
  const [showAwardMenu, setShowAwardMenu] = useState(false);
  const [awardTypes, setAwardTypes] = useState<NigditAwardType[]>([]);
  const [awarding, setAwarding] = useState(false);

  const handleVote = async (value: 1 | -1) => {
    if (voting || comment.user_id === currentUserId) return;
    setVoting(true);
    try {
      const result = await voteNigdit(comment.id, "comment", value);
      onCommentVoted(comment.id, result.score, result.my_vote);
    } catch { /* silent */ }
    finally { setVoting(false); }
  };

  const handleReply = async () => {
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const result = await createNigditComment(postId, replyBody.trim(), comment.id, replyAnon);
      onCommentAdded(result.comment);
      setReplyBody("");
      setReplying(false);
      setReplyAnon(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "reply failed");
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    try {
      await deleteNigditComment(comment.id);
      onCommentDeleted(comment.id);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "delete failed");
    }
  };

  const handleEdit = async () => {
    if (!editBody.trim() || editSaving) return;
    setEditSaving(true);
    try {
      await editNigditComment(comment.id, editBody.trim());
      onCommentUpdated(comment.id, editBody.trim());
      setEditing(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "edit failed");
    } finally { setEditSaving(false); }
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
      await giveNigditAward(awardType, undefined, comment.id);
      setShowAwardMenu(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "award failed");
    } finally { setAwarding(false); }
  };

  const badge = scoreBadge(comment.score);
  const canDelete = comment.user_id === currentUserId || isAdmin;
  const canEdit = comment.user_id === currentUserId;
  const childComments = tree.get(comment.id) ?? [];
  const renderDepth = Math.min(comment.depth, MAX_RENDER_DEPTH);

  return (
    <div className="nigdit-comment" style={{ marginLeft: renderDepth > 0 ? 20 : 0 }}>
      <div className="nigdit-comment-line">
        <div className="nigdit-comment-vote">
          <button
            className={`nigdit-vote-btn-sm nigdit-vote-up${comment.my_vote === 1 ? " active" : ""}`}
            onClick={() => void handleVote(1)}
            disabled={voting || comment.user_id === currentUserId}
          >
            ▲
          </button>
          <span className={`nigdit-score-sm${comment.score > 0 ? " positive" : comment.score < 0 ? " negative" : ""}`}>
            {comment.score}
          </span>
          <button
            className={`nigdit-vote-btn-sm nigdit-vote-down${comment.my_vote === -1 ? " active" : ""}`}
            onClick={() => void handleVote(-1)}
            disabled={voting || comment.user_id === currentUserId}
          >
            ▼
          </button>
          {badge && <span className="nigdit-badge-sm">{badge}</span>}
        </div>

        <div className="nigdit-comment-body">
          <div className="nigdit-comment-header">
            <span
              className={`nigdit-author${comment.is_anonymous ? " anon" : ""}`}
              onClick={() => { if (!comment.is_anonymous) onOpenProfile(comment.username); }}
              style={{ cursor: comment.is_anonymous ? "default" : "pointer" }}
            >
              @{comment.username}
              {comment.is_op && <span className="nigdit-op-badge">OP</span>}
              {comment.is_anonymous && <span className="nigdit-anon-badge">anon</span>}
              <span className="nigdit-aura">{comment.author_aura}</span>
            </span>
            <span className="nigdit-time">{comment.time_ago}</span>
            {comment.is_edited && <span className="nigdit-edited-badge">edited</span>}
          </div>

          {editing ? (
            <div className="nigdit-edit-inline">
              <textarea
                className="nigdit-textarea nigdit-reply-input"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="nigdit-reply-actions">
                <button className="btn" onClick={() => setEditing(false)}>cancel</button>
                <button className="btn btn-primary" onClick={() => void handleEdit()} disabled={editSaving}>
                  {editSaving ? "..." : "save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="nigdit-comment-text">{comment.body}</div>
          )}

          {/* Awards display */}
          {comment.awards.length > 0 && (
            <div className="nigdit-awards-row">
              {comment.awards.map((a) => (
                <span key={a.award_type} className={`nigdit-award-badge award-${a.award_type}`}>
                  {a.award_type}{a.count > 1 ? ` x${a.count}` : ""}
                </span>
              ))}
            </div>
          )}

          <div className="nigdit-comment-actions">
            {comment.depth < MAX_RENDER_DEPTH && (
              <button className="nigdit-action-btn" onClick={() => setReplying(!replying)}>
                reply
              </button>
            )}
            {comment.user_id !== currentUserId && (
              <button className="nigdit-action-btn" onClick={() => void openAwardMenu()}>award</button>
            )}
            {canEdit && !editing && (
              <button className="nigdit-action-btn" onClick={() => { setEditing(true); setEditBody(comment.body); }}>
                edit
              </button>
            )}
            {canDelete && (
              <button className="nigdit-action-btn nigdit-action-delete" onClick={() => void handleDelete()}>
                delete
              </button>
            )}
          </div>

          {/* Award menu */}
          {showAwardMenu && (
            <div className="nigdit-award-menu">
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

      {replying && (
        <div className="nigdit-reply-form">
          <textarea
            className="nigdit-textarea nigdit-reply-input"
            placeholder="reply..."
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="nigdit-reply-actions">
            <label className="nigdit-anon-toggle">
              <input type="checkbox" checked={replyAnon} onChange={(e) => setReplyAnon(e.target.checked)} />
              anon
            </label>
            <button className="btn" onClick={() => { setReplying(false); setReplyBody(""); }}>
              cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleReply()}
              disabled={submitting || !replyBody.trim()}
            >
              {submitting ? "..." : "reply"}
            </button>
          </div>
        </div>
      )}

      {childComments.map((child) => (
        <SingleComment
          key={child.id}
          comment={child}
          tree={tree}
          postId={postId}
          postAuthorId={postAuthorId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onCommentAdded={onCommentAdded}
          onCommentDeleted={onCommentDeleted}
          onCommentVoted={onCommentVoted}
          onCommentUpdated={onCommentUpdated}
          onOpenProfile={onOpenProfile}
        />
      ))}
    </div>
  );
}

export function CommentTree({
  comments, postId, postAuthorId, currentUserId, isAdmin,
  onCommentAdded, onCommentDeleted, onCommentVoted, onCommentUpdated, onOpenProfile,
}: CommentTreeProps) {
  const tree = buildTree(comments);
  const rootComments = tree.get(null) ?? [];

  if (comments.length === 0) {
    return <div className="nigdit-no-comments">no comments yet. be the first degenerate.</div>;
  }

  return (
    <div className="nigdit-comment-tree">
      {rootComments.map((c) => (
        <SingleComment
          key={c.id}
          comment={c}
          tree={tree}
          postId={postId}
          postAuthorId={postAuthorId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onCommentAdded={onCommentAdded}
          onCommentDeleted={onCommentDeleted}
          onCommentVoted={onCommentVoted}
          onCommentUpdated={onCommentUpdated}
          onOpenProfile={onOpenProfile}
        />
      ))}
    </div>
  );
}
