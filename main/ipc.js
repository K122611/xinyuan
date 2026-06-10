const { getDb } = require('./database');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

function setupIpcHandlers(ipcMain, getMainWindow) {
  // ============ 窗口控制 ============
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle('window:close', () => {
    getMainWindow()?.close();
  });
  ipcMain.handle('window:isMaximized', () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  // ============ 对话 ============
  ipcMain.handle('chat:send', async (_event, { sessionId, content }) => {
    const db = getDb();
    const msgId = uuidv4();
    db.prepare(`
      INSERT INTO conversations (id, session_id, role, content)
      VALUES (?, ?, 'user', ?)
    `).run(msgId, sessionId, content);
    return { id: msgId, success: true };
  });

  ipcMain.handle('chat:saveResponse', async (_event, { sessionId, content, emotionScore, emotionLabel, stressorTags }) => {
    const db = getDb();
    const msgId = uuidv4();
    db.prepare(`
      INSERT INTO conversations (id, session_id, role, content, emotion_score, emotion_label, stressor_tags)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?)
    `).run(msgId, sessionId, content, emotionScore, emotionLabel, stressorTags ? JSON.stringify(stressorTags) : null);
    return { id: msgId };
  });

  ipcMain.handle('chat:getHistory', async (_event, sessionId) => {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM conversations WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
    ).all(sessionId);
  });

  ipcMain.handle('chat:getRecentSessions', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT session_id, 
             MIN(created_at) as started_at,
             MAX(created_at) as last_active,
             COUNT(*) as message_count
      FROM conversations 
      GROUP BY session_id 
      ORDER BY last_active DESC 
      LIMIT 20
    `).all();
  });

  // ============ 情绪日志 ============
  ipcMain.handle('emotion:log', async (_event, { date, hour, score, label, stressor, note }) => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO emotion_logs (id, date, hour, score, label, stressor, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, date, hour, score, label, stressor, note);
    return { id };
  });

  ipcMain.handle('emotion:getDaily', async (_event, date) => {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM emotion_logs WHERE date = ? ORDER BY hour ASC'
    ).all(date);
  });

  ipcMain.handle('emotion:getWeekly', async () => {
    const db = getDb();
    return db.prepare(`
      SELECT date, AVG(score) as avg_score, 
             GROUP_CONCAT(DISTINCT label) as labels
      FROM emotion_logs 
      WHERE date >= date('now', '-7 days')
      GROUP BY date 
      ORDER BY date ASC
    `).all();
  });

  // ============ 记忆锚点 ============
  ipcMain.handle('memory:create', async (_event, { type, title, content, tags, emotion, importance, isMarked }) => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO memory_anchors (id, type, title, content, tags, emotion, importance, is_marked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, title, content, tags ? JSON.stringify(tags) : null, emotion, importance || 5, isMarked ? 1 : 0);
    return { id };
  });

  ipcMain.handle('memory:getAll', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM memory_anchors ORDER BY created_at DESC').all();
  });

  ipcMain.handle('memory:recall', async (_event, id) => {
    const db = getDb();
    db.prepare('UPDATE memory_anchors SET recalled_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    return db.prepare('SELECT * FROM memory_anchors WHERE id = ?').get(id);
  });

  // ============ 人格参数 ============
  ipcMain.handle('persona:getAll', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM persona_params').all();
  });

  ipcMain.handle('persona:update', async (_event, { paramName, value }) => {
    const db = getDb();
    db.prepare(
      'UPDATE persona_params SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE param_name = ?'
    ).run(value, paramName);
    return { success: true };
  });

  // ============ 萌宠 ============
  ipcMain.handle('pet:getState', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM pet_state WHERE id = ?').get('main_pet');
  });

  ipcMain.handle('pet:update', async (_event, updates) => {
    const db = getDb();
    const fields = Object.keys(updates);
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    db.prepare(`UPDATE pet_state SET ${setClause} WHERE id = 'main_pet'`).run(...values);
    return { success: true };
  });

  ipcMain.handle('pet:feed', async () => {
    const db = getDb();
    const pet = db.prepare('SELECT * FROM pet_state WHERE id = ?').get('main_pet');
    const newEnergy = Math.min(10, (pet.energy || 5) + 1);
    const newExp = (pet.exp || 0) + 10;
    const newLevel = Math.floor(newExp / 100) + 1;
    db.prepare(`
      UPDATE pet_state SET energy = ?, exp = ?, level = ?, last_fed_at = CURRENT_TIMESTAMP
      WHERE id = 'main_pet'
    `).run(newEnergy, newExp, newLevel);
    return { energy: newEnergy, exp: newExp, level: newLevel };
  });

  // ============ 里程碑 ============
  ipcMain.handle('milestone:unlock', async (_event, { type, title, description }) => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO milestones (id, type, title, description) VALUES (?, ?, ?, ?)
    `).run(id, type, title, description);
    return { id };
  });

  ipcMain.handle('milestone:getAll', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM milestones ORDER BY unlocked_at DESC').all();
  });

  // ============ 配置 ============
  ipcMain.handle('config:get', async (_event, key) => {
    const db = getDb();
    const row = db.prepare('SELECT value FROM user_config WHERE key = ?').get(key);
    return row ? row.value : null;
  });

  ipcMain.handle('config:set', async (_event, { key, value }) => {
    const db = getDb();
    db.prepare(
      'INSERT OR REPLACE INTO user_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(key, value);
    return { success: true };
  });

  // ============ 搭子匹配 ============
  ipcMain.handle('mate:getMatches', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM mate_matches ORDER BY created_at DESC').all();
  });

  ipcMain.handle('mate:createMatch', async (_event, { mateId, mateNickname, matchMode }) => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO mate_matches (id, mate_id, mate_nickname, match_mode)
      VALUES (?, ?, ?, ?)
    `).run(id, mateId, mateNickname, matchMode);
    return { id };
  });

  ipcMain.handle('mate:endMatch', async (_event, matchId) => {
    const db = getDb();
    db.prepare(
      "UPDATE mate_matches SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(matchId);
    return { success: true };
  });

  ipcMain.handle('mate:sendMessage', async (_event, { matchId, content }) => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO mate_messages (id, match_id, sender_role, content)
      VALUES (?, ?, 'me', ?)
    `).run(id, matchId, content);
    return { id };
  });

  ipcMain.handle('mate:getMessages', async (_event, matchId) => {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM mate_messages WHERE match_id = ? ORDER BY created_at ASC LIMIT 200'
    ).all(matchId);
  });

  console.log('[IPC] 所有IPC处理器已注册');
}

module.exports = { setupIpcHandlers };
