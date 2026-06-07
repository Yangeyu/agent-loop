import { coreAgents } from "@harness/agent"
import { coreTools } from "@harness/tool/tools"
import type { RuntimePlugin } from "@harness/plugin/types"

export const corePlugin: RuntimePlugin = {
  name: "core",
  agents: coreAgents,
  tools: coreTools,
}

export const coreModule = corePlugin
