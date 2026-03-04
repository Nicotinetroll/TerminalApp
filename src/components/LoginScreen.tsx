import { useState, useRef, useEffect, useCallback } from "react";
import { LogoHeader } from "./LogoHeader";
import type { LoginResult } from "@/hooks/useAuth";

interface Props {
  onLogin: (username: string, password: string) => Promise<LoginResult>;
  onGuest: () => void;
  onRegister?: (token: string, username: string, password: string) => Promise<LoginResult>;
  isAuthenticating: boolean;
  inviteToken?: string | null;
}

type Stage = "menu" | "username" | "password" | "authenticating"
  | "reg-username" | "reg-password" | "reg-confirm" | "registering";

export function LoginScreen({ onLogin, onGuest, onRegister, isAuthenticating, inviteToken }: Props) {
  const [stage, setStage] = useState<Stage>(inviteToken ? "reg-username" : "menu");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [lines, setLines] = useState<string[]>(
    inviteToken ? ["> invite link detected", "register a new account:", ""] : []
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>(inviteToken ? "reg-username" : "menu");

  stageRef.current = stage;

  // Update stage if inviteToken changes
  useEffect(() => {
    if (inviteToken && stage === "menu") {
      setStage("reg-username");
      setLines(["> invite link detected", "register a new account:", ""]);
    }
  }, [inviteToken, stage]);

  const addLine = useCallback((text: string) => {
    setLines(prev => [...prev, text]);
  }, []);

  const resetFields = useCallback(() => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
  }, []);

  useEffect(() => {
    if (stage === "username" || stage === "password" || stage === "reg-username" || stage === "reg-password" || stage === "reg-confirm") {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [stage]);

  useEffect(() => {
    if (stage !== "menu") return;
    const handler = (e: KeyboardEvent) => {
      if (stageRef.current !== "menu") return;
      if (e.key === "1") {
        e.preventDefault();
        addLine("> login");
        addLine("");
        setTimeout(() => setStage("username"), 0);
      } else if (e.key === "2") {
        e.preventDefault();
        addLine("> continue as guest");
        onGuest();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stage, addLine, onGuest]);

  const handleUsernameSubmit = useCallback(() => {
    const val = username.trim();
    if (!val) return;
    addLine("login: " + val);
    setStage("password");
  }, [username, addLine]);

  const handlePasswordSubmit = useCallback(async () => {
    addLine("password: " + "\u2022".repeat(password.length || 6));
    setStage("authenticating");

    const result = await onLogin(username.trim(), password);
    if (!result.ok) {
      addLine("\u2717 " + (result.error ?? "Authentication failed."));
      addLine("");
      resetFields();
      setTimeout(() => setStage("menu"), 0);
    }
  }, [username, password, onLogin, addLine, resetFields]);

  // Registration flow handlers
  const handleRegUsernameSubmit = useCallback(() => {
    const val = username.trim();
    if (!val) return;
    if (val.length < 2) {
      addLine("\u2717 username too short. at least 2 characters.");
      return;
    }
    addLine("username: " + val);
    setStage("reg-password");
  }, [username, addLine]);

  const handleRegPasswordSubmit = useCallback(() => {
    if (password.length < 4) {
      addLine("\u2717 password too short. at least 4 characters.");
      return;
    }
    addLine("password: " + "\u2022".repeat(password.length));
    setStage("reg-confirm");
  }, [password, addLine]);

  const handleRegConfirmSubmit = useCallback(async () => {
    if (confirmPassword !== password) {
      addLine("\u2717 passwords don't match. try again.");
      setConfirmPassword("");
      return;
    }
    addLine("confirm:  " + "\u2022".repeat(confirmPassword.length));
    setStage("registering");

    if (!onRegister || !inviteToken) return;

    const result = await onRegister(inviteToken, username.trim(), password);
    if (!result.ok) {
      addLine("\u2717 " + (result.error ?? "Registration failed."));
      addLine("");
      resetFields();
      setTimeout(() => setStage("reg-username"), 0);
    }
  }, [confirmPassword, password, username, inviteToken, onRegister, addLine, resetFields]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (stage === "username") handleUsernameSubmit();
      if (stage === "password") void handlePasswordSubmit();
      if (stage === "reg-username") handleRegUsernameSubmit();
      if (stage === "reg-password") handleRegPasswordSubmit();
      if (stage === "reg-confirm") void handleRegConfirmSubmit();
    },
    [stage, handleUsernameSubmit, handlePasswordSubmit, handleRegUsernameSubmit, handleRegPasswordSubmit, handleRegConfirmSubmit]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, stage]);

  return (
    <div className="h-full flex flex-col font-mono overflow-hidden">
      <LogoHeader animate={true} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 pb-6 terminal-scroll">
        {lines.map((line, i) => (
          <div
            key={i}
            className="whitespace-pre leading-relaxed"
            style={{
              color: line.startsWith("\u2717")
                ? "var(--error)"
                : line.startsWith(">")
                  ? "var(--accent)"
                  : "var(--text-secondary)",
            }}
          >
            {line || "\u00A0"}
          </div>
        ))}

        {stage === "menu" && (
          <div className="mt-3">
            <div style={{ color: "var(--text-secondary)" }}>Select an option:</div>
            <div
              className="mt-2 login-option"
              onClick={() => {
                addLine("> login");
                addLine("");
                setTimeout(() => setStage("username"), 0);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") { addLine("> login"); addLine(""); setTimeout(() => setStage("username"), 0); } }}
            >
              <span style={{ color: "var(--accent)" }}>[1]</span>
              <span style={{ color: "var(--text-primary)" }}> Login</span>
            </div>
            <div
              className="mt-0.5 login-option"
              onClick={() => {
                addLine("> continue as guest");
                onGuest();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") { addLine("> continue as guest"); onGuest(); } }}
            >
              <span style={{ color: "var(--accent)" }}>[2]</span>
              <span style={{ color: "var(--text-primary)" }}> Continue as guest</span>
            </div>
            <div className="mt-3">
              <span className="cursor-blink" style={{ color: "var(--accent)" }}>▊</span>
            </div>
          </div>
        )}

        {stage === "username" && (
          <div className="flex items-center mt-1">
            <span style={{ color: "var(--text-muted)" }}>login:&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-primary)", caretColor: "var(--accent)", fontSize: "inherit" }}
              spellCheck={false}
              autoComplete="off"
              maxLength={64}
            />
          </div>
        )}

        {stage === "password" && (
          <div className="flex items-center mt-1">
            <span style={{ color: "var(--text-muted)" }}>password:&nbsp;</span>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-muted)", caretColor: "var(--accent)", fontSize: "inherit" }}
              spellCheck={false}
              autoComplete="off"
              maxLength={128}
            />
          </div>
        )}

        {(stage === "authenticating" || (isAuthenticating && !inviteToken)) && (
          <div className="flex items-center mt-2 gap-2">
            <span className="spinner" />
            <span style={{ color: "var(--text-muted)" }}>Authenticating...</span>
          </div>
        )}

        {/* Registration flow */}
        {stage === "reg-username" && (
          <div className="flex items-center mt-1">
            <span style={{ color: "var(--text-muted)" }}>username:&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-primary)", caretColor: "var(--accent)", fontSize: "inherit" }}
              spellCheck={false}
              autoComplete="off"
              maxLength={64}
            />
          </div>
        )}

        {stage === "reg-password" && (
          <div className="flex items-center mt-1">
            <span style={{ color: "var(--text-muted)" }}>password:&nbsp;</span>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-muted)", caretColor: "var(--accent)", fontSize: "inherit" }}
              spellCheck={false}
              autoComplete="off"
              maxLength={128}
            />
          </div>
        )}

        {stage === "reg-confirm" && (
          <div className="flex items-center mt-1">
            <span style={{ color: "var(--text-muted)" }}>confirm:&nbsp;&nbsp;</span>
            <input
              ref={inputRef}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-muted)", caretColor: "var(--accent)", fontSize: "inherit" }}
              spellCheck={false}
              autoComplete="off"
              maxLength={128}
            />
          </div>
        )}

        {stage === "registering" && (
          <div className="flex items-center mt-2 gap-2">
            <span className="spinner" />
            <span style={{ color: "var(--text-muted)" }}>creating your account...</span>
          </div>
        )}
      </div>
    </div>
  );
}
