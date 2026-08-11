# YouTube Data API + IFrame Player 会员歌曲 Fallback 开发设计

> 文档状态：保留的独立候选设计（当前冻结；不得因其他音乐平台工作而自动恢复）  
> 目标读者：负责实现的开发 Agent  
> 已核对技术上下文：React 18 + Vite 前端、Shikwasa2 现有播放器、Node.js/Express/TypeScript 后端、RoomQueue、WebSocket 房间同步  
> 外部约束核对日期：2026-08-10  
> 核心边界：Phase 1 必须是独立 POC；POC 验收通过前，禁止修改正式 `RoomQueue`、正式 WebSocket 协议及现有播放链路。
> 上下文硬门禁：任一开发会话在约 30% 时开始收束、最迟 40% 强制停工，并必须始终低于 60% 绝对上限；到达停工线或完成任一 Phase 时，必须写入恢复检查点、停止工作，等待用户主动压缩上下文并明确同意继续。
> 隔离声明：本设计只描述 YouTube fallback，不属于 QQ音乐、网易云音乐或其他平台登录/授权设计的前置条件；未来可整份停用或废弃，不得要求其他方案随之修改。

## 1. 执行摘要

当前音乐平台仍负责提供“用户想听哪一首歌”的身份信息；当原平台无法提供可播放 `audioUrl` 时，由服务端使用 YouTube Data API 搜索同一首歌，经过确定性 `TrackMatcher` 筛选后得到 `videoId`，再由前端通过官方、可见的 YouTube IFrame Player 播放。

本方案不提取 YouTube 音频流，不下载或缓存媒体，不绕过原平台会员鉴权、DRM、地区限制或 YouTube 播放限制。

本方案当前只作为独立候选保留。QQ音乐/网易云音乐扫码登录、官方 API 接入、本地音频、直连音频和前端页面升级均可在不启用、不实现、不引用本方案的情况下独立设计、开发和发布。除非用户明确点名恢复 YouTube fallback 的具体 Phase，否则其他任务中的“继续开发”“平台登录”或“播放方案”均不构成恢复授权。

目标架构为：

```text
Origin Music Provider
        │
        ├─ metadata ───────────────> TrackIdentity
        │                                  │
        └─ direct audioUrl                  │
              │                            ▼
              │                    PlaybackResolver
              │                     /            \
              │              direct available   direct unavailable
              │                     │                   │
              ▼                     ▼                   ▼
        DirectPlaybackSource <──────┘       YouTubeFallbackResolver
                                                     │
                                      search.list → videos.list
                                                     │
                                               TrackMatcher
                                                     │
                                                     ▼
                                          YouTubePlaybackSource
                                                     │
                 ┌───────────────────────────────────┘
                 ▼
              QueueItem
                 │
                 ▼
            PlayerManager
             /          \
            ▼            ▼
   HtmlAudioAdapter   YouTubeIframeAdapter
```

最重要的数据建模原则：

```text
TrackIdentity       = 用户想听什么
PlaybackSource      = 当前从哪里、以什么播放器播放
QueueItem           = 房间队列中的歌曲身份 + 已解析播放源
```

不得继续把 `Track`、`audioUrl` 和“歌曲本身”视为同一个概念。

## 2. 项目背景与问题定义

项目已能从网易云、腾讯、酷狗、酷我、百度等平台获取歌曲或歌单信息，并把歌曲加入房间队列。问题发生在受限或会员歌曲：

```text
成功获取 title / artist / album / duration
                    │
                    ▼
         原平台不返回可用 audioUrl
                    │
                    ▼
              当前播放失败
```

本设计把问题改写为：

> 已知可靠的歌曲身份信息时，能否找到一个允许网页嵌入、版本匹配可信的 YouTube 视频，并使用官方 IFrame Player 接入现有播放器及房间同步模型？

## 3. 已确认前提、假设与完成标准

### 3.1 已确认前提

- 原音乐平台通常能为受限歌曲提供 `title`、`artist`，并可能提供 `album`、`duration`、`ISRC`。
- YouTube Data API 的 `search.list` 可按关键词搜索视频，并用 `type=video`、`videoEmbeddable=true`、`videoSyndicated=true` 限定候选。
- `videos.list` 可批量返回候选时长、嵌入状态、Made for Kids 状态和地区限制等信息。
- YouTube IFrame Player API 支持加载、播放、暂停、跳转、读取时间、状态事件、错误事件和自动播放受阻事件。

### 3.2 实现假设

- 已确认正式项目为 React 18 + Vite 前端、Node.js/Express/TypeScript 后端；原文中的 Vue 假设已作废。
- 现有前端播放器由 `src/hooks/useAudioPlayer.ts` 包装 Shikwasa2；`PlayerAdapter` 接入必须保留现有 Shikwasa 行为，而不是假设当前直接使用原生 `<audio>`。
- 当前没有 shared package，`QueueItem`/`RoomQueue`/WebSocket DTO 分别存在于 `server/src/types.ts` 与 `src/types/index.ts`。正式接入前必须决定单一权威定义及兼容同步方式，但不得为此做无关的仓库重构。
- 服务端是匹配和解析的唯一权威端；客户端不得各自搜索 YouTube，否则同一房间可能得到不同 `videoId`。
- 现有队列、播放状态、持久化和 WebSocket 的已知入口包括 `server/src/queueService.ts`、`server/src/playbackService.ts`、`server/src/websocket.ts`、`server/src/db/postgres/roomRepository.ts`、`src/hooks/useRoomPage.ts` 与 `src/hooks/useAudioPlayer.ts`；其余行为必须在 Phase 4 前继续调查，不允许凭假设直接重构。
- 原平台直连播放仍为第一优先级；YouTube 只在原播放源不可用时启用。

### 3.3 总体完成标准

以下条件全部满足才算方案完成：

- 独立 POC 证明“元数据 → 搜索 → 匹配 → IFrame 播放”可用。
- 不确定或版本冲突的候选返回 `null`，不自动播放明显错误版本。
- 直连歌曲行为不回归。
- 同一房间的客户端使用同一个服务端解析出的 `videoId`。
- YouTube 播放器可见、来源明确，自动播放受阻时有用户可操作的恢复路径。
- 相关单元测试、集成测试和双浏览器同步验收通过。
- 不包含本文“禁止事项”中的实现。
- 每个 Phase 的验证、diff 自审、恢复检查点和人工上下文 Gate 均已完成；没有跨 Gate 连续开发。

### 3.4 上下文预算、人工压缩与恢复协议

本协议是开发约束，与功能验收同等强制。Agent 不得主动执行、假定或声称已经完成上下文压缩；只有用户能够主动压缩上下文并授权继续。

#### 预算阈值

| 阈值 | 必须执行的动作 |
|---|---|
| `< 30%` | 可在当前原子工作包内继续；开始高输出调查、批量读文件或测试前再次评估。 |
| `>= 30%` | 进入收束区：不得扩展范围或开始新的非必要工作包；优先完成当前原子改动、验证、diff 自审和检查点。 |
| `>= 40%`，或预计下一次工具输出/实现会逼近该值 | 立即进入停工流程，不再读取大文件、不再开始新改动；只允许完成安全收尾、记录状态和回复用户。 |
| `>= 60%` | 绝对禁止发生。若上下文百分比不可直接观测，必须使用上述 30%/40% 保守阈值和工作包大小控制，不以“无法精确测量”为理由继续。 |

#### 强制停工条件

满足任一条件都必须停止：

- 任一 Phase 的验收、验证与 diff 自审已经完成。
- 上下文达到 40% 停工线，或继续一次工具调用/实现很可能超过停工线。
- 当前工作包预计无法在 40% 停工线前完成验证和交接；应提前缩小工作包并生成中途检查点。
- 发现需要改变公共接口、迁移数据、新增生产依赖、部署/发布或扩大权限，且尚未取得用户授权。

停工时必须：

1. 将当前状态写入仓库内 `docs/plans/youtube-fallback-progress.md`；首次进入 Phase 0 时创建该文件。
2. 完成当前可安全完成的最小验证与 diff 自审；不得为了“凑齐 Phase”冒险越过预算。
3. 向用户交付本轮结果，明确状态为 `WAITING_FOR_USER_COMPRESSION`。
4. 完全停止后续开发，等待用户主动压缩上下文并明确回复“已压缩，可以继续”或同等语义。

#### 恢复检查点必备内容

