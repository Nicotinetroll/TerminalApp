// Shared language detection for paste system

export const LANGUAGES = [
  "plaintext", "javascript", "typescript", "python", "html", "css",
  "json", "sql", "bash", "go", "rust", "c", "cpp", "csharp", "java",
  "php", "ruby", "kotlin", "swift", "dart", "lua", "perl",
  "powershell", "r", "scala", "haskell", "elixir", "clojure",
  "dockerfile", "graphql", "toml", "ini", "yaml", "markdown", "xml",
  "jsx", "tsx",
];

interface LangPattern {
  lang: string;
  patterns: RegExp[];
  weight?: number;
}

const LANG_RULES: LangPattern[] = [
  { lang: "html",       patterns: [/<!DOCTYPE\s+html/i, /<html[\s>]/i, /<\/(?:div|span|body|head)>/i] },
  { lang: "jsx",        patterns: [/import\s+React/,  /from\s+['"]react['"]/,  /export\s+(?:default\s+)?function\s+\w+.*\breturn\s*\(/s], weight: 3 },
  { lang: "tsx",        patterns: [/import\s+.*from\s+['"]react['"]/, /:\s*React\.FC/, /interface\s+\w+Props/], weight: 3 },
  { lang: "dockerfile", patterns: [/^FROM\s+\S+/m, /^RUN\s+/m, /^COPY\s+/m, /^ENTRYPOINT\s+/m] },
  { lang: "graphql",    patterns: [/^(?:query|mutation|subscription|type|input|enum|schema)\s+\w+/m, /{\s*\w+\s*(?:\(.*?\))?\s*{/] },
  { lang: "yaml",       patterns: [/^---\s*$/m, /^\w[\w-]*:\s+/m], weight: 1 },
  { lang: "toml",       patterns: [/^\[[\w.-]+\]\s*$/m, /^\w+\s*=\s*["'\[{]/m] },
  { lang: "ini",        patterns: [/^\[[\w\s]+\]\s*$/m, /^\w+\s*=\s*\S/m], weight: 1 },
  { lang: "json",       patterns: [/^\s*[{\[]/m, /"\w+":\s*["\d\[{ntf]/], weight: 1 },
  { lang: "markdown",   patterns: [/^#{1,6}\s+\S/m, /^\*\*\w.*\*\*/m, /\[.+\]\(.+\)/] },
  { lang: "sql",        patterns: [/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, /\bFROM\s+\w+/i, /\bWHERE\s+\w+/i] },
  { lang: "xml",        patterns: [/<\?xml\s/i, /<\/[\w:-]+>/, /<[\w:-]+\s+[\w:-]+=/] },
  { lang: "typescript", patterns: [/:\s*(?:string|number|boolean|void|any|unknown|never)\b/, /interface\s+\w+\s*{/, /type\s+\w+\s*=/, /as\s+(?:string|number|boolean|any)\b/], weight: 3 },
  { lang: "csharp",     patterns: [/\busing\s+System/, /\bnamespace\s+\w+/, /\bclass\s+\w+\s*:\s*\w+/, /\b(?:public|private|protected|internal)\s+(?:static\s+)?(?:void|int|string|bool|async\s+Task)/], weight: 3 },
  { lang: "kotlin",     patterns: [/\bfun\s+\w+\(/, /\bval\s+\w+\s*[:=]/, /\bvar\s+\w+\s*[:=]/, /\bdata\s+class\b/], weight: 3 },
  { lang: "swift",      patterns: [/\bfunc\s+\w+\(/, /\blet\s+\w+\s*[:=]/, /\bvar\s+\w+\s*:\s*\w+/, /\bguard\s+let\b/, /\bimport\s+(?:UIKit|Foundation|SwiftUI)\b/], weight: 3 },
  { lang: "dart",       patterns: [/\bimport\s+['"]package:/, /\bvoid\s+main\(\)/, /\bWidget\s+build\(/, /\b(?:StatelessWidget|StatefulWidget)\b/], weight: 3 },
  { lang: "rust",       patterns: [/\bfn\s+\w+\(/, /\blet\s+mut\s+/, /\bimpl\s+\w+/, /\b(?:pub\s+)?(?:struct|enum|trait)\s+\w+/, /::(?:new|from)\(/], weight: 3 },
  { lang: "go",         patterns: [/\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\(/, /\bpackage\s+\w+/, /\bimport\s+\(/, /:=\s*/], weight: 3 },
  { lang: "python",     patterns: [/\bdef\s+\w+\(/, /\bimport\s+\w+/, /\bfrom\s+\w+\s+import\b/, /\bclass\s+\w+.*:$/m, /\bif\s+__name__\s*==\s*['"]__main__['"]/], weight: 2 },
  { lang: "java",       patterns: [/\bpublic\s+class\s+\w+/, /\bpublic\s+static\s+void\s+main\(/, /\bSystem\.out\.print/, /\bimport\s+java\.\w+/], weight: 2 },
  { lang: "php",        patterns: [/<\?php/, /\$\w+\s*=/, /\bfunction\s+\w+\(.*\$/, /\b(?:echo|var_dump|print_r)\b/], weight: 3 },
  { lang: "ruby",       patterns: [/\bdef\s+\w+/, /\bclass\s+\w+\s*</, /\bdo\s*\|/, /\brequire\s+['"]/, /\bend\s*$/m], weight: 2 },
  { lang: "lua",        patterns: [/\bfunction\s+\w+\(/, /\blocal\s+\w+\s*=/, /\bend\s*$/m, /\bthen\s*$/m], weight: 2 },
  { lang: "perl",       patterns: [/^#!.*perl/m, /\bmy\s+\$/, /\buse\s+strict\b/, /\bsub\s+\w+\s*{/], weight: 3 },
  { lang: "powershell", patterns: [/\$\w+\s*=/, /\bfunction\s+\w+-\w+/, /\bGet-\w+/, /\bSet-\w+/, /\bWrite-(?:Host|Output)\b/], weight: 3 },
  { lang: "r",          patterns: [/\b(?:library|require)\(\w+\)/, /<-\s*(?:function|c)\(/, /\bggplot\(/, /\bdata\.frame\(/], weight: 3 },
  { lang: "scala",      patterns: [/\bdef\s+\w+.*:\s*\w+\s*=/, /\bval\s+\w+:\s*\w+/, /\bobject\s+\w+/, /\bcase\s+class\b/], weight: 3 },
  { lang: "haskell",    patterns: [/\bmodule\s+\w+/, /\bimport\s+(?:qualified\s+)?\w+/, /\b::\s*[\w\[\]()\->]+/, /\bwhere\s*$/m], weight: 3 },
  { lang: "elixir",     patterns: [/\bdefmodule\s+\w+/, /\bdef\s+\w+.*\bdo\b/, /\bdefp?\s+\w+/, /\|>\s*/], weight: 3 },
  { lang: "clojure",    patterns: [/^\s*\(ns\s+/, /\(defn?\s+\w+/, /\(let\s+\[/, /\(def\s+\w+/], weight: 3 },
  { lang: "css",        patterns: [/[.#][\w-]+\s*{/, /@media\s*\(/, /:\s*(?:flex|grid|none|block|inherit)\s*;/, /\b(?:margin|padding|background|color)\s*:/], weight: 2 },
  { lang: "javascript", patterns: [/\bconst\s+\w+\s*=/, /\bfunction\s+\w+\(/, /\bconsole\.log\(/, /\bmodule\.exports\b/, /\brequire\(['"]/, /=>\s*{/], weight: 1 },
  { lang: "bash",       patterns: [/^#!/m, /\becho\s+/, /\bfi\s*$/m, /\bif\s+\[\s*/, /\bfor\s+\w+\s+in\b/], weight: 1 },
];

export function detectLanguage(code: string): string | null {
  if (!code || code.length < 10) return null;

  const scores: Record<string, number> = {};

  for (const rule of LANG_RULES) {
    let matches = 0;
    for (const p of rule.patterns) {
      if (p.test(code)) matches++;
    }
    if (matches > 0) {
      scores[rule.lang] = (scores[rule.lang] ?? 0) + matches * (rule.weight ?? 2);
    }
  }

  let best: string | null = null;
  let bestScore = 1;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }

  return best;
}
