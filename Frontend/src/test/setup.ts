/**
 * Test environment setup. jsdom has no layout engine, so it lacks `ResizeObserver`, which charts use to size
 * themselves. A no-op stand-in lets them render (at zero size) in UI tests; real browsers have the real one.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
}
