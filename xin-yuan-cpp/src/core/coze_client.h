#pragma once

#include <string>
#include <functional>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// Coze API 配置
struct CozeConfig {
    std::string token = "pat_FkImL7mNOG5i6MWxSPi2gNMoANzUIOaxldxUHiSE46zrOEuzR1";
    std::string botId = "7647439577560727552";
    std::string baseUrl = "https://api.coze.cn/v3/chat";
};

// 对话消息
struct ChatMessage {
    std::string role;      // "user" or "assistant"
    std::string content;
    std::string timestamp;
};

// Coze API 客户端
class CozeClient {
public:
    // success, reply, conversationId, chatId, error
    using ChatCallback = std::function<void(bool success, const std::string& reply,
                                            const std::string& conversationId,
                                            const std::string& chatId,
                                            const std::string& error)>;

    CozeClient();
    ~CozeClient();

    void setConfig(const CozeConfig& config);
    CozeConfig config() const;

    // 发送聊天消息（异步）
    // initialChatId: 第一次对话的 chat_id，用于后续 message/list 轮询
    void chat(const std::string& message,
              const std::string& conversationId,
              const std::string& initialChatId,
              ChatCallback callback);

    // 获取对话历史
    void getHistory(const std::string& conversationId,
                    const std::string& chatId,
                    ChatCallback callback);

    // 取消当前请求
    void cancel();

    // 检查是否有进行中的请求
    bool isRunning() const;

private:
    CozeConfig m_config;
    mutable std::mutex m_mutex;
    std::atomic<bool> m_cancelled{false};
    std::thread m_workerThread;

    // 在后台线程执行聊天
    void doChat(const std::string& message,
                const std::string& conversationId,
                const std::string& initialChatId,
                ChatCallback callback);

    // 心元人设 Prompt（仅首条消息时作为 additional_messages 发送）
    static const char* PERSONA_PROMPT;

    // HTTP 请求辅助
    static size_t writeCallback(void* contents, size_t size, size_t nmemb, std::string* output);

    // 发送 HTTP POST 请求
    bool httpPost(const std::string& url,
                  const json& body,
                  const std::string& token,
                  std::string& response);

    // 发送 HTTP GET 请求
    bool httpGet(const std::string& url,
                 const std::string& token,
                 std::string& response);

    // 从 Coze 响应中提取文本内容（处理多种格式）
    std::string extractContent(const json& data);

    // 从 messages 数组中提取所有 answer 消息内容（按顺序拼接）
    std::string extractAnswersFromMessages(const json& messagesJson);

    // 轮询等待 Coze 完成（使用 message/list，基于时间截止而非次数）
    bool pollForCompletion(const std::string& conversationId,
                           const std::string& chatId,
                           const std::string& initialChatId,
                           const std::string& token,
                           std::string& reply);
};