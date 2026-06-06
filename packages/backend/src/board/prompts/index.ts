import { resolve } from "node:path"
import { loadText } from "@harness/lib/load-text"

const here = (file: string) => resolve(import.meta.dir, file)

export const BOARD_ANALYSIS_PREPARE_PROMPT = loadText(here("board-analysis-prepare.md"))
export const BOARD_BUNDLE_ANALYZE_PROMPT = loadText(here("board-bundle-analyze.md"))
export const BOARD_WRITE_PROMPT = loadText(here("board-write.md"))
