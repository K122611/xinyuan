# 心元 EMO-Mate 搭子功能 | 完整技术设计文档

---

## 一、总体架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                    桌面端 Electron App                        │
├──────────────────────────────────────────────────────────────┤
│  UI层     │ 对话界面 │ 萌宠花园 │ 搭子空间 │ 情绪仪表盘       │
├───────────┼──────────┼──────────┼──────────┼──────────────────┤
│  服务层   │ 对话引擎 │ 情绪分析 │ 人格建模 │ 搭子匹配         │
├───────────┼──────────┼──────────┼──────────┼──────────────────┤
│  存储层   │ 本地SQLite (情绪日志+人格画像) │ 加密聊天记录      │
├───────────┼──────────┼──────────┼──────────┼──────────────────┤
│  接口层   │ Coze API │ 本地小模型(可选) │ DALL·E/图像生成    │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：敏感数据（情绪画像、搭子对话）优先本地存储，匹配计算可在本地或脱敏后上云。

---

## 二、AI 情绪人格建模引擎

### 2.1 不是问卷，是「长出来的画像」

传统做法：用户填MBTI量表 → 一次性标签 → 静态匹配  
心元做法：从每一次对话中持续学习 → 动态进化画像 → 实时共鸣匹配

### 2.2 七大核心建模维度

#### 维度一：情绪基调节律 (Emotional Baseline Rhythm)

| 子指标 | 采集方式 | 数据输出 |
|--------|----------|----------|
| 情绪波动周期 | 分析多日对话时间戳+情绪评分，发现节律模式 | "晨间低谷型" / "深夜EMO型" / "午后焦虑型" |
| 情绪均值与方差 | 滑动窗口统计情绪评分 | 情绪稳定度指数 (0-100) |
| 情绪恢复速度 | 从负面事件到恢复基线的平均时间 | 恢复弹性指数 |
| 情绪传染敏感度 | 是否容易被搭子情绪影响 | 高/中/低传染性 |

**技术实现**：
```python
# 情绪节律分析伪代码
class EmotionalRhythmAnalyzer:
    def analyze_rhythm(self, conversation_logs):
        # 1. 按小时段聚合情绪评分
        hourly_scores = self.aggregate_by_hour(conversation_logs)
        # 2. 检测周期性低谷和高峰
        trough_windows = self.detect_troughs(hourly_scores)
        peak_windows = self.detect_peaks(hourly_scores)
        # 3. 分类节律类型
        rhythm_type = self.classify_rhythm(trough_windows, peak_windows)
        # 4. 计算恢复速度
        recovery_rate = self.calc_recovery_rate(conversation_logs)
        return {
            "rhythm_type": rhythm_type,  # "morning_trough" / "night_emo" / "stable"
            "recovery_rate": recovery_rate,
            "volatility": np.std([log.emotion_score for log in conversation_logs])
        }
```

#### 维度二：核心压力源图谱 (Core Stressor Map)

| 压力源类别 | NLP识别关键词/模式 | 示例 |
|------------|-------------------|------|
| 学业压力 | 考试、绩点、论文、导师、毕业、考研 | "导师又催论文了" |
| 职场压力 | 加班、KPI、裁员、同事、跳槽、面试 | "今天周报写不出来" |
| 家庭关系 | 父母、催婚、逼相亲、吵架、期望 | "我妈说我不如邻居家孩子" |
| 亲密关系 | 分手、冷战、出轨、异地、表白 | "他三天没回消息了" |
| 社交焦虑 | 社恐、聚会、不知道怎么开口、被孤立 | "明天要团建我好紧张" |
| 存在焦虑 | 迷茫、意义、未来、空虚、不知道要什么 | "我不知道我到底想要什么" |
| 经济压力 | 房租、工资低、攒不下钱、负债 | "这个月又要吃土了" |
| 身体/健康 | 失眠、暴食、厌食、疲惫、生病 | "连续一周睡不好" |
| 身份认同 | 原生家庭、自我价值、我是谁 | "我好像从来没为自己活过" |

**技术实现**：
- 使用大模型进行 **细粒度话题分类**，而非简单关键词匹配
- 每次对话后生成 1-3 个压力源标签 + 强度评分
- 长期累积形成「压力源热力图」

