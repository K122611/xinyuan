-- ============================================================
-- 搭子空间 (MateSpace) 数据库迁移
-- 用法：复制到 Supabase SQL Editor 执行
-- ============================================================

-- 1. 为 profiles 添加情绪匹配字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emotion_label TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mood_tags TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. 好友申请表
CREATE TABLE IF NOT EXISTS friend_requests (
  id BIGSERIAL PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_user_id, to_user_id)
);

-- 3. 好友关系表（双向各一条）
CREATE TABLE IF NOT EXISTS friends (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- 4. 好友聊天消息表
CREATE TABLE IF NOT EXISTS friend_messages (
  id BIGSERIAL PRIMARY KEY,
  friendship_id BIGINT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 共享频道ID（修复双向聊天——两人用同一个 channel_id）
--    channel_id = min(user1, user2) + '_' + max(user1, user2)
ALTER TABLE friends ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE friend_messages ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_channel ON friends(channel_id);
CREATE INDEX IF NOT EXISTS idx_friend_messages_channel ON friend_messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_emotion ON profiles(emotion_label);

-- ============================================================
-- 序列权限（BIGSERIAL 需要）
-- ============================================================
GRANT USAGE, SELECT ON SEQUENCE friend_requests_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE friends_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE friend_messages_id_seq TO anon, authenticated;

-- ============================================================
-- 表级权限授予
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_messages TO anon, authenticated;

-- ============================================================
-- RLS 策略（不禁用 RLS，用策略精细化控制）
-- ============================================================

-- ---- friend_requests ----
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

-- 查看：自己发出的 OR 收到的申请
CREATE POLICY "rq_select" ON friend_requests
  FOR SELECT USING (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  );

-- 插入：只有发送方是自己时才能发出申请
CREATE POLICY "rq_insert" ON friend_requests
  FOR INSERT WITH CHECK (
    auth.uid() = from_user_id
  );

-- 更新：发送方（重新发送/撤回）或接收方（接受/拒绝）均可更新
CREATE POLICY "rq_update" ON friend_requests
  FOR UPDATE USING (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  ) WITH CHECK (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  );

-- 删除：双方都可删除（发送方撤回 pending，接收方清除通知）
CREATE POLICY "rq_delete" ON friend_requests
  FOR DELETE USING (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  );

-- ---- friends ----
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

-- 查看：只看自己的好友列表
CREATE POLICY "fr_select" ON friends
  FOR SELECT USING (
    auth.uid() = user_id
  );

-- 插入：建立双向关系时可插入自己或对方的记录
CREATE POLICY "fr_insert" ON friends
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR auth.uid() = friend_id
  );

-- 删除：只能删自己这边的好友关系
CREATE POLICY "fr_delete" ON friends
  FOR DELETE USING (
    auth.uid() = user_id
  );

-- ---- friend_messages ----
ALTER TABLE friend_messages ENABLE ROW LEVEL SECURITY;

-- 查看：只能看自己所在频道（channel_id）的消息
CREATE POLICY "msg_select" ON friend_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friends
      WHERE friends.channel_id = friend_messages.channel_id
      AND friends.user_id = auth.uid()
    )
  );

-- 插入：发送方必须是自己，且属于该频道
CREATE POLICY "msg_insert" ON friend_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM friends
      WHERE friends.channel_id = friend_messages.channel_id
      AND friends.user_id = auth.uid()
    )
  );
