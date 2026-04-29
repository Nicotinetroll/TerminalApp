import { useState, useEffect, useCallback } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getUsers, createUser, updateUser, deleteUser, ApiError } from "@/lib/api";
import type { AdminUser } from "@/lib/api";
import { UserTable } from "./UserTable";
import { UserForm } from "./UserForm";
import { InvitePanel } from "./InvitePanel";
import { MailReviewPanel } from "./MailReviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { PromoPanel } from "./PromoPanel";

type View = "list" | "create" | "edit" | "invites" | "promos" | "emails" | "settings" | "audit";

const NAV: { view: View; label: string }[] = [
  { view: "list",     label: "users" },
  { view: "invites",  label: "invites" },
  { view: "promos",   label: "promos" },
  { view: "emails",   label: "mail" },
  { view: "settings", label: "config" },
  { view: "audit",    label: "audit" },
];

const VIEW_TITLES: Record<View, string> = {
  list: "users",
  create: "create user",
  edit: "edit user",
  invites: "invite links",
  promos: "promo codes",
  emails: "mail mgmt",
  settings: "global settings",
  audit: "audit log",
};

function sidebarView(v: View): View {
  return v === "create" || v === "edit" ? "list" : v;
}

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
    async (email: string, password: string, role: string) => {
      try {
        await createUser(email, password, role);
        showStatus(`${email} just joined the party`);
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
    async (id: number, updates: { email?: string; password?: string; role?: string }) => {
      try {
        const updated = await updateUser(id, updates);
        showStatus(`${updated.email} got an upgrade`);
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
        showStatus(`${target?.email ?? "user"} has been yeeted`);
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

  const activeNav = sidebarView(view);
  const title = view === "edit" ? `edit: ${editingUser?.email ?? ""}` : VIEW_TITLES[view];

  return (
    <div className="admin-panel">
      <nav className="admin-sidebar">
        {NAV.map(item => (
          <button
            key={item.view}
            className={`admin-nav-item${activeNav === item.view ? " admin-nav-active" : ""}`}
            onClick={() => {
              setView(item.view);
              if (item.view !== "list") setEditingUser(null);
            }}
          >
            <span className="admin-nav-label">{item.label}</span>
          </button>
        ))}
        <div className="admin-nav-spacer" />
        <button
          className="admin-nav-item admin-nav-create"
          onClick={() => setView("create")}
        >
          <span className="admin-nav-label">+ new</span>
        </button>
      </nav>

      <div className="admin-content">
        <div className="admin-content-header">
          <h2>{title}</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {(view === "create" || view === "edit") && (
              <button className="btn" onClick={() => { setView("list"); setEditingUser(null); }}>
                ← users
              </button>
            )}
            {status && (
              <span className={`admin-status${status.isError ? " error" : ""}`}>
                {status.text}
              </span>
            )}
          </div>
        </div>

        <div className="admin-content-body">
          {view === "list" && (
            <UserTable
              users={users}
              loading={loading}
              currentEmail={user.email}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onStatus={showStatus}
            />
          )}

          {view === "create" && (
            <UserForm
              mode="create"
              onSubmit={(email, password, role) => void handleCreate(email, password, role)}
              onCancel={() => setView("list")}
            />
          )}

          {view === "edit" && editingUser && (
            <UserForm
              mode="edit"
              initialUser={editingUser}
              onSubmit={(email, password, role) => {
                const updates: { email?: string; password?: string; role?: string } = {};
                if (email !== editingUser.email) updates.email = email;
                if (password) updates.password = password;
                if (role !== editingUser.role) updates.role = role;
                void handleUpdate(editingUser.id, updates);
              }}
              onCancel={() => {
                setView("list");
                setEditingUser(null);
              }}
              onStatus={showStatus}
            />
          )}

          {view === "invites" && <InvitePanel />}
          {view === "promos" && <PromoPanel />}
          {view === "emails" && <MailReviewPanel />}
          {view === "settings" && <SettingsPanel />}
          {view === "audit" && <AuditLogPanel />}
        </div>
      </div>
    </div>
  );
}
