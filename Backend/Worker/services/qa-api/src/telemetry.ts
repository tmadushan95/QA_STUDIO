/**
 * OpenTelemetry tracing for the worker, so one trace follows a request across the .NET API (and its YARP gateway), the
 * worker and the worker's write-behind calls back to the API.
 *
 * It switches on only when OTEL_EXPORTER_OTLP_ENDPOINT is set, which the Aspire AppHost does (Backend/src/AppHost). An
 * install started by start.mjs has no endpoint, so nothing is loaded: the SDK is imported lazily, below the check.
 * Endpoint, headers (the dashboard's API key), service name and resource attributes come from the standard OTEL_*
 * variables. See docs/adr/0012-aspire-for-development-and-observability.md.
 *
 * Why hand-made server spans instead of the http auto-instrumentation: in an ES module app that needs a loader hook
 * (--import) on the node command line. Outgoing fetch calls use undici's diagnostics channel, which needs no hook.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Span } from '@opentelemetry/api';

export interface Telemetry {
  /** Adds a server span per request (call right after the app is created, before it listens). */
  instrument(app: FastifyInstance): void;
  /** Sends the spans still buffered. */
  shutdown(): Promise<void>;
}

/** Polled or streamed routes that would only add noise. */
const UNTRACED = new Set(['/api/health', '/api/events']);

export const isTelemetryEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim());

/**
 * Starts tracing when an OTLP endpoint is configured; otherwise returns undefined and loads nothing.
 * `env` only decides whether to start; the exporter and resource detector read the OTEL_* variables from process.env.
 */
export async function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Telemetry | undefined> {
  if (!isTelemetryEnabled(env)) return undefined;

  const [api, core, contextHooks, sdk, resources, exporter, instrumentation, undici] =
    await Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/core'),
      import('@opentelemetry/context-async-hooks'),
      import('@opentelemetry/sdk-trace'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/exporter-trace-otlp-grpc'),
      import('@opentelemetry/instrumentation'),
      import('@opentelemetry/instrumentation-undici'),
    ]);

  const resource = resources
    .defaultResource()
    .merge(resources.resourceFromAttributes({ 'service.name': 'worker' }))
    // OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES (set by the AppHost) win over the default name above.
    .merge(resources.detectResources({ detectors: [resources.envDetector] }));

  const provider = new sdk.TracerProvider({
    resource,
    spanProcessors: [new sdk.BatchSpanProcessor({ exporter: new exporter.OTLPTraceExporter() })],
  });
  api.context.setGlobalContextManager(new contextHooks.AsyncLocalStorageContextManager().enable());
  api.propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());
  api.trace.setGlobalTracerProvider(provider);
  // Outgoing fetch (the write-behind flush, parameter and config reads from the API, AI providers) gets a client span
  // and a traceparent header, so the API's spans join the same trace.
  instrumentation.registerInstrumentations({
    instrumentations: [new undici.UndiciInstrumentation()],
  });

  const tracer = api.trace.getTracer('qa-studio-worker');
  const spans = new WeakMap<FastifyRequest, Span>();

  return {
    instrument(app) {
      app.addHook('onRequest', (req, _reply, done) => {
        const path = req.url.split('?', 1)[0] ?? req.url;
        if (UNTRACED.has(path)) return done();
        const parent = api.propagation.extract(api.context.active(), req.headers);
        const route = req.routeOptions.url ?? path;
        const span = tracer.startSpan(
          `${req.method} ${route}`,
          {
            kind: api.SpanKind.SERVER,
            attributes: {
              'http.request.method': req.method,
              'http.route': route,
              'url.path': path,
            },
          },
          parent,
        );
        spans.set(req, span);
        // Run the rest of the request inside the span, so outgoing fetch calls become its children.
        api.context.with(api.trace.setSpan(parent, span), done);
      });
      app.addHook('onResponse', (req, reply, done) => {
        const span = spans.get(req);
        if (span) {
          span.setAttribute('http.response.status_code', reply.statusCode);
          if (reply.statusCode >= 500) span.setStatus({ code: api.SpanStatusCode.ERROR });
          span.end();
          spans.delete(req);
        }
        done();
      });
    },
    // A collector that is gone (the dashboard was closed first) must never fail the worker's own shutdown.
    shutdown: () => provider.shutdown().catch(() => undefined),
  };
}
