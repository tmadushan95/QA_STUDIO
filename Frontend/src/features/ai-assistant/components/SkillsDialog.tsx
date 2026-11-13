/**
 * SkillsDialog: the saved skills a generation prompt can call with `/skill-name`, and the form to add, edit, import
 * and delete them. A skill has the same shape other AI assistants use (name, one-line description, markdown
 * instructions), so an existing `SKILL.md` can be imported as is.
 */
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  TextArea,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { deleteSkill, saveSkill, type Skill } from '../api.js';
import styles from './SkillsDialog.module.css';

/** Same rule as the server: lowercase letters, digits and -, starting with a letter. */
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_INSTRUCTIONS = 8000;

/** Props of `SkillsDialog`. */
export interface SkillsDialogProps {
  skills: Skill[];
  onClose: () => void;
  /** Called after a save or delete, so the caller reloads its list. */
  onChanged: () => void;
}

const BLANK: Skill = { name: '', description: '', instructions: '' };

/** Turn free text into a skill name: "Login checks" → "login-checks". */
const toName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 64);

/**
 * Read a `SKILL.md`: YAML front matter with `name` and `description`, then the instructions. Only those two keys are
 * read; anything else in the front matter is ignored. A file without front matter becomes the instructions.
 */
export function parseSkillFile(text: string, fileName: string): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = new Map<string, string>();
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) meta.set(kv[1]!.toLowerCase(), kv[2]!.trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  const fallback = fileName.replace(/\.md$/i, '').replace(/^skill$/i, '');
  return {
    name: toName(meta.get('name') ?? fallback),
    description: meta.get('description') ?? '',
    instructions: (m ? m[2]! : text).trim(),
  };
}

/** List of saved skills plus an add/edit form. */
export function SkillsDialog({ skills, onClose, onChanged }: SkillsDialogProps) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  // `undefined` = nothing open; `original` is the saved name when editing (renaming is not offered).
  const [form, setForm] = useState<{ value: Skill; original?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Skill>();

  const open = (value: Skill, original?: string) => {
    setForm({ value, ...(original && { original }) });
    setError('');
    setFields({});
  };
  const patch = (p: Partial<Skill>) => setForm((f) => f && { ...f, value: { ...f.value, ...p } });

  const value = form?.value ?? BLANK;
  const isNew = form !== undefined && form.original === undefined;
  const nameError =
    value.name && !NAME.test(value.name)
      ? 'Use lowercase letters, digits and -, starting with a letter.'
      : fields['name'];
  // Saving a new skill under a taken name replaces it, so say so before it happens.
  const replaces = isNew && skills.some((s) => s.name === value.name);
  const valid =
    NAME.test(value.name) &&
    value.description.trim().length >= 3 &&
    value.instructions.trim().length >= 10;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveSkill(value);
      toast.show(`Saved /${value.name}.`);
      setForm(undefined);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? e.fields : {});
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Skill) => {
    setBusy(true);
    try {
      await deleteSkill(s.name);
      toast.show(`Deleted /${s.name}.`);
      if (form?.original === s.name) setForm(undefined);
      onChanged();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
      setDeleting(undefined);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      open(parseSkillFile(await file.text(), file.name));
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    }
  };

  return (
    <>
      <Dialog
        title="Skills"
        subtitle="Saved instructions you call with /skill-name in a prompt"
        size="lg"
        dirty={form !== undefined}
        onClose={onClose}
        {...(form && { onSave: () => void save() })}
        footer={
          form ? (
            <>
              <Button onClick={() => setForm(undefined)}>Cancel</Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!valid}
                onClick={() => void save()}
              >
                {replaces ? `Replace /${value.name}` : 'Save skill'}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )
        }
      >
        <div className={styles.body}>
          {!form && (
            <>
              <div className={styles.toolbar}>
                <Button variant="primary" icon="plus" onClick={() => open(BLANK)}>
                  New skill
                </Button>
                <Button icon="upload" onClick={() => fileInput.current?.click()}>
                  Import SKILL.md
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  hidden
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              {skills.length === 0 ? (
                <EmptyState icon="sparkle" title="No skills yet">
                  Save the rules your team writes test cases by, then type /its-name in a prompt to
                  apply them.
                </EmptyState>
              ) : (
                <ul className={styles.list}>
                  {skills.map((s) => (
                    <li key={s.name} className={styles.item}>
                      <div className={styles.itemText}>
                        <code>/{s.name}</code>
                        <span className={styles.sub}>{s.description}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => open(s, s.name)}>
                        Edit
                      </Button>
                      <IconButton
                        icon="trash"
                        label={`Delete /${s.name}`}
                        onClick={() => setDeleting(s)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {form && (
            <div className={styles.form}>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field
                label="Name"
                required
                hint={
                  isNew
                    ? `Type /${value.name || 'skill-name'} in a prompt to use it. Lowercase letters, digits and -.`
                    : 'The name cannot change once saved.'
                }
                error={
                  nameError ??
                  (replaces
                    ? `A skill called /${value.name} exists; saving replaces it.`
                    : undefined)
                }
              >
                {(p) => (
                  <TextInput
                    {...p}
                    data-autofocus
                    value={value.name}
                    maxLength={64}
                    disabled={!isNew}
                    placeholder="login-test-rules"
                    onChange={(e) => patch({ name: e.target.value.toLowerCase().trim() })}
                  />
                )}
              </Field>
              <Field
                label="Description"
                required
                hint="One line on what it is for, shown next to its name."
                error={fields['description']}
              >
                {(p) => (
                  <TextInput
                    {...p}
                    value={value.description}
                    maxLength={300}
                    placeholder="House rules for login and session test cases"
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Instructions"
                required
                hint={`What the AI must follow when the skill is used: scope, naming, priorities, wording. It cannot change the safety rules. ${value.instructions.length} / ${MAX_INSTRUCTIONS}`}
                error={fields['instructions']}
              >
                {(p) => (
                  <TextArea
                    {...p}
                    rows={12}
                    value={value.instructions}
                    maxLength={MAX_INSTRUCTIONS}
                    placeholder={
                      '- Title every case "<Module> – <behaviour>".\n- Always add a locked-account and an expired-session case.\n- Mark permission cases High priority.'
                    }
                    onChange={(e) => patch({ instructions: e.target.value })}
                  />
                )}
              </Field>
            </div>
          )}
        </div>
      </Dialog>

      {deleting && (
        <ConfirmDialog
          title={`Delete /${deleting.name}?`}
          confirmLabel="Delete skill"
          danger
          busy={busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        >
          Prompts that use /{deleting.name} will no longer apply it. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}
