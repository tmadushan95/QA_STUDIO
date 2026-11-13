/**
 * Pages section: the application's pages by name, so steps say "Go to page Draft projects" and a changed address
 * is fixed here once. "Loaded text" proves the page opened before the next step runs.
 *
 * Pages are mapped per project: the shared list applies to every project, and a project's own list adds pages or
 * overrides a shared one with the same name (two applications can both have a "Dashboard" at different addresses).
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  IconButton,
  Panel,
  SaveBar,
  Select,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { fetchPages, invalidateCatalog, type PageEntry } from '../../../shared/api/catalog.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import { useWorkContext } from '../../../shared/hooks/useWorkContext.js';
import { fetchProjects } from '../../master-data/index.js';
import { savePages } from '../api.js';

/** Settings › Pages: page names steps can refer to. */
export function PagesSection() {
  const toast = useToast();
  const [ctx] = useWorkContext();
  // 0 is the shared list; starts on the project being worked on, when there is one.
  const [projectId, setProjectId] = useState(ctx.projectId);
  const projects = useResource(fetchProjects);
  const res = useResource(() => fetchPages(projectId || undefined), [projectId]);
  const [rows, setRows] = useState<PageEntry[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (res.data) setRows(res.data);
  }, [res.data]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(res.data ?? []);
  const set = (i: number, patch: Partial<PageEntry>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await savePages(
        rows.filter((r) => r.name.trim() || r.route.trim()),
        projectId || undefined,
      );
      res.set(saved);
      invalidateCatalog();
      toast.show('Pages saved.');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Panel
        title="Pages"
        description="Name the pages of your application once. Steps use the name; the run opens the address and waits for the loaded text."
        actions={
          <>
            <Select
              aria-label="Pages of"
              value={projectId}
              disabled={dirty}
              title={dirty ? 'Save or discard your changes first' : undefined}
              onChange={(e) => setProjectId(Number(e.target.value))}
            >
              <option value={0}>Shared by all projects</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} only
                </option>
              ))}
            </Select>
            <Button
              icon="plus"
              onClick={() => setRows([...rows, { name: '', route: '/', marker: '' }])}
            >
              Add page
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
          {projectId
            ? 'Pages only this project uses. A page with the same name as a shared one replaces it for this project.'
            : 'Pages every project can use. Choose a project above to add pages only it has.'}
        </p>
        {res.error && <Alert tone="danger">{res.error}</Alert>}
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1.4fr auto',
              gap: 'var(--space-2)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
            }}
            aria-hidden="true"
          >
            <span>NAME</span>
            <span>ADDRESS</span>
            <span>LOADED TEXT (OPTIONAL)</span>
            <span />
          </div>
          {rows.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No pages yet.</p>}
          {rows.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1.4fr auto',
                gap: 'var(--space-2)',
                alignItems: 'start',
              }}
            >
              <TextInput
                aria-label={`Page ${i + 1} name`}
                value={r.name}
                invalid={!!errors[`pages.${i}.name`]}
                title={errors[`pages.${i}.name`]}
                placeholder="Draft projects"
                onChange={(e) => set(i, { name: e.target.value })}
              />
              <TextInput
                aria-label={`Page ${i + 1} address`}
                value={r.route}
                invalid={!!errors[`pages.${i}.route`]}
                title={errors[`pages.${i}.route`]}
                placeholder="/projects/drafts"
                onChange={(e) => set(i, { route: e.target.value })}
              />
              <TextInput
                aria-label={`Page ${i + 1} loaded text`}
                value={r.marker}
                placeholder="Text visible on the page"
                onChange={(e) => set(i, { marker: e.target.value })}
              />
              <IconButton
                icon="trash"
                label={`Remove page ${r.name || i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              />
            </div>
          ))}
        </div>
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => setRows(res.data ?? [])}
        saveLabel="Save pages"
      />
    </>
  );
}
