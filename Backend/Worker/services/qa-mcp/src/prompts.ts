import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ToolContext } from './result.js';

const ask = (text: string): GetPromptResult => ({
  messages: [{ role: 'user', content: { type: 'text', text } }],
});

/**
 * The platform's everyday workflows as ready-made instructions. Clients show them as slash commands; each one names
 * the tools to call in order, so any agent follows the same safe path a person would.
 */
export function registerPrompts(ctx: ToolContext): void {
  const { server, toolsets } = ctx;

  if (toolsets.has('author')) {
    server.registerPrompt(
      'generate-cases-from-requirement',
      {
        title: 'Test cases from a requirement',
        description:
          'Propose test cases for a requirement or story, then add the ones the person keeps.',
        argsSchema: {
          requirement: z.string().describe('The requirement, story or acceptance criteria'),
          projectId: z.string().optional().describe('QA Studio project ID'),
          suiteId: z.string().optional().describe('Suite to add the cases to'),
        },
      },
      ({ requirement, projectId, suiteId }) =>
        ask(
          [
            'Write test cases for this requirement in QA Studio.',
            '',
            requirement,
            '',
            `1. Call propose_test_cases with the requirement${projectId ? ` and projectId ${projectId}` : ''}.`,
            '2. Show me the proposals as a short numbered list (title, priority, category) and ask which to keep or change.',
            `3. Call add_test_cases with only the ones I keep${suiteId ? `, suiteId ${suiteId}` : ''}.`,
            '4. Report the new test case IDs.',
          ].join('\n'),
        ),
    );

    server.registerPrompt(
      'automate-test-case',
      {
        title: 'Automate a test case',
        description: 'Write automation steps for a test case as a draft for review.',
        argsSchema: { caseId: z.string().describe('Test case ID, such as TC_12') },
      },
      ({ caseId }) =>
        ask(
          [
            `Automate test case ${caseId} in QA Studio.`,
            '',
            `1. Read it with get_test_case and its current automation with get_scenario.`,
            '2. Read list_actions (and qa://docs/step-format if you have it). Use only those actions; use {{data.name}} for test data and never real passwords.',
            '3. Check your steps with validate_scenario and fix every problem it lists.',
            '4. Save them with save_scenario_draft, with a note for the reviewer.',
            '5. Tell me what the reviewer should look at. A person approves the draft in the dashboard; do not try to run it before that.',
          ].join('\n'),
        ),
    );

    server.registerPrompt(
      'triage-failed-run',
      {
        title: 'Triage a failed run',
        description:
          'Find out why each case of a run failed: an out-of-date test or a likely defect.',
        argsSchema: { runId: z.string().describe('Run ID') },
      },
      ({ runId }) =>
        ask(
          [
            `Triage run ${runId} in QA Studio.`,
            '',
            '1. Call get_run and list the failed cases with their failing step.',
            '2. For each failed case, call diagnose_failed_case.',
            '3. Group the answers: "test-fix" (a corrected draft is waiting for review) and "likely-defect" (the app is probably wrong).',
            toolsets.has('defects')
              ? '4. For likely defects only: call rerun_failed_cases, wait_for_run, diagnose the new run, and call report_defect for cases that fail again. Never report a case that passed on the rerun.'
              : '4. List the likely defects with what to tell the developers.',
          ].join('\n'),
        ),
    );
  }

  server.registerPrompt(
    'coverage-review',
    {
      title: 'Coverage review',
      description: 'What is not tested yet in a project version, and what to automate next.',
      argsSchema: {
        projectId: z.string().describe('QA Studio project ID'),
        versionId: z.string().optional().describe('Project version ID'),
      },
    },
    ({ projectId, versionId }) =>
      ask(
        [
          `Review test coverage of project ${projectId}${versionId ? `, version ${versionId}` : ''} in QA Studio.`,
          '',
          '1. Call get_dashboard and get_insights for that scope.',
          '2. Call get_parameter_summary to find cases that cannot run for missing test data.',
          '3. Report: modules with few or no cases, cases without approved automation, recent failures, and missing parameters.',
          '4. End with the five most useful next steps, most valuable first.',
        ].join('\n'),
      ),
  );
}
