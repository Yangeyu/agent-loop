import { describe, expect, it } from "bun:test"
import { applyFileSuggestion, getFileSuggestions, resolveActiveMention } from "@tui/mention-files"

describe("resolveActiveMention", () => {
  it("detects an active @token at the cursor", () => {
    expect(resolveActiveMention("read @pack", "read @pack".length)).toEqual({
      start: 5,
      end: 10,
      query: "pack",
    })
  })

  it("returns undefined when cursor is not on an @token", () => {
    expect(resolveActiveMention("read packages/tui", "read".length)).toBeUndefined()
  })
})

describe("getFileSuggestions", () => {
  const files = [
    "packages/tui/src/app.tsx",
    "packages/tui/src/components/composer.tsx",
    "packages/harness/src/tool/view-image.ts",
    "README.md",
    "assets/screenshot.png",
  ]

  it("prefers basename and direct substring matches", () => {
    const suggestions = getFileSuggestions(files, "composer", 3)
    expect(suggestions.map((item) => item.path)).toEqual([
      "packages/tui/src/components/composer.tsx",
    ])
  })

  it("returns all-file suggestions for an empty query", () => {
    const suggestions = getFileSuggestions(files, "", 3)
    expect(suggestions).toHaveLength(3)
    expect(suggestions[0].path).toBe("README.md")
  })

  it("matches fuzzy path queries and prefers image files when scores tie", () => {
    const suggestions = getFileSuggestions(files, "ss", 3)
    expect(suggestions[0].path).toBe("assets/screenshot.png")
  })
})

describe("applyFileSuggestion", () => {
  it("replaces the active mention token and advances the cursor", () => {
    const result = applyFileSuggestion("open @comp", "open @comp".length, {
      path: "packages/tui/src/components/composer.tsx",
      score: 0,
      image: false,
    })

    expect(result.text).toBe("open @packages/tui/src/components/composer.tsx ")
    expect(result.cursorOffset).toBe(result.text.length)
  })

  it("quotes inserted paths that contain spaces", () => {
    const result = applyFileSuggestion("look @asset", "look @asset".length, {
      path: "assets/my shot.png",
      score: 0,
      image: true,
    })

    expect(result.text).toBe('look @"assets/my shot.png" ')
  })
})