```python
# 压力源识别 prompt 模板
STRESSOR_CLASSIFIER_PROMPT = """
你是一个心理学背景的情绪分析引擎。分析以下用户对话，识别其中涉及的核心压力源。

对话内容：
{conversation}

请输出 JSON（仅 JSON，不要其他文字）：
{
    "stressors": [
        {"category": "家庭关系", "sub_category": "父母期望", "intensity": 7.5, "excerpt": "..."},
        ...
    ],
    "primary_stressor": "家庭关系",
    "secondary_emotion": "委屈",
    "coping_style": "压抑"
}
"""
```

#### 维度三：情绪应对风格 (Coping Style Profile)

基于心理学经典框架（Lazarus & Folkman 应对理论），识别用户的应对模式：

| 类型 | 子类型 | 对话特征 | 匹配策略 |
|------|--------|----------|----------|
| **倾诉型** | 外化宣泄 | 大量描述事件细节和感受 | 匹配同样善于倾诉的搭子，或善于倾听的互补型 |
| **反思型** | 内化分析 | "为什么会这样""我是不是有问题" | 匹配共同反思、探讨的搭子 |
| **行动型** | 解决问题 | "我该怎么办""有什么办法" | 匹配有相似经历、能提供参考的搭子 |
| **回避型** | 转移注意力 | 快速切换话题、轻描淡写 | 匹配静默陪伴型或温和引导型 |
| **躯体化型** | 身体表达 | "头痛""睡不着""吃不下" | 匹配同样关注身心连接的搭子 |
| **寻求确认型** | 需要被认可 | "我这样想对吗""是不是我太矫情了" | 匹配能提供温和确认的搭子 |

**关键设计**：应对风格不是固定的——同一个人在不同情绪事件中可能采用不同风格。AI 记录的是「风格分布频谱」而非单一标签。

#### 维度四：共情能力指数 (Empathy Quotient)

从两方面评估：

| 方面 | 评估方式 | 用途 |
|------|----------|------|
| **接收共情能力** | AI共情后用户的情绪改善程度 | 高 → 更适合深度陪伴型搭子 |
| **给予共情能力** | 用户在与搭子对话中表达共情的质量 | 低 → 不适合匹配给需要大量情感支持的搭子 |

**技术实现**：
- AI 在搭子对话中实时评估双方的共情行为
- 使用编码方案（基于 Carl Rogers 的共情层次理论）：
  - Level 0: 无共情（"你想多了"）
  - Level 1: 表面回应（"会好的"）
  - Level 2: 部分理解（"我能理解你的感受"）
  - Level 3: 准确共情（"听起来你感到被忽视了，因为...这让你很受伤"）

#### 维度五：语言温度与风格 (Linguistic Warmth Profile)

| 维度 | 指标 | 匹配影响 |
|------|------|----------|
| 理性-感性 | 分析对话中逻辑词 vs 感受词的比例 | 相似风格匹配更顺畅 |
| 简洁-细腻 | 平均消息长度、细节描述密度 | 匹配相似表达习惯 |
| 幽默倾向 | 玩笑/自嘲/轻松表达的频率 | 幽默型匹配幽默型（否则可能误解） |
| 直接-含蓄 | 指令性语言 vs 试探性语言的比例 | 东亚文化常见差异，需匹配 |
| emoji/表情使用 | 使用频率和类型 | 代际/性格差异信号 |

#### 维度六：依恋模式倾向 (Attachment Style Tendency)

> ⚠️ 注意：这不是临床诊断，仅作为匹配参考

| 倾向 | 对话特征 | 匹配建议 |
|------|----------|----------|
| 安全型 | 能自然表达需求，也能尊重边界 | 可匹配任何类型 |
| 焦虑型 | 频繁确认、担心被抛弃、"你是不是也觉得我烦" | ❌ 不匹配另一个焦虑型（互相强化焦虑） |
| 回避型 | 回避深入话题、突然断联、独立宣言 | 匹配安全型或互补型，不匹配另一回避型 |
| 紊乱型 | 忽远忽近、矛盾表达 | 谨慎匹配，AI 重点守护 |

**技术实现**：
- 从对话中提取依恋相关行为模式（非一次性评估）
- 特别关注：用户对搭子"离开"的反应、对搭子"靠近"的反应
- 这需要至少 5-10 次搭子对话后才能初步建模

#### 维度七：成长阶段标签 (Growth Stage)

