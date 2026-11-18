import { describe, expect, it } from 'vitest';
import type { Run, TestCase } from '@qa-studio/shared';
import { createApp, type Automation } from './app.js';
import {
  AzureDevOpsService,
  CONFIG_KEY,
  defectSignature,
  multilineText,
  PAT_KEY,
  type DefectInput,
} from './azure-devops.js';
import { MemoryStore } from './store.js';

interface Call {
  method: string;
  url: string;
  contentType?: string | undefined;
  body?: unknown;
}

const ORG = 'https://dev.azure.com/contoso';

/** A connected service with a fake Azure DevOps that answers by "METHOD url-fragment". */
function setup(responses: Record<string, unknown> = {}, config: object = {}) {
  const calls: Call[] = [];
  const audit: string[] = [];
  const store = new MemoryStore();
  const settings = new Map<string, unknown>([
    [CONFIG_KEY, { orgUrl: ORG, project: 'Shop App', ...config }],
    [PAT_KEY, 'token'],
  ]);
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    calls.push({
      method,
      url: u,
      contentType: (init?.headers as Record<string, string>)['Content-Type'],
      ...(raw !== undefined && {
        body: raw instanceof Uint8Array ? { bytes: raw.length } : JSON.parse(String(raw)),
      }),
    });
    const key = Object.keys(responses).find((k) => `${method} ${u}`.includes(k));
    return new Response(JSON.stringify(key === undefined ? {} : responses[key]), { status: 200 });
  }) as typeof globalThis.fetch;
  const service = new AzureDevOpsService({
    store: { loadConfig: (k) => settings.get(k), saveConfig: (k, v) => void settings.set(k, v) },
    box: { encrypt: (s) => s, decrypt: (s) => s },
    inventory: store.inventory,
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
    fetch,
  });
  return { service, calls, audit, store };
}

const tc: TestCase = {
  schemaVersion: 1,
  id: 'ADO-501',
  title: 'Delete a draft project',
  preconditions: 'A draft project exists',
  steps: [
    { order: 1, action: 'Open the draft list' },
    { order: 2, action: 'Click Delete', expected: 'A confirmation shows' },
  ],
  expectedResult: 'The project is gone',
  tags: [],
  dependsOn: [],
  readiness: 'ready',
  source: { workbook: 'azure-devops', worksheet: 'Plan 1 / Suite 2', rowNumber: 501 },
};

function failedRun(caseId = 'ADO-501', id = 'run-2222-bbbb'): Run {
  return {
    id,
    status: 'failed',
    createdAt: '2026-11-18T10:00:00Z',
    environment: 'qa',
    browser: 'chromium',
    workers: 1,
    cases: [
      {
        caseId,
        account: 'Admin',
        status: 'failed',
        steps: [
          { index: 0, action: 'drafts.open', status: 'passed', durationMs: 5 },
          {
            index: 1,
            action: 'assert.text-visible',
            description: 'Text "Deleted" is visible',
            status: 'failed',
            durationMs: 5,
          },
        ],
        artifacts: ['ADO-501/failure.png'],
        failure: {
          kind: 'assertion',
          message: 'Text "Deleted" not visible after 5000 ms; header Bearer abc.def.ghi',
          expected: 'Deleted',
        },
      },
    ],
  };
}

const input = (over: Partial<DefectInput> = {}): DefectInput => ({
  run: failedRun(),
  caseId: 'ADO-501',
  verdict: 'likely-defect',
  failedBefore: true,
  ...over,
});

