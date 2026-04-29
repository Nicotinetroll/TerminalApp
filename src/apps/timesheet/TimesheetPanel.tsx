import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";

// ── Types ──

interface Project { id: string; name: string; allocation: number }
interface Entry { date: Date; project: string; hours: number }

// ── Constants ──

const SK_HOL: [number, number][] = [[1,1],[1,6],[5,1],[5,8],[7,5],[8,29],[9,1],[9,15],[11,1],[11,17],[12,24],[12,25],[12,26]];
const SK_HOL_NAMES: Record<string, string> = {
  "1-1": "New Year", "1-6": "Epiphany", "5-1": "Labour Day", "5-8": "Victory Day",
  "7-5": "Cyril & Methodius", "8-29": "SNP Day", "9-1": "Constitution Day",
  "9-15": "Lady of Sorrows", "11-1": "All Saints", "11-17": "Freedom Day",
  "12-24": "Christmas Eve", "12-25": "Christmas", "12-26": "St. Stephen",
};
const MO = ["Jan","Feb","Mar","Apr","Máj","Jún","Júl","Aug","Sep","Okt","Nov","Dec"];
const MO_FILE = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MAX_H = 9;
const YRS = Array.from({ length: 16 }, (_, i) => 2020 + i);

// ── Helpers ──

const uid = () => Math.random().toString(36).slice(2, 11);

function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

function getHolidays(y: number): Set<string> {
  const s = new Set<string>();
  for (const [m, d] of SK_HOL) s.add(`${y}-${m}-${d}`);
  const e = easter(y);
  const gf = new Date(e); gf.setDate(e.getDate() - 2);
  const em = new Date(e); em.setDate(e.getDate() + 1);
  s.add(`${gf.getFullYear()}-${gf.getMonth() + 1}-${gf.getDate()}`);
  s.add(`${em.getFullYear()}-${em.getMonth() + 1}-${em.getDate()}`);
  return s;
}

function getHolidaysInMonth(y: number, m: number): { date: Date; name: string }[] {
  const hol = getHolidays(y);
  const out: { date: Date; name: string }[] = [];
  for (let i = 1, t = new Date(y, m + 1, 0).getDate(); i <= t; i++) {
    const d = new Date(y, m, i), w = d.getDay();
    if (w !== 0 && w !== 6 && hol.has(`${y}-${m + 1}-${i}`)) {
      const key = `${m + 1}-${i}`;
      const eDate = easter(y);
      const gf = new Date(eDate); gf.setDate(eDate.getDate() - 2);
      const em = new Date(eDate); em.setDate(eDate.getDate() + 1);
      let name = SK_HOL_NAMES[key] ?? "";
      if (!name && gf.getMonth() === m && gf.getDate() === i) name = "Good Friday";
      if (!name && em.getMonth() === m && em.getDate() === i) name = "Easter Monday";
      out.push({ date: d, name: name || "Holiday" });
    }
  }
  return out;
}

function getWorkDays(y: number, m: number): Date[] {
  const hol = getHolidays(y), out: Date[] = [];
  for (let i = 1, t = new Date(y, m + 1, 0).getDate(); i <= t; i++) {
    const d = new Date(y, m, i), w = d.getDay();
    if (w !== 0 && w !== 6 && !hol.has(`${y}-${m + 1}-${i}`)) out.push(d);
  }
  return out;
}

function getHolCount(y: number, m: number): number {
  const hol = getHolidays(y); let c = 0;
  for (let i = 1, t = new Date(y, m + 1, 0).getDate(); i <= t; i++) {
    const d = new Date(y, m, i), w = d.getDay();
    if (w !== 0 && w !== 6 && hol.has(`${y}-${m + 1}-${i}`)) c++;
  }
  return c;
}

