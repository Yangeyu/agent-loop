/**
 * The workspace backed by the local filesystem. It owns the file tree, so
 * concurrent tool calls are safe without any scheduling on the caller's side:
 *
 * - `write` publishes via a same-directory rename, atomic on POSIX. A
 *   concurrent reader sees the whole old file or the whole new one, never a
 *   truncated middle.
 * - `mutate` is the only read-modify-write, and it is serialized per path, so
 *   two edits to one file cannot both read the original and lose an update.
 * - `readText` / `stat` / `listFiles` need no coordination, because the writes
 *   above leave no intermediate state to observe.
 *
 * Scope: this owns the workspace's *consistency*, not its boundary. Absolute
 * paths still resolve outside `root`; sandboxing would be a separate
 * implementation of the same contract.
 */
import fs from "node:fs/promises"
import path from "node:path"
import type { Workspace } from "@harness/workspace/types"

/**
 * Creates a workspace rooted at `root` (resolved against the process directory,
 * which is where `cwd` legitimately enters — once, at assembly).
 *
 * @param root - the directory relative paths resolve against; defaults to the process directory
 * @returns the workspace
 */
export function createWorkspace(root: string = "."): Workspace {
  const absoluteRoot = path.resolve(process.cwd(), root)

  // One promise chain per path under mutation. Entries are removed once their
  // chain drains, so a long-lived runtime does not accumulate one per file ever
  // touched.
  const chains = new Map<string, Promise<unknown>>()
  let tempCounter = 0

  function serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
    // Chained on settle, not on success: a failed mutation must not strand the
    // ones queued behind it.
    const previous = chains.get(key) ?? Promise.resolve()
    const task = previous.then(run, run)
    const gate = task.then(ignore, ignore)
    chains.set(key, gate)
    void gate.then(() => {
      if (chains.get(key) === gate) chains.delete(key)
    })
    return task
  }

  async function writeAtomic(target: string, text: string) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    // The temp file must share the target's directory: rename is only atomic
    // within a filesystem, and /tmp is often a different one.
    tempCounter += 1
    const temp = `${target}.${process.pid}.${tempCounter}.tmp`
    try {
      await fs.writeFile(temp, text, "utf8")
      await fs.rename(temp, target)
    } catch (error) {
      await fs.rm(temp, { force: true })
      throw error
    }
  }

  const workspace: Workspace = {
    root: absoluteRoot,

    resolve(input) {
      return path.resolve(absoluteRoot, input)
    },

    relative(target) {
      return path.relative(absoluteRoot, target)
    },

    async stat(target) {
      try {
        const stat = await fs.stat(target)
        return { bytes: stat.size, isFile: stat.isFile() }
      } catch (error) {
        if (isErrno(error, "ENOENT")) return undefined
        throw error
      }
    },

    async readText(target) {
      return await fs.readFile(target, "utf8")
    },

    async listFiles(directory, options) {
      const entries = await fs.readdir(directory, { recursive: options.recursive, withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath ?? directory, entry.name))
    },

    async write(target, content) {
      const existing = await workspace.stat(target)
      if (existing && !existing.isFile) {
        throw Object.assign(new Error(`${target} is not a file`), { code: "EISDIR" })
      }

      await writeAtomic(target, content)
      return { created: !existing, bytes: Buffer.byteLength(content, "utf8") }
    },

    async mutate(target, change) {
      return await serialize(target, async () => {
        const current = await fs.readFile(target, "utf8")
        const decision = await change(current)
        await writeAtomic(target, decision.text)
        return decision.result
      })
    },
  }

  return workspace
}

function isErrno(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

function ignore() {}
