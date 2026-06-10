import fs from "fs"
import path from "path"
import crypto from "crypto"
import Database from "better-sqlite3"
import type { Room, Visitor } from "./types"
import { env } from "./config/env"
import type { RoomRepository, VisitorRepository } from "./repositories/types"

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "podcast-together.db")
const dbPath = path.resolve(env.databasePath || DEFAULT_DB_PATH)

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    state TEXT NOT NULL,
    play_status TEXT NOT NULL,
    create_stamp INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_owner_state ON rooms(owner, state);
  CREATE INDEX IF NOT EXISTS idx_rooms_play_state ON rooms(play_status, state);
  CREATE INDEX IF NOT EXISTS idx_rooms_operate_stamp ON rooms(create_stamp);

  CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,
    nonce TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
  );
`)

function createId(): string {
  return crypto.randomBytes(12).toString("hex")
}

function toRoom(row?: { id: string; data: string }): Room | undefined {
  if (!row) return undefined
  const parsed = JSON.parse(row.data) as Room
  return { ...parsed, _id: row.id }
}

function saveRoom(room: Room): void {
  const data = JSON.stringify(room)
  db.prepare(`
    INSERT INTO rooms (id, owner, state, play_status, create_stamp, data)
    VALUES (@id, @owner, @state, @playStatus, @createStamp, @data)
    ON CONFLICT(id) DO UPDATE SET
      owner = excluded.owner,
      state = excluded.state,
      play_status = excluded.play_status,
      create_stamp = excluded.create_stamp,
      data = excluded.data
  `).run({
    id: room._id,
    owner: room.owner,
    state: room.oState,
    playStatus: room.playStatus,
    createStamp: room.createStamp,
    data
  })
}

export const roomRepo: RoomRepository = {
  add(room: Omit<Room, "_id">): string {
    const id = createId()
    saveRoom({ ...room, _id: id })
    return id
  },

  get(id: string): Room | undefined {
    const row = db.prepare("SELECT id, data FROM rooms WHERE id = ?").get(id) as { id: string; data: string } | undefined
    return toRoom(row)
  },

  update(id: string, patch: Partial<Room>): Room | undefined {
    const current = this.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, _id: id }
    saveRoom(next)
    return next
  },

  findPlayingRooms(): Room[] {
    const rows = db
      .prepare("SELECT id, data FROM rooms WHERE state = 'OK' AND play_status = 'PLAYING' ORDER BY create_stamp ASC")
      .all() as { id: string; data: string }[]
    return rows.map(toRoom).filter((room): room is Room => Boolean(room))
  },

  findActiveRooms(): Room[] {
    const rows = db
      .prepare("SELECT id, data FROM rooms WHERE state = 'OK' ORDER BY create_stamp ASC")
      .all() as { id: string; data: string }[]
    return rows.map(toRoom).filter((room): room is Room => Boolean(room))
  }
}

function saveVisitor(visitor: Visitor): void {
  db.prepare(`
    INSERT INTO visitors (id, nonce, data)
    VALUES (@id, @nonce, @data)
    ON CONFLICT(nonce) DO UPDATE SET
      data = excluded.data
  `).run({
    id: visitor._id,
    nonce: visitor.nonce,
    data: JSON.stringify(visitor)
  })
}

export const visitorRepo: VisitorRepository = {
  getByNonce(nonce: string): Visitor | undefined {
    const row = db.prepare("SELECT id, data FROM visitors WHERE nonce = ?").get(nonce) as { id: string; data: string } | undefined
    if (!row) return undefined
    const visitor = JSON.parse(row.data) as Visitor
    return { ...visitor, _id: row.id }
  },

  add(visitor: Omit<Visitor, "_id">): string {
    const id = createId()
    saveVisitor({ ...visitor, _id: id })
    return id
  },

  update(id: string, visitor: Visitor): void {
    saveVisitor({ ...visitor, _id: id })
  }
}

export { dbPath }
