# YouTube Fallback Phase 1 POC 报告

> 日期：2026-08-10  
> 实现状态：`IMPLEMENTATION_COMPLETE_AFTER_RUNTIME_CORRECTION`  
> Functional Gate：`PENDING_IFRAME_MANUAL_RETEST`  
> 当前证据：候选池已扩大为 10，可信 Official Audio / Artist Topic 获得排序优先级；`100/101/150` 改为客户端上报、服务端会话切换并写入短期失败缓存。真实 HK 复测已选择 `Love Story` 的 Topic 原版，等待浏览器验证。

## 已完成的闭环

- 独立目录、独立路由前缀、独立同源页面和启动命令。
- `TrackIdentity → search.list → videos.list → TrackMatcher → ResolveResponse`。
- 最多 10 个候选，显示硬过滤、候选决策、最终选择与 reasons。
- 官方可见 YouTube IFrame API：play、pause、seek、currentTime、ended、error 日志。
- 自动播放尝试的超时观察与“点击恢复播放”用户手势路径。
- IFrame 运行时遇到 `100/101/150` 时只上报一次；POC 服务端校验解析会话和当前 `videoId`，记录 `videoId + regionCode` 的 24 小时进程内失败缓存，并返回下一 eligible 候选。
- API Key 仅由 POC 服务端环境读取；health、响应、日志与页面均不回显 Key。
- 11 首固定样本及真实报告命令；输出包含每首样本 API 调用数与人工复核字段。
- 正式 RoomQueue、WebSocket、播放器主链路和数据库零修改。

## 固定样本执行记录

| 样本 | 预期 | 实际 videoId / 结果 | 人工正确性 | API 调用 |
|---|---|---|---|---|
| 晴天 - 周杰伦 | 原版；拒绝现场/纯享 | `DYptgVvkVLQ`，官方 MV（319 秒） | 官方 MV 使用非对称容差；待 IFrame 复测，`3-DteAHyRnI` 为备用 | 1 / 1 |
| 夜曲 - 周杰伦 | 原版；拒绝现场 | `6Q0Pd53mojY`，官方 MV | 元数据通过，待 IFrame 试听 | 1 / 1 |
| 体面 - 于文文 | 原版；拒绝纯享/再唱 | `-kfVp3tqYvc`，官方 MV | 元数据通过，待 IFrame 试听 | 1 / 1 |
| 光年之外 - 邓紫棋 | 原版；拒绝现场/纯享 | `AMBIGUOUS_MATCH` | 通过：扩大候选池后 5 条等价原版/歌词候选不擅自选择 | 1 / 1 |
| 演员 - 薛之谦 | 原版或明确 null | `XaN3kUz4KSw`，官方 MV | 完整回归曾遇一次临时 502；定向重试通过 | 1 / 1 |
| Love Story - Taylor Swift | 原版；拒绝 Taylor's Version | `CxcEqhy4yKg`，Taylor Swift - Topic | 元数据通过；待 IFrame 试听 | 1 / 1 |
| bad guy - Billie Eilish | 原版或明确 null | `AMBIGUOUS_MATCH` | 通过：多个同分歌词候选不擅自选择 | 1 / 1 |
| Bohemian Rhapsody - Queen | 原版；拒绝 remaster/live | `5zLnaNY58j8`，歌词版 | 元数据通过，待 IFrame 试听 | 1 / 1 |
| Shape of You - Ed Sheeran | 原版 | `JGwWNGJdvx8`，官方 MV | 元数据通过，待 IFrame 试听 | 1 / 1 |
| Yellow - Coldplay | 原版；拒绝 live | `yKNxeF4KMsY`，官方 MV | 元数据通过 | 1 / 1 |
| 不存在的负例 | 返回 null/no_match | `NO_TITLE_MATCH` | 通过 | 1 / 1 |

真实报告由 `node --env-file=server/.env poc/youtube-fallback/dist/tests/liveFixtureReport.js` 生成；报告不包含 Key。每首均为一次 `search.list` 与一次批量 `videos.list`。

### 真实复测中发现并修复的问题

