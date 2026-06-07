// The shared transform/decision middleware every agent composes. Single source
// of truth — agents spread this in their assemble() and add only their delta.
// (Pure observation like trace is ambient at the runtime/events layer and is
// intentionally NOT part of this stack.)
import type { MiddlewareFactory } from "@harness/hooks/types"
import { budget, contextAssembly, doomLoop, repeatedFailure, structuredOutput } from "@harness/middleware"

export function baseMiddleware(): MiddlewareFactory[] {
  return [contextAssembly, structuredOutput, budget, doomLoop, repeatedFailure]
}
