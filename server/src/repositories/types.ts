import type { Room, Visitor } from "../types"

export interface RoomRepository {
  add(room: Omit<Room, "_id">): Promise<string>
  get(id: string): Promise<Room | undefined>
  update(id: string, patch: Partial<Room>): Promise<Room | undefined>
  findPlayingRooms(): Promise<Room[]>
  findActiveRooms(): Promise<Room[]>
}

export interface VisitorRepository {
  getByNonce(nonce: string): Promise<Visitor | undefined>
  add(visitor: Omit<Visitor, "_id">): Promise<string>
  update(id: string, visitor: Visitor): Promise<void>
}
