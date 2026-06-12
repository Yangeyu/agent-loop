const sseEventExamples = [
  "event: loop\ndata: {\"type\":\"session.start\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"agent\":\"build\",\"text\":\"hello\"}",
  "event: loop\ndata: {\"type\":\"turn.start\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"agent\":\"build\",\"messageID\":\"msg_1\",\"step\":1}",
  "event: state\ndata: {\"type\":\"message.created\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"message\":{\"id\":\"msg_1\",\"role\":\"assistant\",\"parentID\":\"usr_1\",\"agent\":\"build\",\"model\":{\"providerID\":\"dashscope\",\"modelID\":\"qwen3.7-plus\"},\"time\":{\"created\":0}}}",
  "event: state\ndata: {\"type\":\"part.created\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"messageID\":\"msg_1\",\"part\":{\"id\":\"prt_1\",\"type\":\"text\",\"text\":\"\"}}",
  "event: state\ndata: {\"type\":\"part.delta\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"messageID\":\"msg_1\",\"partID\":\"prt_1\",\"partType\":\"text\",\"delta\":\"Hello\"}",
  "event: state\ndata: {\"type\":\"part.updated\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"messageID\":\"msg_1\",\"part\":{\"id\":\"prt_2\",\"type\":\"tool\",\"toolName\":\"read\",\"toolCallId\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"filePath\":\"src/index.ts\"},\"output\":\"file content\"}}}",
  "event: loop\ndata: {\"type\":\"turn.end\",\"sessionID\":\"abc123\",\"rootID\":\"abc123\",\"agent\":\"build\",\"messageID\":\"msg_1\",\"step\":1,\"reason\":\"finish\",\"finishReason\":\"stop\",\"durationMs\":1200,\"toolCalls\":1}",
  "event: done\ndata: {\"sessionID\":\"abc123\"}",
].join("\n\n")

export function createOpenAPIDocument(input: { baseUrl: string }) {
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenCode SSE API",
      version: "0.1.0",
      description: "Minimal SSE API for streaming OpenCode runtime events to browser clients.",
    },
    servers: [
      {
        url: input.baseUrl,
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          operationId: "healthCheck",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                    },
                    required: ["ok"],
                  },
                },
              },
            },
          },
        },
      },
      "/api/chat": {
        post: {
          summary: "Stream chat events over SSE",
          operationId: "streamChat",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description: "Prompt text to send into the runtime.",
                    },
                    agent: {
                      type: "string",
                      description: "Optional agent name. Defaults to the runtime default agent.",
                    },
                    sessionID: {
                      type: "string",
                      description: "Optional existing session id to continue.",
                    },
                  },
                  required: ["text"],
                },
                examples: {
                  basic: {
                    value: {
                      text: "read packages/harness/src/core/loop.ts and explain the loop",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "SSE event stream",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description: "Server-Sent Events stream. Each frame contains an event name and JSON payload.",
                  },
                  examples: {
                    stream: {
                      summary: "SSE event sequence",
                      value: sseEventExamples,
                    },
                  },
                },
              },
            },
            "400": {
              description: "Invalid request body",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
                      issues: { type: "array", items: { type: "object", additionalProperties: true } },
                    },
                    required: ["error"],
                  },
                },
              },
            },
            "404": {
              description: "Session not found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
                    },
                    required: ["error"],
                  },
                },
              },
            },
          },
          description: [
            "Streams the harness event vocabulary verbatim (see @agent-loop/contracts):",
            "- state: StateEvent (message.created/updated, part.created/delta/updated, history.replaced)",
            "- loop: LoopEvent (session.start, turn.start/input/phase/retry/outcome/end, budget.hit)",
            "- error: transport-level failure",
            "- done: the run completed",
            "Clients project session state by folding `state` frames with applyStateEvent.",
          ].join("\n"),
        },
      },
      "/api/files/content": {
        get: {
          summary: "Read a workspace file as text",
          operationId: "getFileContent",
          parameters: [
            {
              name: "path",
              in: "query",
              required: true,
              schema: {
                type: "string",
              },
              description: "Absolute or workspace-relative file path.",
            },
          ],
          responses: {
            "200": {
              description: "Text file content",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      filename: { type: "string" },
                      content: { type: "string" },
                    },
                    required: ["path", "filename", "content"],
                  },
                },
              },
            },
            "400": {
              description: "Invalid file path",
            },
            "404": {
              description: "File not found",
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI document",
          operationId: "getOpenAPI",
          responses: {
            "200": {
              description: "OpenAPI 3.1 JSON document",
            },
          },
        },
      },
      "/docs": {
        get: {
          summary: "Scalar API docs",
          operationId: "getDocs",
          responses: {
            "200": {
              description: "HTML page rendering Scalar API reference",
            },
          },
        },
      },
    },
  }
}

export function renderScalarDocumentPage(input: { openapiUrl: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode SSE API Docs</title>
    <style>
      body {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="${input.openapiUrl}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
}
