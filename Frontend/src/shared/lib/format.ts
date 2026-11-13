/** Formatting helpers shared by every screen, so dates and counts read the same everywhere. */

/** "12 Mar, 14:05", or "—" for a missing date. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "1 case", "3 cases". */
export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

/** "1.2 s", "350 ms". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
