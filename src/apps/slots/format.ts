export function fmtMB(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function fmtNB(bytes: number): string {
  const nb = Math.round(bytes / (1024 * 1024));
  return `${nb} NB`;
}

export function fmtBonusPayout(bonus: { currency: string; total_bonus: number }): string {
  if (bonus.currency === "niggabytes") return `${bonus.total_bonus} NB`;
  return fmtMB(bonus.total_bonus);
}
