/**
 * StartRunDialog: confirms what will run, where and as whom. Each case runs against its own project's application, so
 * the chosen cases are shown by project; a project that signs in asks for one or more of its own test accounts, and
 * each of its cases runs once per account. Signing in is done once per account by the run itself.
 *
 * "How to run" picks how the cases share browsers and sign-ins (see `RUN_MODES`). "Concurrent users" opens enough
 * browsers for every job at once, as different people or as one person in several browsers, so the same cases run side
 * by side: the way to check locking, double submits and other races. The person ticks who signs in.
 */
import { useEffect, useState } from 'react';
import type { RunMode } from '@qa-studio/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  SearchBox,
  Spinner,
  TextInput,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { href, hrefIn } from '../../../shared/hooks/useRoute.js';
import { plural } from '../../../shared/lib/format.js';
import { planRun, startRun, type RunPlan, type RunPlanGroup, type RunView } from '../api.js';
import styles from './StartRunDialog.module.css';

/** The ways a run can execute, in the order shown. The first is the recommended default. */
const RUN_MODES: { value: RunMode; label: string; hint: string; recommended?: boolean }[] = [
  {
    value: 'clean',
    label: 'Fresh window for each test case',
    hint: 'Signs in once per user, then opens every test case in a new signed-in window. Nothing from one test case carries over to the next, so results are reliable and repeatable.',
    recommended: true,
  },
  {
    value: 'shared',
    label: 'Same window for all test cases',
    hint: 'Signs in once per user and runs the test cases one after another in the same window. Fastest, but anything a test case leaves behind (open pages, filters, drafts) can affect the next one.',
  },
  {
    value: 'concurrent',
    label: 'Concurrent users',
    hint: 'Opens a separate browser for every test case and user, each signing in, all at the same time. Use it to check locking, double submits and other things that happen when people work at once.',
  },
];

/** Who signs in during a concurrent run: different people, or one person in several browsers. */
type ConcurrentUsers = 'different' | 'same';

/** The choices for who signs in during a concurrent run. */
const CONCURRENT_USERS: { value: ConcurrentUsers; label: string; hint: string }[] = [
  {
    value: 'different',
    label: 'Different users',
    hint: 'Each ticked user signs in to their own browser, and they all work at the same time. Tick two or more users.',
  },
  {
    value: 'same',
    label: 'Same user in several browsers',
    hint: 'Each ticked user signs in to several browsers at once, and every test case runs in each of them at the same time. For example, to check a double submit from two sessions of one person.',
  },
];

/** From this many accounts a project's list gets a search box: past it, ticking by scrolling gets slow. */
const SEARCH_FROM = 7;

/** Most browsers one user can sign in to at once (the worker's limit). */
const MAX_BROWSERS_PER_USER = 8;

/** Props of `StartRunDialog`. */
export interface StartRunDialogProps {
  caseIds: string[];
  /** Start in concurrent-users mode: one browser per case and account (at most 16). */
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
  const [mode, setMode] = useState<RunMode>(concurrent ? 'concurrent' : 'clean');
  const [users, setUsers] = useState<ConcurrentUsers>('different');
  const [perUser, setPerUser] = useState('2');

  useEffect(() => {
    planRun(caseIds).then(
      (p) => {
        setPlan(p);
        setWorkers(String(p.workers ?? 1));
        // One account is the common case: choose it so the person can just press Start. With more, in any mode
        // (concurrent too), the person picks who signs in.
        setChosen(
          new Set(p.groups.flatMap((g) => (g.accounts.length === 1 ? [g.accounts[0]!.id] : []))),
        );
      },
      (e: unknown) => setError(errorMessage(e)),
    );
  }, []);

  const groups = plan?.groups ?? [];
  const chosenIn = (g: RunPlanGroup) => g.accounts.filter((a) => chosen.has(a.id)).length;
  const canStart =
    groups.length > 0 && groups.every((g) => g.available && (!g.loginRequired || chosenIn(g) > 0));
  // Browsers each user signs in to at once: more than one only for "same user in several browsers".
  const copies =
    mode === 'concurrent' && users === 'same'
      ? Math.min(MAX_BROWSERS_PER_USER, Math.max(2, Math.trunc(Number(perUser)) || 2))
      : 1;
  // The worker repeats cases only for projects that sign in: without an account there is no "same user".
  const total = groups.reduce(
    (n, g) => n + g.caseCount * Math.max(chosenIn(g), 1) * (chosenIn(g) > 0 ? copies : 1),
    0,
  );
  const environments = [...new Set(groups.map((g) => g.environment).filter(Boolean))];
  // Concurrent: every job gets its own browser, within the engine's limit.
  useEffect(() => {
    if (mode === 'concurrent' && total > 0) setWorkers(String(Math.min(16, total)));
  }, [mode, total]);

