import { llm } from '@livekit/agents';
import { z } from 'zod';
import type { VoiceCommand, VoiceCommandResult, ScreenSnapshot } from '@qa-studio/shared';

/** Sends one command to the browser and returns its answer. */
export type SendCommand = (command: VoiceCommand) => Promise<VoiceCommandResult>;

const PAGES = [
  'home',
  'settings',
  'dashboard',
  'design',
  'ai',
  'execution',
  'runs',
  'azure-devops',
  'project-settings',
] as const;

/** Longest screen description handed to the model, so one busy page cannot flood its context. */
const MAX_SCREEN_CHARS = 6000;

/** A compact, model-friendly text form of the screen. */
export function describeScreen(s: ScreenSnapshot | undefined): string {
  if (!s) return '';
  const lines = [
    `PAGE: ${s.title}${s.dialog ? `\nOPEN POPUP: ${s.dialog} (act inside it, or press Escape to close)` : ''}`,
    s.headings.length > 0 ? `HEADINGS: ${s.headings.join(' | ')}` : '',
    s.messages.length > 0 ? `MESSAGES: ${s.messages.join(' | ')}` : '',
    'ELEMENTS (ref role "name" [state]):',
    ...s.elements.map((e) => {
      const state = [
        e.value !== undefined && e.value !== '' ? `value="${e.value}"` : '',
        e.options ? `options=${e.options.slice(0, 12).join('/')}` : '',
        e.checked !== undefined ? (e.checked ? 'on' : 'off') : '',
        e.disabled ? 'disabled' : '',
        e.danger ? 'DANGER' : '',
        e.manualOnly ? 'USER-MUST-TYPE' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `${e.ref} ${e.role} "${e.name}"${state ? ` [${state}]` : ''}`;
    }),
    s.truncated ? '(more elements not listed; scroll or open a section to see them)' : '',
    s.actions.length > 0
      ? `APP ACTIONS: ${s.actions.map((a) => `${a.name} — ${a.description}`).join('; ')}`
      : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  return text.length > MAX_SCREEN_CHARS ? `${text.slice(0, MAX_SCREEN_CHARS)}\n(cut)` : text;
}

/** What a tool returns to the model: the browser's message, then the screen as it is now. */
export function toolAnswer(r: VoiceCommandResult): string {
  return [
    r.ok ? `OK: ${r.message}` : `FAILED: ${r.message}`,
    r.needsConfirmation
      ? `NEEDS CONFIRMATION: ask the user "${r.needsConfirmation}" and only repeat the click with confirmed=true after a clear yes.`
      : '',
    r.data !== undefined ? `DATA: ${JSON.stringify(r.data).slice(0, 3000)}` : '',
    describeScreen(r.screen),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The agent's tools. Each one is a single browser command; the browser enforces the safety rules (dangerous clicks
 * need confirmation, no typing into password, key or type-to-confirm boxes), so a misbehaving model cannot skip them.
 */
export function buildTools(send: SendCommand, onEnd: () => void) {
  const run = async (command: VoiceCommand) => toolAnswer(await send(command));
  return {
    look_at_screen: llm.tool({
      name: 'look_at_screen',
      description:
        'Read what the user is looking at: page, popup, messages, and every button, link, field, tab and checkbox with a ref. Call it before acting when you do not know the current screen.',
      execute: () => run({ kind: 'screen' }),
    }),
    open_page: llm.tool({
      name: 'open_page',
      description:
        'Open a page of QA Studio. home = project list; settings = organization settings (sections: execution, pages, ai, voice, data, audit, about); dashboard, design = Test Case Studio, ai = AI Assistant, execution = Test Execution, runs = Run History, azure-devops, project-settings (sections: general, versions, test-suites, parameters, sign-in-users). Pass project (its code) to open a page in another project.',
      parameters: z.object({
        page: z.enum(PAGES),
        section: z.string().max(60).optional(),
        project: z.string().max(60).optional(),
      }),
      execute: ({ page, section, project }) =>
        run({
          kind: 'navigate',
          page,
          ...(section && { section }),
          ...(project && { project }),
        }),
    }),
    click: llm.tool({
      name: 'click',
      description:
        'Click a button, link, tab or menu item by its ref (preferred) or its visible name. For an element marked DANGER, first ask the user, then call again with confirmed=true only after a clear yes.',
      parameters: z.object({
        target: z.string().min(1).max(200),
        confirmed: z.boolean().optional(),
      }),
      execute: ({ target, confirmed }) =>
        run({ kind: 'click', target, ...(confirmed && { confirmed: true }) }),
    }),
    type_text: llm.tool({
      name: 'type_text',
      description:
        'Replace the text in a field by its ref or label. Never for fields marked USER-MUST-TYPE: ask the user to type those.',
      parameters: z.object({ target: z.string().min(1).max(200), value: z.string().max(4000) }),
      execute: ({ target, value }) => run({ kind: 'fill', target, value }),
    }),
    choose_option: llm.tool({
      name: 'choose_option',
      description: 'Choose an option in a dropdown by its ref or label.',
      parameters: z.object({ target: z.string().min(1).max(200), option: z.string().max(200) }),
      execute: ({ target, option }) => run({ kind: 'select', target, option }),
    }),
    set_checkbox: llm.tool({
      name: 'set_checkbox',
      description: 'Tick or untick a checkbox or switch by its ref or label.',
      parameters: z.object({ target: z.string().min(1).max(200), checked: z.boolean() }),
      execute: ({ target, checked }) => run({ kind: 'check', target, checked }),
    }),
    press_key: llm.tool({
      name: 'press_key',
      description:
        'Press Enter (submit), Escape (close a popup or menu) or Tab in the focused element.',
      parameters: z.object({ key: z.enum(['Enter', 'Escape', 'Tab']) }),
      execute: ({ key }) => run({ kind: 'key', key }),
    }),
    app_action: llm.tool({
      name: 'app_action',
      description:
        'Run an APP ACTION listed on the current screen, with its arguments. Prefer these over clicking when one fits (for example cases.generate on the AI Assistant).',
      parameters: z.object({
        name: z.string().min(1).max(80),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: ({ name, args }) => run({ kind: 'action', name, ...(args && { args }) }),
    }),
    end_conversation: llm.tool({
      name: 'end_conversation',
      description:
        'End the voice session when the user says they are done (for example "that is all", "stop", "bye"). Say a short goodbye first.',
      execute: async () => {
        await send({ kind: 'end' }).catch(() => undefined);
        onEnd();
        return 'Session ending.';
      },
    }),
  };
}
