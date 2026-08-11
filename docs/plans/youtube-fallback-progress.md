# YouTube Fallback 开发进度

> 最后更新：2026-08-10
> 当前状态：`FROZEN_STANDALONE_DESIGN`
> YouTube 设计和 Phase 1 POC 证据完整保留，但当前冻结；不得因 QQ音乐、网易云音乐、前端或其他播放任务自动恢复。Phase 1 Functional Gate 未通过，禁止进入 Phase 2。只有用户明确点名恢复 YouTube fallback 并指定 Phase，才允许继续。

## 最终目标

在不提取或代理 YouTube 媒体内容的前提下，以服务端为唯一解析权威，使用 YouTube Data API 搜索并确定性匹配候选，再通过可见的官方 YouTube IFrame Player 作为原平台直连失败时的 fallback；保持现有直连播放、队列和房间同步行为兼容。

## 当前 Phase / 原子工作包

- 当前 Phase：无活动 Phase；YouTube 工作流冻结在 Phase 1 Functional Gate 未通过之后。
- 当前动作：保留设计、POC、报告和失败证据；不继续人工重测，不进入 Phase 2，不改其他平台设计。
- 恢复条件：用户明确点名恢复 YouTube fallback、指定继续的 Phase，并按上下文协议主动压缩和授权；普通“继续开发”或其他平台任务不构成恢复授权。

## 已完成事项

- 已修改并复核外部设计文档 `C:\Users\11476\Documents\Codex\2026-08-10\referenced-chatgpt-conversation-this-is-an\outputs\YOUTUBE_FALLBACK_DEVELOPMENT_DESIGN.md`，加入独立保留、零反向依赖、显式恢复授权和可拔除废弃协议。
- 已确认仓库不存在 `.codegraph/`，按规则未建立索引。
- 已记录 Git 基线：分支 `main`，HEAD `5c910c7d77375900295b827fe93d78ede2aeab9b`，`origin/main` `c8b1e5c40eee7a45922db3bf702711f10634ca5e`；本地分支比远端多 1 个设计文档提交。
- 已识别并保留用户原有脏改动：删除 `docs/superpowers/specs/2026-07-06-qq-music-owner-qr-login-design.md`；该删除不属于本任务。
- 已核对技术栈：根目录 React 18 + Vite + TypeScript；`server/` 为 Express + TypeScript；正式代码仍没有 `src/player/`；Phase 1 已新增隔离的 `poc/youtube-fallback/`。
- 已完成实际入口映射，见下节。
- 已落实 Phase 1 POC 的目录、启动、测试和隔离边界，见下节。
- 已完成 Phase 1 首个原子包：POC package/tsconfig、服务端 health/resolve 路由、脱敏配置读取、TrackIdentity/YouTube DTO、11 条 fixture、fixture schema 测试和独立手工页面。
- 已完成 Phase 1 第二个原子包：`YouTubeDataApiClient` 的查询构造、服务端 API Key 边界、一次 `search.list`、一次批量 `videos.list`、运行时 schema 校验、ISO 8601 时长解析、超时/配置/HTTP 错误分类及 mock fetch 测试。
- 已完成 Phase 1 第三个原子包：`TrackMatcher` 的文本标准化、版本词集合、硬过滤、标题/歌手匹配、时长边界、地区限制、确定性排序、歧义拒绝及离线单元测试。
- 已完成 Phase 1 第四个原子包：`/resolve` 已串接一次搜索、一次批量详情请求和 matcher；加入结构化 `matched`/`no_match`/`error` 响应、TrackIdentity 请求校验、无 API Key/暂时不可用映射，以及空搜索和候选详情缺失处理。
- 已完成 Phase 1 第五个原子包并修正为：`/resolve` 返回最多 10 个候选的 `selected`/`eligible`/`rejected` 决策与 reasons；POC 服务同源提供手工页面，接入官方可见 IFrame API、play/pause/seek/currentTime/ended/error 日志和 autoplay 用户恢复入口。
- 已新增 `tests/liveFixtureReport.ts` 与 `docs/plans/youtube-fallback-phase1-report.md`，固定真实样本报告格式、API 调用计数和人工确认门禁；真实样本报告已经执行，Key 始终只由服务端环境读取。
- 已使用服务端环境中的 Key 完成两轮 11 首真实 HK Data API 验证，不回显或记录 Key；第二轮结果为 8 matched、2 ambiguity null、1 negative null。
- 首次浏览器测试发现歌词候选 `v10bFxUDZsA` 在 YouTube 网页可播放、但 IFrame 连续返回 `ERROR(150)`。已加入 `101/150` 去重拒绝和 eligible 候选切换，避免重复尝试同一视频。
- 普通候选仍保持 `±15 秒`；标题明确为 `Official Music Video` 且频道名匹配主歌手的官方 MV 启用非对称容差（最多长 60 秒、最多短 15 秒）。真实单条复测已选择 `DYptgVvkVLQ`，并保留 `3-DteAHyRnI` 为 eligible 备用。
- 第二次浏览器复测中，`DYptgVvkVLQ`、`3-DteAHyRnI` 和 `v10bFxUDZsA` 均各返回一次 `ERROR(150)` 后结束为 `NO_RUNTIME_PLAYABLE_CANDIDATE`，证明候选切换与去重终止逻辑有效。
- 用户确认 YouTube 官方 IFrame 文档示例视频 `M7lc1UVf-VE` 能成功加载，排除浏览器、本地来源和 IFrame 初始化整体故障；《晴天》失败属于候选级运行时嵌入限制。
- 已新增可信 Official Audio / Artist Topic 排序优先级，不修改 title + artists 搜索模板；真实 HK 复测选择 `Love Story` Topic 原版 `CxcEqhy4yKg`。
- 已新增 POC 服务端 `POST /runtime-failure`、解析会话和按 `videoId + regionCode` 的 24 小时进程内失败缓存；客户端只上报 `100/101/150`，服务端校验当前候选并决定下一项。