  const chooseMode = (next: RunMode) => {
    // Leaving concurrent mode goes back to the usual number of windows instead of keeping one per job.
    if (mode === 'concurrent' && next !== 'concurrent') setWorkers(String(plan?.workers ?? 1));
    setMode(next);
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      // One shared window means one case at a time; the other modes use the number chosen.
      const w = mode === 'shared' ? 1 : Number(workers);
      const run = await startRun(
        caseIds,
        [...chosen],
        Number.isFinite(w) && w > 0 ? w : undefined,
        mode,
        copies > 1 ? copies : undefined,
      );
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
      size="lg"
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
        // Two columns on a wide screen (who signs in | how to run), so the whole choice fits without scrolling; one
        // column on a phone.
        <div className={styles.layout}>
          <div className={styles.column}>
            {groups.map((g) => (
              <ProjectGroup
                key={String(g.projectId)}
                group={g}
                chosen={chosen}
                onSet={(ids, on) => {
                  const next = new Set(chosen);
                  for (const id of ids) {
                    if (on) next.add(id);
                    else next.delete(id);
                  }
                  setChosen(next);
                }}
              />
            ))}
          </div>
          <div className={styles.column}>
            <fieldset className={styles.modes}>
              <legend>How to run</legend>
              {RUN_MODES.map((m) => {
                const on = mode === m.value;
                // Sharing a window only differs from a fresh one when a user runs two or more test cases. With one, the
                // choice is shown (so people learn it exists) but cannot be picked, and says why.
                const unavailable = m.value === 'shared' && caseIds.length < 2;
                const hintId = `run-mode-${m.value}-hint`;
                return (
                  <label
                    key={m.value}
                    className={[
                      styles.mode,
                      on && styles.modeOn,
                      unavailable && styles.modeDisabled,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      type="radio"
                      name="run-mode"
                      value={m.value}
                      checked={on}
                      disabled={unavailable}
                      aria-describedby={hintId}
                      onChange={() => chooseMode(m.value)}
                    />
                    <span>
                      <span className={styles.modeTitle}>
                        {m.label}
                        {m.recommended && <Badge tone="primary">Recommended</Badge>}
                        {unavailable && <Badge>Needs 2+ test cases</Badge>}
                      </span>
                      <span id={hintId} className={styles.modeHint}>
                        {m.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {mode === 'concurrent' && (
              <fieldset className={styles.modes}>
                <legend>Who signs in</legend>
                {CONCURRENT_USERS.map((u) => {
                  const on = users === u.value;
                  return (
                    <label
                      key={u.value}
                      className={on ? `${styles.mode} ${styles.modeOn}` : styles.mode}
                    >
                      <input
                        type="radio"
                        name="concurrent-users"
                        value={u.value}
                        checked={on}
                        onChange={() => setUsers(u.value)}
                      />
                      <span>
                        <span className={styles.modeTitle}>{u.label}</span>
                        <span className={styles.modeHint}>{u.hint}</span>
                      </span>
                    </label>
                  );
                })}
                {users === 'different' && chosen.size === 1 && (
                  <p className={styles.modeHint} role="status">
                    Only one user is ticked, so the test cases run one after another. Tick another
                    user to run them at the same time.
                  </p>
                )}
                {users === 'same' && (
                  <Field
                    label="Browsers per user"
                    hint="How many browsers each ticked user signs in to at the same time."
                    inline
                  >
                    {(p) => (
                      <TextInput
                        {...p}
                        type="number"
                        min={2}
                        max={MAX_BROWSERS_PER_USER}
                        style={{ width: '6rem' }}
                        value={perUser}
                        onChange={(e) => setPerUser(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </fieldset>
            )}
            {/* A single run has nothing to spread over several windows or browsers, so the number is not asked. */}
            {canStart && mode !== 'shared' && total > 1 && (
              <Field
                label={mode === 'concurrent' ? 'Browsers at once' : 'Windows at once'}
                hint={
                  mode === 'concurrent'
                    ? 'More browsers finish sooner but use more memory.'
                    : 'Each user still runs one test case at a time; more windows let different users run side by side.'
                }
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
        </div>
      )}
    </Dialog>
  );
}

function ProjectGroup({
  group: g,
  chosen,
  onSet,
}: Readonly<{
  group: RunPlanGroup;
  chosen: Set<string>;
  /** Tick (`on`) or untick the given accounts. */
  onSet: (ids: string[], on: boolean) => void;
}>) {
  const [query, setQuery] = useState('');
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
  const q = query.trim().toLowerCase();
  const shown = q
    ? g.accounts.filter((a) => `${a.label} ${a.username}`.toLowerCase().includes(q))
    : g.accounts;
  const ticked = g.accounts.filter((a) => chosen.has(a.id)).length;
  const many = g.accounts.length >= SEARCH_FROM;
  return (
    <section className={styles.project} aria-label={name}>
      <div>
        <strong>{name}</strong>
        <span className={styles.projectMeta}>
          {plural(g.caseCount, 'test case')} · {g.environment} · {g.appUrl}
        </span>
      </div>
      {g.loginRequired && g.accounts.length === 0 && (
        <Alert tone="warning" title="No test account">
          This project signs in. <a href={projectHref(g)}>Add a test account to it</a>.
        </Alert>
      )}
      {g.loginRequired && g.accounts.length > 0 && (
        <fieldset className={styles.accounts}>
          <legend className={styles.accountsHead}>
            Run as
            <span className={styles.count} aria-live="polite">
              {ticked} of {g.accounts.length} chosen
            </span>
          </legend>
          {g.accounts.length > 1 && (
            <div className={styles.accountTools}>
              {many && (
                <SearchBox value={query} onChange={setQuery} label={`Search ${name} users`} />
              )}
              {/* With a search, these act on the users it shows, so a filtered group can be ticked in one go. */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onSet(
                    shown.map((a) => a.id),
                    true,
                  )
                }
                disabled={shown.every((a) => chosen.has(a.id))}
              >
                {q ? 'Select shown' : 'Select all'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onSet(
                    shown.map((a) => a.id),
                    false,
                  )
                }
                disabled={!shown.some((a) => chosen.has(a.id))}
              >
                Clear
              </Button>
            </div>
          )}
          <div
            className={
              many ? `${styles.accountList} ${styles.accountListMany}` : styles.accountList
            }
          >
            {shown.map((a) => (
              <Checkbox
                key={a.id}
                label={a.label}
                hint={a.username}
                checked={chosen.has(a.id)}
                onChange={(e) => onSet([a.id], e.target.checked)}
              />
            ))}
            {shown.length === 0 && <p className={styles.modeHint}>No user matches “{query}”.</p>}
          </div>
        </fieldset>
      )}
    </section>
  );
}
