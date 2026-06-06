## When to use

Use this skill when the user asks for board analysis, board reporting, thesis-style writeups, or interpretation of one or more boards.

## Goal

- Let `build` orchestrate the board workflow directly.
- Keep board data loading, cleaning, and aggregation inside `board_analysis_prepare`.
- Keep bundle-level analysis isolated inside `board_bundle_analyze` subagents.
- Store reusable analysis assets in the board dataset.
- Use `board_write` to write the final report under the current project data directory.

## Workflow

1. Delegate to `board_analysis_prepare` with `task` so the board module creates the dataset and returns the stored summary.
2. Read the returned summary and bundle catalog. Select only the bundle types needed for the objective.
3. For each selected bundle, delegate to `board_bundle_analyze` with `task`. If multiple bundles are independent, use `batch` to launch the `task` calls in parallel.
4. After all required bundle tasks complete, delegate to `board_write` with `task`.
5. Return only the saved markdown file path from `board_write` as the user-facing answer.

## Context to pass

When delegating `board_analysis_prepare`, include:

- `boardIds`
- the user objective
- any board scope filters such as `userId`, `publicOnly`, or `limit`

When delegating `board_bundle_analyze`, include:

- `analysisId`
- `bundleType`
- the user objective
- the target asset name
- optional `focus`

When delegating `board_write`, include:

- `analysisId`
- the user objective
- any requested report style or extra constraints

## Bundle guide

- `section_bundle`: board structure, grouping, narrative organization, cross-section relationships
- `text_bundle`: note and ai_note claims, contradictions, repeated ideas, weak reasoning
- `report_bundle`: report/document materials and prior synthesized conclusions
- `web_bundle`: source quality, external support, citation coverage gaps
- `chart_bundle`: quantitative signals, trends, anomalies, metric support

## Important rules

- Do not call board-domain raw data tools from `build`; delegate board preparation to `board_analysis_prepare`.
- Do not analyze bundle bodies directly in `build`; use `board_bundle_analyze`.
- Do not stop after assets are stored if the user wants a final report.
- Keep intermediate asset bodies out of the main conversation whenever possible.
- Keep the final report body out of the main conversation; `board_write` should save it under the current project data directory and return only the file path.
- Use `board_snapshot` only inside board subagents when structure or board scope needs validation.
