import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { NigditPost, NigditComment, NigditBoard, NigditNotification, NigditUserProfile, NigditUserProfilePost } from "@/lib/api";
import {
  getNigditPosts, getNigditPost, getNigditBoards, createNigditComment,
  getNigditNotifications, getNigditNotificationCount, markNigditNotificationsRead,
  getNigditUserProfile, toggleNigditBookmark, ApiError,
} from "@/lib/api";
import { PostCard } from "./PostCard";
import { CommentTree } from "./CommentTree";
import { ComposePost } from "./ComposePost";

type View = "feed" | "thread" | "compose" | "profile" | "notifications";
type Sort = "hot" | "top" | "new";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";

function scoreBadge(score: number): string | null {
  if (score === 69) return "nice.";
  if (score === 420) return "blazed";
  if (score === -69) return "deserved lmao";
  return null;
}

function isImage(mime: string): boolean { return mime.startsWith("image/"); }
function isVideo(mime: string): boolean { return mime.startsWith("video/"); }

function auraMilestone(total: number): string | null {
  if (total >= 1337) return "elite hacker";
  if (total >= 1000) return "legendary";
  if (total >= 500) return "based";
  if (total >= 100) return "rising";
  return null;
}

function fmtTimeRemaining(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function NigditPanel({ user }: WindowContentProps) {
  const [view, setView] = useState<View>("feed");
  const [boards, setBoards] = useState<NigditBoard[]>([]);
  const [board, setBoard] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("hot");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);

  const [posts, setPosts] = useState<NigditPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Thread state
  const [threadPost, setThreadPost] = useState<NigditPost | null>(null);
  const [threadComments, setThreadComments] = useState<NigditComment[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentAnon, setCommentAnon] = useState(false);

  // Notifications
  const [notifCount, setNotifCount] = useState(0);
  const [notifications, setNotifications] = useState<NigditNotification[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);

  // Profile
  const [profileData, setProfileData] = useState<NigditUserProfile | null>(null);
  const [profilePosts, setProfilePosts] = useState<NigditUserProfilePost[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Load boards on mount
  useEffect(() => {
    void getNigditBoards().then(setBoards).catch(() => {});
  }, []);

  // Poll notification count
  useEffect(() => {
    void getNigditNotificationCount().then(setNotifCount).catch(() => {});
    const iv = setInterval(() => {
      void getNigditNotificationCount().then(setNotifCount).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  const loadPosts = useCallback(async (appendPage?: number) => {
    const isAppend = appendPage !== undefined;
    if (isAppend) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const data = await getNigditPosts(board, sort, appendPage ?? 1, search, bookmarksOnly);
      if (isAppend) {
        setPosts((prev) => [...prev, ...data.posts]);
      } else {
        setPosts(data.posts);
      }
      setTotalPages(data.pages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load posts");
    } finally {
      if (isAppend) setLoadingMore(false); else setLoading(false);
    }
  }, [board, sort, search, bookmarksOnly]);

  useEffect(() => {
    if (view === "feed") { setPage(1); void loadPosts(); }
  }, [view, loadPosts]);

  // Infinite scroll
  useEffect(() => {
    if (view !== "feed" || !sentinelRef.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore && page < totalPages) {
        const nextPage = page + 1;
        setPage(nextPage);
        void loadPosts(nextPage);
      }
    }, { threshold: 0.1 });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [view, page, totalPages, loadingMore, loadPosts]);

  const openThread = useCallback(async (postId: number) => {
    setThreadLoading(true);
    setView("thread");
    try {
      const data = await getNigditPost(postId);
      setThreadPost(data.post);
      setThreadComments(data.comments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load thread");
      setView("feed");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const handlePostUpdated = useCallback((postId: number, updates: Partial<NigditPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...updates } : p)));
    if (threadPost && threadPost.id === postId) setThreadPost({ ...threadPost, ...updates });
  }, [threadPost]);

  const handlePostDeleted = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const handleCommentAdded = useCallback((comment: NigditComment) => {
    setThreadComments((prev) => [...prev, comment]);
    if (threadPost) {
      setThreadPost({ ...threadPost, comment_count: threadPost.comment_count + 1 });
    }
  }, [threadPost]);

  const handleCommentDeleted = useCallback((commentId: number) => {
    setThreadComments((prev) => prev.filter((c) => c.id !== commentId));
    if (threadPost) {
      setThreadPost({ ...threadPost, comment_count: Math.max(0, threadPost.comment_count - 1) });
    }
  }, [threadPost]);

  const handleCommentVoted = useCallback((commentId: number, score: number, myVote: number) => {
    setThreadComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, score, my_vote: myVote } : c))
    );
  }, []);

  const handleCommentUpdated = useCallback((commentId: number, body: string) => {
    setThreadComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, body, is_edited: true } : c))
    );
  }, []);

  const handleSubmitComment = async () => {
    if (!commentBody.trim() || !threadPost || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      const result = await createNigditComment(threadPost.id, commentBody.trim(), undefined, commentAnon);
      handleCommentAdded(result.comment);
      setCommentBody("");
      setCommentAnon(false);
    } catch (err) {
      console.error(err instanceof ApiError ? err.message : "comment failed");
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handlePostCreated = useCallback((post: NigditPost) => {
    setView("feed");
    setPosts((prev) => [post, ...prev]);
  }, []);

  const handleBookmark = useCallback(async (postId: number) => {
    try {
      const result = await toggleNigditBookmark(postId);
      handlePostUpdated(postId, { bookmarked: result.bookmarked });
    } catch { /* silent */ }
  }, [handlePostUpdated]);

  const openProfile = useCallback(async (username: string) => {
    setProfileLoading(true);
    setView("profile");
    try {
      const data = await getNigditUserProfile(username);
      setProfileData(data.user);
      setProfilePosts(data.posts);
    } catch {
      setView("feed");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const openNotifications = useCallback(async () => {
    setNotifsLoading(true);
    setView("notifications");
    try {
      const data = await getNigditNotifications();
      setNotifications(data);
      await markNigditNotificationsRead();
      setNotifCount(0);
    } catch { /* silent */ }
    finally { setNotifsLoading(false); }
  }, []);

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const boardNames = boards.map((b) => b.name);

  // Lightbox overlay
  const lightbox = lightboxSrc ? (
    <div className="nigdit-lightbox" onClick={() => setLightboxSrc(null)}>
      <img src={lightboxSrc} alt="" className="nigdit-lightbox-img" />
      <button className="nigdit-lightbox-close" onClick={() => setLightboxSrc(null)}>x</button>
    </div>
  ) : null;

  if (view === "compose") {
    return (
      <div className="nigdit-container">
        <ComposePost
          boards={boardNames}
          onCancel={() => setView("feed")}
          onCreated={handlePostCreated}
        />
      </div>
    );
  }

  if (view === "notifications") {
    return (
      <div className="nigdit-container">
        <div className="nigdit-thread-header">
          <button className="btn" onClick={() => setView("feed")}>back</button>
          <span className="nigdit-header-title">notifications</span>
        </div>
        {notifsLoading ? (
          <div className="nigdit-loading"><span className="spinner" /> loading...</div>
        ) : notifications.length === 0 ? (
          <div className="nigdit-empty">no notifications. nobody cares about you yet.</div>
        ) : (
          <div className="nigdit-notif-list">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`nigdit-notif-item${n.is_read ? "" : " unread"}${n.meme_id ? " meme-notif" : ""}`}
                onClick={() => { if (n.post_id) void openThread(n.post_id); }}
              >
                <div className="nigdit-notif-msg">
                  <span className="nigdit-notif-from">@{n.from_username}</span>
                  {" "}{n.message}
                </div>
                <div className="nigdit-notif-time">{n.time_ago}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === "profile") {
    const milestone = profileData ? auraMilestone(profileData.aura.total) : null;
    return (
      <div className="nigdit-container">
        <div className="nigdit-thread-header">
          <button className="btn" onClick={() => setView("feed")}>back</button>
          <span className="nigdit-header-title">user profile</span>
        </div>
        {profileLoading ? (
          <div className="nigdit-loading"><span className="spinner" /> loading...</div>
        ) : profileData ? (
          <div className="nigdit-profile">
            <div className="nigdit-profile-header">
              <h2 className="nigdit-profile-name">@{profileData.username}</h2>
              {milestone && <span className="nigdit-milestone">{milestone}</span>}
            </div>
            <div className="nigdit-profile-stats">
              <div className="nigdit-profile-stat">
                <span className="nigdit-profile-stat-val">{profileData.aura.total}</span>
                <span className="nigdit-profile-stat-label">aura</span>
              </div>
              <div className="nigdit-profile-stat">
                <span className="nigdit-profile-stat-val">{profileData.post_count}</span>
                <span className="nigdit-profile-stat-label">posts</span>
              </div>
              <div className="nigdit-profile-stat">
                <span className="nigdit-profile-stat-val">{profileData.comment_count}</span>
                <span className="nigdit-profile-stat-label">comments</span>
              </div>
              <div className="nigdit-profile-stat">
                <span className="nigdit-profile-stat-val">{profileData.awards_received}</span>
                <span className="nigdit-profile-stat-label">awards</span>
              </div>
              {profileData.streak > 0 && (
                <div className="nigdit-profile-stat">
                  <span className="nigdit-profile-stat-val">{profileData.streak}d</span>
                  <span className="nigdit-profile-stat-label">streak</span>
                </div>
              )}
            </div>
            <div className="nigdit-profile-aura-detail">
              post aura: {profileData.aura.post_aura} | comment aura: {profileData.aura.comment_aura}
            </div>
            {profilePosts.length > 0 && (
              <>
                <h4 className="nigdit-profile-section">recent posts</h4>
                <div className="nigdit-profile-posts">
                  {profilePosts.map((p) => (
                    <div key={p.id} className="nigdit-profile-post" onClick={() => void openThread(p.id)}>
                      <span className="nigdit-profile-post-score">{p.score}</span>
                      <span className="nigdit-profile-post-title">
                        {p.is_pinned && <span className="nigdit-pin-badge">pin</span>}
                        {p.title}
                      </span>
                      <span className="nigdit-board-tag">{p.board}</span>
                      <span className="nigdit-time">{p.time_ago}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="nigdit-empty">user not found</div>
        )}
      </div>
    );
  }

  if (view === "thread") {
    const badge = threadPost ? scoreBadge(threadPost.score) : null;
    return (
      <div className="nigdit-container">
        {lightbox}
        <div className="nigdit-thread-header">
          <button className="btn" onClick={() => { setView("feed"); setThreadPost(null); setThreadComments([]); }}>
            back
          </button>
        </div>

        {threadLoading ? (
          <div className="nigdit-loading"><span className="spinner" /> loading thread...</div>
        ) : threadPost ? (
          <div className="nigdit-thread" ref={feedRef}>
            <div className="nigdit-thread-post">
              <div className="nigdit-thread-top-row">
                {threadPost.is_pinned && <span className="nigdit-pin-badge">pinned</span>}
                {threadPost.post_type === "hottake" && threadPost.time_remaining != null && (
                  <span className="nigdit-hottake-badge">{fmtTimeRemaining(threadPost.time_remaining)}</span>
                )}
                {threadPost.is_edited && <span className="nigdit-edited-badge">edited</span>}
              </div>
              <div className="nigdit-thread-vote">
                <span className={`nigdit-score${threadPost.score > 0 ? " positive" : threadPost.score < 0 ? " negative" : ""}`}>
                  {threadPost.score} pts
                </span>
                {badge && <span className="nigdit-badge">{badge}</span>}
              </div>
              <div className="nigdit-board-tag">{threadPost.board}</div>
              <h2 className="nigdit-thread-title">{threadPost.title}</h2>
              {threadPost.body && <div className="nigdit-thread-body">{threadPost.body}</div>}

              {/* Awards display */}
              {threadPost.awards.length > 0 && (
                <div className="nigdit-awards-row">
                  {threadPost.awards.map((a) => (
                    <span key={a.award_type} className={`nigdit-award-badge award-${a.award_type}`}>
                      {a.award_type} {a.count > 1 ? `x${a.count}` : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Poll */}
              {threadPost.poll && (
                <div className="nigdit-poll">
                  {threadPost.poll.options.map((opt) => {
                    const pct = threadPost.poll!.total_votes > 0 ? Math.round((opt.vote_count / threadPost.poll!.total_votes) * 100) : 0;
                    const isMyVote = threadPost.poll!.my_vote === opt.id;
                    return (
                      <div key={opt.id} className={`nigdit-poll-option${isMyVote ? " voted" : ""}`}>
                        <div className="nigdit-poll-bar" style={{ width: `${pct}%` }} />
                        <span className="nigdit-poll-label">{opt.label}</span>
                        <span className="nigdit-poll-pct">{pct}%</span>
                      </div>
                    );
                  })}
                  <div className="nigdit-poll-total">{threadPost.poll.total_votes} votes</div>
                </div>
              )}

              {threadPost.attachments && threadPost.attachments.length > 0 && (
                <div className="nigdit-attachments">
                  {threadPost.attachments.map((a) => (
                    <div key={a.id} className="nigdit-attachment">
                      {isImage(a.mime_type) ? (
                        <img
                          src={`${API_BASE}/nigdit/attachments/${a.id}`}
                          alt={a.filename}
                          className="nigdit-attachment-img"
                          onClick={() => setLightboxSrc(`${API_BASE}/nigdit/attachments/${a.id}`)}
                          style={{ cursor: "pointer" }}
                        />
                      ) : isVideo(a.mime_type) ? (
                        <video src={`${API_BASE}/nigdit/attachments/${a.id}`} controls className="nigdit-attachment-video" />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <div className="nigdit-post-meta">
                <span
                  className={`nigdit-author${threadPost.is_anonymous ? " anon" : ""}`}
                  onClick={(e) => { e.stopPropagation(); if (!threadPost.is_anonymous) void openProfile(threadPost.username); }}
                  style={{ cursor: threadPost.is_anonymous ? "default" : "pointer" }}
                >
                  @{threadPost.username}
                  {threadPost.is_anonymous && <span className="nigdit-anon-badge">anon</span>}
                  <span className="nigdit-aura">{threadPost.author_aura}</span>
                </span>
                <span className="nigdit-time">{threadPost.time_ago}</span>
                <span className="nigdit-comments">{threadPost.comment_count} comments</span>
                <button
                  className={`nigdit-action-btn${threadPost.bookmarked ? " bookmarked" : ""}`}
                  onClick={() => void handleBookmark(threadPost.id)}
                >
                  {threadPost.bookmarked ? "saved" : "save"}
                </button>
              </div>
            </div>

            <div className="nigdit-divider" />

            <div className="nigdit-comment-input-section">
              <textarea
                className="nigdit-textarea"
                placeholder="drop a comment..."
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
              />
              <div className="nigdit-comment-input-actions">
                <label className="nigdit-anon-toggle">
                  <input type="checkbox" checked={commentAnon} onChange={(e) => setCommentAnon(e.target.checked)} />
                  anon
                </label>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleSubmitComment()}
                  disabled={commentSubmitting || !commentBody.trim()}
                >
                  {commentSubmitting ? "..." : "comment"}
                </button>
              </div>
            </div>

            <CommentTree
              comments={threadComments}
              postId={threadPost.id}
              postAuthorId={threadPost.user_id}
              currentUserId={user.id}
              isAdmin={user.role === "admin"}
              onCommentAdded={handleCommentAdded}
              onCommentDeleted={handleCommentDeleted}
              onCommentVoted={handleCommentVoted}
              onCommentUpdated={handleCommentUpdated}
              onOpenProfile={openProfile}
            />
          </div>
        ) : (
          <div className="nigdit-empty">post not found. it probably got deleted.</div>
        )}
      </div>
    );
  }

  // Feed view
  return (
    <div className="nigdit-container">
      {lightbox}
      <div className="nigdit-toolbar">
        <div className="nigdit-boards">
          <button
            className={`nigdit-board-btn${board === "all" && !bookmarksOnly ? " active" : ""}`}
            onClick={() => { setBoard("all"); setBookmarksOnly(false); setPage(1); }}
          >
            all
          </button>
          {boardNames.map((b) => (
            <button
              key={b}
              className={`nigdit-board-btn${board === b && !bookmarksOnly ? " active" : ""}`}
              onClick={() => { setBoard(b); setBookmarksOnly(false); setPage(1); }}
            >
              {b}
            </button>
          ))}
          <button
            className={`nigdit-board-btn${bookmarksOnly ? " active" : ""}`}
            onClick={() => { setBookmarksOnly(!bookmarksOnly); setPage(1); }}
          >
            saved
          </button>
        </div>
        <div className="nigdit-toolbar-right">
          <div className="nigdit-search">
            <input
              className="nigdit-search-input"
              placeholder="search..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            />
            {search && (
              <button className="nigdit-search-clear" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>x</button>
            )}
          </div>
          <div className="nigdit-sort">
            {(["hot", "top", "new"] as const).map((s) => (
              <button
                key={s}
                className={`nigdit-sort-btn${sort === s ? " active" : ""}`}
                onClick={() => { setSort(s); setPage(1); }}
              >
                {s}
              </button>
            ))}
          </div>
          <button className="nigdit-notif-btn" onClick={() => void openNotifications()}>
            notif{notifCount > 0 && <span className="nigdit-notif-count">{notifCount}</span>}
          </button>
          <button className="btn btn-primary" onClick={() => setView("compose")}>
            + new post
          </button>
        </div>
      </div>

      {error && <div className="nigdit-error">{error}</div>}
      {search && <div className="nigdit-search-tag">results for "{search}"</div>}

      {loading ? (
        <div className="nigdit-loading"><span className="spinner" /> loading nigdit...</div>
      ) : posts.length === 0 ? (
        <div className="nigdit-empty">
          {bookmarksOnly ? "no saved posts. start bookmarking, you selfish reader." : "no posts yet. be the pioneer of this wasteland."}
        </div>
      ) : (
        <div className="nigdit-feed" ref={feedRef}>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user.id}
              isAdmin={user.role === "admin"}
              onOpenThread={openThread}
              onPostUpdated={handlePostUpdated}
              onPostDeleted={handlePostDeleted}
              onBookmark={handleBookmark}
              onOpenProfile={openProfile}
              onLightbox={setLightboxSrc}
            />
          ))}

          {loadingMore && (
            <div className="nigdit-loading"><span className="spinner" /> loading more...</div>
          )}
          <div ref={sentinelRef} style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
}
