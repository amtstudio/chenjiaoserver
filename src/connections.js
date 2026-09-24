'use strict';

const db = require('./db');

// userId -> Set<ws>（同一用户可多端在线）
const online = new Map();

function send(ws, obj) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {
      /* 忽略发送失败 */
    }
  }
}

function add(ws, userId) {
  remove(ws);
  ws.userId = userId;
  let set = online.get(userId);
  if (!set) {
    set = new Set();
    online.set(userId, set);
  }
  set.add(ws);
}

function remove(ws) {
  const uid = ws.userId;
  if (!uid) return;
  const set = online.get(uid);
  if (set) {
    set.delete(ws);
    if (set.size === 0) online.delete(uid);
  }
  ws.userId = null;
}

function isOnline(userId) {
  return online.has(userId);
}

function sendTo(userId, obj) {
  const set = online.get(userId);
  if (!set) return;
  for (const ws of set) send(ws, obj);
}

function sendAll(obj) {
  for (const set of online.values()) {
    for (const ws of set) send(ws, obj);
  }
}

/** 通知某用户的所有好友其在线状态发生变化。 */
async function notifyPresence(userId) {
  try {
    const rows = await db.query('SELECT user_b AS fid FROM friendships WHERE user_a = ?', [userId]);
    for (const r of rows) {
      sendTo(String(r.fid), { type: 'presence', userId });
    }
  } catch (_) {
    /* 忽略 */
  }
}

module.exports = { online, add, remove, isOnline, sendTo, sendAll, notifyPresence };