`docs/plans/youtube-fallback-progress.md` 每次必须覆盖更新以下信息：

```text
最终目标：
当前 Phase / 原子工作包：
状态：IN_PROGRESS | PHASE_COMPLETE | WAITING_FOR_USER_COMPRESSION
已完成事项：
修改文件：
关键设计决策：
关键命令与结果：
验证状态：
基线脏工作区与本任务 diff 区分：
当前阻塞与残余风险：
恢复后的第一个动作：
本次停工触发原因：PHASE_GATE | CONTEXT_BUDGET | AUTHORIZATION_REQUIRED
继续授权：NOT_GRANTED
```

#### 压缩后恢复流程

用户授权继续后，Agent 必须先执行以下动作，再恢复开发：

1. 完整读取本文档、`docs/plans/youtube-fallback-progress.md`、当前 `git status` 和本任务 diff。
2. 核对当前分支/HEAD、用户原有脏改动、已完成验证和第一个未完成事项。
3. 用简短回复报告恢复到的 Phase、已完成边界和本轮目标；若检查点与仓库事实冲突，以仓库事实为准并先报告冲突。
4. 仅从检查点记录的第一个未完成原子工作包继续，不重复已经有可信验证证据的工作。
5. 将 `继续授权` 更新为本轮授权依据；下一次停工时重新置为 `NOT_GRANTED`。

即使 Phase 结束时上下文仍低于 30%，也必须执行 Phase Gate 并等待用户主动压缩与授权；上下文余量不是跨 Phase 连续开发的许可。

### 3.5 并行 Agent、PR 与集成协议

本项目允许与“首页/创建页前端升级”并行开发，但两个实现 Agent 不得共享工作目录，也不得直接在同一个未提交工作树中改动。推荐角色如下：

| 角色 | 分支建议 | 主要所有权 | 禁止越界 |
|---|---|---|---|
| Agent A：YouTube fallback | `codex/youtube-fallback` | `poc/youtube-fallback/**`、Phase 2 的 `server/src/music/playback/**` 与 `server/src/music/youtube/**`、本任务测试和进度文档 | Phase 1–2 不修改正式首页、创建页、RoomQueue、WebSocket 或现有播放器 |
| Agent B：首页升级 | `codex/frontend-home-refresh` | `src/pages/IndexPage/**`、`src/pages/CreatePage/**` 及明确归属于这两个页面的局部组件/资源 | 不修改 fallback、正式房间同步、服务端解析和播放器核心 |
| Agent C：集成 | `codex/integrate-youtube-ui` | 合并两个组件分支、处理共享文件、运行跨功能验证和生成最终 PR | 不擅自重写已经通过组件 PR 验收的业务逻辑 |

#### 共同基线

1. 启动并行开发前先 `git fetch origin`，记录一个不可变的 `BASE_SHA`；两个实现分支和集成分支必须从同一 SHA 创建。
2. 不得默认使用当前脏工作树作为基线。规划时本地 `main` 位于 `5c910c7d77375900295b827fe93d78ede2aeab9b`，比 `origin/main` 超前一个仅新增设计文档的提交，同时工作树又删除了该文档；该状态必须由用户决定保留、提交、丢弃或绕开，Agent 不得代替用户处理。
3. 推荐在不触碰当前脏工作树的前提下，从用户确认的远端基线创建三个独立 worktree；任何 Agent 都不得复用另一个 Agent 的 worktree。
4. 每个组件 PR 必须记录 `BASE_SHA`、分支 tip SHA、修改文件清单和验证结果，方便集成 Agent 证明输入没有漂移。

#### 共享文件所有权

以下文件容易产生跨项目冲突，默认冻结，由集成 Agent 修改；实现 Agent 如确有必要，必须先在 PR 说明原因和期望改动：

```text
package.json
pnpm-lock.yaml
src/App.tsx
src/router/index.tsx
src/styles/style.css
src/styles/theme.css
src/components/PtButton.tsx
```

首页升级应优先使用页面局部 CSS、局部组件和局部资源，避免为了视觉调整重写全局主题。YouTube fallback 的 Phase 1–2 不应需要修改上述前端共享文件。

#### PR 与集成顺序

1. 先创建远端集成分支 `codex/integrate-youtube-ui`，基于共同 `BASE_SHA`。
2. Agent A、Agent B 分别推送自己的分支并创建以集成分支为 base 的组件 PR；组件 PR 只证明本功能独立正确，不直接部署。
3. Agent C 逐一合入两个组件 PR；若共享文件或行为冲突，保留两边原始提交，在独立集成提交中解决，不回写或静默改写任一组件分支历史。
4. Agent C 运行前端构建、服务端构建、组件测试、关键页面人工验收以及 YouTube/direct 播放回归。
5. 集成验证通过后，从 `codex/integrate-youtube-ui` 创建最终 PR 到目标主分支；部署与发布仍需用户单独授权。

#### 前端升级暂定边界

当前截图对应 `/` 首页与 `/create` 创建房间页。Agent B 可以升级信息层级、宽屏布局、视觉对比度、响应式行为和表单交互，但在用户确认视觉方向前不得开始实现，也不得改变创建房间、链接解析、本地文件导入、常驻房间或导航的业务语义。

### 3.6 独立保留、依赖隔离与废弃协议

本设计必须满足“可以保留，也可以整份拔除”的约束：

- YouTube 专属解析、匹配、缓存、指标、路由、环境变量、播放器适配器和测试必须位于 YouTube 专属模块或 POC 目录；不得散落到 QQ音乐、网易云音乐或其他 provider 的实现中。
- 其他平台的登录授权、凭据存储、会员权益、歌曲解析和播放流程不得导入 YouTube 模块，不得依赖 `videoId`、IFrame 状态码、`TrackMatcher` reason 或 YouTube feature flag。
- YouTube 模块可以消费项目既有的 provider-neutral 接口，但不得反向成为这些接口的唯一实现。任何共享领域模型改动都必须先证明在没有 YouTube 的情况下仍有独立价值，并由对应的核心设计或平台设计自行批准。
- `YOUTUBE_FALLBACK_ENABLED=false` 时，不注册 YouTube 路由、不发出 Data API 请求、不加载 IFrame API、不创建 YouTube 播放器、不产生 YouTube 缓存或指标，也不改变 direct source 与平台登录流程的结果。
- YouTube 失败、配额耗尽、API Key 缺失或全部候选不可嵌入，只能产生 YouTube 专属的可诊断失败；不得阻塞 direct source、本地音频、平台官方播放或平台扫码登录。
- 其他设计文档不得通过本设计顺带整改。若其他方案需要 `TrackIdentity`、`PlaybackSource` 或 `PlayerAdapter`，应在其自己的设计中重新确认范围和所有权，不能仅引用本文作为实施授权。
- 当前状态为 `FROZEN_STANDALONE_DESIGN`。只有用户明确说出恢复 YouTube fallback 并指定继续的 Phase，才允许把状态改回开发中。

未来决定废弃时，按以下顺序执行，且不得连带删除其他平台能力：

1. 保持 feature flag 关闭，确认生产流量和持久化数据均不依赖 YouTube source。
2. 删除 YouTube 专属路由、Resolver、Matcher、缓存、指标、环境变量、IFrame adapter、依赖和测试。
3. 对历史 `youtube` QueueItem 采用明确“不再支持/在 YouTube 打开”的兼容结果；不得通过删除整个队列或迁移其他 provider 数据来清理。
4. 仅当某个共享字段被证明没有任何非 YouTube 消费者时，才单独提案移除；否则保留共享字段。
5. 运行 direct source、本地音频、QQ音乐、网易云音乐、房间队列、WebSocket 和前端构建回归，证明废弃 YouTube 不影响其他设计。
6. 将本文状态改为 `RETIRED` 或归档；不得把“废弃本文”解释为废弃其他音乐平台方案。

## 4. 目标与非目标

### 4.1 目标

- 建立与原平台解耦的 `TrackIdentity`。
- 建立可扩展的 `PlaybackSource` 联合类型。
- 服务端使用 YouTube Data API 搜索和验证候选。
- 使用确定性、可解释、可测试的 `TrackMatcher`。
- 使用官方 YouTube IFrame Player 实现统一 `PlayerAdapter`。
- 通过 `PlayerManager` 在原 HTML Audio 与 YouTube 播放器之间切换。
- POC 通过后，以向后兼容方式接入 RoomQueue 和 WebSocket。
- 加入配额保护、请求去重、缓存、超时、错误分类和可观测性。

