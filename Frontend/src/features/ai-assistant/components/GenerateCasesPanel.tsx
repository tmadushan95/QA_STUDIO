/**
 * GenerateCasesPanel: describe what to test → review the proposed test cases as cards → save the chosen ones →
 * the AI writes their runnable steps, with each card showing how that went.
 *
 * - Laid out like a chat app: the conversation (each request as a message, the AI's reply as a card for its result)
 *   fills the column and the prompt box sits at its foot. When `docked`, the panel fills the window below its top
 *   edge, so the prompt box stays at the bottom of the screen and the conversation scrolls above it.
 * - The prompt box grows with its text (up to a cap, then scrolls). Its bottom edge holds the skills menu, coverage
 *   and a round send button. Enter sends and clears the box, Shift+Enter adds a line.
 * - Results open in a side panel to the right of the conversation, which can be closed and reopened from the reply
 *   card. Where there is no room beside it, the panel takes the column's place (docked) or stacks under it.
 *   Where to file the cases and whether the AI writes their steps are chosen in the panel's save bar, at save time.
 * - Nothing is stored until "Save selected": trying prompts never fills the database.
 * - Saved cases are filed under the given target (project › version › suite) and, unless switched off, the AI writes
 *   their steps from the platform's step catalog and the project's page names. A case it can only partly automate
 *   gets a draft plus a "check by hand" note instead of a refusal.
 *
 * - Coverage (smoke, standard, thorough) sets how far the AI goes through its checklist (functional, negative,
 *   permission, validation, boundary, UI, accessibility, error handling). Each card shows its category, and the bar
 *   above the cards shows which categories are covered and which are not.
 * - `/skill-name` in the prompt applies a saved skill (its instructions shape the cases); the server resolves it, and
 *   the panel shows which skills were applied and which `/words` matched none.
 *
 * Used on the AI Assistant page (docked, with its own version and suite choice) and on Test Case Studio (with the
 * page's work context).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Icon,
  IconButton,
  Menu,
  Select,
  Spinner,
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
  CASE_CATEGORIES,
  type CaseCategory,
  type ProposeOptions,
  type ProposedCase,
  type SkillUsage,
} from '../api.js';
import { OUTCOME } from '../outcomes.js';
import {
  ageGroup,
  deleteSession,
  listSessions,
  newSession,
  putSession,
  readActiveId,
  titleFrom,
  updateSession,
  writeActiveId,
  type ChatSession,
  type ChatTurn,
  type SavedCase,
} from '../chatSessions.js';
import {
  ACCEPT,
  FileRefused,
  MAX_FILES,
  readPromptFile,
  sizeLabel,
  type PromptFile,
} from '../promptFiles.js';
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
  /** Where-to-file controls (such as version and suite), shown in the save bar so the choice is made at save time. */
  targetControls?: JSX.Element;
  /**
   * Fill the window from the panel's top edge down, with the prompt box at the bottom of the screen, like a chat app.
   * For a page whose main content is this panel; inside a dialog leave it off and the panel takes its natural height.
   */
  docked?: boolean;
  onSaved?: (ids: string[]) => void;
}

/** Example prompts, with the short label their chip shows. */
const EXAMPLES = [
  {
    label: 'Sign in and reset a password',
    text: 'Sign in with a valid and an invalid password, and reset a forgotten password.',
  },
  {
    label: 'Create, edit and delete a draft',
    text: 'Create, edit and delete a draft project, checking the list after each change.',
  },
  {
    label: 'Approve and reject as an approver',
    text: 'Approve and reject a request as an approver, and check a viewer cannot approve.',
  },
];

type Coverage = NonNullable<ProposeOptions['coverage']>;

/** How widely the AI covers a description; "thorough" goes through the whole checklist, UI and accessibility included. */
const COVERAGE_CHOICES: { value: Coverage; label: string }[] = [
  { value: 'smoke', label: 'Smoke (1–3 cases)' },
  { value: 'standard', label: 'Standard' },
  { value: 'thorough', label: 'Thorough (incl. UI, accessibility)' },
];

/**
 * Which checklist categories the proposals cover and how often, in checklist order, and which none covers. Shown over
 * the cards so a missing permission or UI case is obvious before saving.
 */
