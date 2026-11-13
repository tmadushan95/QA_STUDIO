/**
 * The screen as voice sees it, and the hands voice uses on it. It reads the page the way a screen reader does (role and
 * accessible name of every button, link, field, tab and checkbox) and acts through the same DOM events a mouse or
 * keyboard produces, so React handlers, validation and confirmations run exactly as for a person.
 *
 * Safety is decided here, not by the model: controls that delete or discard are marked `danger`, and fields for
 * passwords, keys and type-to-confirm boxes are `manualOnly`, which `fill` refuses.
 */
import type { ScreenElement } from '@qa-studio/shared';

/** The most elements listed per screen, so a long table cannot flood the model. */
export const MAX_ELEMENTS = 90;
const MAX_NAME = 80;

const SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="button"]',
  '[role="link"]',
  '[role="combobox"]',
].join(',');

const DANGER_WORDS =
  /\b(delete|remove|clear|discard|restore|reset|overwrite|revoke|disconnect|purge|erase|drop|unlink)\b/i;
const SECRET_WORDS = /\b(password|api key|secret|token|access key|passphrase)\b/i;

/** The voice controls themselves are never targets, so the assistant cannot end or reconfigure itself by accident. */
const VOICE_UI = '[data-voice-ui]';

const text = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s: string) => (s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s);

/** The open popup, when there is one: commands then apply inside it only, as they do for a mouse. */
export function activeDialog(doc: Document = document): HTMLElement | undefined {
  const all = [
    ...doc.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"]',
    ),
  ];
  return all.filter((d) => !isHidden(d)).at(-1);
}

function isHidden(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return true;
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = view?.getComputedStyle(n);
    if (s && (s.display === 'none' || s.visibility === 'hidden')) return true;
  }
  return false;
}

/** The accessible name, following the order screen readers use. */
export function accessibleName(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const aria = el.getAttribute('aria-label');
  if (aria) return clip(text(aria));
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)?.textContent))
      .join(' ');
    if (text(t)) return clip(text(t));
  }
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    // `labels` covers both <label for> and a wrapping <label>, with no selector escaping of React's ":r1:" IDs.
    const label = el.labels?.[0] ?? el.closest('label');
    if (label) {
      // A wrapping label also contains the control's own text (a select's options); leave that out.
      const clone = label.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('select, textarea, input').forEach((c) => c.remove());
      if (text(clone.textContent)) return clip(text(clone.textContent));
    }
    if ('placeholder' in el && el.placeholder) return clip(text(el.placeholder));
  }
  const title = el.getAttribute('title');
  const own = text(el.textContent);
  return clip(own || text(title) || text(el.getAttribute('name')));
}

function roleOf(el: HTMLElement): ScreenElement['role'] | undefined {
  const role = el.getAttribute('role');
  if (
    role === 'tab' ||
    role === 'menuitem' ||
    role === 'switch' ||
    role === 'checkbox' ||
    role === 'radio'
  )
    return role;
  if (role === 'combobox') return 'combobox';
  if (role === 'link' || el instanceof HTMLAnchorElement) return 'link';
  if (el instanceof HTMLSelectElement) return 'combobox';
  if (el instanceof HTMLTextAreaElement) return 'textbox';
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
    if (t === 'file' || t === 'range' || t === 'color') return undefined;
    return 'textbox';
  }
  if (role === 'button' || el instanceof HTMLButtonElement) return 'button';
  return undefined;
}

/** True for controls that cannot be undone: the design system marks danger buttons, and the label says the rest. */
export function isDanger(el: HTMLElement, name: string): boolean {
  return el.dataset['danger'] === 'true' || DANGER_WORDS.test(name);
}

/** True for fields voice must never type into. */
export function isManualOnly(el: HTMLElement, name: string): boolean {
  if (el.dataset['voiceManual'] === 'true') return true;
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  return (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && SECRET_WORDS.test(name)
  );
}

/** Element handles of the last snapshot, so the model can say "b12" instead of a long name. */
let lastRefs = new Map<string, WeakRef<HTMLElement>>();

