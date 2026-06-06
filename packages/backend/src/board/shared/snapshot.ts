import type { BoardItem, BoardLink, BoardSnapshot, BoardSnapshotFilters } from "@backend/board/types"
import { queryRows } from "@backend/integrations/postgres/client"

type BoardRow = {
  id: string
  user_id: string
  title: string
  cover_url: string | null
  is_public: number | null
  version: number | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

type BoardDataRow = {
  id: string
  board_id: string
  nodes: unknown
  edges: unknown
  viewport: unknown
}

export async function loadBoardSnapshot(boardId: string): Promise<BoardSnapshot> {
  const boards = await queryRows<BoardRow>({
    text: `
      select id, user_id, title, cover_url, is_public, version, created_at, updated_at
      from boards
      where id = $1
      limit 1
    `,
    values: [boardId],
  })

  const board = boards[0]
  if (!board) {
    throw new Error(`Board not found: ${boardId}`)
  }

  const boardDataRows = await queryRows<BoardDataRow>({
    text: `
      select id, board_id, nodes, edges, viewport
      from board_data
      where board_id = $1
      order by id desc
      limit 1
    `,
    values: [boardId],
  })

  const boardData = boardDataRows[0]
  if (!boardData) {
    throw new Error(`Board data not found: ${boardId}`)
  }

  const items = normalizeItems(boardData.nodes)
  const links = normalizeLinks(boardData.edges)

  return toBoardSnapshot(board, boardData, items, links)
}

export async function loadBoardSnapshots(filters: BoardSnapshotFilters = {}): Promise<BoardSnapshot[]> {
  const boardIds = filters.boardIds?.filter(Boolean)
  const limit = filters.limit ?? boardIds?.length ?? 20

  let boards: BoardRow[] = []

  if (boardIds?.length) {
    const params = boardIds.map((_, index) => `$${index + 1}`).join(", ")
    boards = await queryRows<BoardRow>({
      text: `
        select id, user_id, title, cover_url, is_public, version, created_at, updated_at
        from boards
        where id in (${params})
      `,
      values: boardIds,
    })
  } else {
    const clauses: string[] = []
    const values: unknown[] = []

    if (filters.userId) {
      values.push(filters.userId)
      clauses.push(`user_id = $${values.length}`)
    }
    if (filters.publicOnly) {
      clauses.push("is_public = 1")
    }

    values.push(limit)
    boards = await queryRows<BoardRow>({
      text: `
        select id, user_id, title, cover_url, is_public, version, created_at, updated_at
        from boards
        ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
        order by updated_at desc nulls last, id desc
        limit $${values.length}
      `,
      values,
    })
  }

  const orderedBoards = boardIds?.length
    ? boardIds.map((id) => boards.find((board) => board.id === id)).filter((board): board is BoardRow => Boolean(board))
    : boards

  return Promise.all(orderedBoards.slice(0, limit).map(async (board) => {
    const boardDataRows = await queryRows<BoardDataRow>({
      text: `
        select id, board_id, nodes, edges, viewport
        from board_data
        where board_id = $1
        order by id desc
        limit 1
      `,
      values: [board.id],
    })

    const boardData = boardDataRows[0]
    if (!boardData) {
      throw new Error(`Board data not found: ${board.id}`)
    }

    const items = normalizeItems(boardData.nodes)
    const links = normalizeLinks(boardData.edges)
    return toBoardSnapshot(board, boardData, items, links)
  }))
}

function toBoardSnapshot(board: BoardRow, boardData: BoardDataRow, items: BoardItem[], links: BoardLink[]): BoardSnapshot {
  return {
    board: {
      id: board.id,
      title: board.title,
      ownerId: board.user_id,
      createdAt: toIsoString(board.created_at),
      updatedAt: toIsoString(board.updated_at),
      coverUrl: board.cover_url ?? undefined,
      isPublic: board.is_public === null ? undefined : Boolean(board.is_public),
      version: board.version ?? undefined,
    },
    items,
    links,
    viewport: asRecord(boardData.viewport),
    metadata: {
      sourceDataId: boardData.id,
      itemCount: items.length,
      linkCount: links.length,
      itemTypeCounts: countItemTypes(items),
      extractedAt: new Date().toISOString(),
    },
  }
}

function normalizeItems(input: unknown) {
  if (!Array.isArray(input)) return []

  return input.map((item, index) => {
    const record: Record<string, unknown> = asRecord(item) ?? {}
    const metadata = asRecord(record.metadata)
    const referenced: Record<string, unknown> = asRecord(record.referenced) ?? {}
    const referencedIds = Array.isArray(referenced.ids)
      ? referenced.ids.filter((value): value is string => typeof value === "string")
      : undefined

    return {
      id: asString(record.id) ?? `item-${index + 1}`,
      type: asString(record.type) ?? "unknown",
      title: asString(record.title),
      content: asString(record.content),
      position: asPoint(record.pos),
      size: asPoint(record.size),
      referencedIds,
      metadata,
    } satisfies BoardItem
  })
}

function normalizeLinks(input: unknown) {
  if (!Array.isArray(input)) return []

  return input.map((item, index) => {
    const record: Record<string, unknown> = asRecord(item) ?? {}

    return {
      id: asString(record.id) ?? `link-${index + 1}`,
      source: asString(record.source),
      target: asString(record.target),
      type: asString(record.type),
      label: asString(record.label),
    } satisfies BoardLink
  })
}

function countItemTypes(items: BoardItem[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1
    return counts
  }, {})
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function asPoint(value: unknown) {
  const record = asRecord(value)
  if (!record) return undefined

  return {
    x: typeof record.x === "number" ? record.x : undefined,
    y: typeof record.y === "number" ? record.y : undefined,
  }
}

function toIsoString(value: Date | string | null) {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
