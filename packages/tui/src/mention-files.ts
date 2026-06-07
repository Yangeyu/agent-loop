import { readdir } from "node:fs/promises"
import path from "node:path"

export type FileSuggestion = {
  path: string
  score: number
  image: boolean
}

export type ActiveMention = {
  start: number
  end: number
  query: string
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
])

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"])

const workspaceFileCache = new Map<string, Promise<string[]>>()

export function resolveActiveMention(input: string, cursorOffset: number): ActiveMention | undefined {
  const cursor = Math.max(0, Math.min(cursorOffset, input.length))
  const before = input.slice(0, cursor)
  const lineStart = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t")) + 1
  const token = before.slice(lineStart)

  if (!token.startsWith("@")) return undefined
  if (token.length > 1 && /\s/.test(token.slice(1))) return undefined

  const after = input.slice(cursor)
  const stop = after.search(/[\s]/)
  const end = stop === -1 ? input.length : cursor + stop

  return {
    start: lineStart,
    end,
    query: normalizeMentionQuery(token.slice(1)),
  }
}

export function applyFileSuggestion(input: string, cursorOffset: number, suggestion: FileSuggestion): {
  text: string
  cursorOffset: number
} {
  const mention = resolveActiveMention(input, cursorOffset)
  if (!mention) return { text: input, cursorOffset }

  const token = formatMentionToken(suggestion.path)
  const prefix = input.slice(0, mention.start)
  const suffix = input.slice(mention.end)
  const needsTrailingSpace = suffix.length === 0 || (!/^\s/.test(suffix) && !suffix.startsWith("@"))
  const text = `${prefix}${token}${needsTrailingSpace ? " " : ""}${suffix}`
  const nextCursor = prefix.length + token.length + (needsTrailingSpace ? 1 : 0)
  return { text, cursorOffset: nextCursor }
}

export async function listWorkspaceFiles(rootDir: string): Promise<string[]> {
  const cached = workspaceFileCache.get(rootDir)
  if (cached) return cached

  const promise = walk(rootDir, rootDir)
  workspaceFileCache.set(rootDir, promise)
  return promise
}

export function getFileSuggestions(files: string[], query: string, limit = 8): FileSuggestion[] {
  const normalizedQuery = query.toLowerCase()

  return files
    .map((filePath) => {
      const score = scoreFilePath(filePath, normalizedQuery)
      return {
        path: filePath,
        score,
        image: IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
      }
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || Number(b.image) - Number(a.image) || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
}

function normalizeMentionQuery(query: string) {
  const trimmed = query.trimStart()
  if (trimmed.startsWith('"')) return trimmed.slice(1)
  if (trimmed.startsWith("'")) return trimmed.slice(1)
  return trimmed
}

function formatMentionToken(filePath: string) {
  return /\s/.test(filePath) ? `@"${filePath}"` : `@${filePath}`
}

async function walk(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".cursor") continue
    if (IGNORED_DIRS.has(entry.name)) continue

    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(rootDir, absolutePath))
      continue
    }

    if (!entry.isFile()) continue
    files.push(path.relative(rootDir, absolutePath))
  }

  return files
}

function scoreFilePath(filePath: string, query: string) {
  if (!query) return defaultFileScore(filePath)

  const target = filePath.toLowerCase()
  const base = path.basename(target)

  if (base === query) return 0
  if (base.startsWith(query)) return 10 + (base.length - query.length)

  const baseIndex = base.indexOf(query)
  if (baseIndex !== -1) return 30 + baseIndex

  if (target.startsWith(query)) return 60 + (target.length - query.length)

  const targetIndex = target.indexOf(query)
  if (targetIndex !== -1) return 90 + targetIndex

  const baseFuzzy = fuzzyScore(base, query)
  if (baseFuzzy !== undefined) return 140 + baseFuzzy

  const targetFuzzy = fuzzyScore(target, query)
  if (targetFuzzy !== undefined) return 220 + targetFuzzy

  return Number.POSITIVE_INFINITY
}

function defaultFileScore(filePath: string) {
  const segments = filePath.split(path.sep).length
  return segments * 20 + filePath.length
}

function fuzzyScore(target: string, query: string) {
  let queryIndex = 0
  let gaps = 0
  let lastMatch = -1

  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) continue
    if (lastMatch !== -1) gaps += index - lastMatch - 1
    lastMatch = index
    queryIndex += 1
  }

  if (queryIndex !== query.length) return undefined
  return gaps + (target.length - query.length)
}
