import { describe, expect, it } from "bun:test"
import { normalizeTavilyResponse } from "@harness/tools/tavily"

describe("tavily", () => {
  it("normalizes Tavily search responses", () => {
    expect(normalizeTavilyResponse({
      query: "agent loops",
      answer: "Agent loops run tools iteratively.",
      results: [
        {
          title: "Agent Loop",
          url: "https://example.com/agent-loop",
          content: "A page about agent loops.",
          score: 0.91,
          ignored: true,
        },
      ],
    }, "fallback")).toEqual({
      query: "agent loops",
      answer: "Agent loops run tools iteratively.",
      totalResults: 1,
      results: [
        {
          title: "Agent Loop",
          url: "https://example.com/agent-loop",
          content: "A page about agent loops.",
          score: 0.91,
        },
      ],
    })
  })
})
