import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { SqliteStorage } from './sqlite-storage.js';
import {
  VOICE_AGENT_NAME,
  VoiceService,
  liveKitTransport,
  type VoiceAgentMetadata,
  type VoiceTransport,
} from './voice-service.js';

function setup(transport?: VoiceTransport) {
  const storage = new SqliteStorage(':memory:');
  const audit: string[] = [];
  const build = () =>
    new VoiceService({
      store: storage,
      transport,
      audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
      now: () => new Date('2026-11-12T10:00:00Z'),
    });
  const voice = build();
  const app = createApp(undefined, { voice });
  return { app, voice, audit, build };
}

/** Records what the service asked for instead of signing a real token. */
function fakeTransport() {
  const calls: { room: string; identity: string; metadata: VoiceAgentMetadata }[] = [];
  const transport: VoiceTransport = {
    url: 'wss://voice.example.invalid',
    createToken: async (room, identity, metadata) => {
      calls.push({ room, identity, metadata });
      return 'signed-token';
    },
  };
  return { transport, calls };
}

describe('voice settings', () => {
  it('starts off, push to talk, and says whether LiveKit is set up without exposing keys', async () => {
    const { app } = setup();
    const v = (await app.inject({ url: '/api/voice' })).json();
    expect(v).toMatchObject({
      enabled: false,
      activation: 'ptt',
      wakePhrase: 'hey_qa_studio',
      sensitivity: 0.5,
      idleTimeoutSec: 20,
      coverage: 'standard',
      format: 'steps',
      livekitConfigured: false,
    });
    expect(v.wakePhrases.map((w: { id: string }) => w.id)).toContain('hey_qa_studio');
    expect(JSON.stringify(v)).not.toMatch(/secret|apiKey/i);
  });

  it('saves changes, keeps them across a restart and audits them', async () => {
    const { app, build, audit } = setup();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/voice',
      payload: { enabled: true, activation: 'wake', sensitivity: 0.65, coverage: 'thorough' },
    });
    expect(r.statusCode).toBe(200);
    expect(build().view()).toMatchObject({
      enabled: true,
      activation: 'wake',
      sensitivity: 0.65,
      coverage: 'thorough',
    });
    expect(audit.some((a) => a.startsWith('voice.update|voice|On; wake phrase'))).toBe(true);
  });

  it('refuses values outside the allowed ranges with a message per field', async () => {
    const { app } = setup();
    const r = await app.inject({
      method: 'PUT',
      url: '/api/voice',
      payload: { sensitivity: 0.95, wakePhrase: 'hey_computer', language: 'English' },
    });
    expect(r.statusCode).toBe(400);
    const fields = r.json().error.fields;
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(['sensitivity', 'wakePhrase', 'language']),
    );
  });
});

describe('voice sessions', () => {
  it('refuses while voice is off, and explains how to set up LiveKit when it is missing', async () => {
    const off = setup(fakeTransport().transport);
    const r1 = await off.app.inject({ method: 'POST', url: '/api/voice/session' });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error.code).toBe('voice-off');

    const unconfigured = setup();
    unconfigured.voice.update({ enabled: true });
    const r2 = await unconfigured.app.inject({ method: 'POST', url: '/api/voice/session' });
    expect(r2.statusCode).toBe(503);
    expect(r2.json().error.message).toContain('QA_LIVEKIT_URL');
  });

  it('gives the browser a fresh room and identity, and hands the agent the settings', async () => {
    const { transport, calls } = fakeTransport();
    const { app, voice } = setup(transport);
    voice.update({ enabled: true, coverage: 'smoke', model: 'openai/gpt-4.1-mini' });
    const r = await app.inject({ method: 'POST', url: '/api/voice/session' });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s).toMatchObject({
      url: 'wss://voice.example.invalid',
      token: 'signed-token',
      expiresAt: '2026-11-12T10:15:00.000Z',
    });
    expect(s.room).toMatch(/^qa-voice-/);
    expect(calls[0]).toMatchObject({
      room: s.room,
      identity: s.identity,
      metadata: { userIdentity: s.identity, coverage: 'smoke', model: 'openai/gpt-4.1-mini' },
    });
    const again = (await app.inject({ method: 'POST', url: '/api/voice/session' })).json();
    expect(again.room).not.toBe(s.room);
  });
});

describe('LiveKit transport', () => {
  it('exists only when all three settings are present', () => {
    expect(liveKitTransport({ QA_LIVEKIT_URL: 'wss://x.invalid' })).toBeUndefined();
    expect(
      liveKitTransport({
        QA_LIVEKIT_URL: 'wss://x.invalid',
        QA_LIVEKIT_API_KEY: 'key',
        QA_LIVEKIT_API_SECRET: 'a-secret-that-is-long-enough-to-sign-with',
      }),
    ).toBeDefined();
  });

  it('signs a token for one room only, with the agent dispatched on join', async () => {
    const t = liveKitTransport({
      QA_LIVEKIT_URL: 'wss://x.invalid',
      QA_LIVEKIT_API_KEY: 'key',
      QA_LIVEKIT_API_SECRET: 'a-secret-that-is-long-enough-to-sign-with',
    })!;
    const jwt = await t.createToken('qa-voice-1', 'qa-user-1', {
      userIdentity: 'qa-user-1',
      model: 'google/gemini-2.5-flash',
      language: 'en',
      coverage: 'standard',
      format: 'steps',
      idleTimeoutSec: 20,
    });
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));
    expect(payload.sub).toBe('qa-user-1');
    expect(payload.video).toMatchObject({
      room: 'qa-voice-1',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(payload.video.roomAdmin).toBeUndefined();
    expect(payload.video.roomCreate).toBeUndefined();
    expect(JSON.stringify(payload.roomConfig)).toContain(VOICE_AGENT_NAME);
  });
});
