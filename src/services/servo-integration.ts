/**
 * 舵机集成 — 在 store 的情绪处理函数中调用
 *
 * 使用方法：在你的 store 文件（如 src/store/index.ts）顶部添加：
 *
 *   import { setEmotion, connect as connectServo } from '@/services/servo';
 *
 * 然后在情绪变化的处理函数末尾添加：
 *
 *   try {
 *     await setEmotion(moodLabel, intensity);
 *   } catch {}
 *
 * ============================================================
 */

// ========== 示例 1：在 store 初始化时连接舵机 ==========

// 在你的 store 创建函数（或 App.tsx 的 useEffect）中加入：
//
// import { connect as connectServo } from '@/services/servo';
//
// useEffect(() => {
//   // 应用启动后自动连接舵机（main.js 也会自动连，这里是渲染进程侧的确认）
//   connectServo().then((ok) => {
//     if (ok) console.log('[App] 舵机已就绪');
//   });
// }, []);


// ========== 示例 2：在情绪分析完成后驱动舵机 ==========

// 假设你的 store 中有类似这样的情绪分析函数：
//
// const analyzeMood = async (text: string) => {
//   const result = await callEmotionAPI(text);
//   const mood = result.primary_emotion;   // e.g. "happy", "sad"
//   const intensity = result.intensity;    // 0 ~ 1
//
//   // 更新 store
//   set({ currentMood: mood, moodIntensity: intensity });
//
//   // ★ 驱动舵机
//   try {
//     await setEmotion(mood, intensity);
//   } catch (err) {
//     // 舵机不可用时静默失败
//   }
// };


// ========== 示例 3：手动测试按钮 ==========

// 在设置页面或开发面板中加入测试按钮：
//
// import { setAngle } from '@/services/servo';
//
// <button onClick={() => setAngle(0)}>  最左 (愤怒) </button>
// <button onClick={() => setAngle(90)}> 居中 (平静) </button>
// <button onClick={() => setAngle(180)}>最右 (开心) </button>


// ========== 完整情绪→角度对照表 ==========

/*
  情绪        角度      含义
  ──────────────────────────────
  开心/高兴   180°     高能量正情绪（最右）
  兴奋        160°     高能量正情绪
  爱/感恩     145°     中度正情绪
  满意/满足   130°     中度正情绪
  平静/放松   110°     低度正情绪
  中性/平和    90°     居中默认位 ← Arduino 上电归中位
  惊喜        100°     微偏右侧
  无聊         60°     低能量负情绪
  疲惫         55°     低能量负情绪
  困惑         45°     中度负情绪
  焦虑/担忧    35°     中度负情绪
  悲伤         20°     低能量负情绪
  孤独         15°     低能量负情绪
  失望         10°     中能量负情绪
  沮丧          5°     高能量负情绪
  愤怒          0°     高能量负情绪（最左）
*/
