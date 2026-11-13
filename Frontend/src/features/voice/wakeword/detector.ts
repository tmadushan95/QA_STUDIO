/**
 * Wake-word detection, the openWakeWord way (the format livekit-wakeword exports): 16 kHz audio in 80 ms chunks →
 * mel-spectrogram frames → a 96-number embedding for every 8 new frames (from the last 76) → the phrase model scores
 * the last 16 embeddings between 0 and 1. A score at or above the threshold is a detection, then nothing for the
 * debounce time, so one utterance never fires twice.
 *
 * The three models are behind `WakeModels` so this logic is testable without ONNX Runtime.
 */

/** Audio rate the models expect. */
export const SAMPLE_RATE = 16_000;
/** Samples per chunk pushed to the detector (80 ms). */
export const CHUNK = 1280;
/** Mel frames the embedding model reads at once, and mel bins per frame. */
export const EMBED_WINDOW = 76;
export const MEL_BINS = 32;
/** New mel frames between embeddings (8 frames = 80 ms). */
export const EMBED_STEP = 8;
/** Length of one embedding. */
export const EMBED_SIZE = 96;

/** The three models of the pipeline. */
export interface WakeModels {
  /** Mel frames (each `MEL_BINS` long) for a chunk of audio with a little context before it. */
  mel(audio: Float32Array): Promise<Float32Array[]>;
  /** One embedding from `EMBED_WINDOW` mel frames. */
  embed(frames: Float32Array[]): Promise<Float32Array>;
  /** Score 0..1 from the last `features` embeddings. */
  score(embeddings: Float32Array[]): Promise<number>;
  /** Embeddings the phrase model reads (16 for openWakeWord-style models). */
  readonly features: number;
}

/** Samples of the previous chunk fed to the mel model with each new one (3 hops of 10 ms), as openWakeWord does. */
const CONTEXT = 480;

/** Feeds audio through the pipeline and decides when the phrase was said. */
export class WakeWordDetector {
  private tail = new Float32Array(0);
  private pending = new Float32Array(0);
  private mel: Float32Array[] = [];
  private melSinceEmbed = 0;
  private embeddings: Float32Array[] = [];
  private quietUntil = 0;

  constructor(
    private readonly models: WakeModels,
    private threshold: number,
    private readonly debounceMs = 2000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Change the threshold while listening (the Settings sensitivity slider). */
  setThreshold(t: number): void {
    this.threshold = t;
  }

  /**
   * Add audio (16 kHz, samples in int16 range as floats). Returns the best score seen in this call, and whether it
   * counts as a detection.
   */
  async push(samples: Float32Array): Promise<{ score: number; detected: boolean }> {
    this.pending = concat(this.pending, samples);
    let best = 0;
    let detected = false;
    while (this.pending.length >= CHUNK) {
      const chunk = this.pending.subarray(0, CHUNK);
      this.pending = this.pending.slice(CHUNK);
      const frames = await this.models.mel(concat(this.tail, chunk));
      this.tail = chunk.slice(CHUNK - CONTEXT);
      this.mel.push(...frames);
      if (this.mel.length > EMBED_WINDOW) this.mel = this.mel.slice(-EMBED_WINDOW);
      this.melSinceEmbed += frames.length;
      if (this.mel.length < EMBED_WINDOW || this.melSinceEmbed < EMBED_STEP) continue;
      this.melSinceEmbed = 0;
      this.embeddings.push(await this.models.embed(this.mel));
      if (this.embeddings.length > this.models.features)
        this.embeddings = this.embeddings.slice(-this.models.features);
      if (this.embeddings.length < this.models.features) continue;
      const score = await this.models.score(this.embeddings);
      best = Math.max(best, score);
      if (score >= this.threshold && this.now() >= this.quietUntil) {
        detected = true;
        this.quietUntil = this.now() + this.debounceMs;
        // Start fresh so the tail of the phrase cannot trigger again once the debounce ends.
        this.embeddings = [];
      }
    }
    return { score: best, detected };
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b.slice();
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
