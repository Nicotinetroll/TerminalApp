import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { AuthUser, StorageStats } from "@/lib/api";
import { getSession, getStorageStats, createUserInvite, ApiError } from "@/lib/api";
import { ProfileInfo } from "./ProfileInfo";
import { StorageBar } from "./StorageBar";
import { PasswordForm } from "./PasswordForm";

type View = "overview" | "password";

export function ProfilePanel({ user: _windowUser }: WindowContentProps) {
  const [view, setView] = useState<View>("overview");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (statusTimer.current) clearTimeout(statusTimer.current); };
  }, []);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [session, storageStats] = await Promise.all([
        getSession(),
        getStorageStats(),
      ]);
      setAuthUser(session);
      setStats(storageStats);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't load your shit";
      showStatus(msg, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerateInvite = useCallback(async () => {
    setInviteLoading(true);
    try {
      const invite = await createUserInvite();
      setInviteUrl(invite.url);
      try { await navigator.clipboard.writeText(invite.url); } catch { /* clipboard blocked */ }
      showStatus("invite link copied to clipboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't generate invite";
      showStatus(msg, true);
    } finally {
      setInviteLoading(false);
    }
  }, [showStatus]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); } catch { /* clipboard blocked */ }
    showStatus("copied to clipboard");
  }, [inviteUrl, showStatus]);

  if (loading) {
    return (
      <div className="panel-view">
        <div className="admin-loading">
          <span className="spinner" />
          loading your existence...
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="panel-view">
        <div className="admin-empty">couldn't load profile. do you even exist?</div>
      </div>
    );
  }

  return (
    <div className="panel-view">
      <div className="panel-view-header">
        <h2>
          {view === "overview" && "profile"}
          {view === "password" && "change password"}
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
          {view === "overview" ? (
            <button
              className="btn btn-primary"
              onClick={() => setView("password")}
            >
              change password
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => setView("overview")}
            >
              back to profile
            </button>
          )}
        </div>
      </div>

      {view === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", flex: 1, overflow: "auto" }}>
          <ProfileInfo
            user={authUser}
            niggabytes={stats?.niggabytes}
            inviteUrl={inviteUrl}
            inviteLoading={inviteLoading}
            onGenerateInvite={() => void handleGenerateInvite()}
            onCopyInvite={() => void handleCopyInvite()}
          />
          {stats && <StorageBar stats={stats} />}
        </div>
      )}

      {view === "password" && (
        <PasswordForm
          onSuccess={() => {
            showStatus("password changed. don't forget it this time.");
            setView("overview");
          }}
          onError={(msg) => showStatus(msg, true)}
        />
      )}
    </div>
  );
}