function coverageOf(proposals: ProposedCase[]) {
  const counts = new Map<CaseCategory, number>();
  for (const p of proposals)
    if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const all = Object.keys(CASE_CATEGORIES) as CaseCategory[];
  return {
    covered: all.filter((c) => counts.has(c)).map((c) => ({ category: c, count: counts.get(c)! })),
    missing: all.filter((c) => !counts.has(c)),
  };
}

/** A skill's menu entry: its name, and as much of its description as fits on one line. */
const skillLabel = (name: string, description: string) =>
  `/${name} · ${description.length > 48 ? `${description.slice(0, 47)}…` : description}`;

/** What a chat view reports back to be stored; the shell adds the title and the time. */
type SessionContent = Omit<ChatSession, 'title' | 'updatedAt'>;

/** Props of `ChatView`: the panel's props plus the session it shows and how it reports changes. */
interface ChatViewProps extends Omit<GenerateCasesPanelProps, 'status'> {
  status: AiStatus | undefined;
  session: ChatSession;
  /** The bar above the conversation (sessions toggle, title, new chat), drawn by the shell. */
  header: JSX.Element;
  onChange: (content: SessionContent) => void;
  /** A request finished after its session was left: store its result there instead of on screen. */
  onLateResult: (id: string, change: (s: ChatSession) => ChatSession) => void;
  /** Whether the results panel is open, so the shell can make room for it. */
  onPanelChange: (shown: boolean) => void;
}

/**
 * One session's conversation and results: prompt → cards → save → steps. Mounted per session (keyed by its id), so
 * switching sessions starts from that session's stored state.
 */
