import type { Room, Visitor } from "../types"

export interface RoomRepository {
  add(room: Omit<Room, "_id">): string
  get(id: string): Room | undefined
  update(id: string, patch: Partial<Room>): Room | undefined
  findPlayingRooms(): Room[]
  findActiveRooms(): Room[]
}

export interface VisitorRepository {
  getByNonce(nonce: string): Visitor | undefined
  add(visitor: Omit<Visitor, "_id">): string
  update(id: string, visitor: Visitor): void
}
