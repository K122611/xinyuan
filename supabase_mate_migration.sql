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

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_messages_friendship ON friend_messages(friendship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_emotion ON profiles(emotion_label);

-- ============================================================
-- 权限授予（RLS已禁用，但仍需表级GRANT）
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_messages TO anon, authenticated;
