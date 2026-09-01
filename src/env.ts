import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// Load the .env that belongs to this project.
// MCP clients may spawn the server from a different working directory.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  // STDOUT is reserved for MCP protocol messages; keep dotenv's banner out.
  quiet: true,
});
