import { useState } from "react";
import type { AdminUser } from "@/lib/api";
import { grantNiggaBytes } from "@/lib/api";

interface Props {
  users: AdminUser[];
  loading: boolean;
  currentUsername: string;
  onEdit: (user: AdminUser) => void;
  onDelete: (id: number) => void;
  onStatus?: (text: string, isError?: boolean) => void;
}

export function UserTable({ users, loading, currentUsername, onEdit, onDelete, onStatus }: Props) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [grantingId, setGrantingId] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("");

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading these mfs...
      </div>
    );
  }

  if (users.length === 0) {
    return <div className="admin-empty">no users? how the fuck did you get here?</div>;
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const handleGrant = async (userId: number) => {
    const amt = parseInt(grantAmount, 10);
    if (!amt) return;
    try {
      const result = await grantNiggaBytes(userId, amt);
      onStatus?.(result.message);
      setGrantingId(null);
      setGrantAmount("");
    } catch {
      onStatus?.("grant failed lmao", true);
    }
  };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>id</th>
            <th>username</th>
            <th>role</th>
            <th>created</th>
            <th style={{ textAlign: "right" }}>actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={{ color: "var(--text-muted)" }}>{u.id}</td>
              <td style={{ color: "var(--text-primary)", fontWeight: 500 }}>{u.username}</td>
              <td>
                <span className={`role-badge role-${u.role}`}>
                  {u.role === "club" ? "club member" : u.role === "classic" ? "member" : u.role}
                </span>
              </td>
              <td>{formatDate(u.created_at)}</td>
              <td style={{ textAlign: "right" }}>
                {grantingId === u.id ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="number"
                      value={grantAmount}
                      onChange={(e) => setGrantAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleGrant(u.id);
                        if (e.key === "Escape") { setGrantingId(null); setGrantAmount(""); }
                      }}
                      placeholder="NB"
                      autoFocus
                      style={{
                        width: "70px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--accent)",
                        color: "var(--text-primary)",
                        padding: "3px 6px",
                        fontSize: "12px",
                        borderRadius: "4px",
                      }}
                    />
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 8px", color: "var(--accent)" }}
                      onClick={() => void handleGrant(u.id)}
                    >
                      ok
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => { setGrantingId(null); setGrantAmount(""); }}
                    >
                      x
                    </button>
                  </span>
                ) : confirmId === u.id ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>you sure?</span>
                    <button
                      className="btn btn-danger"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => {
                        setConfirmId(null);
                        onDelete(u.id);
                      }}
                    >
                      yeah fuck it
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => setConfirmId(null)}
                    >
                      nah
                    </button>
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: "6px" }}>
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 8px", color: "#f5c542" }}
                      onClick={() => { setGrantingId(u.id); setGrantAmount(""); }}
                      title="grant NiggaBytes"
                    >
                      +NB
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => onEdit(u)}
                    >
                      edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      disabled={u.username === currentUsername}
                      title={u.username === currentUsername ? "you can't delete yourself, dumbass" : undefined}
                      onClick={() => setConfirmId(u.id)}
                    >
                      delete
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
