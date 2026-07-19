// Public API barrel for the backend surface (thin HTTP/SSE transport over the harness).
export { startHttpServer } from "@backend/http/server"
export { createAppRuntime, createAppTestRuntime } from "@backend/compose"
export { boardSkills, boardTools, createBoardAgents } from "@backend/board"
