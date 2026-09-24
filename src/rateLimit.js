'use strict';

// 按连接（IP 地址）做的简单固定窗口限流。
const buckets = new Map(); // key -> { count, resetAt }

function allow(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 1, resetAt: now + windowMs };
    buckets.set(key, b);
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

// 定期清理过期桶，避免内存增长。
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now > b.resetAt) buckets.delete(k);
  }
}, 60000).unref();

module.exports = allow;