/**
 * Public API of the orchestration layer: the standard agent set, the tools and
 * skills they run on, and the runtime that assembles them. A surface that
 * needs the loop's own contracts depends on @agent-core directly; this barrel
 * carries only what the orchestration layer adds.
 */

// Runtime composition + lifecycle
export {
  createRuntime,
  createCoreRuntime,
  createCoreTestRuntime,
  createTestRuntime,
  runPrompt,
} from "@harness/runtime/bootstrap"
export type { RuntimeAssembly } from "@harness/runtime/bootstrap"
export type { RuntimeContext } from "@harness/runtime/context"
export { runSession } from "@harness/session"
export type { RunSessionInput, SessionDeps } from "@harness/session"

// Config: the engine's knobs plus what the bricks need
export { loadConfigFromEnv, getConfig, COMPACTION_DEFAULTS, RETRY_DEFAULTS } from "@harness/config"
export type { Config } from "@harness/config"

// Agents: the standard set, and the registry that resolves them by name
export { createCoreAgents, createGeneralAgent, createLeadAgent } from "@harness/agents"
export { baseMiddleware } from "@harness/agents/shared/base-middleware"
export { createAgentRegistry, createHarnessAgent } from "@harness/registry"
export type { AgentMode, AgentRegistry, HarnessAgent } from "@harness/registry"

// Middleware library. Middleware that also contributes a prompt fragment exports
// both halves (budget/stepGuidance, structuredOutput/…Prompt).
export {
  budget,
  createCompaction,
  createRetry,
  doomLoop,
  promptAssembly,
  stepGuidance,
  structuredOutput,
  structuredOutputPrompt,
  viewImage,
  type RetryOptions,
} from "@harness/middleware"
export type { CompactionOptions } from "@harness/middleware/compaction"

// Prompt composition: the shared slot vocabulary. Every fragment itself lives
// with its owner — see engineConventions (agents/shared), createAvailableSkills
// (tools/skill), createSubagentList (tools/task).
export { SLOT_ORDER } from "@harness/prompt"
export type { PromptContributor, PromptSlot, SystemSection } from "@harness/prompt"
export { engineConventions } from "@harness/agents/shared/base-prompt"
export { createAvailableSkills } from "@harness/tools/skill"
export { createSubagentList } from "@harness/tools/task"

// Tools
export { createCoreTools } from "@harness/tools"
export type { CoreToolDeps } from "@harness/tools"
export type { TaskArgs, TaskResumeArgs } from "@harness/tools/task"

// Skills: the data contract + the filesystem discovery brick (SKILL.md dirs)
export type { SkillInfo } from "@harness/skills/types"
export { createSkillRegistry } from "@harness/skills/registry"
export type { SkillRegistry } from "@harness/skills/registry"
export { loadSkillFile, loadSkillsFromDir } from "@harness/skills/load"

// The local file tree tools resolve paths against
export { createWorkspace } from "@harness/workspace"
export type { Workspace } from "@harness/workspace"
