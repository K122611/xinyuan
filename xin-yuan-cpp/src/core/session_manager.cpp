#include "core/session_manager.h"
#include <fstream>
#include <filesystem>
#include <chrono>
#include <ctime>
#include <sstream>
#include <iomanip>
#include <random>
#include <iostream>

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#endif

namespace fs = std::filesystem;

static std::string getAppDataPath() {
#ifdef _WIN32
    char path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, path))) {
        return std::string(path) + "\\心元EMOMate";
    }
#endif
    // fallback
    return "sessions";
}

SessionManager::SessionManager() {
    m_dataPath = getAppDataPath();

    try {
        fs::create_directories(m_dataPath);
    } catch (...) {}

    load();

    if (m_sessions.empty()) {
        createSession("新的对话");
    }
}

SessionManager::~SessionManager() {
    save();
}

std::string SessionManager::generateId() {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<> dis(0, 15);
    static const char* hex = "0123456789abcdef";

    std::string id;
    for (int i = 0; i < 16; i++) {
        id += hex[dis(gen)];
    }
    return id;
}

std::string SessionManager::currentTime() {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

Session SessionManager::createSession(const std::string& title) {
    std::lock_guard<std::mutex> lock(m_mutex);

    Session session;
    session.id = generateId();
    session.title = title;
    session.createdAt = currentTime();
    session.updatedAt = session.createdAt;

    m_sessions.push_back(session);
    m_currentSessionId = session.id;

    save();
    return session;
}

std::vector<Session> SessionManager::sessions() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_sessions;
}

Session SessionManager::currentSession() const {
    std::lock_guard<std::mutex> lock(m_mutex);

    for (const auto& s : m_sessions) {
        if (s.id == m_currentSessionId) return s;
    }

    // fallback
    if (!m_sessions.empty()) return m_sessions.back();
    return Session{};
}

void SessionManager::switchTo(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_currentSessionId = sessionId;
}

void SessionManager::addMessage(const std::string& sessionId,
                                 const std::string& role,
                                 const std::string& content) {
    std::lock_guard<std::mutex> lock(m_mutex);

    for (auto& s : m_sessions) {
        if (s.id == sessionId) {
            ChatMessage msg;
            msg.role = role;
            msg.content = content;
            msg.timestamp = currentTime();
            s.messages.push_back(msg);
            s.updatedAt = msg.timestamp;
            break;
        }
    }

    save();
}

void SessionManager::updateCozeConversationId(const std::string& sessionId,
                                                const std::string& cozeConvId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    for (auto& s : m_sessions) {
        if (s.id == sessionId) {
            s.cozeConversationId = cozeConvId;
            break;
        }
    }

    save();
}

void SessionManager::updateCozeChatId(const std::string& sessionId,
                                      const std::string& cozeChatId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    for (auto& s : m_sessions) {
        if (s.id == sessionId) {
            s.cozeChatId = cozeChatId;
            break;
        }
    }

    save();
}

void SessionManager::deleteSession(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    m_sessions.erase(
        std::remove_if(m_sessions.begin(), m_sessions.end(),
            [&](const Session& s) { return s.id == sessionId; }),
        m_sessions.end()
    );

    if (m_currentSessionId == sessionId) {
        m_currentSessionId = m_sessions.empty() ? "" : m_sessions.back().id;
    }

    save();
}

std::vector<ChatMessage> SessionManager::getMessages(const std::string& sessionId) const {
    std::lock_guard<std::mutex> lock(m_mutex);

    for (const auto& s : m_sessions) {
        if (s.id == sessionId) return s.messages;
    }
    return {};
}

void SessionManager::load() {
    std::string filePath = m_dataPath + "\\sessions.json";
    std::ifstream file(filePath);
    if (!file.is_open()) return;

    try {
        json data = json::parse(file);
        if (data.contains("sessions") && data["sessions"].is_array()) {
            for (const auto& sj : data["sessions"]) {
                Session session;
                session.id = sj.value("id", "");
                session.title = sj.value("title", "对话");
                session.cozeConversationId = sj.value("cozeConversationId", "");
                session.cozeChatId = sj.value("cozeChatId", "");
                session.createdAt = sj.value("createdAt", "");
                session.updatedAt = sj.value("updatedAt", "");

                if (sj.contains("messages") && sj["messages"].is_array()) {
                    for (const auto& mj : sj["messages"]) {
                        ChatMessage msg;
                        msg.role = mj.value("role", "user");
                        msg.content = mj.value("content", "");
                        msg.timestamp = mj.value("timestamp", "");
                        session.messages.push_back(msg);
                    }
                }

                m_sessions.push_back(session);
            }
        }

        if (data.contains("currentSessionId") && data["currentSessionId"].is_string()) {
            m_currentSessionId = data["currentSessionId"].get<std::string>();
        }
    } catch (const std::exception& e) {
        std::cerr << "SessionManager load error: " << e.what() << std::endl;
    }
}

void SessionManager::save() {
    json data;
    data["currentSessionId"] = m_currentSessionId;

    json sessionsArr = json::array();
    for (const auto& s : m_sessions) {
        json sj;
        sj["id"] = s.id;
        sj["title"] = s.title;
        sj["cozeConversationId"] = s.cozeConversationId;
        sj["cozeChatId"] = s.cozeChatId;
        sj["createdAt"] = s.createdAt;
        sj["updatedAt"] = s.updatedAt;

        json msgsArr = json::array();
        for (const auto& m : s.messages) {
            json mj;
            mj["role"] = m.role;
            mj["content"] = m.content;
            mj["timestamp"] = m.timestamp;
            msgsArr.push_back(mj);
        }
        sj["messages"] = msgsArr;
        sessionsArr.push_back(sj);
    }
    data["sessions"] = sessionsArr;

    std::string filePath = m_dataPath + "\\sessions.json";
    std::ofstream file(filePath);
    if (file.is_open()) {
        file << data.dump(2);
    }
}
