/**
 * useCaseReorder: puts test cases in a new order from a grid (Test Case Studio, Test Execution) and saves it.
 *
 * The grid passes the whole list it shows, across all its pages and after its filters. A move is made in that list
 * and the list is sent in its new order; the server swaps only the places those cases already hold, so cases a
 * filter hides keep theirs. The new order shows at once and is replaced by the server's after the reload.
 *
 * Two ways in: drag a row onto another on the same page, or the row menu (top, up, down, bottom, or a numbered
 * position, which is how a case reaches another page).
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useToast, type MenuItem } from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { reorderCases } from './api.js';
import { MoveToPositionDialog } from './components/MoveToPositionDialog.js';
import type { CaseRow } from './useCaseLibrary.js';

/** What a grid needs to offer reordering. */
export interface CaseReorder {
  /** The grid's rows in their current order, including a move that is still being saved. */
  rows: CaseRow[];
  /** For `DataTable`'s `reorder` prop. */
  table: { onMove: (fromKey: string, toKey: string) => void };
  /** Row menu entries that move this row. Empty when the list has fewer than two rows. */
  menuItems: (row: CaseRow) => MenuItem[];
  /** The "Move to position" popup while it is open. */
  dialog: JSX.Element | null;
}

/** Moves `id` to `to` (0-based) in `ids`, returning a new list. */
export function moveId(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Reordering for one grid.
 * @param shown The rows the grid shows, in order, across all its pages.
 * @param source The library's rows; a new array means the server's order has arrived.
 * @param reload Reloads the library after a save.
 */
export function useCaseReorder(
  shown: CaseRow[],
  source: CaseRow[],
  reload: () => void,
): CaseReorder {
  const toast = useToast();
  const [pending, setPending] = useState<string[]>();
  const [positioning, setPositioning] = useState<string>();
  // Fresh data from the server carries the saved order, so the local one is no longer needed.
  useEffect(() => setPending(undefined), [source]);

  const rows = useMemo(() => {
    if (!pending) return shown;
    const at = new Map(pending.map((id, i) => [id, i]));
    // Rows that appeared since the move (a filter changed) keep their order, after the moved ones.
    const place = (r: CaseRow) => at.get(r.tc.id) ?? pending.length;
    return [...shown].sort((a, b) => place(a) - place(b));
  }, [shown, pending]);
  const ids = rows.map((r) => r.tc.id);

  const save = async (next: string[]) => {
    setPending(next);
    try {
      await reorderCases(next);
      reload();
    } catch (e) {
      setPending(undefined);
      toast.show(`The new order was not saved. ${errorMessage(e)}`, { tone: 'danger' });
    }
  };
  const move = (id: string, to: number) => {
    const next = moveId(ids, id, to);
    if (next.some((x, i) => x !== ids[i])) void save(next);
  };

  const menuItems = (row: CaseRow): MenuItem[] => {
    if (ids.length < 2) return [];
    const i = ids.indexOf(row.tc.id);
    const last = ids.length - 1;
    return [
      { label: 'Move to top', icon: 'up', disabled: i === 0, onSelect: () => move(row.tc.id, 0) },
      { label: 'Move up', icon: 'up', disabled: i === 0, onSelect: () => move(row.tc.id, i - 1) },
      {
        label: 'Move down',
        icon: 'down',
        disabled: i === last,
        onSelect: () => move(row.tc.id, i + 1),
      },
      {
        label: 'Move to bottom',
        icon: 'down',
        disabled: i === last,
        onSelect: () => move(row.tc.id, last),
      },
      { label: 'Move to position…', icon: 'drag', onSelect: () => setPositioning(row.tc.id) },
    ];
  };

  const dialog = positioning ? (
    <MoveToPositionDialog
      caseId={positioning}
      current={ids.indexOf(positioning) + 1}
      total={ids.length}
      onClose={() => setPositioning(undefined)}
      onMove={(position) => {
        setPositioning(undefined);
        move(positioning, position - 1);
      }}
    />
  ) : null;

  return {
    rows,
    table: { onMove: (from, to) => move(from, ids.indexOf(to)) },
    menuItems,
    dialog,
  };
}
