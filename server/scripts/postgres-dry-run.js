#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")
const dotenv = require("dotenv")

const serverRoot = path.resolve(__dirname, "..")
dotenv.config({ path: path.join(serverRoot, ".env") })

const DEFAULT_PERMISSIONS = {
  memberCanControlPlayback: true,
  memberCanManageQueue: true,
  memberCanImportPlaylist: true
}

const VALID_ROOM_STATES = new Set(["OK", "EXPIRED", "DELETED"])
const VALID_PLAY_STATUS = new Set(["PLAYING", "PAUSED"])
const VALID_PLAY_MODES = new Set(["sequence", "shuffle", "single"])

function main() {
  const dbPath = resolveDbPath(process.argv.slice(2))
  printHeader(dbPath)

  if (!fs.existsSync(dbPath)) {
    console.log("数据库文件不存在：未执行扫描。")
    console.log("提示：可使用 --db 指定 SQLite 文件，例如 node server/scripts/postgres-dry-run.js --db server/data/podcast-together.db")
    printEmptyReport("数据库文件不存在，无法判断。")
    return
  }

  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const report = scanDatabase(db)
    printReport(report)
  } catch (err) {
    console.log(`读取 SQLite 失败：${err && err.message ? err.message : String(err)}`)
    printEmptyReport("SQLite 读取失败，需先确认数据库文件可读。")
    process.exitCode = 1
  } finally {
    if (db) db.close()
  }
}

function resolveDbPath(args) {
  const dbArgIndex = args.indexOf("--db")
  if (dbArgIndex >= 0 && args[dbArgIndex + 1]) {
    return path.resolve(process.cwd(), args[dbArgIndex + 1])
  }

  const rawPath = process.env.DATABASE_PATH || "./data/podcast-together.db"
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(serverRoot, rawPath)
}

function scanDatabase(db) {
  const risks = []
  const hasRooms = tableExists(db, "rooms")
  const hasVisitors = tableExists(db, "visitors")
  if (!hasRooms) risks.push("SQLite 中缺少 rooms 表。")
  if (!hasVisitors) risks.push("SQLite 中缺少 visitors 表。")

  const rooms = hasRooms
    ? db.prepare("SELECT id, owner, state, play_status, create_stamp, data FROM rooms ORDER BY create_stamp ASC").all()
    : []
  const visitors = hasVisitors
    ? db.prepare("SELECT id, nonce, data FROM visitors ORDER BY id ASC").all()
    : []

  const report = {
    roomsTotal: rooms.length,
    visitorsTotal: visitors.length,
    roomStats: {
      OK: 0,
      DELETED: 0,
      EXPIRED: 0,
      persistent: 0,
      temporary: 0
    },
    queueStats: {
      totalItems: 0,
      missingItemId: 0,
      currentItemIdNotFound: 0,
      currentIndexOutOfRange: 0,
      positionGeneratable: 0,
      emptyQueueSafe: 0
    },
    memberStats: {
      totalParticipants: 0,
      missingGuestId: 0,
      missingClientId: 0,
      ownerClientMatched: 0,
      ownerGuestIdMatched: 0
    },
    permissionStats: {
      missingPermissions: 0,
      usingDefaultPermissions: 0,
      invalidPermissions: 0
    },
    visitorStats: {
      missingId: 0,
      missingNonce: 0,
      parseFailed: 0,
      missingNickName: 0,
      missingVisitCounters: 0
    },
    parseStats: {
      roomParseFailed: 0
    },
    risks
  }

  for (const row of rooms) scanRoom(row, report)
  for (const row of visitors) scanVisitor(row, report)

  return report
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  return Boolean(row)
}

function scanRoom(row, report) {
  if (!row.id) report.risks.push("发现缺少 id 的 rooms 行。")
  if (!row.owner) report.risks.push(`房间 ${safeId(row.id)} 缺少 owner。`)
  if (!VALID_ROOM_STATES.has(row.state)) report.risks.push(`房间 ${safeId(row.id)} state 非法：${String(row.state)}。`)
  if (!VALID_PLAY_STATUS.has(row.play_status)) report.risks.push(`房间 ${safeId(row.id)} play_status 非法：${String(row.play_status)}。`)

  let room
  try {
    room = JSON.parse(row.data)
  } catch (_err) {
    report.parseStats.roomParseFailed += 1
    report.risks.push(`房间 ${safeId(row.id)} data 不是合法 JSON。`)
    return
  }

  const state = room.oState || row.state
  if (state === "OK") report.roomStats.OK += 1
  else if (state === "DELETED") report.roomStats.DELETED += 1
  else if (state === "EXPIRED") report.roomStats.EXPIRED += 1

  if (room.isPersistent) report.roomStats.persistent += 1
  else report.roomStats.temporary += 1

  scanQueue(row, room, report)
  scanParticipants(row, room, report)
  scanPermissions(row, room, report)
}

