import { describe, expect, it } from "bun:test"
import { displayWidth, fitText } from "@tui/theme"

describe("fitText", () => {
  it("leaves text that already fits untouched", () => {
    expect(fitText("write report.html", 40)).toBe("write report.html")
  })

  it("elides the middle so both ends stay readable", () => {
    const fitted = fitText("packages/harness/src/agent/loop.ts", 20)

    expect(displayWidth(fitted)).toBeLessThanOrEqual(20)
    expect(fitted).toStartWith("packages/")
    // The tail is what identifies the file; a tail-truncated path identifies
    // nothing, which is the whole reason this elides the middle.
    expect(fitted).toEndWith("loop.ts")
  })

  it("counts wide characters as two cells", () => {
    expect(displayWidth("怡思丁")).toBe(6)
    expect(displayWidth("abc")).toBe(3)

    const fitted = fitText("怡思丁种草打法综合洞察报告", 10)
    expect(displayWidth(fitted)).toBeLessThanOrEqual(10)
  })

  it("degrades to an ellipsis rather than overflowing at tiny widths", () => {
    expect(fitText("anything", 1)).toBe("…")
    expect(fitText("anything", 0)).toBe("")
  })
})
