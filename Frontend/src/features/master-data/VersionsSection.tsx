/**
 * Versions page: the releases of each project (such as 2.4 or Sprint 18). Test cases are generated, filed and run per
 * version, and the dashboard counts them per version. One version per project can be "current": new test cases of the
 * project are filed under it by default. Deleting a version keeps its test cases, with no version.
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
  createVersion,
  deleteVersion,
  fetchProjects,
  fetchVersions,
  updateVersion,
  type Project,
  type ProjectVersion,
} from './api.js';
import { useProjectScope } from './ProjectScope.js';

/** Lists project versions, with forms to add, edit and delete them. */
export function VersionsSection() {
  const toast = useToast();
  const data = useResource(async () => {
    const [projects, versions] = await Promise.all([fetchProjects(), fetchVersions()]);
    return { projects, versions };
  });
  useLive((e) => e.type === 'data' && data.reload());
  const projectId = useProjectScope().project?.id ?? 0;
  /** `null` is the "add" form; a version is that version's edit form. */
  const [editing, setEditing] = useState<ProjectVersion | null>();
  const [deleting, setDeleting] = useState<ProjectVersion>();
  const [busy, setBusy] = useState(false);

  const projects = (data.data?.projects ?? []).filter((p) => !projectId || p.id === projectId);
  const rows = (data.data?.versions ?? []).filter((v) => !projectId || v.projectId === projectId);

  const remove = async (v: ProjectVersion) => {
    setBusy(true);
    try {
      await deleteVersion(v.id);
      toast.show(`Deleted version ${v.name}.`);
      setDeleting(undefined);
      data.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ProjectVersion>[] = [
    {
      key: 'name',
      header: 'Version',
      rowHeader: true,
      cell: (v) => (
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <strong>{v.name}</strong>
          {v.isCurrent && <StatusBadge status="approved" label="Current" />}
        </span>
      ),
    },
    { key: 'project', header: 'Project', cell: (v) => v.projectName },
    { key: 'release', header: 'Release date', shrink: true, cell: (v) => v.releaseDate ?? '—' },
    { key: 'description', header: 'Scope', cell: (v) => v.description ?? '—' },
    {
      key: 'cases',
      header: 'Test cases',
      shrink: true,
      align: 'end',
      cell: (v) => v.testCaseCount,
    },
    {
      key: 'status',
      header: 'Status',
      shrink: true,
      cell: (v) => (
        <StatusBadge
          status={v.isActive ? 'approved' : 'none'}
          label={v.isActive ? 'Active' : 'Archived'}
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      label: '',
      shrink: true,
      cell: (v) => (
        <Menu
          label={`Actions for ${v.name}`}
          items={[
            { label: 'Edit', icon: 'design', onSelect: () => setEditing(v) },
            { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDeleting(v) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <Panel
        title="Versions"
        description="Releases of each project. Generate, file and run test cases per version."
        actions={
          <>
            <Button
              icon="plus"
              variant="primary"
              disabled={projects.length === 0}
              onClick={() => setEditing(null)}
            >
              New version
            </Button>
          </>
        }
        flush
      >
        {data.error && <Alert tone="danger">{data.error}</Alert>}
        <DataTable
          caption="Project versions"
          columns={columns}
          rows={rows}
          rowKey={(v) => String(v.id)}
          empty={
            data.loading && !data.data ? (
              <EmptyState icon="refresh" title="Loading versions…" />
            ) : (
              <EmptyState icon="version" title="No versions here yet">
                Add one, such as 1.0, to generate and run test cases per release.
              </EmptyState>
            )
          }
        />
      </Panel>
      {editing !== undefined && (
        <VersionDialog
          version={editing}
          projects={projects}
          initialProjectId={projectId || (projects.find((p) => p.isActive)?.id ?? 0)}
          onClose={() => setEditing(undefined)}
          onSaved={(v) => {
            setEditing(undefined);
            data.reload();
            toast.show(`Saved version ${v.name}.`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete version ${deleting.name}?`}
          confirmLabel="Delete version"
          danger
          busy={busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        >
          {deleting.testCaseCount > 0
            ? `Its ${plural(deleting.testCaseCount, 'test case')} are kept, with no version.`
            : 'This cannot be undone.'}
        </ConfirmDialog>
      )}
    </>
  );
}

function VersionDialog({
  version,
  projects,
  initialProjectId,
  onClose,
  onSaved,
}: {
  version: ProjectVersion | null;
  projects: Project[];
  initialProjectId: number;
  onClose: () => void;
  onSaved: (v: ProjectVersion) => void;
}) {
  const [v, setV] = useState({
    projectId: version?.projectId ?? initialProjectId,
    name: version?.name ?? '',
    description: version?.description ?? '',
    releaseDate: version?.releaseDate ?? '',
    isCurrent: version?.isCurrent ?? false,
    isActive: version?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty =
    v.name !== (version?.name ?? '') ||
    v.description !== (version?.description ?? '') ||
    v.releaseDate !== (version?.releaseDate ?? '') ||
    v.isCurrent !== (version?.isCurrent ?? false) ||
    v.isActive !== (version?.isActive ?? true);

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    const input = {
      name: v.name.trim(),
      ...(v.description.trim() && { description: v.description.trim() }),
      ...(v.releaseDate && { releaseDate: v.releaseDate }),
      isCurrent: v.isCurrent,
      isActive: v.isActive,
    };
    try {
      onSaved(
        version
          ? await updateVersion(version.id, { ...input, rowVersion: version.rowVersion })
          : await createVersion(v.projectId, input),
      );
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={version ? `Edit version ${version.name}` : 'New version'}
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
            hint={version ? 'A version stays in its project.' : undefined}
          >
            {(p) => (
              <Select
                {...p}
                value={v.projectId}
                disabled={version !== null}
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
        <Field label="Version" required error={errors['name']} hint="Such as 2.4.0 or Sprint 18.">
          {(p) => (
            <TextInput
              {...p}
              data-autofocus
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Release date" error={errors['releaseDate']}>
          {(p) => (
            <TextInput
              {...p}
              type="date"
              value={v.releaseDate}
              onChange={(e) => setV({ ...v, releaseDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="Scope" error={errors['description']}>
          {(p) => (
            <TextArea
              {...p}
              rows={3}
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
            />
          )}
        </Field>
        <Checkbox
          label="Current version"
          hint="New test cases of the project are filed under it by default. Only one version per project is current."
          checked={v.isCurrent}
          onChange={(e) =>
            setV({
              ...v,
              isCurrent: e.target.checked,
              isActive: e.target.checked ? true : v.isActive,
            })
          }
        />
        {version && (
          <Checkbox
            label="Active"
            hint="Archived versions keep their test cases but are not offered for new ones."
            checked={v.isActive}
            onChange={(e) =>
              setV({
                ...v,
                isActive: e.target.checked,
                isCurrent: e.target.checked ? v.isCurrent : false,
              })
            }
          />
        )}
        {errors['isCurrent'] && <Alert tone="danger">{errors['isCurrent']}</Alert>}
      </div>
    </Dialog>
  );
}
