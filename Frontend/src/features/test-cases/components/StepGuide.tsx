/**
 * StepGuide: a short, friendly explanation of how steps work, for someone who has never written an automated test.
 * It is open the first time, then stays closed once dismissed (remembered per browser); "How steps work" opens it again.
 *
 * Two variants: `case` explains the steps of a test case; `recipe` explains how a custom step is built from inputs
 * and a body, shown where a project defines its own steps.
 */
import { useState } from 'react';
import { Icon, type IconName } from '../../../design-system/index.js';
import { href } from '../../../shared/hooks/useRoute.js';
import styles from './StepGuide.module.css';

const KEY = 'qa-studio.step-guide-closed';

/** Closed once the person closed it; before that it follows `defaultOpen` (open only where there is nothing else to read). */
const readClosed = (variant: string, defaultOpen: boolean): boolean => {
  try {
    const stored = window.localStorage.getItem(`${KEY}.${variant}`);
    if (stored !== null) return stored === 'true';
  } catch {
    // Storage can be blocked (private mode); fall back to the default.
  }
  return !defaultOpen;
};

interface Point {
  icon: IconName;
  title: string;
  text: JSX.Element | string;
}

const CASE_POINTS: Point[] = [
  {
    icon: 'execute',
    title: 'A step is one thing a person would do',
    text: 'Open a page, click a button, type in a field, check what is shown. QA Studio runs the steps from top to bottom in a real browser.',
  },
  {
    icon: 'design',
    title: 'Pick the action',
    text: (
      <>
        The first list chooses what to do. The standard steps work in any application. Steps your
        project defined itself are under <strong>Custom steps of this project</strong>.
      </>
    ),
  },
  {
    icon: 'search',
    title: 'Describe the element as you see it',
    text: 'Say “Button named Delete” or “Field labelled Search”. Add “Where” to narrow it: in the dialog, or in the table row containing a value. No technical selectors needed.',
  },
  {
    icon: 'sliders',
    title: 'Use parameters for values that change',
    text: (
      <>
        Press <code>{'{ }'}</code> next to a text box to insert a value such as{' '}
        <code>{'{{data.projectCode}}'}</code>. Set its value on the <strong>Parameters</strong> tab,
        for this case or for the whole project.
      </>
    ),
  },
  {
    icon: 'check',
    title: 'Check steps decide pass or fail',
    text: 'A “Check” step (text is shown, value equals, number of rows) fails the test when the application does not match. The sentence under each step says what it checks.',
  },
];

const RECIPE_POINTS: Point[] = [
  {
    icon: 'sliders',
    title: '1. Inputs: what changes each time',
    text: 'An input is a blank a test case fills in, such as the Role or the Permission to check. Each input becomes a field when the step is used.',
  },
  {
    icon: 'execute',
    title: '2. Steps: what it does',
    text: (
      <>
        Build the recipe from the standard steps. Press <code>{'{ }'}</code> next to a text box to
        use an input there; it is written <code>{'{{input.role}}'}</code>.
      </>
    ),
  },
  {
    icon: 'design',
    title: '3. Use it in test cases',
    text: 'It appears in the step list under “Custom steps of this project”. A test case chooses it and fills the inputs, instead of repeating the same steps again and again.',
  },
];

/** The beginner explanation of steps. */
export function StepGuide({
  variant = 'case',
  defaultOpen = true,
}: {
  variant?: 'case' | 'recipe';
  /** Open the first time (until the person closes it). Pass false where steps already fill the screen. */
  defaultOpen?: boolean;
}) {
  const [closed, setClosed] = useState(() => readClosed(variant, defaultOpen));
  const toggle = (open: boolean) => {
    // The browser also reports the state it was rendered in; only a change by the person is remembered.
    if (open === !closed) return;
    setClosed(!open);
    try {
      window.localStorage.setItem(`${KEY}.${variant}`, String(!open));
    } catch {
      // Storage can be blocked (private mode); the choice then lasts for this visit only.
    }
  };
  const points = variant === 'case' ? CASE_POINTS : RECIPE_POINTS;
  return (
    <details
      className={styles.guide}
      open={!closed}
      onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Icon name="info" size={16} />
        <span>{variant === 'case' ? 'How steps work' : 'How a custom step works'}</span>
        <span className={styles.hint}>{closed ? 'Show' : 'Hide'}</span>
      </summary>
      <ul className={styles.points}>
        {points.map((p) => (
          <li key={p.title}>
            <span className={styles.icon} aria-hidden="true">
              <Icon name={p.icon} size={16} />
            </span>
            <span>
              <strong>{p.title}</strong>
              <span className={styles.text}>{p.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {variant === 'case' && (
        <div className={styles.example}>
          <strong>Example: create a project</strong>
          <ol>
            <li>
              Go to page <em>Projects</em>
            </li>
            <li>Click button “New project”</li>
            <li>Fill field “Code” with “{'{{data.projectCode}}'}”</li>
            <li>Check text “Project created” is shown</li>
          </ol>
          <p>
            Doing the same few steps in many cases? Save them once as a{' '}
            <a href={href('project-settings', 'custom-steps')}>custom step</a> and reuse it.
          </p>
        </div>
      )}
    </details>
  );
}
