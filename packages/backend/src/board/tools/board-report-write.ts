import { writeBoardReport } from "@backend/board/shared/report-store"
import { BoardReportWriteParameters } from "@backend/board/tools/types"
import { defineTool } from "@harness/tool/tool"

export const BoardReportWriteTool = defineTool({
  id: "board_report_write",
  description: "Write the final board report markdown under the current project data directory and return only the saved file reference.",
  parameters: BoardReportWriteParameters,
  beforeExecute({ args }) {
    return {
      title: `board_report_write: ${args.title}`,
      metadata: {
        analysisId: args.analysisId,
        title: args.title,
      },
    }
  },
  async execute(args) {
    const report = writeBoardReport({
      analysisId: args.analysisId,
      title: args.title,
      content: args.content,
    })

    return {
      title: `Saved board report: ${args.title}`,
      output: report.path,
      metadata: {
        analysisId: args.analysisId,
        title: args.title,
        reportPath: report.path,
        filename: report.filename,
        bytes: report.bytes,
      },
    }
  },
})