const fmtD = (d: Date) =>
  `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
const fmtS = (d: Date) =>
  `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.`;

// ── Bulletproof Math (whole hours only) ──

function distribute(totalH: number, n: number, rnd: number): number[] {
  if (n <= 0 || totalH <= 0) return [];
  const eff = Math.min(totalH, MAX_H * n);
  const base = Math.floor(eff / n);
  let rem = eff - base * n;
  const s = new Array<number>(n).fill(base);
  for (let i = 0; i < n && rem > 0; i++) { s[i]!++; rem--; }
  if (rnd > 0 && n > 1) {
    const v = Math.max(1, Math.floor(base * (rnd / 100)));
    for (let i = 0; i < n; i++) s[i] = Math.max(1, Math.min(MAX_H, s[i]! + Math.round((Math.random() * 2 - 1) * v)));
    for (let a = 0; a < 3000; a++) {
      const sum = s.reduce((a, b) => a + b, 0), diff = eff - sum;
      if (diff === 0) break;
      const i = Math.floor(Math.random() * n);
      if (diff > 0 && s[i]! < MAX_H) s[i]!++;
      else if (diff < 0 && s[i]! > 1) s[i]!--;
    }
  }
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j]!, s[i]!]; }
  return s;
}

function projTargets(totalH: number, ps: Project[]): Map<string, number> {
  const r = new Map<string, number>();
  if (!ps.length) return r;
  const shares = ps.map(p => totalH * p.allocation);
  const fl = shares.map(v => Math.floor(v));
  const rems = shares.map((v, i) => ({ i, r: v - fl[i]! })).sort((a, b) => b.r - a.r);
  let diff = totalH - fl.reduce((a, b) => a + b, 0);
  for (const { i } of rems) { if (diff <= 0) break; fl[i]!++; diff--; }
  ps.forEach((p, i) => r.set(p.id, fl[i]!));
  return r;
}

function genEntries(dh: number[], days: Date[], ps: Project[], tgt: Map<string, number>): Entry[] {
  const out: Entry[] = [], act = new Map<string, number>();
  ps.forEach(p => act.set(p.id, 0));
  for (let d = 0; d < days.length; d++) {
    const h = dh[d]!;
    if (h <= 0) continue;
    const last = d === days.length - 1;
    let given = 0;
    for (let p = 0; p < ps.length; p++) {
      const proj = ps[p]!;
      const target = tgt.get(proj.id) ?? 0;
      const actual = act.get(proj.id) ?? 0;
      const rem = target - actual;
      let give: number;
      if (p === ps.length - 1) {
        give = h - given;
      } else if (last) {
        give = Math.min(rem, h - given);
      } else {
        let unproc = 0;
        for (let q = p; q < ps.length; q++) unproc += (tgt.get(ps[q]!.id) ?? 0) - (act.get(ps[q]!.id) ?? 0);
        if (unproc <= 0) { give = 0; }
        else { give = Math.round((h - given) * (rem / unproc)); give = Math.max(0, Math.min(give, h - given, rem)); }
      }
      give = Math.max(0, give);
      if (give > 0) out.push({ date: days[d]!, project: proj.name, hours: give });
      act.set(proj.id, actual + give);
      given += give;
    }
  }
  return out;
}

// ── PDF ──

async function buildPdf(
  pEntries: Entry[], pActTotal: number, pProjAct: Map<string, number>,
  pFileBase: string, dayCount: number, fond: number,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(pFileBase, 20, 20);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Working days: ${dayCount} | Total: ${pActTotal}h | Fond: ${fond}h`, 20, 28);
  let y = 38;
  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Date", 20, y); doc.text("Project", 65, y); doc.text("Hours", 165, y);
  doc.setLineWidth(0.3); doc.line(20, y + 2, 190, y + 2); y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  let prev = "";
  for (const e of pEntries) {
    if (y > 275) { doc.addPage(); y = 20; }
    const ds = fmtD(e.date);
    doc.text(ds === prev ? "" : ds, 20, y);
    doc.text(e.project, 65, y);
    doc.text(String(e.hours), 165, y);
    prev = ds; y += 6;
  }
  y += 4; doc.line(20, y - 2, 190, y - 2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`Total: ${pActTotal}h`, 20, y + 4);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(Array.from(pProjAct.entries()).map(([n, h]) => `${n}: ${h}h`).join("  "), 20, y + 12);
  return doc;
}

// ── Sub-components ──

const STEP_LABELS = ["pay info", "projects", "time period", "preview", "download"];

function WizardNav({ step, setStep, canNext, nextLabel, onNext }: {
  step: number; setStep: (s: number) => void; canNext: boolean; nextLabel: string;
  onNext?: () => void;
}) {
  return (
    <div className="ts-wiz-footer">
      {step > 0 && (
        <button className="ts-btn" onClick={() => setStep(step - 1)}>&larr; back</button>
      )}
      <div className="ts-wiz-dots">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="ts-wiz-dot-row">
            {i > 0 && <div className={`ts-wiz-line${i <= step ? " active" : ""}`} />}
            <div className={`ts-wiz-dot${i <= step ? " active" : ""}${i === step ? " current" : ""}`}
              title={label}>{i + 1}</div>
          </div>
        ))}
      </div>
      <button className="ts-btn ts-btn-accent" disabled={!canNext}
        onClick={onNext ?? (() => setStep(step + 1))}>
        {nextLabel}
      </button>
    </div>
  );
}

