import type { TestCase } from '@qa-studio/shared';

/** The slice of `node:sqlite` this package uses, so it has no import of its own and tests can pass any database. */
export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: (string | number)[]): { changes: number | bigint };
    all(...args: (string | number)[]): unknown[];
    get(...args: (string | number)[]): unknown;
  };
}

export type DocKind = 'test-case' | 'scenario' | 'action' | 'doc' | 'note';

export interface KnowledgeDoc {
  /** Stable id, for example the test case ID. Saving the same id again replaces the old text. */
  id: string;
  kind: DocKind;
  title: string;
  /** Where the text came from, shown as a citation (for example "plan.xlsx › Login › row 4"). */
  source: string;
  text: string;
}

export interface Hit {
  docId: string;
  kind: DocKind;
  title: string;
  source: string;
  text: string;
  /** Higher is a better match. */
  score: number;
}

const CHUNK_CHARS = 900;

/** Split on blank lines and sentence ends so a chunk reads as a unit, never cutting a word in half. */
export function chunkText(text: string, max = CHUNK_CHARS): string[] {
  const parts = text
    .split(/\n{2,}/)
    .flatMap((p) =>
      p.length <= max ? [p] : (p.match(new RegExp(`[^.!?\\n]{1,${max}}[.!?]?\\s*`, 'g')) ?? [p]),
    )
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const p of parts) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + p.length + 2 <= max)
      chunks[chunks.length - 1] = `${last}\n\n${p}`;
    else chunks.push(p.length > max ? p.slice(0, max) : p);
  }
  return chunks;
}

/** Turn free text into a safe FTS5 query: quoted words joined with OR, so user text can never be query syntax. */
export function toMatchQuery(q: string): string | undefined {
  const words = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])].slice(0, 40);
  return words.length === 0 ? undefined : words.map((w) => `"${w}"`).join(' OR ');
}

/**
 * Local retrieval over SQLite FTS5 (BM25 ranking, no embeddings, no network). Every hit carries its source so an
 * answer can cite where it came from. The interface is small on purpose: a vector index can replace it later.
 */
export class KnowledgeIndex {
  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_docs (
        id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
        title, body, doc_id UNINDEXED, kind UNINDEXED, source UNINDEXED, tokenize = 'porter unicode61'
      );
    `);
  }

  upsert(doc: KnowledgeDoc): number {
    this.remove(doc.kind, doc.id);
    // A document with no body (a test case that only has a title) must still be findable by its title.
    const found = chunkText(doc.text);
    const chunks = found.length > 0 ? found : [''];
    const ins = this.db.prepare(
      'INSERT INTO kb_fts (title, body, doc_id, kind, source) VALUES (?, ?, ?, ?, ?)',
    );
    for (const c of chunks) ins.run(doc.title, c, doc.id, doc.kind, doc.source);
    this.db
      .prepare('INSERT INTO kb_docs (id, kind, title, source, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(doc.id, doc.kind, doc.title, doc.source, new Date().toISOString());
    return chunks.length;
  }

  remove(kind: DocKind, id: string): void {
    this.db.prepare('DELETE FROM kb_fts WHERE kind = ? AND doc_id = ?').run(kind, id);
    this.db.prepare('DELETE FROM kb_docs WHERE kind = ? AND id = ?').run(kind, id);
  }

  /** Remove everything of one kind (before re-indexing it from its source of truth). */
  clearKind(kind: DocKind): void {
    this.db.prepare('DELETE FROM kb_fts WHERE kind = ?').run(kind);
    this.db.prepare('DELETE FROM kb_docs WHERE kind = ?').run(kind);
  }

  stats(): Record<DocKind, number> & { chunks: number } {
    const out = { 'test-case': 0, scenario: 0, action: 0, doc: 0, note: 0, chunks: 0 };
    for (const r of this.db
      .prepare('SELECT kind, COUNT(*) AS n FROM kb_docs GROUP BY kind')
      .all() as {
      kind: DocKind;
      n: number;
    }[]) {
      out[r.kind] = Number(r.n);
    }
    out.chunks = Number(
      (this.db.prepare('SELECT COUNT(*) AS n FROM kb_fts').get() as { n: number }).n,
    );
    return out;
  }

  search(query: string, opts: { limit?: number; kinds?: DocKind[] } = {}): Hit[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    const kinds = opts.kinds?.length ? opts.kinds : undefined;
    const sql = `SELECT doc_id, kind, title, source, body, bm25(kb_fts, 4.0, 1.0) AS rank FROM kb_fts
      WHERE kb_fts MATCH ?${kinds ? ` AND kind IN (${kinds.map(() => '?').join(',')})` : ''}
      ORDER BY rank LIMIT ?`;
    const rows = this.db
      .prepare(sql)
      .all(match, ...(kinds ?? []), Math.max(1, Math.min(50, opts.limit ?? 8))) as {
      doc_id: string;
      kind: DocKind;
      title: string;
      source: string;
      body: string;
      rank: number;
    }[];
    return rows.map((r) => ({
      docId: r.doc_id,
      kind: r.kind,
      title: r.title,
      source: r.source,
      text: r.body,
      score: -r.rank, // bm25 is lower-is-better and negative
    }));
  }
}

/** Format hits as a prompt block the model can quote from, each tagged so its answer can cite `[kind:id]`. */
export function buildContext(hits: Hit[], maxChars = 6000): string {
  const out: string[] = [];
  let used = 0;
  for (const h of hits) {
    const block = `[${h.kind}:${h.docId}] ${h.title} (${h.source})\n${h.text}`;
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length;
  }
  return out.join('\n\n---\n\n');
}

// ---- turning the platform's own data into searchable documents ----

export function testCaseDoc(tc: TestCase): KnowledgeDoc {
  const steps = tc.steps.map((s) => `${s.order}. ${s.action}`).join('\n');
  return {
    id: tc.id,
    kind: 'test-case',
    title: `${tc.id}: ${tc.title}`,
    source: `${tc.source.workbook} › ${tc.source.worksheet} › row ${tc.source.rowNumber}`,
    text: [
      tc.module && `Module: ${tc.module}`,
      tc.userRole && `User role: ${tc.userRole}`,
      tc.preconditions && `Preconditions: ${tc.preconditions}`,
      steps && `Steps:\n${steps}`,
      tc.expectedResult && `Expected result: ${tc.expectedResult}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export interface ScenarioLike {
  caseId: string;
  description?: string | undefined;
  steps: { action: string; params?: Record<string, unknown> | undefined }[];
}

export function scenarioDoc(s: ScenarioLike): KnowledgeDoc {
  return {
    id: s.caseId,
    kind: 'scenario',
    title: `Scenario for ${s.caseId}`,
    source: `scenario ${s.caseId}`,
    text: [
      s.description,
      ...s.steps.map((x, i) => `${i + 1}. ${x.action} ${JSON.stringify(x.params ?? {})}`),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export interface ActionLike {
  name: string;
  description: string;
  destructive?: boolean | undefined;
  params?: unknown;
}

export function actionDoc(a: ActionLike): KnowledgeDoc {
  return {
    id: a.name,
    kind: 'action',
    title: `Action ${a.name}`,
    source: 'action registry',
    text: `${a.description}${a.destructive ? ' DESTRUCTIVE: deletes or changes data.' : ''}\nParameters: ${JSON.stringify(a.params ?? {})}`,
  };
}
