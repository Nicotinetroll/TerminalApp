import { useState, useRef } from "react";
import { createNigditPost, ApiError } from "@/lib/api";
import type { NigditPost } from "@/lib/api";

interface ComposePostProps {
  boards: string[];
  onCancel: () => void;
  onCreated: (post: NigditPost) => void;
}

const MAX_FILES = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"];

type PostType = "text" | "poll" | "hottake";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ComposePost({ boards, onCancel, onCreated }: ComposePostProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [board, setBoard] = useState<string>(boards[0] ?? "general");
  const [postType, setPostType] = useState<PostType>("text");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]!;
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError(`${f.name}: type not allowed. use jpg/png/gif/webp/mp4/webm`);
        return;
      }
      if (f.size > MAX_FILE_SIZE) {
        setError(`${f.name}: too large (max 10MB)`);
        return;
      }
      newFiles.push(f);
    }
    if (files.length + newFiles.length > MAX_FILES) {
      setError(`max ${MAX_FILES} attachments`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const addPollOption = () => {
    if (pollOptions.length < 10) setPollOptions([...pollOptions, ""]);
  };

  const removePollOption = (idx: number) => {
    if (pollOptions.length > 2) setPollOptions(pollOptions.filter((_, i) => i !== idx));
  };

  const updatePollOption = (idx: number, value: string) => {
    setPollOptions(pollOptions.map((o, i) => (i === idx ? value : o)));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("title is required, even for shitposts.");
      return;
    }
    if (postType === "poll") {
      const validOpts = pollOptions.filter(o => o.trim().length > 0);
      if (validOpts.length < 2) {
        setError("polls need at least 2 options. not that hard.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createNigditPost({
        title: title.trim(),
        body: body.trim(),
        board,
        post_type: postType,
        is_anonymous: isAnonymous,
        poll_options: postType === "poll" ? pollOptions.filter(o => o.trim().length > 0) : undefined,
        attachments: files.length > 0 ? files : undefined,
      });
      onCreated(result.post);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create post");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="nigdit-compose">
      <div className="nigdit-compose-header">
        <h3>new post</h3>
        <button className="btn" onClick={onCancel}>cancel</button>
      </div>

      {error && <div className="nigdit-error">{error}</div>}

      {/* Post type selector */}
      <div className="nigdit-compose-types">
        {(["text", "poll", "hottake"] as const).map((t) => (
          <button
            key={t}
            className={`nigdit-type-btn${postType === t ? " active" : ""}`}
            onClick={() => setPostType(t)}
          >
            {t === "hottake" ? "hot take" : t}
          </button>
        ))}
      </div>

      {postType === "hottake" && (
        <div className="nigdit-hottake-notice">
          hot takes self-destruct in 24 hours. say what you mean.
        </div>
      )}

      <div className="nigdit-compose-field">
        <label>board</label>
        <select
          className="nigdit-select"
          value={board}
          onChange={(e) => setBoard(e.target.value)}
        >
          {boards.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      <div className="nigdit-compose-field">
        <label>title</label>
        <input
          className="nigdit-input"
          type="text"
          placeholder="what's on your mind..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
        />
      </div>

      <div className="nigdit-compose-field">
        <label>body <span className="nigdit-hint">(optional)</span></label>
        <textarea
          className="nigdit-textarea"
          placeholder="elaborate if you must..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={postType === "poll" ? 3 : 6}
          maxLength={10000}
        />
      </div>

      {/* Poll options */}
      {postType === "poll" && (
        <div className="nigdit-compose-field">
          <label>poll options <span className="nigdit-hint">(min 2, max 10)</span></label>
          <div className="nigdit-poll-options">
            {pollOptions.map((opt, idx) => (
              <div key={idx} className="nigdit-poll-option-input">
                <input
                  className="nigdit-input"
                  value={opt}
                  onChange={(e) => updatePollOption(idx, e.target.value)}
                  placeholder={`option ${idx + 1}`}
                />
                {pollOptions.length > 2 && (
                  <button className="nigdit-poll-remove" onClick={() => removePollOption(idx)}>x</button>
                )}
              </div>
            ))}
            {pollOptions.length < 10 && (
              <button className="btn" onClick={addPollOption} style={{ fontSize: 11, marginTop: 4 }}>
                + add option
              </button>
            )}
          </div>
        </div>
      )}

      {/* Attachments (not for polls) */}
      {postType !== "poll" && (
        <div className="nigdit-compose-field">
          <label>attachments <span className="nigdit-hint">(images/videos, max {MAX_FILES}, max 10MB each)</span></label>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="nigdit-file-area">
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={files.length >= MAX_FILES}>
              + add files
            </button>
            {files.length > 0 && (
              <div className="nigdit-file-list">
                {files.map((f, i) => (
                  <div key={i} className="nigdit-file-item">
                    <span className="nigdit-file-name">{f.name}</span>
                    <span className="nigdit-file-size">{formatSize(f.size)}</span>
                    <button className="nigdit-file-remove" onClick={() => removeFile(i)}>x</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="nigdit-compose-actions">
        <label className="nigdit-anon-toggle">
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
          post anonymously
        </label>
        <span className="nigdit-hint">{title.length}/200</span>
        <button
          className="btn btn-primary"
          onClick={() => void handleSubmit()}
          disabled={submitting || !title.trim()}
        >
          {submitting ? "posting..." : "post it"}
        </button>
      </div>
    </div>
  );
}
