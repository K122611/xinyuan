#include "ui/emotion_tag.h"
#include <QFont>

EmotionTag::EmotionTag(const QString& text, const QString& color, QWidget* parent)
    : QWidget(parent), m_color(color)
{
    auto* layout = new QHBoxLayout(this);
    layout->setContentsMargins(8, 4, 8, 4);

    m_label = new QLabel(text, this);
    m_label->setFont(QFont("Microsoft YaHei", 11));

    layout->addWidget(m_label);
    setFixedHeight(28);
    updateStyle();
}

void EmotionTag::setText(const QString& text) {
    m_label->setText(text);
}

void EmotionTag::setColor(const QString& color) {
    m_color = color;
    updateStyle();
}

void EmotionTag::updateStyle() {
    setStyleSheet(QString(
        "EmotionTag {"
        "  background-color: %1;"
        "  border-radius: 14px;"
        "  padding: 2px 8px;"
        "}"
        "EmotionTag QLabel {"
        "  color: white;"
        "}"
    ).arg(m_color));
}
