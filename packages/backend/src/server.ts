import { startHttpServer } from "@backend/http/server"

const server = await startHttpServer(process.argv.slice(2))

console.log(`SSE server listening on http://localhost:${server.port}`)