### 4.2 非目标

- 绕过任意平台会员鉴权、付费限制或 DRM。
- 从 YouTube 提取、分离、代理、下载或转码音频/视频。
- 使用 `yt-dlp`、Piped、NewPipe、非官方解析接口或 YouTube 网页抓取。
- 把 YouTube IFrame 隐藏成后台纯音频播放器。
- 第一阶段重构正式播放器、正式 RoomQueue 或 WebSocket。
- 第一版引入 AI/LLM 匹配器、向量数据库或不可解释的复杂模型。
- 第一版接入歌曲宝、GD 音乐台或其他未确认公开 API 的第三方站点。
- 把所有歌曲都改为 YouTube 播放；原平台可用时继续走现有直连链路。
- 把 YouTube fallback 作为平台扫码登录、官方 API 接入、前端升级或其他播放方案的共同基础。
- 为了接入或废弃 YouTube，顺带修改其他独立设计文档或扩大其范围。

## 5. 合规与产品约束

开发 Agent 必须把以下内容当作实现约束，而不是建议：

- YouTube 播放必须使用官方 IFrame Player。
- 播放器 viewport 至少为 `200 × 200`；16:9 建议至少 `480 × 270`。
- 播放器必须显示在用户当前查看的页面、标签页或屏幕内，不得作为隐藏或后台播放器。
- 不得遮挡、覆盖、改造或屏蔽 YouTube Player 的控件、品牌、链接或广告。
- 不得分离、提取、推广或缓存 YouTube 视听内容中的独立音频部分。
- 自动播放前，播放器必须可见且在页面/屏幕中超过一半可见；同一页面不得同时自动播放多个 YouTube Player。
- UI 必须明确显示“播放来源：YouTube”，并保留可见的官方播放器。
- API Key 只存在服务端环境变量中，不得写入前端 bundle、仓库、日志或 WebSocket 消息。
- 必须检查嵌入视频的 Made for Kids 状态。v0.1 直接排除 `madeForKids === true`；后续如要支持，必须另做隐私与数据收集评审。
- 不得绕过地区限制；配置的播放地区不允许时，候选必须排除。

官方参考见文末“外部参考”。政策会变化，上线前必须重新核对。

## 6. 核心领域模型

建议把领域类型放在前后端共享包中；若当前仓库没有 shared package，可先在服务端定义 canonical 类型，再由协议 schema 生成或复用前端类型，避免手工维护两份不一致定义。

### 6.1 TrackIdentity

```ts
export type OriginProvider =
  | "netease"
  | "tencent"
  | "kugou"
  | "kuwo"
  | "baidu"
  | "local"
  | "unknown";

export interface TrackIdentity {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;

  origin: {
    provider: OriginProvider;
    resourceId: string;
  };
}
```

约束：

- `title` 去除首尾空白后不能为空。
- `artists` 至少包含一个非空字符串；来源确实缺失时才允许使用明确的 `unknown` 迁移策略，不得把空字符串当歌手。
- `durationMs` 必须是正整数；非法值转为 `undefined`，不得参与匹配。
- `origin.resourceId` 是原音乐平台资源 ID，不得写入 YouTube `videoId`。
- `isrc` 目前只作为额外身份信息保留；YouTube 搜索结果不保证有 ISRC，不作为 v0.1 必需字段。

### 6.2 PlaybackSource

```ts
export type PlaybackSource =
  | DirectPlaybackSource
  | YouTubePlaybackSource;

export interface DirectPlaybackSource {
  type: "direct";
  url: string;
  expiresAt?: number;
}

export interface YouTubePlaybackSource {
  type: "youtube";
  videoId: string;
  resolvedAt: number;
  cacheExpiresAt: number;
  match: {
    query: string;
    matchedTitle: string;
    matchedChannelTitle: string;
    durationMs: number;
    reasons: string[];
  };
}
```

说明：

- `resolvedAt` 与 `cacheExpiresAt` 使用 Unix epoch milliseconds。
- `match` 用于调试和人工核验，不在 UI 中伪装成 YouTube 官方指标。
- 若正式队列不需要完整匹配详情，可在 WebSocket DTO 中只发送必要字段，但服务端应保留结构化日志。
- `videoId` 只能来自 Data API 响应，进入类型前必须通过格式及存在性校验。

### 6.3 QueueItem

正式接入时采用增量兼容，不在同一阶段删除旧字段：

```ts
export interface QueueItem {
  id: string;

  title: string;
  artist: string;
  imageUrl?: string;
  linkUrl?: string;
  sourceType: string;
  resourceId?: string;

  // 旧结构：迁移期保留。
  audioUrl?: string;

  // 新结构：歌曲身份与播放源解耦。
  track?: TrackIdentity;
  playback?: PlaybackSource;
}
```

兼容读取规则：

```ts
function getPlaybackSource(item: QueueItem): PlaybackSource | null {
  if (item.playback) return item.playback;
  if (item.audioUrl) return { type: "direct", url: item.audioUrl };
  return null;
}
```

写入规则：

- 新写入的直连歌曲同时填充 `playback.type = "direct"`；迁移期是否继续填 `audioUrl` 由现有持久化兼容性决定。
- YouTube fallback 歌曲必须填 `track` 和 `playback.type = "youtube"`，不得伪造 `audioUrl`。
- RoomQueue 只保存队列状态和播放源描述，不保存播放器实例或 IFrame 状态。

## 7. 后端解析架构

### 7.1 唯一入口

```ts
export interface PlaybackResolver {
  resolve(track: TrackIdentity): Promise<PlaybackSource | null>;
}

export async function resolvePlayback(
  track: TrackIdentity,
): Promise<PlaybackSource | null> {
  const direct = await resolveOriginalProvider(track);

  if (direct) {
    return {
      type: "direct",
      url: direct.url,
      expiresAt: direct.expiresAt,
    };
  }

  return youtubeFallbackResolver.resolve(track);
}
```

约束：

- 原平台解析成功后不得再调用 YouTube。
- 只有明确的“无可播放 URL / VIP / 受限”结果才进入 fallback。
- 原平台暂时性网络错误是否进入 fallback 必须由错误分类决定；默认不把超时等同于 VIP，避免掩盖上游故障。
- Resolver 运行在服务端；前端不得持有 `YOUTUBE_API_KEY`。

### 7.2 YouTubeClient

`YouTubeClient` 只负责 HTTP、鉴权、超时、响应 schema 校验和错误映射，不做歌曲匹配：

```ts
export interface YouTubeClient {
  searchVideos(input: YouTubeSearchInput): Promise<YouTubeSearchHit[]>;
  listVideos(videoIds: string[]): Promise<YouTubeVideoDetails[]>;
}
```

服务端环境变量：

```dotenv
YOUTUBE_API_KEY=replace_me
YOUTUBE_REGION_CODE=HK
YOUTUBE_RELEVANCE_LANGUAGE=zh-Hans
YOUTUBE_SEARCH_MAX_RESULTS=5
YOUTUBE_POSITIVE_CACHE_TTL_SECONDS=604800
YOUTUBE_NEGATIVE_CACHE_TTL_SECONDS=3600
```

要求：

- 启动时验证必需配置；缺 Key 时禁用 fallback 并输出脱敏的结构化错误。
- 生产 API Key 使用 Google Cloud 允许的服务/API 限制；能限制服务端来源时一并限制。
- 单请求超时建议 5 秒；总解析预算建议 8 秒。
- 所有响应先做 runtime schema 校验，再进入 matcher。
- 日志不得包含 API Key、完整请求 URL 中的 `key` 参数或敏感 Header。

## 8. YouTube Data API 请求流程

### 8.1 Step A：构造查询

v0.1 查询格式：

```text
{title} {artist1} {artist2...}
```

示例：

```text
Love Story Taylor Swift
晴天 周杰伦
```

不要默认附加 `official audio`、`lyrics` 等版本词，它们会改变召回结果并引入错误版本。查询前只做安全空白清理，不要把原始版本信息从 `TrackIdentity.title` 中删掉。

为提高音乐候选的可用性，`Official Audio` 与可识别的歌手 `Topic` 频道只在 matcher 排序阶段获得优先级；不得为了该优先级修改上述查询模板。

### 8.2 Step B：search.list

```http
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &type=video
  &q={encoded title + artists}
  &maxResults=10
  &videoEmbeddable=true
  &videoSyndicated=true
  &safeSearch=moderate
  &regionCode={configured region}
  &relevanceLanguage={configured language}
  &key={server-side key}
```

