import type {
  BoardAggregateSummary,
  BoardAnalysisContext,
  BoardCleaningLog,
  BoardResearchItem,
  BoardSectionAggregate,
  BoardSnapshot,
  CleanedBoardSnapshot,
} from "@backend/board/types"

const TEXT_TYPES = new Set(["note", "ai_note", "text", "report", "document", "web", "chart"])
const REPORT_TYPES = new Set(["report", "document"])
const WEB_TYPES = new Set(["web", "link", "bookmark", "website"])
const CHART_TYPES = new Set(["chart"])

export function buildBoardAnalysisContext(input: {
  boards: BoardSnapshot[]
  prompt?: string
  filters: {
    boardIds?: string[]
    userId?: string
    publicOnly?: boolean
    limit: number
  }
}): BoardAnalysisContext {
  const cleanedBoards = input.boards.map(cleanBoardSnapshot)
  const boardCleaningLogs = cleanedBoards.map((board) => board.log)
  const boards = cleanedBoards.map((board) => board.snapshot)
  const boardAggregates = boards.map(summarizeBoard)
  const sectionBundle = boards.flatMap(buildSectionBundle)
  const textBundle = boards.flatMap((board) => buildResearchBundle(board, "text_bundle"))
  const reportBundle = boards.flatMap((board) => buildResearchBundle(board, "report_bundle"))
  const webBundle = boards.flatMap((board) => buildResearchBundle(board, "web_bundle"))
  const chartBundle = boards.flatMap((board) => buildResearchBundle(board, "chart_bundle"))

  return {
    analysisScope: {
      input: input.prompt,
      filters: {
        limit: input.filters.limit,
        boardIds: input.filters.boardIds,
        userId: input.filters.userId,
        publicOnly: input.filters.publicOnly ?? false,
      },
      loadedBoardCount: boards.length,
    },
    boards,
    boardCleaningLogs,
    boardAggregates,
    overview: {
      boardCount: boards.length,
      sectionCount: boards.reduce((sum, board) => sum + board.articleCorpus.sectionCount, 0),
      typeCounts: boards.reduce<Record<string, number>>((counts, board) => {
        for (const [type, count] of Object.entries(board.metadata.itemTypeCounts)) {
          counts[type] = (counts[type] ?? 0) + count
        }
        return counts
      }, {}),
      analyzableTypes: ["section_bundle", "text_bundle", "report_bundle", "web_bundle", "chart_bundle"],
    },
    researchBundles: {
      section_bundle: sectionBundle,
      text_bundle: textBundle,
      report_bundle: reportBundle,
      web_bundle: webBundle,
      chart_bundle: chartBundle,
    },
  }
}

function cleanBoardSnapshot(snapshot: BoardSnapshot): {
  snapshot: CleanedBoardSnapshot
  log: BoardCleaningLog
} {
  const seen = new Set<string>()
  let removedMissingNodeId = 0
  let removedMissingNodeType = 0
  let removedEmptyTextNodes = 0
  let removedDuplicateNodeId = 0

  const items = snapshot.items.filter((item) => {
    if (!item || typeof item !== "object") return false
    if (!item.id) {
      removedMissingNodeId += 1
      return false
    }
    if (!item.type) {
      removedMissingNodeType += 1
      return false
    }
    if (seen.has(item.id)) {
      removedDuplicateNodeId += 1
      return false
    }
    seen.add(item.id)

    if (TEXT_TYPES.has(item.type) && !normalizeText(item.content)) {
      removedEmptyTextNodes += 1
      return false
    }

    return true
  })

  const validIds = new Set(items.map((item) => item.id))
  const links = snapshot.links.filter((link) => {
    if (!link.source || !link.target) return false
    return validIds.has(link.source) && validIds.has(link.target)
  })

  const articleCorpus = buildArticleCorpus(items)
  const cleaned: CleanedBoardSnapshot = {
    ...snapshot,
    items,
    links,
    metadata: {
      ...snapshot.metadata,
      itemCount: items.length,
      linkCount: links.length,
      itemTypeCounts: countTypes(items.map((item) => item.type)),
    },
    articleCorpus,
  }

  return {
    snapshot: cleaned,
    log: {
      boardId: snapshot.board.id,
      rawNodeCount: snapshot.items.length,
      cleanedNodeCount: items.length,
      rawEdgeCount: snapshot.links.length,
      removedInvalidNodeShape: 0,
      removedMissingNodeId,
      removedMissingNodeType,
      removedEmptyTextNodes,
      removedDuplicateNodeId,
      removedFilteredTypeNodes: 0,
      invalidReferenceLinksRemoved: snapshot.links.length - links.length,
      nodesWithReferenceCleanup: 0,
      sectionCount: articleCorpus.sectionCount,
      sectionedNodeCount: articleCorpus.sectionedNodeCount,
      unsectionedNodeCount: articleCorpus.unsectionedNodeCount,
    },
  }
}

