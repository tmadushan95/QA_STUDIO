/**
 * ConversionCard: live progress of converting imported cases into steps — how many are ready, need review, failed,
 * are skipped or still pending — with the next actions: approve the ready ones, finish the rest with AI or by hand.
 */
import { useState } from 'react';
import { Badge, Button, ProgressBar, StatusBadge, useToast } from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { formatDate, plural } from '../../../shared/lib/format.js';
import { approveMany } from '../../test-cases/api.js';
import {
  cancelConversion,
  startAiDrafts,
  type ConversionJob,
  type ConversionItemStatus,
} from '../api.js';
import styles from './Import.module.css';

/** The AI drafting job takes at most this many cases at a time. */
const MAX_AI = 25;

/** Props of `ConversionCard`. */
export interface ConversionCardProps {
  job: ConversionJob;
  onChanged: () => void;
  /** Open a case in the editor. */
  onOpenCase: (caseId: string) => void;
}

const ORDER: ConversionItemStatus[] = ['ready', 'needs-review', 'failed', 'skipped', 'pending'];

/** One conversion job's live progress and its outcome per case. */
export function ConversionCard({ job, onChanged, onOpenCase }: ConversionCardProps) {
  const toast = useToast();
  const [show, setShow] = useState<ConversionItemStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const c = job.counts;
  const done = job.total - c.pending;
  const ready = job.items.filter((i) => i.status === 'ready').map((i) => i.caseId);
  const review = job.items.filter((i) => i.status === 'needs-review').map((i) => i.caseId);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.show(await fn());
      onChanged();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={styles.jobCard}
      aria-label={`Conversion started ${formatDate(job.startedAt)}`}
    >
      <header className={styles.jobHead}>
        <div>
          <h3>Converting {plural(job.total, 'test case')}</h3>
          <p className={styles.muted}>
            Started {formatDate(job.startedAt)}
            {job.endedAt && ` · finished ${formatDate(job.endedAt)}`}
          </p>
        </div>
        <StatusBadge status={job.status === 'running' ? 'running' : job.status} />
      </header>
      <ProgressBar
        value={done}
        max={job.total}
        label="Conversion progress"
        tone={job.status === 'done' ? 'success' : 'primary'}
      />
      <p className={styles.jobCount}>
        {done} / {job.total} converted
      </p>
      <div className={styles.countRow}>
        {ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={show === s ? `${styles.countChip} ${styles.countActive}` : styles.countChip}
            aria-pressed={show === s}
            onClick={() => setShow(show === s ? undefined : s)}
            disabled={c[s] === 0}
          >
            <StatusBadge status={s} />
            <strong>{c[s]}</strong>
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        {job.status === 'running' && (
          <Button
            size="sm"
            onClick={() =>
              void act(async () => (await cancelConversion(job.id), 'Conversion stopped.'))
            }
            disabled={busy}
          >
            Stop
          </Button>
        )}
        {ready.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            icon="check"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await approveMany(ready);
                return `${plural(r.approved, 'case')} approved and ready to run.`;
              })
            }
          >
            Approve {ready.length} ready
          </Button>
        )}
        {review.length > 0 && (
          <Button
            size="sm"
            icon="sparkle"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await startAiDrafts(review.slice(0, MAX_AI));
                return `AI is drafting ${plural(Math.min(review.length, MAX_AI), 'case')}. Follow it on the AI assistant page.`;
              })
            }
          >
            Finish {Math.min(review.length, MAX_AI)} with AI
          </Button>
        )}
      </div>
      {show && (
        <ul className={styles.itemList} aria-label={`Cases: ${show}`}>
          {job.items
            .filter((i) => i.status === show)
            .map((i) => (
              <li key={i.caseId}>
                <button
                  type="button"
                  className={styles.caseLink}
                  onClick={() => onOpenCase(i.caseId)}
                >
                  {i.caseId}
                </button>
                <span className={styles.itemTitle}>{i.title}</span>
                {i.steps > 0 && <Badge>{plural(i.steps, 'step')}</Badge>}
                {i.message && <span className={styles.muted}>{i.message}</span>}
              </li>
            ))}
        </ul>
      )}
    </article>
  );
}
