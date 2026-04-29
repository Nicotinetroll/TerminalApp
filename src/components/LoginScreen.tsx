import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { LoginResult } from "@/hooks/useAuth";
import { checkEmail } from "@/lib/api";
import { AuthLogo } from "./AuthLogo";
import { ScrambleText } from "./ScrambleText";

interface Props {
  onLogin: (email: string, password: string) => Promise<LoginResult>;
  onRegister: (email: string) => Promise<LoginResult>;
  isAuthenticating: boolean;
}

type Step = "name" | "password";
type EmailStatus = "idle" | "checking" | "new" | "existing";

const DOMAIN = "@mynig.ga";
const MIN_ANIM_MS = 2000;
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Fun data ──

const PLACEHOLDERS = [
  "bigdaddy69", "hackerman", "ceo.of.nothing", "xX_slayer_Xx",
  "your.mom", "not.a.cop", "deez.nuts", "chad",
  "lord.farquaad", "unc", "based.sigma", "root",
  "daddy.issues", "cum.lord", "anal.destroyer",
  "erectile.reptile", "moist.nugget", "69.420",
  "bitch.lasagna", "nut.buster", "mega.virgin",
  "crack.dealer", "pp.inspector", "sugma",
  "ligma.survivor", "fart.sniffer", "pee.pee.man",
  "ben.dover", "mike.oxlong", "dixie.normous",
  "hugh.janus", "harry.balzac", "joe.mama",
  "karen.manager", "florida.man", "wifi.thief",
  "ctrl.alt.defeat", "null.pointer", "git.push.force",
  "drop.table.users", "localhost", "127.0.0.1",
  "uranus.explorer", "butt.pirate", "nipple.wizard",
];

const TAGLINES = [
  "email, cloud, terminal — all in one hood.",
  "the terminal you didn't ask for.",
  "localhost vibes, cloud dreams.",
  "git commit -m \"bad decisions\"",
  "rm -rf /social-life",
  "powered by regret and caffeine.",
  "where packets go to die.",
  "sudo make me a sandwich.",
  "0 vulnerabilities found. just kidding.",
];

const WRONG_PW = [
  "wrong password",
  "nope.",
  "that ain't it chief",
  "skill issue",
  "try again genius",
  "incorrect. shocking.",
  "password machine broke",
  "access denied, bozo",
];

const EASTER_EGGS: Record<string, string> = {
  admin: "nice try lmao",
  root: "you wish, buddy",
  god: "blasphemy. i like it.",
  test: "you're not very creative, are you",
  password: "...that's your NAME?",
  trump: "make terminals great again",
  elon: "that'll be $8/month",
  jesus: "he can't save you here",
  satan: "now we're talking",
  help: "there is no help. only terminal.",
  fuck: "mood.",
  shit: "eloquent.",
  ass: "classy.",
  siri: "wrong assistant.",
  alexa: "she can't hear you here.",
  minecraft: "but can it run doom?",
  fortnite: "go outside.",
  linux: "btw i use arch.",
  windows: "we don't do that here.",
  mac: "overpriced terminal incoming.",
  guest: "commit. pick a real name.",
  user: "c'mon, you can do better than that.",
};

// Escalating logo click messages — first 10 are random, then it gets personal
const LOGO_PHASE1 = [
  "stop clicking me",
  "that tickles",
  "I'm not a button",
  "do I look clickable to you?",
  "click me harder daddy",
  "*glitch noises*",
  "404: patience not found",
  "you're persistent, I'll give you that",
  "ok that's enough",
  "seriously, stop",
];

