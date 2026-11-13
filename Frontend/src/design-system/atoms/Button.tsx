/**
 * Button atoms: `Button` for labelled actions and `IconButton` for icon-only actions (which always need a label
 * for screen readers). One primary button per area of a screen; secondary actions use `secondary` or `ghost`.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';
import { Spinner } from './Spinner.js';
import styles from './Button.module.css';

/** How much visual weight a button carries. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Props of `Button`. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Icon shown before the label. */
  icon?: IconName;
  /** Shows a spinner and blocks clicks while an action is in progress. */
  loading?: boolean;
  children?: ReactNode;
}

/** The standard button, with optional icon and loading state. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    loading = false,
    children,
    className,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Buttons never submit a form by accident; forms pass type="submit" explicitly.
      type={type ?? 'button'}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // Voice control asks for a spoken yes before pressing a danger button.
      data-danger={variant === 'danger' || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
});

/** Props of `IconButton`; `label` is required because the button has no visible text. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Accessible name, also shown as a tooltip. Required: an icon alone says nothing to a screen reader. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
}

/** A button showing only an icon. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      data-danger={variant === 'danger' || undefined}
      className={[styles.button, styles.iconOnly, styles[variant], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon name={icon} size={18} />
    </button>
  );
});
