import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export type PromptHistoryEntry = {
  input: string
}

const MAX_HISTORY_ENTRIES = 50
const historyPath = path.join(process.cwd(), "data", "tui", "prompt-history.jsonl")

export async function loadPromptHistory() {
  const text = await readFile(historyPath, "utf8").catch(() => "")
  const entries = text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((entry): entry is PromptHistoryEntry => isPromptHistoryEntry(entry))
    .slice(-MAX_HISTORY_ENTRIES)

  if (entries.length > 0) {
    await mkdir(path.dirname(historyPath), { recursive: true })
    await writeFile(historyPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
  }

  return entries
}

export async function appendPromptHistory(entry: PromptHistoryEntry, existing: PromptHistoryEntry[]) {
  const next = [...existing, entry].slice(-MAX_HISTORY_ENTRIES)
  await mkdir(path.dirname(historyPath), { recursive: true })

  if (next.length === existing.length + 1) {
    await appendFile(historyPath, JSON.stringify(entry) + "\n")
    return next
  }

  await writeFile(historyPath, next.map((item) => JSON.stringify(item)).join("\n") + "\n")
  return next
}

function isPromptHistoryEntry(value: unknown): value is PromptHistoryEntry {
  if (typeof value !== "object" || value === null) return false
  if (!("input" in value)) return false
  return typeof value.input === "string"
}