function scanQueue(row, room, report) {
  const queue = room.queue
  if (!queue || !Array.isArray(queue.items)) {
    report.queueStats.emptyQueueSafe += 1
    return
  }

  const items = queue.items
  report.queueStats.totalItems += items.length
  report.queueStats.positionGeneratable += items.length

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || !item.id) {
      report.queueStats.missingItemId += 1
      report.risks.push(`房间 ${safeId(row.id)} 队列第 ${index} 项缺少 item.id。`)
    }
  }

  if (items.length < 1) {
    report.queueStats.emptyQueueSafe += 1
    return
  }

  if (!Number.isInteger(queue.currentIndex) || queue.currentIndex < 0 || queue.currentIndex >= items.length) {
    report.queueStats.currentIndexOutOfRange += 1
    report.risks.push(`房间 ${safeId(row.id)} currentIndex 越界：${String(queue.currentIndex)}，队列长度 ${items.length}。`)
  }

  if (queue.currentItemId) {
    const found = items.some(item => item && item.id === queue.currentItemId)
    if (!found) {
      report.queueStats.currentItemIdNotFound += 1
      report.risks.push(`房间 ${safeId(row.id)} currentItemId 在 queue.items 中找不到：${queue.currentItemId}。`)
    }
  } else if (Number.isInteger(queue.currentIndex) && queue.currentIndex >= 0 && queue.currentIndex < items.length) {
    const inferred = items[queue.currentIndex] && items[queue.currentIndex].id
    if (!inferred) {
      report.risks.push(`房间 ${safeId(row.id)} 缺少 currentItemId，且无法通过 currentIndex 推断 item.id。`)
    }
  }

  if (queue.playMode && !VALID_PLAY_MODES.has(queue.playMode)) {
    report.risks.push(`房间 ${safeId(row.id)} playMode 非法：${String(queue.playMode)}。`)
  }
}

function scanParticipants(row, room, report) {
  const participants = Array.isArray(room.participants) ? room.participants : []
  if (!Array.isArray(room.participants)) {
    report.risks.push(`房间 ${safeId(row.id)} participants 不是数组，将按空数组处理。`)
  }

  report.memberStats.totalParticipants += participants.length

  let ownerClientMatched = false
  let ownerGuestId = ""
  for (const participant of participants) {
    if (!participant || !participant.guestId) {
      report.memberStats.missingGuestId += 1
      report.risks.push(`房间 ${safeId(row.id)} 存在缺少 guestId 的 participant。`)
    }
    if (!participant || !participant.nonce) {
      report.memberStats.missingClientId += 1
      report.risks.push(`房间 ${safeId(row.id)} 存在缺少 nonce/clientId 的 participant。`)
    }
    if (participant && participant.nonce && participant.nonce === room.owner) {
      ownerClientMatched = true
      ownerGuestId = participant.guestId || ""
    }
  }

  if (ownerClientMatched) {
    report.memberStats.ownerClientMatched += 1
    if (ownerGuestId) report.memberStats.ownerGuestIdMatched += 1
  } else if (participants.length > 0 || room.oState === "OK") {
    report.risks.push(`房间 ${safeId(row.id)} owner clientId 未在 participants.nonce 中匹配。`)
  }
}

function scanPermissions(row, room, report) {
  const config = room.config
  const permissions = config && config.permissions
  if (!permissions) {
    report.permissionStats.missingPermissions += 1
    report.permissionStats.usingDefaultPermissions += 1
    return
  }

  const keys = Object.keys(DEFAULT_PERMISSIONS)
  const invalid = keys.some(key => typeof permissions[key] !== "boolean")
  if (invalid) {
    report.permissionStats.invalidPermissions += 1
    report.risks.push(`房间 ${safeId(row.id)} permissions 字段异常，将需要默认值兜底。`)
  }
}

function scanVisitor(row, report) {
  if (!row.id) report.visitorStats.missingId += 1
  if (!row.nonce) report.visitorStats.missingNonce += 1

  let visitor
  try {
    visitor = JSON.parse(row.data)
  } catch (_err) {
    report.visitorStats.parseFailed += 1
    report.risks.push(`访客 ${safeId(row.id)} data 不是合法 JSON。`)
    return
  }

  if (!visitor.nickName) report.visitorStats.missingNickName += 1
  if (
    typeof visitor.enterNum !== "number"
    || typeof visitor.createNum !== "number"
    || typeof visitor.enterRoomStamp !== "number"
    || typeof visitor.createRoomStamp !== "number"
    || typeof visitor.createStamp !== "number"
  ) {
    report.visitorStats.missingVisitCounters += 1
    report.risks.push(`访客 ${safeId(row.id)} 访问统计字段不完整。`)
  }
}

