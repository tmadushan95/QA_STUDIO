/**
 * Turns the plain-English steps of a test case ("Click Delete", "Enter PRJ-1 in Search", "Verify 'Saved' is
 * displayed") into generic steps, without AI.
 *
 * Only sentences that match a known pattern are converted; nothing is guessed. Sentences that do not match are
 * returned as `unmatched`, so a person (or the AI drafting job) can finish them. Signing in is never a step: it is
 * done once per run from the environment's settings, so sign-in sentences are recognised and left out.
 */
import type { TestCase } from '@qa-studio/shared';
import type { PageSpec } from '../registry.js';

export interface ConvertedStep {
  action: string;
  params: Record<string, unknown>;
}

export interface Conversion {
  steps: ConvertedStep[];
  /** Sentences no pattern understood, in the order they appear. */
  unmatched: string[];
  /** Sentences recognised as signing in, which the run does by itself. */
  skippedSignIn: number;
}

/** Strip surrounding quotes and a trailing full stop: `"Delete".` → `Delete`. */
const clean = (s: string) =>
  s
    .trim()
    .replace(/[.;]+$/, '')
    .replace(/^["'“‘](.*)["'”’]$/, '$1')
    .trim();

const ROLE_WORDS: Record<string, string> = {
  button: 'button',
  link: 'link',
  tab: 'tab',
  'menu item': 'menuitem',
  menu: 'menuitem',
  checkbox: 'checkbox',
  icon: 'button',
};

type Rule = (line: string, pages: Record<string, PageSpec>) => ConvertedStep | 'sign-in' | null;

/** The patterns, tried in order. Each returns a step, `'sign-in'`, or null when it does not apply. */
const RULES: Rule[] = [
  // Signing in is handled by the run, from Settings.
  (l) => (/^(log ?in|sign ?in|login)\b/i.test(l) ? 'sign-in' : null),
  // "Open /projects" or "Navigate to /projects"
  (l) => {
    const m = /^(?:open|navigate to|go to|browse to|visit)\s+(\/\S*)$/i.exec(l);
    return m ? { action: 'open', params: { path: m[1] } } : null;
  },
  // "Go to the Draft projects page", when that page is in Settings › Pages
  (l, pages) => {
    const m = /^(?:open|navigate to|go to|visit)\s+(?:the\s+)?(.+?)(?:\s+page|\s+screen)?$/i.exec(
      l,
    );
    if (!m) return null;
    const want = clean(m[1]!).toLowerCase();
    const key = Object.keys(pages).find(
      (k) => k.toLowerCase() === want || k.toLowerCase().replace(/-/g, ' ') === want,
    );
    return key ? { action: 'go-to-page', params: { page: key } } : null;
  },
  // "Enter PRJ-1 in the Search field", "Type 'abc' into Name"
  (l) => {
    const m =
      /^(?:enter|type|input|fill in|fill)\s+(.+?)\s+(?:in|into|in the|into the)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|textbox|input))?$/i.exec(
        l,
      );
    return m
      ? { action: 'fill', params: { target: { label: clean(m[2]!) }, value: clean(m[1]!) } }
      : null;
  },
  // "Select Open from the Status dropdown"
  (l) => {
    const m =
      /^(?:select|choose|pick)\s+(.+?)\s+(?:from|in)\s+(?:the\s+)?(.+?)(?:\s+(?:dropdown|drop-down|list|menu))?$/i.exec(
        l,
      );
    return m
      ? { action: 'select', params: { target: { label: clean(m[2]!) }, option: clean(m[1]!) } }
      : null;
  },
  // "Tick the Mine only checkbox"
  (l) => {
    const m = /^(?:tick|check|enable)\s+(?:the\s+)?(.+?)\s+checkbox$/i.exec(l);
    return m ? { action: 'check', params: { target: { label: clean(m[1]!) } } } : null;
  },
  // "Click the Delete button", "Click on 'Save'", "Press the Next tab"
  (l) => {
    const m =
      /^(?:click|tap|press|select)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+(button|link|tab|menu item|menu|icon))?$/i.exec(
        l,
      );
    if (!m) return null;
    const role = ROLE_WORDS[(m[2] ?? 'button').toLowerCase()] ?? 'button';
    return { action: 'click', params: { target: { role, name: clean(m[1]!) } } };
  },
  // "Verify 'Delete' is not displayed" (before the positive rule, which would also match it)
  (l) => {
    const m =
      /^(?:verify|check|ensure|confirm|validate)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:is not|isn't|are not|is no longer)\s+(?:displayed|shown|visible|present)$/i.exec(
        l,
      );
    return m ? { action: 'assert-no-text', params: { text: clean(m[1]!) } } : null;
  },
  // "Verify 'Project deleted' is displayed", "Check that Saved appears"
  (l) => {
    const m =
      /^(?:verify|check|ensure|confirm|validate)\s+(?:that\s+)?(?:the\s+)?(?:message\s+)?(.+?)\s+(?:is\s+|are\s+)?(?:displayed|shown|visible|appears|is present)$/i.exec(
        l,
      );
    return m ? { action: 'assert-text', params: { text: clean(m[1]!) } } : null;
  },
];

/** A quoted phrase in an expected result is the text to look for: `Message "Saved" appears` → `Saved`. */
function expectedText(expected: string): string | undefined {
  const m = /["“]([^"”]{2,200})["”]/.exec(expected);
  return m?.[1];
}

function convertLine(
  line: string,
  pages: Record<string, PageSpec>,
): ConvertedStep | 'sign-in' | null {
  const l = line.trim();
  // The first rule that understands the sentence wins; the order above puts specific patterns before general ones.
  for (const rule of RULES) {
    const r = rule(l, pages);
    if (r) return r;
  }
  return null;
}

/** Convert a test case's written steps and expected results into generic steps. */
export function convertTestCase(tc: TestCase, pages: Record<string, PageSpec> = {}): Conversion {
  const steps: ConvertedStep[] = [];
  const unmatched: string[] = [];
  let skippedSignIn = 0;
  for (const s of tc.steps) {
    const r = convertLine(s.action, pages);
    if (r === 'sign-in') skippedSignIn++;
    else if (r) steps.push(r);
    else unmatched.push(s.action);
    if (s.expected) {
      const text = expectedText(s.expected);
      const e = text ? { action: 'assert-text', params: { text } } : convertLine(s.expected, pages);
      if (e && e !== 'sign-in') steps.push(e);
      else unmatched.push(`Expected: ${s.expected}`);
    }
  }
  if (tc.expectedResult) {
    const text = expectedText(tc.expectedResult);
    const e = text
      ? { action: 'assert-text', params: { text } }
      : convertLine(tc.expectedResult, pages);
    if (e && e !== 'sign-in') steps.push(e);
    else unmatched.push(`Expected: ${tc.expectedResult}`);
  }
  return { steps, unmatched, skippedSignIn };
}