必须参数：

- `part=snippet`
- `type=video`
- `q`
- `maxResults=10`（POC 固定为 10；仍只执行一次搜索）
- `videoEmbeddable=true`
- `videoSyndicated=true`

区域与语言：

- `regionCode` 影响搜索和可播放性判断，必须使用部署配置或房间已确定的地区，不得为了播放而尝试多个地区绕过限制。
- `relevanceLanguage` 只影响相关性，不保证只返回该语言结果。

搜索响应只提取：

```ts
interface YouTubeSearchHit {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
  searchRank: number;
}
```

搜索为空时直接返回 `NO_CANDIDATES`，不要发起 `videos.list`。

### 8.3 Step C：videos.list 批量补全

把最多 10 个 `videoId` 合并为一次请求：

```http
GET https://www.googleapis.com/youtube/v3/videos
  ?part=snippet,contentDetails,status
  &id={id1,...,id10}
  &key={server-side key}
```

提取字段：

```ts
interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  channelTitle: string;
  durationMs: number;
  embeddable: boolean;
  madeForKids?: boolean;
  privacyStatus?: string;
  regionRestriction?: {
    allowed?: string[];
    blocked?: string[];
  };
  searchRank: number;
}
```

处理要求：

- 用可靠 ISO 8601 duration parser 解析 `contentDetails.duration`，禁止手写只支持 `PT#M#S` 的脆弱正则。
- `videos.list` 未返回的 ID 视为已删除、私有或不可获取，直接丢弃。
- 再次检查 `status.embeddable === true`，不能只相信搜索过滤器。
- POC 排除 `madeForKids === true`。
- 按 `regionRestriction.allowed/blocked` 检查配置地区。
- 不请求 `statistics`，不把播放量用于匹配或排序。

### 8.4 Step D：TrackMatcher

所有候选先做硬过滤，再做规则匹配和确定性排序。找不到可信候选时返回 `null`。

## 9. TrackMatcher 规则

### 9.1 设计原则

- 第一版不使用 AI、Embedding 或黑盒浮点分数。
- 每个接受或拒绝结果必须能输出 `reasons`。
- 宁可无匹配，也不播放明显错误的 Live、Cover、Remix、伴奏或重录版。
- 不用 YouTube 播放量、点赞等统计数据派生“可信度”。

### 9.2 标准化

建议函数：

```ts
normalizeText(input: string): string
normalizeTitle(input: string): NormalizedTitle
normalizeArtist(input: string): string
extractVersionTokens(input: string): Set<VersionToken>
```

标准化顺序：

1. 解码 HTML entity。
2. Unicode `NFKC` 归一化。
3. 转小写。
4. 统一全角/半角标点、破折号、引号和空白。
5. 把 `feat.`、`ft.`、`featuring` 统一为同一标记。
6. 去掉不表达版本的包装词，例如 `official video`、`official music video`、`official audio`、`lyrics`、`audio`。
7. 保留表达录音版本的词，不得在比较前删除。

版本词集合至少包括：

```text
live
concert
cover
remix
instrumental
karaoke
acoustic
demo
sped up
slowed
nightcore
reaction
performance
remaster / remastered
taylor's version
radio edit
extended
伴奏
翻唱
现场 / 現場
演唱会 / 演唱會
重制 / 重製
加速
慢速
```

### 9.3 硬过滤

候选满足任意一项即拒绝：

- `embeddable !== true`。
- `madeForKids === true`（v0.1 策略）。
- 当前 `regionCode` 位于 `blocked`，或存在 `allowed` 且不包含当前地区。
- `durationMs <= 0`。
- 标题无法匹配原曲标题。
- 标题与频道名都无法匹配任一原曲歌手。
- 原曲没有某版本词，但候选含 `live/cover/remix/instrumental/...` 等冲突版本词。
- 原曲含版本词，但候选缺少该关键版本词或出现另一冲突版本。
- 原曲有时长且候选时长差绝对值大于 15 秒。

`official video`、`official audio`、`lyrics` 本身不作为冲突版本词；它们可参与最终平局排序，但不得覆盖歌名、歌手、时长或版本冲突。

### 9.4 标题匹配

按以下顺序判断：

1. 标准化后的候选主标题与原曲标题完全相等。
2. 候选标题符合常见的 `artist - title` 或 `title - artist` 结构，拆分后标题部分完全相等。
3. 候选标题包含完整标准化原曲标题，且边界明确、没有冲突版本词。

短标题（例如单字、两个字符或常见词）不得只用无边界 substring 判断；必须同时依赖歌手和时长。

### 9.5 歌手匹配

以下位置任一命中即可：

- 候选标题中的 artist 段。
- 候选完整标题。
- `channelTitle`。

多歌手规则：

- 原曲只有一名歌手：必须命中该歌手。
- 原曲有多名歌手：至少命中主歌手；若标题明确列出合作歌手，优先全部命中者。
- `Various Artists`、`Topic`、`VEVO` 等通用词本身不能替代歌手匹配。

### 9.6 时长匹配

v0.1 固定阈值：

```ts
Math.abs(candidate.durationMs - track.durationMs) <= 15_000
```

若原平台没有时长：

- 仍可展示候选供 POC 人工选择和观察。
- v0.1 默认不做全自动匹配，除非标题和歌手均为无歧义精确匹配且无版本词冲突；该例外必须记录 `DURATION_MISSING_EXACT_IDENTITY` 原因。

### 9.7 确定性排序

通过硬过滤后的候选按以下优先级排序：

1. 标题结构化完全匹配。
2. 所有歌手匹配。
3. 标题明确为 `Official Audio` 且频道匹配主歌手，或频道为“主歌手 - Topic”。
4. 标题明确为 `Official Music Video` 且频道匹配主歌手。
5. 频道名包含歌手。
6. 时长差更小。
7. 其他可信 official 包装信息。
8. 原 `searchRank` 更靠前。

若前两名在上述关键条件上无法拉开差异，返回 `AMBIGUOUS_MATCH`，不得随机选择。

### 9.8 Matcher 输出

```ts
export type TrackMatchResult =
  | {
      kind: "matched";
      candidate: YouTubeVideoDetails;
      reasons: string[];
    }
  | {
      kind: "unmatched";
      code:
        | "NO_CANDIDATES"
        | "NO_TITLE_MATCH"
        | "NO_ARTIST_MATCH"
        | "DURATION_MISMATCH"
        | "VERSION_CONFLICT"
        | "REGION_BLOCKED"
        | "NOT_EMBEDDABLE"
        | "MADE_FOR_KIDS_EXCLUDED"
        | "AMBIGUOUS_MATCH";
      rejected: Array<{
        videoId: string;
        reasons: string[];
      }>;
    };
```

## 10. YouTubeFallbackResolver

```ts
export class YouTubeFallbackResolver {
  constructor(
    private readonly client: YouTubeClient,
    private readonly matcher: TrackMatcher,
    private readonly cache: YouTubeMatchCache,
  ) {}

  async resolve(track: TrackIdentity): Promise<YouTubePlaybackSource | null> {
    // 1. validate track
    // 2. cache lookup + single-flight
    // 3. search.list
    // 4. videos.list
    // 5. matcher
    // 6. positive/negative cache
    // 7. structured result/metrics
  }
}
```

解析行为：

- 相同 cache key 的并发请求合并为 single-flight，避免击穿配额。
- 所有候选拒绝时返回 `null`，同时保留结构化 rejection reason。
- API 配额或认证错误不伪装成“歌曲不存在”。
- 生产接入时，调用方必须能区分 `no_match`、`temporarily_unavailable` 与 `misconfigured`。

## 11. YouTube IFrame Player Adapter

### 11.1 统一接口

```ts
export type UnifiedPlayerState =
  | "idle"
  | "loading"
  | "cued"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "autoplay-blocked"
  | "error";

export interface PlayerLoadOptions {
  startAtSeconds?: number;
  autoplay?: boolean;
}

export interface PlayerAdapter {
  readonly kind: "direct" | "youtube";

  load(source: PlaybackSource, options?: PlayerLoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): UnifiedPlayerState;
  setVolume(volume01: number): void;
  destroy(): void;

  onStateChange(listener: (state: UnifiedPlayerState) => void): () => void;
  onError(listener: (error: PlayerError) => void): () => void;
}
```