function StepPay({ prefix, setPrefix, rate, setRate, salary, setSalary, totalH, month, year }: {
  prefix: string; setPrefix: (v: string) => void;
  rate: number; setRate: (v: number) => void;
  salary: number; setSalary: (v: number) => void;
  totalH: number; month: number; year: number;
}) {
  const rateEgg = Math.abs(rate - 4.20) < 0.001;
  const freeEgg = totalH === 0 && salary === 0;
  return (
    <div className="ts-wiz-body">
      <div className="ts-wiz-title">&gt; pay info</div>
      <p className="ts-wiz-desc">
        how much they paying you? {rateEgg && <span className="ts-egg">nice rate bro</span>}
        {freeEgg && <span className="ts-egg">you work for free? respect.</span>}
      </p>
      <div className="ts-row">
        <div className="ts-field">
          <label className="ts-label">monthly salary (€)</label>
          <input className="ts-input" type="number" min="0" step="10" value={salary}
            onChange={e => setSalary(Math.max(0, Number(e.target.value)))} autoFocus />
        </div>
        <div className="ts-field">
          <label className="ts-label">hourly rate (€/h)</label>
          <input className="ts-input" type="number" min="0.01" step="0.1" value={rate}
            onChange={e => setRate(Math.max(0.01, Number(e.target.value)))} />
        </div>
      </div>
      <div className="ts-computed">= {totalH}h / month</div>
      <div className="ts-field" style={{ marginTop: 12 }}>
        <label className="ts-label">export name prefix</label>
        <input className="ts-input" type="text" value={prefix}
          onChange={e => setPrefix(e.target.value)}
          placeholder="e.g. Acme Corp" maxLength={50} />
        <div className="ts-hint">
          {"→ "}{prefix.trim()
            ? `${prefix.trim()} Timesheet ${MO_FILE[month] ?? ""} ${year}`
            : `Timesheet ${MO_FILE[month] ?? ""} ${year}`
          }.pdf
        </div>
      </div>
    </div>
  );
}

function StepProjects({ projects, setProjects }: {
  projects: Project[]; setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
}) {
  const aSum = projects.reduce((s, p) => s + p.allocation, 0);
  const aOk = projects.length > 0 && Math.abs(aSum - 1) < 0.001;
  const sigmaEgg = projects.length === 1 && aOk;

  const addProj = () => setProjects(p => [...p, { id: uid(), name: "New Project", allocation: 0 }]);
  const delProj = (id: string) => setProjects(p => p.filter(x => x.id !== id));
  const updProj = (id: string, f: "name" | "allocation", v: string | number) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (f === "allocation") {
        const val = Math.round((v as number) / 0.05) * 0.05;
        const rest = prev.filter(x => x.id !== id).reduce((s, x) => s + x.allocation, 0);
        return { ...p, allocation: Math.min(val, Math.max(0, 1 - rest)) };
      }
      return { ...p, [f]: v };
    }));
  };

  return (
    <div className="ts-wiz-body">
      <div className="ts-wiz-title">&gt; projects</div>
      <p className="ts-wiz-desc">
        add your projects and split the hours.{" "}
        {sigmaEgg && <span className="ts-egg">sigma grindset</span>}
      </p>
      {projects.map(p => (
        <div key={p.id} className="ts-project">
          <div className="ts-project-top">
            <input className="ts-input ts-project-name" type="text" value={p.name}
              onChange={e => updProj(p.id, "name", e.target.value)} />
            <button className="ts-btn-sm ts-btn-del" onClick={() => delProj(p.id)}>x</button>
          </div>
          <div className="ts-slider-wrap">
            <input type="range" className="ts-slider" min="0" max="1" step="0.05" value={p.allocation}
              onChange={e => updProj(p.id, "allocation", Number(e.target.value))} />
            <span className="ts-slider-val">{Math.round(p.allocation * 100)}%</span>
          </div>
        </div>
      ))}
      <button className="ts-btn" onClick={addProj} disabled={aSum >= 1}>+ add project</button>
      <div className={`ts-wiz-alloc ${aOk ? "ok" : "warn"}`}>
        {Math.round(aSum * 100)}%{aOk ? " — locked and loaded" : " — must be exactly 100%"}
      </div>
    </div>
  );
}