function ChatView({
  status,
  target,
  targetLabel,
  targetControls,
  docked = false,
  onSaved,
  session,
  header,
  onChange,
  onLateResult,
  onPanelChange,
}: ChatViewProps) {
  const toast = useToast();
  const [prompt, setPrompt] = useState(session.prompt);
  const [turns, setTurns] = useState<ChatTurn[]>(session.turns);
  const [proposals, setProposals] = useState<ProposedCase[]>(session.proposals);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(session.chosen));
  const [writeSteps, setWriteSteps] = useState(true);
  const [coverage, setCoverage] = useState<Coverage>(session.coverage ?? 'standard');
  const [busy, setBusy] = useState<'' | 'propose' | 'save'>('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedCase[]>(session.saved ?? []);
  const [jobId, setJobId] = useState<string | undefined>(session.jobId);
  const [usage, setUsage] = useState<SkillUsage | undefined>(session.usage);
  const [managing, setManaging] = useState(false);
  // Files attached to the next request; only their names are kept in the conversation once sent.
  const [files, setFiles] = useState<PromptFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const hintId = useId();

  /** Read and add files (picked, pasted or dropped), up to the limit; each one that cannot be used says why. */
  const attach = async (list: Iterable<File>) => {
    const incoming = [...list];
    const room = MAX_FILES - files.length;
    if (incoming.length > room)
      toast.show(`Attach up to ${MAX_FILES} files per request.`, { tone: 'info' });
    const read = await Promise.allSettled(incoming.slice(0, Math.max(room, 0)).map(readPromptFile));
    const ok: PromptFile[] = [];
    for (const r of read) {
      if (r.status === 'fulfilled') ok.push(r.value);
      else
        toast.show(
          r.reason instanceof FileRefused ? r.reason.message : 'A file could not be read.',
          {
            tone: 'danger',
          },
        );
    }
    if (ok.length > 0) setFiles((now) => [...now, ...ok].slice(0, MAX_FILES));
  };
  const detach = (key: string) =>
    setFiles((now) =>
      now.filter((f) => {
        if (f.key === key && f.preview) URL.revokeObjectURL(f.preview);
        return f.key !== key;
      }),
    );

  // Report every change so the session is stored as it is on screen. What was last reported is remembered, so a run
  // that changes nothing (the state just loaded, or StrictMode running the effect twice) reports nothing: it would only
  // move this session to the top of the list, or store a copy older than the one in storage.
  const reported = useRef<string>();
  useEffect(() => {
    const content: SessionContent = {
      id: session.id,
      prompt,
      turns,
      proposals,
      chosen: [...chosen],
      usage,
      coverage,
      ...(saved.length > 0 && { saved }),
      ...(jobId && { jobId }),
    };
    const json = JSON.stringify(content);
    const first = reported.current === undefined;
    if (json === reported.current) return;
    reported.current = json;
    if (!first) onChange(content);
  }, [prompt, turns, proposals, chosen, usage, coverage, saved, jobId]);

  // A request may finish after its session was left; its result then goes to storage, not to this unmounted view.
  // Set on every mount, since StrictMode unmounts and mounts again once in development.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const hasProposals = proposals.length > 0;
  // A worker without skills (older build) answers 404: the panel then works exactly as before, with no skills menu.
  const skills = useResource(fetchSkills);
  const jobs = useResource(fetchDraftJobs);
  useLive((e) => e.type === 'job' && jobs.reload());
  const job: DraftJob | undefined = jobs.data?.find((j) => j.id === jobId);
  const resultOf = useMemo(() => new Map((job?.results ?? []).map((r) => [r.caseId, r])), [job]);
  // The side panel opens by itself whenever there is something new to show (a request starting, proposals, saved
  // cases); closing it only hides it, and the reply card in the conversation opens it again.
  const [panelOpen, setPanelOpen] = useState(true);
  const hasResult = proposals.length > 0 || saved.length > 0 || busy === 'propose';
  useEffect(() => {
    if (busy === 'propose' || proposals.length > 0 || saved.length > 0) setPanelOpen(true);
  }, [busy === 'propose', proposals.length > 0, saved.length > 0]);

  // Not docked, the panel can stack under the conversation (narrow container): bring it into view instead of leaving
  // it below the fold. Side by side, or docked, it is already in view, so nothing moves.
  const output = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = output.current;
    if (docked || !el || proposals.length === 0) return;
    if (el.getBoundingClientRect().top > window.innerHeight * 0.6) {
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    }
  }, [proposals.length > 0]);

  // The conversation follows its newest message, as a chat does.
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy, error]);

  // The prompt grows with its text, like a chat box: reset to one row, then take the content's height up to the cap
  // set in CSS (max-height), past which it scrolls. Runs on every change, including examples and skills put in.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  /** What the reply card says, mirroring what the side panel holds. */
  const summary =
    busy === 'propose'
      ? {
          title: 'Writing test cases…',
          detail: "Reading your description and the app's page names",
        }
      : proposals.length > 0
        ? {
            title: plural(proposals.length, 'proposed test case'),
            detail: `${chosen.size} selected · not saved yet`,
          }
        : saved.length > 0
          ? {
              title: `Saved ${plural(saved.length, 'test case')}`,
              detail: jobId
                ? job?.status === 'running'
                  ? `Writing steps… ${job.done} of ${job.total}`
                  : 'Steps written, ready to review'
                : 'No steps yet',
            }
          : undefined;

  /**
   * Adds a request to the conversation and starts it. The previous reply's live card is replaced by a one-line note of
   * what it gave, since its result leaves the panel for the new one.
   */
  const ask = (text: string, attached: PromptFile[] = []) => {
    const note = error || summary?.title;
    setTurns((list) => [
      ...list.map((t, i) => (i === list.length - 1 && !t.note && note ? { ...t, note } : t)),
      { prompt: text, ...(attached.length > 0 && { files: attached.map((f) => f.name) }) },
    ]);
    setBusy('propose');
    setError('');
  };

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
      ask(text);
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

  /** Sends what is in the box, as a chat does: the text becomes a message and the box empties for the next one. */
  const propose = async () => {
    const text = prompt.trim();
    const sent = files;
    ask(text, sent);
    setPrompt('');
    setFiles([]);
    try {
      const { cases: p, skills: used } = await proposeCases(
        text,
        target.projectId,
        { coverage },
        sent,
      );
      sent.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      if (!alive.current) {
        onLateResult(session.id, (s) => ({
          ...s,
          proposals: p,
          chosen: p.map((_, i) => i),
          usage: used,
        }));
        return;
      }
      setProposals(p);
      setChosen(new Set(p.map((_, i) => i)));
      setUsage(used);
      if (p.length === 0) setError('The AI proposed nothing. Describe the feature in more detail.');
    } catch (e) {
      setError(errorMessage(e));
      // Nothing came back, so the request (and its files) goes back in the box to fix or resend, unless something new
      // was typed or attached meanwhile.
      setPrompt((now) => now || text);
      setFiles((now) => (now.length > 0 ? now : sent));
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
  const insertSkill = (name: string) => {
    setPrompt((text) =>
      text.split(/\s+/).includes(`/${name}`) ? text : `/${name} ${text.trimStart()}`,
    );
    promptRef.current?.focus();
  };
  const savedSkills = skills.data ?? [];
  /** Before the first request the conversation shows a greeting and examples instead. */
  const started = turns.length > 0 || hasResult || !!error;
  const panelShown = panelOpen && hasResult;
  useEffect(() => onPanelChange(panelShown), [panelShown]);
  const canGenerate = prompt.trim().length >= 10 && busy !== 'propose';
  const { covered, missing } = coverageOf(proposals);

  const edit = (i: number, patch: Partial<ProposedCase>) =>
    setProposals((list) => list.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const toggle = (i: number) => {
    const next = new Set(chosen);
    if (!next.delete(i)) next.add(i);
    setChosen(next);
  };

  return (
    <div className={styles.main}>
      <div
        className={styles.workspace}
        data-docked={docked || undefined}
        data-panel={panelShown || undefined}
      >
        {/* The conversation column: messages on top, the prompt box at its foot. */}
        <div className={styles.chat}>
          {header}
          <div ref={thread} className={styles.thread} aria-live="polite">
            {!started && (
              <div className={styles.greeting}>
                <span className={styles.greetingMark} aria-hidden="true">
                  <Icon name="sparkle" size={22} />
                </span>
                <h3 className={styles.greetingTitle}>What should be tested?</h3>
                <p className={styles.sub}>
                  Describe a feature or flow in a sentence or two, using your app&apos;s page names.
                  The cases are only saved when you choose to.
                </p>
                <div className={styles.examples} aria-label="Examples">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      className={styles.example}
                      title={ex.text}
                      onClick={() => {
                        setPrompt(ex.text);
                        promptRef.current?.focus();
                      }}
                    >
                      <Icon name="sparkle" size={14} />
                      <span>{ex.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={styles.exchange}>
                <div className={styles.userMessage}>
                  {t.files && t.files.length > 0 && (
                    <ul className={styles.sentFiles} aria-label="Attached files">
                      {t.files.map((name, n) => (
                        <li key={n}>
                          <Icon name="file" size={12} /> {name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>{t.prompt}</p>
                </div>
                {t.note && (
                  <div className={styles.turn}>
                    <span className={styles.avatar} aria-hidden="true">
                      <Icon name="sparkle" size={14} />
                    </span>
                    <p className={styles.note}>{t.note}</p>
                  </div>
                )}
              </div>
            ))}

            {(summary || error || (usage && usage.unknown.length > 0 && hasProposals)) && (
              <div className={styles.turn}>
                <span className={styles.avatar} aria-hidden="true">
                  <Icon name="sparkle" size={14} />
                </span>
                <div className={styles.turnBody}>
                  {error && <Alert tone="warning">{error}</Alert>}
                  {usage && usage.unknown.length > 0 && hasProposals && (
                    <Alert tone="info">
                      {usage.unknown.map((n) => `/${n}`).join(', ')}{' '}
                      {usage.unknown.length === 1
                        ? 'is not a saved skill, so it was'
                        : 'are not saved skills, so they were'}{' '}
                      read as plain text.
                    </Alert>
                  )}
                  {summary && (
                    <button
                      type="button"
                      className={styles.resultCard}
                      data-active={panelShown || undefined}
                      aria-expanded={panelShown}
                      aria-controls={panelId}
                      onClick={() => setPanelOpen((open) => !open)}
                    >
                      <span className={styles.resultIcon} aria-hidden="true">
                        {busy === 'propose' ? (
                          <Spinner size={16} />
                        ) : (
                          <Icon name="cases" size={18} />
                        )}
                      </span>
                      <span className={styles.resultText}>
                        <strong>{summary.title}</strong>
                        <span className={styles.sub}>{summary.detail}</span>
                      </span>
                      <span className={styles.resultAction}>{panelShown ? 'Hide' : 'Open'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* The prompt box: grows with its text; skills, coverage and send on its bottom edge. */}
          <section className={styles.composer} aria-label="Describe what to test">
            <div
              className={styles.promptBox}
              data-dragging={dragging || undefined}
              // Files dropped anywhere on the box are attached, as in a chat app.
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files.length === 0) return;
                e.preventDefault();
                setDragging(false);
                void attach(e.dataTransfer.files);
              }}
            >
              {files.length > 0 && (
                <ul className={styles.fileChips} aria-label="Files to send">
                  {files.map((f) => (
                    <li key={f.key} className={styles.fileChip}>
                      {f.preview ? (
                        <img src={f.preview} alt="" className={styles.fileThumb} />
                      ) : (
                        <span className={styles.fileIcon} aria-hidden="true">
                          <Icon name="file" size={16} />
                        </span>
                      )}
                      <span className={styles.fileText}>
                        <span className={styles.fileName} title={f.name}>
                          {f.name}
                        </span>
                        <span className={styles.sub}>
                          {f.mediaType === 'application/pdf'
                            ? 'PDF'
                            : f.mediaType === 'text/plain'
                              ? 'Text'
                              : 'Image'}{' '}
                          · {sizeLabel(f.size)}
                        </span>
                      </span>
                      <IconButton
                        icon="close"
                        label={`Remove ${f.name}`}
                        className={styles.fileRemove}
                        onClick={() => detach(f.key)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <TextArea
                ref={promptRef}
                aria-label="What should be tested?"
                aria-describedby={hintId}
                className={styles.promptInput}
                rows={1}
                value={prompt}
                maxLength={4000}
                placeholder={
                  started ? 'Ask for more test cases, or refine the request…' : EXAMPLES[0]!.text
                }
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter breaks the line (Ctrl/Cmd+Enter still sends); never mid-IME composition.
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (canGenerate) void propose();
                }}
                onPaste={(e) => {
                  // A pasted screenshot becomes an attachment; pasted text goes in as usual.
                  const pasted = [...e.clipboardData.files];
                  if (pasted.length === 0) return;
                  e.preventDefault();
                  void attach(pasted);
                }}
              />
              <div className={styles.promptBar}>
                <IconButton
                  icon="attach"
                  label="Attach screenshots or files"
                  title="Attach screenshots or files (images, PDF, text). You can also paste or drop them."
                  disabled={files.length >= MAX_FILES}
                  onClick={() => filePicker.current?.click()}
                />
                <input
                  ref={filePicker}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    if (e.target.files) void attach(e.target.files);
                    e.target.value = '';
                  }}
                />
                {!skills.error && (
                  <Menu
                    label="Skills"
                    triggerLabel="Skills"
                    items={[
                      ...savedSkills.map((s) => ({
                        label: skillLabel(s.name, s.description),
                        onSelect: () => insertSkill(s.name),
                      })),
                      {
                        label: savedSkills.length === 0 ? 'Save a skill…' : 'Manage skills…',
                        icon: 'settings' as const,
                        onSelect: () => setManaging(true),
                      },
                    ]}
                  />
                )}
                <Select
                  aria-label="Coverage"
                  className={styles.coverageSelect}
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value as Coverage)}
                >
                  {COVERAGE_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <span id={hintId} className={styles.keyHint}>
                  <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
                </span>
                <Button
                  variant="primary"
                  icon="send"
                  className={styles.send}
                  aria-label="Generate test cases"
                  title="Generate test cases"
                  loading={busy === 'propose'}
                  disabled={prompt.trim().length < 10}
                  onClick={() => void propose()}
                />
              </div>
            </div>
            <p className={styles.disclaimer}>
              AI can make mistakes. Review every case before you save it.
            </p>
          </section>
        </div>

        {/* The side panel: what the AI produced, beside the conversation like an open document. */}
        {panelShown && (
          <div id={panelId} ref={output} className={styles.side}>
            <div className={styles.sideHead}>
              <span className={styles.sideTitle}>
                <Icon name="cases" size={16} /> Test cases
              </span>
              <span className={styles.sideWhere} title={targetLabel}>
                {targetLabel}
              </span>
              <IconButton icon="close" label="Close panel" onClick={() => setPanelOpen(false)} />
            </div>
            {/*
              The save bar, fixed under the title: where to file the proposals, whether the AI writes their steps, and
              Save. Above the cards rather than below, so the cards get the panel's whole remaining height.
            */}
            {hasProposals && (
              <div className={styles.saveBar} role="group" aria-label="Save the selected cases">
                {targetControls && (
                  <div className={styles.saveWhere} role="group" aria-label="Where to save">
                    {targetControls}
                  </div>
                )}
                <div className={styles.saveRow}>
                  <label
                    className={styles.stepsToggle}
                    title="The AI turns each saved case into steps from the step catalog; you review them before they run."
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      className={styles.switch}
                      checked={writeSteps}
                      onChange={(e) => setWriteSteps(e.target.checked)}
                    />
                    <span>Write runnable steps</span>
                  </label>
                  <div className={styles.actions}>
                    <Button size="sm" variant="ghost" onClick={() => setProposals([])}>
                      Discard
                    </Button>
                    <Button
                      size="sm"
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
              </div>
            )}
            <div className={styles.sideBody}>
              {/* Proposals as cards. */}
              {proposals.length > 0 && (
                <section aria-label="Proposed test cases" className={styles.results}>
                  <div className={styles.resultsHead}>
                    <div>
                      <h3 className={styles.resultsTitle}>
                        {plural(proposals.length, 'proposed test case')} · {chosen.size} selected
                      </h3>
                      <p className={styles.sub}>
                        Not saved yet. They stay here while you visit other pages, until you save or
                        discard them.
                      </p>
                      {covered.length > 0 && (
                        <p className={styles.sub}>
                          Covers:{' '}
                          {covered.map(({ category, count }) => (
                            <Badge key={category} tone="info">
                              {CASE_CATEGORIES[category]} {count}
                            </Badge>
                          ))}
                          {missing.length > 0 && (
                            <> · Not covered: {missing.map((c) => CASE_CATEGORIES[c]).join(', ')}</>
                          )}
                        </p>
                      )}
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
                          {p.category && <Badge tone="info">{CASE_CATEGORIES[p.category]}</Badge>}
                          {p.manualCheck && <Badge tone="neutral">Check by eye</Badge>}
                          {p.module && <span className={styles.sub}>{p.module}</span>}
                        </div>
                        {/* Two lines, so a long title shows in full; a title stays one line when saved. */}
                        <TextArea
                          aria-label={`Title of proposal ${i + 1}`}
                          className={styles.titleBox}
                          rows={2}
                          value={p.title}
                          onChange={(e) =>
                            edit(i, { title: e.target.value.replace(/\s*\n\s*/g, ' ') })
                          }
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

              {/* What happened to the saved cases. */}
              {saved.length > 0 && proposals.length === 0 && (
                <section aria-label="Saved test cases" className={styles.results}>
                  <div className={styles.resultsHead}>
                    <div>
                      <h3 className={styles.resultsTitle}>
                        Saved {plural(saved.length, 'test case')}
                      </h3>
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

              {busy === 'propose' && proposals.length === 0 && (
                <div className={styles.writing} role="status">
                  <p className={styles.sub}>
                    <Spinner size={12} /> Writing test cases…
                  </p>
                  {[0, 1, 2].map((n) => (
                    <div key={n} className={styles.skeleton} aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {managing && (
        <SkillsDialog
          skills={savedSkills}
          onClose={() => setManaging(false)}
          onChanged={skills.reload}
        />
      )}
    </div>
  );
}

/** "2:15 PM" for today, "Nov 12" otherwise: enough to tell sessions apart in the list. */
const whenLabel = (at: number) =>
  ageGroup(at) === 'Today'
    ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** What a session holds, in a few words, for its line in the list. */
const contentLabel = (s: ChatSession) =>
  s.proposals.length > 0
    ? plural(s.proposals.length, 'proposed case')
    : s.saved?.length
      ? `${plural(s.saved.length, 'case')} saved`
      : plural(s.turns.length, 'request');

/**
 * Prompt → cards → save → steps, in chat sessions people can come back to, as in a chat app: a sessions list beside the
 * conversation (new chat, switch, rename, delete) and the active session's conversation and results.
 */
export function GenerateCasesPanel(props: GenerateCasesPanelProps) {
  const { status, target, docked = false } = props;
  const projectId = target.projectId;
  const [sessions, setSessions] = useState<ChatSession[]>(() => listSessions(projectId));
  // The session open in this browser tab; undefined shows `fresh`, a new chat that is stored once it has content.
  const [activeId, setActiveId] = useState<string | undefined>(() => {
    const id = readActiveId(projectId);
    return id && sessions.some((s) => s.id === id) ? id : undefined;
  });
  const [fresh, setFresh] = useState<ChatSession>(newSession);
  /** Bumped to reload the open session from storage (a result that landed while it was left). */
  const [revision, setRevision] = useState(0);
  // 'auto' shows the list when there is room and no results panel; the toggle pins it open or closed.
  const [rail, setRail] = useState<'auto' | 'open' | 'closed'>('auto');
  const [panelShown, setPanelShown] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<ChatSession>();
  const shell = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const railId = useId();

  // A new chat, once stored, is read back from the list, so a reload of the view never starts from its empty copy.
  const active = sessions.find((s) => s.id === (activeId ?? fresh.id)) ?? fresh;
  const shown = sessions.find((s) => s.id === active.id) ?? active;
  useEffect(() => writeActiveId(projectId, active.id), [projectId, active.id]);

  // Another project has its own sessions: show its list and its last open session.
  const shownProject = useRef(projectId);
  useEffect(() => {
    if (shownProject.current === projectId) return;
    shownProject.current = projectId;
    const list = listSessions(projectId);
    const id = readActiveId(projectId);
    setSessions(list);
    setActiveId(id && list.some((s) => s.id === id) ? id : undefined);
    setFresh(newSession());
  }, [projectId]);

  // Docked: the shell ends at the bottom of the window. Its height comes from CSS; this only tells it where it starts
  // on the page, which moves when anything above it changes size (a notice appearing, the header wrapping).
  useLayoutEffect(() => {
    const el = shell.current;
    if (!docked || !el) return;
    const place = () =>
      el.style.setProperty(
        '--dock-top',
        `${Math.max(0, el.getBoundingClientRect().top + window.scrollY)}px`,
      );
    place();
    window.addEventListener('resize', place);
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    watch?.observe(document.body);
    return () => {
      window.removeEventListener('resize', place);
      watch?.disconnect();
    };
  }, [docked, status?.ready]);

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

  /** The list floats over the chat (narrow container), so picking from it should close it. */
  const railIsOverlay = () =>
    !!railRef.current && getComputedStyle(railRef.current).position === 'absolute';
  const railVisible = () =>
    !!railRef.current && getComputedStyle(railRef.current).display !== 'none';

  const focusPrompt = () =>
    requestAnimationFrame(() =>
      shell.current?.querySelector<HTMLTextAreaElement>('textarea[aria-describedby]')?.focus(),
    );
  const select = (id: string) => {
    if (railIsOverlay()) setRail('auto');
    setActiveId(id);
  };
  const newChat = () => {
    if (railIsOverlay()) setRail('auto');
    // An untouched chat is already new: reuse it rather than stacking empty ones.
    if (sessions.some((s) => s.id === active.id)) {
      setFresh(newSession());
      setActiveId(undefined);
    }
    focusPrompt();
  };
  const store = (content: SessionContent) => {
    const stored = listSessions(projectId).find((s) => s.id === content.id);
    // A renamed session keeps its name; otherwise its first request names it.
    const title =
      stored && stored.title !== 'New chat'
        ? stored.title
        : content.turns[0]
          ? titleFrom(content.turns[0].prompt)
          : 'New chat';
    setSessions(putSession(projectId, { ...content, title, updatedAt: Date.now() }));
  };
  const lateResult = (id: string, change: (s: ChatSession) => ChatSession) => {
    setSessions(updateSession(projectId, id, (s) => ({ ...change(s), updatedAt: Date.now() })));
    if (id === active.id) setRevision((n) => n + 1);
  };
  const rename = (id: string, title: string) => {
    setRenaming(undefined);
    const name = title.trim();
    if (name) setSessions(updateSession(projectId, id, (s) => ({ ...s, title: name })));
  };
  const remove = (s: ChatSession) => {
    setDeleting(undefined);
    setSessions(deleteSession(projectId, s.id));
    if (s.id === active.id) {
      setFresh(newSession());
      setActiveId(undefined);
    }
  };

  const groups = (['Today', 'Previous 7 days', 'Older'] as const)
    .map((name) => ({ name, items: sessions.filter((s) => ageGroup(s.updatedAt) === name) }))
    .filter((g) => g.items.length > 0);

  const header = (
    <div className={styles.chatHead}>
      <IconButton
        icon="sidebar"
        label="Chats"
        aria-controls={railId}
        onClick={() => setRail(railVisible() ? 'closed' : 'open')}
      />
      <span className={styles.chatTitle} title={shown.title}>
        {shown.title}
      </span>
      <Button size="sm" variant="ghost" icon="plus" onClick={newChat}>
        New chat
      </Button>
    </div>
  );

  return (
    <div className={styles.panel}>
      <div
        ref={shell}
        className={styles.shell}
        data-docked={docked || undefined}
        data-rail={rail}
        data-panel={panelShown || undefined}
      >
        <nav ref={railRef} id={railId} className={styles.rail} aria-label="Chats">
          <div className={styles.railHead}>
            <strong>Chats</strong>
            <IconButton icon="close" label="Close chats" onClick={() => setRail('closed')} />
          </div>
          <Button icon="plus" className={styles.newChat} onClick={newChat}>
            New chat
          </Button>
          <div className={styles.railList}>
            {groups.length === 0 && (
              <p className={styles.railEmpty}>
                Your chats appear here, so you can come back to their test cases.
              </p>
            )}
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h4 className={styles.railGroup}>{g.name}</h4>
                <ul className={styles.railItems}>
                  {g.items.map((s) => (
                    <li
                      key={s.id}
                      className={styles.railItem}
                      data-active={s.id === active.id || undefined}
                    >
                      {renaming === s.id ? (
                        <TextInput
                          aria-label="Chat name"
                          className={styles.railRename}
                          defaultValue={s.title}
                          maxLength={80}
                          autoFocus
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={(e) => rename(s.id, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') rename(s.id, e.currentTarget.value);
                            if (e.key === 'Escape') setRenaming(undefined);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.railLink}
                          aria-current={s.id === active.id ? 'true' : undefined}
                          onClick={() => select(s.id)}
                        >
                          <span className={styles.railTitle}>{s.title}</span>
                          <span className={styles.railMeta}>
                            {contentLabel(s)} · {whenLabel(s.updatedAt)}
                          </span>
                        </button>
                      )}
                      <Menu
                        label={`Actions for chat ${s.title}`}
                        items={[
                          { label: 'Rename', icon: 'design', onSelect: () => setRenaming(s.id) },
                          {
                            label: 'Delete',
                            icon: 'trash',
                            danger: true,
                            onSelect: () => setDeleting(s),
                          },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </nav>
        {/* Behind the list when it floats over the chat (narrow container): a click closes it. */}
        <div className={styles.scrim} aria-hidden="true" onClick={() => setRail('auto')} />

        <ChatView
          key={`${projectId ?? 'none'}:${active.id}:${revision}`}
          {...props}
          session={active}
          header={header}
          onChange={store}
          onLateResult={lateResult}
          onPanelChange={setPanelShown}
        />
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete this chat?"
          confirmLabel="Delete chat"
          danger
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(undefined)}
        >
          “{deleting.title}” and its unsaved proposals are removed from this browser. Test cases
          already saved stay in the project.
        </ConfirmDialog>
      )}
    </div>
  );
}
