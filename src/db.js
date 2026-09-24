'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./logger');

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

/**
 * 执行 SQL（用 ? 占位符，内部走 mysql2 转义，兼容 LIMIT 数值绑定）。
 */
async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.query(sql, params);
  return rows;
}

/** 将 schema.sql 按分号拆分为单条语句执行。 */
function splitSchema(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 首次启动自动建库、建表并初始化管理员账号（幂等）。
 */
async function ensureSchema() {
  const { host, port, user, password, database } = config.db;

  const bootstrap = await mysql.createConnection({ host, port, user, password });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  const conn = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4' });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  for (const stmt of splitSchema(schema)) {
    await conn.query(stmt);
  }

  // 迁移：为旧库补列（已存在则忽略 duplicate column 错误）。
  for (const alter of [
    "ALTER TABLE posts ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'visible'",
    "ALTER TABLE friendships ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'accepted'"
  ]) {
    try {
      await conn.query(alter);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') logger.error(`迁移失败：${e.message}`);
    }
  }

  const [[{ c }]] = await conn.query('SELECT COUNT(*) AS c FROM users');
  if (c === 0) {
    const hash = await bcrypt.hash(config.admin.password, 10);
    await conn.query(
      'INSERT INTO users (id, username, password_hash, nickname, is_admin, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [crypto.randomUUID(), config.admin.username, hash, config.admin.username, Date.now()]
    );
    logger.info(`已初始化管理员账号：${config.admin.username}`);
  }

  await conn.end();
  logger.info('数据库就绪');
}

/** 手动初始化（`npm run init-db`）。 */
async function init() {
  await ensureSchema();
  logger.info('数据库初始化完成');
}

if (require.main === module && process.argv.includes('--init')) {
  init()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.error(`初始化失败：${e.message}`);
      process.exit(1);
    });
}

module.exports = { query, ensureSchema, init };