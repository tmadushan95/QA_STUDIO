import react from '@vitejs/plugin-react';
import { createLogger, defineConfig } from 'vite';

const api = process.env['QA_API_URL'] ?? 'http://127.0.0.1:5080';

/** Socket errors that only mean "the API is not listening right now" (stopped, starting or restarting). */
const API_DOWN = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH']);
const isApiDown = (err: unknown) =>
  API_DOWN.has((err as NodeJS.ErrnoException | undefined)?.code ?? '');

/**
 * Vite logs a full stack trace for every proxied request while the API is down. Replace those with one short line every
 * 10 seconds; any other error is logged as usual.
 */
const logger = createLogger();
const logError = logger.error.bind(logger);
let lastDownNote = 0;
logger.error = (msg, options) => {
  if (msg.includes('proxy error') && isApiDown(options?.error)) {
    if (Date.now() - lastDownNote > 10_000) {
      lastDownNote = Date.now();
      logger.warn(
        `[qa-studio] The API at ${api} is not answering yet; requests get a 503 until it is up.`,
        { timestamp: true },
      );
    }
    return;
  }
  logError(msg, options);
};

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: api,
        // Keep the browser's Host header. The API refuses changes whose Origin differs from the Host they were sent to
        // (it stops other websites driving it through your browser). Vite's shorthand proxy rewrites Host to the target,
        // so every POST/PUT/DELETE from the dev server looked cross-site and was refused with 403.
        changeOrigin: false,
        // While the API is stopped or still starting (for example Visual Studio rebuilding it), answer in the API's own
        // error shape with what to do, so the page says so instead of failing with an empty 500.
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (!isApiDown(err) || !('writeHead' in res) || res.headersSent) return;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'api-unavailable',
                  message: `The QA Studio API is not running at ${api}. Start it (Visual Studio, or npm start in Backend/Worker) and try again in a few seconds.`,
                },
              }),
            );
          });
        },
      },
    },
  },
});
