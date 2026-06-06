import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BOARD_ANALYSIS_STORE_DIR } from "@backend/board/shared/store"

export function writeBoardReport(input: {
  analysisId: string
  title: string
  content: string
}) {
  mkdirSync(BOARD_ANALYSIS_STORE_DIR, { recursive: true })

  const safeAnalysisId = sanitizePathSegment(input.analysisId)
  const safeTitle = sanitizePathSegment(input.title)
  const timestamp = createTimestamp()
  const filename = `${safeAnalysisId}-${safeTitle}-${timestamp}.md`
  const filePath = join(BOARD_ANALYSIS_STORE_DIR, filename)

  writeFileSync(filePath, input.content, "utf8")

  return {
    path: filePath,
    filename,
    bytes: Buffer.byteLength(input.content, "utf8"),
  }
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function sanitizePathSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")

  return normalized || "report"
}
