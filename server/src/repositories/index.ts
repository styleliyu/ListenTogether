import { env } from "../config/env"
import type { RoomRepository, VisitorRepository } from "./types"

type SqliteModule = typeof import("../db")
type PostgresRoomModule = typeof import("../db/postgres/roomRepository")
type PostgresVisitorModule = typeof import("../db/postgres/visitorRepository")
type PostgresInitModule = typeof import("../db/postgres/init")
type PostgresPoolModule = typeof import("../db/postgres/pool")

interface RepositorySet {
  roomRepo: RoomRepository
  visitorRepo: VisitorRepository
}

function createRepositories(): RepositorySet {
  if (env.databaseProvider === "postgres") {
    if (!env.databaseUrl) {
      throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres.")
    }
    const roomModule = require("../db/postgres/roomRepository") as PostgresRoomModule
    const visitorModule = require("../db/postgres/visitorRepository") as PostgresVisitorModule
    return {
      roomRepo: roomModule.postgresRoomRepo,
      visitorRepo: visitorModule.postgresVisitorRepo
    }
  }

  const sqliteModule = require("../db") as SqliteModule
  return {
    roomRepo: sqliteModule.roomRepo,
    visitorRepo: sqliteModule.visitorRepo
  }
}

const repositories = createRepositories()

export const roomRepo = repositories.roomRepo
export const visitorRepo = repositories.visitorRepo

export async function initializeDatabase(): Promise<void> {
  if (env.databaseProvider !== "postgres") return
  const initModule = require("../db/postgres/init") as PostgresInitModule
  await initModule.initializePostgresSchema()
}

export async function checkDatabaseHealth(): Promise<void> {
  if (env.databaseProvider !== "postgres") return
  const poolModule = require("../db/postgres/pool") as PostgresPoolModule
  await poolModule.checkPgConnection()
}

export type { RoomRepository, VisitorRepository } from "./types"
