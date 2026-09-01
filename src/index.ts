import './env.js';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServer } from './server.js';

void serveStdio(createServer);

// STDOUT is reserved exclusively for MCP protocol messages.
console.error('fabi-local-mcp running on stdio');
