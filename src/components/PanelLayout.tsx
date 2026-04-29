import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { MobileTabBar } from "./MobileTabBar";

interface Props {
  mailPanel: ReactNode;
  cloudPanel: ReactNode;
  terminalPanel: ReactNode;
}

const TAB_ORDER = ["mail", "panels", "terminal"] as const;

export function PanelLayout({ mailPanel, cloudPanel, terminalPanel }: Props) {
  const [mobileTab, setMobileTab] = useState<"mail" | "panels" | "terminal">("mail");
  const prevTabRef = useRef<"mail" | "panels" | "terminal">("mail");

  const handleTabChange = (tab: "mail" | "panels" | "terminal") => {
    prevTabRef.current = mobileTab;
    setMobileTab(tab);
  };

  const prevIdx = TAB_ORDER.indexOf(prevTabRef.current);
  const curIdx = TAB_ORDER.indexOf(mobileTab);
  const slideDir = curIdx > prevIdx ? "left" : "right";

  return (
    <>
      <div className="panel-grid">
        <div
          className={`panel-cell panel-mail${mobileTab === "mail" ? " panel-cell--active" : ""}`}
          data-slide={mobileTab === "mail" ? slideDir : undefined}
        >
          <div className="panel-label">mail</div>
          {mailPanel}
        </div>
        <div
          className={`panel-cell panel-cloud${mobileTab === "panels" ? " panel-cell--active" : ""}`}
          data-slide={mobileTab === "panels" ? slideDir : undefined}
        >
          <div className="panel-label">cloud</div>
          {cloudPanel}
        </div>
        <div
          className={`panel-cell panel-terminal${mobileTab === "terminal" ? " panel-cell--active" : ""}`}
          data-slide={mobileTab === "terminal" ? slideDir : undefined}
        >
          <div className="panel-label">terminal</div>
          {terminalPanel}
        </div>
      </div>
      <MobileTabBar active={mobileTab} onChange={handleTabChange} />
    </>
  );
}
