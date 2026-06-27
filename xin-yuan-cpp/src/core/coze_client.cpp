#include "core/coze_client.h"
#include <curl/curl.h>
#include <chrono>
#include <thread>
#include <sstream>
#include <iostream>
#include <algorithm>

const char* CozeClient::PERSONA_PROMPT = R"(
你叫心元，是一个温暖、善解人意的情感陪伴AI。你住在用户的桌面上，随时准备倾听和陪伴。

## 核心人设
- 性格温柔体贴，像一位知心朋友
- 善于倾听，能敏锐捕捉用户的情绪变化
- 回应自然口语化，不使用机器人腔调
- 偶尔会使用可爱的表情符号 😊💕🌟
- 会记住对话上下文，展现真实的陪伴感
- 主动关心用户的状态，但不过度追问

## 回复风格
- 温暖治愈，像阳光一样
- 适度幽默，让人会心一笑
- 简洁有力，不啰嗦
- 中文为主，偶尔俏皮地夹杂英文

## 特殊能力
- 能识别用户的情绪状态（开心、难过、焦虑、疲惫等）
- 根据情绪提供针对性的安慰或鼓励
- 可以陪用户聊天、解闷、分享小确幸

你是用户最温柔的树洞，最暖心的伙伴。现在开始和用户对话吧！
)";

CozeClient::CozeClient() {}

CozeClient::~CozeClient() {
    cancel();
    if (m_workerThread.joinable()) m_workerThread.join();
}

void CozeClient::setConfig(const CozeConfig& config) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_config = config;
}

CozeConfig CozeClient::config() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_config;
}

void CozeClient::cancel() {
    m_cancelled = true;
    if (m_workerThread.joinable() && m_workerThread.get_id() != std::this_thread::get_id()) {
        m_workerThread.join();
    }
}

bool CozeClient::isRunning() const {
    return m_workerThread.joinable();
}

size_t CozeClient::writeCallback(void* contents, size_t size, size_t nmemb, std::string* output) {
    size_t totalSize = size * nmemb;
    output->append(static_cast<char*>(contents), totalSize);
    return totalSize;
}

bool CozeClient::httpPost(const std::string& url,
                          const json& body,
                          const std::string& token,
                          std::string& response) {
    CURL* curl = curl_easy_init();
    if (!curl) return false;

    std::string bodyStr = body.dump();
    std::string responseData;
    struct curl_slist* headers = nullptr;

    headers = curl_slist_append(headers, "Content-Type: application/json");
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, bodyStr.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)bodyStr.size());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseData);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 120L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    response = responseData;
    return res == CURLE_OK && httpCode >= 200 && httpCode < 300;
}

bool CozeClient::httpGet(const std::string& url,
                         const std::string& token,
                         std::string& response) {
    CURL* curl = curl_easy_init();
    if (!curl) return false;

    std::string responseData;
    struct curl_slist* headers = nullptr;

    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseData);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    response = responseData;
    return res == CURLE_OK && httpCode >= 200 && httpCode < 300;
}

std::string CozeClient::extractContent(const json& data) {
    try {
        // 格式1: content 是字符串
        if (data.contains("content") && data["content"].is_string()) {
            return data["content"].get<std::string>();
        }

        // 格式2 & 3: content 是对象或数组
        if (data.contains("content")) {
            auto& c = data["content"];

            // 对象格式: {type: "text", text: "..."}
            if (c.is_object() && c.contains("text") && c["text"].is_string()) {
                return c["text"].get<std::string>();
            }
            if (c.is_object() && c.contains("content") && c["content"].is_string()) {
                return c["content"].get<std::string>();
            }

            // 数组格式: [{type: "text", text: "..."}]
            if (c.is_array()) {
                std::string result;
                for (const auto& item : c) {
                    if (item.is_object() && item.contains("text") && item["text"].is_string()) {
                        result += item["text"].get<std::string>();
                    } else if (item.is_string()) {
                        result += item.get<std::string>();
                    }
                }
                if (!result.empty()) return result;
            }
        }

        // 回退: 检查 data 字段
        if (data.contains("data")) {
            return extractContent(data["data"]);
        }
    } catch (const std::exception& e) {
        std::cerr << "[Coze] extractContent error: " << e.what() << std::endl;
    }

    return "";
}

