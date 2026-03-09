import { useState, useEffect, useCallback } from "react";
import { getInvites, createInvite, deleteInvite, ApiError } from "@/lib/api";
import type { InviteLink } from "@/lib/api";

export function InvitePanel() {
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

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
      const invite = await createInvite(role);
      await navigator.clipboard.writeText(invite.url);
      showStatus("link created & copied to clipboard");
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
      await loadInvites();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    } finally {
      setCreating(false);
    }
  }, [loadInvites, showStatus]);

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

  const getInviteStatus = (invite: InviteLink): "active" | "used" | "expired" => {
    if (invite.used_by_username) return "used";
    const now = new Date();
    const expires = new Date(invite.expires_at + "Z");
    if (now > expires) return "expired";
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
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          disabled={creating}
          onClick={() => void handleCreate("user")}
        >
          {creating ? "generating..." : "+ generate invite (user)"}
        </button>
        <button
          className="btn"
          disabled={creating}
          onClick={() => void handleCreate("admin")}
        >
          + generate invite (admin)
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
                <th>status</th>
                <th>created</th>
                <th>expires</th>
                <th>used by</th>
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
                      <span className={`role-badge ${inv.role === "admin" ? "role-admin" : inv.role === "user" ? "role-user" : "role-guest"}`}>
                        {inv.role}
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
                          : s === "used"
                            ? "rgba(255, 255, 255, 0.05)"
                            : "rgba(248, 113, 113, 0.1)",
                        color: s === "active"
                          ? "#4ade80"
                          : s === "used"
                            ? "var(--text-muted)"
                            : "#f87171",
                      }}>
                        {s}
                      </span>
                    </td>
                    <td>{formatDate(inv.created_at)}</td>
                    <td>{formatDate(inv.expires_at)}</td>
                    <td style={{ color: inv.used_by_username ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {inv.used_by_username ?? "—"}
                    </td>
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
