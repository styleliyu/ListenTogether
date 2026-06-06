# 一起听

一个适合个人自部署的实时同步听歌 Web 应用。项目基于原版 `podcast-together` 改造，后端已从 Laf 云函数迁移为普通云服务器可运行的 Node.js 服务，支持和朋友在同一个房间里同步播放音乐、播客和本地音频。

- 线上示例：[https://podcast.still-fantasy.com/](https://podcast.still-fantasy.com/)
- 当前仓库：[styleliyu/podcast-together-personal-](https://github.com/styleliyu/podcast-together-personal-.git)
- 原项目：[yenche123/podcast-together](https://github.com/yenche123/podcast-together)

## 功能概览

- 创建房间后分享链接，房间成员可实时同步播放、暂停、进度、倍速和切歌。
- 支持房主和普通成员角色区分，房主可分别控制普通成员的播放控制、队列管理和歌单导入权限，并可转让房主。
- 支持房间播放队列、上一首、下一首、顺序播放、随机播放、单曲循环，以及删除队列项、跳过当前和下首播放。
- 支持在房间内继续添加单曲或歌单。
- 支持本地普通音频和常见加密音乐文件上传。前端会先解析 `ncm`、`qmc`、`kgm`、`kwm` 等格式，解密为可播放音频后再上传到服务器同步播放。
- 支持常驻房间，适合固定入口长期使用。
- 支持大歌单渐进式导入：先创建房间并加入前几首可播放歌曲，后台再低频解析剩余歌曲，成功一首追加一首到队列。
- 支持导入进度面板、失败歌曲详情和取消导入任务。取消后已加入队列的歌曲不会被删除。

## 技术架构

- 前端：Vue 3 + Vite + TypeScript，源码在 `src/`。
- 后端：Node.js + Express + ws，源码在 `server/src/`。
- 数据库：SQLite，运行时数据默认存放在 `server/data/`。
- 播放同步：HTTP 负责创建/进入房间，WebSocket 负责播放状态、队列、切歌和导入进度同步。
- 音乐解析：入口在 `server/src/music/musicAdapter.ts`，平台链接识别已拆到 `server/src/music/adapters/`。
- 本地文件解密：核心代码已并入 `src/decrypt-core/`，前端统一入口在 `src/utils/decryptMusicFile.ts`。
- 房间状态：通过 `server/src/roomService.ts`、`server/src/queueService.ts`、`server/src/playbackService.ts` 和 `server/src/websocket.ts` 操作并持久化。

## 后端模块

后端已做保守模块化整理，不改变现有 API 和 WebSocket 协议：

- `server/src/config/env.ts`：统一读取环境变量。
- `server/src/utils/logger.ts`：统一日志出口。
- `server/src/utils/response.ts`：统一响应结构工具。
- `server/src/middlewares/errorHandler.ts`：统一 Express 错误处理预留。
- `server/src/websocket/broadcaster.ts`：封装 WebSocket 单发和房间广播。
- `server/src/music/adapters/`：拆分音乐平台链接识别，包含 `qq`、`netease`、`kugou`、`kuwo`、`baidu`、`directAudio`、`localAudio`。
- `server/src/queueService.ts`：队列清洗、切歌索引、播放模式等队列辅助逻辑。
- `server/src/playbackService.ts`：播放、暂停、进度同步的辅助逻辑。
- `server/src/playlistImport.ts`：渐进式歌单导入、导入状态、取消导入任务。

## 本地文件解析

本地文件上传前会在浏览器端进行格式识别：

- 普通音频：`mp3`、`m4a`、`aac`、`flac`、`wav`、`ogg`、`wma`、`dff`。
- 网易云：`ncm`、`uc`。
- QQ 音乐：`qmc*`、`mflac*`、`mgg*`、`tm*`、`tkm`、`cache` 等。
- 酷狗：`kgm`、`kgma`、`vpr`。
- 酷我：`kwm`。
- 其他已由 `src/decrypt-core/` 支持的格式：`xm`、`x2m`、`x3m`、`mg3d`、`ofl_en` 等。

统一调用层是 `src/utils/decryptMusicFile.ts`。业务层只调用 `prepareLocalMusicFilesForUpload(files)` 或 `decryptMusicFile(file)`，不直接依赖解密核心内部的 `FileInfo` 结构。

解密结果中的临时 `objectUrl` 和封面 `pictureUrl` 会在上传结束后释放。解密核心内置的 QMC/KGM WASM bundle 当前以 JS 模块方式随前端构建打包，不需要额外配置静态 `.wasm` 路径。

## 支持的链接

当前支持：

- 播客链接：小宇宙、Apple Podcasts 中国区、常见播客网页。
- 音频直链：公网可访问的 `.mp3`、`.m4a`、`.aac`。
- 喜马拉雅：需要后端配置开放平台应用。
- 音乐平台单曲和歌单：网易云音乐、QQ 音乐、酷狗音乐、酷我音乐、百度/千千音乐。

暂不支持：

- 专辑页、歌手页直接创建房间。
- 平台没有返回播放地址的内容。会员、版权、下架、地区限制歌曲需要平台接口实际返回可播放地址。

## 复制音乐链接

原则：打开歌曲或歌单详情页，直接复制浏览器地址栏里的前端页面链接。不要复制搜索页、歌手页、专辑页或临时跳转链接。

常见格式：

```text
网易云音乐单曲：https://music.163.com/#/song?id=3381828899
网易云音乐歌单：https://music.163.com/#/playlist?id=...
QQ 音乐单曲：https://y.qq.com/n/ryqq/songDetail/003mAan70zUy5O
QQ 音乐歌单：https://y.qq.com/n/ryqq/playlist/...
酷狗音乐单曲：https://www.kugou.com/mixsong/12f54x43.html 或 https://www.kugou.com/song/#hash=...
酷狗音乐歌单：https://www.kugou.com/yy/special/single/...
酷我音乐单曲：https://www.kuwo.cn/play_detail/263288
酷我音乐歌单：https://www.kuwo.cn/playlist_detail/...
百度/千千音乐：https://music.91q.com/song/... 或 https://music.taihe.com/song/...
```

QQ 音乐播放地址解析已吸收 `copws/qq-music-api` 的新版请求方式：原逻辑失败后会使用 `https://u.y.qq.com/cgi-bin/musicu.fcg` 的 POST 方式兜底。需要账号授权的内容可以配置 QQ 音乐 Cookie，但最终仍取决于 QQ 音乐接口是否给当前账号返回播放地址。

## 歌单和队列

- 粘贴歌单链接创建房间时，后端会先解析前几首可播放歌曲并立即创建房间。
- 剩余歌曲由后台渐进式导入，间隔低频请求平台接口，避免一次性打满外部服务。
- 后台导入只会把已经拿到 `audioUrl` 的歌曲追加到播放队列。
- 解析失败的歌曲会跳过，不会阻塞整张歌单。
- 队列追加和导入进度通过 WebSocket 同步给房间内所有用户。
- 房间页会显示导入状态、已解析数量、已加入数量、失败数量和总数量。
- 导入进度面板支持展示部分失败歌曲详情，方便定位解析失败、版权受限或网络异常等问题。
- 正在导入时可以点击“取消导入”。取消后后端会停止继续解析剩余歌曲，已经成功加入队列的歌曲不会被删除。
- 切到尚未解析出播放地址的队列项时，后端会进行懒解析，并带有同房间频率限制和失败冷却。

## 请求保护和缓存

- `/api/parse-text`：单 IP 3 次 / 10 秒。
- `/api/parse-text`：全局 10 次 / 10 秒。
- `/api/playlist-import/cancel`：取消当前房间正在运行的歌单导入任务；没有运行中的任务时会返回正常提示，不会影响房间状态。
- 切歌懒解析：同房间 1 次 / 2 秒。
- 播放地址解析失败冷却：30 秒。
- 播放地址成功缓存：30 分钟。

这些限制是为了让个人服务器更稳定，也降低音乐平台接口被高频请求的风险。当前没有实现代理池、多 Cookie 轮换或动态 IP。

## 房间生命周期

- 在线成员判定：超过 `VISITOR_OFFLINE_TIMEOUT_MS` 没有心跳会被视为离线，默认 30 分钟。
- 房间空闲暂停：无人在线后，后端会按 `ROOM_IDLE_PAUSE_TIMEOUT_MS` 暂停播放，默认 0，即立即暂停。
- 临时房间清理：非常驻房间无人且超过 `TEMP_ROOM_DELETE_AFTER_EMPTY_MS` 后才会标记为删除，默认 1 小时。
- 清理任务频率：`ROOM_CLEANUP_INTERVAL_MS` 控制后端生命周期检查间隔，默认 60 秒。
- 常驻房间不会因为无人进入被自动删除。

## 常驻房间管理

- 创建常驻房间时可以填写自定义房间名；后端会 `trim`，最长保存 30 个字符，纯空名称无效。
- 房间页顶部会优先显示自定义房间名；没有设置时显示 `一起听房间 ${roomId}`。
- 房主可以在房间管理面板中修改常驻房间名称，刷新页面后仍会从 SQLite 读取。
- 房主可以主动删除常驻房间。删除会把当前 `roomId` 标记为 `DELETED`，不会影响其他房间；同房间用户下一次心跳会退出到房间失效状态。
- 房主可以在管理面板中设置普通成员是否允许控制播放、管理队列、导入歌单，也可以把房主转让给当前在线成员。
- 临时房间房主离开后，如果房间里仍有在线成员，会自动转让给当前在线的第一位成员；常驻房间房主离开后仍保留房主身份。
- 普通临时房间仍按生命周期配置自动清理，不提供主动删除入口。

## 本地开发

建议使用 Node.js 18 LTS。

前端：

```bash
pnpm install
pnpm dev
```

后端：

```bash
cd server
npm install
npm run dev
```

如果 Windows 下安装后端依赖时 `better-sqlite3` 编译失败，优先切换到 Node.js 18；仍失败时安装 Visual Studio Build Tools，并勾选 `Desktop development with C++`。

## 环境变量

根目录创建 `.env.local`：

```env
VITE_API_URL=https://你的域名/api
VITE_WEBSOCKET_URL=wss://你的域名/ws
VITE_HEARTBEAT_PERIOD=15
```

`server` 目录创建 `.env`：

```env
HOST=127.0.0.1
PORT=3001
DATABASE_PATH=./data/podcast-together.db
CORS_ORIGIN=https://你的域名
UPLOAD_DIR=./data/uploads
ROOM_CLOCK_INTERVAL_MS=30000
ROOM_CLEANUP_INTERVAL_MS=60000
VISITOR_OFFLINE_TIMEOUT_MS=1800000
ROOM_IDLE_PAUSE_TIMEOUT_MS=0
TEMP_ROOM_DELETE_AFTER_EMPTY_MS=3600000

# 可选：QQ 音乐登录 Cookie，用于需要账号授权的播放地址解析。
QQ_MUSIC_COOKIE=
QQ_MUSIC_COOKIE_FILE=./data/qq-music-cookie.txt

XIMALAYA_APP_KEY=
XIMALAYA_APP_SECRET=
XIMALAYA_CLIENT_OS_TYPE=4
XIMALAYA_SERVER_API_VERSION=1.0.0
XIMALAYA_DEVICE_ID=
XIMALAYA_DEVICE_ID_TYPE=
XIMALAYA_SIG_MODE=md5_secret_concat
```

QQ 音乐 Cookie 获取方式：在浏览器登录 QQ 音乐网页版，打开开发者工具，在 `y.qq.com` 或 `u.y.qq.com` 请求里复制 `Cookie` 请求头。该值只应放在自己的服务器环境变量或运行时 Cookie 文件里，不要提交到仓库。

如果想运行时更换 QQ Cookie，不需要重启服务。把 Cookie 写入 `QQ_MUSIC_COOKIE_FILE` 指向的文件即可，默认是 `server/data/qq-music-cookie.txt`。后端每次请求 QQ 音乐接口前都会重新读取该文件；文件为空或不存在时，才会回退到 `.env` 里的 `QQ_MUSIC_COOKIE`。

## 构建

后端：

```bash
cd server
npm run build
```

前端：

```bash
npm run build
```

前端构建可能仍会出现旧警告，例如 vconsole eval、Browserslist outdated、联系页图片变量运行时解析提示。这些警告不影响当前构建产物生成。

## 部署

完整部署流程见 [DEPLOY_SERVER.md](./DEPLOY_SERVER.md)。

常规流程：

```bash
cd /www/wwwroot/podcast-together/server
npm install
npm run build
pm2 start dist/index.js --name podcast-together-api
pm2 save

cd /www/wwwroot/podcast-together
pnpm install
pnpm build
```

Nginx 站点根目录指向前端 `dist`，并把 `/api/` 和 `/ws` 反向代理到后端服务。使用本地歌曲上传时，需要确认 Nginx 上传体积限制足够大，例如：

```nginx
client_max_body_size 1024m;
```

## 不要提交的内容

不要提交以下文件或目录：

- `.env`
- `.env.local`
- `server/.env`
- QQ 音乐 Cookie
- `server/data/`
- `node_modules/`
- `dist/`
- `server/dist/`
- 本地部署压缩包，例如 `deploy-packages/`

## 资源说明

仓库中原 `resources/` 下的演示截图和打赏图已清理，不影响前端运行和构建。

## 后续计划

- 实机测试 QQ、网易云、酷狗、酷我大歌单渐进导入效果。
- 双浏览器测试队列追加和导入进度同步。
- 服务器部署更新。
- 可选：继续优化大歌单导入体验。

## 参考与致谢

- [copws/qq-music-api](https://github.com/copws/qq-music-api)
- [listen1/listen1_desktop](https://github.com/listen1/listen1_desktop)
- [metowolf/Meting](https://github.com/metowolf/Meting)
- [yenche123/podcast-together](https://github.com/yenche123/podcast-together)

## 许可

MIT
