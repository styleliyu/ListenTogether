# 一起听

一个适合个人自部署的实时同步听歌 Web 应用。创建房间后分享链接或二维码，就可以和朋友同步播放音乐、播客和本地音频。

- 线上示例：[https://podcast.still-fantasy.com/](https://podcast.still-fantasy.com/)
- 当前仓库：[styleliyu/podcast-together-personal-](https://github.com/styleliyu/podcast-together-personal-.git)
- 原项目：[yenche123/podcast-together](https://github.com/yenche123/podcast-together)

## 功能

- 创建临时房间或常驻房间，支持房间命名、删除和二维码分享。
- 房间内同步播放、暂停、进度、倍速、上一首、下一首和播放模式。
- 支持播放队列、点击切歌、删除歌曲、跳过当前、下一首播放。
- 支持房间内文字聊天，消息通过 WebSocket 在当前房间内广播。
- 支持房主权限控制、成员管理和房主转让。
- 支持播客链接、音乐平台单曲/歌单链接、音频直链解析。
- 支持本地音频上传，以及 `ncm`、`qmc`、`kgm`、`kwm` 等常见加密音乐文件解析。
- 支持大歌单渐进式导入、导入进度、取消导入和失败详情展示。

## 技术栈

- 前端：React + Vite + TypeScript。
- 状态管理：Zustand。
- 实时通信：原生 WebSocket。
- 后端：Node.js + Express + ws。
- 数据库：SQLite，运行时数据默认保存在 `server/data/`。

当前版本继续使用 SQLite 保存房间与访客状态。未来计划单独设计 PostgreSQL 迁移，包括 schema 设计、迁移脚本、回滚方案和部署配置。

房间聊天记录当前只以内存保存每个房间最近 50 条消息，服务重启后聊天历史会丢失。当前聊天室允许房间内成员发送文字消息，并带有基础防刷屏限制；后续可扩展聊天权限开关。

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

前端根目录创建 `.env.local`：

```env
VITE_API_URL=http://127.0.0.1:3001/api
VITE_WEBSOCKET_URL=ws://127.0.0.1:3001/ws
VITE_HEARTBEAT_PERIOD=15
```

后端复制 `server/.env.example` 为 `server/.env`，按需修改：

```env
HOST=127.0.0.1
PORT=3001
DATABASE_PATH=./data/podcast-together.db
CORS_ORIGIN=http://127.0.0.1:5173
UPLOAD_DIR=./data/uploads
```

QQ 音乐 Cookie 和喜马拉雅开放平台密钥只应放在服务端环境变量或运行时文件里，不要提交到仓库。

## 构建与部署

前端：

```bash
pnpm build
```

后端：

```bash
cd server
npm run build
npm start
```

部署结构：前端 `dist` + 后端 `server/dist` + PM2 + Nginx。完整部署流程见 [DEPLOY_SERVER.md](./DEPLOY_SERVER.md)。

## 不要提交

- `.env`
- `.env.local`
- `server/.env`
- QQ 音乐 Cookie
- `server/data/`
- `node_modules/`
- `dist/`
- `server/dist/`
- 本地部署压缩包，例如 `deploy-packages/`

## 许可

MIT
