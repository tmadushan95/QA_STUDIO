/**
 * The wake-word models on ONNX Runtime Web (WebAssembly, one thread, so no cross-origin isolation is needed). Loaded
 * only inside the wake-word worker, so neither the runtime nor the models touch the main bundle.
 *
 * Files, served by the app from `public/models/`:
 *   melspectrogram.onnx, embedding_model.onnx   the shared openWakeWord front end
 *   <phrase id>.onnx                            the phrase model, for example hey_qa_studio.onnx
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { EMBED_SIZE, EMBED_WINDOW, MEL_BINS, type WakeModels } from './detector.js';

/** Where the model files live. */
export const MODELS_BASE = '/models';

/** Raised when a model file is not installed, so the UI can say exactly which file to add. */
export class MissingModelError extends Error {
  override name = 'MissingModelError';
}

/** The file name the UI asks people to add, such as "hey_qa_studio.onnx". */
const fileOf = (url: string) => decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));

async function load(url: string): Promise<ort.InferenceSession> {
  const res = await fetch(url);
  // The app (Vite in development, the API's page fallback in production) answers every unknown path with the web
  // page itself and status 200, so a missing model looks like a successful HTML response, not a 404.
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) {
    throw new MissingModelError(
      `The wake model ${fileOf(url)} is not installed. Add it to Frontend/public/models and reload.`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  } catch (e) {
    // A file that is not an ONNX model (a placeholder, a truncated download) fails to parse; any other failure, such
    // as the runtime not loading, keeps its own message.
    if (e instanceof Error && /protobuf|failed to load model/i.test(e.message)) {
      throw new MissingModelError(
        `${fileOf(url)} in Frontend/public/models is not a valid ONNX model. Replace it with the trained file.`,
      );
    }
    throw e;
  }
}

/** Load the front end and the phrase model. */
export async function loadWakeModels(phrase: string): Promise<WakeModels> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  const [melModel, embedModel, phraseModel] = await Promise.all([
    load(`${MODELS_BASE}/melspectrogram.onnx`),
    load(`${MODELS_BASE}/embedding_model.onnx`),
    load(`${MODELS_BASE}/${encodeURIComponent(phrase)}.onnx`),
  ]);
  // The phrase model's input is [1, features, 96]; read features from it when the runtime exposes the shape.
  const dims = phraseModel.inputMetadata[0];
  const declared = dims && 'shape' in dims ? Number(dims.shape[1]) : NaN;
  const features = Number.isInteger(declared) && declared > 0 ? declared : 16;

  return {
    features,
    async mel(audio) {
      const out = await melModel.run({
        [melModel.inputNames[0]!]: new ort.Tensor('float32', audio, [1, audio.length]),
      });
      const data = out[melModel.outputNames[0]!]!.data as Float32Array;
      const frames: Float32Array[] = [];
      for (let i = 0; i + MEL_BINS <= data.length; i += MEL_BINS) {
        // openWakeWord's scaling of the mel output before the embedding model.
        frames.push(data.slice(i, i + MEL_BINS).map((v) => v / 10 + 2));
      }
      return frames;
    },
    async embed(frames) {
      const flat = new Float32Array(EMBED_WINDOW * MEL_BINS);
      frames.slice(-EMBED_WINDOW).forEach((f, i) => flat.set(f, i * MEL_BINS));
      const out = await embedModel.run({
        [embedModel.inputNames[0]!]: new ort.Tensor('float32', flat, [
          1,
          EMBED_WINDOW,
          MEL_BINS,
          1,
        ]),
      });
      return (out[embedModel.outputNames[0]!]!.data as Float32Array).slice(0, EMBED_SIZE);
    },
    async score(embeddings) {
      const flat = new Float32Array(embeddings.length * EMBED_SIZE);
      embeddings.forEach((e, i) => flat.set(e, i * EMBED_SIZE));
      const out = await phraseModel.run({
        [phraseModel.inputNames[0]!]: new ort.Tensor('float32', flat, [
          1,
          embeddings.length,
          EMBED_SIZE,
        ]),
      });
      return Number((out[phraseModel.outputNames[0]!]!.data as Float32Array)[0] ?? 0);
    },
  };
}
