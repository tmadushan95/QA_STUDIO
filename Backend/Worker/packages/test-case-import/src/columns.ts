export const FIELDS = [
  'id',
  'title',
  'description',
  'module',
  'preconditions',
  'steps',
  'expectedResult',
  'priority',
  'severity',
  'testType',
  'userRole',
  'tags',
  'dependsOn',
] as const;
export type Field = (typeof FIELDS)[number];

/** Field -> 1-based worksheet column index. */
export type ColumnMapping = Partial<Record<Field, number>>;

/** Header text (normalized) accepted for each field. Exact match only. */
const ALIASES: Record<Field, string[]> = {
  id: ['id', 'testcaseid', 'tcid', 'testid', 'caseid', 'testcaseno', 'testcasenumber'],
  title: ['title', 'testcasetitle', 'testcasename', 'name', 'summary', 'scenario', 'testscenario'],
  description: ['description', 'testdescription', 'objective'],
  module: ['module', 'businessmodule', 'feature', 'area', 'functionalarea'],
  preconditions: ['preconditions', 'precondition', 'prerequisites', 'prerequisite'],
  steps: ['steps', 'teststeps', 'stepsdescription', 'procedure', 'teststepdescription'],
  expectedResult: ['expectedresult', 'expectedresults', 'expected', 'expectedoutcome'],
  priority: ['priority'],
  severity: ['severity'],
  testType: ['testtype', 'type', 'category'],
  userRole: ['userrole', 'role', 'persona', 'actor'],
  tags: ['tags', 'tag', 'labels'],
  dependsOn: ['dependencies', 'dependson', 'dependency'],
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map header cells (index 0 = column 1) to known fields. Each column and field is used once. */
export function autoMap(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const field = FIELDS.find((f) => mapping[f] === undefined && ALIASES[f].includes(n));
    if (field) mapping[field] = i + 1;
  });
  return mapping;
}

export const HEADER_LABELS: Record<Field, string> = {
  id: 'Test Case ID',
  title: 'Title',
  description: 'Description',
  module: 'Module',
  preconditions: 'Preconditions',
  steps: 'Steps',
  expectedResult: 'Expected Result',
  priority: 'Priority',
  severity: 'Severity',
  testType: 'Test Type',
  userRole: 'User Role',
  tags: 'Tags',
  dependsOn: 'Dependencies',
};
