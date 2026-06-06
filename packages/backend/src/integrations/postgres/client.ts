import { Pool } from "pg"

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/kiwoo_local"

let pool: Pool | undefined

export function getDatabaseURL() {
  return process.env.KIWOO_DATABASE_URL ?? DEFAULT_DATABASE_URL
}

export function getPostgresPool() {
  if (pool) return pool

  pool = new Pool({
    connectionString: getDatabaseURL(),
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  })

  return pool
}

export async function queryRows<T extends Record<string, unknown>>(input: {
  text: string
  values?: unknown[]
  timeoutMs?: number
}): Promise<T[]> {
  const client = await getPostgresPool().connect()

  try {
    await client.query("BEGIN READ ONLY")
    await client.query(`SET LOCAL statement_timeout = ${input.timeoutMs ?? 10000}`)
    const result = await client.query<T>(input.text, input.values)
    await client.query("COMMIT")
    return result.rows
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