| 阶段 | 特征 | 匹配含义 |
|------|------|----------|
| 🌱 萌芽期 | 刚开始使用，尚未深入 | 匹配同类新手或温暖引导型 |
| 🌿 探索期 | 愿意尝试表达，但仍有防御 | 匹配安全型，建立信任 |
| 🌳 成长期 | 主动反思，寻求改变 | 匹配同样在成长的搭子 |
| 🍃 稳定期 | 情绪管理能力提升，使用频率下降 | 匹配"毕业搭子"，分享成长 |
| 🔄 复发期 | 回归，再次遇到困难 | 匹配过来人或互补型 |

---

## 三、搭子匹配算法设计

### 3.1 整体流程

```
用户触发匹配
    │
    ▼
┌─────────────────┐
│ Step1: 意图识别  │ ── AI分析用户当前状态和需求
└────────┬────────┘
         ▼
┌─────────────────┐
│ Step2: 模式选择  │ ── 推荐/用户选择匹配模式 (A/B/C/D)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Step3: 安全筛查  │ ── 排除危险组合、情绪风险组合
└────────┬────────┘
         ▼
┌─────────────────┐
│ Step4: 多维匹配  │ ── 加权计算匹配分数
└────────┬────────┘
         ▼
┌─────────────────┐
│ Step5: AI复核    │ ── 大模型审核匹配合理性
└────────┬────────┘
         ▼
┌─────────────────┐
│ Step6: 温柔呈现  │ ── 萌宠形象+情绪标签展示，非真人信息
└─────────────────┘
```

### 3.2 四种匹配模式的技术参数

#### 模式 A：共鸣搭子（相似匹配）

```python
def match_resonance(user_profile, candidates):
    """
    共鸣模式：最大化情绪状态的相似度
    """
    scores = []
    for candidate in candidates:
        score = weighted_sum({
            'current_emotion_similarity': cosine_sim(
                user_profile.current_emotion_vector,
                candidate.current_emotion_vector
            ) * 0.30,  # 当前情绪30%
            
            'stressor_overlap': jaccard_sim(
                user_profile.active_stressors,
                candidate.active_stressors
            ) * 0.25,  # 压力源重叠25%
            
            'coping_style_similarity': cosine_sim(
                user_profile.coping_vector,
                candidate.coping_vector
            ) * 0.15,  # 应对风格15%
            
            'rhythm_compatibility': rhythm_match_score(
                user_profile.rhythm,
                candidate.rhythm
            ) * 0.20,  # 节律20%
            
            'linguistic_style_similarity': cosine_sim(
                user_profile.linguistic_vector,
                candidate.linguistic_vector
            ) * 0.10,  # 语言风格10%
        })
        scores.append((candidate, score))
    
    return sorted(scores, key=lambda x: x[1], reverse=True)
```

**关键约束**：
- ❌ 两人当前情绪评分同时低于阈值（如都 < 3/10）→ 不匹配，推荐专业资源
- ❌ 两人核心压力源 100% 重叠且都在高强度 → 评估"情绪共振风险"（两个都在经历分手的人匹配，可能互相强化绝望感）
- ✅ 相似但不同层级的情绪最好：A情绪评分4分，B情绪评分5分（都在低谷但有微弱差异，B可以对A说"我昨天也是4分"）

#### 模式 B：互补搭子（过来人匹配）

```python
def match_complement(user_profile, candidates):
    """
    互补模式：寻找已经走过用户当前困境的人
    """
    scores = []
    for candidate in candidates:
        # 核心逻辑：候选人的"已走过标签" 与 用户的"当前困境"匹配
        past_match = 0
        for stressor in user_profile.active_stressors:
            if stressor in candidate.resolved_stressors:
                if candidate.resolution_quality[stressor] >= 0.7:  # 确保真正解决了
                    past_match += 1
        
        past_match_ratio = past_match / len(user_profile.active_stressors)
        
        # 还需要确保候选人当前状态良好（不能自己也正处于困境）
        safety_check = candidate.current_emotion_score > 6.0
        
        if past_match_ratio > 0.5 and safety_check:
            score = weighted_sum({
                'experience_match': past_match_ratio * 0.40,
                'current_stability': candidate.current_emotion_score / 10 * 0.30,
                'coping_style_complement': complement_score(
                    user_profile.coping_style,
                    candidate.coping_style
                ) * 0.20,  # 互补（如用户倾诉型，候选人善于倾听）
                'linguistic_warmth': candidate.empathy_quotient * 0.10,
            })
            scores.append((candidate, score))
    
    return sorted(scores, key=lambda x: x[1], reverse=True)
```

