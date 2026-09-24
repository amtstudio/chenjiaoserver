# 辰交服务端（chenjiaoserver）

「辰交」去中心化社交应用的 WebSocket 服务端，默认监听 **2684** 端口（支持 ws/wss），使用 Node.js + ws + MySQL。

## 技术栈

- Node.js · ws · mysql2 · dotenv · bcryptjs
- 持久化：MySQL（首次启动自动建库、建表、初始化管理员账号）
- 部署：Docker（`docker-compose.yml` 一键起 MySQL + 服务端）

## 目录结构

```
chenjiaoserver/
├── src/
│   ├── index.js        # 入口，启动 HTTP/HTTPS + WebSocket
│   ├── config.js       # 读取 .env，导出配置/个性化开关
│   ├── protocol.js     # 请求-响应分发与鉴权
│   ├── db.js           # 数据库连接、建库建表、初始化管理员
│   ├── auth.js         # 注册/登录/口令校验
│   ├── connections.js  # 连接与在线状态管理
│   ├── logger.js       # 日志
│   └── rateLimit.js    # 固定窗口限流
├── schema.sql          # 建表语句
├── docker-compose.yml  # MySQL + 服务端一键启动
├── Dockerfile
├── .env.example        # 配置样例（复制为 .env 后按需修改）
└── package.json
```

## 快速开始

### 方式 A：Docker Compose（推荐）

```bash
docker compose up -d --build
```

### 方式 B：本地运行（需本机 MySQL）

```bash
npm install
copy .env.example .env   # 按需修改 DB_* 与管理员账号
npm start                # 首次启动自动建库、建表并初始化管理员（默认 admin/admin123）
```

启动后服务端监听 `ws://0.0.0.0:2684`。可通过 `.env` 中的 `SECURE_PORT` + `SSL_CERT`/`SSL_KEY` 额外启用 `wss` 加密通道。

## 配置（.env）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 明文 WebSocket 端口 | 2684 |
| `SECURE_PORT` / `SSL_CERT` / `SSL_KEY` | 可选 wss 加密通道 | 空 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 连接 | 127.0.0.1 / 3306 / chenjiao |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初始管理员账号 | admin / admin123 |
| `SITE_NAME` | 站点名称（客户端展示） | 辰交 |
| `ALLOW_REGISTER` | 是否开放注册（0/1） | 1 |
| `FRIEND_VERIFY` | 好友验证（0=直接加好友，1=需同意） | 0 |
| `POST_AUDIT` | 发帖/回帖审核（0=直接公开，1=审核后可见） | 0 |

## 通信协议

客户端与服务端通过 WebSocket 交换 JSON 文本帧，采用「请求-响应 + 服务端主动推送」模型。请求帧携带 `type`（与可选 `id`），登录后每个受限请求需附带 `token`。详细协议见 [docs/PROTOCOL.md](../chenjiao/docs/PROTOCOL.md)（客户端仓库）。

## 开源协议

本项目以 [Apache License 2.0](LICENSE) 开源。
