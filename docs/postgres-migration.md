# PostgreSQL 迁移草案与 dry-run 检查

本文档是 PostgreSQL 迁移前置设计草案。当前阶段不切换数据库，不连接 PostgreSQL，不执行 SQL，不修改 SQLite schema 或数据文件。

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

## PostgreSQL schema 草案

以下 SQL 仅为草案，不应在当前阶段执行。首版迁移建议保留 JSONB 边界，避免过度拆分业务对象。

```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  owner_client_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OK', 'EXPIRED', 'DELETED')),
  play_status TEXT NOT NULL CHECK (play_status IN ('PLAYING', 'PAUSED')),
  speed_rate TEXT NOT NULL,
  room_name TEXT,
  content JSONB NOT NULL,
  permissions JSONB NOT NULL,
  current_item_id TEXT,
  current_index INTEGER,
  play_mode TEXT,
  content_stamp_ms BIGINT NOT NULL,
  operate_stamp_ms BIGINT NOT NULL,
  operator_guest_id TEXT,
  created_at BIGINT NOT NULL,
  empty_at BIGINT,
  is_persistent BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_room_json JSONB NOT NULL
);

CREATE INDEX idx_rooms_owner_state ON rooms(owner_client_id, state);
CREATE INDEX idx_rooms_play_state ON rooms(play_status, state);
CREATE INDEX idx_rooms_created_at ON rooms(created_at);

CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  nick_name TEXT,
  enter_room_stamp_ms BIGINT,
  enter_num INTEGER NOT NULL DEFAULT 0,
  create_num INTEGER NOT NULL DEFAULT 0,
  create_room_stamp_ms BIGINT,
  create_stamp_ms BIGINT NOT NULL,
  user_agent TEXT,
  ip JSONB,
  legacy_visitor_json JSONB NOT NULL
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  nick_name TEXT,
  enter_stamp_ms BIGINT NOT NULL,
  heartbeat_stamp_ms BIGINT NOT NULL,
  user_agent TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (room_id, guest_id),
  UNIQUE (room_id, client_id)
);

CREATE INDEX idx_room_members_room_client ON room_members(room_id, client_id);

CREATE TABLE room_queue_items (
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

CREATE INDEX idx_room_queue_items_room_position ON room_queue_items(room_id, position);

CREATE TABLE room_chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_guest_id TEXT NOT NULL,
  sender_name TEXT,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_room_chat_messages_room_created ON room_chat_messages(room_id, created_at);
```

可选后续表：

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
| `rooms.data.config` | `rooms.permissions` | 先用 JSONB 保存 normalized permissions |
| `rooms.data.queue.currentItemId` | `rooms.current_item_id` | 必须保留 |
| `rooms.data.queue.currentIndex` | `rooms.current_index` | 必须保留 |
| `rooms.data.queue.playMode` | `rooms.play_mode` | 播放模式 |
| `rooms.data.queue.items` | `room_queue_items` | 数组顺序生成 `position` |
| `rooms.data.participants` | `room_members` | `nonce` 映射为 `client_id`，`guestId` 映射为 `guest_id` |
| `rooms.data.isPersistent` | `rooms.is_persistent` | 缺失时默认 `false` |
| `rooms.data.emptyStamp` | `rooms.empty_at` | 当前为毫秒时间戳 |
| `rooms.data` | `rooms.legacy_room_json` | 首版保留完整 JSON 便于回滚和校验 |
| `visitors.id` | `visitors.id` | 访客主键 |
| `visitors.nonce` | `visitors.nonce` | 全局 clientId |
| `visitors.data` | `visitors.*` + `visitors.legacy_visitor_json` | 结构化字段加完整 JSON |

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
