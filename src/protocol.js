'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const config = require('./config');
const connections = require('./connections');

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function fail(error) {
  return { ok: false, error };
}

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname || row.username,
    age: row.age == null ? null : row.age,
    bio: row.bio || '',
    avatar: row.avatar || null,
    isAdmin: !!row.is_admin
  };
}

function toPost(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    title: row.title,
    content: row.content || '',
    type: row.type,
    status: row.status || 'visible',
    createdAt: Number(row.created_at)
  };
}

function toReply(row) {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content || '',
    createdAt: Number(row.created_at)
  };
}

function toMessage(row) {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    content: row.content || '',
    type: row.type,
    createdAt: Number(row.created_at)
  };
}

const displayName = (u) => u.nickname || u.username;

// ---------------- 认证 ----------------

async function register(ws, p) {
  if (!config.site.allowRegister) return fail('当前服务器已关闭注册');
  const username = String(p.username || '').trim();
  const password = String(p.password || '');
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return fail('用户名需为3-32位字母/数字/下划线');
  if (password.length < 6) return fail('密码至少6位');

  const dup = await db.query('SELECT id FROM users WHERE username = ?', [username]);
  if (dup.length > 0) return fail('用户名已存在');

  const hash = await bcrypt.hash(password, 10);
  const id = uid();
  await db.query(
    'INSERT INTO users (id, username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, username, hash, username, now()]
  );

  const token = auth.issue(id);
  const user = toUser({ id, username, nickname: username, age: null, bio: '', avatar: null, is_admin: 0 });
  connections.add(ws, id);
  await connections.notifyPresence(id);
  return { ok: true, token, user };
}

async function login(ws, p) {
  const username = String(p.username || '').trim();
  const password = String(p.password || '');
  const rows = await db.query('SELECT * FROM users WHERE username = ?', [username]);
  if (rows.length === 0) return fail('用户名或密码错误');
  const u = rows[0];
  const pass = await bcrypt.compare(password, u.password_hash);
  if (!pass) return fail('用户名或密码错误');

  const token = auth.issue(u.id);
  connections.add(ws, u.id);
  await connections.notifyPresence(u.id);
  return { ok: true, token, user: toUser(u) };
}

async function logout(ws, p, ctx) {
  auth.revoke(ctx.token);
  connections.remove(ws);
  await connections.notifyPresence(ctx.userId);
  return { ok: true };
}

// ---------------- 首页 / 广场 ----------------

async function getHome(ws, p) {
  const notices = await db.query('SELECT * FROM posts WHERE type = ? AND status = ? ORDER BY created_at DESC LIMIT 5', ['notice', 'visible']);
  const posts = await db.query('SELECT * FROM posts WHERE type = ? AND status = ? ORDER BY created_at DESC LIMIT 20', ['post', 'visible']);
  return { ok: true, notices: notices.map(toPost), posts: posts.map(toPost) };
}

async function getPosts(ws, p) {
  const rows = await db.query('SELECT * FROM posts WHERE type = ? AND status = ? ORDER BY created_at DESC LIMIT 100', ['post', 'visible']);
  return { ok: true, items: rows.map(toPost) };
}

async function searchPosts(ws, p) {
  const q = String(p.query || '').trim();
  if (!q) return { ok: true, items: [] };
  const like = `%${q}%`;
  const rows = await db.query(
    'SELECT * FROM posts WHERE type = ? AND status = ? AND (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 100',
    ['post', 'visible', like, like]
  );
  return { ok: true, items: rows.map(toPost) };
}

async function createPost(ws, p, ctx) {
  const title = String(p.title || '').trim();
  const content = String(p.content || '').trim();
  if (!title) return fail('标题不能为空');
  const id = uid();
  const name = displayName(ctx.user);
  const status = config.site.postAudit ? 'pending' : 'visible';
  await db.query(
    'INSERT INTO posts (id, author_id, author_name, title, content, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ctx.user.id, name, title, content, 'post', status, now()]
  );
  const post = { id, authorId: ctx.user.id, authorName: name, title, content, type: 'post', status, createdAt: now() };
  if (config.site.postAudit) return { ok: true, post, notice: '已提交，等待管理员审核' };
  return { ok: true, post };
}

async function getPost(ws, p) {
  const postId = String(p.postId || '');
  const rows = await db.query('SELECT * FROM posts WHERE id = ? AND status = ?', [postId, 'visible']);
  if (rows.length === 0) return fail('帖子不存在');
  const replies = await db.query('SELECT * FROM replies WHERE post_id = ? ORDER BY created_at ASC', [postId]);
  return { ok: true, post: toPost(rows[0]), replies: replies.map(toReply) };
}

async function reply(ws, p, ctx) {
  const postId = String(p.postId || '');
  const content = String(p.content || '').trim();
  if (!content) return fail('回复不能为空');
  const id = uid();
  const name = displayName(ctx.user);
  await db.query(
    'INSERT INTO replies (id, post_id, author_id, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, postId, ctx.user.id, name, content, now()]
  );
  return { ok: true, reply: { id, postId, authorId: ctx.user.id, authorName: name, content, createdAt: now() } };
}

