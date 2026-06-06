// Public API barrel for the agent harness (engine).
// Surfaces (cli/tui/backend) compose the runtime here; deep subpath imports
// (e.g. "@agent-loop/harness/runtime/events") remain available via package exports.

export {
  createRuntime,
  createTestRuntime,
  disposeRuntime,
  runPrompt,
} from "@harness/runtime/bootstrap"
export { corePlugin, coreModule } from "@harness/module"
export { loadConfigFromEnv, getConfig, resetConfig } from "@harness/config"
export type { Config } from "@harness/config"

export type { RuntimePlugin } from "@harness/plugin/types"
export * from "@harness/types"
