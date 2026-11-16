/**
 * ReviseWithAi: asks AI to change a case's steps the way a tester describes ("check the message inside the popup"),
 * then shows the proposal next to the current steps, with what changed marked, before anything is used.
 *
 * Nothing is saved here. "Use these steps" puts the proposal in the step editor, where the tester checks it, can change
 * it further (or ask again), and saves it with the editor's own Save, which validates it like any other edit.
 */
import { useState } from 'react';
import { Alert, Badge, Button, Field, TextArea } from '../../../design-system/index.js';
import type { ActionInfo } from '../../../shared/api/catalog.js';
import { errorMessage } from '../../../shared/api/http.js';
import { reviseSteps, type RevisedSteps } from '../../ai-assistant/api.js';
import type { Step } from '../api.js';
import { stepSentence } from './StepEditor.js';
import styles from './ReviseWithAi.module.css';

/** Props of `ReviseWithAi`. */
export interface ReviseWithAiProps {
  caseId: string;
  /** The steps as they are in the editor now, saved or not. */
  steps: Step[];
  actions: ActionInfo[];
  /** Put the accepted steps in the editor. */
  onAccept: (steps: Step[]) => void;
}

type Change = 'same' | 'changed' | 'added' | 'removed';

const CHANGE_LABEL: Record<Exclude<Change, 'same'>, string> = {
  changed: 'Changed',
  added: 'New',
  removed: 'Removed',
};

/** How each position differs between the current steps and the proposal. */
function compare(now: Step[], next: Step[]): { now?: Step; next?: Step; change: Change }[] {
  return Array.from({ length: Math.max(now.length, next.length) }, (_, i) => {
    const a = now[i];
    const b = next[i];
    const change: Change = !a
      ? 'added'
      : !b
        ? 'removed'
        : JSON.stringify(a) === JSON.stringify(b)
          ? 'same'
          : 'changed';
    return { ...(a && { now: a }), ...(b && { next: b }), change };
  });
}

/** The "Improve with AI" box of the Steps tab. */
export function ReviseWithAi({ caseId, steps, actions, onAccept }: ReviseWithAiProps) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<RevisedSteps>();
  const byName = new Map(actions.map((a) => [a.name, a]));
  const say = (s: Step | undefined) => (s ? stepSentence(byName.get(s.action), s) : '');

  const ask = async () => {
    setBusy(true);
    setError('');
    try {
      setProposal(await reviseSteps(caseId, steps, instruction.trim()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = proposal ? compare(steps, proposal.steps) : [];
  const changes = rows.filter((r) => r.change !== 'same').length;

  return (
    <section className={styles.box} aria-label="Improve with AI">
      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim() && !busy) void ask();
        }}
      >
        <Field
          label="Improve with AI"
          hint="Say what should change. You see the AI's steps next to yours before anything is used, and nothing is saved until you save."
        >
          {(p) => (
            <TextArea
              {...p}
              rows={2}
              value={instruction}
              placeholder="For example: check the message inside the confirmation popup"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Enter asks, like the AI Assistant's prompt.
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (instruction.trim() && !busy) void ask();
                }
              }}
            />
          )}
        </Field>
        <div>
          <Button type="submit" icon="sparkle" loading={busy} disabled={!instruction.trim()}>
            {proposal ? 'Ask again' : 'Ask AI'}
          </Button>
        </div>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {proposal && (
        <div className={styles.proposal}>
          <Alert
            tone={proposal.issues.length ? 'warning' : 'info'}
            title={
              changes === 0
                ? 'The AI kept the steps as they are'
                : `The AI suggests ${changes} change${changes === 1 ? '' : 's'}`
            }
          >
            {proposal.issues.length > 0 &&
              `It could not fix ${proposal.issues.length} problem${proposal.issues.length === 1 ? '' : 's'}; you will see them on the steps. `}
            {proposal.note}
          </Alert>
          <table className={styles.compare}>
            <caption className="visually-hidden">Your steps and the AI's steps</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Now</th>
                <th scope="col">AI suggests</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} data-change={r.change}>
                  <th scope="row">{i + 1}</th>
                  <td>{say(r.now) || <span className={styles.none}>—</span>}</td>
                  <td>
                    {say(r.next) || <span className={styles.none}>—</span>}
                    {r.change !== 'same' && (
                      <span className={styles.badge}>
                        <Badge tone={r.change === 'removed' ? 'danger' : 'info'}>
                          {CHANGE_LABEL[r.change]}
                        </Badge>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.actions}>
            <Button onClick={() => setProposal(undefined)}>Discard</Button>
            <Button
              variant="primary"
              icon="check"
              onClick={() => {
                onAccept(proposal.steps);
                setProposal(undefined);
                setInstruction('');
              }}
            >
              Use these steps
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
