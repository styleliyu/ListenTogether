import fs from "fs"
import path from "path"
import { getPgPool } from "./pool"

const FALLBACK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_client_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OK', 'EXPIRED', 'DELETED')),
  room_name TEXT,
  is_persistent BOOLEAN NOT NULL DEFAULT FALSE,
  play_status TEXT NOT NULL CHECK (play_status IN ('PLAYING', 'PAUSED')),
  speed_rate TEXT NOT NULL,
  content_stamp BIGINT NOT NULL,
  operate_stamp BIGINT NOT NULL,
  operator_guest_id TEXT,
  current_index INTEGER,
  current_item_id TEXT,
  play_mode TEXT,
  empty_stamp BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  content JSONB NOT NULL,
  permissions JSONB NOT NULL,
  legacy_data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_owner_state ON rooms(owner_client_id, state);
CREATE INDEX IF NOT EXISTS idx_rooms_play_state ON rooms(play_status, state);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);
CREATE INDEX IF NOT EXISTS idx_rooms_operate_stamp ON rooms(operate_stamp);
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  nickname TEXT,
  enter_room_stamp BIGINT,
  enter_num INTEGER NOT NULL DEFAULT 0,
  create_num INTEGER NOT NULL DEFAULT 0,
  create_room_stamp BIGINT,
  create_stamp BIGINT NOT NULL,
  user_agent TEXT,
  ip JSONB,
  legacy_data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitors_nonce ON visitors(nonce);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  nickname TEXT,
  enter_stamp BIGINT NOT NULL,
  heartbeat_stamp BIGINT NOT NULL,
  user_agent TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  raw_member JSONB NOT NULL,
  PRIMARY KEY (room_id, guest_id),
  UNIQUE (room_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_room_client ON room_members(room_id, client_id);
CREATE TABLE IF NOT EXISTS room_queue_items (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  image_url TEXT,
  link_url TEXT,
  resource_id TEXT,
  audio_url TEXT,
  raw_item JSONB NOT NULL,
  PRIMARY KEY (room_id, item_id),
  UNIQUE (room_id, position)
);
CREATE INDEX IF NOT EXISTS idx_room_queue_items_room_position ON room_queue_items(room_id, position);
CREATE TABLE IF NOT EXISTS room_chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_guest_id TEXT NOT NULL,
  sender_name TEXT,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_chat_messages_room_created ON room_chat_messages(room_id, created_at);
`

export async function initializePostgresSchema(): Promise<void> {
  try {
    await getPgPool().query(readSchemaSql())
  } catch (err) {
    throw new Error(`PostgreSQL schema initialization failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function readSchemaSql(): string {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.resolve(process.cwd(), "src", "db", "postgres", "schema.sql")
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8")
  }

  return FALLBACK_SCHEMA_SQL
}