## 实际路径映射

### 前端现有播放与房间协调（Phase 0 只读）

- `src/hooks/useAudioPlayer.ts:36`：Shikwasa2 播放器 Hook；`src/hooks/useAudioPlayer.ts:75` 创建 Shikwasa 实例并以 `content.audioUrl` 播放。
- `src/hooks/useRoomPage.ts:48`：房间页面 Hook；`:54` 获取 WebSocket；`:123` 创建播放器；`:268` 处理 WebSocket 消息。
- `src/types/index.ts:24`、`:47`、`:58`：前端 `ContentData`、`QueueItem`、`RoomQueue` 类型镜像。

### 服务端解析、队列、同步与持久化（Phase 0 只读）

- `server/src/music/musicAdapter.ts:40`：音乐链接解析；`:70`：队列项内容解析；`:93`：歌单导入；`:1006`：可播放队列项转换。
- `server/src/queueService.ts:39`：队列归一化；`:132`：队列项清洗；`:148`：内容转队列项；`:160`：房间队列状态构造。
- `server/src/playbackService.ts:9`、`:17`：播放权限及播放更新构造。
- `server/src/websocket.ts:45`：WebSocket 建立；`:85`：消息入口；`:445`：切换队列项；`:507`：延迟解析判断。
- `server/src/db/postgres/roomRepository.ts:128`：队列项持久化同步；`:157`：Postgres 房间仓库。
- `server/src/types.ts:20`、`:55`、`:66`：服务端 `ContentData`、`QueueItem`、`RoomQueue`；前后端目前存在两份类型定义，正式协议接入前再处理权威方案。

## Phase 1 POC 隔离计划

- 目录：`poc/youtube-fallback/`，下设独立 `server/`、`web/`、`fixtures/`、`tests/`，并包含独立 README。
- 启动：POC 使用独立命令和独立 API 路由前缀；不得让正式路由依赖 POC 模块。具体脚本在 Phase 1 首个原子工作包中落实。
- 测试：先固定 `TrackIdentity` 样本与人工 ground truth，再覆盖 normalize、版本冲突、歌手/标题、15 秒边界、歧义拒绝和负例；随后运行搜索、批量 `videos.list`、候选展示与可见 IFrame 手动验收。
- 隔离边界：Phase 1–3 不修改正式 `RoomQueue`、正式 WebSocket 消息/房间状态、现有 Shikwasa 播放链路、数据库 schema 或正式路由；不把 YouTube 音频字节写入、下载、代理、分离或缓存。
- API Key：只允许存在 POC 服务端环境变量；不得进入前端 bundle、日志或 WebSocket DTO。

### Phase 1 首个原子包的实际落地

