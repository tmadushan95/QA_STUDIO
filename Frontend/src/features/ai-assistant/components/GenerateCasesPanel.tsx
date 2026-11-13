/**
 * GenerateCasesPanel: describe what to test → review the proposed test cases as cards → save the chosen ones →
 * the AI writes their runnable steps, with each card showing how that went.
 *
 * - The prompt comes first; proposals appear below as a responsive card grid, each editable before saving.
 * - Nothing is stored until "Save selected": trying prompts never fills the database.
 * - Saved cases are filed under the given target (project › version › suite) and, unless switched off, the AI writes
 *   their steps from the platform's step catalog and the project's page names. A case it can only partly automate
 *   gets a draft plus a "check by hand" note instead of a refusal.
 *
 * - `/skill-name` in the prompt applies a saved skill (its instructions shape the cases); the server resolves it, and
 *   the panel shows which skills were applied and which `/words` matched none.
 *
 * Used on the AI Assistant page (with its own "save to" choice) and on Test Case Studio (with the page's work context).
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { useLive } from '../../../shared/api/live.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import { href } from '../../../shared/hooks/useRoute.js';
import { plural } from '../../../shared/lib/format.js';
import { useVoiceAction } from '../../voice/index.js';
import {
  addProposedCases,
  fetchDraftJobs,
  fetchSkills,
  proposeCases,
  proposeOrAsk,
  startDrafts,
  type AiStatus,
  type DraftJob,
  type ProposeOptions,
  type ProposedCase,
  type SkillUsage,
} from '../api.js';
import { OUTCOME } from '../outcomes.js';
import { SkillsDialog } from './SkillsDialog.js';
import styles from './GenerateCasesPanel.module.css';

const isCoverage = (v: unknown): v is NonNullable<ProposeOptions['coverage']> =>
  v === 'smoke' || v === 'standard' || v === 'thorough';
const isFormat = (v: unknown): v is NonNullable<ProposeOptions['format']> =>
  v === 'steps' || v === 'gherkin';

/** Where saved cases are filed. */
export interface GenerateTarget {
  projectId?: number | undefined;
  testSuiteId?: number | undefined;
  projectVersionId?: number | undefined;
}

/** Props of `GenerateCasesPanel`. */
export interface GenerateCasesPanelProps {
  status: AiStatus | undefined;
  target: GenerateTarget;
  /** Where the cases will be filed, as people read it. */
  targetLabel: string;
  /** Extra controls shown under the prompt, such as a "save to" choice. */
  targetControls?: JSX.Element;
  onSaved?: (ids: string[]) => void;
}

const EXAMPLES = [
  'Sign in with a valid and an invalid password, and reset a forgotten password.',
  'Create, edit and delete a draft project, checking the list after each change.',
  'Approve and reject a request as an approver, and check a viewer cannot approve.',
];

/** A saved proposal and the AI's step-writing result for it, once known. */
interface Saved {
  id: string;
  title: string;
}

