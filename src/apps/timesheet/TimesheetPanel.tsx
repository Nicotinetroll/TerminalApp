import { useState, useMemo, useCallback, useEffect } from "react";
import type { WindowContentProps } from "@/types/terminal";

// ── Types ──

interface Project { id: string; name: string; allocation: number }
interface Entry { date: Date; project: string; hours: number }
interface Profile { name: string; projects: { name: string; allocation: number }[] }
interface Cfg {
  prefix: string;
  rate: number;
  salary: number;
  randomness: number;
  projects: { name: string; allocation: number }[];
  setupDone: boolean;
  months: Record<string, { name: string; allocation: number }[]>;
  profiles: Profile[];
}

// ── Constants ──

const SK_HOL: [number, number][] = [[1,1],[1,6],[5,1],[5,8],[7,5],[8,29],[9,1],[9,15],[11,1],[11,17],[12,24],[12,25],[12,26]];
const MO = ["Jan","Feb","Mar","Apr","Máj","Jún","Júl","Aug","Sep","Okt","Nov","Dec"];
const MO_FILE = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MAX_H = 9;
const YRS = Array.from({ length: 16 }, (_, i) => 2020 + i);
const LS = "ts-cfg";
const DEF: Cfg = {
  prefix: "",
  rate: 17.8,
  salary: 3000,
  randomness: 0,
  projects: [{ name: "Project Alpha", allocation: 0.7 }, { name: "Project Beta", allocation: 0.3 }],
  setupDone: false,
  months: {},
  profiles: [],
};

// ── Helpers ──

const uid = () => Math.random().toString(36).slice(2, 11);

function loadCfg(): Cfg {
  try {
    const r = localStorage.getItem(LS);
    if (r) {
      const p = JSON.parse(r) as Cfg;
      if (p.rate > 0 && p.projects?.length) return { ...DEF, months: {}, profiles: [], ...p };
    }
  } catch { /* */ }
  return { ...DEF, projects: DEF.projects.map(p => ({ ...p })) };
}

function saveCfg(c: Cfg) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* */ } }

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

