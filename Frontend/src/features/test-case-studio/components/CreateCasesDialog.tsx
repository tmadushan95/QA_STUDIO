/**
 * CreateCasesDialog: the one entry point for new test cases. It asks two things, in order:
 *
 * 1. **Where** — the project (from the page's scope) and a version (required; the current one is preselected), plus an
 *    optional suite. Without a suite, imported and generated cases are filed by their module, as suites of this project.
 * 2. **How** — Excel, AI, by hand, or Azure DevOps. Excel and by-hand continue in their own forms with this destination;
 *    AI runs inside this dialog; Azure DevOps opens its page, where the same project and version are chosen.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Icon,
  Select,
  type IconName,
} from '../../../design-system/index.js';
import { href, navigate } from '../../../shared/hooks/useRoute.js';
import type { AiStatus } from '../../ai-assistant/api.js';
import { GenerateCasesPanel } from '../../ai-assistant/components/GenerateCasesPanel.js';
import type { Project, ProjectVersion, TestSuite } from '../../master-data/index.js';
import styles from './CreateCasesDialog.module.css';

/** Where new cases go. */
export interface Destination {
  projectId: number;
  projectVersionId: number;
  /** Absent: file by module (Excel, AI), or ask in the form (by hand). */
  testSuiteId?: number;
}

/** Props of `CreateCasesDialog`. */
export interface CreateCasesDialogProps {
  project: Project;
  versions: ProjectVersion[];
  suites: TestSuite[];
  /** The version chosen on the page (0 for "All versions"). */
  initialVersionId: number;
  ai: AiStatus | undefined;
  onClose: () => void;
  onExcel: (d: Destination) => void;
  onManual: (d: Destination) => void;
  /** AI cases were saved (the dialog stays open to show their step writing). */
  onAiSaved: () => void;
}

type Source = 'excel' | 'ai' | 'manual' | 'azure';

const SOURCES: { id: Source; icon: IconName; title: string; text: string }[] = [
  {
    id: 'excel',
    icon: 'upload',
    title: 'Import from Excel',
    text: 'Upload a workbook, check the preview, import the sheets you choose.',
  },
  {
    id: 'ai',
    icon: 'sparkle',
    title: 'Generate with AI',
    text: 'Describe a feature; pick from the proposed cases; the AI writes their steps.',
  },
  {
    id: 'manual',
    icon: 'design',
    title: 'Write by hand',
    text: 'Add one test case with its written steps.',
  },
  {
    id: 'azure',
    icon: 'cloud',
    title: 'From Azure DevOps',
    text: 'Import a test plan suite, or automate the whole flow.',
  },
];

/** Where and how to create test cases. */
export function CreateCasesDialog(p: CreateCasesDialogProps) {
  const own = p.versions.filter((v) => v.projectId === p.project.id && v.isActive);
  const projectSuites = p.suites.filter((s) => s.projectId === p.project.id && s.isActive);
  const [versionId, setVersionId] = useState(
    own.some((v) => v.id === p.initialVersionId)
      ? p.initialVersionId
      : ((own.find((v) => v.isCurrent) ?? own[0])?.id ?? 0),
  );
  const [suiteId, setSuiteId] = useState(0);
  const [source, setSource] = useState<Source>();
  const version = own.find((v) => v.id === versionId);
  const suite = projectSuites.find((s) => s.id === suiteId);
  const destination: Destination = {
    projectId: p.project.id,
    projectVersionId: versionId,
    ...(suiteId && { testSuiteId: suiteId }),
  };
  const where = `${p.project.name}${version ? ` · v${version.name}` : ''}${suite ? ` › ${suite.name}` : ''}`;

  const choose = (s: Source) => {
    if (s === 'excel') p.onExcel(destination);
    else if (s === 'manual') p.onManual(destination);
    else if (s === 'azure') navigate(href('azure-devops'));
    else setSource('ai');
  };

  return (
    <Dialog
      title={source === 'ai' ? 'Generate test cases with AI' : 'Create test cases'}
      subtitle={`Into ${where}`}
      size="lg"
      onClose={p.onClose}
      footer={
        source === 'ai' ? (
          <>
            <Button onClick={() => setSource(undefined)}>Back</Button>
            <Button onClick={p.onClose}>Done</Button>
          </>
        ) : (
          <Button onClick={p.onClose}>Cancel</Button>
        )
      }
    >
      {source === 'ai' ? (
        <GenerateCasesPanel
          status={p.ai}
          target={{
            projectId: p.project.id,
            projectVersionId: versionId,
            ...(suiteId && { testSuiteId: suiteId }),
          }}
          targetLabel={suite ? where : `${where}, a suite per module`}
          onSaved={p.onAiSaved}
        />
      ) : (
        <div className={styles.body}>
          <section className={styles.where} aria-label="Where the test cases go">
            <h3 className={styles.step}>
              <span>1</span> Where
            </h3>
            <div className={styles.whereGrid}>
              <div className={styles.fixed}>
                <span className={styles.fixedLabel}>Project</span>
                <strong>{p.project.name}</strong>
              </div>
              <Field
                label="Version"
                required
                hint={own.length === 0 ? undefined : 'New cases are written for this release.'}
              >
                {(f) => (
                  <Select
                    {...f}
                    value={versionId}
                    onChange={(e) => setVersionId(Number(e.target.value))}
                  >
                    {own.length === 0 && <option value={0}>No versions yet</option>}
                    {own.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.isCurrent ? ' (current)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Test suite"
                hint="Optional. Without one, cases are filed by their module."
              >
                {(f) => (
                  <Select
                    {...f}
                    value={suiteId}
                    onChange={(e) => setSuiteId(Number(e.target.value))}
                  >
                    <option value={0}>By module</option>
                    {projectSuites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {own.length === 0 && (
              <Alert tone="warning" title="This project has no version yet">
                Add one in{' '}
                <a href={href('project-settings', 'versions')}>Project settings › Versions</a>, then
                come back.
              </Alert>
            )}
          </section>

          <section aria-label="How to create them">
            <h3 className={styles.step}>
              <span>2</span> How
            </h3>
            <ul className={styles.sources}>
              {SOURCES.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={styles.source}
                    disabled={!versionId}
                    onClick={() => choose(s.id)}
                  >
                    <span className={styles.sourceIcon}>
                      <Icon name={s.icon} size={20} />
                    </span>
                    <span className={styles.sourceText}>
                      <strong>{s.title}</strong>
                      <span>{s.text}</span>
                    </span>
                    <Icon name="right" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Dialog>
  );
}
