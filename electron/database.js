/**
 * 装扮数据持久化（SQLite）
 * 由 Electron 主进程调用
 */
const path = require('path');
const { app } = require('electron');

let db = null;

function initOutfitDatabase() {
  try {
    const Database = require('better-sqlite3');

    // Win10 兼容：userData 路径中存在中文时需正确处理
    const dbPath = path.join(app.getPath('userData'), 'outfits.db');

    db = new Database(dbPath);

    // 启用 WAL 模式提升并发性能
    db.pragma('journal_mode = WAL');

    // 创建装扮数据表
    db.exec(`
      CREATE TABLE IF NOT EXISTS outfit_unlocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        outfit_id TEXT NOT NULL UNIQUE,
        unlocked INTEGER NOT NULL DEFAULT 0,
        equipped INTEGER NOT NULL DEFAULT 0,
        acquired_at TEXT
      );

      CREATE TABLE IF NOT EXISTS coin_balance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL DEFAULT 500,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    console.log('[OutfitDB] 数据库初始化成功:', dbPath);
    return true;
  } catch (err) {
    console.error('[OutfitDB] 初始化失败:', err.message);
    db = null;
    return false;
  }
}

function getOutfitDB() {
  return db;
}

function getUnlockedOutfits() {
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT outfit_id, unlocked, equipped FROM outfit_unlocks').all();
    return rows;
  } catch (err) {
    console.error('[OutfitDB] 查询失败:', err.message);
    return [];
  }
}

function setOutfitUnlocked(outfitId, unlocked = true) {
  if (!db) return false;
  try {
    const stmt = db.prepare(`
      INSERT INTO outfit_unlocks (outfit_id, unlocked, acquired_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(outfit_id) DO UPDATE SET unlocked = ?, acquired_at = datetime('now')
    `);
    stmt.run(outfitId, unlocked ? 1 : 0, unlocked ? 1 : 0);
    return true;
  } catch (err) {
    console.error('[OutfitDB] 更新失败:', err.message);
    return false;
  }
}

function setOutfitEquipped(outfitId, equipped = true) {
  if (!db) return false;
  try {
    const stmt = db.prepare(`
      UPDATE outfit_unlocks SET equipped = ? WHERE outfit_id = ?
    `);
    stmt.run(equipped ? 1 : 0, outfitId);
    return true;
  } catch (err) {
    console.error('[OutfitDB] 装备更新失败:', err.message);
    return false;
  }
}

function unequipAll() {
  if (!db) return false;
  try {
    db.prepare('UPDATE outfit_unlocks SET equipped = 0').run();
    return true;
  } catch (err) {
    console.error('[OutfitDB] 卸下全部失败:', err.message);
    return false;
  }
}

function getCoinBalance() {
  if (!db) return 500;
  try {
    const row = db.prepare('SELECT amount FROM coin_balance ORDER BY id DESC LIMIT 1').get();
    return row ? row.amount : 500;
  } catch (err) {
    return 500;
  }
}

function updateCoinBalance(amount) {
  if (!db) return false;
  try {
    db.prepare('INSERT INTO coin_balance (amount) VALUES (?)').run(amount);
    return true;
  } catch (err) {
    console.error('[OutfitDB] 金币更新失败:', err.message);
    return false;
  }
}

function closeOutfitDatabase() {
  if (db) {
    try {
      db.close();
      console.log('[OutfitDB] 数据库已关闭');
    } catch (err) {
      console.error('[OutfitDB] 关闭失败:', err.message);
    }
    db = null;
  }
}

module.exports = {
  initOutfitDatabase,
  getOutfitDB,
  getUnlockedOutfits,
  setOutfitUnlocked,
  setOutfitEquipped,
  unequipAll,
  getCoinBalance,
  updateCoinBalance,
  closeOutfitDatabase,
};