**"已走过"标签的生成**：
- AI 持续追踪用户的情绪事件和压力源
- 当某个压力源不再出现在对话中，且情绪评分回升 → 标记为该压力源"已走过"
- 当用户后续对话中提到该事件时表现出新的理解或释然 → "已走过"标签升级为"已成长"

#### 模式 C：成长搭子（目标匹配）

```python
def match_growth(user_profile, candidates):
    """
    成长模式：匹配有相同成长目标的搭子
    """
    # 成长目标库（AI从对话中提取或用户主动设定）
    GROWTH_GOALS = [
        "练习边界设定",
        "减少自我批判",
        "改善睡眠质量",
        "学习表达愤怒",
        "减少社交回避",
        "练习正念呼吸",
        "建立自信",
        "接受不确定性",
        "停止过度道歉",
        "学会说'不'",
    ]
    
    scores = []
    for candidate in candidates:
        goal_overlap = len(
            set(user_profile.growth_goals) & set(candidate.growth_goals)
        )
        goal_overlap_ratio = goal_overlap / max(
            len(user_profile.growth_goals), 1
        )
        
        score = weighted_sum({
            'goal_overlap': goal_overlap_ratio * 0.40,
            'commitment_level_similarity': abs(
                user_profile.commitment_score - candidate.commitment_score
            ) / 10 * (-1) + 1 * 0.25,  # 相似投入度
            'rhythm_compatibility': rhythm_match_score(
                user_profile.rhythm, candidate.rhythm
            ) * 0.20,
            'linguistic_style': linguistic_match * 0.15,
        })
        scores.append((candidate, score))
    
    return sorted(scores, key=lambda x: x[1], reverse=True)
```

**成长任务的AI协同设计**：
- AI 根据两人的共同目标，生成个性化练习计划
- 例如两人都选了"减少自我批判" → AI生成"每日自我肯定练习"，两人互相分享完成情况
- 萌宠花园里出现共同的成长任务进度（如共同灌溉一棵"自信树"）

#### 模式 D：静默搭子（存在匹配）

```python
def match_silent(user_profile, candidates):
    """
    静默模式：匹配同样不想说话但需要陪伴感的人
    核心是情绪状态的共鸣，而非语言交流
    """
    scores = []
    for candidate in candidates:
        if not candidate.is_silent_mode_available:
            continue
        
        score = weighted_sum({
            'emotion_similarity': cosine_sim(
                user_profile.current_emotion_vector,
                candidate.current_emotion_vector
            ) * 0.40,
            
            'pet_compatibility': pet_interaction_compatibility(
                user_profile.pet_state,
                candidate.pet_state
            ) * 0.35,  # 萌宠互动适配度
            
            'rhythm_compatibility': rhythm_match_score(
                user_profile.rhythm,
                candidate.rhythm
            ) * 0.25,
        })
        scores.append((candidate, score))
    
    return sorted(scores, key=lambda x: x[1], reverse=True)
```

### 3.3 安全筛查层（匹配前的强制检查）

```python
def safety_screening(user, candidate):
    """
    在匹配前必须通过的安全检查
    任何一项FAIL则不能匹配
    """
    checks = {
        # 1. 情绪传染风险
        "emotional_contagion_risk": (
            user.current_emotion_score >= 3.0 or 
            candidate.current_emotion_score >= 3.0
        ),  # 不允许两人都在极低情绪状态
        
        # 2. 依恋模式风险
        "attachment_risk": not (
            user.attachment_style == "焦虑型" and 
            candidate.attachment_style == "焦虑型"
        ),  # 双焦虑型禁止
        
        # 3. 危机状态检查
        "crisis_check": (
            user.crisis_level < 3 and 
            candidate.crisis_level < 3
        ),  # 任一方有严重危机信号时不匹配
        
        # 4. 历史不良行为
        "behavior_check": not (
            candidate in user.blocked_users or 
            candidate.has_behavior_warning
        ),
        
        # 5. 过度依赖检查
        "dependency_check": (
            user.active_matches_count < 3 and 
            candidate.active_matches_count < 3
        ),  # 预防"搭子成瘾"
        
        # 6. 匹配间隔
        "cooldown_check": (
            time_since_last_match(user, candidate) > timedelta(hours=24)
        ),  # 刚解绑的不能立刻再匹配
    }
    
    failed = [k for k, v in checks.items() if not v]
    return len(failed) == 0, failed
```