function mkMonthKey(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

// ── Component ──

type View = "setup" | "main" | "settings";

export function TimesheetPanel({ user: _u, windowId, windowManager, closeWindow: _cw }: WindowContentProps) {
  const now = new Date();
  const [cfg, setCfg] = useState<Cfg>(loadCfg);
  const [view, setView] = useState<View>(cfg.setupDone ? "main" : "setup");
  const [wizStep, setWizStep] = useState(0);

  // ── Edit state (wizard + settings) ──
  const [ePrefix, setEPrefix] = useState(cfg.prefix);
  const [eRate, setERate] = useState(cfg.rate);
  const [eSalary, setESalary] = useState(cfg.salary);
  const [eRnd, setERnd] = useState(cfg.randomness);
  const [eProjs, setEProjs] = useState<Project[]>(() => cfg.projects.map(p => ({ ...p, id: uid() })));

  // ── Main view state ──
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [rnd, setRnd] = useState(cfg.randomness);
  const [seed, setSeed] = useState(0);
  const [monthEditorOpen, setMonthEditorOpen] = useState(false);
  const [meProjs, setMeProjs] = useState<Project[]>([]);
  const [profileName, setProfileName] = useState("");
  const [showProfileDrop, setShowProfileDrop] = useState(false);

  // ── Month key + active projects ──
  const monthKey = mkMonthKey(year, month);
  const monthOverride = cfg.months[monthKey];
  const isCustomMonth = !!monthOverride;

  // ── Edit helpers ──
  const eASum = useMemo(() => eProjs.reduce((s, p) => s + p.allocation, 0), [eProjs]);
  const eAOk = eProjs.length > 0 && Math.abs(eASum - 1) < 0.001;
  const eTotalH = eRate > 0 ? Math.round(eSalary / eRate) : 0;

  // ── Month editor helpers ──
  const meASum = useMemo(() => meProjs.reduce((s, p) => s + p.allocation, 0), [meProjs]);
  const meAOk = meProjs.length > 0 && Math.abs(meASum - 1) < 0.001;

  const openMonthEditor = useCallback(() => {
    const src = monthOverride ?? cfg.projects;
    setMeProjs(src.map(p => ({ ...p, id: uid() })));
    setMonthEditorOpen(true);
    setShowProfileDrop(false);
    setProfileName("");
  }, [monthOverride, cfg.projects]);

  const closeMonthEditor = useCallback(() => {
    setMonthEditorOpen(false);
    setShowProfileDrop(false);
  }, []);

  const meAddProj = useCallback(() => setMeProjs(p => [...p, { id: uid(), name: "New Project", allocation: 0 }]), []);
  const meDelProj = useCallback((id: string) => setMeProjs(p => p.filter(x => x.id !== id)), []);
  const meUpdProj = useCallback((id: string, f: "name" | "allocation", v: string | number) => {
    setMeProjs(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (f === "allocation") {
        const val = Math.round((v as number) / 0.05) * 0.05;
        const rest = prev.filter(x => x.id !== id).reduce((s, x) => s + x.allocation, 0);
        return { ...p, allocation: Math.min(val, Math.max(0, 1 - rest)) };
      }
      return { ...p, [f]: v };
    }));
  }, []);

  const meSave = useCallback(() => {
    const projs = meProjs.map(p => ({ name: p.name, allocation: p.allocation }));
    const next = { ...cfg, months: { ...cfg.months, [monthKey]: projs } };
    saveCfg(next);
    setCfg(next);
    closeMonthEditor();
  }, [cfg, monthKey, meProjs, closeMonthEditor]);

  const meUseDefaults = useCallback(() => {
    const months = { ...cfg.months };
    delete months[monthKey];
    const next = { ...cfg, months };
    saveCfg(next);
    setCfg(next);
    closeMonthEditor();
  }, [cfg, monthKey, closeMonthEditor]);

  const meSaveAsProfile = useCallback(() => {
    const name = profileName.trim();
    if (!name) return;
    const projs = meProjs.map(p => ({ name: p.name, allocation: p.allocation }));
    const next = { ...cfg, profiles: [...cfg.profiles.filter(p => p.name !== name), { name, projects: projs }] };
    saveCfg(next);
    setCfg(next);
    setProfileName("");
  }, [cfg, meProjs, profileName]);

  const meLoadProfile = useCallback((prof: Profile) => {
    setMeProjs(prof.projects.map(p => ({ ...p, id: uid() })));
    setShowProfileDrop(false);
  }, []);

  const resetEdit = useCallback((c: Cfg) => {
    setEPrefix(c.prefix);
    setERate(c.rate);
    setESalary(c.salary);
    setERnd(c.randomness);
    setEProjs(c.projects.map(p => ({ ...p, id: uid() })));
  }, []);

  const doSave = useCallback(() => {
    const c: Cfg = {
      prefix: ePrefix.trim(),
      rate: eRate,
      salary: eSalary,
      randomness: eRnd,
      projects: eProjs.map(p => ({ name: p.name, allocation: p.allocation })),
      setupDone: true,
      months: cfg.months,
      profiles: cfg.profiles,
    };
    saveCfg(c);
    setCfg(c);
    setRnd(c.randomness);
    setView("main");
  }, [ePrefix, eRate, eSalary, eRnd, eProjs, cfg.months, cfg.profiles]);

  const openSettings = useCallback(() => {
    resetEdit(cfg);
    setView("settings");
    setMonthEditorOpen(false);
  }, [cfg, resetEdit]);

  const doReset = useCallback(() => { resetEdit(DEF); }, [resetEdit]);

  const addProj = useCallback(() => setEProjs(p => [...p, { id: uid(), name: "New Project", allocation: 0 }]), []);
  const delProj = useCallback((id: string) => setEProjs(p => p.filter(x => x.id !== id)), []);
  const updProj = useCallback((id: string, f: "name" | "allocation", v: string | number) => {
    setEProjs(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (f === "allocation") {
        const val = Math.round((v as number) / 0.05) * 0.05;
        const rest = prev.filter(x => x.id !== id).reduce((s, x) => s + x.allocation, 0);
        return { ...p, allocation: Math.min(val, Math.max(0, 1 - rest)) };
      }
      return { ...p, [f]: v };
    }));
  }, []);

  // ── Profile management (settings) ──
  const [spName, setSpName] = useState("");

  const saveCurrentAsProfile = useCallback(() => {
    const name = spName.trim();
    if (!name) return;
    const projs = eProjs.map(p => ({ name: p.name, allocation: p.allocation }));
    const next = { ...cfg, profiles: [...cfg.profiles.filter(p => p.name !== name), { name, projects: projs }] };
    saveCfg(next);
    setCfg(next);
    setSpName("");
  }, [cfg, eProjs, spName]);

  const deleteProfile = useCallback((name: string) => {
    const next = { ...cfg, profiles: cfg.profiles.filter(p => p.name !== name) };
    saveCfg(next);
    setCfg(next);
  }, [cfg]);

  const loadProfileToDefaults = useCallback((prof: Profile) => {
    setEProjs(prof.projects.map(p => ({ ...p, id: uid() })));
  }, []);

  // ── Main computation ──
  const activeProjectsSrc = monthOverride ?? cfg.projects;
  const mainProjs = useMemo<Project[]>(() => activeProjectsSrc.map((p, i) => ({ ...p, id: `p${i}` })), [activeProjectsSrc]);
  const days = useMemo(() => getWorkDays(year, month), [year, month]);
  const hols = useMemo(() => getHolCount(year, month), [year, month]);
  const fond = days.length * 8;
  const totalH = cfg.rate > 0 ? Math.round(cfg.salary / cfg.rate) : 0;
  const over = totalH > days.length * MAX_H;
  const mASum = mainProjs.reduce((s, p) => s + p.allocation, 0);
  const mAOk = mainProjs.length > 0 && Math.abs(mASum - 1) < 0.001;
  const tgt = useMemo(() => mAOk ? projTargets(totalH, mainProjs) : new Map<string, number>(), [mAOk, totalH, mainProjs]);

  const entries = useMemo((): Entry[] => {
    void seed;
    if (!mAOk || cfg.rate <= 0 || over || totalH <= 0) return [];
    return genEntries(distribute(totalH, days.length, rnd), days, mainProjs, tgt);
  }, [mAOk, cfg.rate, over, totalH, days, rnd, mainProjs, tgt, seed]);

  const actTotal = useMemo(() => entries.reduce((s, e) => s + e.hours, 0), [entries]);
  const projAct = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.project, (m.get(e.project) ?? 0) + e.hours);
    return m;
  }, [entries]);
  const otDays = useMemo(() => {
    const d: Record<string, number> = {};
    for (const e of entries) { const k = e.date.toDateString(); d[k] = (d[k] ?? 0) + e.hours; }
    return Object.values(d).filter(h => h > MAX_H).length;
  }, [entries]);
  const ok = mAOk && entries.length > 0 && otDays === 0 && !over;

  const fileBase = cfg.prefix
    ? `${cfg.prefix} Timesheet ${MO_FILE[month] ?? ""} ${year}`
    : `Timesheet ${MO_FILE[month] ?? ""} ${year}`;

  // ── Window title ──
  useEffect(() => {
    if (!windowManager || !windowId) return;
    if (view === "main") {
      windowManager.updateWindowTitle(windowId, `timesheet — ${MO[month] ?? ""} ${year}`);
    } else if (view === "settings") {
      windowManager.updateWindowTitle(windowId, "timesheet — settings");
    } else {
      windowManager.updateWindowTitle(windowId, "timesheet — setup");
    }
  }, [windowManager, windowId, view, month, year]);

  // ── Close month editor on month change ──
  useEffect(() => { setMonthEditorOpen(false); }, [month, year]);

  // ── Export ──
  const dlCSV = useCallback(() => {
    if (!entries.length) return;
    const csv = "Date,Project,Hours\n" + entries.map(e => `${fmtD(e.date)},${e.project},${e.hours}`).join("\n") + `\nTotal,,${actTotal}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${fileBase}.csv`;
    a.click();
  }, [entries, actTotal, fileBase]);

  const makePdf = useCallback(async (pEntries: Entry[], pActTotal: number, pProjAct: Map<string, number>, pFileBase: string) => {
    if (!pEntries.length) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(16); doc.setFont("helvetica", "bold");
    doc.text(pFileBase, 20, 20);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Working days: ${days.length} | Total: ${pActTotal}h | Fond: ${fond}h`, 20, 28);
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
    doc.save(`${pFileBase}.pdf`);
  }, [days.length, fond]);

  const dlPDF = useCallback(async () => {
    await makePdf(entries, actTotal, projAct, fileBase);
  }, [entries, actTotal, fileBase, projAct, makePdf]);

  const dlSplitPDF = useCallback(async () => {
    if (!entries.length) return;
    const projectNames = [...new Set(entries.map(e => e.project))];
    for (const pName of projectNames) {
      const pEntries = entries.filter(e => e.project === pName);
      const pTotal = pEntries.reduce((s, e) => s + e.hours, 0);
      const pAct = new Map<string, number>([[pName, pTotal]]);
      const pBase = cfg.prefix
        ? `${cfg.prefix} Timesheet ${pName} ${MO_FILE[month] ?? ""} ${year}`
        : `Timesheet ${pName} ${MO_FILE[month] ?? ""} ${year}`;
      await makePdf(pEntries, pTotal, pAct, pBase);
    }
  }, [entries, cfg.prefix, month, year, makePdf]);

  // ── Shared: project editor ──
  const projectsEditor = (
    <>
      {eProjs.map(p => (
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
      <button className="ts-btn" onClick={addProj} disabled={eASum >= 1}>+ add project</button>
    </>
  );

  // ── Render: Setup Wizard ──
  if (view === "setup") {
    return (
      <div className="ts-panel">
        <div className="ts-wizard">
          <div className="ts-wiz-steps">
            <div className={`ts-wiz-dot${wizStep >= 0 ? " active" : ""}`}>1</div>
            <div className={`ts-wiz-line${wizStep >= 1 ? " active" : ""}`} />
            <div className={`ts-wiz-dot${wizStep >= 1 ? " active" : ""}`}>2</div>
          </div>

          {wizStep === 0 ? (
            <div className="ts-wiz-body">
              <div className="ts-wiz-title">&gt; let's set you up</div>
              <p className="ts-wiz-desc">
                configure your defaults. you can change these later in settings.
              </p>

              <div className="ts-field">
                <label className="ts-label">export name prefix</label>
                <input className="ts-input" type="text" value={ePrefix}
                  onChange={e => setEPrefix(e.target.value)}
                  placeholder="e.g. Acme Corp" maxLength={50} autoFocus />
                <div className="ts-hint">
                  {"→ "}{ePrefix.trim()
                    ? `${ePrefix.trim()} Timesheet ${MO_FILE[now.getMonth()] ?? ""} ${now.getFullYear()}`
                    : `Timesheet ${MO_FILE[now.getMonth()] ?? ""} ${now.getFullYear()}`
                  }.pdf
                </div>
              </div>

              <div className="ts-row">
                <div className="ts-field">
                  <label className="ts-label">hourly rate (€/h)</label>
                  <input className="ts-input" type="number" min="0.01" step="0.1" value={eRate}
                    onChange={e => setERate(Math.max(0.01, Number(e.target.value)))} />
                </div>
                <div className="ts-field">
                  <label className="ts-label">monthly salary (€)</label>
                  <input className="ts-input" type="number" min="0" step="10" value={eSalary}
                    onChange={e => setESalary(Math.max(0, Number(e.target.value)))} />
                </div>
              </div>
              <div className="ts-computed">= {eTotalH}h / month</div>
            </div>
          ) : (
            <div className="ts-wiz-body">
              <div className="ts-wiz-title">&gt; default projects</div>
              <p className="ts-wiz-desc">
                these are your defaults — you can customize per month later from the main view.
              </p>
              {projectsEditor}
              <div className={`ts-wiz-alloc ${eAOk ? "ok" : "warn"}`}>
                {Math.round(eASum * 100)}%{eAOk ? " — locked and loaded" : ""}
              </div>
            </div>
          )}

          <div className="ts-wiz-footer">
            {wizStep > 0 && (
              <button className="ts-btn" onClick={() => setWizStep(0)}>← back</button>
            )}
            <div style={{ flex: 1 }} />
            {wizStep === 0 ? (
              <button className="ts-btn ts-btn-accent" onClick={() => setWizStep(1)}
                disabled={eRate <= 0 || eSalary <= 0}>
                next →
              </button>
            ) : (
              <button className="ts-btn ts-btn-accent" onClick={doSave} disabled={!eAOk}>
                let's go →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Settings ──
  if (view === "settings") {
    return (
      <div className="ts-panel">
        <div className="ts-settings">
          <div className="ts-settings-hdr">
            <button className="ts-btn-sm" onClick={() => setView("main")}>←</button>
            <span className="ts-settings-title">settings</span>
          </div>
          <div className="ts-settings-body">
            <div className="ts-section">
              <div className="ts-section-hdr">&gt; basics</div>
              <div className="ts-field">
                <label className="ts-label">export name prefix</label>
                <input className="ts-input" type="text" value={ePrefix}
                  onChange={e => setEPrefix(e.target.value)}
                  placeholder="e.g. Acme Corp" maxLength={50} />
                <div className="ts-hint">
                  {"→ "}{ePrefix.trim()
                    ? `${ePrefix.trim()} Timesheet ${MO_FILE[month] ?? ""} ${year}`
                    : `Timesheet ${MO_FILE[month] ?? ""} ${year}`
                  }.pdf
                </div>
              </div>
              <div className="ts-row">
                <div className="ts-field">
                  <label className="ts-label">rate (€/h)</label>
                  <input className="ts-input" type="number" min="0.01" step="0.1" value={eRate}
                    onChange={e => setERate(Math.max(0.01, Number(e.target.value)))} />
                </div>
                <div className="ts-field">
                  <label className="ts-label">salary (€)</label>
                  <input className="ts-input" type="number" min="0" step="10" value={eSalary}
                    onChange={e => setESalary(Math.max(0, Number(e.target.value)))} />
                </div>
              </div>
              <div className="ts-computed">= {eTotalH}h / month</div>
            </div>

            <div className="ts-section">
              <div className="ts-section-hdr-flex">
                <span>&gt; default projects</span>
                <span className={`ts-badge ${eAOk ? "ok" : "warn"}`}>{Math.round(eASum * 100)}%</span>
              </div>
              <div className="ts-hint" style={{ marginBottom: 6, marginTop: -2 }}>fallback for months without a custom config</div>
              {projectsEditor}
            </div>

            <div className="ts-section">
              <div className="ts-section-hdr">&gt; default variance</div>
              <div className="ts-slider-wrap">
                <input type="range" className="ts-slider" min="0" max="100" step="5" value={eRnd}
                  onChange={e => setERnd(Number(e.target.value))} />
                <span className="ts-slider-val">{eRnd}%</span>
              </div>
              <div className="ts-hint">randomizes daily hours distribution</div>
            </div>

            <div className="ts-section">
              <div className="ts-section-hdr">&gt; profiles</div>
              {cfg.profiles.length === 0 ? (
                <div className="ts-hint">no saved profiles yet — save one from the month editor</div>
              ) : (
                <div className="ts-profiles-list">
                  {cfg.profiles.map(prof => (
                    <div key={prof.name} className="ts-profile-item">
                      <div className="ts-profile-info">
                        <span className="ts-profile-name">{prof.name}</span>
                        <span className="ts-profile-summary">
                          {prof.projects.map(p => `${p.name} ${Math.round(p.allocation * 100)}%`).join(", ")}
                        </span>
                      </div>
                      <div className="ts-profile-actions">
                        <button className="ts-btn-sm" onClick={() => loadProfileToDefaults(prof)} title="load as defaults">↓</button>
                        <button className="ts-btn-sm ts-btn-del" onClick={() => deleteProfile(prof.name)} title="delete">x</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="ts-profile-save-row">
                <input className="ts-input" type="text" value={spName}
                  onChange={e => setSpName(e.target.value)}
                  placeholder="profile name" maxLength={30} />
                <button className="ts-btn-sm" onClick={saveCurrentAsProfile}
                  disabled={!spName.trim() || !eAOk} title="save current defaults as profile">+</button>
              </div>
            </div>

            <div className="ts-section">
              <div className="ts-section-hdr">&gt; month overrides</div>
              {Object.keys(cfg.months).length === 0 ? (
                <div className="ts-hint">no per-month configs yet</div>
              ) : (
                <div className="ts-profiles-list">
                  {Object.entries(cfg.months).sort(([a], [b]) => a.localeCompare(b)).map(([key, projs]) => (
                    <div key={key} className="ts-profile-item">
                      <div className="ts-profile-info">
                        <span className="ts-profile-name">{key}</span>
                        <span className="ts-profile-summary">
                          {projs.map(p => `${p.name} ${Math.round(p.allocation * 100)}%`).join(", ")}
                        </span>
                      </div>
                      <button className="ts-btn-sm ts-btn-del" onClick={() => {
                        const months = { ...cfg.months };
                        delete months[key];
                        const next = { ...cfg, months };
                        saveCfg(next);
                        setCfg(next);
                      }} title="remove override">x</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="ts-btn ts-btn-accent" onClick={doSave} disabled={!eAOk}>save</button>
            <button className="ts-btn ts-btn-ghost" onClick={doReset}>reset to defaults</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Main ──
  return (
    <div className="ts-panel">
      <div className="ts-toolbar">
        <select className="ts-input ts-toolbar-sel" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MO.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
        <select className="ts-input ts-toolbar-sel" value={year} onChange={e => setYear(Number(e.target.value))}>
          {YRS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="ts-toolbar-info">
          <span>{days.length}d</span>
          <span className="ts-sep">·</span>
          <span>{fond}h fond</span>
          {hols > 0 && <><span className="ts-sep">·</span><span>{hols} hol</span></>}
          <span className="ts-sep">·</span>
          <span className="ts-toolbar-hl">{totalH}h</span>
          <span className="ts-sep">·</span>
          <span className={`ts-month-badge ${isCustomMonth ? "custom" : "defaults"}`}>
            {isCustomMonth ? "custom" : "defaults"}
          </span>
        </div>
        <div className="ts-toolbar-right">
          <button className="ts-btn-sm" onClick={openMonthEditor} title="edit month projects">✎</button>
          <input type="range" className="ts-slider ts-toolbar-slider" min="0" max="100" step="5" value={rnd}
            onChange={e => setRnd(Number(e.target.value))} title={`variance: ${rnd}%`} />
          <span className="ts-toolbar-vv">{rnd}%</span>
          <button className="ts-btn-sm" onClick={() => setSeed(s => s + 1)} title="regenerate">↻</button>
          <button className="ts-btn-sm" onClick={openSettings} title="settings">⚙</button>
        </div>
      </div>

      {/* ── Month Project Editor (inline) ── */}
      {monthEditorOpen && (
        <div className="ts-month-editor">
          <div className="ts-me-header">
            <span className="ts-me-title">&gt; projects for {MO[month]} {year}</span>
            <span className={`ts-badge ${meAOk ? "ok" : "warn"}`}>{Math.round(meASum * 100)}%</span>
            <div style={{ flex: 1 }} />
            <button className="ts-btn-sm" onClick={closeMonthEditor} title="close">×</button>
          </div>
          <div className="ts-me-body">
            {meProjs.map(p => (
              <div key={p.id} className="ts-project">
                <div className="ts-project-top">
                  <input className="ts-input ts-project-name" type="text" value={p.name}
                    onChange={e => meUpdProj(p.id, "name", e.target.value)} />
                  <button className="ts-btn-sm ts-btn-del" onClick={() => meDelProj(p.id)}>x</button>
                </div>
                <div className="ts-slider-wrap">
                  <input type="range" className="ts-slider" min="0" max="1" step="0.05" value={p.allocation}
                    onChange={e => meUpdProj(p.id, "allocation", Number(e.target.value))} />
                  <span className="ts-slider-val">{Math.round(p.allocation * 100)}%</span>
                </div>
              </div>
            ))}
            <button className="ts-btn" onClick={meAddProj} disabled={meASum >= 1}>+ add project</button>
          </div>
          <div className="ts-me-footer">
            <button className="ts-btn ts-btn-accent" onClick={meSave} disabled={!meAOk}>save for {MO[month]}</button>
            {isCustomMonth && (
              <button className="ts-btn" onClick={meUseDefaults}>use defaults</button>
            )}
            <div className="ts-me-profile-row">
              <div className="ts-me-profile-save">
                <input className="ts-input" type="text" value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  placeholder="save as profile..." maxLength={30} />
                <button className="ts-btn-sm" onClick={meSaveAsProfile}
                  disabled={!profileName.trim() || !meAOk} title="save as profile">+</button>
              </div>
              {cfg.profiles.length > 0 && (
                <div className="ts-me-profile-load">
                  <button className="ts-btn" onClick={() => setShowProfileDrop(v => !v)}>
                    load profile {showProfileDrop ? "▴" : "▾"}
                  </button>
                  {showProfileDrop && (
                    <div className="ts-me-profile-drop">
                      {cfg.profiles.map(prof => (
                        <button key={prof.name} className="ts-me-profile-opt" onClick={() => meLoadProfile(prof)}>
                          <span>{prof.name}</span>
                          <span className="ts-profile-summary">
                            {prof.projects.map(p => `${p.name} ${Math.round(p.allocation * 100)}%`).join(", ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {over && <div className="ts-alert error">[!] {totalH}h exceeds {days.length}d × 9h</div>}
      {otDays > 0 && <div className="ts-alert error">[!] {otDays} day{otDays > 1 ? "s" : ""} over 9h</div>}

      {ok ? (
        <>
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead><tr><th>date</th><th>project</th><th className="ts-th-r">h</th></tr></thead>
              <tbody>
                {entries.map((e, i) => {
                  const same = i > 0 && e.date.getTime() === entries[i - 1]!.date.getTime();
                  return (
                    <tr key={i} className={same ? "ts-rc" : ""}>
                      <td className="ts-td-d">{same ? "" : fmtS(e.date)}</td>
                      <td className="ts-td-p">{e.project}</td>
                      <td className="ts-td-h">{e.hours}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ts-foot">
            <span>total: {actTotal}h</span>
            <span className="ts-foot-bd">
              {Array.from(projAct.entries()).map(([n, h]) => `${n}: ${h}h`).join(" | ")}
            </span>
          </div>
        </>
      ) : (
        <div className="ts-empty">
          {!mAOk ? "allocation ≠ 100% — fix in ⚙ settings" : over ? "too many hours for this month" : "—"}
        </div>
      )}

      <div className="ts-export">
        <button className="ts-btn ts-btn-accent" onClick={() => void dlPDF()} disabled={!ok}>PDF</button>
        {mainProjs.length > 1 && (
          <button className="ts-btn" onClick={() => void dlSplitPDF()} disabled={!ok} title="one PDF per project">split PDF</button>
        )}
        <button className="ts-btn" onClick={dlCSV} disabled={!ok}>CSV</button>
        <span className="ts-export-name" title={fileBase}>{fileBase}</span>
      </div>
    </div>
  );
}
