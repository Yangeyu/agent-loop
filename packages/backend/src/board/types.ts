export type BoardItem = {
  id: string
  type: string
  title?: string
  content?: string
  position?: {
    x?: number
    y?: number
  }
  size?: {
    x?: number
    y?: number
  }
  referencedIds?: string[]
  metadata?: Record<string, unknown>
}

export type BoardLink = {
  id: string
  source?: string
  target?: string
  type?: string
  label?: string
}

export type BoardSnapshot = {
  board: {
    id: string
    title: string
    ownerId: string
    createdAt?: string
    updatedAt?: string
    coverUrl?: string
    isPublic?: boolean
    version?: number
  }
  items: BoardItem[]
  links: BoardLink[]
  viewport?: Record<string, unknown>
  metadata: {
    sourceDataId: string
    itemCount: number
    linkCount: number
    itemTypeCounts: Record<string, number>
    extractedAt: string
  }
}

export type BoardSnapshotFilters = {
  boardIds?: string[]
  userId?: string
  publicOnly?: boolean
  limit?: number
}

export type BoardArticleSection = {
  sectionId: string
  sectionTitle: string
  memberNodeIds: string[]
  memberCount: number
  uniqueTextItems: number
  duplicateTextItems: number
  mergedText: string
}

export type BoardArticleCorpus = {
  sectionCount: number
  sectionedNodeCount: number
  unsectionedNodeCount: number
  sections: BoardArticleSection[]
  unsectioned: {
    memberNodeIds: string[]
    mergedText: string
  }
  narrativeCorpus: string
}

export type CleanedBoardSnapshot = BoardSnapshot & {
  articleCorpus: BoardArticleCorpus
}

export type BoardCleaningLog = {
  boardId: string
  rawNodeCount: number
  cleanedNodeCount: number
  rawEdgeCount: number
  removedInvalidNodeShape: number
  removedMissingNodeId: number
  removedMissingNodeType: number
  removedEmptyTextNodes: number
  removedDuplicateNodeId: number
  removedFilteredTypeNodes: number
  invalidReferenceLinksRemoved: number
  nodesWithReferenceCleanup: number
  sectionCount: number
  sectionedNodeCount: number
  unsectionedNodeCount: number
}

export type BoardSectionAggregate = {
  boardId: string
  boardTitle: string
  sectionId: string
  sectionTitle: string
  nodes: Array<{
    id: string
    type: string
    content: string
  }>
}

export type BoardResearchItem = {
  id: string
  type: string
  content: string
  section: string
  board: string
  sourceUrl?: string
  linkId?: string
}

export type BoardAggregateSummary = {
  boardId: string
  title: string
  sectionCount: number
  nodeTypeCounts: Record<string, number>
  totalNodeCount: number
}

export type BoardAnalysisContext = {
  analysisScope: {
    input?: string
    filters: {
      limit: number
      boardIds?: string[]
      userId?: string
      publicOnly: boolean
    }
    loadedBoardCount: number
  }
  boards: CleanedBoardSnapshot[]
  boardCleaningLogs: BoardCleaningLog[]
  boardAggregates: BoardAggregateSummary[]
  overview: {
    boardCount: number
    sectionCount: number
    typeCounts: Record<string, number>
    analyzableTypes: string[]
  }
  researchBundles: {
    section_bundle: BoardSectionAggregate[]
    text_bundle: BoardResearchItem[]
    report_bundle: BoardResearchItem[]
    web_bundle: BoardResearchItem[]
    chart_bundle: BoardResearchItem[]
  }
}

export type BoardAnalysisBundleType = keyof BoardAnalysisContext["researchBundles"]

export type BoardAnalysisDatasetSummary = {
  analysisId: string
  analysisScope: BoardAnalysisContext["analysisScope"]
  overview: BoardAnalysisContext["overview"]
  boardAggregates: BoardAnalysisContext["boardAggregates"]
  boardCleaningLogs: BoardAnalysisContext["boardCleaningLogs"]
   assets: {
    count: number
    items: Array<{
      name: string
      focus?: string
      sourceBundleTypes: BoardAnalysisBundleType[]
      updatedAt: string
    }>
  }
  bundles: Array<{
    type: BoardAnalysisBundleType
    itemCount: number
    description: string
  }>
}

export type BoardAnalysisAsset = {
  name: string
  content: string
  focus?: string
  sourceBundleTypes: BoardAnalysisBundleType[]
  createdAt: string
  updatedAt: string
}
