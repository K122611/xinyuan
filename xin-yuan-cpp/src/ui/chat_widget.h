#pragma once

#include <QWidget>
#include <QVBoxLayout>
#include <QScrollArea>
#include <QTextEdit>
#include <QPushButton>
#include <QTimer>
#include <QLabel>
#include <QKeyEvent>
#include <vector>

#include "chat_bubble.h"

class CozeClient;
class SessionManager;

// 自定义 TextEdit 以处理 Enter 键
class ChatInputEdit : public QTextEdit {
    Q_OBJECT
public:
    explicit ChatInputEdit(QWidget* parent = nullptr);
protected:
    void keyPressEvent(QKeyEvent* e) override;
signals:
    void enterPressed();
};

class ChatWidget : public QWidget {
    Q_OBJECT
public:
    explicit ChatWidget(CozeClient* client, SessionManager* sessionMgr, QWidget* parent = nullptr);

    void loadSession(const std::string& sessionId);
    void clearChat();

signals:
    void messageSent(const QString& text);

private slots:
    void onSendClicked();
    void onThinkingTick();

private:
    CozeClient* m_client;
    SessionManager* m_sessionMgr;
    std::string m_currentSessionId;

    QVBoxLayout* m_chatLayout;
    QScrollArea* m_scrollArea;
    QWidget* m_chatContainer;
    ChatInputEdit* m_inputField;
    QPushButton* m_sendButton;
    QHBoxLayout* m_inputLayout;

    // 思考动画
    QTimer* m_thinkingTimer;
    ChatBubble* m_thinkingBubble = nullptr;
    int m_thinkingDots = 0;
    bool m_isWaiting = false;

    void addBubble(const QString& text, ChatBubble::Role role);
    void sendMessage();
    void setInputEnabled(bool enabled);
    void scrollToBottom();

    // AI 回复回调
    void onChatResponse(bool success, const std::string& reply, const std::string& convId,
                        const std::string& chatId, const std::string& error);
};