describe('Azure DevOps work items', () => {
  it('reads a story as plain text, keeping the lines of its acceptance criteria', async () => {
    const { service, calls } = setup({
      'GET https://dev.azure.com/contoso/Shop%20App/_apis/wit/workitems/42': {
        id: 42,
        fields: {
          'System.WorkItemType': 'User Story',
          'System.State': 'Active',
          'System.Title': 'Delete &amp; restore drafts',
          'Microsoft.VSTS.Common.AcceptanceCriteria':
            '<ul><li>Delete asks first</li><li>Deleted drafts can be restored</li></ul>',
          'System.Tags': 'drafts; ui',
        },
      },
    });
    const story = await service.workItem(42);
    expect(story).toMatchObject({
      id: 42,
      type: 'User Story',
      title: 'Delete & restore drafts',
      acceptanceCriteria: '- Delete asks first\n- Deleted drafts can be restored',
      tags: ['drafts', 'ui'],
      url: `${ORG}/Shop%20App/_workitems/edit/42`,
    });
    expect(calls[0]!.url).toContain('api-version=7.1');
  });

  it('turns rich text into lines', () => {
    expect(multilineText('<div>One<br/>Two</div><p>Three &amp; four</p>')).toBe(
      'One\nTwo\nThree & four',
    );
  });
});

describe('reporting defects', () => {
  it('refuses a case that did not fail, failed only once, or was not diagnosed as a defect', async () => {
    const { service, calls } = setup();
    const passed = failedRun();
    passed.cases[0]!.status = 'passed';
    await expect(service.reportDefect(input({ run: passed }))).rejects.toMatchObject({
      code: 'not-failed',
    });
    await expect(service.reportDefect(input({ failedBefore: false }))).rejects.toMatchObject({
      code: 'not-confirmed',
    });
    await expect(service.reportDefect(input({ verdict: 'test-fix' }))).rejects.toMatchObject({
      code: 'not-a-defect',
    });
    await expect(service.reportDefect(input({ verdict: undefined }))).rejects.toThrow(
      'Diagnose ADO-501',
    );
    // Nothing reached Azure DevOps.
    expect(calls).toHaveLength(0);
  });

  it('files a bug built from the run and the test case, linked and tagged, with tokens masked', async () => {
    const { service, calls, audit, store } = setup(
      {
        'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/wiql': { workItems: [] },
        'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/attachments': {
          url: `${ORG}/_apis/wit/attachments/abc`,
        },
        'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/workitems/$Bug': { id: 900 },
      },
      { bugSeverity: '2 - High' },
    );
    store.inventory.set(tc.id, tc);
    const out = await service.reportDefect(
      input({ storyId: 42, screenshot: { name: 'failure.png', data: Buffer.from('png') } }),
    );
    expect(out).toMatchObject({ action: 'filed', bugId: 900 });
    expect(out.url).toBe(`${ORG}/Shop%20App/_workitems/edit/900`);

    const create = calls.find((c) => c.url.includes('$Bug'))!;
    expect(create.contentType).toBe('application/json-patch+json');
    const ops = create.body as { path: string; value: unknown }[];
    const value = (path: string) => ops.find((o) => o.path === path)?.value;
    expect(value('/fields/System.Title')).toBe(
      '[QA Studio] ADO-501 Delete a draft project: assert.text-visible',
    );
    expect(value('/fields/System.Tags')).toBe(`qa-studio; ai-filed; ${out.signature}`);
    expect(value('/fields/Microsoft.VSTS.Common.Severity')).toBe('2 - High');
    const repro = String(value('/fields/Microsoft.VSTS.TCM.ReproSteps'));
    expect(repro).toContain('<li>Click Delete <i>Expected: A confirmation shows</i></li>');
    expect(repro).toContain('Text &quot;Deleted&quot; is visible');
    expect(repro).toContain('Bearer [REDACTED]');
    expect(repro).not.toContain('abc.def.ghi');
    const rels = ops.filter((o) => o.path === '/relations/-').map((o) => o.value);
    expect(rels).toEqual([
      { rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: `${ORG}/_apis/wit/workItems/501` },
      { rel: 'System.LinkTypes.Related', url: `${ORG}/_apis/wit/workItems/42` },
      { rel: 'AttachedFile', url: `${ORG}/_apis/wit/attachments/abc` },
    ]);
    expect(calls.find((c) => c.url.includes('attachments'))!.body).toEqual({ bytes: 3 });
    expect(audit.at(-1)).toBe(
      'azure-devops.defect|ADO-501|Bug 900 filed from run run-2222 as Admin.',
    );
  });

  it('comments on the open bug with the same failure instead of filing another', async () => {
    const { service, calls, audit } = setup({
      'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/wiql': { workItems: [{ id: 77 }] },
    });
    const out = await service.reportDefect(input());
    expect(out).toMatchObject({ action: 'commented', bugId: 77 });
    const wiql = calls.find((c) => c.url.includes('wiql'))!.body as { query: string };
    expect(wiql.query).toContain(`CONTAINS '${out.signature}'`);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/wit/workitems/77');
    expect(calls.some((c) => c.url.includes('$Bug'))).toBe(false);
    expect(audit.at(-1)).toContain('Bug 77 commented');
  });

  it('files at most the configured number of new bugs per run', async () => {
    const { service } = setup(
      {
        'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/wiql': { workItems: [] },
        'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/workitems/$Bug': { id: 1 },
      },
      { maxBugsPerRun: 1 },
    );
    await service.reportDefect(input());
    await expect(service.reportDefect(input())).rejects.toMatchObject({ code: 'defect-cap' });
  });

  it('gives the same signature when only numbers in the message change', () => {
    const a = defectSignature('TC_1', 'assert.text-visible', 'Not visible after 5000 ms');
    expect(defectSignature('TC_1', 'assert.text-visible', 'Not  visible after 3000 ms')).toBe(a);
    expect(defectSignature('TC_2', 'assert.text-visible', 'Not visible after 5000 ms')).not.toBe(a);
    expect(a).toMatch(/^qa-sig-[0-9a-f]{12}$/);
  });
});

