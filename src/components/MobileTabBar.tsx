interface Props {
  active: "mail" | "panels" | "terminal";
  onChange: (tab: "mail" | "panels" | "terminal") => void;
}

const TABS: { id: "mail" | "panels" | "terminal"; icon: string; label: string }[] = [
  { id: "mail",     icon: "\u2709", label: "mail" },
  { id: "panels",   icon: "\u25E7", label: "cloud" },
  { id: "terminal", icon: ">_",     label: "terminal" },
];

export function MobileTabBar({ active, onChange }: Props) {
  return (
    <nav className="mobile-tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`mobile-tab${active === tab.id ? " mobile-tab--active" : ""}`}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          <span className="mobile-tab-icon">{tab.icon}</span>
          <span className="mobile-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
