# PostgreSQL Provider 与 dry-run 检查

本文档记录 PostgreSQL provider 的当前实现边界和迁移注意事项。当前默认仍为 SQLite；只有显式设置 `DATABASE_PROVIDER=postgres` 时才连接 PostgreSQL 并初始化 schema。不修改 SQLite schema 或数据文件。

## Provider 配置

后端通过环境变量选择数据库实现：

```env
DATABASE_PROVIDER=sqlite
SQLITE_DB_PATH=./data/podcast-together.db
DATABASE_PATH=./data/podcast-together.db
DATABASE_URL=postgresql://user:password@localhost:5432/allcanlisten
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=5000
```

- `DATABASE_PROVIDER` 支持 `sqlite` 和 `postgres`，默认 `sqlite`。
- SQLite 模式优先读取 `SQLITE_DB_PATH`，仍兼容旧 `DATABASE_PATH`。
- `DATABASE_URL` 只在 `DATABASE_PROVIDER=postgres` 时必需。
- PostgreSQL 模式允许空库启动，服务启动时会执行 `server/src/db/postgres/schema.sql`。
- 当前没有执行 SQLite 到 PostgreSQL 的数据迁移；如果旧 SQLite 数据需要保留，应先运行 dry-run 检查。

## 当前 SQLite 状态

- 当前仍使用 SQLite，运行时数据库默认位于 `server/data/podcast-together.db`，也可通过 `DATABASE_PATH` 覆盖。
- `rooms` 表保存房间索引字段和完整 `Room` JSON blob：
  - `rooms.id`
  - `rooms.owner`
  - `rooms.state`
  - `rooms.play_status`
  - `rooms.create_stamp`
  - `rooms.data`
- `visitors` 表保存访客索引字段和完整 `Visitor` JSON blob：
  - `visitors.id`
  - `visitors.nonce`
  - `visitors.data`
- `rooms.data` 是当前事实来源，包含 `content`、`participants`、`config`、`queue`、`isPersistent`、`emptyStamp` 等字段。
- 聊天室当前为内存态，由 `chatService.ts` 中的 `roomChatHistories` 保存，不在 SQLite 中。
- playlist import jobs 当前为内存态，由 `playlistImport.ts` 中的 `activeJobs` 保存，不在 SQLite 中。

## PostgreSQL schema

实际初始化 SQL 位于：

```bash
server/src/db/postgres/schema.sql
```

首版实现保留 JSONB 边界，避免过度拆分业务对象。`rooms.legacy_data` 和 `visitors.legacy_data` 是读取时恢复完整业务对象的事实来源，结构化列用于索引、健康检查和后续迁移演进。

当前实际创建的表：

- `rooms`
- `visitors`
- `room_members`
- `room_queue_items`
- `room_chat_messages`

`playlist_import_jobs`、`playlist_import_failed_tracks` 和 `room_events` 本阶段不创建。聊天室运行时逻辑仍使用内存历史；`room_chat_messages` 只是为后续持久化预留。

未在本阶段创建的后续可选表：

```sql
CREATE TABLE playlist_import_jobs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  link TEXT NOT NULL,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE playlist_import_failed_tracks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES playlist_import_jobs(id) ON DELETE CASCADE,
  title TEXT,
  artist TEXT,
  source TEXT,
  reason TEXT NOT NULL,
  raw_reason TEXT
);

CREATE TABLE room_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_guest_id TEXT,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
```

## 迁移映射表

| SQLite | PostgreSQL | 说明 |
| --- | --- | --- |
| `rooms.id` | `rooms.id` | 房间主键 |
| `rooms.owner` | `rooms.owner_client_id` | 当前语义是 clientId/nonce，不是 guestId |
| `rooms.state` | `rooms.state` | 对应 `Room.oState` |
| `rooms.play_status` | `rooms.play_status` | 对应 `Room.playStatus` |
| `rooms.create_stamp` | `rooms.created_at` | 当前为毫秒时间戳 |
| `rooms.data.content` | `rooms.content` | 先用 JSONB 保存 |
| `rooms.data.config` | `rooms.permissions` | 先用 JSONB 保存权限配置 |
| `rooms.data.queue.currentItemId` | `rooms.current_item_id` | 必须保留 |
| `rooms.data.queue.currentIndex` | `rooms.current_index` | 必须保留 |
| `rooms.data.queue.playMode` | `rooms.play_mode` | 播放模式 |
| `rooms.data.queue.items` | `room_queue_items` | 数组顺序生成 `position` |
| `rooms.data.participants` | `room_members` | `nonce` 映射为 `client_id`，`guestId` 映射为 `guest_id` |
| `rooms.data.isPersistent` | `rooms.is_persistent` | 缺失时默认 `false` |
| `rooms.data.emptyStamp` | `rooms.empty_stamp` | 当前为毫秒时间戳 |
| `rooms.data` | `rooms.legacy_data` | 首版保留完整 JSON 便于回滚和校验 |
| `visitors.id` | `visitors.id` | 访客主键 |
| `visitors.nonce` | `visitors.nonce` | 全局 clientId |
| `visitors.data` | `visitors.*` + `visitors.legacy_data` | 结构化字段加完整 JSON |

## 不迁移内容

首版迁移不迁移以下运行时内存状态：

- 内存聊天室历史。
- playlist import jobs。
- playlist import failedTracks。
- parse-text rate limit maps。
- WebSocket socket-room 绑定。
- lazy resolve cache。
- queue switch pause guard。

`room_chat_messages` 是未来聊天持久化预留表，不代表当前 SQLite 中已有聊天数据可迁移。

## 风险和校验规则

- `currentItemId` 必须能在 `queue.items` 中找到；找不到时需要先决定以 `currentIndex` 修复还是按原值保留风险。
- `currentIndex` 必须在队列范围内；越界时不能直接落入 `rooms.current_index`。
- `room_queue_items.position` 必须可由数组顺序连续生成，从 `0` 开始，不应出现重复或空洞。
- `owner_client_id` 不能误当 `guest_id`。当前 `Room.owner` 保存的是 clientId/nonce。
- `room_members` 必须能表达当前 `participants`，其中 `participant.nonce` 是 clientId，`participant.guestId` 是房间内成员 id。
- `ownerGuestId` 是由 `participants.find(person => person.nonce === room.owner)?.guestId` 推导出来的，不是独立持久字段。
- `permissions` 必须保留默认值。`config.permissions` 缺失时按当前默认值补齐：
  - `memberCanControlPlayback: true`
  - `memberCanManageQueue: true`
  - `memberCanImportPlaylist: true`
- 临时房间是否迁移需要明确策略。建议首版 dry-run 同时统计临时房间和常驻房间，真实迁移前再决定是否跳过已删除临时房间。
- `rooms.data` 和 `visitors.data` 应在首版 PG schema 中保留为 legacy JSONB，降低回滚和兼容风险。

## dry-run 检查

只读检查脚本位于：

```bash
server/scripts/postgres-dry-run.js
```

运行方式：

```bash
node server/scripts/postgres-dry-run.js
```

也可以手动指定 SQLite 文件：

```bash
node server/scripts/postgres-dry-run.js --db server/data/podcast-together.db
```

脚本只读取 SQLite，输出转换风险报告，不连接 PostgreSQL，不写入 SQLite，不生成 SQL 文件。