`PlayerAdapter.load()` 必须校验 source 类型；`HtmlAudioAdapter` 不接受 YouTube source，`YouTubeIframeAdapter` 不接受 direct source。

### 11.2 IFrame API 加载器

实现全局单例 `loadYouTubeIframeApi()`：

- 页面只插入一次 `https://www.youtube.com/iframe_api`。
- 多个调用者共享同一个 Promise。
- 兼容页面已有的 `window.onYouTubeIframeAPIReady`，不得静默覆盖其他 handler。
- 设置加载超时并映射为 `IFRAME_API_LOAD_TIMEOUT`。
- 组件卸载只销毁 `YT.Player`，不重复删除并注入全局脚本。

### 11.3 YT.Player 初始化

建议参数：

```ts
new YT.Player(container, {
  width: "100%",
  height: "100%",
  playerVars: {
    playsinline: 1,
    controls: 1,
    rel: 0,
    origin: window.location.origin,
  },
  events: {
    onReady,
    onStateChange,
    onError,
    onAutoplayBlocked,
  },
});
```

注意：

- `controls=1` 保留官方控件。
- 容器不得 `display:none`、`visibility:hidden`、`opacity:0`、移出可视区或缩成小于最小尺寸。
- 不得在播放器上方放遮罩拦截交互。
- `rel=0` 不等于完全禁用相关视频，不能依赖它实现产品保证。

### 11.4 命令映射

```text
load(autoplay=false)  → cueVideoById({ videoId, startSeconds })
load(autoplay=true)   → loadVideoById({ videoId, startSeconds })
play                  → playVideo()
pause                 → pauseVideo()
seek                  → seekTo(seconds, true)
getCurrentTime        → getCurrentTime()
getDuration           → getDuration()
setVolume(0..1)       → setVolume(0..100)
destroy               → destroy()
```

`getDuration()` 在元数据加载前可能返回 `0`，调用方不能把 `0` 当真实时长。

### 11.5 状态映射

```text
YT -1 UNSTARTED  → loading/idle（按当前 load generation 判断）
YT  0 ENDED      → ended
YT  1 PLAYING    → playing
YT  2 PAUSED     → paused
YT  3 BUFFERING  → buffering
YT  5 CUED       → cued
```

IFrame API 没有持续 `timeupdate` 事件。仅在播放期间由 `PlayerManager` 每 250–500ms 轮询本地时间用于 UI；不得把每次轮询都发送到 WebSocket。

### 11.6 IFrame 错误映射

```text
2    → INVALID_VIDEO_ID
5    → HTML5_PLAYER_ERROR
100  → VIDEO_NOT_FOUND_OR_PRIVATE
101  → EMBEDDING_NOT_ALLOWED
150  → EMBEDDING_NOT_ALLOWED
153  → CLIENT_IDENTITY_MISSING
```

`100/101/150` 应立即使对应正缓存失效，并向服务端报告“该播放源已失效”；不得在客户端自行搜索或自行决定替代视频。Phase 1 POC 使用短期解析会话，由服务端在已经返回的 eligible 候选中选择下一项，不增加 Data API 请求。

## 12. PlayerManager

`PlayerManager` 是 UI、房间同步与具体播放器之间的唯一协调层。

职责：

- 根据 `playback.type` 选择 adapter。
- 切换 source 前暂停旧 adapter，保证同一时刻只有一个播放器出声。
- 使用单调递增 `loadGeneration` 忽略旧异步 load 和旧播放器事件。
- 统一播放、暂停、seek、音量、状态、错误和 autoplay-blocked 行为。
- 把远端同步命令与本地用户操作区分开，防止 WebSocket 事件回环。
- 管理短时漂移修正，但不通过调整 YouTube 播放速度做默认同步。

建议状态：

```ts
interface PlayerManagerState {
  activeKind: "direct" | "youtube" | null;
  itemId: string | null;
  sourceFingerprint: string | null;
  loadGeneration: number;
  state: UnifiedPlayerState;
  autoplayBlocked: boolean;
  lastError?: PlayerError;
}
```

source fingerprint：

```text
direct:{stable hash of url identity}
youtube:{videoId}
```

不得把含签名或 token 的完整 direct URL 写进日志或 WebSocket 调试字段。

切换算法：

1. 增加 `loadGeneration`。
2. 暂停当前 adapter。
3. 清理当前 adapter 的 item 级监听。
4. 选择目标 adapter。
5. 加载 source；回调必须核对 generation。
6. 根据房间权威状态决定 cue、seek、play 或 pause。
7. 成功后才发布本地 ready 状态。

## 13. Autoplay 设计

自动播放不是可靠能力，尤其是未经过用户交互的有声 IFrame。

### 13.1 POC 策略

- 页面提供明确的“启用并开始播放”按钮，第一次播放由用户点击触发。
- 仍监听 `onAutoplayBlocked`，验证阻塞路径。
- 阻塞后 UI 显示“点击继续播放”，不得无限重试 `playVideo()`。

### 13.2 房间策略

远端房主开始播放时，新加入或尚未与页面交互的听众可能被浏览器阻止自动播放：

1. 客户端进入 `autoplay-blocked`。
2. 显示本地提示，不把它广播成房间全局暂停。
3. 用户点击后，按当前服务端权威时间重新计算目标 position。
4. `seekTo(targetPosition)` 后再 `playVideo()`。

禁止方案：

- 静音并隐藏播放器来规避政策。
- 自动模拟点击。
- 高频循环调用 `playVideo()`。
- 因单个客户端 autoplay blocked 而暂停整个房间。

## 14. RoomQueue 与 WebSocket 同步

> 本节只允许在 Phase 4 实施。Phase 1–3 不得改正式 RoomQueue/WebSocket。

### 14.1 权威模型

- 服务端是 QueueItem、当前 item、播放状态和时钟的权威来源。
- YouTube fallback 在服务端解析一次，得到确定 `videoId` 后随 QueueItem/状态广播。
- 所有客户端加载同一 `videoId`；客户端不得重新 matcher。
- 继续沿用现有房主/权限/冲突解决规则，不在本任务中重新定义房间治理。

### 14.2 建议播放状态 DTO

若现有协议字段不同，保持现有命名并补齐等价语义：

```ts
interface RoomPlaybackState {
  revision: number;
  itemId: string;
  source: PlaybackSource;
  status: "playing" | "paused";
  positionSeconds: number;
  changedAtServerMs: number;
}
```

客户端收到 `playing` 时：

```ts
const networkAdjustedPosition =
  state.positionSeconds +
  (estimatedServerNowMs - state.changedAtServerMs) / 1000;
```

客户端收到 `paused` 时直接使用 `positionSeconds`。

### 14.3 命令与事件

推荐语义：

```text
Client → Server
PLAY_REQUEST
PAUSE_REQUEST
SEEK_REQUEST
NEXT_REQUEST
SOURCE_FAILED

Server → Clients
ROOM_PLAYBACK_STATE
QUEUE_UPDATED
PLAYBACK_SOURCE_UPDATED
```

所有消息至少带：

- `roomId`
- `itemId`
- `revision` 或有序序号
- 发起端/命令 ID（用于去重和防回环）

### 14.4 漂移与事件回环

- 本地 adapter 状态变化不自动等同于用户命令。
- 应使用 `commandOrigin: local | remote | adapter` 或 suppress guard，防止“远端 pause → 本地 pause event → 再发 pause”。
- 正常播放时不广播 250–500ms 本地轮询。
- 沿用现有同步周期；若需要校时，建议服务端低频快照而非媒体时间洪泛。
- 漂移小于项目既有容差时不处理；超过容差再 seek。没有既有标准时，Phase 4 先用 1.5 秒作为实验阈值并记录实测结果。
- `ended` 只由有权限/权威的一侧触发切歌；不得让所有客户端同时推进队列。

### 14.5 播放源失效

客户端遇到 IFrame `100/101/150`：

1. 上报 `SOURCE_FAILED(itemId, videoId, errorCode)`。
2. 服务端验证 item/revision，避免旧错误污染新 source。
3. 使匹配缓存失效。
4. 是否重新 resolve 由服务端决定，并限制最多一次自动重解析。
5. 若得到新 `videoId`，增加 revision 并广播 `PLAYBACK_SOURCE_UPDATED`。
6. 若仍失败，进入可见错误状态并按现有规则跳过或等待用户操作。

## 15. 错误处理

### 15.1 错误分类

