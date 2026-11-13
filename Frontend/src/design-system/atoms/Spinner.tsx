/** Spinner atom: shows that something is loading. Decorative; pair it with text or `aria-busy` on its container. */
import styles from './Spinner.module.css';

/** An animated "working" indicator. */
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
