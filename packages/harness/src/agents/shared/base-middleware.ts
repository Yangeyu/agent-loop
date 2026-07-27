// The middleware baseline every agent composes, plus the prompt contributors that
// are true for every agent. Agents spread this into their blueprint and add only
// their delta.
//
// Note what the two arguments mean, because they are different axes. The returned
// middleware list is ordered by *execution* priority (gates run in order, folds
// fold in order). The `prompt` argument is ordered by nothing — a contributor's
// slot decides where it renders, so appending one here appends to the agent's
// capabilities, not to the end of its system prompt.
//
// Only universally-true fragments are baked in: every agent runs under a step
// budget, every turn may be asked for JSON, every agent follows the engine's
// conventions. A fragment that describes a *tool* travels with that tool, so the
// agent enabling the tool passes it in (see createLeadAgent).
//
// (Pure observation like trace is ambient at the runtime/events layer and is
// intentionally NOT part of this stack.)
import { engineConventions } from "@harness/agents/shared/base-prompt"
import type { MiddlewareFactory } from "@agent-core"
import {
  budget,
  createRetry,
  doomLoop,
  promptAssembly,
  stepGuidance,
  structuredOutput,
  structuredOutputPrompt,
  type RetryOptions,
} from "@harness/middleware"
import type { PromptContributor } from "@harness/prompt"

/**
 * Builds an agent's base middleware stack.
 *
 * @param prompt - contributors this agent adds, typically one per tool it enables
 * @param retry - model-call retry bounds; defaults match the config's
 */
export function baseMiddleware(
  prompt: readonly PromptContributor[] = [],
  retry?: RetryOptions,
): MiddlewareFactory[] {
  return [
    // Outermost, so every other middleware sees one settled model call rather
    // than each failed attempt.
    createRetry(retry),
    promptAssembly([engineConventions, structuredOutputPrompt, stepGuidance, ...prompt]),
    structuredOutput,
    budget,
    doomLoop,
  ]
}
