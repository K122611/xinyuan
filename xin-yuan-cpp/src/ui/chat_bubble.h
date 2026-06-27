#pragma once

#include <QWidget>
#include <QLabel>
#include <QVBoxLayout>
#include <QString>

class ChatBubble : public QWidget {
    Q_OBJECT
public:
    enum Role { User, Assistant, Thinking };

    explicit ChatBubble(const QString& text, Role role, QWidget* parent = nullptr);

    void setText(const QString& text);
    void setRole(Role role);
    void appendText(const QString& delta);

private:
    QLabel* m_contentLabel;
    QLabel* m_avatarLabel;
    QLabel* m_nameLabel;
    Role m_role;

    void updateStyle();
    QString roleName() const;
    QString avatarText() const;
    QString bubbleColor() const;
};