- `poc/youtube-fallback/server/index.ts`：固定 `/api/poc/youtube-fallback/*` 前缀；`GET /health` 返回脱敏配置状态；`POST /resolve` 串接 client 与 matcher，并返回结构化解析结果。
- `poc/youtube-fallback/server/types.ts`：固定 POC 的 `TrackIdentity`、YouTube 搜索/详情 DTO、匹配结果、解析请求和 `ResolveResponse` 契约。
- `poc/youtube-fallback/server/youtubeClient.ts`：读取服务端配置并固定 API 基址；请求层只在服务端携带 Key，支持注入 fetch，固定 search 参数与一次批量 videos 请求，并丢弃 API 未返回的 ID。
- `poc/youtube-fallback/server/trackMatcher.ts`：实现进入 POC 的确定性 matcher，并由 `/resolve` 调用。
- `poc/youtube-fallback/fixtures/`：11 条样本，含 5 条中文、5 条非中文、`晴天`、`Love Story`、至少 3 组版本干扰和 1 条负例；正例 videoId 暂不猜测。
- `poc/youtube-fallback/tests/fixtureSchema.test.ts`：验证固定测试集结构和关键约束。
- `poc/youtube-fallback/tests/youtubeClient.test.ts`：验证查询、批量调用、参数、API Key 边界、schema 拒绝、时长解析和超时。
- `poc/youtube-fallback/tests/trackMatcher.test.ts`：验证标准化、版本冲突、官方包装词、过滤条件、14.999/15/15.001 秒边界、短标题、排序和歧义。
- `poc/youtube-fallback/tests/resolve.test.ts`：通过临时 HTTP 端口验证匹配、请求校验、空搜索、候选详情缺失、未配置 Key 和暂时不可用错误映射。
- `poc/youtube-fallback/tests/liveFixtureReport.ts`：使用真实服务端 Key 时逐首输出候选、videoId/失败码、reasons、API 调用次数和 `humanReview: pending`；无 Key 时明确失败，不生成伪结果。
- `poc/youtube-fallback/web/`：独立同源手工验证页，不被正式 Vite 入口引用；显示候选过滤决策并承载可见 YouTube IFrame 控制和事件日志。
- `docs/plans/youtube-fallback-phase1-report.md`：Phase 1 验收矩阵、11 首样本记录和未通过证据清单。

## 关键设计决策

- 解析顺序固定为 `Direct source > YouTube fallback > 明确失败`；服务端是唯一搜索和匹配端。
- 第一阶段必须先证明“元数据 → search.list → videos.list → 确定性 matcher → 可见 IFrame”闭环，宁缺毋滥，歧义返回 `null`。
- 当前正式播放器仍是 Shikwasa2，不把它假设成原生 `<audio>`；正式 adapter 迁移留到 Phase 3。
- 首页/创建页升级是独立 Agent 的工作包；本 Phase 不修改 `src/pages/IndexPage/**`、`src/pages/CreatePage/**` 或共享前端文件。
- 并行开发前必须由用户决定共同 `BASE_SHA`；当前脏工作树不能默认作为两个实现 Agent 的基线。
- YouTube fallback 当前为独立冻结候选；QQ音乐、网易云音乐、平台扫码登录、本地音频及前端升级均不得依赖 YouTube 模块或把其他任务授权解释为恢复本方案。

## 关键命令与结果

### 环境

- `node --version` → `v24.14.0`。
- `pnpm --version` → `11.3.0`。
- 项目声明：根 `package.json` 要求 Node `18.x`；服务端要求 Node `>=18`。

### 构建

- `pnpm build`：未进入项目脚本；pnpm 11 判定现有锁文件与当前 pnpm 不兼容，并因无 TTY 拒绝清理 `node_modules`（环境限制，未清理或重装依赖）。
- `pnpm --dir server build`：同样受 pnpm 依赖/锁文件检查环境影响；未作为通过证据。
- `node_modules/.bin/tsc.cmd --noEmit` → 通过。
- `node_modules/.bin/vite.cmd build` → 通过；Vite 记录既有 `fs/path` externalize、`eval` 和 chunk 大小警告。
- `server/node_modules/.bin/tsc.cmd -p tsconfig.json` → 通过。

### 工作区副产物

pnpm 失败尝试曾生成 `server/pnpm-lock.yaml` 与 `server/pnpm-workspace.yaml`；已确认它们为本轮环境副产物并精确移除。当前新增的本任务文件为 `docs/plans/youtube-fallback-progress.md` 和 `poc/youtube-fallback/**`；编译生成的 `poc/youtube-fallback/dist/` 被全局 `dist` 规则忽略。

## 验证状态

