import { describe, expect, it } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  createCoreAgents,
  createCoreTools,
  createDashScopeModel,
  createTestRuntime,
  loadSkillsFromDir,
  runPrompt,
} from "@harness"
import type { ToolPart } from "@harness/types"

// End-to-end against the real configured model (DashScope). Skipped when no API
// key is present so the default suite never depends on the network.
const live = it.skipIf(!process.env.DASHSCOPE_API_KEY)

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
const SKILLS_DIR = join(REPO_ROOT, "skills")
const OUTPUT_DIR = join(REPO_ROOT, "output")
const SOURCE_REPORT = join(import.meta.dir, "fixtures", "怡思丁种草打法综合洞察报告.md")

describe("editorial-data-story render (e2e)", () => {
  live(
    "renders a source markdown report into one complete self-contained HTML page",
    async () => {
      const outputPath = join(OUTPUT_DIR, "editorial-data-story.html")
      rmSync(outputPath, { force: true })

      // The real lead agent with the real core tools: this exercises the whole
      // delivery chain — skill discovery, asset paths, segmented writes, and the
      // step/tool budgets that have to be large enough to reach the closing tag.
      const chat = createDashScopeModel({ modelID: "qwen3.7-plus" })
      const summarizer = createDashScopeModel({ modelID: "qwen3.6-flash" })
      const runtime = createTestRuntime({
        agents: createCoreAgents({ model: chat, summarizer }),
        tools: createCoreTools({ visionModel: chat }),
        skills: loadSkillsFromDir(SKILLS_DIR),
      })

      const session = await runPrompt({
        runtime,
        agent: "lead",
        text: [
          "用 editorial-data-story 技能，把下面这份报告渲染成 HTML 报告：",
          SOURCE_REPORT,
          `输出到 ${outputPath}`,
        ].join("\n"),
      })

      const html = readFileSync(outputPath, "utf8")

      // The failure this guards is a truncated render: the earlier budget bug cut
      // the document off mid-body, which only a closing-tag + section-count check
      // catches — the file existed and looked plausible at 60% of its size.
      expect(html.trimStart().slice(0, 15).toLowerCase()).toStartWith("<!doctype html")
      expect(html.trimEnd()).toEndWith("</html>")
      expect(html).toInclude("</body>")
      expect(html.match(/<section/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
      expect(html.length).toBeGreaterThan(15_000)

      // Self-contained: no external stylesheet or script host beyond the fonts
      // the template already declares.
      expect(html).not.toInclude("<script src=\"http")

      const toolParts = session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => runtime.sessions.parts(session.id, message.id))
        .filter((part): part is ToolPart => part.type === "tool")

      const usedTools = new Set(toolParts.map((part) => part.toolName))
      expect(usedTools).toContain("skill")
      expect(usedTools).toContain("read")
      expect(usedTools).toContain("write")
      expect(usedTools).toContain("present_files")

      // Segmented, not one giant generation step — the skill mandates it and the
      // per-turn timeout enforces it in practice.
      const writes = toolParts.filter((part) => part.toolName === "write")
      expect(writes.length).toBeGreaterThanOrEqual(4)

      const failed = toolParts.filter((part) => part.state.status === "error")
      expect(failed.map((part) => part.toolName)).toEqual([])
    },
    900_000,
  )
})
