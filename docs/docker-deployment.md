# GitHub Actions、GHCR 与 Docker Compose 部署

本文是当前生产部署流程。旧的 PM2 上传方式仅用于历史参考。

## 架构与发布边界

```text
push main
  -> GitHub Actions 构建与测试
  -> GHCR 发布 web/api 两个镜像（sha-<commit> 与 main）
  -> SSH 到 deploy 用户
  -> Compose 拉取不可变 SHA 标签
  -> 健康检查通过后完成；失败时恢复上一标签
```

- 宿主机宝塔/Nginx继续管理域名和 HTTPS。
- Web 容器仅监听宿主机 `127.0.0.1:8080`。
- API 不暴露宿主机端口，只接受 Web 容器的 Docker 内网访问。
- SQLite、上传文件和运行时 Cookie 挂载在 `/opt/listentogether/data`。
- 业务密钥只存放于服务器 `/opt/listentogether/server.env`。

## GitHub 配置

仓库 Variables：

| 名称 | 值 |
| --- | --- |
| `PRODUCTION_ORIGIN` | `https://podcast.still-fantasy.com` |
| `PRODUCTION_WEBSOCKET_URL` | `wss://podcast.still-fantasy.com/ws` |
| `DEPLOY_HOST` | 生产服务器 IP 或 SSH 域名 |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_ENABLED` | 初始化期间为 `false`，完成服务器准备后改为 `true` |

仓库 Secrets：

- `DEPLOY_SSH_KEY`：专用 Ed25519 私钥，不是个人日常 SSH 私钥。
- `DEPLOY_KNOWN_HOSTS`：核验过指纹的服务器 SSH host key。

Workflow 使用仓库自动签发的 `GITHUB_TOKEN` 发布 GHCR，不需要个人 GitHub Token。首次发布后，将 `listentogether-web` 和 `listentogether-api` 两个 Package 的可见性设为 Public，服务器即可匿名拉取。

## 服务器一次性初始化

1. 从 Docker 官方仓库安装 Docker Engine 与 Compose plugin。
2. 以 root 运行 `deploy/bootstrap-server.sh`，按提示粘贴专用部署公钥。
3. 重新建立 SSH 会话，确认：

   ```bash
   ssh deploy@SERVER_IP
   docker version
   docker compose version
   id -u deploy
   id -g deploy
   ```

`docker` 组具备等同 root 的主机控制能力，因此 `deploy` 只能用于本项目自动部署，不应作为日常登录账号。

## 生产配置

在 `/opt/listentogether` 创建：

```bash
cp compose.env.example compose.env
cp server.env.example server.env
chmod 600 compose.env server.env
```

将 `compose.env` 中的 `APP_UID`、`APP_GID` 改成服务器上 `deploy` 用户的实际 UID/GID。将现有后端 `.env` 的业务参数人工迁移到 `server.env`，不要把真实值提交到 GitHub。

SQLite 路径、上传路径、监听地址和端口由 Compose固定覆盖，不要在 `server.env` 中重复填写。网易私钥如果写在单行环境文件中，使用字面量 `\n` 表示换行。

## 迁移现有 SQLite 和上传数据

切换前必须备份当前生产数据。优先使用 SQLite 在线备份命令；如果服务器没有 `sqlite3`，先停止旧 PM2 进程再复制数据库、WAL 与上传目录，避免产生不一致快照。

目标结构：

```text
/opt/listentogether/
  compose.yml
  compose.env
  server.env
  deploy.sh
  data/
    podcast-together.db
    uploads/
    qq-music-cookie.txt
  backups/
```

迁移后让数据目录归属 `deploy` 的 UID/GID，并保留一次切换前备份。首次 Compose 验证成功前不要删除旧 PM2 目录。

## 宝塔/Nginx切换

Compose 启动并且以下地址返回 `ok` 后再切换站点：

```bash
curl --fail http://127.0.0.1:8080/healthz
```

将 HTTPS server block 中原有静态站点和 `/api`、`/ws` 规则替换成 `deploy/nginx-host.conf.example` 的统一反向代理配置。执行 `nginx -t` 成功后再重载 Nginx。

## 首次发布顺序

1. 保持 `DEPLOY_ENABLED=false`，合并 Workflow 到 `main`。
2. Actions 验证并发布两个镜像，但不会连接服务器。
3. 将两个 GHCR Package 设为 Public。
4. 完成服务器用户、公钥、host key、配置文件和数据备份。
5. 将 `DEPLOY_ENABLED` 改为 `true`。
6. 在 Actions 中手动运行 `Container build and deployment`，选择 `deploy=true`。
7. 后续每次推送 `main` 都会自动部署。

## 验证与回滚

每次发布至少检查：

```bash
cd /opt/listentogether
docker compose --env-file compose.env ps
curl --fail http://127.0.0.1:8080/healthz
```

还应通过浏览器验证首页、创建房间、WebSocket 双端同步和音频上传。应用仍是单 API 实例，发布会让现有 WebSocket 短暂重连，内存聊天记录会在重启时丢失。

自动部署失败时脚本会恢复 `compose.env` 中的上一镜像标签。人工回滚时，把 `IMAGE_TAG` 改为之前的 `sha-<40位提交>` 后执行：

```bash
docker compose --env-file compose.env pull
docker compose --env-file compose.env up -d --remove-orphans --wait --wait-timeout 180
```