```ts
type PlaybackResolutionErrorCode =
  | "YOUTUBE_DISABLED"
  | "YOUTUBE_API_KEY_MISSING"
  | "YOUTUBE_AUTH_FAILED"
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "YOUTUBE_RATE_LIMITED"
  | "YOUTUBE_TIMEOUT"
  | "YOUTUBE_UPSTREAM_ERROR"
  | "YOUTUBE_RESPONSE_INVALID"
  | "NO_MATCH"
  | "AUTOPLAY_BLOCKED"
  | "IFRAME_API_LOAD_FAILED"
  | "VIDEO_UNAVAILABLE"
  | "EMBEDDING_NOT_ALLOWED"
  | "REGION_BLOCKED";
```

### 15.2 重试规则

| 场景 | 行为 |
|---|---|
| HTTP 400 / schema invalid | 不重试，记录配置或客户端错误 |
| API Key 无效/未授权 | 不重试，熔断 fallback，通知运维 |
| quota exceeded | 不重试搜索；在配额窗口内快速失败 |
| 429 | 指数退避，最多 2 次，遵守 `Retry-After` |
| 5xx / 网络瞬断 | 抖动指数退避，最多 2 次，受总预算限制 |
| 超时 | 最多 1 次重试；总解析预算不得超过约 8 秒 |
| no match | 写短期 negative cache，不重试同一请求 |
| IFrame 100/101/150 | 失效正缓存，服务端最多重解析 1 次 |
| autoplay blocked | 不重试；等待用户手势 |

不得使用空 `catch` 把所有失败吞成 `null`。UI 可以展示统一提示，但日志和内部结果必须保留原因。

### 15.3 用户提示

建议文案语义：

- `NO_MATCH`：未找到可信的 YouTube 可播放版本。
- `QUOTA_EXCEEDED`：YouTube 搜索服务暂时不可用，请稍后再试。
- `AUTOPLAY_BLOCKED`：浏览器已阻止自动播放，点击继续。
- `VIDEO_UNAVAILABLE`：该 YouTube 播放源已失效，正在尝试重新匹配或请跳过此歌曲。

不要向普通用户显示 API Key、HTTP 原文、完整堆栈或内部 matcher 细节。

## 16. Quota、缓存与请求控制

### 16.1 当前配额事实

截至 2026-08-10，官方文档显示：

- `search.list`：每天 100 次调用；每次在 Search Queries quota bucket 计 1 unit。
- `videos.list`：每次 1 quota unit。
- `search.list` 的 `maxResults` 范围为 0–50，默认 5；POC 固定使用 10。

这些规则曾发生变化。实现不得把历史配额数字当永久常量；上线前和申请扩容前必须重新核对官方页面。

### 16.2 缓存键

```text
youtube-match:v1:
  normalizedTitle |
  normalizedArtists(sorted) |
  normalizedVersionTokens |
  durationBucket |
  regionCode
```

要求：

- 不使用原平台 `resourceId` 作为唯一键，同一录音可能来自多个平台。
- 时长可按秒取整进入 key；无时长使用明确占位符。
- Matcher 规则变化时提升 cache namespace 版本。

### 16.3 TTL

- POC：进程内 LRU，便于观察；重启即丢失。
- 正匹配生产默认 TTL：7 天。
- `NO_MATCH` 默认 TTL：1 小时。
- 配额、认证、网络错误不得写成普通 negative cache；可使用秒级熔断状态。
- 所有 YouTube 非授权 API 数据不得超过 30 天不刷新；到期必须刷新或删除。
- IFrame `100/101/150`、地区不可播或服务端验证失效时立即删除正缓存。
- Phase 1 POC 额外按 `videoId + regionCode` 保存 24 小时进程内运行时失败记录，避免重新解析时再次选择已知 `100/101/150` 候选；重启即丢失。生产 TTL 必须根据覆盖率与误伤数据重新确定。

### 16.4 请求保护

- 相同 key single-flight。
- 进程/实例级限流，并在多实例部署时使用共享配额计数或网关限流。
- 记录每日搜索次数、缓存命中率、无匹配率、API 错误和剩余预算告警。
- 接近每日限制时优先服务真实播放请求，禁止预抓取整个歌单。
- 不在导入歌单时为所有歌曲提前搜索；只对明确缺少 direct source 且即将加入/播放的歌曲解析。

### 16.5 禁止缓存的内容

- YouTube 音频或视频字节。
- 下载文件、分离音轨、转码结果。
- API Key 或认证信息。
- 超过政策允许期限且未刷新的 YouTube API 数据。

## 17. 开发阶段、上下文 Gate 与验收标准

每个 Phase 允许拆成多个可独立验证的原子工作包，以保证单次上下文约 30% 开始收束、最迟 40% 停工并始终低于 60%。若 Phase 中途触发 40% 停工线，按 3.4 节生成检查点并暂停；恢复后继续同一 Phase。每个 Phase 完成时，无论上下文余量多少，都必须执行一次人工压缩 Gate。

### Phase 0：仓库基线、路径映射与执行准备

#### 范围

- 记录当前分支、HEAD、用户已有脏改动和本任务允许修改的范围，后续 diff 必须能区分基线改动与本任务改动。
- 核对根目录与 `server/` 的脚本、Node/pnpm 版本、构建基线和可用测试方式。
- 只读映射音乐解析、队列、播放状态、WebSocket、前端播放器、持久化和协议类型的实际入口。
- 创建 `docs/plans/youtube-fallback-progress.md`，写入首个可恢复检查点。
- 把 Phase 1 POC 的实际目录、启动命令、测试命令和不触碰正式链路的隔离边界落实为短计划。

#### 已确认基线

- 根前端为 React 18 + Vite + TypeScript，构建命令为 `pnpm build`。
- 服务端为 Express + TypeScript，目录在 `server/`，构建命令为 `pnpm --dir server build`。
- 当前正式播放器入口为 `src/hooks/useAudioPlayer.ts`，使用 Shikwasa2；房间协调入口为 `src/hooks/useRoomPage.ts`。
- 服务端主要入口为 `server/src/music/musicAdapter.ts`、`server/src/queueService.ts`、`server/src/playbackService.ts` 和 `server/src/websocket.ts`。
- QueueItem 持久化还涉及 `server/src/db/postgres/roomRepository.ts`，不能只修改内存 DTO。
- 当前工作区已有与本任务无关的用户删除改动 `docs/superpowers/specs/2026-07-06-qq-music-owner-qr-login-design.md`，必须保留且不得纳入本任务成果。

#### 验收标准

- 前后端基线构建或等价只读检查结果已记录；失败被分类为既有失败、环境限制或本任务回归。
- 实际路径映射、POC 隔离边界、测试策略和预期修改范围已写入进度文件。
- 没有修改正式功能代码、RoomQueue、WebSocket、播放器或数据库。
- 本文与真实技术栈之间不存在仍会误导 Phase 1 的已知冲突。

#### Context Gate

Phase 0 完成后更新检查点，向用户提交基线证据并停止。只有用户主动压缩上下文并明确授权后，才允许进入 Phase 1。

### Phase 1：独立 POC（强制隔离）

#### 范围

在独立目录构建最小闭环：

```text
输入 title / artists / duration
        ↓
POC 后端 search.list + videos.list
        ↓
TrackMatcher 展示候选与拒绝原因
        ↓
可见 YouTube IFrame Player
        ↓
手动 play / pause / seek + 状态/错误日志
        ↓ 100/101/150
POC 服务端校验解析会话并选择下一 eligible 候选
```

隔离规则：

- 不修改正式 `RoomQueue`。
- 不修改正式 WebSocket 消息、房间状态或同步逻辑。
- 不替换现有播放器组件。
- 不迁移数据库。
- 不让正式路由依赖 POC 模块。
- 可以放在同一仓库，但使用独立启动命令、独立页面和独立 API 路由前缀。

#### 固定测试集

至少 10 首人工标注歌曲：

- 至少 5 首中文、5 首非中文。
- 至少 3 组包含 Live/Cover/Remix/Remaster/重录版等干扰候选。
- 包含 `晴天 - 周杰伦`。
- 包含 `Love Story - Taylor Swift`，并验证不会误选 `Taylor's Version`（当原 TrackIdentity 指向原版时）。
- 至少 1 个不存在或应返回 `null` 的负例。

#### 验收标准

