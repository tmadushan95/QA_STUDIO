import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { nextCaseId } from './case-ids.js';

describe('next test case ID', () => {
  it('continues the pattern most IDs use, keeping the number width', () => {
    expect(nextCaseId(['TC_01', 'TC_02', 'TC_30'])).toBe('TC_31');
    expect(nextCaseId(['ACE-0099', 'ACE-0007'])).toBe('ACE-0100');
    expect(nextCaseId(['TC_9'])).toBe('TC_10');
  });

  it('follows the most common prefix, ignores IDs without a number, and starts at TC_01', () => {
    expect(nextCaseId(['TC_01', 'TC_02', 'X-5', 'login-smoke'])).toBe('TC_03');
    expect(nextCaseId([])).toBe('TC_01');
    expect(nextCaseId(['smoke'])).toBe('TC_01');
  });

  it('never returns an ID that is taken', () => {
    expect(nextCaseId(['TC_01', 'TC_02', 'TC_03'])).toBe('TC_04');
    expect(nextCaseId(['A1', 'A2', 'A3'].concat(['A4']))).toBe('A5');
  });
});

describe('creating test cases in the app', () => {
  const create = (app: ReturnType<typeof createApp>, body: object) =>
    app.inject({ method: 'POST', url: '/api/inventory', payload: body });

  it('assigns the next free ID when none is sent, so consecutive creates never collide', async () => {
    const app = createApp();
    expect((await app.inject({ url: '/api/inventory/next-id' })).json()).toEqual({ id: 'TC_01' });
    const a = await create(app, { title: 'First' });
    const b = await create(app, { title: 'Second', id: '' });
    expect(a.statusCode).toBe(201);
    expect([a.json().id, b.json().id]).toEqual(['TC_01', 'TC_02']);
    expect((await app.inject({ url: '/api/inventory/next-id' })).json()).toEqual({ id: 'TC_03' });
  });

  it('still accepts an ID typed by hand, and refuses one already used', async () => {
    const app = createApp();
    expect((await create(app, { title: 'Mine', id: 'TC_50' })).json().id).toBe('TC_50');
    const dup = await create(app, { title: 'Again', id: 'TC_50' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.fields).toEqual({ id: 'This ID is already used.' });
    expect((await create(app, { title: 'Next' })).json().id).toBe('TC_51');
  });
});
