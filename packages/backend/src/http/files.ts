import fs from "node:fs/promises"
import path from "node:path"
import { jsonResponse } from "@backend/http/responses"

function resolveWorkspacePath(filePath: string) {
  const workspaceRoot = process.cwd()
  const resolved = path.resolve(workspaceRoot, filePath)
  const relative = path.relative(workspaceRoot, resolved)

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path must stay within the workspace")
  }

  return resolved
}

export async function handleFileContentRequest(request: Request) {
  const url = new URL(request.url)
  const requestedPath = url.searchParams.get("path")?.trim()

  if (!requestedPath) {
    return jsonResponse({ error: "Missing file path" }, { status: 400 })
  }

  let resolvedPath: string

  try {
    resolvedPath = resolveWorkspacePath(requestedPath)
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 400 })
  }

  try {
    const stat = await fs.stat(resolvedPath)
    if (!stat.isFile()) {
      return jsonResponse({ error: "Path is not a file" }, { status: 400 })
    }

    const content = await fs.readFile(resolvedPath, "utf8")
    return jsonResponse({
      path: resolvedPath,
      filename: path.basename(resolvedPath),
      content,
    })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return jsonResponse({ error: "File not found" }, { status: 404 })
    }

    return jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
