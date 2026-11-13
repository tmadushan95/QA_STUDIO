import { describe, expect, it } from 'vitest';
import { CHUNK, EMBED_SIZE, MEL_BINS, WakeWordDetector, type WakeModels } from './detector.js';

/** Fake models: 8 mel frames per chunk, and a score that follows whatever the test sets. */
function fakeModels(scores: () => number): WakeModels & { embeds: number } {
  const m = {
    features: 4,
    embeds: 0,
    mel: async () => Array.from({ length: 8 }, () => new Float32Array(MEL_BINS)),
    embed: async () => {
      m.embeds++;
      return new Float32Array(EMBED_SIZE);
    },
    score: async () => scores(),
  };
  return m;
}

const chunks = (n: number) => new Float32Array(CHUNK * n);

describe('wake-word detector', () => {
  it('waits for a full window of mel frames and embeddings before scoring', async () => {
    const models = fakeModels(() => 0.9);
    const d = new WakeWordDetector(models, 0.5);
    // 76 frames need 10 chunks; then 4 embeddings (one per chunk) before the first score.
    const early = await d.push(chunks(12));
    expect(early.detected).toBe(false);
    const later = await d.push(chunks(1));
    expect(later.detected).toBe(true);
  });

  it('fires once per utterance and stays quiet for the debounce time', async () => {
    let t = 0;
    const d = new WakeWordDetector(
      fakeModels(() => 0.9),
      0.5,
      2000,
      () => t,
    );
    expect((await d.push(chunks(13))).detected).toBe(true);
    t = 500;
    expect((await d.push(chunks(8))).detected).toBe(false);
    t = 2600;
    expect((await d.push(chunks(4))).detected).toBe(true);
  });

  it('follows threshold changes while listening', async () => {
    const d = new WakeWordDetector(
      fakeModels(() => 0.6),
      0.7,
    );
    expect((await d.push(chunks(13))).detected).toBe(false);
    d.setThreshold(0.55);
    expect((await d.push(chunks(1))).detected).toBe(true);
  });

  it('accepts audio in pieces of any size', async () => {
    const d = new WakeWordDetector(
      fakeModels(() => 0.9),
      0.5,
    );
    let detected = false;
    for (let i = 0; i < 40 && !detected; i++)
      detected = (await d.push(new Float32Array(500))).detected;
    expect(detected).toBe(true);
  });
});
