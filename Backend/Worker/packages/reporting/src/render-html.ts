import type { RunReport } from './report.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const pct = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
const dur = (ms?: number) =>
  ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/**
 * Self-contained HTML report. Test case text comes from Excel and is untrusted, so every value is escaped
 * and the page has no scripts and a CSP that forbids them.
 */
export function renderHtml(r: RunReport): string {
  const c = r.summary.counts;
  const rows = r.cases
    .map((cs) => {
      const steps = cs.steps
        .map(
          (s) =>
            // The sentence leads; the action name stays as a hover hint for whoever debugs the scenario.
            `<li><span class="st ${esc(s.status)}">${esc(s.status)}</span> ${s.description ? `<span title="${esc(s.action)}">${esc(s.description)}</span>` : `<code>${esc(s.action)}</code>`} <span class="muted">${dur(s.durationMs)}</span>${s.failure ? ` <em>${esc(s.failure.message)}</em>` : ''}</li>`,
        )
        .join('');
      const f = cs.failure;
      return `<tr>
<th scope="row">${esc(cs.caseId)}<div class="muted">${esc(cs.title ?? '')}</div>${cs.account ? `<div class="muted">as ${esc(cs.account)}</div>` : ''}</th>
<td>${esc(cs.module ?? '—')}</td>
<td><span class="st ${esc(cs.status)}">${esc(cs.status)}</span></td>
<td>${dur(cs.durationMs)}</td>
<td>${f ? `<strong>${esc(f.kind)}</strong>: ${esc(f.message)}${f.expected !== undefined ? `<br>Expected: ${esc(f.expected)}<br>Actual: ${esc(f.actual ?? '—')}` : ''}` : ''}${steps ? `<ol>${steps}</ol>` : ''}${cs.artifacts.length ? `<div class="muted">Evidence: ${cs.artifacts.map(esc).join(', ')}</div>` : ''}</td>
<td>${cs.source ? `${esc(cs.source.workbook)} › ${esc(cs.source.worksheet)} › row ${cs.source.rowNumber}` : '—'}</td>
</tr>`;
    })
    .join('\n');
  const cov = r.coverageByModule
    .map(
      (m) =>
        `<tr><th scope="row">${esc(m.module)}</th><td>${m.total}</td><td>${m.passed}</td><td>${m.failed}</td><td>${m.blocked}</td><td>${m.cancelled + m.skipped + m.pending}</td><td>${pct(m.passRate)}</td></tr>`,
    )
    .join('\n');
  const li = (xs: string[]) =>
    xs.length
      ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<p class="muted">None.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Studio report ${esc(r.run.id.slice(0, 8))}</title>
<style>
:root{--bg:#fff;--fg:#1b1f24;--mut:#57606a;--bd:#d0d7de;--ok:#1a7f37;--bad:#b42318;--warn:#9a6700}
@media(prefers-color-scheme:dark){:root{--bg:#0f1419;--fg:#e6edf3;--mut:#9aa5b1;--bd:#30363d;--ok:#3fb950;--bad:#f85149;--warn:#d29922}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:16px;max-width:1200px;margin-inline:auto}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid var(--bd);padding:6px 10px;text-align:left;vertical-align:top}
.muted{color:var(--mut);font-size:13px}.st{font-weight:600}.passed{color:var(--ok)}.failed{color:var(--bad)}.blocked,.cancelled,.skipped{color:var(--warn)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px}dt{color:var(--mut)}dd{margin:0}
</style></head><body>
<h1>QA Studio execution report</h1>
<dl>
<dt>Execution ID</dt><dd>${esc(r.run.id)}</dd>
<dt>Status</dt><dd><span class="st ${esc(r.run.status)}">${esc(r.run.status)}</span></dd>
<dt>Environment / browser</dt><dd>${esc(r.run.environment)} / ${esc(r.run.browser)} (${r.run.workers} worker${r.run.workers === 1 ? '' : 's'})</dd>
${r.run.accounts.length ? `<dt>Signed in as</dt><dd>${r.run.accounts.map(esc).join(', ')}</dd>` : ''}
<dt>Started / ended</dt><dd>${esc(r.run.startedAt ?? '—')} / ${esc(r.run.endedAt ?? '—')} (${dur(r.run.durationMs)})</dd>
<dt>Framework version</dt><dd>${esc(r.frameworkVersion)} · report schema ${r.schemaVersion} · generated ${esc(r.generatedAt)}</dd>
</dl>
<h2>Summary</h2>
<p>${r.summary.total} selected · passed ${c.passed} · failed ${c.failed} · blocked ${c.blocked} · cancelled ${c.cancelled} · skipped ${c.skipped} · pending ${c.queued + c.running}<br>
<strong>Pass rate: ${pct(r.summary.passRate)}</strong> <span class="muted">${esc(r.summary.passRateRule)}</span></p>
<h2>Failure classification</h2>
${
  Object.keys(r.failureClassification).length
    ? `<ul>${Object.entries(r.failureClassification)
        .map(([k, n]) => `<li>${esc(k)}: ${n}</li>`)
        .join('')}</ul>`
    : '<p class="muted">No failures.</p>'
}
<h2>Coverage by module</h2>
<table><thead><tr><th>Module</th><th>Total</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Other</th><th>Pass rate</th></tr></thead><tbody>${cov}</tbody></table>
<h2>Test case results</h2>
<table><thead><tr><th>Test case</th><th>Module</th><th>Status</th><th>Duration</th><th>Details</th><th>Source</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Import and configuration issues</h2>
${li(r.issues)}
<h2>Known limitations</h2>
${li(r.limitations)}
</body></html>
`;
}
