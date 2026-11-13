/**
 * Test case IDs for cases created in the app. The next ID follows the pattern most existing IDs use (prefix and
 * number width), so a list of `TC_01 … TC_30` continues with `TC_31`, and `ACE-0099` with `ACE-0100`.
 */

/** Used when there are no numbered IDs yet. */
export const DEFAULT_PREFIX = 'TC_';
const DEFAULT_WIDTH = 2;

const NUMBERED = /^(.*?)(\d+)$/;

/** The next free ID: the most common prefix, one above its highest number, padded like the existing ones. */
export function nextCaseId(existing: Iterable<string>): string {
  const taken = new Set(existing);
  const groups = new Map<string, { count: number; max: number; width: number }>();
  for (const id of taken) {
    const m = NUMBERED.exec(id);
    if (!m) continue;
    const prefix = m[1]!;
    const digits = m[2]!;
    const g = groups.get(prefix) ?? { count: 0, max: 0, width: 0 };
    g.count++;
    g.max = Math.max(g.max, Number(digits));
    g.width = Math.max(g.width, digits.length);
    groups.set(prefix, g);
  }
  // The prefix most IDs share wins; a tie goes to the one with the highest number (the one in current use).
  const [prefix, g] = [...groups.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].max - a[1].max,
  )[0] ?? [DEFAULT_PREFIX, { count: 0, max: 0, width: DEFAULT_WIDTH }];
  // Skip forward past any ID already used, for example one typed by hand with a gap in the numbers.
  for (let n = g.max + 1; ; n++) {
    const id = `${prefix}${String(n).padStart(g.width, '0')}`;
    if (!taken.has(id)) return id;
  }
}
