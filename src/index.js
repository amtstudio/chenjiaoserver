'use strict';

const fs = require('fs');
const https = require('https');
const { WebSocketServer } = require('ws');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const auth = require('./auth');
const rateLimit = require('./rateLimit');
const connections = require('./connections');
const { handlers, fail } = require('./protocol');

const PUBLIC_TYPES = new Set(['register', 'login']);
const ADMIN_TYPES = new Set(['admin_publish', 'admin_stats', 'admin_users', 'admin_posts', 'admin_delete_post', 'admin_review_post', 'admin_get_settings']);

async function handleMessage(ws, raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    return;
  }
  const type = obj && obj.type;
  if (!type) return;
  const id = obj.id;

  const send = (resp) => {
    if (id !== undefined && id !== null) resp.id = id;
    try {
      ws.send(JSON.stringify(resp));
    } catch (_) {
      /* 忽略发送失败 */
    }
  };

  if (!rateLimit(ws._rkey, 120, 60000)) return send(fail('请求过于频繁，请稍后再试'));

  const ctx = { userId: null, token: null, user: null };

  if (!PUBLIC_TYPES.has(type)) {
    const token = obj.token || '';
    const userId = auth.resolve(token);
    if (!userId) return send(fail('未登录或令牌失效'));
    ctx.token = token;
    ctx.userId = userId;
    try {
      const rows = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) return send(fail('用户不存在'));
      ctx.user = rows[0];
    } catch (e) {
      logger.error(`查询用户失败：${e.message}`);
      return send(fail('服务器内部错误'));
    }
    if (ADMIN_TYPES.has(type) && !ctx.user.is_admin) return send(fail('无管理员权限'));
  }

  const handler = handlers[type];
  if (!handler) return send(fail(`未知请求类型：${type}`));

  try {
    const resp = await handler(ws, obj, ctx);
    if (resp && typeof resp === 'object') send(resp);
  } catch (e) {
    logger.error(`处理 ${type} 失败：${e.message}`);
    send(fail('服务器内部错误'));
  }
}

function setupSocketServer(wss, label) {
  wss.on('connection', (ws) => {
    ws._rkey = (ws._socket && ws._socket.remoteAddress) || 'unknown';
    ws.userId = null;
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      handleMessage(ws, text).catch((e) => logger.error(e.message));
    });
    ws.on('close', () => {
      if (ws.userId) {
        connections.remove(ws);
        connections.notifyPresence(ws.userId).catch(() => {});
      }
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  heartbeat.unref();

  const port = label === 'ws' ? config.port : config.securePort || 443;
  logger.info(`${label.toUpperCase()} WebSocket 服务已监听端口 ${port}`);
}

async function main() {
  await db.ensureSchema();

  const wssPlain = new WebSocketServer({ port: config.port });
  setupSocketServer(wssPlain, 'ws');

  if (config.sslKey && config.sslCert) {
    const httpsServer = https.createServer({
      key: fs.readFileSync(config.sslKey),
      cert: fs.readFileSync(config.sslCert)
    });
    httpsServer.listen(config.securePort || 443, () => {
      logger.info(`HTTPS 服务已监听端口 ${config.securePort || 443}`);
    });
    const wssSecure = new WebSocketServer({ server: httpsServer });
    setupSocketServer(wssSecure, 'wss');
  }
}

main().catch((e) => {
  logger.error(`服务启动失败：${e.message}`);
  process.exit(1);
});