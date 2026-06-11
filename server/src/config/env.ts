import "dotenv/config"

function readString(name: string, fallback: string): string {
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

function readOptionalString(name: string): string {
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

const databaseProvider = readString("DATABASE_PROVIDER", "sqlite").toLowerCase()
if (!["sqlite", "postgres"].includes(databaseProvider)) {
  throw new Error(`Invalid DATABASE_PROVIDER "${databaseProvider}". Expected "sqlite" or "postgres".`)
}

const sqliteDbPath = readString("SQLITE_DB_PATH", readString("DATABASE_PATH", "./data/podcast-together.db"))

export const env = {
  host: readString("HOST", "127.0.0.1"),
  port: readNumber("PORT", 3001),
  corsOrigin: readString("CORS_ORIGIN", "*"),
  databaseProvider: databaseProvider as "sqlite" | "postgres",
  sqliteDbPath,
  databasePath: sqliteDbPath,
  databaseUrl: readOptionalString("DATABASE_URL"),
  pgPoolMax: readNumber("PG_POOL_MAX", 10),
  pgIdleTimeoutMs: readNumber("PG_IDLE_TIMEOUT_MS", 30000),
  pgConnectionTimeoutMs: readNumber("PG_CONNECTION_TIMEOUT_MS", 5000),
  uploadDir: readString("UPLOAD_DIR", "./data/uploads"),
  roomClockIntervalMs: readNumber("ROOM_CLOCK_INTERVAL_MS", 30000),
  roomCleanupIntervalMs: readNumber("ROOM_CLEANUP_INTERVAL_MS", 60 * 1000),
  visitorOfflineTimeoutMs: readNumber("VISITOR_OFFLINE_TIMEOUT_MS", 30 * 60 * 1000),
  roomIdlePauseTimeoutMs: readNumber("ROOM_IDLE_PAUSE_TIMEOUT_MS", 0),
  tempRoomDeleteAfterEmptyMs: readNumber("TEMP_ROOM_DELETE_AFTER_EMPTY_MS", 60 * 60 * 1000),
  qqMusicCookie: readString("QQ_MUSIC_COOKIE", ""),
  qqMusicCookieFile: readString("QQ_MUSIC_COOKIE_FILE", "./data/qq-music-cookie.txt"),
  ximalaya: {
    appKey: readString("XIMALAYA_APP_KEY", ""),
    appSecret: readString("XIMALAYA_APP_SECRET", ""),
    clientOsType: readString("XIMALAYA_CLIENT_OS_TYPE", "4"),
    serverApiVersion: readString("XIMALAYA_SERVER_API_VERSION", "1.0.0"),
    deviceId: readString("XIMALAYA_DEVICE_ID", ""),
    deviceIdType: readString("XIMALAYA_DEVICE_ID_TYPE", ""),
    sigMode: readString("XIMALAYA_SIG_MODE", "md5_secret_concat")
  }
}

export type AppEnv = typeof env