- API Key 仅在 POC 服务端。
- 每次解析最多 1 次 `search.list` + 1 次批量 `videos.list`。
- 页面显示最多 10 个候选、硬过滤结果、最终选择和 `reasons`。
- `100/101/150` 由客户端上报解析会话与当前 `videoId`；服务端拒绝过期/错位上报，记录短期运行时失败缓存并决定下一候选。
- 所有自动接受结果经人工确认没有明显错误歌手或错误版本；歧义样本必须返回 `null`。
- IFrame 可见且尺寸合规；play、pause、seek、currentTime、ended、error 状态可观察。
- 能演示 autoplay blocked 的用户恢复路径。
- 单元测试覆盖 normalize、版本冲突、时长边界（14.999s/15s/15.001s）和歧义返回。
- POC 报告记录每个样本的预期、实际 `videoId`、是否正确、失败原因和 API 调用数。
- 未触碰正式 RoomQueue/WebSocket 的 diff 审查通过。

#### Functional Gate 与 Context Gate

只有上述验收全部通过，才允许进入 Phase 2。若 matcher 仍会自动选择明显错误版本，停止正式接入，先修 POC。

即使验收全部通过，也不得在同一上下文中进入 Phase 2。必须更新检查点、交付 Phase 1 报告并停止，等待用户主动压缩上下文和明确授权。

### Phase 2：生产级领域模型与后端 Resolver

#### 范围

- 把已验证的领域类型、YouTubeClient、Matcher 和 Resolver 迁移到正式后端模块。
- 增加 schema 校验、超时、重试、错误分类、single-flight、缓存和指标。
- 接入原平台解析结果，但尚不修改正式播放器和房间同步。
- 用 feature flag 关闭默认流量：`YOUTUBE_FALLBACK_ENABLED=false`。

#### 验收标准

- 原平台 direct source 可用时，零 YouTube API 调用。
- 只有明确 fallback 条件才调用 YouTube。
- 成功、无匹配、配额、认证、超时可被调用方区分。
- 缓存命中不产生 Data API 请求；并发相同请求被合并。
- 正/负 TTL 和立即失效行为有自动化测试。
- API Key 不出现在前端构建、日志快照、错误响应和协议 DTO 中。
- 固定测试集在正式模块上的结果与 POC 一致。
- 仍未修改正式 RoomQueue/WebSocket。

#### Context Gate

Phase 2 完成后更新检查点、交付验证证据并停止。只有用户主动压缩上下文并明确授权后，才允许进入 Phase 3。

### Phase 3：PlayerAdapter 与 PlayerManager

#### 范围

- 包装现有 HTML Audio 为 `HtmlAudioAdapter`，保证行为不变。
- 实现 `YouTubeIframeAdapter` 和全局 IFrame API loader。
- 实现 `PlayerManager`，先在独立 demo/Story 页面验证 source 切换。
- 正式 UI 只增加受 feature flag 控制的可见 YouTube 播放区域，不接房间同步。

#### 验收标准

- direct 与 YouTube 连续切换时不会双重出声。
- 快速切歌时旧 load/event 不会覆盖新 item。
- adapter 状态和 IFrame 错误码映射测试通过。
- `destroy()` 后无遗留监听器、轮询器或可播放实例。
- YouTube Player 始终可见、尺寸合规、无覆盖控件。
- autoplay blocked 有明确 UI，点击后能从目标时间恢复。
- feature flag 关闭时现有播放器行为和构建产物路径保持不变。
- RoomQueue/WebSocket 仍未修改。

#### Context Gate

Phase 3 完成后更新检查点、交付播放器隔离验证并停止。只有用户主动压缩上下文并明确授权后，才允许开始 Phase 4 的正式房间同步调查与修改。

### Phase 4：RoomQueue 与 WebSocket 接入

#### 前置条件

- Phase 1–3 验收通过。
- 先调查当前 RoomQueue、持久化 schema、WebSocket 权威端和事件回环机制。
- 在实现计划中列出实际受影响文件和兼容策略，再开始修改。

#### 范围

- QueueItem 增量加入 `track`、`playback`。
- 服务端解析并广播唯一 `videoId`。
- PlayerManager 消费房间权威播放状态。
- 接入 play/pause/seek/ended/source-failed。
- 通过 feature flag 或测试房间限制影响范围。

#### 验收标准

- 两个浏览器进入同一房间，加载相同 QueueItem 时得到相同 `videoId`。
- play、pause、seek、切歌和 ended 正确同步。
- 未交互客户端 autoplay blocked 不会暂停全房间；点击后追上当前进度。
- WebSocket 无事件回环和明显消息洪泛。
- IFrame 播放失败只允许服务端重解析，所有客户端收到同一新 source/revision。
- 旧 QueueItem（只有 `audioUrl`）仍可播放。
- direct 播放路径的现有自动化测试全部通过。
- 断线重连、晚加入、快速切歌、过期消息和乱序 revision 有覆盖。

#### Context Gate

Phase 4 完成后更新检查点、交付双浏览器与兼容性证据并停止。只有用户主动压缩上下文并明确授权后，才允许进入 Phase 5。

### Phase 5：灰度、可观测性与发布

#### 范围

- 小范围打开 feature flag。
- 加入 quota dashboard、cache 命中率、matcher 结果、IFrame 错误和 autoplay blocked 指标。
- 校对隐私说明、YouTube 来源标识和政策要求。
- 建立回滚与熔断方案。

#### 验收标准

- 可按环境、用户或房间关闭 fallback，无需回滚数据库。
- 配额接近上限、认证失败或错误率异常时自动熔断搜索，不影响 direct source。
- 日志可定位一次解析链路，但不含 API Key、媒体 token 或不必要的用户数据。
- 正缓存与 YouTube API 数据不会超过 30 天不刷新。
- 灰度期间无 direct 播放回归、无双播放器、无房间队列分叉。
- 上线检查再次核对 YouTube Data API、IFrame API、Developer Policies 和 Required Minimum Functionality。

#### Context Gate

Phase 5 完成后更新最终检查点并停止。部署或发布不因实现完成而自动获得授权；必须单独等待用户明确授权，且不得把“继续开发”解释为“允许发布”。

## 18. 建议文件结构

以下结构已按当前仓库的 `server/` 与 `src/` 布局校准。当前没有 shared package，第一版不得只为共享类型而引入 monorepo 或无关目录重构；协议类型的单一权威方案在 Phase 2 明确，前端镜像类型在 Phase 4 随协议接入更新。

```text
poc/
  youtube-fallback/
    README.md
    server/
      index.ts
      youtubeClient.ts
      trackMatcher.ts
      types.ts
    web/
      index.html
      main.ts
      poc.css
    fixtures/
      tracks.json
      expected-results.json
    tests/
      normalize.test.ts
      trackMatcher.test.ts

server/
  src/
    music/
      playback/
        playbackResolver.ts
        playbackTypes.ts
      youtube/
        youtubeClient.ts
        youtubeSchemas.ts
        youtubeTypes.ts
        youtubeQuery.ts
        youtubeVideoDetails.ts
        trackNormalizer.ts
        trackMatcher.ts
        youtubeMatchCache.ts
        youtubeFallbackResolver.ts
        youtubeErrors.ts
        youtubeMetrics.ts
    # Phase 4 才修改 types.ts、queueService.ts、websocket.ts、持久化与正式解析入口

src/
  player/
    playerAdapter.ts
    shikwasaAudioAdapter.ts
    youtubeIframeApiLoader.ts
    youtubeIframeAdapter.ts
    playerManager.ts
    playerErrors.ts
  components/
    room/
      YouTubePlayerPanel.tsx
      AutoplayBlockedPrompt.tsx
  types/
    # Phase 4 才更新前端 PlaybackSource / QueueItem / WebSocket DTO 镜像

docs/
  plans/
    youtube-fallback-progress.md
```

POC 目录允许使用项目已有依赖，但不得为了 POC 新增重量级生产依赖。新增生产依赖前必须说明必要性和影响。

## 19. 实现顺序

开发 Agent 按以下顺序执行。每个编号是一个候选原子工作包；开始前和完成后检查上下文预算，不得跳过任何 Context Gate：

