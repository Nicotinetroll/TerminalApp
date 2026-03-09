import { useState, useCallback, useEffect } from "react";
import type { AppPhase } from "@/types/terminal";
import { useAuth, type LoginResult } from "@/hooks/useAuth";
import { LoginScreen } from "@/components/LoginScreen";
import { Terminal } from "@/components/Terminal";
import { PasteViewer } from "@/components/PasteViewer";
import { registerWithInvite } from "@/lib/api";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("login");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [pasteId, setPasteId] = useState<string | null>(null);
  const {
    user,
    userId,
    isLoading,
    isAuthenticating,
    login,
    codeLogin,
    logout,
    setUserFromRegister,
  } = useAuth();

  // Detect ?invite=TOKEN and ?room=ROOM_ID on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    const room = params.get("room");
    const paste = params.get("paste");
    if (token) {
      setInviteToken(token);
    }
    if (room) {
      setRoomToken(room);
    }
    if (paste) {
      setPasteId(paste);
    }
    if (token || room) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Session restore: skip login if session exists
  useEffect(() => {
    if (!isLoading && user && phase === "login") {
      setPhase("terminal");
    }
  }, [isLoading, user, phase]);

  const handleLogin = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const result = await login(username, password);
      if (result.ok) setPhase("terminal");
      return result;
    },
    [login]
  );

  const handleCodeLogin = useCallback(
    async (code: string): Promise<LoginResult> => {
      const result = await codeLogin(code);
      if (result.ok) setPhase("terminal");
      return result;
    },
    [codeLogin]
  );

  const handleLogout = useCallback(() => {
    logout();
    setPhase("login");
    setInviteToken(null);
    setRoomToken(null);
  }, [logout]);

  const handleRegister = useCallback(
    async (token: string, username: string, password: string): Promise<LoginResult> => {
      const result = await registerWithInvite(token, username, password);
      if (result.ok) {
        setUserFromRegister(result.user);
        setPhase("terminal");
        setInviteToken(null);
      }
      return result;
    },
    [setUserFromRegister]
  );

  if (pasteId) {
    return <PasteViewer pasteId={pasteId} onClose={() => { setPasteId(null); window.history.replaceState({}, "", window.location.pathname); }} />;
  }

  if (isLoading) {
    return null;
  }

  if (phase === "login" || !user) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onCodeLogin={handleCodeLogin}
        onRegister={handleRegister}
        isAuthenticating={isAuthenticating}
        inviteToken={inviteToken}
      />
    );
  }

  return (
    <Terminal
      user={user}
      userId={userId}
      onLogout={handleLogout}
      roomToken={roomToken}
    />
  );
}