const LOGO_ESCALATION: Record<number, string> = {
  11: "being retarded for the 11th time",
  12: "12 clicks. you need a hobby.",
  13: "13. unlucky number. keep going.",
  14: "bro thinks something will happen at 15",
  15: "it didn't.",
  16: "16 clicks. that's a felony in some countries.",
  17: "i'm running out of things to say",
  18: "18. you're legally an adult. act like it.",
  19: "one more and i call the police",
  20: "that's it. i'm calling.",
  21: "911? yes, this user right here.",
  22: "they're sending a squad car",
  23: "you can hear the sirens",
  24: "they're getting closer",
  25: "ACHIEVEMENT UNLOCKED: no life",
  26: "26. your mouse is begging for mercy.",
  27: "this is genuinely concerning behavior",
  28: "i've started a file on you",
  29: "click 30 and i delete your account",
  30: "just kidding. i can't do that. ...or can i?",
  31: "the logo is now emotionally damaged",
  32: "32 bits of brain damage",
  33: "your therapist just got a notification",
  34: "at this point i respect the commitment",
  35: "you scroll twitter like this too, don't you",
  36: "fun fact: you've wasted 36 clicks",
  37: "that's 37 seconds of your life. gone.",
  38: "38. the logo has filed a restraining order.",
  39: "one more...",
  40: "40. congrats. you won nothing.",
  41: "still going? absolutely deranged.",
  42: "42. the answer to life. and you spent it here.",
  43: "i literally cannot believe this",
  44: "the developers are watching. and judging.",
  45: "45. halfway to 90. what are you doing.",
  46: "touch. grass. please.",
  47: "i'm telling your mother",
  48: "she said she's disappointed",
  49: "49... so close to 50...",
  50: "50 CLICKS. YOU ABSOLUTE PSYCHOPATH. I LOVE YOU.",
};

const CLAIM_MSGS = [
  "it's yours, king",
  "nobody wanted it anyway",
  "certified fresh",
  "bold choice. respect.",
  "that's hard actually",
  "your parents would be proud. maybe.",
  "FBI has entered the chat",
  "HR would like a word",
  "goes hard ngl",
  "you sure about that?",
  "immaculate vibes",
  "this says a lot about you",
  "therapist: *takes notes*",
  "your ex is typing...",
  "legendary name tbh",
  "smells like regret already",
  "google can't even find you now",
  "witness protection approved",
  "unique. just like everyone else.",
  "screenshotted and reported (jk)",
  "SEC is investigating this name",
  "straight to the hall of fame",
  "that's what she said",
  "your mother would not approve",
  "absolutely unhinged. locked in.",
  "name so clean it squeaks",
  "chaotic neutral energy",
];

