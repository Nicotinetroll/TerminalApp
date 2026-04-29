import { useCallback } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { ShopPanel } from "@/apps/shop/ShopPanel";
import { LockIcon } from "@/components/LockIcon";

const ROLE_LABELS: Record<string, string> = {
  user: "user",
  basic: "basic",
  premium: "premium",
};

const UPSELL_LINES = [
  "you thought you could just waltz in?",
  "nah bitch, this one's behind the velvet rope.",
  "upgrade your account and unlock the good shit.",
];

interface LockedAppProps extends WindowContentProps {
  appName?: string;
  minRole?: string;
}

export function LockedAppPanel({ appName, minRole, windowManager, closeWindow }: LockedAppProps) {
  const label = ROLE_LABELS[minRole ?? "premium"] ?? minRole ?? "premium";

  const handleOpenShop = useCallback(() => {
    closeWindow();
    windowManager?.openWindow({
      id: "shop-panel",
      title: "shop",
      component: ShopPanel,
      width: 680,
      height: 580,
      appName: "shop",
    });
  }, [windowManager, closeWindow]);

  return (
    <div className="panel-view" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, padding: 32 }}>
      <LockIcon size={48} />

      <div style={{ fontSize: 18, color: "var(--accent)", fontWeight: 700 }}>
        {appName ?? "this app"} is locked
      </div>

      <div style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: 12,
        background: "var(--accent-soft)",
        color: "var(--accent)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.5px",
      }}>
        requires {label}
      </div>

      <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 320, lineHeight: 1.7 }}>
        {UPSELL_LINES.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>

      <button
        className="btn"
        style={{ marginTop: 8, padding: "8px 24px", fontSize: 14 }}
        onClick={handleOpenShop}
        type="button"
      >
        open shop
      </button>
    </div>
  );
}
