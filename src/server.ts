import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/server';

import { registerJiraTools } from './tools/jira.js';
import { registerSystemTools } from './tools/system.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'own-mcp',
    version,
  });

  registerSystemTools(server);
  registerJiraTools(server);

  return server;
}
