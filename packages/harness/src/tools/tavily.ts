import { defineTool } from "@agent-core"
import { z } from "zod"

const TAVILY_SEARCH_URL = "https://api.tavily.com/search"
const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS = 10

class TavilyMissingApiKeyError extends Error {
  constructor() {
    super("TAVILY_API_KEY is required to use the tavily tool")
    this.name = "TavilyMissingApiKeyError"
  }
}

const TavilyResultSchema = z.object({
  title: z.string().optional().default(""),
  url: z.string().optional().default(""),
  content: z.string().optional().default(""),
  score: z.number().optional(),
  raw_content: z.string().nullable().optional(),
}).passthrough()

const TavilyResponseSchema = z.object({
  query: z.string().optional(),
  answer: z.string().nullable().optional(),
  results: z.array(TavilyResultSchema).optional().default([]),
}).passthrough()

const TavilyParameters = z.object({
  query: z.string().trim().min(1)
    .describe("The web search query"),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).optional()
    .describe("Maximum number of search results to return. Defaults to 5."),
  searchDepth: z.enum(["basic", "advanced"]).optional()
    .describe("Search depth. Defaults to basic."),
  includeAnswer: z.boolean().optional()
    .describe("Whether to include Tavily's synthesized answer. Defaults to true."),
})


export type TavilySearchOutput = {
  query: string
  answer?: string
  totalResults: number
  results: Array<{
    title: string
    url: string
    content: string
    score?: number
  }>
}

export const TavilyTool = defineTool({
  id: "tavily",
  description:
    "Search the web with Tavily and return current information with result titles, URLs, snippets, and optional synthesized answer.",
  parameters: TavilyParameters,
  describe(args) {
    return { verb: "search", target: args.query }
  },
  beforeExecute({ args }) {
    return {
      metadata: {
        query: args.query,
        maxResults: args.maxResults ?? DEFAULT_MAX_RESULTS,
        searchDepth: args.searchDepth ?? "basic",
        includeAnswer: args.includeAnswer ?? true,
      },
    }
  },
  mapError({ toolID, error }) {
    if (error instanceof TavilyMissingApiKeyError) {
      return {
        message: `The ${toolID} tool failed: set TAVILY_API_KEY in the environment before using Tavily search`,
        retryable: false,
        code: "tavily_missing_api_key",
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      message: `The ${toolID} tool failed: ${message}`,
      retryable: true,
      code: "tavily_search_failed",
    }
  },
  async execute(args, ctx) {
    const apiKey = process.env.TAVILY_API_KEY?.trim()
    if (!apiKey) throw new TavilyMissingApiKeyError()

    const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS
    const output = normalizeTavilyResponse(
      await searchTavily({
        apiKey,
        query: args.query,
        maxResults,
        searchDepth: args.searchDepth ?? "basic",
        includeAnswer: args.includeAnswer ?? true,
        abort: ctx.abort,
      }),
      args.query,
    )

    return {
      display: { summary: `${output.results.length} results` },
      output: JSON.stringify(output, null, 2),
      metadata: {
        query: args.query,
        maxResults,
        searchDepth: args.searchDepth ?? "basic",
        includeAnswer: args.includeAnswer ?? true,
        resultCount: output.results.length,
      },
    }
  },
})

async function searchTavily(input: {
  apiKey: string
  query: string
  maxResults: number
  searchDepth: "basic" | "advanced"
  includeAnswer: boolean
  abort: AbortSignal
}) {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    signal: input.abort,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      max_results: input.maxResults,
      search_depth: input.searchDepth,
      include_answer: input.includeAnswer,
    }),
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Tavily returned HTTP ${response.status}: ${truncateErrorBody(body)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new Error("Tavily returned invalid JSON", { cause: error })
  }

  return TavilyResponseSchema.parse(parsed)
}

export function normalizeTavilyResponse(response: unknown, fallbackQuery: string): TavilySearchOutput {
  const parsed = TavilyResponseSchema.parse(response)
  const output: TavilySearchOutput = {
    query: parsed.query ?? fallbackQuery,
    totalResults: parsed.results.length,
    results: parsed.results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
    })),
  }

  if (parsed.answer) output.answer = parsed.answer
  return output
}

function truncateErrorBody(body: string) {
  const trimmed = body.trim()
  if (trimmed.length <= 500) return trimmed
  return `${trimmed.slice(0, 500)}...`
}
