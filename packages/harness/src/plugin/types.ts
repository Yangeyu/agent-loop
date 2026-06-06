import type { RuntimeContext, RuntimeDeps } from "@harness/runtime/context"
import type { SkillInfo } from "@harness/skill/types"
import type { AgentInfo, AnyToolDefinition } from "@harness/types"

export type PluginSetupContext = RuntimeDeps

export type RuntimePlugin = {
  name: string
  agents?: AgentInfo[]
  tools?: AnyToolDefinition[]
  skills?: SkillInfo[]
  setup?: (ctx: PluginSetupContext) => void | Promise<void>
  dispose?: (runtime: RuntimeContext) => void | Promise<void>
}
