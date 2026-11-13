/**
 * Project settings, like Azure DevOps' project settings: everything that belongs to the project in the header, one
 * section at a time (`/project/<CODE>/settings/<section>`). None of the sections offers a project picker; the header
 * is the one place to switch.
 */
import { lazy, Suspense } from 'react';
import {
  EmptyState,
  PageHeader,
  SettingsLayout,
  type SettingsSection,
} from '../../design-system/index.js';
import { hrefIn } from '../../shared/hooks/useRoute.js';
import { CommonParametersSection } from './CommonParametersSection.js';
import { CustomStepsSection } from './CustomStepsSection.js';
import { ProjectDetail } from './ProjectDetail.js';
import { useProjectScope } from './ProjectScope.js';
import { TestSuitesSection } from './TestSuitesSection.js';
import { VersionsSection } from './VersionsSection.js';

const SignInUsersPage = lazy(() =>
  import('../sign-in-users/SignInUsersPage.js').then((m) => ({ default: m.SignInUsersPage })),
);

type Section = Omit<SettingsSection, 'href'> & { render: (projectId: number) => JSX.Element };

const SECTIONS: Section[] = [
  {
    id: 'general',
    label: 'Application & sign-in',
    icon: 'folder',
    render: (id) => <ProjectDetail id={id} />,
  },
  { id: 'versions', label: 'Versions', icon: 'version', render: () => <VersionsSection /> },
  { id: 'test-suites', label: 'Test suites', icon: 'cases', render: () => <TestSuitesSection /> },
  {
    id: 'parameters',
    label: 'Parameters',
    icon: 'sliders',
    render: () => <CommonParametersSection />,
  },
  {
    id: 'custom-steps',
    label: 'Custom steps',
    icon: 'design',
    render: () => <CustomStepsSection />,
  },
  { id: 'sign-in-users', label: 'Sign-in users', icon: 'users', render: () => <SignInUsersPage /> },
];

/** The current project's settings; `section` picks one. */
export function ProjectSettingsPage({ section }: Readonly<{ section: string | undefined }>) {
  const { project } = useProjectScope();
  if (!project) return <EmptyState icon="refresh" title="Loading the project…" />;
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const sections = SECTIONS.map((s) => ({
    ...s,
    href: hrefIn(project.code, 'project-settings', s.id),
  }));
  return (
    <>
      <PageHeader
        title="Project settings"
        description={`Where ${project.name} runs, how it signs in, its versions, test suites, common parameters, custom steps and test users.`}
      />
      <SettingsLayout sections={sections} active={active.id} label="Project settings sections">
        <Suspense fallback={<EmptyState icon="refresh" title="Loading…" />}>
          {active.render(project.id)}
        </Suspense>
      </SettingsLayout>
    </>
  );
}
