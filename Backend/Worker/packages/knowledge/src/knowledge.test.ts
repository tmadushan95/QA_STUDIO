import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { TestCase } from '@qa-studio/shared';
import {
  KnowledgeIndex,
  actionDoc,
  buildContext,
  chunkText,
  scenarioDoc,
  testCaseDoc,
  toMatchQuery,
  type SqlDb,
} from './index.js';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
const open = () => new KnowledgeIndex(new DatabaseSync(':memory:') as unknown as SqlDb);

const tc = (over: Partial<TestCase> = {}): TestCase =>
  ({
    schemaVersion: 1,
    id: 'TC_04',
    title: 'Verify deletion of a Draft project',
    module: 'Project deletion',
    steps: [
      { order: 1, action: 'Open the Draft project' },
      { order: 2, action: 'Click Delete' },
    ],
    expectedResult: 'The confirmation dialog is shown',
    tags: [],
    dependsOn: [],
    readiness: 'needs-clarification',
    source: { workbook: 'plan.xlsx', worksheet: 'Delete-Draft', rowNumber: 5 },
    ...over,
  }) as TestCase;

describe('chunking and queries', () => {
  it('keeps short text whole, splits long text on boundaries, and never exceeds the limit', () => {
    expect(chunkText('one\n\ntwo')).toEqual(['one\n\ntwo']);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something.`).join(
      ' ',
    );
    const chunks = chunkText(long, 200);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join(' ')).toContain('Sentence number 59');
  });

  it('turns user text into a safe query, so FTS syntax in the text cannot break or widen it', () => {
    expect(toMatchQuery('delete "draft" project*')).toBe('"delete" OR "draft" OR "project"');
    // Operators become plain quoted words, and one-character words are dropped.
    expect(toMatchQuery('a NEAR/3 (b) -c')).toBe('"near"');
    expect(toMatchQuery('!!')).toBeUndefined();
  });
});

describe('KnowledgeIndex', () => {
  it('finds by meaning-bearing words, ranks title matches first and cites the source', () => {
    const kb = open();
    kb.upsert(testCaseDoc(tc()));
    kb.upsert(
      testCaseDoc(
        tc({
          id: 'TC_09',
          title: 'Verify roles screen lists permissions',
          module: 'Roles',
          steps: [],
          expectedResult: 'Permission listed',
        }),
      ),
    );
    const hits = kb.search('deleting a draft project');
    expect(hits[0]).toMatchObject({
      docId: 'TC_04',
      kind: 'test-case',
      source: 'plan.xlsx › Delete-Draft › row 5',
    });
    expect(hits.map((h) => h.docId)).not.toContain('TC_09');
  });

  it('replaces a document when saved again and removes it cleanly', () => {
    const kb = open();
    kb.upsert(testCaseDoc(tc()));
    kb.upsert(testCaseDoc(tc({ expectedResult: 'A toast says archived' })));
    expect(kb.stats()['test-case']).toBe(1);
    expect(kb.search('archived')).toHaveLength(1);
    expect(kb.search('confirmation dialog')).toHaveLength(0); // the old text is gone
    kb.remove('test-case', 'TC_04');
    expect(kb.search('archived')).toHaveLength(0);
    expect(kb.stats()).toMatchObject({ 'test-case': 0, chunks: 0 });
  });

  it('filters by kind, clears one kind, and returns nothing for an empty query', () => {
    const kb = open();
    kb.upsert(testCaseDoc(tc()));
    kb.upsert(
      scenarioDoc({ caseId: 'TC_04', steps: [{ action: 'project.click-delete', params: {} }] }),
    );
    kb.upsert(
      actionDoc({
        name: 'project.confirm-delete',
        description: 'Click Confirm to delete the project',
        destructive: true,
      }),
    );
    expect(kb.search('delete', { kinds: ['action'] }).map((h) => h.kind)).toEqual(['action']);
    expect(kb.search('delete', { kinds: ['action'] })[0]!.text).toContain('DESTRUCTIVE');
    kb.clearKind('scenario');
    expect(kb.stats().scenario).toBe(0);
    expect(kb.stats()['test-case']).toBe(1);
    expect(kb.search('   ')).toEqual([]);
  });

  it('handles odd input without throwing', () => {
    const kb = open();
    kb.upsert({
      id: 'x',
      kind: 'note',
      title: 'Quote " and \' chars',
      source: 's',
      text: 'It\'s "quoted" text with * and ( ).',
    });
    expect(() => kb.search('quoted" OR (')).not.toThrow();
    expect(kb.search('quoted')).toHaveLength(1);
  });

  it('builds a cited context block within a size budget', () => {
    const kb = open();
    kb.upsert(testCaseDoc(tc()));
    kb.upsert(testCaseDoc(tc({ id: 'TC_05', title: 'Verify deletion of a Rejected project' })));
    const hits = kb.search('deletion project');
    const ctx = buildContext(hits, 100_000);
    expect(ctx).toContain('[test-case:TC_04]');
    expect(ctx).toContain('plan.xlsx › Delete-Draft › row 5');
    expect(buildContext(hits, 10)).toBe('');
  });
});