1. Phase 0：记录分支、HEAD、脏工作区基线，运行前后端基线构建，完成实际路径映射。
2. 创建并填写 `docs/plans/youtube-fallback-progress.md`，落实 POC 目录、启动命令、测试方式和隔离边界。
3. 完成 Phase 0 验收与 diff 自审，停止并等待用户压缩上下文、授权 Phase 1。
4. Phase 1：建立独立 POC 目录和独立启动命令。
5. 定义 POC `TrackIdentity`、YouTube DTO、固定测试集与人工 ground truth。
6. 实现服务端配置校验、脱敏日志、`search.list`、批量 `videos.list` 和 ISO 8601 时长解析。
7. 实现 normalize、版本词提取、硬过滤、确定性排序和歧义拒绝。
8. 实现 POC 候选/拒绝原因页面与可见 IFrame 的 play/pause/seek/状态/错误演示。
9. 运行固定测试集、生成 POC 报告并证明正式 RoomQueue/WebSocket/播放器零修改。
10. 完成 Phase 1 Gate，停止并等待用户压缩上下文、授权 Phase 2。
11. Phase 2：迁移生产级领域模型、YouTubeClient、Matcher、Resolver、缓存、错误、限流、指标和测试；feature flag 默认关闭。
12. 完成 Phase 2 Gate，停止并等待用户压缩上下文、授权 Phase 3。
13. Phase 3：在独立 demo 中实现并验证 Shikwasa/YouTube Adapter 与 PlayerManager，不接房间同步。
14. 完成 Phase 3 Gate，停止并等待用户压缩上下文、授权 Phase 4。
15. Phase 4：先复核正式队列、持久化、WebSocket 权威端和事件回环，再提交本 Phase 的实际文件级改动清单。
16. 以向后兼容方式接入 `TrackIdentity`、`PlaybackSource`、QueueItem、协议与播放器协调。
17. 完成双浏览器、断线重连、autoplay blocked、source 失效、旧 QueueItem 和 direct 回归测试。
18. 完成 Phase 4 Gate，停止并等待用户压缩上下文、授权 Phase 5。
19. Phase 5：完成灰度准备、可观测性、熔断、政策复核和发布前验收。
20. 完成 Phase 5 Gate 并停止；部署/发布须另行取得明确授权。

## 20. 测试矩阵

### 20.1 Matcher 单元测试

- 大小写、Unicode NFKC、全角/半角、HTML entity。
- 中英文标点、空白、破折号。
- `feat./ft./featuring`。
- `official video/audio/lyrics` 不构成错误版本。
- Live/Cover/Remix/Instrumental/Karaoke/Acoustic/Remaster/重录版冲突。
- 多歌手与 channelTitle 命中。
- 15 秒时长边界。
- 无时长精确匹配与歧义返回。
- 两名候选相同优先级时返回 `AMBIGUOUS_MATCH`。
- 地区限制、不可嵌入、Made for Kids 排除。

### 20.2 YouTubeClient 测试

- 请求参数和 URL 编码。
- API Key 不出现在日志。
- 空搜索结果不调用 `videos.list`。
- 5 个 ID 合并为一次 `videos.list`。
- malformed JSON/schema、timeout、429、5xx、quota、auth 错误映射。
- 重试次数与总预算。

### 20.3 Player 测试

- IFrame API 单例加载与并发调用。
- ready 前调用 load/play 的排队行为。
- source 类型校验。
- YT 状态与错误码映射。
- 快速 load A → load B 时忽略 A 的迟到事件。
- adapter 切换无双重播放。
- destroy 清理。
- autoplay blocked 恢复。

### 20.4 房间集成测试

- 两客户端相同 `videoId`。
- play/pause/seek/ended。
- 晚加入和断线重连。
- 一个客户端 autoplay blocked，另一客户端继续播放。
- 旧 revision/旧 item 错误被忽略。
- source 失效后服务端单次重解析。
- 旧 direct QueueItem 兼容。

## 21. 可观测性

建议结构化指标：

```text
youtube_resolve_total{result=matched|no_match|error|cache_hit}
youtube_api_request_total{method=search|videos,result=ok|error}
youtube_api_latency_ms{method=search|videos}
youtube_match_rejection_total{reason=...}
youtube_iframe_error_total{code=2|5|100|101|150|153}
youtube_autoplay_blocked_total
youtube_source_reresolve_total{result=matched|failed}
youtube_cache_entries{kind=positive|negative}
```

解析链路日志包含：

- request/trace ID。
- TrackIdentity 的脱敏稳定 hash；需要调试时可在受控日志记录 title/artist，遵守项目隐私规范。
- cache hit/miss。
- API 方法、延迟、结果类别。
- 最终 `videoId`、matcher reasons 或 unmatched code。

不得记录 API Key、完整带 token 的 URL、YouTube 媒体数据或用户认证凭据。

## 22. 禁止事项

开发 Agent 不得实施以下内容：

- POC 验收成功前修改正式 RoomQueue、WebSocket、数据库 schema 或现有播放器入口。
- 从 YouTube 提取音频 URL、分离音轨、下载、代理、转码、缓存媒体或离线播放。
- 使用 `yt-dlp`、YouTube 网页抓取、未公开 API 或规避播放限制的第三方服务。
- 隐藏 IFrame，使用 `display:none`、1×1、透明、移出屏幕或后台标签页纯音频播放。
- 遮挡、移除、修改 YouTube 控件、品牌、链接或广告。
- 绕过地区、嵌入、年龄、Made for Kids、autoplay 或浏览器安全限制。
- 将 `YOUTUBE_API_KEY` 放进前端、提交到 Git、写入日志或通过 WebSocket 下发。
- 在每个客户端独立搜索和匹配 YouTube 视频。
- 低置信度时“随便选第一条”。
- 把 Live/Cover/Remix/重录版默认当作原录音。
- 为整个歌单预先搜索，造成配额浪费。
- 用空 catch 静默降级，把认证、配额、网络错误统一伪装为无匹配。
- 一次性删除 `audioUrl` 或做无关的播放器/队列大重构。
- 未经说明新增生产依赖、改变公共接口、迁移数据、部署或发布。
- 在未获得用户明确的 YouTube Phase 恢复授权时，因 QQ音乐/网易云音乐等其他任务而继续本设计的实现。
- 让任何非 YouTube provider 依赖 YouTube 模块、YouTube feature flag 或 IFrame 专属状态。

## 23. 开发 Agent 交付清单

每个 Phase 的交付回复必须包含：

- 已完成结果。
- 当前 Phase 状态、上下文停工触发原因，以及明确的 `WAITING_FOR_USER_COMPRESSION` 状态。
- 修改文件的绝对路径或仓库内可定位路径。
- 关键设计决策和与本文不同之处。
- 实际运行的测试、构建、lint/typecheck 及结果。
- POC 或双浏览器验收证据。
- 未通过检查、环境限制和残余风险。
- 当前 diff 自审结果，特别说明是否触碰 RoomQueue/WebSocket。
- `docs/plans/youtube-fallback-progress.md` 已更新，并给出压缩后恢复的第一个动作。
- 明确声明未进入下一 Phase，未把用户的“继续开发”授权扩大解释为部署、发布或其他外部操作。

Phase 1 额外交付：

- 固定测试集与人工 ground truth。
- 每首测试歌曲的 matcher 结果。
- API 调用次数和缓存命中情况。
- 可见 IFrame、状态事件、seek 和 autoplay blocked 的验证结果。
- 明确声明：正式 RoomQueue/WebSocket 是否保持零修改。

## 24. 外部参考

以下均为官方文档；实现和上线时以最新版本为准：

- [YouTube Data API — search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API — videos.list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube Data API — Video resource](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services — Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services — Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

## 25. 最终决策摘要

```text
优先级：Direct source > YouTube fallback > 明确失败

当前状态：FROZEN_STANDALONE_DESIGN（独立保留，不自动进入后续 Phase）
设计关系：YouTube fallback 不作为任何平台登录、官方 API 或前端设计的前置条件
废弃保证：可按 3.6 节整份停用或移除，不迁移、不删除、不阻塞其他 provider

解析权威：Server
播放实现：官方可见 YouTube IFrame Player
匹配策略：确定性规则，宁缺毋滥
同步对象：PlaybackSource + 权威播放状态，不同步裸媒体流
第一阶段：独立 POC
POC 前禁区：正式 RoomQueue / WebSocket / 播放器主链路
上下文策略：约 30% 开始收束，最迟 40% 停工，始终低于 60% 绝对上限
阶段规则：每个 Phase 完成后写检查点并强制停止
恢复权限：仅用户主动压缩上下文并明确授权后继续
恢复依据：设计文档 + docs/plans/youtube-fallback-progress.md + git status/diff
```
