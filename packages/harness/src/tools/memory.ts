/**
 * The explicit memory tools and the recall announcement, sharing one
 * MemoryStore through their factory closures — the set the index advertises
 * and the set the tools operate on are the same store read.
 *
 * This is the write path with full authority (`origin: "explicit"`): the
 * model decides in-loop, guided by the curation rules the recall fragment
 * states. The settle-time extraction path arrives later and ranks below it
 * (see memory/consolidate).
 */
import { defineTool, ToolExecutionError } from "@agent-core"
import type { PromptContributor } from "@harness/prompt"
import { MEMORY_NAME_PATTERN, MEMORY_TYPES, type MemoryRecord, type MemoryStore } from "@harness/memory/types"
import { z } from "zod"

/** What the memory tools and the recall announcement both read. */
export type MemoryDeps = { memory: MemoryStore }

/**
 * Prompt axis: announces the live index and the curation rules. Unlike the
 * skills announcement, this renders even when the store is empty — the habit
 * of saving durable facts has to be stated before any fact exists.
 */
export function createMemoryRecall(deps: MemoryDeps): PromptContributor {
  return () => {
    const entries = deps.memory.recall()
    return {
      slot: "capability",
      text: [
        "You have a persistent memory store that carries facts across sessions.",
        "Save a fact with memory_save when it will matter beyond this session: a user preference, a correction to how you should work, a project goal or constraint the code cannot show. Reuse an existing name to update that record instead of writing a near-duplicate; archive a record with memory_forget once it proves wrong or obsolete. Do not save what the repository already records.",
        "Memories reflect the time they were written — verify that a remembered file, interface, or flag still exists before relying on it.",
        entries.length === 0
          ? "The store is currently empty."
          : [
              "<memories>",
              ...entries.map((entry) => `- ${entry.name} [${entry.type}] ${entry.description}`),
              "</memories>",
              "Read a memory's full content with memory_read when it looks relevant to the task.",
            ].join("\n"),
      ].join("\n"),
    }
  }
}

const SaveParameters = z.object({
  name: z
    .string()
    .regex(MEMORY_NAME_PATTERN)
    .describe("Kebab-case identity of the fact. Reuse an existing name to update that record."),
  description: z.string().min(1).describe("One-line summary shown in the recall index."),
  type: z
    .enum(MEMORY_TYPES)
    .describe(
      "user: who the user is. feedback: guidance on how to work (include why and how to apply). project: ongoing goals or constraints. reference: external pointers.",
    ),
  body: z.string().min(1).describe("The fact itself, markdown."),
  links: z
    .array(z.string().regex(MEMORY_NAME_PATTERN))
    .optional()
    .describe("Names of related memories. A name that does not exist yet is allowed."),
  supersedes: z
    .array(z.string().regex(MEMORY_NAME_PATTERN))
    .optional()
    .describe("Live records this fact replaces; they are archived in the same step."),
})

/** Builds the memory_save tool bound to a memory store. */
export function createMemorySaveTool(deps: MemoryDeps) {
  return defineTool({
    id: "memory_save",
    description: "Save or update a persistent memory that carries across sessions.",
    parameters: SaveParameters,
    describe(args) {
      return { verb: "remember", target: args.name }
    },
    async execute(args, ctx) {
      for (const target of args.supersedes ?? []) {
        if (!deps.memory.read(target)) throw unknownRecord(deps.memory, target)
      }

      const existing = deps.memory.read(args.name)
      const record: MemoryRecord = {
        name: args.name,
        description: args.description,
        type: args.type,
        scope: "workspace",
        origin: "explicit",
        // The source chain accumulates; an explicit rewrite settles any
        // standing dispute, so `disputed` is deliberately not carried over.
        sources: appendSource(existing?.sources, ctx.sessionID),
        ...(args.links?.length ? { links: args.links } : {}),
        body: args.body,
      }
      deps.memory.upsert(record, { supersedes: args.supersedes })

      const supersedeNote = args.supersedes?.length ? `, superseding ${args.supersedes.join(", ")}` : ""
      return { output: `${existing ? "Updated" : "Saved"} memory "${args.name}"${supersedeNote}.` }
    },
  })
}

/** Builds the memory_read tool bound to a memory store. */
export function createMemoryReadTool(deps: MemoryDeps) {
  return defineTool({
    id: "memory_read",
    description: "Read the full content of a memory listed in the recall index.",
    parameters: z.object({
      name: z.string().regex(MEMORY_NAME_PATTERN).describe("The memory's name from the index"),
    }),
    describe(args) {
      return { verb: "recall", target: args.name }
    },
    async execute(args) {
      const record = deps.memory.read(args.name)
      if (!record) throw unknownRecord(deps.memory, args.name)

      return {
        output: [
          `# ${record.name} [${record.type}]`,
          record.description,
          ...(record.links?.length ? [`Related: ${record.links.join(", ")}`] : []),
          ...(record.disputed?.length ? [`Disputed by sessions: ${record.disputed.join(", ")} — treat with care.`] : []),
          "",
          record.body,
        ].join("\n"),
      }
    },
  })
}

/** Builds the memory_forget tool bound to a memory store. */
export function createMemoryForgetTool(deps: MemoryDeps) {
  return defineTool({
    id: "memory_forget",
    description: "Archive a memory that proved wrong, obsolete, or replaced. Archived memories leave the index but are not destroyed.",
    parameters: z.object({
      name: z.string().regex(MEMORY_NAME_PATTERN).describe("The memory's name from the index"),
      reason: z
        .enum(["falsified", "expired", "superseded"])
        .describe("falsified: the fact was wrong. expired: no longer true. superseded: replaced by another memory."),
    }),
    describe(args) {
      return { verb: "forget", target: args.name }
    },
    async execute(args) {
      if (!deps.memory.read(args.name)) throw unknownRecord(deps.memory, args.name)
      deps.memory.remove(args.name, args.reason)
      return { output: `Archived memory "${args.name}" (${args.reason}).` }
    },
  })
}

function appendSource(sources: string[] | undefined, sessionID: string): string[] {
  const chain = sources ?? []
  return chain.includes(sessionID) ? chain : [...chain, sessionID]
}

function unknownRecord(memory: MemoryStore, name: string): ToolExecutionError {
  const available = memory.recall().map((entry) => entry.name)
  return new ToolExecutionError({
    message: `No live memory record named "${name}". Live records: ${available.join(", ") || "none"}`,
    retryable: false,
    code: "memory_not_found",
  })
}