// ---------------- 好友 ----------------

async function getFriends(ws, p, ctx) {
  const meId = ctx.user.id;
  const rows = await db.query(
    `SELECT u.id, u.username, u.nickname, u.avatar, f.top
     FROM friendships f JOIN users u ON u.id = f.user_b
     WHERE f.user_a = ? AND f.blocked = 0 AND f.status = 'accepted'
     ORDER BY f.top DESC, u.username ASC`,
    [meId]
  );
  const items = [];
  for (const r of rows) {
    const last = await db.query(
      'SELECT content FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC LIMIT 1',
      [meId, r.id, r.id, meId]
    );
    items.push({
      id: r.id,
      username: r.username,
      nickname: r.nickname || r.username,
      avatar: r.avatar || null,
      online: connections.isOnline(r.id),
      top: !!r.top,
      lastMessage: last.length ? last[0].content : ''
    });
  }
  // 待我处理的好友申请（对方 → 我，status=pending）
  const reqs = await db.query(
    `SELECT u.id, u.username, u.nickname, u.avatar
     FROM friendships f JOIN users u ON u.id = f.user_a
     WHERE f.user_b = ? AND f.status = 'pending'`,
    [meId]
  );
  const requests = reqs.map((r) => ({
    id: r.id,
    username: r.username,
    nickname: r.nickname || r.username,
    avatar: r.avatar || null
  }));
  return { ok: true, items, requests };
}

async function addFriend(ws, p, ctx) {
  const target = String(p.target || '').trim();
  if (!target) return fail('请输入用户名或ID');
  const rows = await db.query('SELECT id FROM users WHERE username = ? OR id = ?', [target, target]);
  if (rows.length === 0) return fail('用户不存在');
  const friendId = rows[0].id;
  if (friendId === ctx.user.id) return fail('不能添加自己');

  const dup = await db.query(
    'SELECT id, user_a, status FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)',
    [ctx.user.id, friendId, friendId, ctx.user.id]
  );

  if (config.site.friendVerify) {
    if (dup.length > 0) {
      const r = dup[0];
      // 对方已向我发过申请 → 直接互相通过
      if (r.user_a === friendId && r.status === 'pending') {
        await db.query("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", [friendId, ctx.user.id]);
        await db.query(
          "INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?) ON DUPLICATE KEY UPDATE status = 'accepted'",
          [uid(), ctx.user.id, friendId, now()]
        );
        return { ok: true, notice: '已同意好友申请' };
      }
      return fail('已发送申请，等待对方同意');
    }
    await db.query(
      "INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
      [uid(), ctx.user.id, friendId, now()]
    );
    return { ok: true, notice: '已发送好友申请，等待对方同意' };
  }

  if (dup.length > 0) return fail('已经是好友');
  await db.query(
    "INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
    [uid(), ctx.user.id, friendId, now()]
  );
  await db.query(
    "INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
    [uid(), friendId, ctx.user.id, now()]
  );
  return { ok: true };
}

async function friendAction(ws, p, ctx) {
  const friendId = String(p.friendId || '');
  const action = String(p.action || '');
  const meId = ctx.user.id;

  // 好友申请处理（同意/拒绝，不要求已是好友）
  if (action === 'approve' || action === 'reject') {
    const pending = await db.query(
      "SELECT id FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending'",
      [friendId, meId]
    );
    if (pending.length === 0) return fail('没有待处理的申请');
    if (action === 'approve') {
      await db.query("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", [friendId, meId]);
      await db.query(
        "INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?) ON DUPLICATE KEY UPDATE status = 'accepted'",
        [uid(), meId, friendId, now()]
      );
    } else {
      await db.query("DELETE FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending'", [friendId, meId]);
    }
    return { ok: true };
  }

  const row = await db.query('SELECT id FROM friendships WHERE user_a = ? AND user_b = ?', [meId, friendId]);
  if (row.length === 0) return fail('不是好友');

  switch (action) {
    case 'top':
      await db.query('UPDATE friendships SET top = 1 WHERE user_a = ? AND user_b = ?', [meId, friendId]);
      break;
    case 'untop':
      await db.query('UPDATE friendships SET top = 0 WHERE user_a = ? AND user_b = ?', [meId, friendId]);
      break;
    case 'block':
      await db.query('UPDATE friendships SET blocked = 1 WHERE user_a = ? AND user_b = ?', [meId, friendId]);
      break;
    case 'unblock':
      await db.query('UPDATE friendships SET blocked = 0 WHERE user_a = ? AND user_b = ?', [meId, friendId]);
      break;
    case 'delete':
      await db.query(
        'DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)',
        [meId, friendId, friendId, meId]
      );
      break;
    default:
      return fail('未知操作');
  }
  return { ok: true };
}

// ---------------- 聊天 ----------------

async function getMessages(ws, p, ctx) {
  const friendId = String(p.friendId || '');
  const rows = await db.query(
    'SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at ASC LIMIT 200',
    [ctx.user.id, friendId, friendId, ctx.user.id]
  );
  return { ok: true, items: rows.map(toMessage) };
}

