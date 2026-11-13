/**
 * StartRunDialog: confirms what will run, where and as whom. Each case runs against its own project's application, so
 * the chosen cases are shown by project; a project that signs in asks for one or more of its own test accounts, and
 * each of its cases runs once per account. Signing in is done once per account by the run itself.
 *
 * "Concurrent users" chooses every account of each project and opens enough browsers for all of them at once, so the
 * same cases run side by side as different people: the way to check locking, double submits and other races.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Spinner,
  TextInput,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { href, hrefIn } from '../../../shared/hooks/useRoute.js';
import { plural } from '../../../shared/lib/format.js';
import { planRun, startRun, type RunPlan, type RunPlanGroup, type RunView } from '../api.js';

/** Props of `StartRunDialog`. */
export interface StartRunDialogProps {
  caseIds: string[];
  /** Start in concurrent-users mode: every account chosen, one browser per case and account (at most 16). */
  concurrent?: boolean;
  onClose: () => void;
  onStarted: (run: RunView) => void;
}

/** The project's settings, where its address and sign-in are set (a numeric address is rewritten to the code). */
const projectHref = (g: RunPlanGroup) =>
  g.projectId === undefined
    ? href('home')
    : hrefIn(String(g.projectId), 'project-settings', 'general');

/** The popup that chooses accounts and options, then starts a run. */
export function StartRunDialog({
  caseIds,
  concurrent = false,
  onClose,
  onStarted,
}: StartRunDialogProps) {
  const [plan, setPlan] = useState<RunPlan>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [workers, setWorkers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [together, setTogether] = useState(concurrent);

  useEffect(() => {
    planRun(caseIds).then(
      (p) => {
        setPlan(p);
        setWorkers(String(p.workers ?? 1));
        // One account is the common case: choose it so the person can just press Start. Concurrent mode takes all.
        setChosen(
          new Set(
            p.groups.flatMap((g) =>
              concurrent
                ? g.accounts.map((a) => a.id)
                : g.accounts.length === 1
                  ? [g.accounts[0]!.id]
                  : [],
            ),
          ),
        );
      },
      (e: unknown) => setError(errorMessage(e)),
    );
  }, []);

  const groups = plan?.groups ?? [];
  const chosenIn = (g: RunPlanGroup) => g.accounts.filter((a) => chosen.has(a.id)).length;
  const canStart =
    groups.length > 0 && groups.every((g) => g.available && (!g.loginRequired || chosenIn(g) > 0));
  const total = groups.reduce((n, g) => n + g.caseCount * Math.max(chosenIn(g), 1), 0);
  const environments = [...new Set(groups.map((g) => g.environment).filter(Boolean))];
  const allAccounts = groups.flatMap((g) => g.accounts.map((a) => a.id));
  // Concurrent: every job gets its own browser, within the engine's limit.
  useEffect(() => {
    if (together && total > 0) setWorkers(String(Math.min(16, total)));
  }, [together, total]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const w = Number(workers);
      const run = await startRun(caseIds, [...chosen], Number.isFinite(w) && w > 0 ? w : undefined);
      onStarted(run);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Start a run"
      subtitle={`${caseIds.length} test case${caseIds.length === 1 ? '' : 's'}${environments.length > 0 ? ` · ${environments.join(', ')}` : ''}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="play"
            onClick={() => void start()}
            disabled={!canStart}
            loading={busy}
          >
            Start {total} run{total === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!plan && !error && (
        <p>
          <Spinner /> Checking the projects…
        </p>
      )}
      {error && (
        <Alert tone="danger" title="The run could not start">
          {error}
        </Alert>
      )}
      {plan && (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          {groups.map((g) => (
            <ProjectGroup
              key={String(g.projectId)}
              group={g}
              chosen={chosen}
              onToggle={(id) => {
                const next = new Set(chosen);
                if (!next.delete(id)) next.add(id);
                setChosen(next);
              }}
            />
          ))}
          {allAccounts.length > 1 && (
            <Checkbox
              label="Concurrent users"
              hint="Run the cases as every chosen user at the same time, to check what happens when people work at once."
              checked={together}
              onChange={(e) => {
                setTogether(e.target.checked);
                if (e.target.checked) setChosen(new Set(allAccounts));
              }}
            />
          )}
          {canStart && (
            <Field
              label="Browsers at once"
              hint="More browsers finish sooner but use more memory."
              inline
            >
              {(p) => (
                <TextInput
                  {...p}
                  type="number"
                  min={1}
                  max={16}
                  style={{ width: '6rem' }}
                  value={workers}
                  onChange={(e) => setWorkers(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}

function ProjectGroup({
  group: g,
  chosen,
  onToggle,
}: Readonly<{ group: RunPlanGroup; chosen: Set<string>; onToggle: (id: string) => void }>) {
  const name = g.projectName ?? 'This project';
  if (!g.available)
    return (
      <Alert
        tone="warning"
        title={`${name} is not ready to run`}
        actions={
          <a className="button-link" href={projectHref(g)}>
            Set up the project
          </a>
        }
      >
        {g.reason ?? 'Set up the project first.'}
      </Alert>
    );
  return (
    <section style={{ display: 'grid', gap: 'var(--space-2)' }} aria-label={name}>
      <div>
        <strong>{name}</strong>
        <span
          style={{ display: 'block', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}
        >
          {plural(g.caseCount, 'test case')} · {g.environment} · {g.appUrl}
        </span>
      </div>
      {g.loginRequired && g.accounts.length === 0 && (
        <Alert tone="warning" title="No test account">
          This project signs in. <a href={projectHref(g)}>Add a test account to it</a>.
        </Alert>
      )}
      {g.loginRequired && g.accounts.length > 0 && (
        <fieldset
          style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}
        >
          <legend style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Run as</legend>
          {g.accounts.map((a) => (
            <Checkbox
              key={a.id}
              label={a.label}
              hint={a.username}
              checked={chosen.has(a.id)}
              onChange={() => onToggle(a.id)}
            />
          ))}
        </fieldset>
      )}
    </section>
  );
}
