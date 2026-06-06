import { resolve } from "node:path"
import { loadText } from "@harness/lib/load-text"
import type { SkillInfo } from "@harness/skill/types"

export const boardSkills: SkillInfo[] = [
  {
    name: "board-analysis",
    description: "Workflow for board analysis: delegate dataset preparation, delegate per-bundle analysis, then delegate report writing.",
    location: "board://skills/board-analysis",
    content: loadText(resolve(import.meta.dir, "board-analysis.md")),
  },
]
