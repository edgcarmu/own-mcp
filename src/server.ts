import { McpServer } from '@modelcontextprotocol/server';

import { registerJiraTools } from './tools/jira.js';
import { registerSystemTools } from './tools/system.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'fabi-local-mcp',
    version: '0.6.0',
  });

  registerSystemTools(server);
  registerJiraTools(server);

  return server;
}
