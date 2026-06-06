import { ChainOfThought } from "./ChainOfThought"
import type { ArtifactFile, AssistantBubble, AssistantContentBlock, AssistantTurn } from "../types"

export function AssistantMessage({
  bubble,
  isStreaming,
  onShowDetail,
  onShowArtifact,
}: {
  bubble: AssistantBubble
  isStreaming: boolean
  onShowDetail: (content: string) => void
  onShowArtifact: (file: ArtifactFile) => void
}) {
  const turnsById = new Map(bubble.turns.map((turn) => [turn.turnID, turn]))
  const primaryAgent = bubble.turns[0]?.agent ?? bubble.agent
  const visibleBlocks = bubble.blocks.filter((block) => hasVisibleBlockContent(block, turnsById, isStreaming))
  const lastTurnID = bubble.turns.at(-1)?.turnID
  const lastBlockID = visibleBlocks.at(-1)?.id

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#171717] text-white shadow-sm">
            <span className="text-[10px] font-black tracking-[0.18em]">AI</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.28em] text-[#D4AF37]">
                {primaryAgent}
              </span>
            </div>
          </div>
        </div>
        {isStreaming && (
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
            Streaming
          </div>
        )}
      </div>

      {visibleBlocks.length > 0 ? (
        <div className="ml-4 space-y-6">
          {visibleBlocks.map((block) => {
            if (block.kind === "cot") {
              const turns = block.turnIDs
                .map((turnID) => turnsById.get(turnID))
                .filter((turn): turn is AssistantTurn => Boolean(turn))

              if (turns.length === 0) return null

              return (
                <MessageBlock
                  key={block.id}
                  block={block}
                  turns={turns}
                  title={bubble.taskTitles[block.sessionID]}
                  isStreaming={isStreaming && lastTurnID === turns.at(-1)?.turnID && lastBlockID === block.id}
                  onShowDetail={onShowDetail}
                  onShowArtifact={onShowArtifact}
                />
              )
            }

            const turn = turnsById.get(block.turnID)
            if (!turn) return null

            return (
              <MessageBlock
                key={block.id}
                block={block}
                turns={[turn]}
                title={undefined}
                isStreaming={isStreaming && lastTurnID === turn.turnID && lastBlockID === block.id}
                onShowDetail={onShowDetail}
                onShowArtifact={onShowArtifact}
              />
            )
          })}
        </div>
      ) : (
        <div className="ml-4 text-[14px] text-zinc-500">
          Waiting for assistant output...
        </div>
      )}

      {bubble.errored && !bubble.turns.some((turn) => turn.errored === bubble.errored) && (
        <div className="ml-4 rounded-xl border border-red-100 bg-red-50/40 px-4 py-3 text-[13px] font-medium text-red-600">
          {bubble.errored}
        </div>
      )}
    </div>
  )
}

function MessageBlock({
  block,
  turns,
  title,
  isStreaming,
  onShowDetail,
  onShowArtifact,
}: {
  block: AssistantContentBlock
  turns: AssistantTurn[]
  title?: string
  isStreaming: boolean
  onShowDetail: (content: string) => void
  onShowArtifact: (file: ArtifactFile) => void
}) {
  const isCot = block.kind === "cot"

  if (isCot) {
    return (
      <ChainOfThought
        turns={turns}
        title={title}
        isStreaming={isStreaming}
        onShowDetail={onShowDetail}
        onShowArtifact={onShowArtifact}
      />
    )
  }

  const turn = turns[0]
  if (!turn) return null

  return (
    <section className="border-t border-zinc-100 pt-4">
      <BlockHeader kind="answer" turn={turn} />
      <div className="mt-4 whitespace-pre-wrap text-[16px] leading-8 text-zinc-800">
        {turn.text || (isStreaming ? "Composing answer..." : "")}
      </div>
    </section>
  )
}

function BlockHeader({
  kind,
  turn,
}: {
  kind: "cot" | "answer"
  turn: AssistantTurn
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
          kind === "cot"
            ? "text-zinc-300"
            : "text-[#171717]"
        }`}
      >
        {kind === "cot" ? "CoT" : "Build Answer"}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
        {turn.agent}
      </span>
    </div>
  )
}

function hasVisibleBlockContent(
  block: AssistantContentBlock,
  turnsById: Map<string, AssistantTurn>,
  isStreaming: boolean,
) {
  if (block.kind === "cot") {
    const turns = block.turnIDs
      .map((turnID) => turnsById.get(turnID))
      .filter((turn): turn is AssistantTurn => Boolean(turn))

    return Boolean(turns.length > 0 || isStreaming)
  }

  const turn = turnsById.get(block.turnID)
  if (!turn) return false
  return Boolean(turn.text || isStreaming)
}
