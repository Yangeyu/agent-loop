---
name: editorial-data-story
description: "Render a source report (markdown/text) into a self-contained insight-report-v1 HTML page using the editorial-data-story visual skin."
---

## When to use

Use this skill when the user asks to turn a written report, analysis, or set of
notes into a polished HTML page in the "编辑感数据叙事 / editorial data story"
style — a high-contrast, editorially-voiced strategy insight report with rich
inline data visuals.

This skill owns the reusable `insight-report-v1` **contract** (information
architecture, evidence discipline, delivery). The sibling `template.html` +
`design.md` are one swappable **visual skin**; future skins ship the same pair
and reuse this contract unchanged.

## Assets

- `template.html` — the complete reference implementation of the skin: semantic
  regions, section navigation, responsive + print behavior, and example chart
  components built from pure HTML/CSS.
- `design.md` — the skin's visual direction (color adaptation, type hierarchy,
  decoration language, chart styling). It defines *style*, not an acceptance
  checklist.

Read both before rendering. The `Assets:` list printed below this skill's body
carries their absolute paths — pass those to `read` verbatim; the `read` tool
resolves relative paths against the process working directory, not this skill's
directory.

## Workflow

Run these steps directly in the current agent. This is a linear, single-context
render — do not delegate the whole job to a subagent (there is no parallelism to
gain, and a shallow subagent will run out of steps before it reaches `write`).

1. **Read the source.** `read` the user's source report (the markdown/text they
   pointed at). Extract its judgments, the evidence behind them, and every metric
   with its unit, time window, and source.
2. **Read the skin.** `read` `template.html` and `design.md` at the absolute
   paths listed under `Assets:`.
3. **Map, do not pad.** Fit the source's real structure onto the template's
   semantic regions (cover judgment, section nav, data charts, content cards,
   sources). Section count and chart count come from the material — never emit
   empty sections to mimic the reference layout.
4. **Adapt the palette.** Treat any target brand color as an anchor, not a fixed
   HSL formula. Build a readable primary ramp, a distinguishable contrast color
   for competitors/second series, a restrained highlight for key numbers, and
   neutrals for body/borders. Prioritize contrast of body text, data labels, and
   legends. Do not copy the example color values from `template.html`.
5. **Render charts as pure HTML/CSS.** Write key values directly next to the mark;
   keep unit, time window, and source inside the same chart card. Decoration must
   never occlude ticks, labels, or sources, or create false area/length
   comparisons.
6. **Write the output in small bounded segments.** This is mandatory, not a
   preference. NEVER emit the whole document — or the entire stylesheet — in a
   single `write` call: one oversized generation step will hit the per-step
   timeout and lose everything. Keep every single `write` call small (roughly one
   screenful of markup). Build the file across many calls:
   - Call 1 — `write` (mode `overwrite`): only `<!doctype html>`, the opening
     `<head>` and font links, and the opening `<style>` tag.
   - Next call(s) — `write` (mode `append`): the CSS, split into two or three
     appends if it is long; then close `</style></head>` and open `<body>`.
   - Then one `write` (mode `append`) per section (cover/nav, then each content
     section). One section per call — do not batch several large sections.
   - Final call — `write` (mode `append`): `</body></html>` plus any trailing
     script.
   After each call, the tool reports the growing total size — use that to keep
   going until the document is complete. Default the output path to the source
   file's directory with an `.html` extension (e.g. `report.md` → `report.html`)
   unless the user names a path. Inline all styles; declare no new external
   dependencies beyond what the template already uses.
7. **Deliver.** Call `present_files` with the written HTML path so the client
   shows it as an artifact card. Return the saved path as the user-facing answer.

A typical render spends one `skill`, three `read`s, ~4–8 segmented `write`s and
one `present_files` — comfortably inside the lead agent's budget. Spend the calls
on more, smaller segments rather than fewer, larger ones: a segment that times
out costs the whole render, while an extra append costs one call.

## Evidence discipline

- Every headline number must carry its unit, time window, and source in the same
  card; if the source lacks one, say so rather than inventing it.
- Do not fabricate data points, trends, or comparisons that the source does not
  support. Fail loud (state the gap) over silently filling a nicer-looking chart.
- Preserve the source's own judgments; this skill re-presents them, it does not
  re-argue them.

## Stable vs variable boundary

Keep `insight-report-v1`'s semantic regions, section-navigation relationships,
and responsive + print capability from `template.html`. Freely adjust color,
type pairings, radii, lines, shadows, decoration, and chart appearance to fit the
brand and content. When a different skin is provided, replace `template.html` +
`design.md` and keep this workflow.
