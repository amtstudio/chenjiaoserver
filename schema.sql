CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nickname VARCHAR(64) NOT NULL DEFAULT '',
  age INT NULL,
  bio TEXT,
  avatar LONGTEXT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  author_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  type VARCHAR(16) NOT NULL DEFAULT 'post',
  status VARCHAR(16) NOT NULL DEFAULT 'visible',
  created_at BIGINT NOT NULL,
  KEY idx_posts_type (type),
  KEY idx_posts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replies (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  post_id VARCHAR(36) NOT NULL,
  author_id VARCHAR(36) NOT NULL,
  author_name VARCHAR(64) NOT NULL,
  content TEXT,
  created_at BIGINT NOT NULL,
  KEY idx_replies_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friendships (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_a VARCHAR(36) NOT NULL,
  user_b VARCHAR(36) NOT NULL,
  top TINYINT(1) NOT NULL DEFAULT 0,
  blocked TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'accepted',
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_friend (user_a, user_b)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  from_id VARCHAR(36) NOT NULL,
  to_id VARCHAR(36) NOT NULL,
  content LONGTEXT,
  type VARCHAR(16) NOT NULL DEFAULT 'text',
  created_at BIGINT NOT NULL,
  KEY idx_msg_users (from_id, to_id),
  KEY idx_msg_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;