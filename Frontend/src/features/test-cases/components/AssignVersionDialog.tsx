/**
 * AssignVersionDialog: give selected test cases a project version (or clear it). Only versions of the cases' own
 * project are offered, because the server refuses a version of another project.
 */
import { useState } from 'react';
import { Alert, Button, Dialog, Field, Select } from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { href } from '../../../shared/hooks/useRoute.js';
import type { ProjectVersion } from '../../master-data/index.js';
import { assignVersion } from '../api.js';

/** Props of `AssignVersionDialog`. */
export interface AssignVersionDialogProps {
  ids: string[];
  /** The one project the cases belong to; undefined when they span projects. */
  projectId: number | undefined;
  versions: ProjectVersion[];
  onClose: () => void;
  onAssigned: (count: number, versionName: string | undefined) => void;
}

/** The popup that files cases under a version. */
export function AssignVersionDialog({
  ids,
  projectId,
  versions,
  onClose,
  onAssigned,
}: AssignVersionDialogProps) {
  const options = versions.filter((v) => v.projectId === projectId && v.isActive);
  const [versionId, setVersionId] = useState(
    options.find((v) => v.isCurrent)?.id ?? options[0]?.id ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (clear: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await assignVersion(ids, clear ? null : versionId);
      onAssigned(r.assigned, clear ? undefined : options.find((v) => v.id === versionId)?.name);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Set version of ${ids.length} test case${ids.length === 1 ? '' : 's'}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {projectId !== undefined && (
            <Button onClick={() => void save(true)} disabled={busy}>
              Clear version
            </Button>
          )}
          <Button
            variant="primary"
            loading={busy}
            disabled={!versionId}
            onClick={() => void save(false)}
          >
            Set version
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {projectId === undefined ? (
        <Alert tone="warning" title="The cases belong to different projects">
          A version is a release of one project. Select cases of a single project.
        </Alert>
      ) : options.length === 0 ? (
        <Alert
          tone="info"
          title="This project has no versions yet"
          actions={
            <a className="button-link" href={href('master-data', 'versions')}>
              Add a version
            </a>
          }
        >
          Add versions such as 1.0 or Sprint 18 under Projects &amp; Versions.
        </Alert>
      ) : (
        <Field label="Version" required>
          {(p) => (
            <Select {...p} value={versionId} onChange={(e) => setVersionId(Number(e.target.value))}>
              {options.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </Dialog>
  );
}
