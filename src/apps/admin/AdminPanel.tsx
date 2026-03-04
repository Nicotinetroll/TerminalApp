import { useState, useEffect, useCallback } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getUsers, createUser, updateUser, deleteUser, ApiError } from "@/lib/api";
import type { AdminUser } from "@/lib/api";
import { UserTable } from "./UserTable";
import { UserForm } from "./UserForm";
import { InvitePanel } from "./InvitePanel";
import { ChatSpyPanel } from "./ChatSpyPanel";

type View = "list" | "create" | "edit" | "invites" | "chats";

export function AdminPanel({ user }: WindowContentProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "shit broke";
      setStatus({ text: `shit broke: ${msg}`, isError: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const handleCreate = useCallback(
    async (username: string, password: string, role: string) => {
      try {
        await createUser(username, password, role);
        showStatus(`${username} just joined the party`);
        setView("list");
        await loadUsers();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "unknown error";
        if (err instanceof ApiError && err.status === 403) {
          showStatus("nice try bitch", true);
        } else {
          showStatus(`shit broke: ${msg}`, true);
        }
      }
    },
    [loadUsers, showStatus]
  );

  const handleUpdate = useCallback(
    async (id: number, updates: { username?: string; password?: string; role?: string }) => {
      try {
        const updated = await updateUser(id, updates);
        showStatus(`${updated.username} got an upgrade`);
        setView("list");
        setEditingUser(null);
        await loadUsers();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "unknown error";
        if (err instanceof ApiError && err.status === 403) {
          showStatus("nice try bitch", true);
        } else {
          showStatus(`shit broke: ${msg}`, true);
        }
      }
    },
    [loadUsers, showStatus]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      const target = users.find((u) => u.id === id);
      try {
        await deleteUser(id);
        showStatus(`${target?.username ?? "user"} has been yeeted`);
        await loadUsers();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "unknown error";
        if (err instanceof ApiError && err.status === 403) {
          showStatus("nice try bitch", true);
        } else {
          showStatus(`shit broke: ${msg}`, true);
        }
      }
    },
    [users, loadUsers, showStatus]
  );

  const handleEdit = useCallback((u: AdminUser) => {
    setEditingUser(u);
    setView("edit");
  }, []);

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>
          {view === "list" && "users"}
          {view === "create" && "create user"}
          {view === "edit" && `edit: ${editingUser?.username ?? ""}`}
          {view === "invites" && "invite links"}
          {view === "chats" && "whisper spy"}
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
          {view === "list" && (
            <>
              <button className="admin-btn" onClick={() => setView("chats")}>
                whisper spy
              </button>
              <button className="admin-btn" onClick={() => setView("invites")}>
                invite links
              </button>
              <button className="admin-btn admin-btn-primary" onClick={() => setView("create")}>
                + new user
              </button>
            </>
          )}
          {view === "invites" && (
            <button className="admin-btn" onClick={() => setView("list")}>
              back to users
            </button>
          )}
          {view === "chats" && (
            <button className="admin-btn" onClick={() => setView("list")}>
              back to users
            </button>
          )}
        </div>
      </div>

      {view === "list" && (
        <UserTable
          users={users}
          loading={loading}
          currentUsername={user.username}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {view === "create" && (
        <UserForm
          mode="create"
          onSubmit={(username, password, role) => void handleCreate(username, password, role)}
          onCancel={() => setView("list")}
        />
      )}

      {view === "edit" && editingUser && (
        <UserForm
          mode="edit"
          initialUser={editingUser}
          onSubmit={(username, password, role) => {
            const updates: { username?: string; password?: string; role?: string } = {};
            if (username !== editingUser.username) updates.username = username;
            if (password) updates.password = password;
            if (role !== editingUser.role) updates.role = role;
            void handleUpdate(editingUser.id, updates);
          }}
          onCancel={() => {
            setView("list");
            setEditingUser(null);
          }}
        />
      )}

      {view === "invites" && <InvitePanel />}

      {view === "chats" && <ChatSpyPanel />}
    </div>
  );
}
