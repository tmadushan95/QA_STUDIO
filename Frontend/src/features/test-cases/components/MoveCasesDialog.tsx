/** MoveCasesDialog: file the chosen test cases under another test suite. Their steps and history are unaffected. */
import { useState } from 'react';
import { Alert, Button, Dialog } from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { plural } from '../../../shared/lib/format.js';
import { SuitePicker, firstUsable, type Project, type TestSuite } from '../../master-data/index.js';
import { moveCases } from '../api.js';

/** Asks which test suite to move the chosen cases to, then moves them. */
export function MoveCasesDialog({
  ids,
  projects,
  suites,
  onClose,
  onMoved,
}: {
  ids: string[];
  projects: Project[];
  suites: TestSuite[];
  onClose: () => void;
  onMoved: (moved: number, suiteName: string) => void;
}) {
  const [suiteId, setSuiteId] = useState(firstUsable(projects, suites)?.id ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const move = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await moveCases(ids, suiteId);
      onMoved(r.moved, suites.find((s) => s.id === suiteId)?.name ?? '');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Move ${plural(ids.length, 'test case')}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!suiteId} onClick={() => void move()}>
            Move
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <SuitePicker projects={projects} suites={suites} suiteId={suiteId} onChange={setSuiteId} />
      </div>
    </Dialog>
  );
}
