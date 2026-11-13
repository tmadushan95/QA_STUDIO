/**
 * App actions pages offer to voice. Most voice commands work on any screen by clicking and typing like a person; an
 * app action is for a flow a page can do better in one step (for example "generate test cases for…"). A page
 * registers its actions while it is shown, with `useVoiceAction`, and they disappear when it unmounts.
 */
import { useEffect, useRef } from 'react';

/** What an action reports back; `message` is what the assistant tells the user. */
export interface VoiceActionResult {
  message: string;
  data?: unknown;
}

/** An action a page offers to voice. */
export interface VoiceAction {
  /** Dotted name the agent calls, such as "cases.generate". */
  name: string;
  /** One sentence for the model: what it does and which arguments it takes. */
  description: string;
  run(args: Record<string, unknown>): Promise<VoiceActionResult>;
}

const actions = new Map<string, VoiceAction>();

/** Offer an action until the returned function is called. A later registration of the same name wins. */
export function registerVoiceAction(action: VoiceAction): () => void {
  actions.set(action.name, action);
  return () => {
    if (actions.get(action.name) === action) actions.delete(action.name);
  };
}

/** The actions offered right now. */
export function listVoiceActions(): VoiceAction[] {
  return [...actions.values()];
}

/** The action with this name, if a page on screen offers it. */
export function findVoiceAction(name: string): VoiceAction | undefined {
  return actions.get(name);
}

/**
 * Offer an action while the calling component is mounted. `run` always sees the component's latest state, so it can
 * be an ordinary closure over state without listing dependencies.
 */
export function useVoiceAction(action: VoiceAction): void {
  const latest = useRef(action);
  latest.current = action;
  useEffect(
    () =>
      registerVoiceAction({
        name: action.name,
        description: action.description,
        run: (args) => latest.current.run(args),
      }),
    [action.name, action.description],
  );
}