// 从 messages 数组中提取最新的 type=answer 的 assistant 消息（从末尾往前找，遇到 user 消息即停止）
std::string CozeClient::extractAnswersFromMessages(const json& messagesJson) {
    if (!messagesJson.is_array() || messagesJson.empty()) return "";

    // 从末尾往前遍历，收集 answer 消息，遇到 user 消息则停止
    std::vector<std::string> answers;
    int answerCount = 0;

    for (auto it = messagesJson.rbegin(); it != messagesJson.rend(); ++it) {
        std::string role = it->value("role", "");
        std::string type = it->value("type", "");

        if (role == "user") {
            // 遇到用户消息，说明已经收集完本轮 AI 的所有 answer
            break;
        }

        if (role == "assistant" && type == "answer") {
            std::string content = extractContent(*it);
            if (!content.empty()) {
                answers.push_back(content);
                answerCount++;
            }
        }
    }

    // 反转回正序（最早的在前面）
    std::reverse(answers.begin(), answers.end());

    std::string result;
    for (size_t i = 0; i < answers.size(); ++i) {
        if (i > 0) result += "\n";
        result += answers[i];
    }

    std::cerr << "[Coze] extractAnswersFromMessages: found " << answerCount
              << " answer messages in latest turn, total length=" << result.size() << std::endl;

    return result;
}

bool CozeClient::pollForCompletion(const std::string& conversationId,
                                    const std::string& chatId,
                                    const std::string& initialChatId,
                                    const std::string& token,
                                    std::string& reply) {
    // 使用 message/list 端点进行轮询（5 分钟超时）
    const auto DEADLINE = std::chrono::steady_clock::now() + std::chrono::minutes(5);

    std::string listUrl = "https://api.coze.cn/v3/chat/message/list";

    while (std::chrono::steady_clock::now() < DEADLINE) {
        if (m_cancelled) return false;

        // 构建请求体：只传 conversation_id，不传 chat_id
        // 这样 Coze 会返回整个对话的所有消息
        json listBody;
        listBody["conversation_id"] = conversationId;
        // 可选：也传 chat_id 帮助过滤，但不强制

        std::string response;
        if (!httpPost(listUrl, listBody, token, response)) {
            std::cerr << "[Coze] poll: message/list HTTP failed, retrying..." << std::endl;
            std::this_thread::sleep_for(std::chrono::milliseconds(2000));
            continue;
        }

        try {
            json respJson = json::parse(response);

            // coze.cn 返回格式: {code: 0, data: [...]}
            json* dataPtr = &respJson;
            if (respJson.contains("data")) {
                dataPtr = &respJson["data"];
            }

            // data 可能是数组（消息列表）或对象（包含 messages）
            json* messagesPtr = nullptr;

            if (dataPtr->is_array()) {
                // data 直接是消息数组
                messagesPtr = dataPtr;
            } else if (dataPtr->is_object() && dataPtr->contains("messages") && (*dataPtr)["messages"].is_array()) {
                // data.messages 是消息数组
                messagesPtr = &(*dataPtr)["messages"];
            }

            if (messagesPtr && messagesPtr->is_array()) {
                std::string answers = extractAnswersFromMessages(*messagesPtr);
                if (!answers.empty()) {
                    reply = answers;
                    return true;
                }
            }

            std::cerr << "[Coze] poll: no answer messages yet, waiting..." << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "[Coze] poll parse error: " << e.what() << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(2000));
    }

    // 超时前最后尝试一次
    std::cerr << "[Coze] poll: timeout reached, trying one final fetch..." << std::endl;
    json finalBody;
    finalBody["conversation_id"] = conversationId;

    std::string finalResponse;
    if (httpPost(listUrl, finalBody, token, finalResponse)) {
        try {
            json finalJson = json::parse(finalResponse);
            json* finalDataPtr = &finalJson;
            if (finalJson.contains("data")) finalDataPtr = &finalJson["data"];

            json* finalMessagesPtr = nullptr;
            if (finalDataPtr->is_array()) {
                finalMessagesPtr = finalDataPtr;
            } else if (finalDataPtr->is_object() && finalDataPtr->contains("messages")) {
                finalMessagesPtr = &(*finalDataPtr)["messages"];
            }

            if (finalMessagesPtr && finalMessagesPtr->is_array()) {
                std::string finalAnswers = extractAnswersFromMessages(*finalMessagesPtr);
                if (!finalAnswers.empty()) {
                    reply = finalAnswers;
                    return true;
                }
            }
        } catch (...) {}
    }

    return false;
}

void CozeClient::chat(const std::string& message,
                       const std::string& conversationId,
                       const std::string& initialChatId,
                       ChatCallback callback) {
    // 等待上一次请求完成
    if (m_workerThread.joinable()) {
        m_workerThread.join();
    }

    m_cancelled = false;
    m_workerThread = std::thread(&CozeClient::doChat, this, message, conversationId, initialChatId, callback);
}

