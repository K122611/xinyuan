#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <nlohmann/json.hpp>
#include "core/coze_client.h"  // for ChatMessage

using json = nlohmann::json;

struct Session {
    std::string id;
    std::string title;
    std::string cozeConversationId;
    std::string cozeChatId;  // 初始 chat_id，用于后续消息拉取
    std::vector<ChatMessage> messages;
    std::string createdAt;
    std::string updatedAt;
};

class SessionManager {
public:
    SessionManager();
    ~SessionManager();

    // 创建新会话
    Session createSession(const std::string& title = "新的对话");

    // 获取所有会话
    std::vector<Session> sessions() const;

    // 获取当前活跃会话
    Session currentSession() const;

    // 切换活跃会话
    void switchTo(const std::string& sessionId);

    // 添加消息到当前会话
    void addMessage(const std::string& sessionId,
                    const std::string& role,
                    const std::string& content);

    // 更新 Coze conversation_id
    void updateCozeConversationId(const std::string& sessionId,
                                   const std::string& cozeConvId);

    // 更新 Coze chat_id（初始 chat_id，用于后续消息拉取）
    void updateCozeChatId(const std::string& sessionId,
                          const std::string& cozeChatId);

    // 删除会话
    void deleteSession(const std::string& sessionId);

    // 获取会话消息
    std::vector<ChatMessage> getMessages(const std::string& sessionId) const;

private:
    mutable std::mutex m_mutex;
    std::string m_dataPath;
    std::vector<Session> m_sessions;
    std::string m_currentSessionId;

    void load();
    void save();
    std::string generateId();
    std::string currentTime();
};
