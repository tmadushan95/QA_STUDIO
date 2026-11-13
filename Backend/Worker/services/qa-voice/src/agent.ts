import { defineAgent, inference, voice, type JobContext } from '@livekit/agents';
import type { VoiceCommand, VoiceCommandResult, VoiceRpcMethod } from '@qa-studio/shared';
import { COMMAND_TIMEOUT_MS, parseMetadata, speechModels } from './config.js';
import { instructions } from './instructions.js';
import { buildTools } from './tools.js';

const RPC_METHOD: VoiceRpcMethod = 'qa.command';

/**
 * One voice session. The pipeline is speech-to-text, a language model with tools, then text-to-speech, all through
 * LiveKit Inference (no provider keys of our own). The model never touches the app directly: each tool call becomes an
 * RPC to the user's browser, which performs it with the app's own code.
 */
export default defineAgent({
  entry: async (ctx: JobContext) => {
    const meta = parseMetadata(ctx.job.metadata);
    await ctx.connect();
    const user = await ctx.waitForParticipant(meta.userIdentity);

    const send = async (command: VoiceCommand): Promise<VoiceCommandResult> => {
      const local = ctx.room.localParticipant;
      if (!local) return { ok: false, message: 'Not connected to the room.' };
      try {
        const answer = await local.performRpc({
          destinationIdentity: user.identity,
          method: RPC_METHOD,
          payload: JSON.stringify(command),
          responseTimeout: COMMAND_TIMEOUT_MS,
        });
        return JSON.parse(answer) as VoiceCommandResult;
      } catch (e) {
        // The tab was closed, the page reloaded, or the step took too long. Say so instead of going silent.
        return {
          ok: false,
          message: `The app did not answer (${e instanceof Error ? e.message : 'unknown error'}).`,
        };
      }
    };

    const speech = speechModels(process.env);
    const session = new voice.AgentSession({
      stt: new inference.STT({ model: speech.stt, language: meta.language }),
      llm: new inference.LLM({ model: meta.model }),
      tts: new inference.TTS({ model: speech.tts, language: meta.language }),
      // The user going quiet for this long ends the session; the browser then goes back to waiting for the wake phrase.
      userAwayTimeout: meta.idleTimeoutSec,
      // Operating the UI takes several steps (look, click, type, check).
      maxToolSteps: 8,
    });

    let ending = false;
    const end = () => {
      if (ending) return;
      ending = true;
      // Let the goodbye finish playing before the room closes.
      setTimeout(() => ctx.shutdown('user ended the conversation'), 2500);
    };
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === 'away' && !ending) {
        void session.say('I will stop listening now. Say the wake phrase when you need me.');
        end();
      }
    });

    await session.start({
      agent: new voice.Agent({
        instructions: instructions(meta),
        tools: Object.values(buildTools(send, end)),
      }),
      room: ctx.room,
    });
    session.generateReply({ instructions: 'Greet the user briefly and ask what they want to do.' });
  },
});