- 第一轮错误接受了《光年之外》的“纯享/再唱”现场候选 `A_NylBn05RI`；Gate 因此未通过。
- matcher 加入保守的中文简繁同形归一化、中文书名号/方括号边界、中文短标题词边界，以及“纯享/再唱”表演版本词。
- 第二轮选择原版 MV `T4SimnaiktU`，并以 `VERSION_CONFLICT` 拒绝上述现场候选。
- 《演员》和 `bad guy` 均因多个候选语义同分返回 `AMBIGUOUS_MATCH`，符合宁缺毋滥原则。
- 首次 IFrame 验证中，歌词候选 `v10bFxUDZsA` 虽然 API 元数据为可嵌入，播放器运行时仍连续返回 `ERROR(150)`；YouTube 网页本身可播放，因此这是站外嵌入限制，不是曲目匹配错误。
- 普通候选继续使用 `±15 秒`；仅当标题含 `Official Music Video` 且频道名匹配主歌手时，允许视频最多比目标长 60 秒、最多短 15 秒。真实单条复测因此选择官方 MV `DYptgVvkVLQ`（比目标长 50 秒）。
- POC 浏览器现在把服务端选择和 eligible 候选构造成去重队列；`101/150` 发生后停止当前 IFrame、抑制重复错误，并切换下一候选。该运行时路径已有纯逻辑测试，仍需浏览器证据。
- 第二次人工复测证明上述切换生效：`DYptgVvkVLQ → 3-DteAHyRnI → v10bFxUDZsA` 各尝试一次后结束为 `NO_RUNTIME_PLAYABLE_CANDIDATE`，三者均返回 `ERROR(150)`，没有循环。POC 已加入官方文档示例视频 `M7lc1UVf-VE` 的环境隔离诊断按钮。
- 用户确认 YouTube 官方 IFrame 示例视频 `M7lc1UVf-VE` 能够成功加载。这排除了 POC 来源、浏览器和 IFrame 初始化的整体故障；《晴天》候选失败应判定为候选级运行时嵌入限制。
- 修正后 `search.list` 保持一次调用但 `maxResults` 从 5 调整为 10；查询字符串仍只使用 title + artists，不强行添加版本词。
- matcher 新增可信 `Official Audio` 与“主歌手 - Topic”优先级；真实复测将 `Love Story` 选择为 Topic 原版 `CxcEqhy4yKg`。
- 浏览器不再自行遍历候选；`POST /runtime-failure` 由服务端验证解析会话、防止错位上报、缓存运行时失败并选择下一候选。离线测试覆盖切换、耗尽、过期/错位拒绝、地区隔离和 TTL 到期。

## 验收矩阵

| 验收项 | 状态 | 证据 |
|---|---|---|
| API Key 仅在服务端 | PASS（静态/离线） | 配置边界与 mock URL 测试；health/响应不含 Key |
| 每次最多一次 search + 一次批量 videos | PASS（离线） | client 与 resolve contract 测试 |
| 最多 10 条候选及 Audio/Topic 优先 | PASS（真实/离线） | maxResults contract；Love Story 真实选择 Topic 原版 |
| 页面显示候选、过滤、最终选择与 reasons | PASS（实现/静态路由） | 同源页面及 resolve 静态资源测试 |
| normalize/版本/时长/歧义单测 | PASS | matcher contract 测试 |
| IFrame 可见且可加载 | PASS（MANUAL） | 官方示例视频 `M7lc1UVf-VE` 已由用户确认成功加载 |
| play/pause/seek/currentTime/ended 状态可观察 | PENDING MANUAL | 仍需用户完成控制与状态记录 |
| autoplay blocked 用户恢复 | PENDING MANUAL | 恢复入口实现完成，等待浏览器策略触发并记录 |
| `100/101/150` 服务端协调与失败缓存 | PASS（离线），PENDING MANUAL | coordinator/HTTP contract 通过；等待真实 IFrame 上报复测 |
| 11 首真实搜索与人工确认 | PASS（元数据） | 两轮真实 HK 请求；第二轮 8 matched、2 ambiguity null、1 negative null |
| 正式 RoomQueue/WebSocket 零修改 | PASS | Phase 1 diff 文件边界审查 |

## Functional Gate 判定

真实 Data API、matcher、服务端运行时协调和 IFrame 基础加载已经验证；《晴天》候选均被运行时 `150` 拒绝，但 `Love Story` 已找到 Topic 原版候选。Phase 1 仍需用该实际 matcher 候选完成一次成功播放，并记录 play、pause、seek、currentTime、ended/error 和 autoplay 恢复结果。证据补齐前状态保持 `PENDING_IFRAME_MANUAL_RETEST`，禁止进入 Phase 2。
