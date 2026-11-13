/**
 * Form control atoms: text input, multi-line text, drop-down and checkbox. They carry no label of their own; wrap
 * them in the `Field` molecule (or give `aria-label`) so every control has an accessible name.
 */
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './Inputs.module.css';

const cx = (...c: (string | undefined | false)[]) => c.filter(Boolean).join(' ');

/** Props of `TextInput`. */
export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Shows the error style; the message itself is shown by `Field`. */
  invalid?: boolean;
}

/** A single-line text input. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(styles.control, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/** Props of `TextArea`. */
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** A multi-line text input. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx(styles.control, styles.textarea, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/** Props of `Select`. */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  children: ReactNode;
}

/** A native drop-down. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx(styles.control, styles.select, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
});

/** Props of `Checkbox`. */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label next to the box. Leave out for a box in a table cell, and give `aria-label` instead. */
  label?: ReactNode;
  hint?: ReactNode;
}

/** A checkbox with its own label and optional hint. */
export function Checkbox({ label, hint, className, ...rest }: CheckboxProps) {
  const box = <input type="checkbox" className={styles.checkbox} {...rest} />;
  if (!label) return box;
  return (
    <label className={cx(styles.checkLabel, className)}>
      {box}
      <span>
        {label}
        {hint && <span className={styles.checkHint}>{hint}</span>}
      </span>
    </label>
  );
}
