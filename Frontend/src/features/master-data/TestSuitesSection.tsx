/**
 * Test suites page: add, edit and delete the suites under a project. A suite holding test cases cannot be deleted;
 * the server enforces it, so the cases must be moved first. Suites made automatically from an imported module show
 * here like any other and can be renamed.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Menu,
  Panel,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { plural } from '../../shared/lib/format.js';
import {
  createSuite,
  deleteSuite,
  fetchProjects,
  fetchSuites,
  updateSuite,
  type Project,
  type TestSuite,
} from './api.js';
import { useProjectScope } from './ProjectScope.js';

/** Lists test suites, with forms to add, edit and delete them. */
export function TestSuitesSection() {
  const toast = useToast();
  const data = useResource(async () => {
    const [projects, suites] = await Promise.all([fetchProjects(), fetchSuites()]);
    return { projects, suites };
  });
  useLive((e) => {
    if (e.type === 'data') data.reload();
  });
  const projectId = useProjectScope().project?.id ?? 0;
  /** `null` is the "add" form; a suite is that suite's edit form. */
  const [editing, setEditing] = useState<TestSuite | null>();
  const [deleting, setDeleting] = useState<TestSuite>();
  const [busy, setBusy] = useState(false);

  const projects = (data.data?.projects ?? []).filter((p) => !projectId || p.id === projectId);
  const rows = (data.data?.suites ?? []).filter((s) => !projectId || s.projectId === projectId);

  const remove = async (s: TestSuite) => {
    setBusy(true);
    try {
      await deleteSuite(s.id);
      toast.show(`Deleted ${s.name}.`);
      setDeleting(undefined);
      data.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TestSuite>[] = [
    { key: 'name', header: 'Name', rowHeader: true, cell: (s) => s.name },
    { key: 'project', header: 'Project', cell: (s) => s.projectName },
    { key: 'description', header: 'Description', cell: (s) => s.description ?? '—' },
    {
      key: 'cases',
      header: 'Test cases',
      shrink: true,
      align: 'end',
      cell: (s) => s.testCaseCount,
    },
    {
      key: 'status',
      header: 'Status',
      shrink: true,
      cell: (s) => (
        <StatusBadge
          status={s.isActive ? 'approved' : 'none'}
          label={s.isActive ? 'Active' : 'Inactive'}
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      label: '',
      shrink: true,
      cell: (s) => (
        <Menu
          label={`Actions for ${s.name}`}
          items={[
            { label: 'Edit', icon: 'cases', onSelect: () => setEditing(s) },
            { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDeleting(s) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <Panel
        title="Test suites"
        description="Groups of related test cases inside a project."
        actions={
          <>
            <Button
              icon="plus"
              variant="primary"
              disabled={projects.length === 0}
              onClick={() => setEditing(null)}
            >
              New test suite
            </Button>
          </>
        }
        flush
      >
        {data.error && <Alert tone="danger">{data.error}</Alert>}
        <DataTable
          caption="Test suites"
          columns={columns}
          rows={rows}
          rowKey={(s) => String(s.id)}
          empty={
            data.loading && !data.data ? (
              <EmptyState icon="refresh" title="Loading test suites…" />
            ) : (
              <EmptyState icon="cases" title="No test suites here yet">
                Add one to start filing test cases under it.
              </EmptyState>
            )
          }
        />
      </Panel>
      {editing !== undefined && (
        <SuiteDialog
          suite={editing}
          projects={projects}
          initialProjectId={projectId || (projects.find((p) => p.isActive)?.id ?? 0)}
          onClose={() => setEditing(undefined)}
          onSaved={(s) => {
            setEditing(undefined);
            data.reload();
            toast.show(`Saved ${s.name}.`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete test suite"
          danger
          busy={busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        >
          {deleting.testCaseCount > 0
            ? `It still holds ${plural(deleting.testCaseCount, 'test case')}, so this will be refused. Move or delete them first.`
            : 'This cannot be undone.'}
        </ConfirmDialog>
      )}
    </>
  );
}

function SuiteDialog({
  suite,
  projects,
  initialProjectId,
  onClose,
  onSaved,
}: {
  suite: TestSuite | null;
  projects: Project[];
  initialProjectId: number;
  onClose: () => void;
  onSaved: (s: TestSuite) => void;
}) {
  const [v, setV] = useState({
    projectId: suite?.projectId ?? initialProjectId,
    name: suite?.name ?? '',
    description: suite?.description ?? '',
    sortOrder: suite?.sortOrder ?? 0,
    isActive: suite?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty =
    v.name !== (suite?.name ?? '') ||
    v.description !== (suite?.description ?? '') ||
    v.sortOrder !== (suite?.sortOrder ?? 0) ||
    v.isActive !== (suite?.isActive ?? true);

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    const input = {
      name: v.name.trim(),
      ...(v.description.trim() && { description: v.description.trim() }),
      sortOrder: v.sortOrder,
    };
    try {
      onSaved(
        suite
          ? await updateSuite(suite.id, {
              ...input,
              isActive: v.isActive,
              rowVersion: suite.rowVersion,
            })
          : await createSuite({ ...input, projectId: v.projectId }),
      );
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={suite ? `Edit ${suite.name}` : 'New test suite'}
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
            disabled={!v.name.trim() || !v.projectId}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
        {projects.length > 1 && (
          <Field
            label="Project"
            required
            error={errors['projectId']}
            hint={
              suite
                ? 'A suite stays in its project. Move test cases to change where they are filed.'
                : undefined
            }
          >
            {(p) => (
              <Select
                {...p}
                value={v.projectId}
                disabled={suite !== null}
                onChange={(e) => setV({ ...v, projectId: Number(e.target.value) })}
              >
                {projects
                  .filter((project) => project.isActive || project.id === v.projectId)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
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
        <Field label="Order in the list" hint="Lower comes first." error={errors['sortOrder']}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={0}
              value={v.sortOrder}
              onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        {suite && (
          <Checkbox
            label="Active"
            hint="Inactive suites keep their test cases but are not offered for new ones."
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
        )}
      </div>
    </Dialog>
  );
}
