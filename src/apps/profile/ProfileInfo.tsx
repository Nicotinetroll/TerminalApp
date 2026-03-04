import type { AuthUser } from "@/lib/api";

interface Props {
  user: AuthUser;
}

export function ProfileInfo({ user }: Props) {
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
        </tbody>
      </table>
    </div>
  );
}
