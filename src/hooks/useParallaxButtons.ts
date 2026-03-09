import { useEffect } from "react";

/**
 * Adds a subtle parallax mouse-follow effect to all .btn elements.
 * Button shifts slightly toward the cursor and scales up on hover.
 * Inspired by huhulinks.
 */
export function useParallaxButtons() {
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".btn");
      if (!btn || btn.hasAttribute("disabled")) return;

      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;

      const xPct = (x / w - 0.5) * 2;   // -1 to 1
      const yPct = (y / h - 0.5) * 2;   // -1 to 1

      const tx = xPct * 3;   // max 3px shift
      const ty = yPct * 2;   // max 2px shift

      btn.style.transform = `translate(${tx}px, ${ty}px) scale(1.04)`;
    }

    function onLeave(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".btn");
      if (!btn) return;
      btn.style.transform = "";
    }

    function onClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".btn");
      if (!btn || btn.hasAttribute("disabled")) return;
      btn.style.transform = "scale(0.96)";
      requestAnimationFrame(() => {
        setTimeout(() => {
          btn.style.transform = "";
        }, 120);
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave, true);
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave, true);
      document.removeEventListener("click", onClick);
    };
  }, []);
}