const WELCOME_MSGS = [
  "welcome back, king",
  "missed you (not really)",
  "oh no, you're back",
  "the prodigal son returns",
  "back for more punishment?",
  "couldn't stay away huh",
  "we didn't change the locks. yet.",
  "your terminal missed you",
  "wb legend",
  "the return of the king",
  "again? you're obsessed",
  "we kept your seat warm",
  "thought you ghosted us",
  "the audacity to return",
  "back from touching grass?",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

// ── Component ──

export function LoginScreen({ onLogin, onRegister, isAuthenticating }: Props) {
  const [step, setStep] = useState<Step>("name");
  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [userCount, setUserCount] = useState<number | null>(null);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [phText, setPhText] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const phRef = useRef({ idx: Math.floor(Math.random() * PLACEHOLDERS.length), charIdx: 0, phase: "typing" as "typing" | "pause" | "deleting", timer: 0 as ReturnType<typeof setTimeout> });
  const logoMsgTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const logoClicks = useRef(0);

  const busy = isAuthenticating || animating;
  const isNew = emailStatus === "new";
  const isExisting = emailStatus === "existing";
  const resolved = isNew || isExisting;

  const tagline = useMemo(() => pick(TAGLINES), []);

  // ── Fetch live user count ──
  useEffect(() => {
    fetch(`${API_BASE}/auth/stats`).then(r => r.json()).then((d: { total_users?: number }) => {
      if (d.total_users) setUserCount(d.total_users);
    }).catch(() => { /* silent */ });
  }, []);

  // ── Typewriter placeholder ──
  useEffect(() => {
    if (localPart) return;

    const tick = () => {
      const s = phRef.current;
      const word = PLACEHOLDERS[s.idx % PLACEHOLDERS.length]!;

      if (s.phase === "typing") {
        s.charIdx++;
        setPhText(word.slice(0, s.charIdx));
        if (s.charIdx >= word.length) {
          s.phase = "pause";
          s.timer = window.setTimeout(tick, 2200);
        } else {
          s.timer = window.setTimeout(tick, 65 + Math.random() * 45);
        }
      } else if (s.phase === "pause") {
        s.phase = "deleting";
        s.timer = window.setTimeout(tick, 40);
      } else {
        s.charIdx--;
        setPhText(word.slice(0, Math.max(0, s.charIdx)));
        if (s.charIdx <= 0) {
          s.phase = "typing";
          s.idx = (s.idx + 1) % PLACEHOLDERS.length;
          s.timer = window.setTimeout(tick, 350);
        } else {
          s.timer = window.setTimeout(tick, 30 + Math.random() * 20);
        }
      }
    };

    phRef.current.charIdx = 0;
    phRef.current.phase = "typing";
    phRef.current.timer = window.setTimeout(tick, 500);
    return () => clearTimeout(phRef.current.timer);
  }, [localPart]);

  // Auto-dismiss error after 4s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // Focus the right input
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === "name") nameRef.current?.focus();
      else passRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [step]);

  // Debounced email check
  const checkAvailability = useCallback((value: string) => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const clean = value.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (clean.length < 2) {
      setEmailStatus("idle");
      return;
    }
    setEmailStatus("checking");
    checkTimer.current = setTimeout(async () => {
      try {
        const result = await checkEmail(clean);
        setEmailStatus(result.available ? "new" : "existing");
      } catch {
        setEmailStatus("existing");
      }
    }, 400);
  }, []);

  const handleLocalPartChange = (raw: string) => {
    const clean = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
    setLocalPart(clean);
    setError(null);
    checkAvailability(clean);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = localPart.trim();

    if (step === "name") {
      if (!clean) { setError("enter a username"); return; }
      if (clean.length < 2) { setError("at least 2 characters"); return; }
      if (emailStatus === "checking") { setError("hold on, still checking..."); return; }
      if (!resolved) { setError("type a username first"); return; }

      if (isNew) {
        setAnimating(true);
        const [result] = await Promise.all([onRegister(clean), wait(MIN_ANIM_MS)]);
        setAnimating(false);
        if (!result.ok) setError(result.error ?? "registration failed");
      } else {
        setStep("password");
      }
      return;
    }

    if (!password) { setError("enter your password"); return; }
    setAnimating(true);
    const [result] = await Promise.all([onLogin(`${clean}${DOMAIN}`, password), wait(MIN_ANIM_MS)]);
    setAnimating(false);
    if (!result.ok) setError(result.error ?? pick(WRONG_PW));
  };

  const goBack = () => {
    setStep("name");
    setPassword("");
    setError(null);
  };

  const handleLogoClick = () => {
    if (logoMsgTimer.current) clearTimeout(logoMsgTimer.current);
    logoClicks.current++;
    const n = logoClicks.current;

    let msg: string;
    if (n <= 10) {
      msg = LOGO_PHASE1[(n - 1) % LOGO_PHASE1.length]!;
    } else if (LOGO_ESCALATION[n]) {
      msg = LOGO_ESCALATION[n];
    } else if (n > 50) {
      msg = `click ${n}. you're beyond help.`;
    } else {
      msg = `being retarded for the ${n}th time`;
    }

    setLogoMsg(msg);
    logoMsgTimer.current = setTimeout(() => setLogoMsg(null), n > 10 ? 3000 : 2500);
  };

  const btnLabel = step === "password"
    ? "let me in"
    : isNew ? "claim it" : isExisting ? "that's me" : "continue";

  const scrambleLabel = step === "password"
    ? "decrypting session"
    : "creating your identity";

  const statusCls =
    emailStatus === "new" ? "new" :
    emailStatus === "existing" ? "existing" :
    emailStatus;

  // Easter egg check
  const easterEgg = EASTER_EGGS[localPart.toLowerCase()];

  // Pick a random claim/welcome msg per status resolve (stable per localPart+status combo)
  const claimMsg = useMemo(() => pick(CLAIM_MSGS), [localPart, emailStatus]);
  const welcomeMsg = useMemo(() => pick(WELCOME_MSGS), [localPart, emailStatus]);

  return (
    <div className="auth-page login-page">
      <div className="login-wrap">
        {/* Logo with click easter egg */}
        <div className="login-logo-tap" onClick={handleLogoClick}>
          <AuthLogo />
          {logoMsg && <div className="login-logo-msg" key={logoMsg}>{logoMsg}</div>}
        </div>

        <form className="login-form" onSubmit={e => void handleSubmit(e)}>
          <div className="login-step" key={step}>
            {step === "name" ? (
              <>
                <div className="login-input-wrap">
                  <span className="login-prompt">&gt;</span>
                  <div className="login-input-area">
                    <input
                      ref={nameRef}
                      type="text"
                      value={localPart}
                      onChange={e => handleLocalPartChange(e.target.value)}
                      className="login-input"
                      placeholder=""
                      aria-label="Username"
                      autoComplete="username"
                      disabled={busy}
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                    {!localPart && (
                      <span className="login-typewriter" aria-hidden="true">
                        {phText}<span className="login-tw-cursor" />
                      </span>
                    )}
                  </div>
                  <span className="login-domain">{DOMAIN}</span>
                </div>

                <div className={`login-status login-status--${localPart.length >= 2 ? statusCls : "idle"}`}>
                  {localPart.length >= 2 && (
                    <>
                      {emailStatus === "checking" && "checking..."}
                      {emailStatus === "new" && (easterEgg ?? `${localPart}${DOMAIN} — ${claimMsg}`)}
                      {emailStatus === "existing" && (easterEgg ? `${easterEgg} — but wb` : `${localPart} — ${welcomeMsg}`)}
                    </>
                  )}
                  {localPart.length < 2 && "\u00A0"}
                </div>

                <button
                  type="submit"
                  className={`login-btn${busy ? " login-btn-busy" : ""}`}
                  disabled={busy || !resolved}
                >
                  {busy ? <ScrambleText text={scrambleLabel} /> : btnLabel}
                </button>

                <span className={`login-enter-hint${resolved && !busy ? " login-enter-hint--visible" : ""}`}>
                  or just press ↵
                </span>
              </>
            ) : (
              <>
                <button type="button" className="login-user-pill" onClick={goBack}>
                  <span className="login-pill-name">{localPart}{DOMAIN}</span>
                  <span className="login-pill-change">change</span>
                </button>

                <div className="login-input-wrap">
                  <span className="login-prompt">&gt;</span>
                  <div className="login-input-area">
                    <input
                      ref={passRef}
                      type="password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(null); }}
                      className="login-input"
                      placeholder="password"
                      aria-label="Password"
                      autoComplete="current-password"
                      disabled={busy}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className={`login-btn${busy ? " login-btn-busy" : ""}`}
                  disabled={busy}
                >
                  {busy ? <ScrambleText text={scrambleLabel} /> : btnLabel}
                </button>

                <span className={`login-enter-hint${!busy ? " login-enter-hint--visible" : ""}`}>
                  or just press ↵
                </span>
              </>
            )}
          </div>
        </form>

        {error && <div className="auth-error">{error}</div>}

        <div className="login-footer">
          <p className="login-hint">{tagline}</p>
          <p className="login-user-count">
            {userCount !== null && userCount > 0
              ? `${userCount.toLocaleString()} degenerates and counting`
              : "\u00A0"}
          </p>
        </div>
      </div>
    </div>
  );
}
