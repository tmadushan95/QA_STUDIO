/**
 * One project's setup page: where its application runs, how runs sign in, and the test accounts they sign in as. All
 * on one page in the order a person sets them up, with a short progress strip on top saying what is still missing.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Icon,
  Panel,
  SaveBar,
  useToast,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { plural } from '../../shared/lib/format.js';
import {
  fetchAccounts,
  fetchConnections,
  fetchProjects,
  NEW_CONNECTION,
  saveConnection,
  setupOf,
  type ConnectionInput,
} from './api.js';
import { ApplicationFields, methodLabel, SignInFields } from './ConnectionFields.js';
import { ProjectAccounts } from './ProjectAccounts.js';
import { ProjectDialog } from './ProjectsSection.js';
import styles from './Projects.module.css';

/** The setup page of the project with this id. */
export function ProjectDetail({ id }: Readonly<{ id: number }>) {
  const toast = useToast();
  const projects = useResource(fetchProjects);
  const connections = useResource(fetchConnections);
  const accounts = useResource(fetchAccounts);
  useLive((e) => {
    if (e.type === 'data') projects.reload();
  });

  const project = projects.data?.find((p) => p.id === id);
  const saved = connections.data?.items.find((c) => c.projectId === id);
  const own = (accounts.data ?? []).filter((a) => a.projectId === id);

  const base: ConnectionInput = saved
    ? { envName: saved.envName, appUrl: saved.appUrl, login: saved.login }
    : NEW_CONNECTION;
  const baseJson = JSON.stringify(base);
  const [form, setForm] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // Follows what is stored, which arrives after the first render and changes on save; typing does not change it.
  useEffect(() => setForm(JSON.parse(baseJson) as ConnectionInput), [baseJson]);

  const failed = projects.error || connections.error || accounts.error;
  if (failed)
    return (
      <Alert tone="danger" title="This project could not be loaded">
        {failed}
      </Alert>
    );
  if (!projects.data || !connections.data || !accounts.data)
    return <EmptyState icon="refresh" title="Loading the project…" />;
  if (!project)
    return (
      <EmptyState icon="dashboard" title="No such project">
        It may have been deleted. <a href={href('home')}>See all projects</a>.
      </EmptyState>
    );

  const dirty = JSON.stringify(form) !== baseJson;
  const setup = setupOf(saved, own.length);
  const countOrPrompt = own.length > 0 ? plural(own.length, 'account') : 'Add at least one';
  const accountsDetail = saved?.login.strategy === 'none' ? 'Not needed' : countOrPrompt;
  const unsavedReason = dirty
    ? 'Save your changes first: a sign-in test uses what is saved.'
    : undefined;
  const blockedReason = saved
    ? unsavedReason
    : 'Save the application and sign-in above before testing an account.';

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await saveConnection(id, form);
      connections.reload();
      toast.show('Saved. It applies to the next run.');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h2 className={styles.pageTitle}>{project.name}</h2>
          <span className={styles.code}>
            <code>{project.code}</code> · {plural(project.suiteCount, 'test suite')} ·{' '}
            {plural(project.testCaseCount, 'test case')}
          </span>
        </div>
        <div className={styles.pageActions}>
          {setup.ready ? (
            <Badge tone="success" glyph="✓">
              Ready to run
            </Badge>
          ) : (
            <Badge tone="warning" glyph="!">
              Needs setup
            </Badge>
          )}
          <Button onClick={() => setEditing(true)}>Edit details</Button>
        </div>
      </div>

      <ol className={styles.steps} aria-label="Setup progress">
        <Step
          name="Application"
          done={setup.application}
          detail={
            saved?.reason ?? (saved ? `${saved.envName} · ${saved.appUrl}` : 'Add the address')
          }
        />
        <Step
          name="Sign-in"
          done={!!saved}
          detail={saved ? methodLabel(saved.login.strategy) : 'Choose a method'}
        />
        <Step name="Test accounts" done={setup.accounts} detail={accountsDetail} />
      </ol>

      {saved?.reason && <Alert tone="warning">{saved.reason}</Alert>}

      <Panel title="Application" description="Where this project’s test cases run.">
        <div className={styles.form}>
          <ApplicationFields
            value={form}
            onChange={setForm}
            errors={errors}
            allowedEnvs={connections.data.allowedEnvs}
          />
        </div>
      </Panel>

      <Panel
        title="Sign-in"
        description="How runs sign in. It happens once per account at the start of a run, so test cases never contain sign-in steps."
      >
        <div className={styles.form}>
          <SignInFields value={form} onChange={setForm} errors={errors} />
        </div>
      </Panel>

      <ProjectAccounts
        projectId={id}
        accounts={own}
        strategy={saved?.login.strategy}
        blockedReason={blockedReason}
        onChanged={accounts.reload}
      />

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => {
          setForm(base);
          setErrors({});
        }}
        saveLabel="Save project setup"
      />

      {editing && (
        <ProjectDialog
          project={project}
          allowedEnvs={connections.data.allowedEnvs}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setEditing(false);
            projects.reload();
            toast.show(`Saved ${p.name}.`);
          }}
        />
      )}
    </div>
  );
}

function Step({ name, done, detail }: Readonly<{ name: string; done: boolean; detail: string }>) {
  return (
    <li className={`${styles.step} ${done ? styles.stepDone : styles.stepTodo}`}>
      <Icon name={done ? 'check' : 'alert'} size={16} />
      <span>
        <span className={styles.stepName}>
          {name}
          <span className="visually-hidden">{done ? ': done' : ': to do'}</span>
        </span>
        <span className={styles.stepDetail}>{detail}</span>
      </span>
    </li>
  );
}
