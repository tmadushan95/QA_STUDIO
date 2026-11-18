import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Api } from './client.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import type { ToolContext } from './result.js';
import { registerAiTools } from './tools/ai.js';
import { registerAzureDevOpsTools } from './tools/azure-devops.js';
import { registerInsightTools } from './tools/insights.js';
import { registerParameterTools } from './tools/parameters.js';
import { registerProjectTools } from './tools/projects.js';
import { registerRunTools } from './tools/runs.js';
import { registerScenarioTools } from './tools/scenarios.js';
import { registerTestCaseTools } from './tools/test-cases.js';
import { DEFAULT_TOOLSETS, type Toolset } from './toolsets.js';

export interface McpServerOptions {
  /** Toolsets to register; `read,author,operate` when left out. */
  toolsets?: Iterable<Toolset>;
  /** Project the agent works in when it does not name one. */
  defaultProjectId?: number;
  /** How often waits ask for news, in ms. Tests make it short. */
  pollMs?: number;
}

const INSTRUCTIONS = `QA Studio: written test cases, their automation (scenarios) and runs in real browsers.
- Find things with list_projects, search_test_cases and get_test_case.
- Automation steps use only the actions from list_actions. Check them with validate_scenario, save them with save_scenario_draft.
- An assistant writes DRAFTS. A person approves them in the dashboard; only approved scenarios run.
- Runs (start_run) take seconds to minutes: follow them with wait_for_run.
- Never put real passwords or codes in steps or parameters; use {{data.name}} values.`;

/**
 * The platform as MCP tools, resources and prompts, for an AI assistant (Claude Code, Claude Desktop, Gemini CLI, any
 * MCP client).
 *
 * What it cannot do, on purpose, whatever the toolsets: approve, edit or restore an approved scenario, change
 * settings, keys, accounts or connections, or see any secret. Approval stays a human decision in the dashboard.
 */
export function createMcpServer(api: Api, options: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'qa-studio', version: '0.2.0' },
    { instructions: INSTRUCTIONS },
  );
  const ctx: ToolContext = {
    server,
    api,
    toolsets: new Set<Toolset>(['read', ...(options.toolsets ?? DEFAULT_TOOLSETS)]),
    defaultProjectId: options.defaultProjectId,
  };
  registerProjectTools(ctx);
  registerTestCaseTools(ctx);
  registerParameterTools(ctx);
  registerScenarioTools(ctx);
  registerRunTools(ctx, options.pollMs);
  registerAiTools(ctx, options.pollMs);
  registerInsightTools(ctx);
  registerAzureDevOpsTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);
  return server;
}
