import { useState, useEffect, useCallback } from "react";
import { getInvites, createInvite, deleteInvite, ApiError } from "@/lib/api";
import type { InviteLink } from "@/lib/api";

export function InvitePanel() {
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [maxUses, setMaxUses] = useState(1);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInvites();
      setInvites(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "shit broke";
      showStatus(`failed to load invites: ${msg}`, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const handleCreate = useCallback(async (role: string) => {
    setCreating(true);
    try {
      const invite = await createInvite(role, maxUses);
      await navigator.clipboard.writeText(invite.url);
      showStatus(`link created (${maxUses} uses) & copied to clipboard`);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
      await loadInvites();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    } finally {
      setCreating(false);
    }
  }, [loadInvites, showStatus, maxUses]);

  const handleCopy = useCallback(async (id: string) => {
    const url = `https://mynig.ga/?invite=${id}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleRevoke = useCallback(async (id: string) => {
    try {
      await deleteInvite(id);
      showStatus("invite revoked");
      await loadInvites();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    }
  }, [loadInvites, showStatus]);

  const getInviteStatus = (invite: InviteLink): "active" | "full" | "expired" => {
    const now = new Date();
    const expires = new Date(invite.expires_at + "Z");
    if (now > expires) return "expired";
    if (invite.use_count >= invite.max_uses) return "full";
    return "active";
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading invites...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>uses:</label>
          <input
            type="number"
            className="admin-input"
            min={1}
            max={1000}
            value={maxUses}
            onChange={(e) => setMaxUses(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: "56px", textAlign: "center", fontSize: "12px", padding: "3px 4px" }}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={creating}
          onClick={() => void handleCreate("user")}
        >
          {creating ? "generating..." : "+ invite (user)"}
        </button>
        <button
          className="btn"
          disabled={creating}
          onClick={() => void handleCreate("classic")}
        >
          + invite (member)
        </button>
        <button
          className="btn"
          disabled={creating}
          onClick={() => void handleCreate("club")}
        >
          + invite (club member)
        </button>
        <button
          className="btn"
          disabled={creating}
          onClick={() => void handleCreate("admin")}
        >
          + invite (admin)
        </button>
        {status && (
          <span className={`admin-status${status.isError ? " error" : ""}`}>
            {status.text}
          </span>
        )}
      </div>

      {invites.length === 0 ? (
        <div className="admin-empty">no invites yet. generate one above, genius.</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>token</th>
                <th>role</th>
                <th>uses</th>
                <th>status</th>
                <th>created</th>
                <th>expires</th>
                <th style={{ textAlign: "right" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const s = getInviteStatus(inv);
                return (
                  <tr key={inv.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-muted)" }}>
                      {inv.id.slice(0, 12)}...
                    </td>
                    <td>
                      <span className={`role-badge role-${inv.role}`}>
                        {inv.role === "club" ? "club member" : inv.role === "classic" ? "member" : inv.role}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>
                      <span style={{ color: inv.use_count > 0 ? "var(--accent)" : "var(--text-muted)" }}>
                        {inv.use_count}
                      </span>
                      <span style={{ color: "var(--text-ghost)" }}>/</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {inv.max_uses}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "3px",
                        fontWeight: 500,
                        background: s === "active"
                          ? "rgba(74, 222, 128, 0.1)"
                          : s === "full"
                            ? "rgba(255, 255, 255, 0.05)"
                            : "rgba(248, 113, 113, 0.1)",
                        color: s === "active"
                          ? "#4ade80"
                          : s === "full"
                            ? "var(--text-muted)"
                            : "#f87171",
                      }}>
                        {s}
                      </span>
                    </td>
                    <td>{formatDate(inv.created_at)}</td>
                    <td>{formatDate(inv.expires_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      {s === "active" && (
                        <span style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            className="btn"
                            style={{ fontSize: "12px", padding: "3px 8px" }}
                            onClick={() => void handleCopy(inv.id)}
                          >
                            {copiedId === inv.id ? "copied!" : "copy"}
                          </button>
                          <button
                            className="btn btn-danger"
                            style={{ fontSize: "12px", padding: "3px 8px" }}
                            onClick={() => void handleRevoke(inv.id)}
                          >
                            revoke
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
