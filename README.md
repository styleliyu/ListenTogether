# 一起听

一个适合个人自部署的实时同步听歌 Web 应用。你可以创建房间、分享链接，和朋友同步播放音乐、播客或本地音频。

- 线上示例：[https://podcast.still-fantasy.com/](https://podcast.still-fantasy.com/)
- 当前仓库：[styleliyu/podcast-together-personal-](https://github.com/styleliyu/podcast-together-personal-.git)
- 原项目：[yenche123/podcast-together](https://github.com/yenche123/podcast-together)

## 主要功能

- 房间内同步播放、暂停、进度、倍速和切歌。
- 支持房主和成员权限：播放控制、队列管理、歌单导入、房主转让。
- 支持播放队列、上一首、下一首、顺序播放、随机播放、单曲循环。
- 支持常驻房间，适合长期固定入口使用。
- 支持音乐平台单曲和歌单链接解析。
- 支持本地音频和常见加密音乐文件上传，前端会先解密再上传。
- 支持大歌单渐进式导入、导入进度、失败详情和取消导入。

## 技术栈

- 前端：React + Vite + TypeScript。
- 后端：Node.js + Express + WebSocket。
- 数据库：SQLite，运行时数据默认保存在 `server/data/`。
- 同步方式：HTTP 处理创建/进入房间，WebSocket 同步播放状态、队列和导入进度。

## 支持内容

支持的链接类型：

- 播客链接：小宇宙、Apple Podcasts 中国区、常见播客网页。
- 音频直链：公网可访问的 `.mp3`、`.m4a`、`.aac`。
- 音乐平台：网易云音乐、QQ 音乐、酷狗音乐、酷我音乐、百度/千千音乐。
- 喜马拉雅：需要配置开放平台应用。

支持的本地文件：

- 普通音频：`mp3`、`m4a`、`aac`、`flac`、`wav`、`ogg`、`wma` 等。
- 常见加密格式：`ncm`、`qmc`、`mflac`、`mgg`、`kgm`、`kwm` 等。

不保证支持会员、版权受限、下架或平台接口未返回播放地址的内容。

## 本地开发

建议使用 Node.js 18 LTS。前端锁文件为 pnpm v6 格式，建议使用 pnpm 8。

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

QQ_MUSIC_COOKIE=
QQ_MUSIC_COOKIE_FILE=./data/qq-music-cookie.txt

XIMALAYA_APP_KEY=
XIMALAYA_APP_SECRET=
```

QQ 音乐 Cookie 只应放在服务器环境变量或 `QQ_MUSIC_COOKIE_FILE` 指向的运行时文件里，不要提交到仓库。

## 构建

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

Nginx 站点根目录指向前端 `dist`，并把 `/api/` 和 `/ws` 反向代理到后端服务。本地歌曲上传需要放开请求体大小，例如：

```nginx
client_max_body_size 1024m;
```

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

## 参考与致谢

- [copws/qq-music-api](https://github.com/copws/qq-music-api)
- [listen1/listen1_desktop](https://github.com/listen1/listen1_desktop)
- [metowolf/Meting](https://github.com/metowolf/Meting)
- [yenche123/podcast-together](https://github.com/yenche123/podcast-together)

## 许可

MIT
