import { useState, useCallback, useEffect } from "react";
import type { AppPhase } from "@/types/terminal";
import { useAuth } from "@/hooks/useAuth";
import type { LoginResult } from "@/hooks/useAuth";
import { LoginScreen } from "@/components/LoginScreen";
import { SubscribePage } from "@/components/SubscribePage";
import { SetupPasswordScreen } from "@/components/SetupPasswordScreen";
import { ThemePickerScreen } from "@/components/ThemePickerScreen";
import { Terminal } from "@/components/Terminal";
import { PasteViewer } from "@/components/PasteViewer";
import { PublicPasteCreate } from "@/components/PublicPasteCreate";
import { PublicUpload } from "@/components/PublicUpload";
import { ShortlinkRedirect } from "@/components/ShortlinkRedirect";
import { PublicChess } from "@/components/PublicChess";
import { PublicDownload } from "@/components/PublicDownload";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("login");
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [pasteId, setPasteId] = useState<string | null>(null);
  const [pasteCreate, setPasteCreate] = useState(false);
  const [forkId, setForkId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [shortlinkSlug, setShortlinkSlug] = useState<string | null>(null);
  const [chessGameId, setChessGameId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const {
    user,
    userId,
    hasSubscription,
    setHasSubscription,
    isLoading,
    isAuthenticating,
    login,
    register,
    setupPassword,
    logout,
  } = useAuth();

  // Dismiss preloader when app is ready
  useEffect(() => {
    const isPublicRoute = shortlinkSlug || uploadId || pasteCreate || pasteId || chessGameId || shareId;
    if (isPublicRoute || !isLoading) {
      const el = document.getElementById("preloader");
      if (el) {
        const root = document.getElementById("root");
        if (root) {
          root.style.opacity = "0";
          root.style.transition = "opacity 0.5s ease";
          requestAnimationFrame(() => { root.style.opacity = "1"; });
        }
        el.classList.add("pl-exit");
        setTimeout(() => el.remove(), 600);
      }
    }
  }, [isLoading, shortlinkSlug, uploadId, pasteCreate, pasteId, chessGameId, shareId]);

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

    // Path-based cloud share routing: /d/{id}
    const shareMatch = path.match(/^\/d\/([a-f0-9]{12})$/);
    if (shareMatch) {
      setShareId(shareMatch[1]!);
      return;
    }

    // Path-based chess routing: /c/{id}
    const chessMatch = path.match(/^\/c\/([a-f0-9]{12})$/);
    if (chessMatch) {
      setChessGameId(chessMatch[1]!);
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

    // Invite code from URL
    const invite = params.get("invite");
    if (invite) setInviteCode(invite);
  }, []);

  const needsThemePick = () => !localStorage.getItem("mynigga-theme-chosen");

  // Session restore: determine phase based on user + subscription
  useEffect(() => {
    if (!isLoading && user && phase === "login") {
      if (user.role === "admin" || hasSubscription) {
        setPhase(needsThemePick() ? "theme-picker" : "terminal");
      } else {
        setPhase("subscribe");
      }
    }
  }, [isLoading, user, phase, hasSubscription]);

  const handleLogin = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const result = await login(email, password);
      if (result.ok) {
        if (result.has_subscription) {
          setPhase(needsThemePick() ? "theme-picker" : "terminal");
        } else {
          setPhase("subscribe");
        }
      }
      return result;
    },
    [login]
  );

  const handleRegister = useCallback(
    async (email: string): Promise<LoginResult> => {
      const result = await register(email, inviteCode ?? undefined);
      if (result.ok) {
        setNeedsPasswordSetup(true);
        if (result.has_subscription) {
          // Invite had subscription — skip subscribe page
          setHasSubscription(true);
          setPhase("setup-password");
        } else {
          setPhase("subscribe");
        }
      }
      return result;
    },
    [register, inviteCode, setHasSubscription]
  );

  const handleLogout = useCallback(() => {
    logout();
    try { localStorage.removeItem("mynigga-theme"); } catch { /* */ }
    setPhase("login");
  }, [logout]);

  const handleSubscribed = useCallback(() => {
    setHasSubscription(true);
    if (needsPasswordSetup) {
      setPhase("setup-password");
    } else {
      setPhase(needsThemePick() ? "theme-picker" : "terminal");
    }
  }, [setHasSubscription, needsPasswordSetup]);

  const handlePasswordSet = useCallback(() => {
    setPhase(needsThemePick() ? "theme-picker" : "terminal");
  }, []);

  const handleThemePicked = useCallback(() => {
    setPhase("terminal");
  }, []);

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
    setChessGameId(null);
    setShareId(null);
    window.history.replaceState({}, "", "/");
  };

  // Public cloud share download
  if (shareId) {
    return <PublicDownload shareId={shareId} onClose={navigateHome} />;
  }

  // Public chess game
  if (chessGameId) {
    return <PublicChess gameId={chessGameId} onClose={navigateHome} />;
  }

  // Public shortlink redirect
  if (shortlinkSlug) {
    return <ShortlinkRedirect slug={shortlinkSlug} onClose={navigateHome} />;
  }

  // Public upload page
  if (uploadId) {
    return <PublicUpload transferId={uploadId} onClose={navigateHome} />;
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
        onRegister={handleRegister}
        isAuthenticating={isAuthenticating}
      />
    );
  }

  if (phase === "subscribe") {
    return (
      <SubscribePage
        onSubscribed={handleSubscribed}
        onLogout={handleLogout}
      />
    );
  }

  if (phase === "setup-password") {
    return (
      <SetupPasswordScreen
        email={user.email}
        onComplete={handlePasswordSet}
        onSetupPassword={setupPassword}
      />
    );
  }

  if (phase === "theme-picker") {
    return <ThemePickerScreen userId={userId} onComplete={handleThemePicked} />;
  }

  return (
    <Terminal
      user={user}
      userId={userId}
      onLogout={handleLogout}
    />
  );
}
