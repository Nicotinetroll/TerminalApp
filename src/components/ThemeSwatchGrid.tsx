import { THEMES } from "@/config";

const THEME_NAMES = Object.keys(THEMES);

interface Props {
  selected: string;
  onSelect: (name: string) => void;
}

export function ThemeSwatchGrid({ selected, onSelect }: Props) {
  return (
    <div className="theme-picker-grid">
      {THEME_NAMES.map(name => {
        const t = THEMES[name]!;
        const isActive = selected === name;
        return (
          <button
            key={name}
            className={`theme-swatch${isActive ? " theme-swatch--active" : ""}`}
            onClick={() => onSelect(name)}
            style={{
              '--swatch-accent': t.accent,
              '--swatch-glow': t.accentSoft,
              '--swatch-border': t.borderSubtle ?? 'rgba(255,255,255,0.06)',
              '--swatch-muted': t.textMuted ?? '#586880',
              background: t.bgPrimary ?? '#0a0a12',
            } as React.CSSProperties}
          >
            <span className="theme-swatch-bar" style={{ background: t.accent }} />
            <span className="theme-swatch-body">
              <span className="theme-swatch-prompt">
                <span style={{ color: t.accent }}>&#10095;</span>
                <span style={{ color: t.textPrimary ?? '#e8ecf4' }}> _</span>
              </span>
              <span className="theme-swatch-line" style={{ background: t.textSecondary ?? '#9aa4b8', width: '60%' }} />
              <span className="theme-swatch-line" style={{ background: t.textMuted ?? '#586880', width: '36%' }} />
            </span>
            <span className="theme-swatch-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
