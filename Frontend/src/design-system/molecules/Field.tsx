/**
 * Field molecule: a label, a control, an optional hint and an error message, wired together for accessibility.
 * The child is a render function that receives the IDs to put on the control.
 *
 * @example
 * <Field label="App URL" hint="Where the app under test runs" error={errors.appUrl}>
 *   {(p) => <TextInput {...p} value={url} onChange={…} />}
 * </Field>
 */
import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

/** The accessibility props `Field` hands to its control. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}

/** Props of `Field`. */
export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  /** Put the label on the left of a narrow control instead of above it. */
  inline?: boolean;
  children: (control: FieldControlProps) => ReactNode;
}

/** A form control with its label, hint and error, wired together for screen readers. */
export function Field({ label, hint, error, required, inline, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={inline ? `${styles.field} ${styles.inline}` : styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, ...(describedBy && { 'aria-describedby': describedBy }), invalid: !!error })}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
