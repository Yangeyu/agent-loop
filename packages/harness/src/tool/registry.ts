import type { AgentInfo, AnyToolDefinition, ToolDefinition } from "@harness/types"

export type ToolRegistry = {
  tools: Map<string, AnyToolDefinition>
  register(tool: AnyToolDefinition): void
  get(id: string): AnyToolDefinition
  getTyped<TArgs>(id: string): ToolDefinition<TArgs>
  toolsForAgent(agent: AgentInfo): Promise<AnyToolDefinition[]>
}

export function createToolRegistry(): ToolRegistry {
  return {
    tools: new Map<string, AnyToolDefinition>(),

    register(tool) {
      const existing = this.tools.get(tool.id)
      if (existing === tool) return
      if (existing) {
        throw new Error(`Duplicate tool registration: ${tool.id}`)
      }
      this.tools.set(tool.id, tool)
    },

    get(id) {
      const tool = this.tools.get(id)
      if (!tool) throw new Error(`Unknown tool: ${id}`)
      return tool
    },

    getTyped<TArgs>(id: string): ToolDefinition<TArgs> {
      return this.get(id) as ToolDefinition<TArgs>
    },

    async toolsForAgent(agent) {
      const enabled = Object.entries(agent.tools || {})
        .filter(([, value]) => value !== false)
        .map(([name]) => name)

      return enabled.map((name) => this.get(name))
    },
  }
}
