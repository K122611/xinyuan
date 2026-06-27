#include "ui/chat_bubble.h"
#include <QFont>
#include <QSpacerItem>
#include <QGraphicsDropShadowEffect>

ChatBubble::ChatBubble(const QString& text, Role role, QWidget* parent)
    : QWidget(parent), m_role(role)
{
    auto* mainLayout = new QHBoxLayout(this);
    mainLayout->setContentsMargins(12, 6, 12, 6);

    // 头像
    m_avatarLabel = new QLabel(this);
    m_avatarLabel->setFixedSize(36, 36);
    m_avatarLabel->setAlignment(Qt::AlignCenter);
    m_avatarLabel->setFont(QFont("Segoe UI Emoji", 16));

    // 名字 + 内容
    auto* contentLayout = new QVBoxLayout();
    contentLayout->setSpacing(2);

    m_nameLabel = new QLabel(roleName(), this);
    m_nameLabel->setFont(QFont("Microsoft YaHei", 10, QFont::Bold));
    m_nameLabel->setStyleSheet("color: #9CA3AF;");

    m_contentLabel = new QLabel(text, this);
    m_contentLabel->setFont(QFont("Microsoft YaHei", 13));
    m_contentLabel->setWordWrap(true);
    m_contentLabel->setMinimumWidth(40);
    m_contentLabel->setMaximumWidth(420);

    contentLayout->addWidget(m_nameLabel);
    contentLayout->addWidget(m_contentLabel);

    if (role == User) {
        mainLayout->addStretch();
        mainLayout->addLayout(contentLayout);
        mainLayout->addWidget(m_avatarLabel);
    } else {
        mainLayout->addWidget(m_avatarLabel);
        mainLayout->addLayout(contentLayout);
        mainLayout->addStretch();
    }

    updateStyle();
}

void ChatBubble::setText(const QString& text) {
    m_contentLabel->setText(text);
}

void ChatBubble::setRole(Role role) {
    m_role = role;
    m_nameLabel->setText(roleName());
    m_avatarLabel->setText(avatarText());
    updateStyle();
}

void ChatBubble::appendText(const QString& delta) {
    m_contentLabel->setText(m_contentLabel->text() + delta);
}

void ChatBubble::updateStyle() {
    m_avatarLabel->setText(avatarText());

    QString bubbleStyle = QString(
        "ChatBubble {"
        "  background: transparent;"
        "}"
        "ChatBubble QLabel#contentLabel {"
        "  background-color: %1;"
        "  border-radius: 14px;"
        "  padding: 10px 14px;"
        "  color: %2;"
        "}"
    ).arg(bubbleColor(), m_role == User ? "#FFFFFF" : "#E5E7EB");

    m_contentLabel->setObjectName("contentLabel");
    setStyleSheet(bubbleStyle);

    m_nameLabel->setStyleSheet(QString(
        "color: %1;"
    ).arg(m_role == User ? "#8B5CF6" : "#F59E0B"));
}

QString ChatBubble::roleName() const {
    switch (m_role) {
        case User: return "你";
        case Assistant: return "心元";
        case Thinking: return "心元正在思考...";
    }
    return "";
}

QString ChatBubble::avatarText() const {
    switch (m_role) {
        case User: return "🧑";
        case Assistant: return "💜";
        case Thinking: return "💭";
    }
    return "";
}

QString ChatBubble::bubbleColor() const {
    switch (m_role) {
        case User: return "#7C3AED";
        case Assistant: return "#1F2937";
        case Thinking: return "#374151";
    }
    return "#1F2937";
}
