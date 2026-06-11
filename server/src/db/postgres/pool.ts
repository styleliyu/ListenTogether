import { Pool } from "pg"
import { env } from "../../config/env"

let pool: Pool | undefined

export function getPgPool(): Pool {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres.")
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: env.pgPoolMax,
      idleTimeoutMillis: env.pgIdleTimeoutMs,
      connectionTimeoutMillis: env.pgConnectionTimeoutMs
    })
  }

  return pool
}

export async function checkPgConnection(): Promise<void> {
  await getPgPool().query("SELECT 1")
}
