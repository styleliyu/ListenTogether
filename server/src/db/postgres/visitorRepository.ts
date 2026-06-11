import crypto from "crypto"
import type { QueryResultRow } from "pg"
import type { Visitor } from "../../types"
import type { VisitorRepository } from "../../repositories/types"
import { getPgPool } from "./pool"

function createId(): string {
  return crypto.randomBytes(12).toString("hex")
}

function toVisitor(row?: QueryResultRow): Visitor | undefined {
  if (!row) return undefined
  const legacy = typeof row.legacy_data === "string" ? JSON.parse(row.legacy_data) as Visitor : row.legacy_data as Visitor
  return { ...legacy, _id: row.id }
}

async function saveVisitor(visitor: Visitor): Promise<void> {
  await getPgPool().query(
    `
      INSERT INTO visitors (
        id, nonce, nickname, enter_room_stamp, enter_num, create_num,
        create_room_stamp, create_stamp, user_agent, ip, legacy_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      ON CONFLICT(nonce) DO UPDATE SET
        nickname = excluded.nickname,
        enter_room_stamp = excluded.enter_room_stamp,
        enter_num = excluded.enter_num,
        create_num = excluded.create_num,
        create_room_stamp = excluded.create_room_stamp,
        user_agent = excluded.user_agent,
        ip = excluded.ip,
        legacy_data = excluded.legacy_data
    `,
    [
      visitor._id,
      visitor.nonce,
      visitor.nickName,
      visitor.enterRoomStamp,
      visitor.enterNum,
      visitor.createNum,
      visitor.createRoomStamp,
      visitor.createStamp,
      visitor.userAgent || null,
      JSON.stringify(visitor.ip ?? null),
      JSON.stringify(visitor)
    ]
  )
}

export const postgresVisitorRepo: VisitorRepository = {
  async getByNonce(nonce: string): Promise<Visitor | undefined> {
    const result = await getPgPool().query("SELECT * FROM visitors WHERE nonce = $1", [nonce])
    return toVisitor(result.rows[0])
  },

  async add(visitor: Omit<Visitor, "_id">): Promise<string> {
    const id = createId()
    await saveVisitor({ ...visitor, _id: id })
    return id
  },

  async update(id: string, visitor: Visitor): Promise<void> {
    await saveVisitor({ ...visitor, _id: id })
  }
}
