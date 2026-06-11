import crypto from "crypto"
import type { PoolClient, QueryResultRow } from "pg"
import type { Room, RoomQueue } from "../../types"
import type { RoomRepository } from "../../repositories/types"
import { getPgPool } from "./pool"

function createId(): string {
  return crypto.randomBytes(12).toString("hex")
}

function toRoom(row?: QueryResultRow): Room | undefined {
  if (!row) return undefined
  const legacy = parseJson(row.legacy_data) as Room
  const room: Room = { ...legacy, _id: row.id }
  if (room.queue) {
    room.queue = {
      ...room.queue,
      currentIndex: row.current_index ?? room.queue.currentIndex,
      currentItemId: row.current_item_id ?? room.queue.currentItemId,
      playMode: row.play_mode ?? room.queue.playMode
    }
  }
  return room
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value)
  return value
}

async function saveRoom(room: Room): Promise<void> {
  const pool = getPgPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `
        INSERT INTO rooms (
          id, owner_client_id, state, room_name, is_persistent, play_status, speed_rate,
          content_stamp, operate_stamp, operator_guest_id, current_index, current_item_id,
          play_mode, empty_stamp, created_at, updated_at, content, permissions, legacy_data
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb
        )
        ON CONFLICT(id) DO UPDATE SET
          owner_client_id = excluded.owner_client_id,
          state = excluded.state,
          room_name = excluded.room_name,
          is_persistent = excluded.is_persistent,
          play_status = excluded.play_status,
          speed_rate = excluded.speed_rate,
          content_stamp = excluded.content_stamp,
          operate_stamp = excluded.operate_stamp,
          operator_guest_id = excluded.operator_guest_id,
          current_index = excluded.current_index,
          current_item_id = excluded.current_item_id,
          play_mode = excluded.play_mode,
          empty_stamp = excluded.empty_stamp,
          updated_at = excluded.updated_at,
          content = excluded.content,
          permissions = excluded.permissions,
          legacy_data = excluded.legacy_data
      `,
      [
        room._id,
        room.owner,
        room.oState,
        room.roomName || null,
        Boolean(room.isPersistent),
        room.playStatus,
        room.speedRate,
        room.contentStamp,
        room.operateStamp,
        room.operator || null,
        room.queue?.currentIndex ?? null,
        room.queue?.currentItemId ?? null,
        room.queue?.playMode ?? null,
        room.emptyStamp ?? null,
        room.createStamp,
        Date.now(),
        JSON.stringify(room.content || {}),
        JSON.stringify(room.config?.permissions || {}),
        JSON.stringify(room)
      ]
    )
    await syncMembers(client, room)
    await syncQueueItems(client, room._id, room.queue)
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

async function syncMembers(client: PoolClient, room: Room): Promise<void> {
  await client.query("DELETE FROM room_members WHERE room_id = $1", [room._id])
  for (const member of room.participants || []) {
    await client.query(
      `
        INSERT INTO room_members (
          room_id, guest_id, client_id, nickname, enter_stamp,
          heartbeat_stamp, user_agent, is_owner, raw_member
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        room._id,
        member.guestId,
        member.nonce,
        member.nickName,
        member.enterStamp,
        member.heartbeatStamp,
        member.userAgent || null,
        member.nonce === room.owner,
        JSON.stringify(member)
      ]
    )
  }
}

async function syncQueueItems(client: PoolClient, roomId: string, queue?: RoomQueue): Promise<void> {
  await client.query("DELETE FROM room_queue_items WHERE room_id = $1", [roomId])
  const items = queue?.items || []
  for (const [position, item] of items.entries()) {
    await client.query(
      `
        INSERT INTO room_queue_items (
          room_id, item_id, position, source_type, title, artist,
          image_url, link_url, resource_id, audio_url, raw_item
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `,
      [
        roomId,
        item.id,
        position,
        item.sourceType,
        item.title,
        item.artist || null,
        item.imageUrl || null,
        item.linkUrl || null,
        item.resourceId || null,
        item.audioUrl || null,
        JSON.stringify(item)
      ]
    )
  }
}

export const postgresRoomRepo: RoomRepository = {
  async add(room: Omit<Room, "_id">): Promise<string> {
    const id = createId()
    await saveRoom({ ...room, _id: id })
    return id
  },

  async get(id: string): Promise<Room | undefined> {
    const result = await getPgPool().query("SELECT * FROM rooms WHERE id = $1", [id])
    return toRoom(result.rows[0])
  },

  async update(id: string, patch: Partial<Room>): Promise<Room | undefined> {
    const current = await this.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, _id: id }
    await saveRoom(next)
    return next
  },

  async findPlayingRooms(): Promise<Room[]> {
    const result = await getPgPool().query(
      "SELECT * FROM rooms WHERE state = 'OK' AND play_status = 'PLAYING' ORDER BY created_at ASC"
    )
    return result.rows.map(toRoom).filter((room): room is Room => Boolean(room))
  },

  async findActiveRooms(): Promise<Room[]> {
    const result = await getPgPool().query("SELECT * FROM rooms WHERE state = 'OK' ORDER BY created_at ASC")
    return result.rows.map(toRoom).filter((room): room is Room => Boolean(room))
  }
}
