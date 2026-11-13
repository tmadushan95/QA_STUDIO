/**
 * StatusBadge molecule: the one vocabulary for statuses across the app. Each status has a tone, a glyph and a word,
 * so meaning never depends on colour alone.
 */
import { Badge, type BadgeTone } from '../atoms/Badge.js';

const STATUS: Record<string, { tone: BadgeTone; glyph: string; label: string }> = {
  // Run results
  passed: { tone: 'success', glyph: '✓', label: 'Passed' },
  failed: { tone: 'danger', glyph: '✕', label: 'Failed' },
  blocked: { tone: 'warning', glyph: '!', label: 'Blocked' },
  skipped: { tone: 'neutral', glyph: '–', label: 'Skipped' },
  cancelled: { tone: 'neutral', glyph: '–', label: 'Cancelled' },
  queued: { tone: 'info', glyph: '…', label: 'Queued' },
  running: { tone: 'primary', glyph: '▶', label: 'Running' },
  notRun: { tone: 'neutral', glyph: '○', label: 'Not run' },
  // Automation of a test case
  approved: { tone: 'success', glyph: '✓', label: 'Ready to run' },
  validated: { tone: 'info', glyph: '◐', label: 'To approve' },
  draft: { tone: 'warning', glyph: '!', label: 'Needs fixing' },
  none: { tone: 'neutral', glyph: '○', label: 'No steps' },
  // Conversion of imported cases
  pending: { tone: 'neutral', glyph: '…', label: 'Pending' },
  ready: { tone: 'success', glyph: '✓', label: 'Ready' },
  'needs-review': { tone: 'warning', glyph: '◐', label: 'Needs review' },
  done: { tone: 'success', glyph: '✓', label: 'Done' },
  // Field mapping
  auto: { tone: 'success', glyph: '✓', label: 'Auto-detected' },
  manual: { tone: 'primary', glyph: '✎', label: 'Mapped by hand' },
  unmapped: { tone: 'warning', glyph: '!', label: 'Not mapped' },
};

/** Props of `StatusBadge`. */
export interface StatusBadgeProps {
  status: string;
  /** Override the default word, for example "Ready to run (v3)". */
  label?: string;
}

/** A badge showing a status with its standard colour, glyph and wording. */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const s = STATUS[status] ?? { tone: 'neutral' as const, glyph: '•', label: status };
  return (
    <Badge tone={s.tone} glyph={s.glyph}>
      {label ?? s.label}
    </Badge>
  );
}