function buildArticleCorpus(items: CleanedBoardSnapshot["items"]): CleanedBoardSnapshot["articleCorpus"] {
  const sections = items
    .filter((item) => item.type === "section")
    .map((section) => {
      const memberItems = items.filter((item) => item.id !== section.id && isInsideSection(item, section))
      const merged = memberItems.map((item) => normalizeText(item.content)).filter(Boolean)
      return {
        sectionId: section.id,
        sectionTitle: section.title ?? section.content ?? "Untitled Section",
        memberNodeIds: memberItems.map((item) => item.id),
        memberCount: memberItems.length,
        uniqueTextItems: new Set(merged).size,
        duplicateTextItems: merged.length - new Set(merged).size,
        mergedText: merged.join("\n\n"),
      }
    })

  const sectionedIds = new Set(sections.flatMap((section) => section.memberNodeIds))
  const unsectionedItems = items.filter((item) => item.type !== "section" && !sectionedIds.has(item.id))
  const unsectionedText = unsectionedItems.map((item) => normalizeText(item.content)).filter(Boolean)

  return {
    sectionCount: sections.length,
    sectionedNodeCount: sectionedIds.size,
    unsectionedNodeCount: unsectionedItems.length,
    sections,
    unsectioned: {
      memberNodeIds: unsectionedItems.map((item) => item.id),
      mergedText: unsectionedText.join("\n\n"),
    },
    narrativeCorpus: [
      ...sections.map((section) => section.mergedText),
      unsectionedText.join("\n\n"),
    ].filter(Boolean).join("\n\n"),
  }
}

function buildSectionBundle(board: CleanedBoardSnapshot): BoardSectionAggregate[] {
  return board.articleCorpus.sections.map((section) => ({
    boardId: board.board.id,
    boardTitle: board.board.title,
    sectionId: section.sectionId,
    sectionTitle: section.sectionTitle,
    nodes: board.items
      .filter((item) => section.memberNodeIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        type: item.type,
        content: item.content ?? item.title ?? "",
      })),
  }))
}

function buildResearchBundle(
  board: CleanedBoardSnapshot,
  bundleType: keyof BoardAnalysisContext["researchBundles"],
): BoardResearchItem[] {
  return board.items.flatMap((item) => {
    const content = normalizeText(item.content) ?? normalizeText(item.title)
    if (!content) return []
    if (!matchesBundle(item.type, bundleType)) return []

    const section = board.articleCorpus.sections.find((entry) => entry.memberNodeIds.includes(item.id))
    const sourceUrl = extractSourceUrl(item.metadata)

    return [{
      id: item.id,
      type: item.type,
      content,
      section: section?.sectionTitle ?? "Unsectioned",
      board: board.board.title,
      sourceUrl,
    }]
  })
}

function summarizeBoard(board: CleanedBoardSnapshot): BoardAggregateSummary {
  return {
    boardId: board.board.id,
    title: board.board.title,
    sectionCount: board.articleCorpus.sectionCount,
    nodeTypeCounts: board.metadata.itemTypeCounts,
    totalNodeCount: board.items.length,
  }
}

function matchesBundle(type: string, bundleType: keyof BoardAnalysisContext["researchBundles"]) {
  if (bundleType === "text_bundle") return TEXT_TYPES.has(type)
  if (bundleType === "report_bundle") return REPORT_TYPES.has(type)
  if (bundleType === "web_bundle") return WEB_TYPES.has(type)
  if (bundleType === "chart_bundle") return CHART_TYPES.has(type)
  return false
}

function extractSourceUrl(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined
  const url = metadata.url ?? metadata.sourceUrl ?? metadata.href
  return typeof url === "string" ? url : undefined
}

function normalizeText(value?: string) {
  return value?.trim() || undefined
}

function countTypes(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

function isInsideSection(item: CleanedBoardSnapshot["items"][number], section: CleanedBoardSnapshot["items"][number]) {
  const itemPos = item.position
  const itemSize = item.size
  const sectionPos = section.position
  const sectionSize = section.size
  if (!itemPos || !sectionPos || !sectionSize) return false

  const itemX = itemPos.x ?? 0
  const itemY = itemPos.y ?? 0
  const itemWidth = itemSize?.x ?? 0
  const itemHeight = itemSize?.y ?? 0
  const sectionX = sectionPos.x ?? 0
  const sectionY = sectionPos.y ?? 0
  const sectionWidth = sectionSize.x ?? 0
  const sectionHeight = sectionSize.y ?? 0

  return (
    itemX >= sectionX &&
    itemY >= sectionY &&
    itemX + itemWidth <= sectionX + sectionWidth &&
    itemY + itemHeight <= sectionY + sectionHeight
  )
}
