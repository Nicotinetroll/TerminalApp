import type { AuthUser } from "@/lib/api";

interface Props {
  user: AuthUser;
  niggabytes?: number;
  inviteUrl?: string | null;
  inviteLoading?: boolean;
  onGenerateInvite?: () => void;
  onCopyInvite?: () => void;
}

export function ProfileInfo({ user, niggabytes, inviteUrl, inviteLoading, onGenerateInvite, onCopyInvite }: Props) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "the beginning of time";
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const roleBadgeClass =
    user.role === "admin"
      ? "role-admin"
      : user.role === "user"
        ? "role-user"
        : "role-guest";

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
            <td style={{ color: "var(--text-muted)", width: "140px" }}>username</td>
            <td style={{ color: "var(--accent)", fontWeight: 600 }}>{user.username}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>user id</td>
            <td style={{ color: "var(--text-primary)" }}>{user.id}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--text-muted)" }}>role</td>
            <td>
              <span className={`role-badge ${roleBadgeClass}`}>{user.role}</span>
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
          {user.role !== "guest" && onGenerateInvite && (
            <tr>
              <td style={{ color: "var(--text-muted)" }}>invite</td>
              <td>
                {inviteUrl ? (
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
                  <button
                    className="btn"
                    style={{ fontSize: "12px", padding: "3px 10px" }}
                    disabled={inviteLoading}
                    onClick={onGenerateInvite}
                  >
                    {inviteLoading ? "generating..." : "generate link"}
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
