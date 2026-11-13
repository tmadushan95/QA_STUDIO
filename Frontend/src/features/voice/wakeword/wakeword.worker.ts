/**
 * Wake-word worker: runs the models off the main thread, so listening never makes the app stutter. Audio arrives as
 * 16 kHz chunks; only scores and detections go back. Audio never leaves this browser.
 */
import { WakeWordDetector } from './detector.js';
import { MissingModelError, loadWakeModels } from './onnx-models.js';

/** Messages to the worker. */
export type ToWakeWorker =
  | { type: 'start'; phrase: string; threshold: number }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'threshold'; value: number };

/** Messages from the worker. */
export type FromWakeWorker =
  | { type: 'ready' }
  | { type: 'score'; value: number }
  | { type: 'detected'; score: number }
  | { type: 'error'; reason: 'model-missing' | 'failed'; message: string };

const post = (m: FromWakeWorker) => self.postMessage(m);
let detector: WakeWordDetector | undefined;
// Chunks are scored in order, one at a time; a chunk arriving meanwhile waits its turn.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ToWakeWorker>) => {
  const m = e.data;
  if (m.type === 'start') {
    loadWakeModels(m.phrase).then(
      (models) => {
        detector = new WakeWordDetector(models, m.threshold);
        post({ type: 'ready' });
      },
      (err: unknown) =>
        post({
          type: 'error',
          reason: err instanceof MissingModelError ? 'model-missing' : 'failed',
          message: err instanceof Error ? err.message : 'The wake model could not be loaded.',
        }),
    );
  } else if (m.type === 'threshold') {
    detector?.setThreshold(m.value);
  } else if (detector) {
    const d = detector;
    queue = queue.then(async () => {
      const r = await d.push(m.samples);
      if (r.detected) post({ type: 'detected', score: r.score });
      else if (r.score > 0) post({ type: 'score', value: r.score });
    });
  }
};
