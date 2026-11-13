import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingModelError, loadWakeModels } from './onnx-models.js';

afterEach(() => vi.unstubAllGlobals());

describe('loading wake models', () => {
  it('reports a missing model by file name when the app answers with its web page instead', async () => {
    // What Vite and the API's page fallback do for any unknown path: 200 with the HTML page.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    const err = await loadWakeModels('hey_qa_studio').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingModelError);
    expect((err as Error).message).toMatch(/is not installed\. Add it to Frontend\/public\/models/);
  });
});