async function sendMessage(ws, p, ctx) {
  const to = String(p.to || '');
  const content = String(p.content || '');
  const msgType = String(p.msgType || 'text');
  if (!to) return fail('缺少接收方');
  if (!content) return fail('消息不能为空');
  const friend = await db.query(
    'SELECT id FROM friendships WHERE user_a = ? AND user_b = ? AND blocked = 0',
    [ctx.user.id, to]
  );
  if (friend.length === 0) return fail('对方不是你的好友');

  const id = uid();
  await db.query(
    'INSERT INTO messages (id, from_id, to_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, ctx.user.id, to, content, msgType, now()]
  );
  const message = { id, fromId: ctx.user.id, toId: to, content, type: msgType, createdAt: now() };
  connections.sendTo(to, { type: 'message', message });
  return { ok: true, message };
}

// ---------------- 资料 / 头像 ----------------

async function getProfile(ws, p, ctx) {
  const targetId = p.userId ? String(p.userId) : ctx.user.id;
  const rows = await db.query('SELECT * FROM users WHERE id = ?', [targetId]);
  if (rows.length === 0) return fail('用户不存在');
  return { ok: true, user: toUser(rows[0]) };
}

async function updateProfile(ws, p, ctx) {
  const nickname = String(p.nickname || '').trim();
  const ageRaw = p.age;
  let age = null;
  if (ageRaw !== null && ageRaw !== undefined && ageRaw !== '' && !Number.isNaN(Number(ageRaw))) {
    age = Math.max(0, Math.floor(Number(ageRaw)));
  }
  const bio = String(p.bio || '');
  await db.query('UPDATE users SET nickname = ?, age = ?, bio = ? WHERE id = ?', [nickname, age, bio, ctx.user.id]);
  const rows = await db.query('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  return { ok: true, user: toUser(rows[0]) };
}

async function updateAvatar(ws, p, ctx) {
  const avatar = String(p.avatar || '');
  if (avatar.length > 8 * 1024 * 1024) return fail('头像过大');
  await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, ctx.user.id]);
  const rows = await db.query('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  return { ok: true, user: toUser(rows[0]) };
}

// ---------------- 管理员 ----------------

async function adminPublish(ws, p, ctx) {
  const title = String(p.title || '').trim();
  const content = String(p.content || '').trim();
  if (!title) return fail('公告标题不能为空');
  const id = uid();
  const name = displayName(ctx.user);
  await db.query(
    'INSERT INTO posts (id, author_id, author_name, title, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, ctx.user.id, name, title, content, 'notice', now()]
  );
  const notice = { id, authorId: ctx.user.id, authorName: name, title, content, type: 'notice', createdAt: now() };
  connections.sendAll({ type: 'announcement', notice });
  return { ok: true, post: notice };
}

async function adminStats(ws, p) {
  const [users] = await db.query('SELECT COUNT(*) AS c FROM users');
  const [posts] = await db.query('SELECT COUNT(*) AS c FROM posts');
  const [messages] = await db.query('SELECT COUNT(*) AS c FROM messages');
  return { ok: true, users: users.c, posts: posts.c, messages: messages.c, online: connections.online.size };
}

async function adminUsers(ws, p) {
  const rows = await db.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 200');
  return { ok: true, items: rows.map(toUser) };
}

async function adminPosts(ws, p) {
  const rows = await db.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 200');
  return { ok: true, items: rows.map(toPost) };
}

async function adminDeletePost(ws, p) {
  const postId = String(p.postId || '');
  await db.query('DELETE FROM replies WHERE post_id = ?', [postId]);
  await db.query('DELETE FROM posts WHERE id = ?', [postId]);
  return { ok: true };
}

async function adminReviewPost(ws, p) {
  const postId = String(p.postId || '');
  const action = String(p.action || '');
  if (action === 'approve') {
    await db.query("UPDATE posts SET status = 'visible' WHERE id = ?", [postId]);
  } else if (action === 'reject') {
    await db.query('DELETE FROM replies WHERE post_id = ?', [postId]);
    await db.query('DELETE FROM posts WHERE id = ?', [postId]);
  } else {
    return fail('未知操作');
  }
  return { ok: true };
}

async function adminGetSettings(ws, p) {
  return {
    ok: true,
    site: {
      name: config.site.name,
      allowRegister: config.site.allowRegister,
      friendVerify: config.site.friendVerify,
      postAudit: config.site.postAudit
    }
  };
}

const handlers = {
  register,
  login,
  logout,
  get_home: getHome,
  get_posts: getPosts,
  search_posts: searchPosts,
  create_post: createPost,
  get_post: getPost,
  reply,
  get_friends: getFriends,
  add_friend: addFriend,
  friend_action: friendAction,
  get_messages: getMessages,
  send_message: sendMessage,
  get_profile: getProfile,
  update_profile: updateProfile,
  update_avatar: updateAvatar,
  admin_publish: adminPublish,
  admin_stats: adminStats,
  admin_users: adminUsers,
  admin_posts: adminPosts,
  admin_delete_post: adminDeletePost,
  admin_review_post: adminReviewPost,
  admin_get_settings: adminGetSettings
};

module.exports = { handlers, fail };