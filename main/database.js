const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'xinyuan.db');
}

function initDatabase() {
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 用户配置
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 对话记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      emotion_score REAL,
      emotion_label TEXT,
      stressor_tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 情绪日志
  db.exec(`
    CREATE TABLE IF NOT EXISTS emotion_logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      hour INTEGER NOT NULL,
      score REAL NOT NULL,
      label TEXT,
      stressor TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 记忆锚点
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_anchors (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('event','person','feeling','milestone','trauma')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      emotion TEXT,
      importance INTEGER DEFAULT 5,
      is_marked INTEGER DEFAULT 0,
      recalled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 人格参数
  db.exec(`
    CREATE TABLE IF NOT EXISTS persona_params (
      param_name TEXT PRIMARY KEY,
      value REAL NOT NULL,
      range_min REAL DEFAULT 1,
      range_max REAL DEFAULT 10,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 成长里程碑
  db.exec(`
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 搭子匹配
  db.exec(`
    CREATE TABLE IF NOT EXISTS mate_matches (
      id TEXT PRIMARY KEY,
      mate_id TEXT NOT NULL,
      mate_nickname TEXT,
      match_mode TEXT NOT NULL CHECK(match_mode IN ('resonance','complement','growth','silent')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    )
  `);

  // 搭子对话
  db.exec(`
    CREATE TABLE IF NOT EXISTS mate_messages (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('me','mate','system')),
      content TEXT NOT NULL,
      emotion_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES mate_matches(id)
    )
  `);

  // 萌宠状态
  db.exec(`
    CREATE TABLE IF NOT EXISTS pet_state (
      id TEXT PRIMARY KEY DEFAULT 'main_pet',
      mood TEXT DEFAULT 'calm',
      energy INTEGER DEFAULT 7,
      level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0,
      skin TEXT DEFAULT 'default',
      accessories TEXT DEFAULT '[]',
      last_fed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 初始化默认数据
  initDefaultData();

  console.log('[DB] 数据库初始化完成:', getDbPath());
  return db;
}

function initDefaultData() {
  // 初始化人格参数默认值
  const defaults = [
    ['共情深度', 7], ['引导主动性', 5], ['幽默感', 4],
    ['坚定度', 5], ['温柔度', 8], ['结构化程度', 4],
    ['自发性问候', 3]
  ];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO persona_params (param_name, value) VALUES (?, ?)'
  );
  for (const [name, val] of defaults) {
    insert.run(name, val);
  }

  // 初始化萌宠
  db.prepare(
    'INSERT OR IGNORE INTO pet_state (id, mood, energy) VALUES (?, ?, ?)'
  ).run('main_pet', 'calm', 7);
}

function getDb() {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

module.exports = { initDatabase, getDb };