describe('the defects route', () => {
  it('passes the run history and the latest diagnosis to the rules', async () => {
    const { service, calls } = setup({
      'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/wiql': { workItems: [] },
      'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/workitems/$Bug': { id: 5 },
    });
    const current = failedRun();
    const earlier = failedRun('ADO-501', 'run-1111-aaaa');
    const diagnosis: { verdict?: string } = {};
    const automation = {
      azureDevOps: service,
      // Only the members the route reads.
      runs: {
        get: (id: string) => [current, earlier].find((r) => r.id === id),
        list: () => [current, earlier],
      },
      aiTasks: { lastVerdict: () => diagnosis.verdict },
    } as unknown as Automation;
    const app = createApp(new MemoryStore(), automation);
    const report = () =>
      app.inject({
        method: 'POST',
        url: '/api/azure-devops/defects',
        payload: { runId: current.id, caseId: 'ADO-501' },
      });

    expect((await report()).json()).toMatchObject({ error: { code: 'not-a-defect' } });
    diagnosis.verdict = 'likely-defect';
    const filed = await report();
    expect(filed.statusCode).toBe(200);
    expect(filed.json()).toMatchObject({ action: 'filed', bugId: 5 });
    expect(calls.filter((c) => c.url.includes('$Bug'))).toHaveLength(1);

    const unknownRun = await app.inject({
      method: 'POST',
      url: '/api/azure-devops/defects',
      payload: { runId: 'nope', caseId: 'ADO-501' },
    });
    expect(unknownRun.statusCode).toBe(404);
  });
});

describe('bug settings', () => {
  it('are kept when the Settings page saves without them', async () => {
    const { service } = setup({}, { maxBugsPerRun: 2, bugSeverity: '2 - High' });
    service.update({ orgUrl: ORG, project: 'Shop App', autoApprove: false });
    expect(service.view().config).toMatchObject({
      autoApprove: false,
      maxBugsPerRun: 2,
      bugSeverity: '2 - High',
    });
    service.update({ orgUrl: ORG, project: 'Shop App', maxBugsPerRun: 3 });
    expect(service.view().config).toMatchObject({ maxBugsPerRun: 3, bugSeverity: '2 - High' });
  });
});
