import { resolve } from "node:path"
import { loadText, type SkillInfo } from "@harness"

export const boardSkills: SkillInfo[] = [
  {
    name: "board-analysis",
    description: "Workflow for board analysis: delegate dataset preparation, delegate per-bundle analysis, then delegate report writing.",
    location: "board://skills/board-analysis",
    content: loadText(resolve(import.meta.dir, "board-analysis.md")),
  },
]
