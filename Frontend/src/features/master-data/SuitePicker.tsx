/**
 * SuitePicker: choose a project, then one of its test suites. Used wherever a test case gets filed, so the two
 * dropdowns behave the same everywhere. Inactive projects and suites are not offered.
 */
import { Field, Select } from '../../design-system/index.js';
import { href } from '../../shared/hooks/useRoute.js';
import type { Project, TestSuite } from './api.js';

/** The suite to preselect: the first active suite of the first active project that has one. */
export function firstUsable(projects: Project[], suites: TestSuite[]): TestSuite | undefined {
  const active = new Set(projects.filter((p) => p.isActive).map((p) => p.id));
  return suites.find((s) => s.isActive && active.has(s.projectId));
}

/** The project and test suite drop-downs, as one control whose value is the suite. */
export function SuitePicker({
  projects,
  suites,
  suiteId,
  error,
  onChange,
}: {
  projects: Project[];
  suites: TestSuite[];
  /** The chosen suite; 0 when none is chosen. */
  suiteId: number;
  error?: string | undefined;
  onChange: (suiteId: number) => void;
}) {
  const projectId = suites.find((s) => s.id === suiteId)?.projectId ?? 0;
  const usable = suites.filter((s) => s.isActive);
  const projectsWithSuites = projects.filter(
    (p) => p.isActive && usable.some((s) => s.projectId === p.id),
  );
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-4)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
      }}
    >
      <Field label="Project" required>
        {(p) => (
          <Select
            {...p}
            value={projectId}
            onChange={(e) => {
              // A suite belongs to one project, so changing the project moves to that project's first suite.
              const next = usable.find((s) => s.projectId === Number(e.target.value));
              onChange(next?.id ?? 0);
            }}
          >
            {projectId === 0 && <option value={0}>Choose a project</option>}
            {projectsWithSuites.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Test suite"
        required
        error={error}
        hint={
          projectsWithSuites.length === 0 ? (
            <a href={href('master-data', 'test-suites')}>Set up a test suite first</a>
          ) : undefined
        }
      >
        {(p) => (
          <Select
            {...p}
            value={suiteId}
            disabled={projectId === 0}
            onChange={(e) => onChange(Number(e.target.value))}
          >
            {suiteId === 0 && <option value={0}>Choose a test suite</option>}
            {usable
              .filter((s) => s.projectId === projectId)
              .map((suite) => (
                <option key={suite.id} value={suite.id}>
                  {suite.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
