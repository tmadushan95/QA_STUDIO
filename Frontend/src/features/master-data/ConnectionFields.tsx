/**
 * The form parts of a project's connection, shared by the New project popup and the project's own page: where the
 * application runs, and how runs sign in to it.
 */
import { Field, Select, TextInput } from '../../design-system/index.js';
import type { LoginStrategy } from '../settings/api.js';
import type { ConnectionInput } from './api.js';
import styles from './Projects.module.css';

/** Every sign-in method, with what it means. */
export const SIGN_IN_METHODS: { value: LoginStrategy; label: string; hint: string }[] = [
  {
    value: 'none',
    label: 'No sign-in',
    hint: 'The application is open, or tests need no account.',
  },
  {
    value: 'login-form',
    label: 'Login form',
    hint: 'A page with a user name and a password field.',
  },
  {
    value: 'microsoft-sso',
    label: 'Single sign-on (Microsoft)',
    hint: 'A “Sign in with…” button and a Microsoft popup.',
  },
  {
    value: 'saved-session',
    label: 'Saved session',
    hint: 'Sign in by hand once, second factor included, on a test account below. Runs reuse that session.',
  },
];

/** The short name of a sign-in method. */
export const methodLabel = (strategy: LoginStrategy): string =>
  SIGN_IN_METHODS.find((m) => m.value === strategy)?.label ?? strategy;

/** Props shared by the connection form parts. */
interface PartProps {
  value: ConnectionInput;
  onChange: (next: ConnectionInput) => void;
  errors: Record<string, string>;
}

/** The environment and the application's address. */
export function ApplicationFields({
  value,
  onChange,
  errors,
  allowedEnvs,
}: PartProps & { allowedEnvs: string[] }) {
  return (
    <div className={styles.twoFields}>
      <Field
        label="Environment"
        required
        error={errors['envName']}
        hint="Only allowed environments can be tested."
      >
        {(p) => (
          <Select
            {...p}
            value={value.envName}
            onChange={(e) => onChange({ ...value, envName: e.target.value })}
          >
            <option value="">Choose…</option>
            {allowedEnvs.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Application address"
        required
        error={errors['appUrl']}
        hint="Where this project’s tests run, such as https://qa.example.com"
      >
        {(p) => (
          <TextInput
            {...p}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={value.appUrl}
            onChange={(e) => onChange({ ...value, appUrl: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

/** The sign-in method as a short list, for the New project popup. */
export function SignInSelect({ value, onChange, errors }: PartProps) {
  return (
    <Field
      label="Sign-in method"
      error={errors['login.strategy']}
      hint={SIGN_IN_METHODS.find((m) => m.value === value.login.strategy)?.hint}
    >
      {(p) => (
        <Select
          {...p}
          value={value.login.strategy}
          onChange={(e) =>
            onChange({
              ...value,
              login: { ...value.login, strategy: e.target.value as LoginStrategy },
            })
          }
        >
          {SIGN_IN_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The sign-in method as cards to press, with the details that method needs. */
export function SignInFields({ value, onChange, errors }: PartProps) {
  const setLogin = (patch: Partial<ConnectionInput['login']>) =>
    onChange({ ...value, login: { ...value.login, ...patch } });
  return (
    <>
      <fieldset className={styles.methods}>
        <legend>Sign-in method</legend>
        {SIGN_IN_METHODS.map((m) => {
          const on = value.login.strategy === m.value;
          return (
            <label
              key={m.value}
              className={on ? `${styles.method} ${styles.methodOn}` : styles.method}
            >
              <input
                type="radio"
                name="sign-in-method"
                value={m.value}
                checked={on}
                onChange={() => setLogin({ strategy: m.value })}
              />
              <span>
                {m.label}
                <span className={styles.methodHint}>{m.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {value.login.strategy !== 'none' && (
        <>
          <Field
            label="Login page"
            error={errors['login.path']}
            hint="Path on the application, such as /login."
          >
            {(p) => (
              <TextInput
                {...p}
                value={value.login.path}
                onChange={(e) => setLogin({ path: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Text shown once signed in"
            error={errors['login.signedInMarker']}
            hint="Proves the sign-in worked, for example “Welcome back,”. Leave empty to accept leaving the login page."
          >
            {(p) => (
              <TextInput
                {...p}
                value={value.login.signedInMarker}
                onChange={(e) => setLogin({ signedInMarker: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
    </>
  );
}
