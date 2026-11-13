/**
 * How each result of the AI's step writing reads to a person: a status for the badge, a plain label, and what to do
 * next. "Cannot be automated" is shown as "Needs a manual check" with the reason, because the case still exists and
 * a person can finish or adjust it.
 */
export const OUTCOME: Record<string, { status: string; label: string; hint?: string }> = {
  drafted: { status: 'ready', label: 'Steps ready to review' },
  'needs-fixing': {
    status: 'needs-review',
    label: 'Steps need a fix',
    hint: 'Open the case on Test Case Studio: the problem is shown on the step.',
  },
  unmappable: {
    status: 'blocked',
    label: 'Needs a manual check',
    hint: 'The AI could not check the expected result in a browser. Adjust the case, or write its steps by hand.',
  },
  failed: { status: 'failed', label: 'Could not write steps', hint: 'Try again in a moment.' },
  skipped: { status: 'skipped', label: 'Already has steps' },
};