/** Every control voice can act on, in screen order, scoped to the open popup if there is one. */
export function collectElements(doc: Document = document): {
  elements: ScreenElement[];
  nodes: HTMLElement[];
  truncated: boolean;
} {
  const scope: ParentNode = activeDialog(doc) ?? doc;
  const all = [...scope.querySelectorAll<HTMLElement>(SELECTOR)].filter(
    (el) => !el.closest(VOICE_UI) && !isHidden(el),
  );
  const elements: ScreenElement[] = [];
  const nodes: HTMLElement[] = [];
  const refs = new Map<string, WeakRef<HTMLElement>>();
  for (const el of all) {
    const role = roleOf(el);
    if (!role) continue;
    const name = accessibleName(el);
    if (!name && role !== 'textbox') continue;
    if (elements.length >= MAX_ELEMENTS) {
      lastRefs = refs;
      return { elements, nodes, truncated: true };
    }
    const ref = `e${elements.length + 1}`;
    refs.set(ref, new WeakRef(el));
    const item: ScreenElement = { ref, role, name: name || '(unlabelled field)' };
    if (el instanceof HTMLSelectElement) {
      item.value = text(el.selectedOptions[0]?.textContent);
      item.options = [...el.options].map((o) => text(o.textContent)).filter(Boolean);
    } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      item.checked = el.checked;
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // Never read back what is in a secret field, not even its length.
      if (!isManualOnly(el, name)) item.value = clip(el.value);
    }
    const ariaChecked = el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected');
    if (item.checked === undefined && ariaChecked !== null) item.checked = ariaChecked === 'true';
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')
      item.disabled = true;
    if (role !== 'textbox' && isDanger(el, name)) item.danger = true;
    if (role === 'textbox' && isManualOnly(el, name)) item.manualOnly = true;
    elements.push(item);
    nodes.push(el);
  }
  lastRefs = refs;
  return { elements, nodes, truncated: false };
}

/** Headings and messages that tell the model where the user is and what just happened. */
export function readContext(doc: Document = document): {
  dialog?: string;
  headings: string[];
  messages: string[];
} {
  const dialog = activeDialog(doc);
  const scope: ParentNode = dialog ?? doc;
  const headings = [...scope.querySelectorAll<HTMLElement>('h1, h2, h3')]
    .filter((h) => !h.closest(VOICE_UI) && !isHidden(h))
    .map((h) => clip(text(h.textContent)))
    .filter(Boolean)
    .slice(0, 8);
  const messages = [...doc.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]')]
    .filter((m) => !m.closest(VOICE_UI) && !isHidden(m))
    .map((m) => clip(text(m.textContent)))
    .filter(Boolean)
    .slice(0, 5);
  const title = dialog ? accessibleName(dialog) : undefined;
  return { ...(title && { dialog: title }), headings, messages };
}

/** Outcome of finding a target by ref or name. */
export type Found = { el: HTMLElement; item: ScreenElement } | { error: string };

/**
 * Find what the model means: a ref from the last snapshot if it is still on screen, else the best name match
 * (exact, then starts with, then contains). Two equally good matches are refused so voice never guesses.
 */
export function findTarget(target: string, doc: Document = document): Found {
  const wanted = target.trim();
  const byRef = lastRefs.get(wanted)?.deref();
  const { elements, nodes } = collectElements(doc);
  if (byRef?.isConnected) {
    const i = nodes.indexOf(byRef);
    if (i >= 0) return { el: byRef, item: elements[i]! };
  }
  const q = wanted
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+(button|link|tab|field|checkbox)$/, '');
  const tiers = [
    (n: string) => n === q,
    (n: string) => n.startsWith(q),
    (n: string) => n.includes(q),
  ];
  for (const match of tiers) {
    const hits = elements.map((e, i) => ({ e, i })).filter(({ e }) => match(e.name.toLowerCase()));
    if (hits.length === 1) return { el: nodes[hits[0]!.i]!, item: hits[0]!.e };
    if (hits.length > 1) {
      return {
        error: `More than one control matches "${target}": ${hits
          .slice(0, 5)
          .map(({ e }) => `${e.ref} ${e.role} "${e.name}"`)
          .join(', ')}. Say which one.`,
      };
    }
  }
  return { error: `There is nothing called "${target}" on this screen.` };
}

/** Click as a mouse would: focus, then a real click event, so links route in-app and buttons run their handlers. */
export function click(el: HTMLElement): void {
  el.focus();
  el.click();
}

/** Set a field's text so React sees it as typed input. */
export function fill(el: HTMLElement, value: string): void {
  el.focus();
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  // React tracks the last value it set; going through the native setter makes the change visible to it.
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Choose an option of a native select by its text or value. Returns the chosen option's text, or undefined. */
export function choose(el: HTMLSelectElement, option: string): string | undefined {
  const q = option.trim().toLowerCase();
  const opts = [...el.options];
  const hit =
    opts.find((o) => text(o.textContent).toLowerCase() === q || o.value.toLowerCase() === q) ??
    opts.find((o) => text(o.textContent).toLowerCase().includes(q));
  if (!hit) return undefined;
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, hit.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return text(hit.textContent);
}

/** Press a key in the focused element (or the page). Enter in a form submits it, as the keyboard would. */
export function pressKey(key: 'Enter' | 'Escape' | 'Tab', doc: Document = document): void {
  const target = (doc.activeElement as HTMLElement | null) ?? doc.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  if (key === 'Enter' && target instanceof HTMLInputElement) target.form?.requestSubmit();
}

/**
 * Wait for the screen to settle after an action: a short pause for React to render, then until nothing is busy
 * (spinners mark buttons `aria-busy`) or a few seconds have passed.
 */
export async function settle(doc: Document = document, maxMs = 4000): Promise<void> {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await pause(120);
  const until = Date.now() + maxMs;
  while (Date.now() < until && doc.querySelector('[aria-busy="true"]')) await pause(150);
}
