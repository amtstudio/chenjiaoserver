'use strict';

require('dotenv').config();

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : n;
}

module.exports = {
  port: int(process.env.PORT, 2684),
  securePort: process.env.SECURE_PORT ? int(process.env.SECURE_PORT, 443) : null,
  sslCert: (process.env.SSL_CERT || '').trim(),
  sslKey: (process.env.SSL_KEY || '').trim(),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'chenjiao',
    password: process.env.DB_PASSWORD || 'chenjiao',
    database: process.env.DB_NAME || 'chenjiao'
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  site: {
    name: (process.env.SITE_NAME || '辰交').trim(),
    allowRegister: int(process.env.ALLOW_REGISTER, 1) !== 0,
    friendVerify: int(process.env.FRIEND_VERIFY, 0) !== 0,
    postAudit: int(process.env.POST_AUDIT, 0) !== 0
  }
};