import { useState } from "react";
import type { AdminUser } from "@/lib/api";

interface Props {
  users: AdminUser[];
  loading: boolean;
  currentUsername: string;
  onEdit: (user: AdminUser) => void;
  onDelete: (id: number) => void;
}

export function UserTable({ users, loading, currentUsername, onEdit, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

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
                <span className={`role-badge ${u.role === "admin" ? "role-admin" : u.role === "user" ? "role-user" : "role-guest"}`}>
                  {u.role}
                </span>
              </td>
              <td>{formatDate(u.created_at)}</td>
              <td style={{ textAlign: "right" }}>
                {confirmId === u.id ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>you sure?</span>
                    <button
                      className="admin-btn admin-btn-danger"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => {
                        setConfirmId(null);
                        onDelete(u.id);
                      }}
                    >
                      yeah fuck it
                    </button>
                    <button
                      className="admin-btn"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => setConfirmId(null)}
                    >
                      nah
                    </button>
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: "6px" }}>
                    <button
                      className="admin-btn"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => onEdit(u)}
                    >
                      edit
                    </button>
                    <button
                      className="admin-btn admin-btn-danger"
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
