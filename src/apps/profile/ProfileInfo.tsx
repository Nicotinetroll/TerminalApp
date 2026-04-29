import type { AuthUser, ActiveSubscription } from "@/lib/api";
import { checkAppAccess } from "@/core/appRestrictions";
import { LockIcon } from "@/components/LockIcon";

interface Props {
  user: AuthUser;
  niggabytes?: number;
  activeSub?: ActiveSubscription | null;
  onOpenShop?: () => void;
  inviteUrl?: string | null;
  inviteLoading?: boolean;
  inviteMaxUses?: number;
  onInviteMaxUsesChange?: (n: number) => void;
  onGenerateInvite?: () => void;
  onCopyInvite?: () => void;
  transferUrl?: string | null;
  transferLoading?: boolean;
  onGenerateTransfer?: () => void;
  onCopyTransfer?: () => void;
}

export function ProfileInfo({
  user, niggabytes, activeSub, onOpenShop,
  inviteUrl, inviteLoading, inviteMaxUses, onInviteMaxUsesChange, onGenerateInvite, onCopyInvite,
  transferUrl, transferLoading, onGenerateTransfer, onCopyTransfer,
}: Props) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "the beginning of time";
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const roleBadgeClass = `role-${user.role}`;
  const roleLabel = user.role === "premium" ? "premium" : user.role === "basic" ? "basic" : user.role;

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return "forever";
    const d = new Date(expiresAt + "Z");
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (diffDays <= 0) return `expired`;
    if (diffDays === 1) return `${dateStr} (tomorrow)`;
    if (diffDays <= 7) return `${dateStr} (${diffDays} days)`;
    return dateStr;
  };

  const subLabel = activeSub && activeSub.is_active
    ? activeSub.type.includes("premium") ? "Premium" : activeSub.type.includes("basic") ? "Basic" : activeSub.type
    : null;

  const nbTag = niggabytes === 69 ? "nice." :
    niggabytes === 0 ? "broke as fuck" :
    (niggabytes ?? 0) < 10 ? "pocket change" :
    (niggabytes ?? 0) < 100 ? "decent stash" :
    (niggabytes ?? 0) < 1000 ? "big baller" :
    (niggabytes ?? 0) < 10000 ? "whale status" :
    "jeff bezos tier";

  return (
    <div>
      <table className="admin-table" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td style={{ color: "var(--text-muted)", width: "140px" }}>email</td>
            <td style={{ color: "var(--accent)", fontWeight: 600 }}>{user.email}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>user id</td>
            <td style={{ color: "var(--text-primary)" }}>{user.id}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>role</td>
            <td>
              <span className={`role-badge ${roleBadgeClass}`}>{roleLabel}</span>
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>subscription</td>
            <td>
              {subLabel ? (
                <span style={{ display: "inline-flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: activeSub!.type.includes("premium") ? "var(--accent)" : "#a78bfa", fontWeight: 600 }}>
                    {subLabel}
                  </span>
                  <span style={{ color: "var(--text-ghost)", fontSize: "12px" }}>
                    expires {formatExpiry(activeSub!.expires_at)}
                  </span>
                  {activeSub!.auto_renew ? (
                    <span style={{ fontSize: "10px", color: "var(--success)", background: "rgba(34,197,94,0.1)", padding: "1px 6px", borderRadius: "3px" }}>auto-renew</span>
                  ) : null}
                  {onOpenShop && (
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      onClick={onOpenShop}
                    >extend</button>
                  )}
                </span>
              ) : (
                <span style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ color: "var(--text-ghost)" }}>no subscription</span>
                  {onOpenShop && (
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      onClick={onOpenShop}
                    >upgrade</button>
                  )}
                </span>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>member since</td>
            <td style={{ color: "var(--text-primary)" }}>{formatDate(user.created_at)}</td>
          </tr>
          {niggabytes != null && (
            <tr>
              <td style={{ color: "var(--text-muted)" }}>niggabytes</td>
              <td>
                <span style={{ color: "#fbbf24", fontWeight: 600 }}>{niggabytes.toLocaleString()} NB</span>
                <span style={{ color: "var(--text-ghost)", fontSize: "11px", marginLeft: "8px" }}>{nbTag}</span>
              </td>
            </tr>
          )}
          {onGenerateInvite && (
            <tr>
              <td style={{ color: "var(--text-muted)" }}>invite</td>
              <td>
                {!checkAppAccess("feature:invites", user.role) ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center", opacity: 0.5 }}>
                    <LockIcon size={12} />
                    <span style={{ fontSize: "12px", color: "var(--text-ghost)" }}>locked</span>
                    {onOpenShop && <button className="btn" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={onOpenShop}>upgrade</button>}
                  </span>
                ) : inviteUrl ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <code style={{ fontSize: "12px", color: "var(--accent)", background: "var(--bg-primary)", padding: "2px 6px", borderRadius: "3px" }}>
                      {inviteUrl.split("invite=")[1] ?? inviteUrl}
                    </code>
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      onClick={onCopyInvite}
                    >copy</button>
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      disabled={inviteLoading}
                      onClick={onGenerateInvite}
                    >new</button>
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={inviteMaxUses ?? 1}
                      onChange={(e) => onInviteMaxUsesChange?.(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: "42px", textAlign: "center", fontSize: "12px", padding: "3px 2px", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-medium)", borderRadius: "3px", fontFamily: "inherit" }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--text-ghost)" }}>uses</span>
                    <button
                      className="btn"
                      style={{ fontSize: "12px", padding: "3px 10px" }}
                      disabled={inviteLoading}
                      onClick={onGenerateInvite}
                    >
                      {inviteLoading ? "generating..." : "generate"}
                    </button>
                  </span>
                )}
              </td>
            </tr>
          )}
          {onGenerateTransfer && (
            <tr>
              <td style={{ color: "var(--text-muted)" }}>upload link</td>
              <td>
                {!checkAppAccess("feature:transfers", user.role) ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center", opacity: 0.5 }}>
                    <LockIcon size={12} />
                    <span style={{ fontSize: "12px", color: "var(--text-ghost)" }}>locked</span>
                    {onOpenShop && <button className="btn" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={onOpenShop}>upgrade</button>}
                  </span>
                ) : transferUrl ? (
                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                    <code style={{ fontSize: "12px", color: "var(--accent)", background: "var(--bg-primary)", padding: "2px 6px", borderRadius: "3px" }}>
                      {transferUrl.split("/t/")[1] ?? transferUrl}
                    </code>
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      onClick={onCopyTransfer}
                    >copy</button>
                    <button
                      className="btn"
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                      disabled={transferLoading}
                      onClick={onGenerateTransfer}
                    >new</button>
                  </span>
                ) : (
                  <button
                    className="btn"
                    style={{ fontSize: "12px", padding: "3px 10px" }}
                    disabled={transferLoading}
                    onClick={onGenerateTransfer}
                  >
                    {transferLoading ? "generating..." : "generate upload link"}
                  </button>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
