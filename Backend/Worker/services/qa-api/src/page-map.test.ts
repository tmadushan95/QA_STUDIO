import { describe, expect, it } from 'vitest';
import { PageMapService } from './page-map.js';

/**
 * The worker only reads the page list (the API edits and validates it; those rules are tested there). These tests cover how
 * the worker lays a project's pages over the shared ones, and the one-time seed of the starting pages.
 */
function setup(initial: Record<string, { route: string; marker: string }> = {}) {
  const config = new Map<string, unknown>();
  const pages = new PageMapService(
    { loadConfig: (k) => config.get(k), saveConfig: (k, v) => void config.set(k, v) },
    () => undefined,
    initial,
  );
  return { pages, config };
}

describe('pages per project', () => {
  it('starts from the existing routes as the shared list, and a project starts with none of its own', () => {
    const { pages } = setup({ Home: { route: '/', marker: '' } });
    expect(pages.map()).toEqual({ Home: { route: '/', marker: '' } });
    expect(pages.map(3)).toEqual({ Home: { route: '/', marker: '' } });
  });

  it("lays a project's own pages over the shared ones, matching names without regard to case", () => {
    const { pages, config } = setup();
    config.set('pages', [
      { name: 'Dashboard', route: '/dash', marker: 'Welcome' },
      { name: 'Help', route: '/help', marker: '' },
    ]);
    config.set('pages:3', [{ name: 'dashboard', route: '/home', marker: 'Hi' }]);
    expect(pages.map(3)).toEqual({
      Help: { route: '/help', marker: '' },
      dashboard: { route: '/home', marker: 'Hi' },
    });
    // Another project and the shared list are untouched.
    expect(pages.map(4)['Dashboard']).toEqual({ route: '/dash', marker: 'Welcome' });
    expect(Object.keys(pages.map())).toEqual(['Dashboard', 'Help']);
  });

  it('reads a page saved without a marker (as the API may save it) with an empty one', () => {
    const { pages, config } = setup();
    config.set('pages', [{ name: 'Help', route: '/help' }]);
    expect(pages.map()).toEqual({ Help: { route: '/help', marker: '' } });
  });

  it('saves the starting pages once, so the database holds them, and never overwrites a saved list', () => {
    const { pages, config } = setup({ Home: { route: '/', marker: 'Hi' } });
    pages.seed();
    expect(config.get('pages')).toEqual([{ name: 'Home', route: '/', marker: 'Hi' }]);
    config.set('pages', [{ name: 'Mine', route: '/mine', marker: '' }]);
    pages.seed();
    expect(config.get('pages')).toEqual([{ name: 'Mine', route: '/mine', marker: '' }]);
  });
});
