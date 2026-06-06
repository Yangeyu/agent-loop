// Composition root for the backend surface.
// The harness exposes createRuntime(plugins); the surface decides which plugins
// to compose. Here we combine the core engine with the board domain plugin.
import {
  createRuntime,
  createTestRuntime,
  corePlugin,
  type Config,
} from "@harness"
import { boardPlugin } from "@backend/board"

export const appPlugins = [corePlugin, boardPlugin]

export function createAppRuntime(options?: { config?: Config }) {
  return createRuntime({
    config: options?.config,
    plugins: appPlugins,
  })
}

export function createAppTestRuntime(options?: { config?: Partial<Config> }) {
  return createTestRuntime({
    config: options?.config,
    plugins: appPlugins,
  })
}
