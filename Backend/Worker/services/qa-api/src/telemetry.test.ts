import Fastify from 'fastify';
import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { isTelemetryEnabled, startTelemetry } from './telemetry.js';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('telemetry', () => {
  it('stays off without an OTLP endpoint, so a normal install loads nothing', async () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(isTelemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBe(false);
    expect(await startTelemetry({})).toBeUndefined();
  });

  it('continues the caller’s trace in the request span and skips polled routes', async () => {
    const telemetry = await startTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' });
    expect(telemetry).toBeDefined();
    const app = Fastify();
    app.get('/api/thing', () => ({
      traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
    }));
    app.get('/api/health', () => ({
      traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
    }));
    telemetry!.instrument(app);

    const headers = { traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01` };
    const traced = await app.inject({ url: '/api/thing', headers });
    const untraced = await app.inject({ url: '/api/health', headers });

    expect(traced.json()).toEqual({ traceId: TRACE_ID });
    expect(untraced.json()).toEqual({ traceId: null });
    await app.close();
    // Nothing listens on the endpoint; shutting down must still resolve (shutdown() swallows the export failure).
    await telemetry!.shutdown();
  }, 20_000);
});