### 3.4 AI 复核层

匹配算法输出候选列表后，调用大模型做最终审核：

```python
AI_REVIEW_PROMPT = """
你是心元搭子匹配系统的最终审核员。请审核以下匹配建议的合理性。

用户A当前状态：
- 情绪评分：{user_a.emotion_score}/10
- 主要压力源：{user_a.stressors}
- 应对风格：{user_a.coping_style}
- 近期对话摘要：{user_a.recent_summary}

用户B当前状态：
- 情绪评分：{user_b.emotion_score}/10
- 主要压力源：{user_b.stressors}
- 应对风格：{user_b.coping_style}
- 近期对话摘要：{user_b.recent_summary}

匹配模式：{match_mode}
算法得分：{algorithm_score}

请评估：
1. 这次匹配对双方心理安全吗？
2. 可能的风险是什么？
3. 匹配质量评级：优秀/良好/有风险/不建议

输出JSON：
{
    "approved": true/false,
    "quality": "优秀/良好/有风险/不建议",
    "risks": ["风险描述"],
    "suggestions": "如果批准，给双方的初始破冰建议"
}
"""
```

---

## 四、与现有五大功能的深度融合

### 4.1 融合全景图

```
                      ┌──────────────────────┐
                      │   心元 EMO-Mate       │
                      └──────────┬───────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
  ┌──────────┐           ┌──────────────┐         ┌──────────────┐
  │ 个人空间  │◄─────────►│  搭子空间     │◄───────►│  萌宠花园     │
  │          │           │              │         │              │
  │ 功能1 共情│           │ 共鸣搭子     │         │ 个人萌宠     │
  │ 功能2 身心│           │ 互补搭子     │         │ 搭子萌宠互访 │
  │ 功能3 知识│           │ 成长搭子     │         │ 共同成长信物 │
  │ 功能5 安全│           │ 静默搭子     │         │ 情绪天气同步 │
  └──────────┘           └──────────────┘         └──────────────┘
```

### 4.2 各功能与搭子系统的具体融合

#### 与功能1「拟人化共情对话引擎」的融合

| 融合点 | 设计 |
|--------|------|
| **搭子间的AI引导** | 当搭子对话卡住时，AI共情引擎介入："我注意到你们好像都在等对方开口。要不要我先帮你们起个头？" |
| **共情技能传递** | AI将其"积极倾听"和"情绪确认"技巧转化为微提示，帮用户更好地回应搭子 |
| **搭子对话质量评估** | AI实时分析搭子对话中共情行为的发生频率，生成"搭子关系质量报告" |

#### 与功能2「动态身心觉察干预」的融合

| 融合点 | 设计 |
|--------|------|
| **双人呼吸练习** | AI检测到双方都紧张时，引导两人同时做呼吸练习——萌宠同步做深呼吸动画 |
| **搭子间的身体觉察** | "你的搭子刚刚完成了3分钟的呼吸练习，TA的萌宠正在舒展"——用萌宠传递身体觉察信号 |
| **情绪着陆的社交化** | 将单人的Somatic练习扩展为双人版："我们一起找房间里3样蓝色的东西" |

#### 与功能3「情绪智能知识库」的融合

| 融合点 | 设计 |
|--------|------|
| **搭子共学** | 根据两人的共同压力源，AI从知识库推荐相关理论文章，两人可以一起阅读讨论 |
| **知识卡片分享** | "你的搭子分享了一张知识卡片：'非暴力沟通的四步法'，要一起看看吗？" |
| **理论支撑的安全边界** | 匹配算法的安全规则必须引用知识库中的心理学理论作为依据 |

#### 与功能4「心智萌宠」的融合 — 最深的融合

| 融合点 | 设计 |
|--------|------|
| **萌宠双人互动** | 两只萌宠在「心元花园」中相遇，根据主人关系亲密度展示不同互动（靠近/玩耍/依偎） |
| **萌宠作为情感代理** | 用户通过萌宠向搭子传递情绪，减轻直接表达的压力 |
| **共同养宠** | 长期搭子可以共同领养一只"友谊宠物"，象征这段陪伴关系 |
| **情绪传染可视化** | 搭子的萌宠状态会温柔地反映在你花园的"天气"中 |
| **成长结晶系统** | 搭子关系中的里程碑（第一次互相安慰、完成第7天练习等）会生成花园中的纪念物 |

