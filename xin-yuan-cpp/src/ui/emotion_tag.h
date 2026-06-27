#pragma once

#include <QWidget>
#include <QLabel>
#include <QHBoxLayout>
#include <QString>

class EmotionTag : public QWidget {
    Q_OBJECT
public:
    explicit EmotionTag(const QString& text, const QString& color = "#8B5CF6", QWidget* parent = nullptr);

    void setText(const QString& text);
    void setColor(const QString& color);

private:
    QLabel* m_label;
    QString m_color;

    void updateStyle();
};
