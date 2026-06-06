import { useState } from "react"
import type { ArtifactFile, AssistantTurn, ToolAttachment, ToolCallState } from "../types"

export function ChainOfThought({
  turns,
  title,
  isStreaming,
  onShowDetail,
  onShowArtifact,
}: {
  turns: AssistantTurn[]
  title?: string
  isStreaming: boolean
  onShowDetail: (content: string) => void
  onShowArtifact: (file: ArtifactFile) => void
}) {
  const agent = turns[0]?.agent ?? "agent"
  const resolvedTitle = title?.trim() || agent
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <section className="relative pl-8">
      <div className="absolute left-[3px] top-2 bottom-0 w-px bg-zinc-100" />
      <BlockHeader
        title={resolvedTitle}
        agent={agent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((current) => !current)}
      />

      {isExpanded && (
        <div className="mt-4 space-y-5">
          {turns.map((turn) => (
            <TurnTrace
              key={turn.turnID}
              turn={turn}
              isStreaming={isStreaming && turn.turnID === turns.at(-1)?.turnID}
              onShowDetail={onShowDetail}
              onShowArtifact={onShowArtifact}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function BlockHeader(input: {
  title: string
  agent: string
  isExpanded: boolean
  onToggle: () => void
}) {
  const { title, agent, isExpanded, onToggle } = input

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
          CoT
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {title}
        </span>
        {title !== agent && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            {agent}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:text-zinc-700"
      >
        {isExpanded ? "Collapse" : "Expand"}
      </button>
    </div>
  )
}

function TurnTrace({
  turn,
  isStreaming,
  onShowDetail,
  onShowArtifact,
}: {
  turn: AssistantTurn
  isStreaming: boolean
  onShowDetail: (content: string) => void
  onShowArtifact: (file: ArtifactFile) => void
}) {
  const artifactToolCalls = turn.toolCalls.filter(isFileArtifact)
  const actionToolCalls = turn.toolCalls.filter((toolCall) => !isFileArtifact(toolCall))

  return (
    <div className="relative">
      <div
        className={`absolute left-[-29px] top-[0.35rem] h-2 w-2 rounded-full border-2 ${
          isStreaming ? "border-[#D4AF37] bg-[#D4AF37]" : "border-zinc-200 bg-white"
        }`}
      />

      <div className="space-y-4">
        {turn.reasoning ? (
          <button
            type="button"
            onClick={() => onShowDetail(turn.reasoning)}
            className="block w-full text-left transition-colors hover:text-zinc-900"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300">Reasoning</span>
            </div>
            <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[14px] leading-7 text-zinc-500">
              {turn.reasoning}
            </p>
          </button>
        ) : isStreaming ? (
          <ThinkingPlaceholder />
        ) : null}

        {actionToolCalls.length > 0 && (
          <div className="space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300">Tool Trace</span>
            <div className="space-y-3">
              {actionToolCalls.map((toolCall) => (
                <ToolCallCard key={toolCall.toolCallId} toolCall={toolCall} />
              ))}
            </div>
          </div>
        )}

        {artifactToolCalls.length > 0 && (
          <div className="space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Artifacts</span>
            <div className="space-y-3">
              {artifactToolCalls.flatMap((toolCall) =>
                (toolCall.attachments ?? []).map((attachment, index) => {
                  const file = readArtifactFile(attachment, index)
                  return (
                    <button
                      key={`${toolCall.toolCallId}-${file.path}`}
                      type="button"
                      onClick={() => onShowArtifact(file)}
                      className="block w-full rounded-[20px] border border-[#D4AF37]/15 bg-[#FFFCF3]/70 px-5 py-4 text-left transition-colors hover:border-[#D4AF37]/30 hover:bg-[#FFF8E1]/80"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#D4AF37]">
                            Artifact
                          </div>
                          <div className="mt-3 break-all text-[15px] font-semibold text-zinc-900">
                            {file.filename}
                          </div>
                          <div className="mt-2 break-all text-[12px] leading-relaxed text-zinc-500">
                            {file.path}
                          </div>
                        </div>
                        <div className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                          View
                        </div>
                      </div>
                    </button>
                  )
                }),
              )}
            </div>
          </div>
        )}

        {turn.errored && (
          <div className="rounded-xl border border-red-100 bg-red-50/40 px-4 py-3 text-[13px] font-medium text-red-600">
            {turn.errored}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallState }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-zinc-50/30 p-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50/50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-100 bg-white shadow-sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-zinc-400">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-zinc-700">{toolCall.title || toolCall.toolName}</span>
        </div>
        {toolCall.output && (
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-green-600">
            Success
          </span>
        )}
        {toolCall.error && (
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-600">
            Error
          </span>
        )}
      </div>

      {Boolean(toolCall.output || toolCall.error || toolCall.args) && (
        <div className="mt-3 overflow-hidden border-t border-zinc-100 pt-3">
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-zinc-500">
            {toolCall.error?.message
              || toolCall.output
              || (typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args, null, 2))}
          </pre>
        </div>
      )}
    </div>
  )
}

function ThinkingPlaceholder() {
  return (
    <div className="flex items-center gap-3 text-[13px] text-zinc-500">
      <span className="h-2 w-2 rounded-full bg-[#D4AF37] animate-pulse" />
      Collecting reasoning and tool activity...
    </div>
  )
}

function isFileArtifact(toolCall: ToolCallState) {
  return toolCall.metadata?.artifactType === "files" && Array.isArray(toolCall.attachments) && toolCall.attachments.length > 0
}

function readArtifactFile(attachment: ToolAttachment, index: number): ArtifactFile {
  return {
    path: attachment.path ?? attachment.filename ?? `file-${index + 1}`,
    filename: attachment.filename ?? `file-${index + 1}`,
    mime: attachment.mime,
    bytes: attachment.bytes ?? 0,
  }
}