**萌宠交互技术设计**：
```python
# 萌宠状态传输协议（不传输文字，只传输宠物状态）
PET_STATE_PROTOCOL = {
    "pet_id": "uuid",
    "mood_indicator": "anxious",  # calm / anxious / sad / joyful / sleepy
    "action": "trembling",        # idle / playing / trembling / glowing / sleeping
    "energy_level": 3,            # 1-10
    "current_emotion_label": "被催婚后的无奈",
    "needs_company": True,        # 是否需要搭子萌宠来陪
    "available_interactions": ["sit_nearby", "share_food", "play_together"]
}
```

#### 与功能5「危机兜底安全机制」的融合

| 融合点 | 设计 |
|--------|------|
| **搭子对话中的危机监听** | AI 实时监测搭子对话，任何一方出现危机信号 → 立即触发分级响应 |
| **搭子保护机制** | 当一方出现危机，AI温和告知另一方并提供指导："你的搭子目前需要一些空间，这不是你的错" |
| **安全契约扩展** | 搭子之间可以建立"互相守护约定"（AI起草，双方确认） |
| **过度依赖预警** | 检测到一方对搭子产生过度依赖时，AI温柔干预并推荐多元化支持 |

---

## 五、数据隐私与存储架构

### 5.1 数据分级

| 数据级别 | 内容 | 存储位置 | 加密 |
|----------|------|----------|------|
| L0 公开 | 匹配偏好（模式选择）、萌宠外观 | 云端 | 无 |
| L1 脱敏 | 情绪标签（匿名化）、压力源类别、匿名人格向量 | 云端（用于匹配计算） | AES-256 |
| L2 敏感 | 完整人格画像、情绪日志、压力源详情 | 本端SQLite | AES-256 + 用户密钥 |
| L3 绝密 | 搭子对话内容、危机记录 | 仅本地 | 双重加密 |

### 5.2 匹配计算的隐私保护

```
用户A                   匹配服务器                  用户B
  │                       │                         │
  ├─加密的人格向量───────►│                         │
  │                       ├─计算相似度（密文计算）───┤
  │                       │◄──加密的人格向量────────┤
  │◄──匹配结果────────────┤                         │
  │                       │                         │
```

**方案选择**：
- **理想方案**：同态加密下的隐私计算（技术复杂度高）
- **务实方案**：脱敏向量上传 + 本地完整数据（快速实现，MVP优先）
- **长期目标**：联邦学习框架，用户数据永不离本地

### 5.3 搭子对话的存储策略

- 对话记录默认**端到端加密**
- 用户可随时**永久删除**与某搭子的所有记录
- 搭子关系结束后，AI 自动生成「陪伴纪念摘要」（脱敏版本），原始对话可自动清除
- 数据分析仅使用聚合后的匿名数据，不读取个人对话内容

---

## 六、技术栈建议

### 6.1 MVP 阶段技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| **桌面端框架** | Electron / Tauri | Tauri 更轻量（编译为原生应用，体积小） |
| **前端UI** | React + TypeScript | 组件丰富，适合复杂交互 |
| **本地数据库** | SQLite (better-sqlite3) | 轻量、可靠、进程内运行 |
| **本地加密** | SQLCipher / libsodium | 数据库级加密 |
| **AI对话** | Coze API（集成到桌面端） | 利用已有的Coze人设和工作流 |
| **情绪分析** | Coze Workflow + 本地小模型辅助 | 云端大模型做深度分析，本地做快速分类 |
| **本地小模型** | Ollama + Qwen2.5-7B / Llama-3.1-8B（量化版） | 本地隐私模式 |
| **萌宠渲染** | Lottie动画 / WebGL + Three.js | 2D萌宠用Lottie，3D花园用Three.js |
| **图像生成** | DALL·E 3 API / 本地Stable Diffusion | 萌宠状态图生成 |
| **匹配计算** | 云端Python微服务 | 向量检索+加权排序 |
| **向量数据库** | 本地用AnnLite，云端用Pinecone/Qdrant | 人格向量相似度检索 |

### 6.2 本地小模型方案（隐私模式核心）

