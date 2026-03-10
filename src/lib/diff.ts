// Line-based diff using LCS (Longest Common Subsequence)

export interface DiffLine {
  type: "add" | "del" | "same";
  text: string;
  oldNum?: number;
  newNum?: number;
}

const MAX_LINES = 1500;

export function computeDiff(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;

  const m = a.length;
  const n = b.length;

  // Build LCS DP table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
  }

  for (let i = 1; i <= m; i++) {
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]! + 1
        : Math.max(prev[j]!, row[j - 1]!);
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: "same", text: a[i - 1]!, oldNum: i, newNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: "add", text: b[j - 1]!, newNum: j });
      j--;
    } else {
      result.push({ type: "del", text: a[i - 1]!, oldNum: i });
      i--;
    }
  }

  result.reverse();
  return result;
}
