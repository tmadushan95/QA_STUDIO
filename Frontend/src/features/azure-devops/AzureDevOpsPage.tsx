/**
 * Azure DevOps: connect Test Plans to QA Studio and automate testing end to end.
 *
 * 1. **Connection** — organization URL, project and a Personal Access Token (write-only).
 * 2. **What to automate** — the Azure DevOps plan and suite, where imported cases are filed in QA Studio (suite and
 *    version), which users the run signs in as, and which stages run automatically.
 * 3. **Run** — "Import now" brings the cases in for review; "Run full pipeline" imports, converts, approves, fills
 *    parameters, runs and publishes the results back to the plan, with each stage shown live.
 * 4. **From a pipeline** — a YAML step that starts the same pipeline from Azure Pipelines (for example nightly or after
 *    a deployment), so testing runs fully automatically.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { formatDate, plural } from '../../shared/lib/format.js';
import { fetchAccounts, fetchSuites, useProjectScope } from '../master-data/index.js';
import {
  fetchAdoSuites,
  fetchAzureDevOps,
  fetchPipelineJobs,
  fetchPlans,
  importFromAzure,
  removeToken,
  saveAzureDevOps,
  saveToken,
  startPipeline,
  testConnection,
  type AdoSuiteItem,
  type AzureDevOpsConfig,
  type PipelineJob,
  type PlanItem,
} from './api.js';
import styles from './AzureDevOpsPage.module.css';

const DEFAULTS: AzureDevOpsConfig = {
  orgUrl: '',
  project: '',
  accountIds: [],
  autoApprove: true,
  autoParameters: true,
  publishResults: true,
};

const STAGE_LABEL: Record<PipelineJob['steps'][number]['stage'], string> = {
  import: 'Import test cases',
  convert: 'Convert to steps',
  approve: 'Approve',
  parameters: 'Fill parameters',
  run: 'Run',
  publish: 'Publish results',
};

/** The Azure DevOps page. */
export function AzureDevOpsPage() {
  const toast = useToast();
  const view = useResource(fetchAzureDevOps);
  const scope = useProjectScope();
  const projectId = scope.project?.id ?? 0;
  const master = useResource(async () => {
    const [suites, accounts] = await Promise.all([fetchSuites(), fetchAccounts().catch(() => [])]);
    return { suites, accounts };
  });
  const jobs = useResource(fetchPipelineJobs);
  useLive((e) => e.type === 'job' && jobs.reload(), 500);

  const [form, setForm] = useState<AzureDevOpsConfig>(DEFAULTS);
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [plans, setPlans] = useState<PlanItem[]>();
  const [adoSuites, setAdoSuites] = useState<AdoSuiteItem[]>();
  const [check, setCheck] = useState<{ ok: boolean; message: string }>();

  // Fill the form once the saved settings arrive.
  useEffect(() => {
    if (view.data) setForm({ ...DEFAULTS, ...view.data.config } as AzureDevOpsConfig);
  }, [view.data]);

  const ready = view.data?.ready === true;
  useEffect(() => {
    if (!ready) return;
    fetchPlans().then(setPlans, () => setPlans([]));
  }, [ready]);
  useEffect(() => {
    if (!ready || !form.planId) {
      setAdoSuites(undefined);
      return;
    }
    fetchAdoSuites(form.planId).then(setAdoSuites, () => setAdoSuites([]));
  }, [ready, form.planId]);

  // Everything is filed in, and runs as, the project in the header.
  const suites = (master.data?.suites ?? []).filter((s) => s.projectId === projectId);
  const versions = scope.versions;
  const accounts = (master.data?.accounts ?? []).filter((a) => a.projectId === projectId);

  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setErrors({});
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    act('save', async () => {
      // A JSON round trip drops the choices left empty, which the server treats as "not set".
      await saveAzureDevOps(
        JSON.parse(
          JSON.stringify({ ...form, projectId: projectId || undefined }),
        ) as AzureDevOpsConfig,
      );
      if (token.trim()) {
        await saveToken(token.trim());
        setToken('');
      }
      view.reload();
      toast.show('Azure DevOps settings saved.');
    });

  const runImport = () =>
    act('import', async () => {
      if (!form.planId || !form.suiteId) throw new Error('Choose the test plan and suite first.');
      const r = await importFromAzure({
        planId: form.planId,
        suiteId: form.suiteId,
        ...(projectId && { projectId }),
        ...(form.testSuiteId && { testSuiteId: form.testSuiteId }),
        ...(form.projectVersionId && { projectVersionId: form.projectVersionId }),
      });
      toast.show(
        `Imported ${plural(r.added, 'new test case')} and updated ${r.updated}. Review them on Test Case Studio.`,
      );
    });

  const runPipeline = () =>
    act('pipeline', async () => {
      await startPipeline({
        ...(form.planId && { planId: form.planId }),
        ...(form.suiteId && { suiteId: form.suiteId }),
        accountIds: form.accountIds,
      });
      jobs.reload();
      toast.show('The pipeline started. Each stage shows below as it runs.', { tone: 'info' });
    });

  const latest = jobs.data?.[0];
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:5080' : window.location.origin;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Azure DevOps"
        description="Import test cases from Azure Test Plans, run them automatically, and publish the results back."
        actions={
          <Badge tone={ready ? 'success' : 'warning'} glyph={ready ? '●' : '!'}>
            {ready ? 'Connected' : 'Not connected'}
          </Badge>
        }
      />

      <ol className={styles.flow} aria-label="How the automation works">
        {(['import', 'convert', 'approve', 'parameters', 'run', 'publish'] as const).map((s, i) => (
          <li key={s}>
            <span className={styles.flowNo}>{i + 1}</span>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>

      {view.error && <Alert tone="danger">{view.error}</Alert>}

      <div className={styles.grid}>
        <Panel
          title="Connection"
          description="Use a Personal Access Token with Test Management (read & write) and Work Items (read)."
        >
          <div className={styles.form}>
            <Field
              label="Organization URL"
              required
              error={errors['orgUrl']}
              hint="Such as https://dev.azure.com/contoso"
            >
              {(p) => (
                <TextInput
                  {...p}
                  type="url"
                  value={form.orgUrl}
                  placeholder="https://dev.azure.com/your-organization"
                  onChange={(e) => setForm({ ...form, orgUrl: e.target.value })}
                />
              )}
            </Field>
            <Field label="Project" required error={errors['project']}>
              {(p) => (
                <TextInput
                  {...p}
                  value={form.project}
                  onChange={(e) => setForm({ ...form, project: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Personal Access Token"
              error={errors['token']}
              hint={
                view.data?.hasToken
                  ? 'A token is saved. Paste a new one to replace it.'
                  : 'Stored encrypted; never shown again.'
              }
            >
              {(p) => (
                <TextInput
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={token}
                  placeholder={view.data?.hasToken ? '•••••••• saved' : 'Paste the token'}
                  onChange={(e) => setToken(e.target.value)}
                />
              )}
            </Field>
            <div className={styles.row}>
              <Button
                variant="primary"
                loading={busy === 'save'}
                onClick={() => void save()}
                disabled={!form.orgUrl || !form.project}
              >
                Save
              </Button>
              <Button
                icon="link"
                disabled={!ready}
                loading={busy === 'test'}
                onClick={() => void act('test', async () => setCheck(await testConnection()))}
              >
                Test connection
              </Button>
              {view.data?.hasToken && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act('remove', async () => {
                      await removeToken();
                      view.reload();
                    })
                  }
                >
                  Remove token
                </Button>
              )}
            </div>
            {check && (
              <Alert
                tone={check.ok ? 'success' : 'danger'}
                title={check.ok ? 'Connected' : 'Could not connect'}
              >
                {check.message}
              </Alert>
            )}
            {!ready && view.data?.reason && <p className={styles.muted}>{view.data.reason}</p>}
          </div>
        </Panel>

        <Panel
          title="What to automate"
          description="Choose the Azure DevOps suite and where its cases live in QA Studio."
        >
          <div className={styles.form}>
            <div className={styles.pair}>
              <Field label="Test plan" error={errors['planId']}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.planId ?? 0}
                    disabled={!ready}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        planId: Number(e.target.value) || undefined,
                        suiteId: undefined,
                      })
                    }
                  >
                    <option value={0}>
                      {ready ? (plans ? 'Choose a plan' : 'Loading…') : 'Connect first'}
                    </option>
                    {(plans ?? []).map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Plan suite" error={errors['suiteId']}>
                {(p) => (
                  <Select
                    {...p}
                    value={form.suiteId ?? 0}
                    disabled={!form.planId}
                    onChange={(e) =>
                      setForm({ ...form, suiteId: Number(e.target.value) || undefined })
                    }
                  >
                    <option value={0}>Choose a suite</option>
                    {(adoSuites ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className={styles.pair}>
              <Field
                label="File cases under (QA Studio suite)"
                hint={`Without one, each Azure suite becomes a suite of ${scope.project?.name ?? 'this project'}.`}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={form.testSuiteId ?? 0}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        testSuiteId: Number(e.target.value) || undefined,
                      })
                    }
                  >
                    <option value={0}>By Azure suite name</option>
                    {suites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Project version">
                {(p) => (
                  <Select
                    {...p}
                    value={form.projectVersionId ?? 0}
                    onChange={(e) =>
                      setForm({ ...form, projectVersionId: Number(e.target.value) || undefined })
                    }
                  >
                    <option value={0}>No version</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <fieldset className={styles.fieldset}>
              <legend>Run as</legend>
              {accounts.length === 0 ? (
                <p className={styles.muted}>
                  This project has no users. <a href={href('sign-in-users')}>Add sign-in users</a>.
                </p>
              ) : (
                accounts.map((a) => (
                  <Checkbox
                    key={a.id}
                    label={a.label}
                    hint={a.username}
                    checked={form.accountIds.includes(a.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        accountIds: e.target.checked
                          ? [...form.accountIds, a.id]
                          : form.accountIds.filter((x) => x !== a.id),
                      })
                    }
                  />
                ))
              )}
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend>Automatically</legend>
              <Checkbox
                label="Approve steps that check out"
                hint="Off: drafts wait for a person on Test Case Studio."
                checked={form.autoApprove}
                onChange={(e) => setForm({ ...form, autoApprove: e.target.checked })}
              />
              <Checkbox
                label="Fill missing parameters"
                hint="From old test data, the AI, or a guess from the name. Password-like names are never filled."
                checked={form.autoParameters}
                onChange={(e) => setForm({ ...form, autoParameters: e.target.checked })}
              />
              <Checkbox
                label="Publish results to the test plan"
                hint="Creates an automated test run on the suite’s test points."
                checked={form.publishResults}
                onChange={(e) => setForm({ ...form, publishResults: e.target.checked })}
              />
            </fieldset>
            <div className={styles.row}>
              <Button onClick={() => void save()} loading={busy === 'save'}>
                Save choices
              </Button>
              <Button
                icon="download"
                disabled={!ready || !form.suiteId}
                loading={busy === 'import'}
                onClick={() => void runImport()}
              >
                Import now
              </Button>
              <Button
                variant="primary"
                icon="execute"
                disabled={!ready || !form.suiteId || latest?.status === 'running'}
                loading={busy === 'pipeline'}
                onClick={() => void runPipeline()}
              >
                Run full pipeline
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Pipeline runs" description="Each stage of the latest automated runs, live.">
        {(jobs.data ?? []).length === 0 ? (
          <EmptyState icon="execute" title="No pipeline has run yet">
            Choose a plan suite and press “Run full pipeline”, or call it from Azure Pipelines.
          </EmptyState>
        ) : (
          <ul className={styles.jobs}>
            {jobs.data!.slice(0, 5).map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={
          <span className={styles.inline}>
            <Icon name="cloud" /> Run from Azure Pipelines
          </span>
        }
        description="Add this step to a pipeline (for example nightly, or after deploying to the test environment)."
      >
        <pre className={styles.code}>{pipelineYaml(origin, form)}</pre>
        <p className={styles.muted}>
          Store the QA Studio access token as a secret pipeline variable named{' '}
          <code>QA_STUDIO_TOKEN</code>. The agent must reach this server.
        </p>
      </Panel>
    </div>
  );
}

function JobCard({ job }: { job: PipelineJob }) {
  return (
    <li className={styles.job}>
      <div className={styles.jobHead}>
        <StatusBadge
          status={
            job.status === 'running' ? 'running' : job.status === 'done' ? 'passed' : 'failed'
          }
          {...(job.status === 'done' && { label: 'Finished' })}
        />
        <span>
          Plan {job.planId} · Suite {job.suiteId} · {plural(job.caseIds.length, 'case')}
        </span>
        <span className={styles.muted}>{formatDate(job.startedAt)}</span>
        {job.runId && <a href={href('runs', job.runId)}>Open the run</a>}
        {job.azureRunUrl && (
          <a href={job.azureRunUrl} target="_blank" rel="noreferrer">
            Azure run {job.azureRunId}
          </a>
        )}
      </div>
      <ol className={styles.stages}>
        {job.steps.map((s) => (
          <li key={s.stage} className={`${styles.stage} ${styles[`stage_${s.status}`] ?? ''}`}>
            <span className={styles.stageName}>{STAGE_LABEL[s.stage]}</span>
            <span className={styles.stageState}>{s.status}</span>
            {s.message && <span className={styles.stageMsg}>{s.message}</span>}
          </li>
        ))}
      </ol>
      {job.error && <Alert tone="danger">{job.error}</Alert>}
    </li>
  );
}

/** A copy-paste Azure Pipelines step that starts the QA Studio pipeline and waits for it. */
function pipelineYaml(origin: string, c: AzureDevOpsConfig): string {
  const body = JSON.stringify({ planId: c.planId ?? 0, suiteId: c.suiteId ?? 0 });
  return `- task: PowerShell@2
  displayName: QA Studio – automated tests
  inputs:
    targetType: inline
    script: |
      $headers = @{ Authorization = "Bearer $(QA_STUDIO_TOKEN)" }
      $job = Invoke-RestMethod -Method Post -Uri "${origin}/api/azure-devops/pipeline" \`
        -Headers $headers -ContentType 'application/json' -Body '${body}'
      do {
        Start-Sleep -Seconds 15
        $job = (Invoke-RestMethod -Uri "${origin}/api/azure-devops/jobs" -Headers $headers).items |
          Where-Object id -eq $job.id
        Write-Host "Pipeline: $($job.status)"
      } while ($job.status -eq 'running')
      if ($job.status -ne 'done') { throw "QA Studio pipeline $($job.status): $($job.error)" }`;
}
