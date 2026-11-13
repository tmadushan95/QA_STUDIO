/**
 * Public entry of the design system, in atomic-design order: atoms → molecules → organisms → templates.
 * Features import from here; the design system never imports from features.
 */
export { Badge, type BadgeTone } from './atoms/Badge.js';
export { Button, IconButton, type ButtonVariant } from './atoms/Button.js';
export { Icon, type IconName } from './atoms/Icon.js';
export { Checkbox, Select, TextArea, TextInput } from './atoms/Inputs.js';
export { Spinner } from './atoms/Spinner.js';

export { Alert, EmptyState, ProgressBar, SearchBox } from './molecules/Feedback.js';
export { Field, type FieldControlProps } from './molecules/Field.js';
export { InfoTip } from './molecules/InfoTip.js';
export { Menu, type MenuItem } from './molecules/Menu.js';
export { StatusBadge } from './molecules/StatusBadge.js';
export { Tabs, tabPanelProps, type TabItem } from './molecules/Tabs.js';

export { DataTable, type Column } from './organisms/DataTable.js';
export { ConfirmDialog, Dialog } from './organisms/Dialog.js';
export { PageHeader, Panel, SaveBar } from './organisms/Layout.js';
export { StickyBar, stickyBelow } from './organisms/StickyBar.js';
export { ToastProvider, useToast } from './organisms/Toaster.js';

export { AppLayout, type NavItem } from './templates/AppLayout.js';
export { SettingsLayout, type SettingsSection } from './templates/SettingsLayout.js';
