/**
 * Listens for the wake phrase on this device: microphone → 16 kHz audio worklet → wake-word worker. Nothing is sent
 * over the network; the LiveKit session starts only after a detection, and listening stops while it runs.
 */
import { CHUNK, SAMPLE_RATE } from './detector.js';
import type { FromWakeWorker, ToWakeWorker } from './wakeword.worker.js';

/** Why listening could not start or stopped. */
export type WakeProblem = 'mic-blocked' | 'model-missing' | 'unsupported' | 'failed';

/** Callbacks from the listener. */
export interface WakeHandlers {
  onReady(): void;
  onDetected(): void;
  /** Live score 0..1, for the sensitivity test meter. */
  onScore?(score: number): void;
  onProblem(problem: WakeProblem, message: string): void;
}

/** A running listener. */
export interface WakeListener {
  setThreshold(value: number): void;
  stop(): void;
}

// Collects microphone audio into fixed chunks on the audio thread and hands each one over. Scaled to int16 range,
// which is what the openWakeWord front end expects.
const WORKLET = `
class Chunker extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i] * 32767;
      if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('qa-wake-chunker', Chunker);
`;

/** Start listening for the phrase. Problems are reported through `onProblem`, never thrown. */
export async function startWakeListener(
  phrase: string,
  threshold: number,
  handlers: WakeHandlers,
): Promise<WakeListener | undefined> {
  if (typeof AudioWorkletNode === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    handlers.onProblem(
      'unsupported',
      'This browser cannot listen for a wake phrase. Use push to talk.',
    );
    return undefined;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    handlers.onProblem(
      'mic-blocked',
      'The microphone is blocked. Allow it for this site in the browser’s site settings.',
    );
    return undefined;
  }

  const worker = new Worker(new URL('./wakeword.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWakeWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  // The browser resamples the microphone to 16 kHz for us.
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    worker.terminate();
    URL.revokeObjectURL(moduleUrl);
  };

  worker.onmessage = (e: MessageEvent<FromWakeWorker>) => {
    const m = e.data;
    if (m.type === 'ready') handlers.onReady();
    else if (m.type === 'score') handlers.onScore?.(m.value);
    else if (m.type === 'detected') {
      handlers.onScore?.(m.score);
      handlers.onDetected();
    } else {
      stop();
      handlers.onProblem(m.reason, m.message);
    }
  };

  try {
    await ctx.audioWorklet.addModule(moduleUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'qa-wake-chunker');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!stopped) send({ type: 'audio', samples: e.data }, [e.data.buffer]);
    };
    // Audio graphs only run when they reach the output; a muted gain keeps it running without playing anything.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    send({ type: 'start', phrase, threshold });
  } catch (e) {
    stop();
    handlers.onProblem(
      'failed',
      e instanceof Error ? e.message : 'Wake listening could not start.',
    );
    return undefined;
  }

  return {
    setThreshold: (value) => send({ type: 'threshold', value }),
    stop,
  };
}