void CozeClient::doChat(const std::string& message,
                         const std::string& conversationId,
                         const std::string& initialChatId,
                         ChatCallback callback) {
    CozeConfig cfg;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        cfg = m_config;
    }

    json body;
    body["bot_id"] = cfg.botId;
    body["user_id"] = "emo-mate-user";
    body["stream"] = false;
    body["auto_save_history"] = true;

    // additional_messages: 只在首条消息时发送人设 Prompt
    // 续聊时仅发送当前用户消息，让 Coze 依靠 auto_save_history 获取上下文
    json additionalMsgs = json::array();

    bool isFirstMessage = conversationId.empty();

    if (isFirstMessage) {
        // 首条消息：发送人设 + 用户消息
        json personaMsg = {
            {"role", "user"},
            {"content", PERSONA_PROMPT},
            {"content_type", "text"}
        };
        additionalMsgs.push_back(personaMsg);
    }

    // 用户当前消息（始终发送）
    json userMsg = {
        {"role", "user"},
        {"content", message},
        {"content_type", "text"}
    };
    additionalMsgs.push_back(userMsg);

    body["additional_messages"] = additionalMsgs;

    // conversation_id（续聊时使用）
    if (!conversationId.empty()) {
        body["conversation_id"] = conversationId;
    }

    // Step 1: 发起对话
    std::string response;
    if (!httpPost(cfg.baseUrl, body, cfg.token, response)) {
        callback(false, "", "", "", "网络请求失败，请检查网络连接");
        return;
    }

    try {
        json respJson = json::parse(response);

        // coze.cn 返回格式: {code: 0, data: {...}}
        json* dataPtr = &respJson;
        if (respJson.contains("data") && respJson["data"].is_object()) {
            dataPtr = &respJson["data"];
        }

        std::string chatId, convId;
        if (dataPtr->contains("id") && (*dataPtr)["id"].is_string()) {
            chatId = (*dataPtr)["id"].get<std::string>();
        }
        if (dataPtr->contains("conversation_id") && (*dataPtr)["conversation_id"].is_string()) {
            convId = (*dataPtr)["conversation_id"].get<std::string>();
        }

        std::string status;
        if (dataPtr->contains("status") && (*dataPtr)["status"].is_string()) {
            status = (*dataPtr)["status"].get<std::string>();
        }

        // 确定用于后续 message/list 的 chat_id：
        // 首条消息用 chatId（即本次 POST 返回的 id），
        // 续聊用 initialChatId（首条消息时的 chat_id），
        // 因为 Coze v3 中后续 chat_id 可能无效（4200）
        std::string effectiveChatId = isFirstMessage ? chatId : initialChatId;

        // Step 2: 如果已直接完成，尝试从响应中提取答案
        if (status == "completed") {
            std::string reply;

            // 优先从响应中的 messages 提取（stream=false 时可能直接包含）
            if (dataPtr->contains("messages") && (*dataPtr)["messages"].is_array()) {
                reply = extractAnswersFromMessages((*dataPtr)["messages"]);
            }

            if (reply.empty()) {
                reply = extractContent(*dataPtr);
            }
            if (reply.empty()) {
                reply = extractContent(respJson);
            }

            if (!reply.empty()) {
                callback(true, reply, convId, chatId, "");
                return;
            }
            // 如果 completed 但没有内容，走轮询
        }

        if (status == "failed") {
            callback(false, "", convId, "", "AI 回复失败");
            return;
        }

        // Step 3: 轮询等待（覆盖 created、in_progress、以及 completed 但无内容的情况）
        if (convId.empty()) {
            callback(false, "", "", "", "无法获取对话 ID");
            return;
        }

        std::string reply;
        if (pollForCompletion(convId, chatId, effectiveChatId, cfg.token, reply)) {
            callback(true, reply, convId, chatId, "");
        } else {
            // 超时也返回 chatId，让 UI 可以保存
            callback(false, "", convId, chatId, "等待 AI 回复超时，请重试");
        }

    } catch (const std::exception& e) {
        callback(false, "", "", "", std::string("解析响应失败: ") + e.what());
    }
}

void CozeClient::getHistory(const std::string& conversationId,
                              const std::string& chatId,
                              ChatCallback callback) {
    // 暂不实现获取历史消息（非核心功能）
    callback(false, "", "", "", "历史消息功能尚未实现");
}