function printHeader(dbPath) {
  console.log("【SQLite -> PostgreSQL Dry Run】")
  console.log("")
  console.log(`数据库文件：${dbPath}`)
}

function printReport(report) {
  console.log(`rooms 总数：${report.roomsTotal}`)
  console.log(`visitors 总数：${report.visitorsTotal}`)
  console.log("")
  console.log("【房间统计】")
  console.log(`- OK：${report.roomStats.OK}`)
  console.log(`- DELETED：${report.roomStats.DELETED}`)
  console.log(`- EXPIRED：${report.roomStats.EXPIRED}`)
  console.log(`- persistent：${report.roomStats.persistent}`)
  console.log(`- temporary：${report.roomStats.temporary}`)
  console.log("")
  console.log("【队列统计】")
  console.log(`- 队列总项数：${report.queueStats.totalItems}`)
  console.log(`- 缺少 item id：${report.queueStats.missingItemId}`)
  console.log(`- currentItemId 找不到：${report.queueStats.currentItemIdNotFound}`)
  console.log(`- currentIndex 越界：${report.queueStats.currentIndexOutOfRange}`)
  console.log(`- position 可生成：${report.queueStats.positionGeneratable}`)
  console.log("")
  console.log("【成员统计】")
  console.log(`- participants 总数：${report.memberStats.totalParticipants}`)
  console.log(`- 缺少 guestId：${report.memberStats.missingGuestId}`)
  console.log(`- 缺少 clientId：${report.memberStats.missingClientId}`)
  console.log(`- owner 可匹配：${report.memberStats.ownerClientMatched}`)
  console.log(`- ownerGuestId 可匹配：${report.memberStats.ownerGuestIdMatched}`)
  console.log("")
  console.log("【权限统计】")
  console.log(`- 缺少 permissions：${report.permissionStats.missingPermissions}`)
  console.log(`- 使用默认 permissions：${report.permissionStats.usingDefaultPermissions}`)
  console.log(`- permissions 字段异常：${report.permissionStats.invalidPermissions}`)
  console.log("")
  console.log("【访客统计】")
  console.log(`- 缺少 id：${report.visitorStats.missingId}`)
  console.log(`- 缺少 nonce：${report.visitorStats.missingNonce}`)
  console.log(`- JSON parse 失败：${report.visitorStats.parseFailed}`)
  console.log(`- nickName 为空：${report.visitorStats.missingNickName}`)
  console.log(`- 访问统计字段不完整：${report.visitorStats.missingVisitCounters}`)
  console.log("")
  console.log("【聊天迁移】")
  console.log("- 当前聊天为内存态：是")
  console.log("- 本次不迁移：是")
  console.log("")
  printRisksAndConclusion(report.risks)
}

function printEmptyReport(reason) {
  const report = {
    roomsTotal: 0,
    visitorsTotal: 0,
    roomStats: { OK: 0, DELETED: 0, EXPIRED: 0, persistent: 0, temporary: 0 },
    queueStats: { totalItems: 0, missingItemId: 0, currentItemIdNotFound: 0, currentIndexOutOfRange: 0, positionGeneratable: 0 },
    memberStats: { totalParticipants: 0, missingGuestId: 0, missingClientId: 0, ownerClientMatched: 0, ownerGuestIdMatched: 0 },
    permissionStats: { missingPermissions: 0, usingDefaultPermissions: 0, invalidPermissions: 0 },
    visitorStats: { missingId: 0, missingNonce: 0, parseFailed: 0, missingNickName: 0, missingVisitCounters: 0 },
    risks: [reason]
  }
  printReport(report)
}

function printRisksAndConclusion(risks) {
  console.log("【风险】")
  if (risks.length < 1) {
    console.log("1. 未发现阻塞性数据风险。")
  } else {
    risks.forEach((risk, index) => {
      console.log(`${index + 1}. ${risk}`)
    })
  }
  console.log("")
  console.log("【结论】")
  console.log(`- 是否可以进入 PG schema 实现阶段：${risks.length < 1 ? "是" : "需先评估上述风险"}`)
  console.log(`- 是否需要先修复数据：${risks.length < 1 ? "否" : "是，或在迁移脚本中显式处理"}`)
}

function safeId(value) {
  return value || "<unknown>"
}

main()
