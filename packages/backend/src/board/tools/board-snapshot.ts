import { loadBoardSnapshot } from "@backend/board/shared/snapshot"
import { defineTool } from "@harness"
import { z } from "zod"

export const BoardSnapshotParameters = z.object({
  boardId: z.string().trim().min(1),
})

export const BoardSnapshotTool = defineTool({
  id: "board_snapshot",
  description: "Load a normalized board snapshot from the Kiwoo PostgreSQL database.",
  parameters: BoardSnapshotParameters,
  beforeExecute({ args }) {
    return {
      title: `board_snapshot: ${args.boardId}`,
      metadata: {
        boardId: args.boardId,
      },
    }
  },
  async execute(args) {
    const snapshot = await loadBoardSnapshot(args.boardId)

    return {
      title: `Board snapshot: ${snapshot.board.title}`,
      output: JSON.stringify(snapshot, null, 2),
      metadata: {
        boardId: args.boardId,
        boardTitle: snapshot.board.title,
        ...snapshot.metadata,
      },
    }
  },
})
