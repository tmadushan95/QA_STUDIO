/**
 * MoveToPositionDialog: put one test case at a numbered place in the list. This is how a case moves to another page
 * of a paged list, where dragging cannot reach.
 */
import { useState } from 'react';
import { Button, Dialog, Field, TextInput } from '../../../design-system/index.js';

/** Props of `MoveToPositionDialog`. */
export interface MoveToPositionDialogProps {
  caseId: string;
  /** The case's place now, counting from 1. */
  current: number;
  /** How many places the list has. */
  total: number;
  onClose: () => void;
  /** Called with the chosen place, counting from 1. */
  onMove: (position: number) => void;
}

/** The popup that asks for a new place in the list. */
export function MoveToPositionDialog({
  caseId,
  current,
  total,
  onClose,
  onMove,
}: MoveToPositionDialogProps) {
  const [value, setValue] = useState(String(current));
  const position = Number(value);
  const valid = Number.isInteger(position) && position >= 1 && position <= total;
  const submit = () => {
    if (valid) onMove(position);
  };

  return (
    <Dialog
      title={`Move ${caseId}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || position === current} onClick={submit}>
            Move
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label="New position"
          required
          hint={`Now ${current} of ${total}. Runs follow this order.`}
          error={value !== '' && !valid ? `Enter a number from 1 to ${total}.` : undefined}
        >
          {(p) => (
            <TextInput
              {...p}
              type="number"
              inputMode="numeric"
              min={1}
              max={total}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
