import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import type {
  BoardAnalysisAsset,
  BoardAnalysisBundleType,
  BoardAnalysisContext,
  BoardAnalysisDatasetSummary,
} from "@backend/board/types"
import { createID, type ISessionStore } from "@harness"

export const BOARD_ANALYSIS_STORE_DIR = resolve(process.cwd(), "data", "board-analysis-store")

type StoredBoardAnalysisDataset = {
  id: string
  context: BoardAnalysisContext
  assets: BoardAnalysisAsset[]
  sessionId: string
  createdAt: string
}

const datasetCache = new Map<string, StoredBoardAnalysisDataset>()

export function createBoardAnalysisDataset(input: {
  store: ISessionStore
  sessionId: string
  context: BoardAnalysisContext
}) {
  const dataset: StoredBoardAnalysisDataset = {
    id: createID(),
    context: input.context,
    assets: [],
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
  }

  saveBoardAnalysisDataset(dataset)
  return dataset
}

export function getBoardAnalysisDataset(input: {
  store: ISessionStore
  analysisId: string
}) {
  const dataset = loadBoardAnalysisDataset(input.analysisId)
  if (!dataset) {
    throw new Error(`Board analysis dataset not found: ${input.analysisId}`)
  }
  return dataset
}

export function summarizeBoardAnalysisDataset(dataset: StoredBoardAnalysisDataset): BoardAnalysisDatasetSummary {
  return {
    analysisId: dataset.id,
    analysisScope: dataset.context.analysisScope,
    overview: dataset.context.overview,
    boardAggregates: dataset.context.boardAggregates,
    boardCleaningLogs: dataset.context.boardCleaningLogs,
    assets: {
      count: dataset.assets.length,
      items: dataset.assets.map((asset) => ({
        name: asset.name,
        focus: asset.focus,
        sourceBundleTypes: asset.sourceBundleTypes,
        updatedAt: asset.updatedAt,
      })),
    },
    bundles: [
      describeBundle(dataset.context, "section_bundle", "Section-grouped nodes and section structure evidence"),
      describeBundle(dataset.context, "text_bundle", "Notes and ai_note content for claim and contradiction analysis"),
      describeBundle(dataset.context, "report_bundle", "Report-like materials and prior synthesized content"),
      describeBundle(dataset.context, "web_bundle", "Linked source items and external evidence references"),
      describeBundle(dataset.context, "chart_bundle", "Chart items and quantitative signals"),
    ],
  }
}

export function readBoardAnalysisBundle(input: {
  store: ISessionStore
  analysisId: string
  bundleType: BoardAnalysisBundleType
}) {
  const dataset = getBoardAnalysisDataset({
    store: input.store,
    analysisId: input.analysisId,
  })

  return {
    analysisId: dataset.id,
    bundleType: input.bundleType,
    itemCount: dataset.context.researchBundles[input.bundleType].length,
    bundle: dataset.context.researchBundles[input.bundleType],
  }
}

export function upsertBoardAnalysisAsset(input: {
  store: ISessionStore
  analysisId: string
  name: string
  content: string
  focus?: string
  sourceBundleTypes: BoardAnalysisBundleType[]
}) {
  const dataset = getBoardAnalysisDataset({
    store: input.store,
    analysisId: input.analysisId,
  })
  const now = new Date().toISOString()
  const existing = dataset.assets.find((asset) => asset.name === input.name)

  if (existing) {
    existing.content = input.content
    existing.focus = input.focus
    existing.sourceBundleTypes = input.sourceBundleTypes
    existing.updatedAt = now
    saveBoardAnalysisDataset(dataset)
    return existing
  }

  const asset: BoardAnalysisAsset = {
    name: input.name,
    content: input.content,
    focus: input.focus,
    sourceBundleTypes: input.sourceBundleTypes,
    createdAt: now,
    updatedAt: now,
  }

  dataset.assets.push(asset)
  saveBoardAnalysisDataset(dataset)
  return asset
}

export function getBoardAnalysisDatasetJsonPath(analysisId: string) {
  return relative(process.cwd(), boardAnalysisDatasetFilePath(analysisId))
}

export function readBoardAnalysisAssets(input: {
  store: ISessionStore
  analysisId: string
  names?: string[]
}) {
  const dataset = getBoardAnalysisDataset({
    store: input.store,
    analysisId: input.analysisId,
  })
  const wanted = input.names ? new Set(input.names) : undefined
  const assets = wanted
    ? dataset.assets.filter((asset) => wanted.has(asset.name))
    : dataset.assets

  return {
    analysisId: dataset.id,
    summary: summarizeBoardAnalysisDataset(dataset),
    assets,
  }
}

function describeBundle(
  context: BoardAnalysisContext,
  type: BoardAnalysisBundleType,
  description: string,
) {
  return {
    type,
    itemCount: context.researchBundles[type].length,
    description,
  }
}

function sanitizePathSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")

  return normalized || "asset"
}

function loadBoardAnalysisDataset(analysisId: string) {
  const cached = datasetCache.get(analysisId)
  if (cached) return cached

  const filePath = boardAnalysisDatasetFilePath(analysisId)
  if (!existsSync(filePath)) return null

  try {
    const dataset = JSON.parse(readFileSync(filePath, "utf8")) as StoredBoardAnalysisDataset
    datasetCache.set(dataset.id, dataset)
    return dataset
  } catch {
    return null
  }
}

function saveBoardAnalysisDataset(dataset: StoredBoardAnalysisDataset) {
  mkdirSync(BOARD_ANALYSIS_STORE_DIR, { recursive: true })
  const filePath = boardAnalysisDatasetFilePath(dataset.id)
  writeFileSync(filePath, JSON.stringify(dataset, null, 2), "utf8")
  datasetCache.set(dataset.id, dataset)
}

function boardAnalysisDatasetFilePath(analysisId: string) {
  return join(BOARD_ANALYSIS_STORE_DIR, `${sanitizePathSegment(analysisId)}.json`)
}