function StepTime({ month, setMonth, year, setYear }: {
  month: number; setMonth: (v: number) => void;
  year: number; setYear: (v: number) => void;
}) {
  const days = getWorkDays(year, month);
  const hols = getHolCount(year, month);
  const holidays = getHolidaysInMonth(year, month);
  const decEgg = month === 11;

  return (
    <div className="ts-wiz-body">
      <div className="ts-wiz-title">&gt; time period</div>
      <p className="ts-wiz-desc">
        pick the month and year.{" "}
        {decEgg && <span className="ts-egg">ho ho ho, time to fake some hours</span>}
      </p>
      <div className="ts-row">
        <div className="ts-field">
          <label className="ts-label">month</label>
          <select className="ts-input" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MO.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
        <div className="ts-field">
          <label className="ts-label">year</label>
          <select className="ts-input" value={year} onChange={e => setYear(Number(e.target.value))}>
            {YRS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="ts-stats-card">
        <div className="ts-stats-row">
          <span className="ts-stats-label">working days</span>
          <span className="ts-stats-value">{days.length}</span>
        </div>
        <div className="ts-stats-row">
          <span className="ts-stats-label">holidays (weekday)</span>
          <span className="ts-stats-value">{hols}</span>
        </div>
        {holidays.length > 0 && (
          <div className="ts-holiday-list">
            {holidays.map((h, i) => (
              <span key={i} className="ts-holiday-tag">{fmtS(h.date)} {h.name}</span>
            ))}
          </div>
        )}
        <div className="ts-stats-divider" />
        <div className="ts-stats-row">
          <span className="ts-stats-label">fond hours</span>
          <span className="ts-stats-value">{days.length * 8}h</span>
        </div>
      </div>
    </div>
  );
}

function StepPreview({ entries, actTotal, projAct, fileBase, dayCount, fond, randomness,
  setRandomness, setSeed, exportType, setExportType }: {
  entries: Entry[]; actTotal: number; projAct: Map<string, number>;
  fileBase: string; dayCount: number; fond: number;
  randomness: number; setRandomness: (v: number) => void;
  setSeed: React.Dispatch<React.SetStateAction<number>>;
  exportType: "single" | "split"; setExportType: (v: "single" | "split") => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);
  const chaosEgg = randomness === 100;

  useEffect(() => {
    let cancelled = false;
    if (entries.length === 0) { setPdfUrl(null); return; }
    void buildPdf(entries, actTotal, projAct, fileBase, dayCount, fond).then(doc => {
      const url = doc.output("bloburl") as string;
      if (cancelled) { URL.revokeObjectURL(url); return; }
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
      prevUrl.current = url;
      setPdfUrl(url);
    });
    return () => { cancelled = true; };
  }, [entries, actTotal, projAct, fileBase, dayCount, fond]);

  useEffect(() => {
    return () => { if (prevUrl.current) URL.revokeObjectURL(prevUrl.current); };
  }, []);

  return (
    <div className="ts-wiz-body ts-preview-body">
      <div className="ts-wiz-title">&gt; preview</div>
      <div className="ts-preview-controls">
        <div className="ts-slider-wrap" style={{ flex: 1 }}>
          <span className="ts-label" style={{ margin: 0, whiteSpace: "nowrap" }}>variance</span>
          <input type="range" className="ts-slider" min="0" max="100" step="5" value={randomness}
            onChange={e => setRandomness(Number(e.target.value))} />
          <span className="ts-slider-val">{randomness}%</span>
          {chaosEgg && <span className="ts-egg">chaos mode</span>}
        </div>
        <button className="ts-btn-sm" onClick={() => setSeed(s => s + 1)} title="reshuffle">↻</button>
        <div className="ts-export-toggle">
          <button className={`ts-toggle-btn${exportType === "single" ? " active" : ""}`}
            onClick={() => setExportType("single")}>single</button>
          <button className={`ts-toggle-btn${exportType === "split" ? " active" : ""}`}
            onClick={() => setExportType("split")}>split</button>
        </div>
      </div>
      {pdfUrl ? (
        <iframe src={pdfUrl} className="ts-preview-frame" title="PDF Preview" />
      ) : (
        <div className="ts-preview-empty">no data to preview</div>
      )}
    </div>
  );
}

function StepDownload({ entries, actTotal, projAct, projects, fileBase, prefix,
  dayCount, fond, month, year, exportType, onReset }: {
  entries: Entry[]; actTotal: number; projAct: Map<string, number>;
  projects: Project[]; fileBase: string; prefix: string;
  dayCount: number; fond: number; month: number; year: number;
  exportType: "single" | "split"; onReset: () => void;
}) {
  const dlPDF = useCallback(async () => {
    if (!entries.length) return;
    const doc = await buildPdf(entries, actTotal, projAct, fileBase, dayCount, fond);
    doc.save(`${fileBase}.pdf`);
  }, [entries, actTotal, projAct, fileBase, dayCount, fond]);

  const dlSplitPDF = useCallback(async (projectName?: string) => {
    if (!entries.length) return;
    const names = projectName ? [projectName] : [...new Set(entries.map(e => e.project))];
    for (const pName of names) {
      const pEntries = entries.filter(e => e.project === pName);
      const pTotal = pEntries.reduce((s, e) => s + e.hours, 0);
      const pAct = new Map<string, number>([[pName, pTotal]]);
      const pBase = prefix.trim()
        ? `${prefix.trim()} Timesheet ${pName} ${MO_FILE[month] ?? ""} ${year}`
        : `Timesheet ${pName} ${MO_FILE[month] ?? ""} ${year}`;
      const doc = await buildPdf(pEntries, pTotal, pAct, pBase, dayCount, fond);
      doc.save(`${pBase}.pdf`);
    }
  }, [entries, prefix, month, year, dayCount, fond]);

  const dlCSV = useCallback(() => {
    if (!entries.length) return;
    const csv = "Date,Project,Hours\n" + entries.map(e => `${fmtD(e.date)},${e.project},${e.hours}`).join("\n") + `\nTotal,,${actTotal}`;
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.href = url;
    a.download = `${fileBase}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [entries, actTotal, fileBase]);

  return (
    <div className="ts-wiz-body">
      <div className="ts-wiz-title">&gt; download</div>
      <p className="ts-wiz-desc">your timesheet is ready. grab it.</p>

      <div className="ts-summary">
        <div className="ts-stats-row">
          <span className="ts-stats-label">period</span>
          <span className="ts-stats-value">{MO[month]} {year}</span>
        </div>
        <div className="ts-stats-row">
          <span className="ts-stats-label">working days</span>
          <span className="ts-stats-value">{dayCount}</span>
        </div>
        <div className="ts-stats-row">
          <span className="ts-stats-label">total hours</span>
          <span className="ts-stats-value ts-hl">{actTotal}h</span>
        </div>
        <div className="ts-stats-divider" />
        {projects.map(p => {
          const h = projAct.get(p.name) ?? 0;
          return (
            <div key={p.id} className="ts-stats-row">
              <span className="ts-stats-label">{p.name}</span>
              <span className="ts-stats-value">{h}h ({Math.round(p.allocation * 100)}%)</span>
            </div>
          );
        })}
      </div>

      <div className="ts-download-grid">
        {exportType === "single" ? (
          <button className="ts-btn ts-btn-accent ts-dl-btn" onClick={() => void dlPDF()}
            disabled={!entries.length}>yoink that PDF</button>
        ) : (
          <>
            {projects.length > 1 && (
              <button className="ts-btn ts-btn-accent ts-dl-btn" onClick={() => void dlSplitPDF()}
                disabled={!entries.length}>download all PDFs</button>
            )}
            {projects.map(p => (
              <button key={p.id} className="ts-btn ts-dl-btn" onClick={() => void dlSplitPDF(p.name)}
                disabled={!entries.length}>{p.name}.pdf</button>
            ))}
          </>
        )}
        <button className="ts-btn ts-dl-btn" onClick={dlCSV} disabled={!entries.length}>CSV</button>
      </div>

      <button className="ts-btn ts-btn-ghost" onClick={onReset} style={{ marginTop: 16 }}>
        start over
      </button>
    </div>
  );
}

// ── Main Component ──

export function TimesheetPanel({ windowId, windowManager }: WindowContentProps) {
  const [step, setStep] = useState(0);

  // Wizard state
  const [prefix, setPrefix] = useState("");
  const [rate, setRate] = useState(17.8);
  const [salary, setSalary] = useState(3000);
  const [projects, setProjects] = useState<Project[]>(() => [
    { id: uid(), name: "Project Alpha", allocation: 0.7 },
    { id: uid(), name: "Project Beta", allocation: 0.3 },
  ]);
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [randomness, setRandomness] = useState(0);
  const [exportType, setExportType] = useState<"single" | "split">("single");
  const [seed, setSeed] = useState(0);

  // Derived
  const totalH = rate > 0 ? Math.round(salary / rate) : 0;
  const aSum = projects.reduce((s, p) => s + p.allocation, 0);
  const aOk = projects.length > 0 && Math.abs(aSum - 1) < 0.001;
  const days = useMemo(() => getWorkDays(year, month), [year, month]);
  const fond = days.length * 8;
  const over = totalH > days.length * MAX_H;

  const tgt = useMemo(() => aOk ? projTargets(totalH, projects) : new Map<string, number>(), [aOk, totalH, projects]);

  // seed is used as a cache-buster: changing it forces re-generation with new random distribution
  const entries = useMemo((): Entry[] => {
    if (seed < -1) return []; // unreachable — keeps seed in the dependency graph
    if (!aOk || rate <= 0 || over || totalH <= 0) return [];
    return genEntries(distribute(totalH, days.length, randomness), days, projects, tgt);
  }, [aOk, rate, over, totalH, days, randomness, projects, tgt, seed]);

  const actTotal = useMemo(() => entries.reduce((s, e) => s + e.hours, 0), [entries]);
  const projAct = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.project, (m.get(e.project) ?? 0) + e.hours);
    return m;
  }, [entries]);

  const fileBase = prefix.trim()
    ? `${prefix.trim()} Timesheet ${MO_FILE[month] ?? ""} ${year}`
    : `Timesheet ${MO_FILE[month] ?? ""} ${year}`;

  // Can advance?
  const canNext = step === 0
    ? rate > 0 && salary > 0
    : step === 1
      ? aOk
      : step === 2
        ? !over && totalH > 0
        : step === 3
          ? entries.length > 0
          : false;

  const nextLabel = step === 3 ? "generate →" : step === 4 ? "" : "next →";

  // Window title
  useEffect(() => {
    if (!windowManager || !windowId) return;
    windowManager.updateWindowTitle(windowId, `timesheet — ${STEP_LABELS[step] ?? ""}`);
  }, [windowManager, windowId, step]);

  // Reset wizard
  const onReset = useCallback(() => {
    setStep(0);
    setPrefix("");
    setRate(17.8);
    setSalary(3000);
    setProjects([
      { id: uid(), name: "Project Alpha", allocation: 0.7 },
      { id: uid(), name: "Project Beta", allocation: 0.3 },
    ]);
    setMonth(new Date().getMonth());
    setYear(new Date().getFullYear());
    setRandomness(0);
    setExportType("single");
    setSeed(0);
  }, []);

  return (
    <div className="ts-panel">
      <div className="ts-wizard">
        {step === 0 && (
          <StepPay prefix={prefix} setPrefix={setPrefix}
            rate={rate} setRate={setRate} salary={salary} setSalary={setSalary}
            totalH={totalH} month={month} year={year} />
        )}
        {step === 1 && (
          <StepProjects projects={projects} setProjects={setProjects} />
        )}
        {step === 2 && (
          <>
            <StepTime month={month} setMonth={setMonth} year={year} setYear={setYear} />
            {over && <div className="ts-alert error">[!] {totalH}h exceeds {days.length}d × {MAX_H}h — too many hours for this month</div>}
          </>
        )}
        {step === 3 && (
          <StepPreview entries={entries} actTotal={actTotal} projAct={projAct}
            fileBase={fileBase} dayCount={days.length} fond={fond}
            randomness={randomness} setRandomness={setRandomness}
            setSeed={setSeed}
            exportType={exportType} setExportType={setExportType} />
        )}
        {step === 4 && (
          <StepDownload entries={entries} actTotal={actTotal} projAct={projAct}
            projects={projects} fileBase={fileBase} prefix={prefix.trim()}
            dayCount={days.length} fond={fond} month={month} year={year}
            exportType={exportType} onReset={onReset} />
        )}

        {step < 4 && (
          <WizardNav step={step} setStep={setStep} canNext={canNext}
            nextLabel={nextLabel}
            onNext={step === 3 ? () => setStep(4) : undefined} />
        )}
      </div>
    </div>
  );
}
