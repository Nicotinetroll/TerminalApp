import { useState } from "react";
import type { AdminUser } from "@/lib/api";

interface Props {
  mode: "create" | "edit";
  initialUser?: AdminUser;
  onSubmit: (username: string, password: string, role: string) => void;
  onCancel: () => void;
}

export function UserForm({ mode, initialUser, onSubmit, onCancel }: Props) {
  const [username, setUsername] = useState(initialUser?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initialUser?.role ?? "user");

  const canSubmit =
    username.trim().length > 0 && (mode === "edit" || password.length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(username.trim(), password, role);
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
      <div className="admin-form-group">
        <label>username</label>
        <input
          type="text"
          className="admin-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="enter username"
          autoFocus
        />
      </div>

      <div className="admin-form-group">
        <label>{mode === "create" ? "password" : "password (leave empty to keep)"}</label>
        <input
          type="password"
          className="admin-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "create" ? "enter password" : "leave empty to keep current"}
        />
      </div>

      <div className="admin-form-group">
        <label>role</label>
        <select
          className="admin-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="admin">admin</option>
          <option value="club">club member</option>
          <option value="user">member</option>
          <option value="guest">guest</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {mode === "create" ? "create this mf" : "save changes"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          nah, go back
        </button>
      </div>
    </form>
  );
}
