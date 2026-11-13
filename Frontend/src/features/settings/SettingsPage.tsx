/**
 * Settings page: one short page per topic, chosen from a sub-menu (`/settings/<section>`), so each setting is
 * easy to find and save on its own.
 */
import { PageHeader, SettingsLayout, type SettingsSection } from '../../design-system/index.js';
import { href } from '../../shared/hooks/useRoute.js';
import { AiSection } from './sections/AiSection.js';
import { DataSection } from './sections/DataSection.js';
import { AboutSection, AuditSection } from './sections/InfoSections.js';
import { PagesSection } from './sections/PagesSection.js';
import { ExecutionSection } from './sections/RunSettingsSections.js';
import { VoiceSection } from './sections/VoiceSection.js';

const SECTIONS: (SettingsSection & { render: () => JSX.Element })[] = [
  {
    id: 'execution',
    label: 'Execution',
    icon: 'play',
    href: href('settings', 'execution'),
    render: () => <ExecutionSection />,
  },
  {
    id: 'pages',
    label: 'Pages',
    icon: 'cases',
    href: href('settings', 'pages'),
    render: () => <PagesSection />,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkle',
    href: href('settings', 'ai'),
    render: () => <AiSection />,
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: 'mic',
    href: href('settings', 'voice'),
    render: () => <VoiceSection />,
  },
  {
    id: 'data',
    label: 'Data & storage',
    icon: 'data',
    href: href('settings', 'data'),
    render: () => <DataSection />,
  },
  {
    id: 'audit',
    label: 'Audit log',
    icon: 'history',
    href: href('settings', 'audit'),
    render: () => <AuditSection />,
  },
  {
    id: 'about',
    label: 'About',
    icon: 'info',
    href: href('settings', 'about'),
    render: () => <AboutSection />,
  },
];

/** The Settings page; `section` chooses which topic shows. */
export function SettingsPage({ section }: { section: string | undefined }) {
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  return (
    <>
      <PageHeader
        title="Organization settings"
        description="How tests run on this computer, the page list, and the AI assistant. Each project’s address and sign-in are in Projects & Versions."
      />
      <SettingsLayout sections={SECTIONS} active={active.id}>
        {active.render()}
      </SettingsLayout>
    </>
  );
}
