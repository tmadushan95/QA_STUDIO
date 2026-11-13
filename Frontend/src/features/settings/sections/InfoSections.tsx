/**
 * Read-only settings sections: the audit log (who changed what, never secrets or values) and About (version,
 * runtime and safety switches set on the server).
 */
import { Alert, Badge, DataTable, EmptyState, Panel } from '../../../design-system/index.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import { formatDate } from '../../../shared/lib/format.js';
import { fetchAudit, fetchSettings, type AuditEntry } from '../api.js';

/** Settings › Audit log. */
export function AuditSection() {
  const audit = useResource(fetchAudit);
  return (
    <Panel
      title="Audit log"
      description="The last 100 changes. Secrets and parameter values are never recorded."
      flush
    >
      {audit.error && <Alert tone="danger">{audit.error}</Alert>}
      <DataTable<AuditEntry>
        caption="Audit log"
        rows={audit.data ?? []}
        rowKey={(a) => String(a.id)}
        columns={[
          { key: 'at', header: 'When', shrink: true, cell: (a) => formatDate(a.at) },
          { key: 'action', header: 'Change', shrink: true, cell: (a) => <code>{a.action}</code> },
          { key: 'target', header: 'On', shrink: true, cell: (a) => a.target },
          { key: 'detail', header: 'Detail', cell: (a) => a.detail },
        ]}
        empty={<EmptyState icon="history" title="No changes recorded yet" />}
      />
    </Panel>
  );
}

/** Settings › About: versions and how this install is protected. */
export function AboutSection() {
  const s = useResource(fetchSettings);
  const d = s.data;
  if (!d) return <Panel title="About">Loading…</Panel>;
  return (
    <>
      <Panel title="About">
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: 'var(--space-2) var(--space-6)',
            margin: 0,
          }}
        >
          <dt>Version</dt>
          <dd style={{ margin: 0 }}>{d.runtime.frameworkVersion}</dd>
          <dt>Node.js</dt>
          <dd style={{ margin: 0 }}>{d.runtime.node}</dd>
          <dt>Platform</dt>
          <dd style={{ margin: 0 }}>{d.runtime.platform}</dd>
          <dt>Listening on</dt>
          <dd style={{ margin: 0 }}>{d.security.listening}</dd>
        </dl>
      </Panel>
      <Panel title="Safety" description="Set on the server (.env), not in the app.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {d.security.accessTokenRequired ? (
            <Badge tone="success" glyph="✓">
              Access token required
            </Badge>
          ) : (
            <Badge tone="neutral">No access token</Badge>
          )}
          {d.security.destructiveAllowed ? (
            <Badge tone="warning" glyph="!">
              Steps that delete data may run
            </Badge>
          ) : (
            <Badge tone="success" glyph="✓">
              Steps that delete data are blocked
            </Badge>
          )}
        </div>
        {d.notes.length > 0 && (
          <ul style={{ marginTop: 'var(--space-4)', color: 'var(--color-text-secondary)' }}>
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
