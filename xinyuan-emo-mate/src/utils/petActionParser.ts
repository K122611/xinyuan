// ============ 宠物动作解析器 ============
// 解析 AI 回复文本，匹配关键词 → 仓鼠动画动作

export type PetAction =
  | 'listening'   // 倾听
  | 'comforting'  // 安抚
  | 'happy'       // 开心
  | 'worried'     // 担心
  | 'breathing'   // 呼吸引导
  | 'crisis'      // 危机
  | 'idle';       // 待机

export interface ActionResult {
  action: PetAction;
  keyword: string;
  confidence: number; // 0-1
}

// 关键词 → 动作映射表（按优先级排列，高优先级在前）
const ACTION_RULES: { action: PetAction; keywords: string[] }[] = [
  {
    action: 'crisis',
    keywords: [
      '冷静下来', '深呼吸', '别怕', '安全', '我在这',
      '对自己温柔一点', '立即联系', '拨打', '热线',
      '你不是一个人', '紧急', '求助',
    ],
  },
  {
    action: 'breathing',
    keywords: [
      '吸气', '呼气', '呼吸', '慢慢呼吸', '放松身体',
      '闭上眼睛', '小肚子一鼓一鼓', '深吸一口气',
      '跟我一起', '数到', '肌肉放松', '一步一步来',
    ],
  },
  {
    action: 'comforting',
    keywords: [
      '抱抱', '辛苦了', '没关系', '不怪你', '慢慢来',
      '我懂你', '你好棒', '不容易', '好样的',
      '已经做得很好了', '我知道你', '抱', '温柔',
      '陪着你', '没关系', '都会好起来的', '抱一个',
    ],
  },
  {
    action: 'worried',
    keywords: [
      '缩成一团', '担心', '紧张', '不安', '焦虑',
      '害怕', '难过', '伤心', '心疼', '低落',
      '压力', '崩溃', '睡不着', '好累', '迷茫',
    ],
  },
  {
    action: 'happy',
    keywords: [
      '举起小爪子', '竖起大拇指', '哈哈', '好有趣',
      '真棒', '太棒了', '有趣', '对了', '没错',
      '我也觉得', '笑', '喜欢', '厉害', '优秀',
      '了不起', '加油', '可以的', '好主意',
      '开心', '快乐', '棒', '赞',
    ],
  },
  {
    action: 'listening',
    keywords: [
      '竖了竖耳朵', '小耳朵动了动', '认真听着', '嗯嗯',
      '原来是这样', '听起来', '跟我说说', '我在听',
      '继续说', '然后呢', '具体是', '了解了',
      '明白了', '我明白', '懂得', '理解',
    ],
  },
];

/**
 * 解析文本，返回匹配的动作
 * @param text  AI 回复的完整文本
 * @returns     匹配结果，默认 'idle'
 */
export function parsePetAction(text: string): ActionResult {
  if (!text || text.trim().length === 0) {
    return { action: 'idle', keyword: '', confidence: 0 };
  }

  const lower = text.toLowerCase();

  // 按优先级遍历规则
  for (const rule of ACTION_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        // confidence 基于关键词位置：越靠前置信度越高
        // 同时也决定了如果有多个匹配，取最先匹配到的（即优先级最高的规则）
        const kwIndex = lower.indexOf(kw.toLowerCase());
        const confidence = Math.min(
          1,
          0.6 + 0.4 * (1 - kwIndex / Math.max(lower.length, 1))
        );
        return { action: rule.action, keyword: kw, confidence };
      }
    }
  }

  // 没匹配到任何关键词 → 待机
  return { action: 'idle', keyword: '', confidence: 0 };
}

/**
 * 每个动作对应的视觉配置
 */
export const ACTION_VISUALS: Record<
  PetAction,
  {
    emoji: string;          // 动画表情
    label: string;          // 中文标签
    color: string;          // 主题色
    animationClass: string; // CSS 动画类名
    duration: number;       // 持续时长 ms（0=一直持续直到切换）
  }
> = {
  listening:   { emoji: '👂', label: '倾听中',   color: '#7EB8DA', animationClass: 'anim-listening',   duration: 0 },
  comforting:  { emoji: '🤗', label: '安抚中',   color: '#FFB6C1', animationClass: 'anim-comforting',  duration: 0 },
  happy:       { emoji: '🎉', label: '开心',     color: '#FFD700', animationClass: 'anim-happy',       duration: 8000 },
  worried:     { emoji: '😟', label: '担心',     color: '#B0B0B0', animationClass: 'anim-worried',     duration: 6000 },
  breathing:   { emoji: '🫁', label: '呼吸引导', color: '#98D8C8', animationClass: 'anim-breathing',   duration: 0 },
  crisis:      { emoji: '🆘', label: '危机干预', color: '#FF6B6B', animationClass: 'anim-crisis',      duration: 0 },
  idle:        { emoji: '🐹', label: '待机',     color: '#E8C87A', animationClass: 'anim-idle',        duration: 0 },
};
