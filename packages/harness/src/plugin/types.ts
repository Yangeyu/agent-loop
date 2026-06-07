import type { AgentDefinition } from "@harness/agent/types"
import type { RuntimeContext, RuntimeDeps } from "@harness/runtime/context"
import type { SkillInfo } from "@harness/skill/types"
import type { AnyToolDefinition } from "@harness/types"

export type PluginSetupContext = RuntimeDeps

export type RuntimePlugin = {
  name: string
  agents?: AgentDefinition[]
  tools?: AnyToolDefinition[]
  skills?: SkillInfo[]
  setup?: (ctx: PluginSetupContext) => void | Promise<void>
  dispose?: (runtime: RuntimeContext) => void | Promise<void>
}
