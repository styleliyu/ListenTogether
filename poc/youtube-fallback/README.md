# YouTube fallback POC

这是 Phase 1 的隔离验证目录。目标闭环是 `TrackIdentity → search.list → videos.list → 确定性 matcher → 可见 YouTube IFrame`。POC 不写入正式房间队列，不修改正式 WebSocket、播放器或数据库，也不下载、代理或提取 YouTube 媒体内容。

## 已实现范围

- 服务端固定使用 `/api/poc/youtube-fallback/*`；`GET /health` 只返回脱敏配置状态。
- `POST /resolve` 每次至多执行一次 `search.list` 和一次批量 `videos.list`，返回匹配、空搜索、详情缺失、请求无效、未配置 Key 或上游不可用的结构化结果。
- `POST /runtime-failure` 接收当前解析会话的 `100/101/150`，校验当前候选后由服务端选择下一 eligible 候选；同一 `videoId + regionCode` 的失败在 POC 进程内缓存 24 小时。
- 响应包含最多 10 个详情候选，以及每个候选的 `selected`、`eligible` 或 `rejected` 决策和 reasons。
- matcher 覆盖 HTML entity/NFKC/标点标准化、版本词冲突、标题/歌手匹配、地区/嵌入/Made-for-Kids 硬过滤、确定性排序和歧义拒绝。可信 Official Audio / Artist Topic 优先于官方 MV 和普通候选；普通候选使用 `±15 秒`，可信官方 MV 允许最多长 60 秒、最多短 15 秒。
- 同源手工页面展示搜索摘要、候选、硬过滤与最终选择，并通过官方可见 YouTube IFrame Player 提供 play、pause、seek、currentTime、ended/error 状态日志及 autoplay blocked 用户恢复入口。IFrame 运行时返回 `100/101/150` 时只负责上报，下一候选由服务端解析会话决定。
- 手工页面提供 YouTube 官方 IFrame 文档示例视频 `M7lc1UVf-VE` 的环境诊断按钮；示例可播而候选报 `150` 表示候选自身受限，示例同样报错则优先检查浏览器、网络或嵌入来源环境。
- `fixtures/` 有 11 个样本（5 个中文、5 个非中文、1 个负例）。真实 videoId 只允许由 Data API 实测并人工确认，不能猜测填写。

## 构建与运行

在仓库根目录使用现有 TypeScript 编译器：

```powershell
node_modules/.bin/tsc.cmd -p poc/youtube-fallback/tsconfig.json
node poc/youtube-fallback/dist/server/index.js
```

打开 `http://127.0.0.1:4178/`。服务端默认监听 `127.0.0.1:4178`，可通过 `YOUTUBE_POC_PORT` 覆盖。

真实解析前，只在启动服务的终端进程中设置：

```powershell
$env:YOUTUBE_API_KEY = '服务端 Key'
$env:YOUTUBE_REGION_CODE = 'HK'
$env:YOUTUBE_RELEVANCE_LANGUAGE = 'zh-Hans'
```

实现不会输出或回显 Key，前端 bundle、响应和 WebSocket 中均不包含 Key。

## 离线测试

构建后运行：

```powershell
node poc/youtube-fallback/dist/tests/fixtureSchema.test.js
node poc/youtube-fallback/dist/tests/youtubeClient.test.js
node poc/youtube-fallback/dist/tests/trackMatcher.test.js
node poc/youtube-fallback/dist/tests/runtimeCandidateCoordinator.test.js
node poc/youtube-fallback/dist/tests/playerFallback.test.js
node poc/youtube-fallback/dist/tests/resolve.test.js
```

## 真实样本报告与人工验收

配置服务端 Key 后运行：

```powershell
node poc/youtube-fallback/dist/tests/liveFixtureReport.js > youtube-fallback-live-report.json
```

报告记录每个样本的候选、最终 videoId/失败码、reasons、耗时和 `search.list`/`videos.list` 调用次数，但 `humanReview` 初始始终为 `pending`。人工必须在同一地区设置下打开 POC 页面，确认没有明显错误歌手或错误版本，并验证 IFrame 控制、状态、错误和 autoplay 恢复路径，才可把 Phase 1 Functional Gate 标为通过。

完整 Gate 状态见 `docs/plans/youtube-fallback-phase1-report.md`。