/** Prompt → cards → save → steps. */
export function GenerateCasesPanel({
  status,
  target,
  targetLabel,
  targetControls,
  onSaved,
}: GenerateCasesPanelProps) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [proposals, setProposals] = useState<ProposedCase[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [writeSteps, setWriteSteps] = useState(true);
  const [busy, setBusy] = useState<'' | 'propose' | 'save'>('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Saved[]>([]);
  const [jobId, setJobId] = useState<string>();
  const [usage, setUsage] = useState<SkillUsage>();
  const [managing, setManaging] = useState(false);
  // A worker without skills (older build) answers 404: the panel then works exactly as before, with no skill chips.
  const skills = useResource(fetchSkills);
  const jobs = useResource(fetchDraftJobs);
  useLive((e) => e.type === 'job' && jobs.reload());
  const job: DraftJob | undefined = jobs.data?.find((j) => j.id === jobId);
  const resultOf = useMemo(() => new Map((job?.results ?? []).map((r) => [r.caseId, r])), [job]);

  // Voice: the same flow as typing a description and pressing the buttons, so what voice does is on screen.
  useVoiceAction({
    name: 'cases.generate',
    description:
      'Generate test cases from a description. Args: description (what to test), answers (the user’s answers to earlier questions, optional), skipQuestions (true when the user said "you decide"), coverage (smoke|standard|thorough), format (steps|gherkin). May return clarifying questions in data.questions instead of cases.',
    run: async (args) => {
      if (status && !status.ready)
        return { message: status.reason ?? 'AI is not set up. Open Settings › AI.' };
      const description = typeof args['description'] === 'string' ? args['description'].trim() : '';
      const answers = typeof args['answers'] === 'string' ? args['answers'].trim() : '';
      const text = answers ? `${description}\n${answers}` : description;
      if (text.length < 10)
        return { message: 'Ask the user to describe what to test in a sentence or two.' };
      setPrompt(text);
      setBusy('propose');
      setError('');
      try {
        const out = await proposeOrAsk(text, target.projectId, {
          // One round of questions at most: once answered (or skipped), always write the cases.
          askFirst: !answers && args['skipQuestions'] !== true,
          spoken: true,
          ...(isCoverage(args['coverage']) && { coverage: args['coverage'] }),
          ...(isFormat(args['format']) && { format: args['format'] }),
        });
        if (out.kind === 'questions') {
          return {
            message: 'The AI needs answers before writing the cases.',
            data: { questions: out.questions },
          };
        }
        setProposals(out.cases);
        setChosen(new Set(out.cases.map((_, i) => i)));
        setUsage(out.skills);
        return {
          message: `${plural(out.cases.length, 'test case')} proposed and shown for review; none saved yet.`,
          data: { titles: out.cases.map((c) => c.title), skills: out.skills?.applied ?? [] },
        };
      } catch (e) {
        setError(errorMessage(e));
        return { message: errorMessage(e) };
      } finally {
        setBusy('');
      }
    },
  });
  useVoiceAction({
    name: 'cases.save',
    description:
      'Save the proposed test cases after the user confirmed. Args: only (optional list of card numbers starting at 1, to save just those).',
    run: async (args) => {
      // Checked first: while AI is not set up the panel renders the setup notice and `save` does not exist.
      if (status && !status.ready) return { message: status.reason ?? 'AI is not set up.' };
      const only = Array.isArray(args['only'])
        ? new Set(
            args['only'].map((n) => Number(n) - 1).filter((i) => i >= 0 && i < proposals.length),
          )
        : undefined;
      const pick = only ?? chosen;
      if (proposals.length === 0 || pick.size === 0)
        return { message: 'There are no proposed cases to save.' };
      await save(pick);
      return { message: `Saved ${plural(pick.size, 'test case')} under ${targetLabel}.` };
    },
  });

  if (status && !status.ready) {
    return (
      <Alert
        tone="info"
        title="Set up an AI provider to generate test cases"
        actions={
          <a className="button-link" href={href('settings', 'ai')}>
            Open AI settings
          </a>
        }
      >
        {status.reason ?? 'Choose Anthropic or Gemini and add a key in Settings › AI.'}
      </Alert>
    );
  }

  const propose = async () => {
    setBusy('propose');
    setError('');
    try {
      const { cases: p, skills: used } = await proposeCases(prompt.trim(), target.projectId);
      setProposals(p);
      setChosen(new Set(p.map((_, i) => i)));
      setUsage(used);
      if (p.length === 0) setError('The AI proposed nothing. Describe the feature in more detail.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const save = async (pick: Set<number> = chosen) => {
    setBusy('save');
    try {
      const picked = proposals.filter((_, i) => pick.has(i));
      const made = await addProposedCases(picked, {
        ...(target.projectId && { projectId: target.projectId }),
        ...(target.testSuiteId && { testSuiteId: target.testSuiteId }),
        ...(target.projectVersionId && { projectVersionId: target.projectVersionId }),
      });
      const ids = made.map((m) => m.id);
      setSaved(made);
      setProposals([]);
      setChosen(new Set());
      if (writeSteps && ids.length > 0) {
        const j = await startDrafts(ids);
        setJobId(j.id);
        jobs.reload();
        toast.show(`Saved ${plural(ids.length, 'test case')}. The AI is writing their steps…`, {
          tone: 'info',
        });
      } else {
        toast.show(`Saved ${plural(ids.length, 'test case')}.`);
      }
      onSaved?.(ids);
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  /** Put `/name` at the start of the prompt, once. Detecting and applying it stays the server's job. */
  const insertSkill = (name: string) =>
    setPrompt((text) =>
      text.split(/\s+/).includes(`/${name}`) ? text : `/${name} ${text.trimStart()}`,
    );
  const savedSkills = skills.data ?? [];

  const edit = (i: number, patch: Partial<ProposedCase>) =>
    setProposals((list) => list.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const toggle = (i: number) => {
    const next = new Set(chosen);
    if (!next.delete(i)) next.add(i);
    setChosen(next);
  };

  return (
    <div className={styles.panel}>
      {/* 1. The prompt, first. */}
      <section className={styles.composer} aria-label="Describe what to test">
        <Field
          label="What should be tested?"
          hint="Describe a feature or flow in a sentence or two. The AI writes test cases a browser can run, using your app's page names. Type /skill-name to apply a saved skill."
        >
          {(p) => (
            <TextArea
              {...p}
              rows={4}
              value={prompt}
              maxLength={4000}
              placeholder={EXAMPLES[0]}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim().length >= 10)
                  void propose();
              }}
            />
          )}
        </Field>
        <div className={styles.examples} aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className={styles.chip} onClick={() => setPrompt(ex)}>
              <Icon name="sparkle" size={12} /> {ex.split(',')[0]}
            </button>
          ))}
        </div>
        {!skills.error && (
          <div className={styles.skills} aria-label="Skills">
            <span className={styles.sub}>Skills:</span>
            {savedSkills.map((s) => (
              <button
                key={s.name}
                type="button"
                className={styles.chip}
                title={s.description}
                aria-label={`Use skill /${s.name}: ${s.description}`}
                onClick={() => insertSkill(s.name)}
              >
                /{s.name}
              </button>
            ))}
            <Button size="sm" variant="ghost" icon="settings" onClick={() => setManaging(true)}>
              {savedSkills.length === 0 ? 'Save a skill' : 'Manage skills'}
            </Button>
          </div>
        )}
        {targetControls}
        <div className={styles.composerFoot}>
          <Checkbox
            label="Write runnable steps after saving"
            hint="The AI turns each saved case into steps from the step catalog; you review them before they run."
            checked={writeSteps}
            onChange={(e) => setWriteSteps(e.target.checked)}
          />
          <Button
            variant="primary"
            icon="sparkle"
            loading={busy === 'propose'}
            disabled={prompt.trim().length < 10}
            onClick={() => void propose()}
          >
            Generate test cases
          </Button>
        </div>
      </section>

      {error && <Alert tone="warning">{error}</Alert>}
      {usage && usage.unknown.length > 0 && proposals.length > 0 && (
        <Alert tone="info">
          {usage.unknown.map((n) => `/${n}`).join(', ')}{' '}
          {usage.unknown.length === 1
            ? 'is not a saved skill, so it was'
            : 'are not saved skills, so they were'}{' '}
          read as plain text.
        </Alert>
      )}

      {/* 2. Proposals as cards. */}
      {proposals.length > 0 && (
        <section aria-label="Proposed test cases" className={styles.results}>
          <div className={styles.resultsHead}>
            <div>
              <h3 className={styles.resultsTitle}>
                {plural(proposals.length, 'proposed test case')} · {chosen.size} selected
              </h3>
              <p className={styles.sub}>Not saved yet. They will be filed under {targetLabel}.</p>
              {usage && usage.applied.length > 0 && (
                <p className={styles.sub}>
                  Skills applied:{' '}
                  {usage.applied.map((n) => (
                    <Badge key={n} tone="info">
                      /{n}
                    </Badge>
                  ))}
                </p>
              )}
            </div>
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setChosen(
                    chosen.size === proposals.length
                      ? new Set()
                      : new Set(proposals.map((_, i) => i)),
                  )
                }
              >
                {chosen.size === proposals.length ? 'Select none' : 'Select all'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProposals([])}>
                Discard
              </Button>
              <Button
                variant="primary"
                icon="check"
                loading={busy === 'save'}
                disabled={chosen.size === 0}
                onClick={() => void save()}
              >
                Save selected ({chosen.size})
              </Button>
            </div>
          </div>
          <ul className={styles.grid}>
            {proposals.map((p, i) => (
              <li
                key={i}
                className={chosen.has(i) ? `${styles.card} ${styles.picked}` : styles.card}
              >
                <div className={styles.cardHead}>
                  <Checkbox
                    aria-label={`Keep "${p.title}"`}
                    checked={chosen.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <span className={styles.cardNo}>#{i + 1}</span>
                  {p.priority && (
                    <Badge
                      tone={
                        p.priority === 'High'
                          ? 'danger'
                          : p.priority === 'Medium'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {p.priority}
                    </Badge>
                  )}
                  {p.module && <span className={styles.sub}>{p.module}</span>}
                </div>
                <TextInput
                  aria-label={`Title of proposal ${i + 1}`}
                  value={p.title}
                  onChange={(e) => edit(i, { title: e.target.value })}
                />
                {p.preconditions && <p className={styles.sub}>Before: {p.preconditions}</p>}
                <ol className={styles.steps}>
                  {p.steps.map((s, n) => (
                    <li key={n}>{s}</li>
                  ))}
                </ol>
                <p className={styles.expected}>
                  <Icon name="check" size={14} /> {p.expectedResult}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. What happened to the saved cases. */}
      {saved.length > 0 && proposals.length === 0 && (
        <section aria-label="Saved test cases" className={styles.results}>
          <div className={styles.resultsHead}>
            <div>
              <h3 className={styles.resultsTitle}>Saved {plural(saved.length, 'test case')}</h3>
              <p className={styles.sub}>
                {jobId
                  ? job?.status === 'running'
                    ? `Writing steps… ${job.done} of ${job.total}`
                    : 'Steps written. Review and mark them ready on Test Case Studio.'
                  : 'Write their steps from Test Case Studio when you are ready.'}
              </p>
            </div>
            <a className="button-link" href={href('design')}>
              Review on Test Case Studio
            </a>
          </div>
          <ul className={styles.grid}>
            {saved.map((s) => {
              const r = resultOf.get(s.id);
              const o = r ? OUTCOME[r.outcome] : undefined;
              return (
                <li key={s.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <code>{s.id}</code>
                    {o ? (
                      <StatusBadge status={o.status} label={o.label} />
                    ) : jobId ? (
                      <StatusBadge status="running" label="Writing steps" />
                    ) : (
                      <StatusBadge status="none" label="No steps yet" />
                    )}
                  </div>
                  <strong>{s.title}</strong>
                  {r?.message && <p className={styles.sub}>{r.message}</p>}
                  {o?.hint && <p className={styles.hint}>{o.hint}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {managing && (
        <SkillsDialog
          skills={savedSkills}
          onClose={() => setManaging(false)}
          onChanged={skills.reload}
        />
      )}

      {proposals.length === 0 && saved.length === 0 && !error && busy !== 'propose' && (
        <EmptyState icon="sparkle" title="Proposed test cases appear here">
          Review and edit them before saving. Only the ones you select are added.
        </EmptyState>
      )}
    </div>
  );
}
