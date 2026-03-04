import { useState, useCallback, useRef } from "react";
import type { FileSystemNode } from "@/types/terminal";
import { MAX_CMD_HISTORY } from "@/config";
import {
  getCommandSuggestions,
  getArgSuggestions,
  type Suggestion,
} from "@/core/completions";

export type { Suggestion } from "@/core/completions";

interface CompletionContext {
  fs: FileSystemNode;
  cwd: string;
  username: string;
}

export function useKeyboard(
  onExecute: (input: string) => void,
  ctx: CompletionContext,
  externalCmdHistory?: React.RefObject<string[]>
) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const internalHistory = useRef<string[]>([]);
  const cmdHistory = externalCmdHistory ?? internalHistory;
  const historyIdx = useRef(-1);
  const savedInput = useRef("");
  // Track whether suggestions are for command or args
  const modeRef = useRef<"command" | "arg">("command");
  // Track the base input (command + space) for arg mode
  const argBaseRef = useRef("");

  const computeSuggestions = useCallback(
    (value: string) => {
      const trimmed = value.trimStart();

      // Check if we have a command + space (arg mode)
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx > 0) {
        const cmdName = trimmed.slice(0, spaceIdx);
        const argPart = trimmed.slice(spaceIdx + 1);
        // Only get suggestions for the last argument (after last space)
        const lastSpaceInArgs = argPart.lastIndexOf(" ");
        const currentArg =
          lastSpaceInArgs >= 0 ? argPart.slice(lastSpaceInArgs + 1) : argPart;
        const base =
          lastSpaceInArgs >= 0
            ? trimmed.slice(0, spaceIdx + 1 + lastSpaceInArgs + 1)
            : trimmed.slice(0, spaceIdx + 1);

        const matches = getArgSuggestions(
          cmdName,
          currentArg,
          ctx.fs,
          ctx.cwd,
          ctx.username
        );
        modeRef.current = "arg";
        argBaseRef.current = base;
        setSuggestions(matches);
        setSelectedIdx(0);
        return;
      }

      // Command mode
      if (!trimmed) {
        modeRef.current = "command";
        argBaseRef.current = "";
        setSuggestions([]);
        setSelectedIdx(0);
        return;
      }

      const matches = getCommandSuggestions(trimmed).filter(
        (s) => s.value !== trimmed
      );
      modeRef.current = "command";
      argBaseRef.current = "";
      setSuggestions(matches);
      setSelectedIdx(0);
    },
    [ctx.fs, ctx.cwd, ctx.username]
  );

  const setInputWithSuggestions = useCallback(
    (value: string) => {
      setInput(value);
      computeSuggestions(value);
    },
    [computeSuggestions]
  );

  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const isCommand = modeRef.current === "command";
      const newInput = isCommand
        ? suggestion.value + " "
        : argBaseRef.current + suggestion.value;
      setInput(newInput);
      setSuggestions([]);
      setSelectedIdx(0);
      // After accepting an arg, recompute in case there are more suggestions
      if (!isCommand) {
        // Small delay to let the input update
        setTimeout(() => computeSuggestions(newInput), 0);
      }
    },
    [computeSuggestions]
  );

  const dismissSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIdx(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // ── Escape: dismiss suggestions ──
      if (e.key === "Escape") {
        if (suggestions.length > 0) {
          e.preventDefault();
          dismissSuggestions();
          return;
        }
      }

      // ── Enter ──
      if (e.key === "Enter") {
        e.preventDefault();

        // If dropdown is open → accept the selected suggestion
        // But if accepting wouldn't change input, execute instead
        if (suggestions.length > 0) {
          const picked = suggestions[selectedIdx];
          if (picked) {
            const isCommand = modeRef.current === "command";
            const completed = isCommand
              ? picked.value + " "
              : argBaseRef.current + picked.value;
            if (completed !== input) {
              acceptSuggestion(picked);
              return;
            }
            // Input already matches — fall through to execute
            dismissSuggestions();
          }
        }

        // Execute the command
        const trimmed = input.trim();
        if (trimmed) {
          cmdHistory.current.unshift(trimmed);
          if (cmdHistory.current.length > MAX_CMD_HISTORY) {
            cmdHistory.current.pop();
          }
        }
        historyIdx.current = -1;
        savedInput.current = "";
        onExecute(input);
        setInput("");
        return;
      }

      // ── Right arrow: accept ghost text ──
      if (e.key === "ArrowRight") {
        const el = e.currentTarget;
        // Only if cursor is at the end of input
        if (
          el.selectionStart === input.length &&
          suggestions.length > 0
        ) {
          e.preventDefault();
          const picked = suggestions[selectedIdx];
          if (picked) acceptSuggestion(picked);
          return;
        }
      }

      // ── Arrow Up ──
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedIdx((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (cmdHistory.current.length === 0) return;
        if (historyIdx.current === -1) savedInput.current = input;
        const next = Math.min(
          historyIdx.current + 1,
          cmdHistory.current.length - 1
        );
        historyIdx.current = next;
        const val = cmdHistory.current[next] ?? "";
        setInput(val);
        computeSuggestions(val);
        return;
      }

      // ── Arrow Down ──
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedIdx((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (historyIdx.current <= 0) {
          historyIdx.current = -1;
          setInput(savedInput.current);
          computeSuggestions(savedInput.current);
          return;
        }
        historyIdx.current--;
        const val = cmdHistory.current[historyIdx.current] ?? "";
        setInput(val);
        computeSuggestions(val);
        return;
      }

      // ── Tab: accept suggestion / cycle ──
      if (e.key === "Tab") {
        e.preventDefault();
        if (suggestions.length > 0) {
          const picked = suggestions[selectedIdx];
          if (picked) acceptSuggestion(picked);
          return;
        }
        return;
      }

      // ── Ctrl+L: clear ──
      if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        dismissSuggestions();
        onExecute("clear");
        return;
      }
    },
    [
      input,
      suggestions,
      selectedIdx,
      onExecute,
      cmdHistory,
      computeSuggestions,
      acceptSuggestion,
      dismissSuggestions,
    ]
  );

  // Compute ghost text
  let ghostText = "";
  if (suggestions.length > 0 && suggestions[selectedIdx]) {
    const s = suggestions[selectedIdx];
    if (modeRef.current === "command") {
      const partial = input.trimStart();
      if (s.value.startsWith(partial)) {
        ghostText = s.value.slice(partial.length);
      }
    } else {
      // In arg mode, show remaining chars of the arg value
      const trimmed = input.trimStart();
      const full = argBaseRef.current + s.value;
      if (full.startsWith(trimmed)) {
        ghostText = full.slice(trimmed.length);
      }
    }
  }

  return {
    input,
    setInput: setInputWithSuggestions,
    handleKeyDown,
    suggestions,
    selectedIdx,
    acceptSuggestion,
    ghostText,
    mode: modeRef.current,
  };
}
