/**
 * Projects page: every application under test as a card saying where it runs and whether it is ready, with forms to
 * add, edit and delete them. A card opens the project's own setup page. A project with suites or test accounts cannot
 * be deleted, so one click can never remove a whole test library; the server enforces it, and the Delete action
 * explains why when it is refused.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Menu,
  PageHeader,
  Panel,
  TextArea,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { hrefIn, navigate } from '../../shared/hooks/useRoute.js';
import { plural } from '../../shared/lib/format.js';
import {
  checkConnection,
  createProject,
  deleteProject,
  fetchAccounts,
  fetchConnections,
  fetchProjects,
  NEW_CONNECTION,
  saveConnection,
  setupOf,
  updateProject,
  type Account,
  type ConnectionInput,
  type Project,
  type ProjectConnection,
} from './api.js';
import { ApplicationFields, methodLabel, SignInSelect } from './ConnectionFields.js';
import styles from './Projects.module.css';

/** A project opens on its dashboard, like an Azure DevOps project opens on its summary. */
const projectLink = (p: Project) => hrefIn(p.code, 'dashboard');
const settingsLink = (p: Project) => hrefIn(p.code, 'project-settings', 'general');

/** The organization's start page: every project, with forms to add, edit and delete them. */
export function ProjectsSection() {
  const toast = useToast();
  const projects = useResource(fetchProjects);
  const connections = useResource(fetchConnections);
  const accounts = useResource(fetchAccounts);
  useLive((e) => {
    if (e.type === 'data') projects.reload();
  });
  /** `null` is the "add" form; a project is that project's edit form. */
  const [editing, setEditing] = useState<Project | null>();
  const [deleting, setDeleting] = useState<Project>();
  const [busy, setBusy] = useState(false);

  const remove = async (p: Project) => {
    setBusy(true);
    try {
      await deleteProject(p.id);
      toast.show(`Deleted ${p.name}.`);
      setDeleting(undefined);
      projects.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const items = projects.data ?? [];
  const accountsOf = (id: number) => (accounts.data ?? []).filter((a) => a.projectId === id);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Choose the application to work in. Test cases, runs and settings all live inside one project, in the version chosen in the header."
        actions={
          <Button icon="plus" variant="primary" onClick={() => setEditing(null)}>
            New project
          </Button>
        }
      />
      <Panel flush>
        {(projects.error || connections.error || accounts.error) && (
          <Alert tone="danger">{projects.error || connections.error || accounts.error}</Alert>
        )}
        {items.length === 0 && projects.loading && (
          <EmptyState icon="refresh" title="Loading projects…" />
        )}
        {items.length === 0 && !projects.loading && (
          <EmptyState icon="dashboard" title="No projects yet">
            Add the first application you test.
          </EmptyState>
        )}
        {items.length > 0 && (
          <ul className={styles.grid} aria-label="Projects">
            {items.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                connection={connections.data?.items.find((c) => c.projectId === p.id)}
                accounts={accountsOf(p.id)}
                onEdit={() => setEditing(p)}
                onDelete={() => setDeleting(p)}
              />
            ))}
          </ul>
        )}
      </Panel>
      {editing !== undefined && (
        <ProjectDialog
          project={editing}
          allowedEnvs={connections.data?.allowedEnvs ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={(p) => {
            const isNew = editing === null;
            setEditing(undefined);
            projects.reload();
            toast.show(`Saved ${p.name}.`);
            // The next thing a new project needs is its sign-in details and accounts, and they are there.
            if (isNew) navigate(settingsLink(p));
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete project"
          danger
          busy={busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        >
          {deleteWarning(deleting, accountsOf(deleting.id).length)}
        </ConfirmDialog>
      )}
    </>
  );
}

function deleteWarning(p: Project, accountCount: number): string {
  if (p.suiteCount > 0)
    return `It still has ${plural(p.suiteCount, 'test suite')}, so this will be refused. Delete or move them first.`;
  if (accountCount > 0)
    return `It still has ${plural(accountCount, 'test account')}, so this will be refused. Delete them first.`;
  return 'This cannot be undone.';
}

function ProjectCard({
  project: p,
  connection,
  accounts,
  onEdit,
  onDelete,
}: Readonly<{
  project: Project;
  connection: ProjectConnection | undefined;
  accounts: Account[];
  onEdit: () => void;
  onDelete: () => void;
}>) {
  const setup = setupOf(connection, accounts.length);
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          <a href={projectLink(p)} className={styles.cardLink}>
            {p.name}
          </a>
          <code className={styles.code}>{p.code}</code>
        </h2>
        <div className={styles.cardActions}>
          <Menu
            label={`Actions for ${p.name}`}
            items={[
              { label: 'Open', icon: 'dashboard', onSelect: () => navigate(projectLink(p)) },
              {
                label: 'Project settings',
                icon: 'settings',
                onSelect: () => navigate(settingsLink(p)),
              },
              { label: 'Edit', icon: 'cases', onSelect: onEdit },
              { label: 'Delete', icon: 'trash', danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </div>
      <div className={styles.address}>{connection?.appUrl ?? 'No application address yet'}</div>
      <div className={styles.badges}>
        {setup.ready ? (
          <Badge tone="success" glyph="✓">
            Ready
          </Badge>
        ) : (
          <Badge tone="warning" glyph="!">
            Needs setup
          </Badge>
        )}
        {!p.isActive && <Badge>Inactive</Badge>}
        {connection && <Badge tone="info">{connection.envName}</Badge>}
        {connection && <Badge>{methodLabel(connection.login.strategy)}</Badge>}
      </div>
      <p className={styles.facts}>
        <span>{plural(p.suiteCount, 'test suite')}</span>
        <span>{plural(p.testCaseCount, 'test case')}</span>
        <span>{plural(accounts.length, 'account')}</span>
      </p>
      {p.description && <p className={styles.code}>{p.description}</p>}
    </li>
  );
}

/**
 * The form for a project's details. A new project also asks where it runs and how it signs in, so it is usable from the
 * start; an existing one changes those on its own page.
 */
export function ProjectDialog({
  project,
  allowedEnvs,
  onClose,
  onSaved,
}: Readonly<{
  project: Project | null;
  allowedEnvs: string[];
  onClose: () => void;
  onSaved: (p: Project) => void;
}>) {
  const [v, setV] = useState({
    code: project?.code ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    isActive: project?.isActive ?? true,
  });
  const toast = useToast();
  const [connection, setConnection] = useState<ConnectionInput>(NEW_CONNECTION);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty =
    v.code !== (project?.code ?? '') ||
    v.name !== (project?.name ?? '') ||
    v.description !== (project?.description ?? '') ||
    v.isActive !== (project?.isActive ?? true) ||
    (!project && JSON.stringify(connection) !== JSON.stringify(NEW_CONNECTION));

  const create = async (input: { code: string; name: string; description?: string }) => {
    // Checked first: the project and its connection are two saves, and a refused address must not leave a half-made
    // project behind.
    await checkConnection(connection);
    const created = await createProject(input);
    try {
      await saveConnection(created.id, connection);
    } catch (e) {
      // Very unlikely after the check. The project exists and its page asks for the address, so carry on there.
      toast.show(errorMessage(e), { tone: 'danger' });
    }
    return created;
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    const input = {
      code: v.code.trim(),
      name: v.name.trim(),
      ...(v.description.trim() && { description: v.description.trim() }),
    };
    try {
      onSaved(
        project
          ? await updateProject(project.id, {
              ...input,
              isActive: v.isActive,
              rowVersion: project.rowVersion,
            })
          : await create(input),
      );
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={project ? `Edit ${project.name}` : 'New project'}
      size="md"
      dirty={dirty}
      onClose={onClose}
      onSave={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              !v.code.trim() ||
              !v.name.trim() ||
              (!project && (!connection.appUrl.trim() || !connection.envName))
            }
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" required error={errors['name']}>
          {(p) => (
            <TextInput
              {...p}
              data-autofocus
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Code" required error={errors['code']} hint="Short and unique, such as CAPEX.">
          {(p) => (
            <TextInput
              {...p}
              value={v.code}
              onChange={(e) => setV({ ...v, code: e.target.value })}
            />
          )}
        </Field>
        {!project && (
          <>
            <ApplicationFields
              value={connection}
              onChange={setConnection}
              errors={errors}
              allowedEnvs={allowedEnvs}
            />
            <SignInSelect value={connection} onChange={setConnection} errors={errors} />
          </>
        )}
        <Field label="Description" error={errors['description']}>
          {(p) => (
            <TextArea
              {...p}
              rows={3}
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
            />
          )}
        </Field>
        {project && (
          <Checkbox
            label="Active"
            hint="Inactive projects keep their test cases but are not offered for new ones."
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
        )}
      </div>
    </Dialog>
  );
}
