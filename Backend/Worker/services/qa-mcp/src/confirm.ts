import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The two checks every delete passes. First the agent must name the target again (`confirm`), which catches a wrong ID
 * picked from a list. Then, when the client can ask its user (MCP elicitation), the person confirms outside the model,
 * so a model cannot talk itself into a delete.
 */
export async function confirmDelete(
  server: McpServer,
  what: string,
  expected: string,
  given: string,
): Promise<void> {
  if (given.trim() !== expected) {
    throw new Error(
      `Nothing was deleted. To delete ${what}, call again with confirm: "${expected}".`,
    );
  }
  if (!server.server.getClientCapabilities()?.elicitation) return;
  const answer = await server.server.elicitInput({
    mode: 'form',
    message: `Delete ${what}? This cannot be undone.`,
    requestedSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', title: `Yes, delete ${what}` } },
      required: ['confirm'],
    },
  });
  if (answer.action !== 'accept' || answer.content?.['confirm'] !== true) {
    throw new Error(`Nothing was deleted: the person did not confirm deleting ${what}.`);
  }
}
