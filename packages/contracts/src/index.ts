// Wire contract shared by backend (HTTP/SSE) and frontend (browser).
// Pure types only — no runtime, no node/bun globals — so the browser can import it safely.
// This is the single source of truth for the streaming protocol; both sides must conform.

export type ToolAttachment = {
  mime: string
  filename?: string
  path?: string
  bytes?: number
}

export type ArtifactFile = {
  path: string
  filename: string
  mime: string
  bytes: number
}

export type ToolCallWire = {
  toolCallId: string
  toolName: string
  args?: unknown
  title?: string
  metadata?: Record<string, unknown>
}

export type ToolResultWire = {
  toolCallId: string
  toolName: string
  output?: string
  title?: string
  metadata?: Record<string, unknown>
  attachments?: ToolAttachment[]
  error?: {
    message: string
    code?: string
  }
}

export type StreamEvent =
  | {
      event: "session-metadata"
      data: {
        sessionID: string
        agent: string
      }
    }
  | {
      event: "message-metadata"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        agent: string
        step: number
      }
    }
  | {
      event: "reasoning-delta"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        delta: string
      }
    }
  | {
      event: "text-start"
      data: {
        sessionID: string
        messageID: string
        turnID: string
      }
    }
  | {
      event: "text-delta"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        delta: string
      }
    }
  | {
      event: "tool-call"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        toolCall: ToolCallWire
      }
    }
  | {
      event: "tool-result"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        toolResult: ToolResultWire
      }
    }
  | {
      event: "finish"
      data: {
        sessionID: string
        messageID: string
        turnID: string
        finishReason: string
      }
    }
  | {
      event: "error"
      data: {
        sessionID: string
        messageID?: string
        turnID?: string
        error: string
      }
    }
  | {
      event: "done"
      data: {
        sessionID: string
      }
    }

export type StreamEventName = StreamEvent["event"]
