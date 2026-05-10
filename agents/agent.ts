// agent.ts — Claude Agents SDK + Composio

import { query } from "@anthropic-ai/claude-agent-sdk";
import { Composio } from "@composio/core";

const composio = new Composio();
const userId = "user_68pc4a";

// Create a tool router session
const session = await composio.create(userId);

// Query Claude with MCP tools
const stream = await query({
  prompt: "Star the composiohq/composio repo on GitHub",
  options: {
    permissionMode: "bypassPermissions",
    mcpServers: {
      composio: session.mcp,
    },
  },
});

for await (const event of stream) {
  if (event.type === "result" && event.subtype === "success") {
    process.stdout.write(event.result);
  }
}