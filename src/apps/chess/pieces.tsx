/**
 * Custom SVG chess pieces — themed to match terminal aesthetic.
 * White pieces: light solid fill, no stroke
 * Black pieces: accent-colored solid fill, no stroke
 * Pawns: tiny thicc dicks with massive balls (obviously)
 */

interface PieceProps {
  fill?: string;
  square?: string;
  svgStyle?: React.CSSProperties;
}

const SVG = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" width="100%" height="100%" style={style}>
    {children}
  </svg>
);

// ── White pieces ──

const wK = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      <path d="M22.5 11.63V6M20 8h5" stroke="var(--piece-white, #f0ebd8)" strokeWidth="1.5" />
      <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
      <path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7" />
    </g>
  </SVG>
);

const wQ = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-3.5-12.5-5 13.5-5-13.5L14 25 6.5 13.5 9 26z" />
      <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5 0 2.5 0 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="14" cy="9" r="2" />
      <circle cx="22.5" cy="8" r="2" />
      <circle cx="31" cy="9" r="2" />
      <circle cx="39" cy="12" r="2" />
    </g>
  </SVG>
);

const wR = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      <path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z" />
      <path d="M14 29.5v-13h17v13H14z" />
      <path d="M14 16.5L11 14h23l-3 2.5H14zM11 14V9h4v2h5V9h5v2h5V9h4v5H11z" />
    </g>
  </SVG>
);

const wB = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z" />
      <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
      <circle cx="22.5" cy="8" r="2.5" />
    </g>
  </SVG>
);

const wN = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
      <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4-1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
      <circle cx="31" cy="15.5" r="1" fill="var(--piece-white-stroke, #3a3540)" />
    </g>
  </SVG>
);

// PAWN — Dick with round balls and pubes (like the reference pic)
const wP = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-white, #f0ebd8)" stroke="none">
      {/* Round balls */}
      <ellipse cx="15" cy="37" rx="7.5" ry="6" />
      <ellipse cx="30" cy="37" rx="7.5" ry="6" />
      {/* Shaft — tapers wider at base */}
      <path d="M18.5 17 L17 32 Q17 35 22.5 35 Q28 35 28 32 L26.5 17 Z" />
      {/* Mushroom head — rounded top */}
      <path d="M16 17Q16 9 22.5 8Q29 9 29 17Q27 19.5 22.5 19.5Q18 19.5 16 17Z" />
      {/* Ridge under head */}
      <path d="M17 17.5Q22.5 20.5 28 17.5" fill="none" stroke="var(--piece-white-stroke, #3a3540)" strokeWidth="0.6" />
      {/* Slit */}
      <line x1="22.5" y1="10.5" x2="22.5" y2="13" stroke="var(--piece-white-stroke, #3a3540)" strokeWidth="0.7" />
      {/* Pubes — little hair lines */}
      <g stroke="var(--piece-white-stroke, #3a3540)" strokeWidth="0.5" strokeLinecap="round">
        <line x1="10" y1="34" x2="7" y2="31" />
        <line x1="9" y1="37" x2="6" y2="36" />
        <line x1="10" y1="40" x2="7" y2="42" />
        <line x1="35" y1="34" x2="38" y2="31" />
        <line x1="36" y1="37" x2="39" y2="36" />
        <line x1="35" y1="40" x2="38" y2="42" />
        <line x1="12" y1="32" x2="10" y2="29" />
        <line x1="33" y1="32" x2="35" y2="29" />
      </g>
    </g>
  </SVG>
);

// ── Black pieces ──

const bK = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      <path d="M22.5 11.63V6M20 8h5" stroke="var(--piece-black, var(--accent, #8b5cf6))" strokeWidth="1.5" />
      <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
      <path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7" />
    </g>
  </SVG>
);

const bQ = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-3.5-12.5-5 13.5-5-13.5L14 25 6.5 13.5 9 26z" />
      <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1 2.5-1 2.5-1.5 1.5 0 2.5 0 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="14" cy="9" r="2" />
      <circle cx="22.5" cy="8" r="2" />
      <circle cx="31" cy="9" r="2" />
      <circle cx="39" cy="12" r="2" />
    </g>
  </SVG>
);

const bR = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      <path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z" />
      <path d="M14 29.5v-13h17v13H14z" />
      <path d="M14 16.5L11 14h23l-3 2.5H14zM11 14V9h4v2h5V9h5v2h5V9h4v5H11z" />
    </g>
  </SVG>
);

const bB = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z" />
      <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
      <circle cx="22.5" cy="8" r="2.5" />
    </g>
  </SVG>
);

const bN = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
      <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4-1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
      <circle cx="31" cy="15.5" r="1" fill="var(--piece-black-stroke, #1a1128)" />
    </g>
  </SVG>
);

// PAWN — Dick with round balls and pubes (like the reference pic)
const bP = (props?: PieceProps) => (
  <SVG style={props?.svgStyle}>
    <g fill="var(--piece-black, var(--accent, #8b5cf6))" stroke="none">
      {/* Round balls */}
      <ellipse cx="15" cy="37" rx="7.5" ry="6" />
      <ellipse cx="30" cy="37" rx="7.5" ry="6" />
      {/* Shaft — tapers wider at base */}
      <path d="M18.5 17 L17 32 Q17 35 22.5 35 Q28 35 28 32 L26.5 17 Z" />
      {/* Mushroom head — rounded top */}
      <path d="M16 17Q16 9 22.5 8Q29 9 29 17Q27 19.5 22.5 19.5Q18 19.5 16 17Z" />
      {/* Ridge under head */}
      <path d="M17 17.5Q22.5 20.5 28 17.5" fill="none" stroke="var(--piece-black-inner, rgba(255,255,255,0.15))" strokeWidth="0.6" />
      {/* Slit */}
      <line x1="22.5" y1="10.5" x2="22.5" y2="13" stroke="var(--piece-black-inner, rgba(255,255,255,0.15))" strokeWidth="0.7" />
      {/* Pubes — little hair lines */}
      <g stroke="var(--piece-black-stroke, #1a1128)" strokeWidth="0.5" strokeLinecap="round">
        <line x1="10" y1="34" x2="7" y2="31" />
        <line x1="9" y1="37" x2="6" y2="36" />
        <line x1="10" y1="40" x2="7" y2="42" />
        <line x1="35" y1="34" x2="38" y2="31" />
        <line x1="36" y1="37" x2="39" y2="36" />
        <line x1="35" y1="40" x2="38" y2="42" />
        <line x1="12" y1="32" x2="10" y2="29" />
        <line x1="33" y1="32" x2="35" y2="29" />
      </g>
    </g>
  </SVG>
);

export const themedPieces: Record<string, (props?: PieceProps) => React.JSX.Element> = {
  wK, wQ, wR, wB, wN, wP,
  bK, bQ, bR, bB, bN, bP,
};
