import { createAppRuntime } from "@backend/compose"
import { handleChatRequest } from "@backend/http/chat"
import { handleFileContentRequest } from "@backend/http/files"
import { createOpenAPIDocument, renderScalarDocumentPage } from "@backend/http/openapi"
import { corsHeaders, htmlResponse, jsonResponse } from "@backend/http/responses"

function parsePortArg(argv: string[]) {
  const args = [...argv]

  while (args.length > 0) {
    const token = args.shift()
    if (token !== "--port") continue
    const value = Number(args.shift())
    if (Number.isInteger(value) && value > 0) return value
    throw new Error("Invalid --port value")
  }

  return undefined
}

function resolvePreferredPort(argv: string[]) {
  const argPort = parsePortArg(argv)
  if (argPort !== undefined) return argPort

  const envPort = Number(process.env.PORT)
  if (Number.isInteger(envPort) && envPort > 0) return envPort

  return 4444
}

function isAddrInUseError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE"
}

export async function startHttpServer(argv: string[] = process.argv.slice(2)) {
  const runtime = await createAppRuntime()

  const startServer = (port: number) => Bun.serve({
    port,
    idleTimeout: 60,
    async fetch(request) {
      const url = new URL(request.url)
      const baseUrl = url.origin

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        })
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true })
      }

      if (request.method === "GET" && url.pathname === "/openapi.json") {
        return jsonResponse(createOpenAPIDocument({ baseUrl }))
      }

      if (request.method === "GET" && url.pathname === "/docs") {
        return htmlResponse(renderScalarDocumentPage({
          openapiUrl: `${baseUrl}/openapi.json`,
        }))
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        return handleChatRequest(request, runtime)
      }

      if (request.method === "GET" && url.pathname === "/api/files/content") {
        return handleFileContentRequest(request)
      }

      return jsonResponse({ error: "Not found" }, { status: 404 })
    },
  })

  const preferredPort = resolvePreferredPort(argv)
  let lastError: unknown

  for (let offset = 0; offset < 10; offset += 1) {
    const port = preferredPort + offset

    try {
      return startServer(port)
    } catch (error) {
      lastError = error
      if (!isAddrInUseError(error)) throw error
    }
  }

  throw lastError instanceof Error
    ? new Error(`Failed to start SSE server. Ports ${preferredPort}-${preferredPort + 9} are unavailable.`)
    : new Error(`Failed to start SSE server near port ${preferredPort}.`)
}
