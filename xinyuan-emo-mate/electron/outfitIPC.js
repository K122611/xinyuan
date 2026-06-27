/**
 * 装扮系统 IPC 通信接口
 * 由 Electron 主进程注册
 */
const { ipcMain } = require('electron');

// 安全加载数据库（如果 better-sqlite3 不可用则降级）
let getUnlockedOutfits, setOutfitUnlocked, setOutfitEquipped, unequipAll, getCoinBalance, updateCoinBalance;
try {
  const db = require('./database');
  getUnlockedOutfits = db.getUnlockedOutfits;
  setOutfitUnlocked = db.setOutfitUnlocked;
  setOutfitEquipped = db.setOutfitEquipped;
  unequipAll = db.unequipAll;
  getCoinBalance = db.getCoinBalance;
  updateCoinBalance = db.updateCoinBalance;
} catch (e) {
  console.warn('[OutfitIPC] 数据库加载失败，使用空实现:', e.message);
  getUnlockedOutfits = () => [];
  setOutfitUnlocked = () => false;
  setOutfitEquipped = () => false;
  unequipAll = () => false;
  getCoinBalance = () => 500;
  updateCoinBalance = () => false;
}

function setupOutfitIPC() {
  // 获取已解锁装扮列表
  ipcMain.handle('outfit:getUnlocked', async () => {
    try {
      const rows = getUnlockedOutfits();
      return { success: true, data: rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 解锁装扮
  ipcMain.handle('outfit:unlock', async (_event, outfitId) => {
    try {
      const ok = setOutfitUnlocked(outfitId, true);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 装备装扮
  ipcMain.handle('outfit:equip', async (_event, outfitId) => {
    try {
      unequipAll(); // 先卸下全部
      const ok = setOutfitEquipped(outfitId, true);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 卸下装扮
  ipcMain.handle('outfit:unequip', async (_event, outfitId) => {
    try {
      const ok = setOutfitEquipped(outfitId, false);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 卸下全部装扮
  ipcMain.handle('outfit:unequipAll', async () => {
    try {
      const ok = unequipAll();
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取金币余额
  ipcMain.handle('outfit:getCoins', async () => {
    try {
      const amount = getCoinBalance();
      return { success: true, data: amount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 更新金币余额
  ipcMain.handle('outfit:updateCoins', async (_event, amount) => {
    try {
      const ok = updateCoinBalance(amount);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[OutfitIPC] 装扮 IPC 接口已注册');
}

module.exports = { setupOutfitIPC };
