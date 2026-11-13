/**
 * One live voice session over LiveKit: join the room, publish the microphone, play the agent's voice, stream both
 * sides' transcripts to the dock, and answer the agent's commands with `runCommand`.
 *
 * `livekit-client` is imported only when a session starts, so people who never use voice never download it.
 */
import type { Participant, RemoteTrack, Room, RoomEvent, RpcInvocationData } from 'livekit-client';
import type { VoiceCommand, VoiceRpcMethod } from '@qa-studio/shared';
import type { VoiceSessionGrant } from './api.js';
import { runCommand, type CommandHost } from './commands.js';

const RPC_METHOD: VoiceRpcMethod = 'qa.command';
/** Topic LiveKit Agents publishes transcripts on. */
const TRANSCRIPTION_TOPIC = 'lk.transcription';
/** How long to wait for the assistant to join before saying it is not running. */
const AGENT_JOIN_TIMEOUT_MS = 15_000;
/** Shown when no assistant joins: the qa-voice process is not running or cannot reach LiveKit. */
export const AGENT_MISSING =
  'The voice assistant did not join. Start it with "npm run voice" in Backend/Worker (npm start starts it too), then try again.';

/** Resolves true once an agent is in the room, or false after the timeout. */
function agentJoined(room: Room, connectedEvent: RoomEvent.ParticipantConnected): Promise<boolean> {
  if ([...room.remoteParticipants.values()].some((p) => p.isAgent)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onJoin = (p: Participant) => {
      if (!p.isAgent) return;
      clearTimeout(timer);
      room.off(connectedEvent, onJoin);
      resolve(true);
    };
    const timer = setTimeout(() => {
      room.off(connectedEvent, onJoin);
      resolve(false);
    }, AGENT_JOIN_TIMEOUT_MS);
    room.on(connectedEvent, onJoin);
  });
}

/** What the agent is doing, as LiveKit Agents reports it. */
export type AgentState = 'connecting' | 'initializing' | 'listening' | 'thinking' | 'speaking';

/** A line of the conversation. Interim lines are replaced as speech continues; final ones stay. */
export interface TranscriptLine {
  id: string;
  who: 'you' | 'assistant';
  text: string;
  final: boolean;
}

/** Callbacks from a session to the UI. */
export interface SessionHandlers extends CommandHost {
  onAgentState(state: AgentState): void;
  onTranscript(line: TranscriptLine): void;
  /** The session closed: the user ended it, the agent left, or the connection dropped. */
  onClosed(reason: string): void;
}

/** A running session. */
export interface LiveSession {
  close(): Promise<void>;
  setMicrophone(on: boolean): Promise<void>;
}

/** Join the session's room and start talking. Rejects if the room or the microphone cannot be opened. */
export async function openSession(
  grant: VoiceSessionGrant,
  handlers: SessionHandlers,
): Promise<LiveSession> {
  const { Room, RoomEvent, Track } = await import('livekit-client');
  const room: Room = new Room({ adaptiveStream: false, dynacast: false });
  const audio = new Set<HTMLMediaElement>();
  let closed = false;

  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    audio.forEach((el) => el.remove());
    audio.clear();
    handlers.onClosed(reason);
  };

  room.registerRpcMethod(RPC_METHOD, async (data: RpcInvocationData) => {
    let command: VoiceCommand;
    try {
      command = JSON.parse(data.payload) as VoiceCommand;
    } catch {
      return JSON.stringify({ ok: false, message: 'The command was not readable.' });
    }
    return JSON.stringify(await runCommand(command, handlers));
  });

  room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, from) => {
    const attrs = reader.info.attributes ?? {};
    const trackId = attrs['lk.transcribed_track_id'];
    const mine =
      from.identity === room.localParticipant.identity ||
      (trackId !== undefined &&
        [...room.localParticipant.trackPublications.values()].some((p) => p.trackSid === trackId));
    const who = mine ? 'you' : 'assistant';
    const id = attrs['lk.segment_id'] ?? reader.info.id;
    void (async () => {
      let text = '';
      for await (const chunk of reader) {
        text += chunk;
        handlers.onTranscript({ id, who, text, final: false });
      }
      handlers.onTranscript({ id, who, text, final: true });
    })();
  });

  room.on(
    RoomEvent.ParticipantAttributesChanged,
    (_changed: Record<string, string>, p: Participant) => {
      const state = p.attributes['lk.agent.state'];
      if (state) handlers.onAgentState(state as AgentState);
    },
  );
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.dataset['voiceUi'] = 'true';
    el.hidden = true;
    document.body.appendChild(el);
    audio.add(el);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    track.detach().forEach((el) => {
      el.remove();
      audio.delete(el);
    });
  });
  // The agent leaving (goodbye or idle timeout) ends the session, so the dock goes back to standby.
  room.on(RoomEvent.ParticipantDisconnected, (p: Participant) => {
    if (p.isAgent) void room.disconnect().then(() => finish('The assistant ended the session.'));
  });
  room.on(RoomEvent.Disconnected, () => finish('Disconnected.'));

  handlers.onAgentState('connecting');
  await room.connect(grant.url, grant.token, { autoSubscribe: true });
  try {
    await room.localParticipant.setMicrophoneEnabled(true, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  } catch (e) {
    await room.disconnect();
    throw e;
  }

  // The room exists as soon as we join; the assistant is a separate process that may not be running. Without this
  // check the user would talk into an empty room with no reply.
  if (!(await agentJoined(room, RoomEvent.ParticipantConnected))) {
    closed = true;
    await room.disconnect();
    throw new Error(AGENT_MISSING);
  }

  return {
    async close() {
      await room.disconnect();
      finish('Ended.');
    },
    async setMicrophone(on) {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
  };
}
