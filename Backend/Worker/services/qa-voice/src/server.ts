#!/usr/bin/env node
/**
 * Starts the QA Studio voice agent worker. It registers with LiveKit under the name "qa-studio" and joins a room only
 * when qa-api dispatches it for a voice session. Settings come from Backend/Worker/.env.
 *
 *   node services/qa-voice/dist/server.js dev     (development: logs, reloads)
 *   node services/qa-voice/dist/server.js start   (production)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerOptions, cli } from '@livekit/agents';
import { AGENT_NAME, applyLiveKitEnv } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../.env'));
} catch {
  // No .env file: rely on the process environment.
}

if (!applyLiveKitEnv(process.env).configured) {
  process.stderr.write(
    'Voice agent not started: set QA_LIVEKIT_URL, QA_LIVEKIT_API_KEY and QA_LIVEKIT_API_SECRET in Backend/Worker/.env.\n',
  );
  process.exit(1);
}

cli.runApp(
  new ServerOptions({
    agent: path.join(here, 'agent.js'),
    // Explicit dispatch: the agent only joins rooms qa-api asks for, never every room in the LiveKit project.
    agentName: AGENT_NAME,
  }),
);
