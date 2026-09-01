import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { jsonResult, runTool, textResult } from './results.js';

const execFileAsync = promisify(execFile);

export function registerSystemTools(server: McpServer): void {
  server.registerTool(
      'get-system-info',
      {
        title: 'Get System Info',
        description: 'Returns basic information about the local machine.',
        inputSchema: z.object({}),
      },
      async () =>
          jsonResult({
            hostname: os.hostname(),
            platform: os.platform(),
            architecture: os.arch(),
            homeDirectory: os.homedir(),
            cpuCount: os.cpus().length,
            totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3),
            nodeVersion: process.version,
          }),
  );

  server.registerTool(
      'get-git-status',
      {
        title: 'Get Git Status',
        description: 'Returns the Git status of a local repository.',
        inputSchema: z.object({
          path: z
              .string()
              .describe('Absolute path to the local Git repository'),
        }),
      },
      async ({ path }) =>
          runTool('Unable to read Git repository', async () => {
            const { stdout } = await execFileAsync(
                'git',
                ['status', '--short', '--branch'],
                {
                  cwd: path,
                },
            );

            return textResult(stdout.trim() || 'Working tree clean');
          }),
  );
}
