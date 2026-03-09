import { useState, useEffect, useRef, useCallback } from "react";
import type { EmailAddress, ContactSuggestion } from "@/lib/api";
import { sendEmail, saveDraft, suggestContacts, ApiError } from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface Props {
  addresses: EmailAddress[];
  replyTo: { to: string; subject: string; in_reply_to?: string } | null;
  forwardData?: { subject: string; body: string } | null;
  draftId?: number;
  onSent: () => void;
  onCancel: () => void;
  showStatus: (text: string, isError?: boolean) => void;
}

export function ComposeView({ addresses, replyTo, forwardData, draftId: initialDraftId, onSent, onCancel, showStatus }: Props) {
  const [to, setTo] = useState(replyTo?.to ?? "");
  const [subject, setSubject] = useState(replyTo?.subject ?? forwardData?.subject ?? "");
  const [fromAddr, setFromAddr] = useState(addresses[0]?.address ?? "");
  const currentAddr = addresses.find(a => a.address === fromAddr) ?? addresses[0];
  const [fromName, setFromName] = useState(currentAddr?.display_name ?? "MyNigga");
  const [sending, setSending] = useState(false);
  const [draftId, setDraftId] = useState<number | undefined>(initialDraftId);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef("");

  // Signature: auto-append on new compose (not reply/forward/draft)
  const getSignature = useCallback(() => {
    const addr = addresses.find(a => a.address === fromAddr) ?? addresses[0];
    return addr?.signature ?? "";
  }, [addresses, fromAddr]);

  const [body, setBody] = useState(() => {
    if (forwardData?.body) return forwardData.body;
    // Append signature for new emails only
    if (!replyTo && !forwardData && !initialDraftId) {
      const sig = (addresses.find(a => a.address === (addresses[0]?.address ?? "")) ?? addresses[0])?.signature ?? "";
      return sig ? `\n\n--\n${sig}` : "";
    }
    return "";
  });

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const suggestRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  const handleFromChange = (addr: string) => {
    setFromAddr(addr);
    const matched = addresses.find(a => a.address === addr);
    if (matched) setFromName(matched.display_name);

    // Update signature in body
    const oldSig = getSignature();
    const newAddr = addresses.find(a => a.address === addr);
    const newSig = newAddr?.signature ?? "";
    if (oldSig && body.endsWith(`\n\n--\n${oldSig}`)) {
      setBody(prev => {
        const base = prev.slice(0, prev.length - `\n\n--\n${oldSig}`.length);
        return newSig ? `${base}\n\n--\n${newSig}` : base;
      });
    }
  };

  // To field autocomplete
  const handleToChange = (value: string) => {
    setTo(value);
    setSelectedSuggestion(0);

    if (suggestRef.current) clearTimeout(suggestRef.current);

    // Get the current token being typed (after last comma)
    const currentToken = value.split(",").pop()?.trim() ?? "";
    if (currentToken.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    suggestRef.current = setTimeout(async () => {
      try {
        const results = await suggestContacts(currentToken);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
  };

  const applySuggestion = (suggestion: ContactSuggestion) => {
    const parts = to.split(",").map(p => p.trim());
    parts[parts.length - 1] = suggestion.address;
    setTo(parts.join(", ") + ", ");
    setSuggestions([]);
    setShowSuggestions(false);
    toInputRef.current?.focus();
  };

  const handleToKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const sel = suggestions[selectedSuggestion];
      if (sel) {
        e.preventDefault();
        applySuggestion(sel);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  // Auto-save draft every 30s
  const doAutoSave = useCallback(async () => {
    const content = JSON.stringify({ to, subject, body, fromAddr });
    if (content === lastSavedRef.current) return;
    if (!to && !subject && !body) return;
    try {
      const result = await saveDraft({ to, subject, body, from_address: fromAddr, id: draftId });
      if (result.id) setDraftId(result.id);
      lastSavedRef.current = content;
    } catch {
      // silent
    }
  }, [to, subject, body, fromAddr, draftId]);

  useEffect(() => {
    autoSaveRef.current = setInterval(() => { void doAutoSave(); }, 30_000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [doAutoSave]);

  const handleSaveDraft = async () => {
    try {
      const result = await saveDraft({ to, subject, body, from_address: fromAddr, id: draftId });
      if (result.id) setDraftId(result.id);
      showStatus("draft saved");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't save draft", true);
    }
  };

  const handleSend = async () => {
    if (!to.trim()) {
      showStatus("who are you sending this to?", true);
      return;
    }
    if (!body.trim()) {
      showStatus("write something first, you philosopher.", true);
      return;
    }

    setSending(true);
    try {
      const result = await sendEmail({
        to: to.trim().replace(/,\s*$/, ""),
        subject: subject.trim(),
        body: body.trim(),
        from_address: fromAddr,
        from_name: fromName.trim() || undefined,
        in_reply_to: replyTo?.in_reply_to,
        attachments: attachedFiles.length > 0 ? attachedFiles : undefined,
      });

      // Delete draft if it was saved
      if (draftId) {
        try {
          const { deleteEmail } = await import("@/lib/api");
          await deleteEmail(draftId);
        } catch { /* ignore */ }
      }

      if (result.easter_egg) {
        showStatus(result.easter_egg);
      } else {
        showStatus("sent!");
      }
      onSent();
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't send", true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mail-compose">
      <div className="mail-compose-header">
        <h3>{replyTo ? "reply" : forwardData ? "forward" : "new email"}</h3>
        <div className="mail-compose-actions">
          <button className="btn" onClick={() => void handleSaveDraft()} disabled={sending}>
            save draft
          </button>
          <button className="btn" onClick={onCancel} disabled={sending}>
            cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleSend()}
            disabled={sending || !to.trim() || !body.trim()}
          >
            {sending ? "sending..." : "send"}
          </button>
        </div>
      </div>

      <div className="mail-compose-fields">
        <div className="mail-compose-field">
          <label>from</label>
          <div style={{ display: "flex", gap: "8px", flex: 1 }}>
            <input
              type="text"
              value={fromName}
              onChange={e => setFromName(e.target.value)}
              placeholder="display name"
              disabled={sending}
              style={{ flex: "0 0 140px" }}
            />
            {addresses.length > 1 ? (
              <select
                value={fromAddr}
                onChange={e => handleFromChange(e.target.value)}
                className="mail-compose-select"
                style={{ flex: 1 }}
              >
                {addresses.map(a => (
                  <option key={a.id} value={a.address}>{a.full}</option>
                ))}
              </select>
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "13px", display: "flex", alignItems: "center" }}>
                &lt;{currentAddr?.full}&gt;
              </span>
            )}
          </div>
        </div>

        <div className="mail-compose-field" style={{ position: "relative" }}>
          <label>to</label>
          <input
            ref={toInputRef}
            type="text"
            value={to}
            onChange={e => handleToChange(e.target.value)}
            onKeyDown={handleToKeyDown}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="someone@example.com"
            disabled={sending}
            autoFocus={!replyTo && !forwardData}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="mail-autocomplete">
              {suggestions.map((s, i) => (
                <div
                  key={s.id}
                  className={`mail-autocomplete-item${i === selectedSuggestion ? " selected" : ""}`}
                  onMouseDown={() => applySuggestion(s)}
                >
                  <span className="mail-autocomplete-name">{s.name || s.address}</span>
                  {s.name && <span className="mail-autocomplete-addr">{s.address}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mail-compose-field">
          <label>subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="(no subject, just vibes)"
            disabled={sending}
          />
        </div>
      </div>

      <div className="mail-compose-attachments">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={e => {
            const files = Array.from(e.target.files ?? []);
            const totalSize = [...attachedFiles, ...files].reduce((s, f) => s + f.size, 0);
            if (totalSize > 25 * 1024 * 1024) {
              showStatus("total attachments too large (25MB max)", true);
              return;
            }
            if (attachedFiles.length + files.length > 5) {
              showStatus("max 5 attachments", true);
              return;
            }
            setAttachedFiles(prev => [...prev, ...files]);
            e.target.value = "";
          }}
        />
        <button
          className="mail-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || attachedFiles.length >= 5}
          type="button"
        >
          + attach files
        </button>
        {attachedFiles.length > 0 && (
          <div className="mail-attached-files">
            {attachedFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} className="mail-attached-file">
                <span className="mail-attached-name">{f.name}</span>
                <span className="mail-attached-size">{formatBytes(f.size)}</span>
                <button
                  className="mail-attached-remove"
                  onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <textarea
        className="mail-compose-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="type your masterpiece here..."
        disabled={sending}
        autoFocus={!!replyTo || !!forwardData}
      />
    </div>
  );
}
