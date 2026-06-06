// Public API barrel for the backend surface (thin HTTP/SSE transport over the harness).
export { startHttpServer } from "@backend/http/server"
export {
  createAppRuntime,
  createAppTestRuntime,
  appPlugins,
} from "@backend/compose"
export { boardPlugin } from "@backend/board"
