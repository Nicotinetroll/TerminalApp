import { useState, useCallback, useEffect } from "react";
import type { AppPhase } from "@/types/terminal";
import { useAuth, type LoginResult } from "@/hooks/useAuth";
import { LoginScreen } from "@/components/LoginScreen";
import { Terminal } from "@/components/Terminal";
import { PasteViewer } from "@/components/PasteViewer";
import { PublicPasteCreate } from "@/components/PublicPasteCreate";
import { PublicUpload } from "@/components/PublicUpload";
import { ShortlinkRedirect } from "@/components/ShortlinkRedirect";
import { registerWithInvite } from "@/lib/api";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("login");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [pasteId, setPasteId] = useState<string | null>(null);
  const [pasteCreate, setPasteCreate] = useState(false);
  const [forkId, setForkId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [shortlinkSlug, setShortlinkSlug] = useState<string | null>(null);
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

  // Dismiss preloader when app is ready
  useEffect(() => {
    const isPublicRoute = shortlinkSlug || uploadId || pasteCreate || pasteId;
    if (isPublicRoute || !isLoading) {
      const el = document.getElementById("preloader");
      if (el) {
        // Let the app content fade in underneath
        const root = document.getElementById("root");
        if (root) {
          root.style.opacity = "0";
          root.style.transition = "opacity 0.5s ease";
          requestAnimationFrame(() => { root.style.opacity = "1"; });
        }
        // Fade out preloader
        el.classList.add("pl-exit");
        setTimeout(() => el.remove(), 600);
      }
    }
  }, [isLoading, shortlinkSlug, uploadId, pasteCreate, pasteId]);

  // Detect path-based and query-based routes on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    // Path-based shortlink routing: /s/{slug}
    const shortlinkMatch = path.match(/^\/s\/([a-zA-Z0-9_-]{2,32})$/);
    if (shortlinkMatch) {
      setShortlinkSlug(shortlinkMatch[1]!);
      return;
    }

    // Path-based transfer routing: /t/{id}
    const uploadMatch = path.match(/^\/t\/([a-f0-9]{32})$/);
    if (uploadMatch) {
      setUploadId(uploadMatch[1]!);
      return;
    }

    // Legacy /upload/{id} → redirect to /t/{id}
    const legacyUpload = path.match(/^\/upload\/([a-f0-9]{32})$/);
    if (legacyUpload) {
      window.location.replace(`/t/${legacyUpload[1]!}`);
      return;
    }

    // Path-based paste routing: /paste or /paste/{id}
    const pasteMatch = path.match(/^\/paste(?:\/(.+))?$/);
    if (pasteMatch) {
      const id = pasteMatch[1];
      if (id) {
        setPasteId(id);
      } else {
        // /paste with ?fork=id support
        const fork = params.get("fork");
        if (fork) setForkId(fork);
        setPasteCreate(true);
      }
      return;
    }

    // Legacy query-based paste: ?paste={id} → redirect to /paste/{id}
    const legacyPaste = params.get("paste");
    if (legacyPaste) {
      window.history.replaceState({}, "", `/paste/${legacyPaste}`);
      setPasteId(legacyPaste);
      return;
    }

    // Other query params
    const token = params.get("invite");
    const room = params.get("room");
    if (token) setInviteToken(token);
    if (room) setRoomToken(room);
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
    try { localStorage.removeItem("mynigga-theme"); } catch { /* */ }
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

  const navigateToPaste = (id: string) => {
    setPasteCreate(false);
    setForkId(null);
    setPasteId(id);
    window.history.replaceState({}, "", `/paste/${id}`);
  };

  const navigateToCreate = (parentId?: string) => {
    setPasteId(null);
    setForkId(parentId ?? null);
    setPasteCreate(true);
    window.history.replaceState({}, "", parentId ? `/paste?fork=${parentId}` : "/paste");
  };

  const navigateHome = () => {
    setPasteId(null);
    setPasteCreate(false);
    setForkId(null);
    setUploadId(null);
    setShortlinkSlug(null);
    window.history.replaceState({}, "", "/");
  };

  // Public shortlink redirect
  if (shortlinkSlug) {
    return (
      <ShortlinkRedirect
        slug={shortlinkSlug}
        onClose={navigateHome}
      />
    );
  }

  // Public upload page
  if (uploadId) {
    return (
      <PublicUpload
        transferId={uploadId}
        onClose={navigateHome}
      />
    );
  }

  // Public paste create page
  if (pasteCreate) {
    return (
      <PublicPasteCreate
        forkId={forkId}
        onClose={navigateHome}
        onViewPaste={navigateToPaste}
      />
    );
  }

  // Public paste viewer
  if (pasteId) {
    return (
      <PasteViewer
        pasteId={pasteId}
        onClose={navigateHome}
        onFork={navigateToCreate}
        onViewPaste={navigateToPaste}
      />
    );
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
