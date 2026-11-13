/**
 * Carries out one voice command and reports the screen afterwards. This is the browser half of the voice contract
 * (`VoiceCommand` in packages/shared): the agent decides, this code acts, and it alone decides what is allowed.
 */
import type {
  ScreenSnapshot,
  VoiceCommand,
  VoiceCommandResult,
  VoicePage,
} from '@qa-studio/shared';
import { errorMessage } from '../../shared/api/http.js';
import { href, hrefIn, isProjectPage, navigate, parseRoute } from '../../shared/hooks/useRoute.js';
import { findVoiceAction, listVoiceActions } from './registry.js';
import {
  choose,
  click,
  collectElements,
  fill,
  findTarget,
  pressKey,
  readContext,
  settle,
} from './screen.js';

/** What a command needs from the app around it. */
export interface CommandHost {
  /** Called for the "end" command, after the answer is sent. */
  onEnd(): void;
  /** Called with a short line for the dock, such as "Clicked Save". */
  onActivity?(line: string): void;
}

/** The screen right now, with the actions pages offer. */
export function snapshot(doc: Document = document): ScreenSnapshot {
  const route = parseRoute(window.location.pathname);
  const { elements, truncated } = collectElements(doc);
  return {
    title: doc.title,
    page: route.page,
    ...(route.project && { project: route.project }),
    ...readContext(doc),
    elements,
    truncated,
    actions: listVoiceActions().map(({ name, description }) => ({ name, description })),
  };
}

const fail = (message: string): VoiceCommandResult => ({ ok: false, message, screen: snapshot() });

/** Address of a page, keeping the current project unless another is named. */
function addressOf(page: VoicePage, section?: string, project?: string): string | undefined {
  if (page === 'home') return href('home');
  if (page === 'settings') return href('settings', section);
  if (project) return hrefIn(project, page, section);
  if (isProjectPage(page) && !parseRoute(window.location.pathname).project) return undefined;
  return href(page, section);
}

/** Run one command. Never throws: failures come back as `{ ok: false }` with a message the assistant can say. */
export async function runCommand(
  cmd: VoiceCommand,
  host: CommandHost,
): Promise<VoiceCommandResult> {
  try {
    switch (cmd.kind) {
      case 'screen':
        return { ok: true, message: 'This is the current screen.', screen: snapshot() };

      case 'navigate': {
        const to = addressOf(cmd.page, cmd.section, cmd.project);
        if (!to)
          return fail(
            'No project is open. Open one from the project list first, or name the project.',
          );
        navigate(to);
        window.scrollTo({ top: 0 });
        host.onActivity?.(`Opened ${cmd.page}`);
        // Pages load on first visit; give the new page time to appear before describing it.
        await settle(document, 6000);
        return { ok: true, message: `Opened ${document.title}.`, screen: snapshot() };
      }

      case 'click': {
        const found = findTarget(cmd.target);
        if ('error' in found) return fail(found.error);
        const { el, item } = found;
        if (item.disabled) return fail(`"${item.name}" is disabled right now.`);
        if (item.danger && !cmd.confirmed) {
          // The model must hear a yes from the user; the browser holds the line even if the model does not.
          return {
            ok: false,
            message: `"${item.name}" cannot be undone, so it needs the user's confirmation.`,
            needsConfirmation: `${item.name}. Are you sure?`,
            screen: snapshot(),
          };
        }
        click(el);
        host.onActivity?.(`Clicked ${item.name}`);
        await settle();
        return { ok: true, message: `Clicked "${item.name}".`, screen: snapshot() };
      }

      case 'fill': {
        const found = findTarget(cmd.target);
        if ('error' in found) return fail(found.error);
        const { el, item } = found;
        if (item.role !== 'textbox') return fail(`"${item.name}" is not a text field.`);
        if (item.manualOnly) {
          return fail(
            `"${item.name}" holds a secret or a confirmation, so the user has to type it.`,
          );
        }
        if (item.disabled) return fail(`"${item.name}" is disabled right now.`);
        fill(el, cmd.value);
        host.onActivity?.(`Typed into ${item.name}`);
        await settle();
        return { ok: true, message: `Entered the text in "${item.name}".`, screen: snapshot() };
      }

      case 'select': {
        const found = findTarget(cmd.target);
        if ('error' in found) return fail(found.error);
        const { el, item } = found;
        if (!(el instanceof HTMLSelectElement)) {
          // A custom dropdown: open it, then the option is an ordinary click target.
          click(el);
          await settle();
          const option = findTarget(cmd.option);
          if ('error' in option) return fail(`Opened "${item.name}". ${option.error}`);
          click(option.el);
          await settle();
          return { ok: true, message: `Chose "${option.item.name}".`, screen: snapshot() };
        }
        const chosen = choose(el, cmd.option);
        if (!chosen) {
          return fail(
            `"${item.name}" has no option "${cmd.option}". Options: ${(item.options ?? []).join(', ')}.`,
          );
        }
        host.onActivity?.(`Chose ${chosen}`);
        await settle();
        return { ok: true, message: `Chose "${chosen}" in "${item.name}".`, screen: snapshot() };
      }

      case 'check': {
        const found = findTarget(cmd.target);
        if ('error' in found) return fail(found.error);
        const { el, item } = found;
        if (item.disabled) return fail(`"${item.name}" is disabled right now.`);
        if (item.checked === cmd.checked) {
          return {
            ok: true,
            message: `"${item.name}" is already ${cmd.checked ? 'on' : 'off'}.`,
            screen: snapshot(),
          };
        }
        click(el);
        host.onActivity?.(`${cmd.checked ? 'Ticked' : 'Unticked'} ${item.name}`);
        await settle();
        return {
          ok: true,
          message: `Turned "${item.name}" ${cmd.checked ? 'on' : 'off'}.`,
          screen: snapshot(),
        };
      }

      case 'key':
        pressKey(cmd.key);
        await settle();
        return { ok: true, message: `Pressed ${cmd.key}.`, screen: snapshot() };

      case 'action': {
        const action = findVoiceAction(cmd.name);
        if (!action) {
          return fail(
            `"${cmd.name}" is not available on this screen. Use the actions listed, or click and type instead.`,
          );
        }
        host.onActivity?.(action.description.split('.')[0] ?? action.name);
        const out = await action.run(cmd.args ?? {});
        await settle();
        return {
          ok: true,
          message: out.message,
          ...(out.data !== undefined && { data: out.data }),
          screen: snapshot(),
        };
      }

      case 'end':
        // Answer first; the session closes right after, so the agent still hears that it worked.
        setTimeout(() => host.onEnd(), 0);
        return { ok: true, message: 'Ending the voice session.' };
    }
  } catch (e) {
    return fail(errorMessage(e));
  }
}
