import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { EmailAddress, EmailStats, MailFolder } from "@/lib/api";
import { getEmailAddresses, getEmailStats, getCustomFolders, updateEmail, deleteEmail, getEmail, bulkEmailAction, ApiError } from "@/lib/api";
import { AddressSetup } from "./AddressSetup";
import { MailSidebar } from "./MailSidebar";
import { MailList } from "./MailList";
import { MailView } from "./MailView";
import { ComposeView } from "./ComposeView";
import { SignatureEditor } from "./SignatureEditor";
import { SetupGuide } from "./SetupGuide";

type View = "list" | "read" | "compose" | "signatures" | "settings";

export function MailPanel({ user: _user, windowId, windowManager }: WindowContentProps) {
  const [addresses, setAddresses] = useState<EmailAddress[]>([]);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [customFolders, setCustomFolders] = useState<MailFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState("inbox");
  const [view, setView] = useState<View>("list");
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<{ to: string; subject: string; in_reply_to?: string; from?: string } | null>(null);
  const [forwardData, setForwardData] = useState<{ subject: string; body: string } | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getEmailStats(selectedAddressId);
      setStats(s);
    } catch { /* ignore */ }
  }, [selectedAddressId]);

  const refreshFolders = useCallback(async () => {
    try {
      const f = await getCustomFolders();
      setCustomFolders(f);
    } catch { /* ignore */ }
    void refreshStats();
  }, [refreshStats]);

  // Clear selection on folder change
  useEffect(() => { setSelectedIds(new Set()); }, [folder]);

  // Refresh list + stats when address filter changes
  useEffect(() => {
    setListRefreshKey(k => k + 1);
    void refreshStats();
  }, [selectedAddressId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddressSelect = useCallback((id: number | null) => {
    setSelectedAddressId(id);
    setView("list");
    setSelectedEmailId(null);
  }, []);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const handleSelectAll = useCallback((ids: number[]) => setSelectedIds(new Set(ids)), []);
  const handleDeselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkAction = useCallback(async (action: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkEmailAction(ids, action);
      setSelectedIds(new Set());
      setListRefreshKey(k => k + 1);
      void refreshStats();
      showStatus(`${ids.length} email${ids.length > 1 ? "s" : ""} ${action === "trash" ? "trashed" : action === "read" ? "marked read" : "marked unread"}`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "bulk action failed", true);
    }
  }, [selectedIds, refreshStats, showStatus]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [addrs, s, folders] = await Promise.all([
        getEmailAddresses(),
        getEmailStats(),
        getCustomFolders(),
      ]);
      setAddresses(addrs);
      setStats(s);
      setCustomFolders(folders);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't load mail";
      showStatus(msg, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Update window title with unread count
  useEffect(() => {
    if (!windowManager || !windowId) return;
    const unread = stats?.stats["inbox"]?.unread ?? 0;
    const title = unread > 0 ? `mail (${unread})` : "mail";
    windowManager.updateWindowTitle(windowId, title);
  }, [stats, windowManager, windowId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      if (!panelRef.current?.contains(target) && target !== document.body) return;

      switch (e.key) {
        case "n":
          e.preventDefault();
          handleCompose();
          break;
        case "r":
          // reply handled by MailView's own keydown handler
          break;
        case "Escape":
          if (view !== "list") {
            e.preventDefault();
            handleBack();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddressClaimed = useCallback((addr: EmailAddress) => {
    setAddresses(prev => [...prev, addr]);
    showStatus(`${addr.full} is yours now`);
  }, [showStatus]);

  const handleAddressDeleted = useCallback((id: number) => {
    setAddresses(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSelectEmail = useCallback(async (id: number) => {
    if (folder === "drafts") {
      try {
        const draft = await getEmail(id);
        setReplyTo({ to: draft.to_address ?? "", subject: draft.subject, from: draft.from_address });
        setForwardData({ subject: draft.subject, body: draft.body ?? "" });
        setEditingDraftId(id);
        setView("compose");
      } catch {
        showStatus("couldn't load draft", true);
      }
      return;
    }
    setSelectedEmailId(id);
    setView("read");
    void refreshStats();
  }, [refreshStats, folder, showStatus]);

  const handleCompose = useCallback((reply?: { to: string; subject: string; in_reply_to?: string; from?: string }) => {
    setReplyTo(reply ?? null);
    setForwardData(null);
    setEditingDraftId(undefined);
    setView("compose");
  }, []);

  const handleForward = useCallback((data: { subject: string; body: string }) => {
    setReplyTo(null);
    setForwardData(data);
    setView("compose");
  }, []);

  const handleSent = useCallback(() => {
    setView("list");
    setListRefreshKey(k => k + 1);
    void refreshStats();
  }, [refreshStats]);

  const handleBack = useCallback(() => {
    setView("list");
    setSelectedEmailId(null);
    void refreshStats();
  }, [refreshStats]);

  const handleFolderChange = useCallback((f: string) => {
    setFolder(f);
    setView("list");
    setSelectedEmailId(null);
    setShowMobileMore(false);
  }, []);

  const handleSignatureUpdated = useCallback((addrId: number, signature: string) => {
    setAddresses(prev => prev.map(a => a.id === addrId ? { ...a, signature } : a));
  }, []);

  // Quick actions from list
  const handleQuickTrash = useCallback(async (id: number) => {
    try {
      await updateEmail(id, { folder: "trash" });
      setListRefreshKey(k => k + 1);
      void refreshStats();
      showStatus("trashed");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [refreshStats, showStatus]);

  const handleQuickToggleRead = useCallback(async (id: number, currentlyRead: boolean) => {
    try {
      await updateEmail(id, { is_read: !currentlyRead });
      setListRefreshKey(k => k + 1);
      void refreshStats();
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [refreshStats, showStatus]);

  const handleQuickStar = useCallback(async (id: number, currentlyStarred: boolean) => {
    try {
      await updateEmail(id, { is_starred: !currentlyStarred });
      setListRefreshKey(k => k + 1);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [showStatus]);

  if (loading) {
    return (
      <div className="mail-panel">
        <div className="mail-loading">
          <span className="spinner" />
          checking the mailbox...
        </div>
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="mail-panel">
        <AddressSetup
          onClaimed={handleAddressClaimed}
          showStatus={showStatus}
          status={status}
        />
      </div>
    );
  }

  return (
    <div className="mail-panel" ref={panelRef}>
      {status && (
        <div className={`mail-status${status.isError ? " error" : ""}`} onClick={() => setStatus(null)}>
          {status.text}
        </div>
      )}
      <div className="mail-layout">
        <MailSidebar
          folder={folder}
          stats={stats}
          addresses={addresses}
          customFolders={customFolders}
          selectedAddressId={selectedAddressId}
          onAddressSelect={handleAddressSelect}
          onFolderChange={handleFolderChange}
          onCompose={() => handleCompose()}
          onAddressDeleted={handleAddressDeleted}
          onAddressClaimed={handleAddressClaimed}
          onFoldersChanged={() => void refreshFolders()}
          onEditSignatures={() => setView("signatures")}
          onSetupGuide={() => setView("settings")}
          showStatus={showStatus}
        />
        <div className="mail-main">
          {view === "list" && (
            <MailList
              folder={folder}
              addressId={selectedAddressId}
              onSelect={handleSelectEmail}
              onCompose={() => handleCompose()}
              onQuickTrash={handleQuickTrash}
              onQuickToggleRead={handleQuickToggleRead}
              onQuickStar={handleQuickStar}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onBulkAction={handleBulkAction}
              customFolders={customFolders}
              key={`${folder}-${listRefreshKey}`}
            />
          )}
          {view === "read" && selectedEmailId !== null && (
            <MailView
              emailId={selectedEmailId}
              onBack={handleBack}
              onReply={handleCompose}
              onForward={handleForward}
              onDelete={() => {
                handleBack();
                showStatus("email deleted");
              }}
              showStatus={showStatus}
            />
          )}
          {view === "compose" && (
            <ComposeView
              addresses={addresses}
              replyTo={replyTo}
              forwardData={forwardData}
              draftId={editingDraftId}
              onSent={handleSent}
              onCancel={handleBack}
              showStatus={showStatus}
            />
          )}
          {view === "signatures" && (
            <SignatureEditor
              addresses={addresses}
              onUpdated={handleSignatureUpdated}
              onClose={handleBack}
              showStatus={showStatus}
            />
          )}
          {view === "settings" && (
            <SetupGuide
              addresses={addresses}
              onClose={handleBack}
              onPasswordSet={(addrId) => {
                setAddresses(prev => prev.map(a => a.id === addrId ? { ...a, has_mail_password: true } : a));
              }}
              showStatus={showStatus}
            />
          )}
        </div>
      </div>

      {/* Mobile FAB — compose button */}
      {view === "list" && (
        <button
          className="mail-mobile-fab"
          onClick={() => { setShowMobileMore(false); handleCompose(); }}
          aria-label="Compose"
        >
          +
        </button>
      )}

      {/* Mobile "more" bottom sheet */}
      {showMobileMore && (
        <div className="mail-mobile-more" onClick={() => setShowMobileMore(false)}>
          <div className="mail-mobile-more-sheet" onClick={e => e.stopPropagation()}>
            <div className="mail-mobile-more-section">
              <div className="mail-mobile-more-label">folders</div>
              <button
                className={`mail-mobile-more-item${folder === "trash" ? " active" : ""}`}
                onClick={() => handleFolderChange("trash")}
              >
                <span className="mail-mobile-more-icon">x</span>
                <span>trash</span>
                {(stats?.stats["trash"]?.total ?? 0) > 0 && (
                  <span className="mail-mobile-more-badge">{stats?.stats["trash"]?.total}</span>
                )}
              </button>
              {customFolders.map(f => (
                <button
                  key={f.id}
                  className={`mail-mobile-more-item${folder === f.name ? " active" : ""}`}
                  onClick={() => handleFolderChange(f.name)}
                >
                  <span className="mail-mobile-more-icon">#</span>
                  <span>{f.name}</span>
                  {(stats?.stats[f.name]?.unread ?? 0) > 0 && (
                    <span className="mail-mobile-more-badge">{stats?.stats[f.name]?.unread}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="mail-mobile-more-section">
              <div className="mail-mobile-more-label">settings</div>
              <button
                className="mail-mobile-more-item"
                onClick={() => { setShowMobileMore(false); setView("signatures"); }}
              >
                <span className="mail-mobile-more-icon">~</span>
                <span>signatures</span>
              </button>
              <button
                className="mail-mobile-more-item"
                onClick={() => { setShowMobileMore(false); setView("settings"); }}
              >
                <span className="mail-mobile-more-icon">$</span>
                <span>imap setup</span>
              </button>
            </div>
            <div className="mail-mobile-more-section">
              <div className="mail-mobile-more-label">filter by address</div>
              <button
                className={`mail-mobile-more-item${selectedAddressId === null ? " active" : ""}`}
                onClick={() => { setShowMobileMore(false); handleAddressSelect(null); }}
              >
                <span className="mail-mobile-more-icon">*</span>
                <span>all addresses</span>
              </button>
              {addresses.map(addr => (
                <button
                  key={addr.id}
                  className={`mail-mobile-more-item${selectedAddressId === addr.id ? " active" : ""}`}
                  onClick={() => { setShowMobileMore(false); handleAddressSelect(addr.id); }}
                >
                  <span className="mail-mobile-more-icon">@</span>
                  <span>{addr.full}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="mail-mobile-nav">
        {([
          { id: "inbox", icon: ">", label: "inbox" },
          { id: "starred", icon: "*", label: "starred" },
          { id: "sent", icon: "<", label: "sent" },
          { id: "drafts", icon: "~", label: "drafts" },
          { id: "_more", icon: "#", label: "more" },
        ] as const).map(tab => {
          const isMore = tab.id === "_more";
          const isActive = isMore ? showMobileMore : (folder === tab.id && view === "list" && !showMobileMore);
          const unread = !isMore ? (stats?.stats[tab.id]?.unread ?? 0) : 0;
          return (
            <button
              key={tab.id}
              className={`mail-mobile-nav-tab${isActive ? " active" : ""}`}
              onClick={() => {
                if (isMore) {
                  setShowMobileMore(p => !p);
                } else {
                  handleFolderChange(tab.id);
                }
              }}
            >
              <span className="mail-mobile-nav-icon">{tab.icon}</span>
              <span className="mail-mobile-nav-label">{tab.label}</span>
              {unread > 0 && <span className="mail-mobile-nav-badge">{unread}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
