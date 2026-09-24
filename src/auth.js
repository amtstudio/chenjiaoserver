'use strict';

const crypto = require('crypto');

// token -> userId（内存态，服务重启后客户端需重新登录）
const tokens = new Map();

function issue(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, userId);
  return token;
}

function resolve(token) {
  return tokens.get(token) || null;
}

function revoke(token) {
  tokens.delete(token);
}

module.exports = { issue, resolve, revoke };