```python
# 本地模型部署配置
LOCAL_MODEL_CONFIG = {
    "model": "Qwen2.5-7B-Instruct-Q4_K_M",  # 量化版，约4GB
    "runtime": "Ollama",
    "tasks": [
        "基础共情对话",       # 日常陪伴可用本地模型
        "情绪评分分类",       # 快速情绪评估
        "安全词检测",         # 本地实时检测敏感词
        "搭子对话质量评估",   # 轻量评估
    ],
    "cloud_fallback": [
        "深度人格分析",       # 需要更强推理能力
        "压力源细粒度分类",   # 需要更大模型
        "匹配AI复核",         # 需要综合判断
        "萌宠状态图生成",     # 需要图像模型
    ]
}
```

**混合模式策略**：
- 用户选择"隐私优先" → 所有分析优先走本地模型，仅在用户明确授权时才上云
- 用户选择"效果优先" → 本地做快速分类，云端做深度分析
- 搭子对话 → 全程本地，不经过云端（除非双方都同意AI辅助分析）

---

## 七、实现路线图

### Phase 1：基础情绪画像引擎（4-6周）
- [ ] 对话情绪评分系统（Coze Workflow）
- [ ] 压力源识别与分类
- [ ] 基础人格向量生成（初始5个维度）
- [ ] 本地SQLite存储框架

### Phase 2：搭子匹配MVP（6-8周）
- [ ] 共鸣搭子模式（模式A）
- [ ] 基础匹配算法
- [ ] 安全筛查层
- [ ] 匿名匹配界面（萌宠形象展示）
- [ ] 搭子对话基础功能

### Phase 3：深化与融合（6-8周）
- [ ] 互补/成长/静默三种模式
- [ ] 萌宠花园双人互动
- [ ] 搭子对话AI辅助
- [ ] 共同成长任务系统
- [ ] 关系健康仪表盘

### Phase 4：隐私强化与本地化（4-6周）
- [ ] 本地小模型部署
- [ ] 隐私优先模式
- [ ] 端到端加密搭子对话
- [ ] 本地匹配计算

### Phase 5：体验打磨（4周+）
- [ ] 萌宠交互动画完善
- [ ] 搭子成长纪念系统
- [ ] 声音/音效（可选）
- [ ] A/B测试优化匹配质量

---

## 八、关键成功指标（Metrics）

| 指标 | 定义 | 目标 |
|------|------|------|
| **匹配满意度** | 匹配后24小时内继续对话的比例 | > 60% |
| **搭子关系持续度** | 平均搭子关系维持天数 | > 14天 |
| **情绪改善率** | 与搭子对话后情绪评分提升的用户比例 | > 50% |
| **安全事件率** | 搭子对话中出现危机信号的比例 | < 5% |
| **负面匹配率** | 用户主动结束搭子而标记为"不舒适"的比例 | < 10% |
| **萌宠交互频率** | 用户通过萌宠与搭子互动的日均次数 | 增长趋势 |

---

## 九、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| 搭子间产生依赖 | 高 | 中 | 依赖检测+AI温和引导+限制同时搭子数 |
| 搭子对话质量低 | 中 | 中 | AI实时引导+共情微提示+匹配算法持续优化 |
| 恶意用户利用 | 低 | 高 | 行为监测+举报机制+AI守门人 |
| 隐私泄露 | 低 | 极高 | 本地存储优先+加密+最小必要原则 |
| 匹配不到合适搭子 | 中 | 中 | 冷启动策略（AI虚拟搭子过渡）+扩大用户池 |
| 情绪传染导致双输 | 中 | 高 | 安全筛查+实时情绪监测+AI主动干预 |

---

## 附录：与市面上产品的关键差异化总结

| 维度 | 市面产品 | 心元 EMO-Mate |
|------|----------|---------------|
| 匹配基础 | 静态人格测试 | 动态情绪画像（从对话中生长） |
| 匹配目标 | 建立长期社交关系 | 阶段性情绪陪伴 |
| 身份展示 | 真人照片/资料 | 萌宠形象+情绪标签 |
| 安全机制 | 事后举报 | AI实时守护+分级干预+匹配前筛查 |
| 对话辅助 | 无 / 破冰问题 | AI共情引导+微提示 |
| 关系形式 | 纯文字 | 文字+萌宠互动+花园共建 |
| 关系终点 | 加好友/持续联系 | 成长后的温柔告别+纪念 |
| 隐私策略 | 全云端 | 本地优先+端到端加密 |
| 文化适配 | 无 | 东亚语境+特有压力源识别 |
