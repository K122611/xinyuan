#include "ui/chat_widget.h"
#include "core/coze_client.h"
#include "core/session_manager.h"
#include <QSpacerItem>
#include <QScrollBar>
#include <QApplication>

// ========== ChatInputEdit ==========

ChatInputEdit::ChatInputEdit(QWidget* parent) : QTextEdit(parent) {}

void ChatInputEdit::keyPressEvent(QKeyEvent* e) {
    if (e->key() == Qt::Key_Return || e->key() == Qt::Key_Enter) {
        if (!(e->modifiers() & Qt::ShiftModifier)) {
            emit enterPressed();
            return;
        }
    }
    QTextEdit::keyPressEvent(e);
}

// ========== ChatWidget ==========

ChatWidget::ChatWidget(CozeClient* client, SessionManager* sessionMgr, QWidget* parent)
    : QWidget(parent), m_client(client), m_sessionMgr(sessionMgr)
{
    setObjectName("chatArea");

    auto* mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(0);

    // 聊天消息滚动区域
    m_scrollArea = new QScrollArea(this);
    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);

    m_chatContainer = new QWidget(this);
    m_chatLayout = new QVBoxLayout(m_chatContainer);
    m_chatLayout->setAlignment(Qt::AlignTop);
    m_chatLayout->setContentsMargins(16, 16, 16, 24);
    m_chatLayout->setSpacing(6);
    m_chatLayout->addStretch();

    m_scrollArea->setWidget(m_chatContainer);

    // 输入区域
    auto* inputArea = new QWidget(this);
    inputArea->setObjectName("inputArea");
    m_inputLayout = new QHBoxLayout(inputArea);
    m_inputLayout->setContentsMargins(16, 12, 16, 12);
    m_inputLayout->setSpacing(10);

    m_inputField = new ChatInputEdit(this);
    m_inputField->setPlaceholderText("输入消息...  Enter 发送，Shift+Enter 换行");
    m_inputField->setFixedHeight(44);
    m_inputField->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);

    m_sendButton = new QPushButton("➤", this);
    m_sendButton->setObjectName("sendButton");
    m_sendButton->setFixedSize(44, 44);
    m_sendButton->setEnabled(false);

    m_inputLayout->addWidget(m_inputField);
    m_inputLayout->addWidget(m_sendButton);

    mainLayout->addWidget(m_scrollArea);
    mainLayout->addWidget(inputArea);

    // 思考动画定时器
    m_thinkingTimer = new QTimer(this);
    connect(m_thinkingTimer, &QTimer::timeout, this, &ChatWidget::onThinkingTick);

    // 信号连接
    connect(m_sendButton, &QPushButton::clicked, this, &ChatWidget::onSendClicked);
    connect(m_inputField, &ChatInputEdit::enterPressed, this, &ChatWidget::onSendClicked);
    connect(m_inputField, &QTextEdit::textChanged, this, [this]() {
        m_sendButton->setEnabled(!m_inputField->toPlainText().trimmed().isEmpty() && !m_isWaiting);
    });
}

void ChatWidget::loadSession(const std::string& sessionId) {
    m_currentSessionId = sessionId;
    clearChat();

    auto messages = m_sessionMgr->getMessages(sessionId);
    for (const auto& msg : messages) {
        ChatBubble::Role role = (msg.role == "user") ? ChatBubble::User : ChatBubble::Assistant;
        addBubble(QString::fromStdString(msg.content), role);
    }
}

void ChatWidget::clearChat() {
    QLayoutItem* item;
    while ((item = m_chatLayout->takeAt(0)) != nullptr) {
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }
    m_chatLayout->addStretch();
}

void ChatWidget::addBubble(const QString& text, ChatBubble::Role role) {
    auto* bubble = new ChatBubble(text, role, m_chatContainer);

    QLayoutItem* stretch = m_chatLayout->takeAt(m_chatLayout->count() - 1);
    m_chatLayout->addWidget(bubble);
    m_chatLayout->addItem(stretch);

    scrollToBottom();
}

void ChatWidget::onSendClicked() {
    QString text = m_inputField->toPlainText().trimmed();
    if (text.isEmpty() || m_isWaiting) return;

    m_inputField->clear();
    m_inputField->setFixedHeight(44);

    // 添加用户气泡
    addBubble(text, ChatBubble::User);

    // 保存到会话
    m_sessionMgr->addMessage(m_currentSessionId, "user", text.toStdString());

    // 显示思考动画
    setInputEnabled(false);
    m_thinkingBubble = new ChatBubble("●", ChatBubble::Thinking, m_chatContainer);

    QLayoutItem* stretch = m_chatLayout->takeAt(m_chatLayout->count() - 1);
    m_chatLayout->addWidget(m_thinkingBubble);
    m_chatLayout->addItem(stretch);

    m_thinkingDots = 0;
    m_thinkingTimer->start(500);
    scrollToBottom();

    // 发送给 AI
    std::string convId = m_sessionMgr->currentSession().cozeConversationId;
    std::string chatId = m_sessionMgr->currentSession().cozeChatId;

    m_client->chat(text.toStdString(), convId, chatId,
        [this](bool success, const std::string& reply, const std::string& newConvId,
               const std::string& newChatId, const std::string& error) {
            QMetaObject::invokeMethod(this, [this, success, reply, newConvId, newChatId, error]() {
                onChatResponse(success, reply, newConvId, newChatId, error);
            }, Qt::QueuedConnection);
        });
}

void ChatWidget::onThinkingTick() {
    m_thinkingDots = (m_thinkingDots + 1) % 4;
    QString dots;
    for (int i = 0; i <= m_thinkingDots; i++) dots += "●";
    if (m_thinkingBubble) {
        m_thinkingBubble->setText(dots);
    }
}

void ChatWidget::onChatResponse(bool success, const std::string& reply,
                                 const std::string& convId, const std::string& chatId,
                                 const std::string& error) {
    m_thinkingTimer->stop();

    // 移除思考气泡
    if (m_thinkingBubble) {
        m_chatLayout->removeWidget(m_thinkingBubble);
        m_thinkingBubble->deleteLater();
        m_thinkingBubble = nullptr;
    }

    setInputEnabled(true);

    if (success && !reply.empty()) {
        QString replyText = QString::fromStdString(reply);
        addBubble(replyText, ChatBubble::Assistant);

        m_sessionMgr->addMessage(m_currentSessionId, "assistant", reply);

        // 保存 Coze conversation_id 和 chat_id
        auto session = m_sessionMgr->currentSession();
        if (!convId.empty() && session.cozeConversationId.empty()) {
            m_sessionMgr->updateCozeConversationId(m_currentSessionId, convId);
        }
        if (!chatId.empty() && session.cozeChatId.empty()) {
            m_sessionMgr->updateCozeChatId(m_currentSessionId, chatId);
        }
    } else {
        QString errMsg = error.empty() ? "出了一点问题" : QString::fromStdString(error);
        addBubble(QString("抱歉，%1 😢\n请检查网络后重试").arg(errMsg), ChatBubble::Assistant);
    }
}

void ChatWidget::setInputEnabled(bool enabled) {
    m_isWaiting = !enabled;
    m_sendButton->setEnabled(enabled && !m_inputField->toPlainText().trimmed().isEmpty());
    m_inputField->setEnabled(enabled);
    if (enabled) m_inputField->setFocus();
}

void ChatWidget::scrollToBottom() {
    QTimer::singleShot(50, this, [this]() {
        m_scrollArea->verticalScrollBar()->setValue(
            m_scrollArea->verticalScrollBar()->maximum());
    });
}