- 前端 TypeScript：通过。
- 前端生产构建：通过（带既有警告）。
- 服务端 TypeScript：通过。
- POC TypeScript：`node_modules/.bin/tsc.cmd -p poc/youtube-fallback/tsconfig.json` 通过。
- POC fixture 测试：`node poc/youtube-fallback/dist/tests/fixtureSchema.test.js` 通过，输出 `fixture schema ok: 11 tracks`。
- POC YouTube client 测试：`node poc/youtube-fallback/dist/tests/youtubeClient.test.js` 通过，覆盖 query、批量详情、runtime schema、时长边界、配置错误和超时。
- POC matcher 测试：`node poc/youtube-fallback/dist/tests/trackMatcher.test.js` 通过，覆盖 normalize、版本冲突、硬过滤、时长边界、排序和歧义。
- POC resolve 集成测试：`node poc/youtube-fallback/dist/tests/resolve.test.js` 通过，覆盖匹配、请求校验、空搜索、候选详情缺失、未配置 Key 和暂时不可用错误映射。
- POC resolve 集成测试新增覆盖：候选 `selected/rejected` 决策、reasons，以及 `/`、`/main.js`、`/poc.css` 同源静态资源。
- POC 临时 HTTP 端口验证：health、resolve 与手工页面静态资源均返回预期结果；未启动常驻后台进程。
- live fixture report：已使用服务端环境配置真实执行两轮；每首仍保持一次 `search.list` 与一次批量 `videos.list`，Key 未进入输出。
- 《晴天》修正后真实单条复测：选择 `DYptgVvkVLQ`（官方 MV，319 秒），reasons 包含 `OFFICIAL_MV_DURATION_TOLERANCE` 和 `OFFICIAL_MV_CHANNEL_ARTIST_HEURISTIC`；备用队列包含 `3-DteAHyRnI`。
- 浏览器运行时错误分类测试：通过，覆盖 `100/101/150` 上报判定，并排除 `153` 等非播放源失效错误。
- 运行时服务端协调测试：通过，覆盖官方来源优先 failover、过期/错位上报拒绝、候选耗尽、地区隔离、24 小时失败 TTL 和重新解析过滤。
- 修正后完整 11 首真实回归：7 matched、3 safe no_match、1 次临时上游 502；`演员` 定向重试后成功命中官方 MV。每首仍最多 1 次 search + 1 次 videos。
- 正式前端 TypeScript、正式前端 Vite 生产构建、正式服务端 TypeScript 本轮重新验证通过；Vite 仍只有既有 externalize/eval/chunk 警告。
- 正式功能行为：未改动；真实 YouTube Data API 已验证，浏览器 IFrame 首轮发现 `ERROR(150)` 并完成修正，等待复测。
- RoomQueue、WebSocket、播放器核心、数据库：本 Phase 均未修改。

## 基线脏工作区与本任务 diff 区分

- 用户既有改动：`D docs/superpowers/specs/2026-07-06-qq-music-owner-qr-login-design.md`，保留，不纳入 YouTube fallback 交付。
- 本任务改动：新增 `docs/plans/youtube-fallback-progress.md`、`docs/plans/youtube-fallback-phase1-report.md` 和 `poc/youtube-fallback/**`；编译产物被忽略。
- 正式源代码、配置、锁文件、队列、协议、播放器或数据库仍未修改。

## 当前阻塞与残余风险

- Node/pnpm 与现有锁文件不匹配；本原子包使用已存在的 `tsc` 直接编译，没有改锁文件。进入真实 API 请求前仍需确定项目兼容的 Node 18/pnpm 版本或继续采用不改锁文件的等价验证方式。
- 并行 Agent 尚未创建 worktree/分支/PR；需先由用户决定保留、提交、丢弃或绕开当前 `main` 的超前提交与删除改动，并确认共同 `BASE_SHA`。
- Data API 的 `status.embeddable=true` 不能完全预测 IFrame 运行时结果；必须保留 `101/150` 运行时拒绝和候选切换，且正式房间同步接入时需由服务端协调最终候选。
- Phase 1 Functional Gate 仍缺少修正后的浏览器证据：官方 MV/备用候选的实际播放，以及 play/pause/seek/currentTime/ended/error/autoplay 恢复记录。因此不能进入 Phase 2。

## 恢复后的第一个动作

用户在 `http://127.0.0.1:4178/` 强制刷新后输入 `Love Story / Taylor Swift / 236000ms`，应选择 Topic 原版 `CxcEqhy4yKg`。验证实际播放、play/pause/seek/currentTime/ended/autoplay 恢复；若返回 `100/101/150`，确认日志出现 `SERVER_SELECTED_NEXT_CANDIDATE(...)` 且服务端决定下一候选。全部通过后才能把 Phase 1 Functional Gate 标为 PASS。

## 停工信息

- 本次停工触发原因：`PHASE_IMPLEMENTATION_BOUNDARY_AND_CONTEXT_BUDGET`。
- 当前状态：`PHASE_1_IFRAME_MANUAL_RETEST`。
- 继续授权：本轮已授权完成 Phase 1 剩余实现；下一步外部验收仍等待用户压缩后再次确认。
- Phase 1 Functional Gate 状态为 `PENDING_IFRAME_MANUAL_RETEST`；未进入 Phase 2，未部署、发布、推送或创建 PR。
