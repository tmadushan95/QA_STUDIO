/**
 * ParametersDialog: the parameter form of one test case in a popup, opened from a row of Test Case Studio or Test Execution.
 */
import { useState } from 'react';
import { Button, Dialog } from '../../../design-system/index.js';
import type { CaseParameters } from '../api.js';
import { ParametersPanel } from './ParametersPanel.js';

/** Props of `ParametersDialog`. */
export interface ParametersDialogProps {
  caseId: string;
  title: string;
  onClose: () => void;
  onSaved?: (view: CaseParameters) => void;
}

/** A popup around `ParametersPanel`. */
export function ParametersDialog({ caseId, title, onClose, onSaved }: ParametersDialogProps) {
  const [dirty, setDirty] = useState(false);
  return (
    <Dialog
      title={`Parameters · ${caseId}`}
      subtitle={title}
      size="md"
      dirty={dirty}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <ParametersPanel caseId={caseId} onDirtyChange={setDirty} {...(onSaved && { onSaved })} />
    </Dialog>
  );
}
