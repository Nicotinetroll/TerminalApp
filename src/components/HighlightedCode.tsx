import { useEffect, useRef } from "react";
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/tokyo-night-dark.min.css";

// Register languages on demand — lazy-loaded
const registered = new Set<string>();

const LANG_IMPORTS: Record<string, () => Promise<{ default: import("highlight.js").LanguageFn }>> = {
  javascript:  () => import("highlight.js/lib/languages/javascript"),
  typescript:  () => import("highlight.js/lib/languages/typescript"),
  python:      () => import("highlight.js/lib/languages/python"),
  html:        () => import("highlight.js/lib/languages/xml"),
  css:         () => import("highlight.js/lib/languages/css"),
  json:        () => import("highlight.js/lib/languages/json"),
  sql:         () => import("highlight.js/lib/languages/sql"),
  bash:        () => import("highlight.js/lib/languages/bash"),
  go:          () => import("highlight.js/lib/languages/go"),
  rust:        () => import("highlight.js/lib/languages/rust"),
  c:           () => import("highlight.js/lib/languages/c"),
  cpp:         () => import("highlight.js/lib/languages/cpp"),
  csharp:      () => import("highlight.js/lib/languages/csharp"),
  java:        () => import("highlight.js/lib/languages/java"),
  php:         () => import("highlight.js/lib/languages/php"),
  ruby:        () => import("highlight.js/lib/languages/ruby"),
  kotlin:      () => import("highlight.js/lib/languages/kotlin"),
  swift:       () => import("highlight.js/lib/languages/swift"),
  dart:        () => import("highlight.js/lib/languages/dart"),
  lua:         () => import("highlight.js/lib/languages/lua"),
  perl:        () => import("highlight.js/lib/languages/perl"),
  powershell:  () => import("highlight.js/lib/languages/powershell"),
  r:           () => import("highlight.js/lib/languages/r"),
  scala:       () => import("highlight.js/lib/languages/scala"),
  haskell:     () => import("highlight.js/lib/languages/haskell"),
  elixir:      () => import("highlight.js/lib/languages/elixir"),
  clojure:     () => import("highlight.js/lib/languages/clojure"),
  dockerfile:  () => import("highlight.js/lib/languages/dockerfile"),
  graphql:     () => import("highlight.js/lib/languages/graphql"),
  toml:        () => import("highlight.js/lib/languages/ini"),
  ini:         () => import("highlight.js/lib/languages/ini"),
  yaml:        () => import("highlight.js/lib/languages/yaml"),
  markdown:    () => import("highlight.js/lib/languages/markdown"),
  xml:         () => import("highlight.js/lib/languages/xml"),
  jsx:         () => import("highlight.js/lib/languages/javascript"),
  tsx:         () => import("highlight.js/lib/languages/typescript"),
};

async function ensureLang(lang: string): Promise<boolean> {
  if (registered.has(lang)) return true;
  const loader = LANG_IMPORTS[lang];
  if (!loader) return false;
  try {
    const mod = await loader();
    if (!registered.has(lang)) {
      hljs.registerLanguage(lang, mod.default);
      registered.add(lang);
    }
    return true;
  } catch {
    return false;
  }
}

interface Props {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function HighlightedCode({ code, language, showLineNumbers = true, className }: Props) {
  const codeRef = useRef<HTMLElement>(null);
  const lines = code.split("\n");

  useEffect(() => {
    if (language === "plaintext" || !language) return;

    let cancelled = false;
    void ensureLang(language).then((ok) => {
      if (cancelled || !ok || !codeRef.current) return;
      try {
        const result = hljs.highlight(code, { language });
        codeRef.current.innerHTML = result.value;
      } catch {
        // fallback to plain text
      }
    });

    return () => { cancelled = true; };
  }, [code, language]);

  return (
    <pre className={className}>
      {showLineNumbers && (
        <div className="paste-viewer-lines">
          {lines.map((_, i) => (
            <span key={i} className="paste-viewer-ln">{i + 1}</span>
          ))}
        </div>
      )}
      <code ref={codeRef}>{code}</code>
    </pre>
  );
}
