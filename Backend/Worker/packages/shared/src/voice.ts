/**
 * The contract between the voice agent (services/qa-voice) and the web app. The agent only understands speech and
 * decides what to do; every command is carried out in the browser by the same code a mouse click or keystroke runs, so
 * validation, permissions, confirmations and the audit trail are exactly those of the UI.
 *
 * Transport: one LiveKit RPC method, `VOICE_RPC_METHOD`, from the agent to the browser participant. The payload is a
 * JSON `VoiceCommand`; the answer is a JSON `VoiceCommandResult`. Types only: the web app imports nothing at run time.
 */

/** The RPC method name both sides use. */
export type VoiceRpcMethod = 'qa.command';

/** Pages the agent can open, by the app's internal page IDs. */
export type VoicePage =
  | 'home'
  | 'settings'
  | 'dashboard'
  | 'design'
  | 'ai'
  | 'execution'
  | 'runs'
  | 'azure-devops'
  | 'project-settings';

/** Something on screen the agent may act on, described the way a screen reader would. */
export interface ScreenElement {
  /** Short handle, valid until the screen changes. Prefer it over the name when acting. */
  ref: string;
  role:
    | 'button'
    | 'link'
    | 'textbox'
    | 'combobox'
    | 'checkbox'
    | 'radio'
    | 'tab'
    | 'menuitem'
    | 'switch';
  name: string;
  value?: string;
  options?: string[];
  checked?: boolean;
  disabled?: boolean;
  /** Deletes, clears, discards or otherwise cannot be undone: needs the user's spoken yes first. */
  danger?: boolean;
  /** Voice may not type here (passwords, keys, type-to-confirm boxes); the user must type it. */
  manualOnly?: boolean;
}

/** What the user is looking at. */
export interface ScreenSnapshot {
  /** Window title, such as "Test Case Studio · Customer Portal · QA Studio". */
  title: string;
  page: string;
  project?: string;
  /** Title of the open popup, when one is open; actions then apply inside it. */
  dialog?: string;
  headings: string[];
  /** Messages currently shown (errors, warnings, toasts). */
  messages: string[];
  elements: ScreenElement[];
  /** True when more elements exist than were listed. */
  truncated: boolean;
  /** App actions available on this screen (see `VoiceCommand` kind "action"). */
  actions: { name: string; description: string }[];
}

/** A command from the agent. */
export type VoiceCommand =
  | { kind: 'screen' }
  | { kind: 'navigate'; page: VoicePage; section?: string; project?: string }
  | { kind: 'click'; target: string; confirmed?: boolean }
  | { kind: 'fill'; target: string; value: string }
  | { kind: 'select'; target: string; option: string }
  | { kind: 'check'; target: string; checked: boolean }
  | { kind: 'key'; key: 'Enter' | 'Escape' | 'Tab' }
  | { kind: 'action'; name: string; args?: Record<string, unknown> }
  | { kind: 'end' };

/** The browser's answer. `message` is written so the agent can say it, or use it to decide what to say. */
export interface VoiceCommandResult {
  ok: boolean;
  message: string;
  /** The screen after the command, so the agent knows what changed without another round trip. */
  screen?: ScreenSnapshot;
  /** Set when a dangerous control was asked for without `confirmed`: ask the user, then click again with it. */
  needsConfirmation?: string;
  /** Extra data from an app action, such as clarifying questions or generated case titles. */
  data?: unknown;
}

/** Job metadata the API gives the agent when it dispatches it (see VoiceAgentMetadata in qa-api). */
export interface VoiceJobMetadata {
  userIdentity: string;
  model: string;
  language: string;
  coverage: 'smoke' | 'standard' | 'thorough';
  format: 'steps' | 'gherkin';
  idleTimeoutSec: number;
}
