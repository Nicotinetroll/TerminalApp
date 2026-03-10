import type { WindowContentProps } from "@/types/terminal";

const PERKS = [
  "exclusive apps & features",
  "priority support",
  "club-only chat rooms",
  "flex on the peasants",
];

export function JoinClubPanel({ user }: WindowContentProps) {
  const isAlreadyClub = user.role === "club" || user.role === "admin";

  return (
    <div className="panel-view" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 20 }}>
      {isAlreadyClub ? (
        <>
          <div style={{ fontSize: 32 }}>{"\u2b50"}</div>
          <div style={{ fontSize: 16, color: "var(--accent)", fontWeight: 600 }}>
            you're already in the club
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            flex harder.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 32 }}>{"\uD83D\uDD12"}</div>
          <div style={{ fontSize: 16, color: "var(--accent)", fontWeight: 600 }}>
            join the club
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 320, lineHeight: 1.6 }}>
            unlock premium features and get access to everything mynig.ga has to offer.
          </div>

          <div style={{ textAlign: "left", width: "100%", maxWidth: 280 }}>
            {PERKS.map((perk) => (
              <div key={perk} style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--success)", marginRight: 8 }}>{"\u2713"}</span>
                {perk}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "var(--text-ghost)", marginTop: 8, maxWidth: 300 }}>
            contact <span style={{ color: "var(--accent)" }}>admin</span> to get your role upgraded, or wait for the self-service portal (coming soon{"\u2122"}).
          </div>
        </>
      )}
    </div>
  );
}
