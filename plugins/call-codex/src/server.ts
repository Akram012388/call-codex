import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleToolCall, toolDefinitions } from "./tools.js";

const server = new Server(
  {
    name: "call-codex",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    },
    instructions:
      "CALL-CODEX opens app-server-powered calls between Codex threads. Use call_boot first, keep traffic on 127.0.0.1, and keep the vibe playful but precise."
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleToolCall(request.params.name, request.params.arguments);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
