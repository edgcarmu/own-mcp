export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export function textResult(text: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

export function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

// Runs a tool handler and converts any thrown error into an MCP error
// result prefixed with `errorPrefix`, instead of crashing the request.
export async function runTool(
    errorPrefix: string,
    run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const message =
        error instanceof Error ? error.message : String(error);

    return {
      ...textResult(`${errorPrefix}: ${message}`),
      isError: true,
    };
  }
}
