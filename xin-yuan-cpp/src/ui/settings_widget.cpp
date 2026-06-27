#include "ui/settings_widget.h"
#include <QScrollArea>
#include <QSpacerItem>

SettingsWidget::SettingsWidget(CozeClient* client, QWidget* parent)
    : QWidget(parent), m_client(client)
{
    setObjectName("settingsPage");

    auto* scrollArea = new QScrollArea(this);
    scrollArea->setWidgetResizable(true);
    scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);

    auto* container = new QWidget();
    auto* layout = new QVBoxLayout(container);
    layout->setContentsMargins(40, 32, 40, 32);
    layout->setSpacing(16);

    // 返回按钮
    m_backButton = new QPushButton("← 返回", container);
    m_backButton->setStyleSheet(
        "QPushButton { background: transparent; color: #94A3B8; text-align: left; font-size: 13px; padding: 4px; }"
        "QPushButton:hover { color: #E2E8F0; }"
    );
    m_backButton->setCursor(Qt::PointingHandCursor);

    // 标题
    auto* titleLabel = new QLabel("API 配置", container);
    titleLabel->setObjectName("pageTitle");

    auto* descLabel = new QLabel("配置你的 Coze API 密钥以连接心元的 AI 大脑", container);
    descLabel->setStyleSheet("color: #94A3B8; font-size: 13px; margin-bottom: 8px;");
    descLabel->setWordWrap(true);

    // 表单
    auto* formLayout = new QVBoxLayout();
    formLayout->setSpacing(12);

    // Token
    auto* tokenSection = new QLabel("API Token", container);
    tokenSection->setObjectName("sectionTitle");

    m_tokenInput = new QLineEdit(container);
    m_tokenInput->setPlaceholderText("pat_xxxxxxxxxxxxxxxxxxxxx");
    m_tokenInput->setEchoMode(QLineEdit::Password);

    auto* tokenHint = new QLabel("从 Coze 控制台获取你的 API 访问令牌", container);
    tokenHint->setStyleSheet("color: #64748B; font-size: 11px; padding: 0; margin: 0;");

    // Bot ID
    auto* botSection = new QLabel("Bot ID", container);
    botSection->setObjectName("sectionTitle");

    m_botIdInput = new QLineEdit(container);
    m_botIdInput->setPlaceholderText("7xxxxxxxxxxxxxxxx");

    auto* botHint = new QLabel("你的 Coze 机器人唯一标识符", container);
    botHint->setStyleSheet("color: #64748B; font-size: 11px; padding: 0; margin: 0;");

    // Base URL
    auto* urlSection = new QLabel("API 地址", container);
    urlSection->setObjectName("sectionTitle");

    m_baseUrlInput = new QLineEdit(container);
    m_baseUrlInput->setPlaceholderText("https://api.coze.cn/v3/chat");

    auto* urlHint = new QLabel("默认使用 Coze 中国区 API", container);
    urlHint->setStyleSheet("color: #64748B; font-size: 11px; padding: 0; margin: 0;");

    // 按钮行
    auto* buttonLayout = new QHBoxLayout();
    buttonLayout->setSpacing(12);

    m_saveButton = new QPushButton("💾 保存配置", container);
    m_saveButton->setObjectName("newSessionButton");
    m_saveButton->setCursor(Qt::PointingHandCursor);

    m_resetButton = new QPushButton("恢复默认", container);
    m_resetButton->setCursor(Qt::PointingHandCursor);

    buttonLayout->addWidget(m_saveButton);
    buttonLayout->addWidget(m_resetButton);
    buttonLayout->addStretch();

    // 状态标签
    m_statusLabel = new QLabel("", container);
    m_statusLabel->setAlignment(Qt::AlignCenter);
    m_statusLabel->setStyleSheet("font-size: 13px; padding: 4px;");

    // 组装
    formLayout->addWidget(tokenSection);
    formLayout->addWidget(m_tokenInput);
    formLayout->addWidget(tokenHint);
    formLayout->addSpacing(8);
    formLayout->addWidget(botSection);
    formLayout->addWidget(m_botIdInput);
    formLayout->addWidget(botHint);
    formLayout->addSpacing(8);
    formLayout->addWidget(urlSection);
    formLayout->addWidget(m_baseUrlInput);
    formLayout->addWidget(urlHint);

    layout->addWidget(m_backButton);
    layout->addWidget(titleLabel);
    layout->addWidget(descLabel);
    layout->addSpacing(8);
    layout->addLayout(formLayout);
    layout->addSpacing(8);
    layout->addLayout(buttonLayout);
    layout->addWidget(m_statusLabel);
    layout->addStretch();

    scrollArea->setWidget(container);

    auto* mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->addWidget(scrollArea);

    // 连接
    connect(m_saveButton, &QPushButton::clicked, this, &SettingsWidget::onSave);
    connect(m_resetButton, &QPushButton::clicked, this, &SettingsWidget::onReset);
    connect(m_backButton, &QPushButton::clicked, this, &SettingsWidget::back);

    loadConfig();
}

void SettingsWidget::loadConfig() {
    auto cfg = m_client->config();
    m_tokenInput->setText(QString::fromStdString(cfg.token));
    m_botIdInput->setText(QString::fromStdString(cfg.botId));
    m_baseUrlInput->setText(QString::fromStdString(cfg.baseUrl));
}

void SettingsWidget::onSave() {
    CozeConfig cfg;
    cfg.token = m_tokenInput->text().trimmed().toStdString();
    cfg.botId = m_botIdInput->text().trimmed().toStdString();
    cfg.baseUrl = m_baseUrlInput->text().trimmed().toStdString();

    if (cfg.token.empty() || cfg.botId.empty() || cfg.baseUrl.empty()) {
        m_statusLabel->setText("❌ 所有字段都为必填项");
        m_statusLabel->setObjectName("statusError");
        m_statusLabel->style()->unpolish(m_statusLabel);
        m_statusLabel->style()->polish(m_statusLabel);
        return;
    }

    m_client->setConfig(cfg);

    m_statusLabel->setText("✅ 配置已保存");
    m_statusLabel->setObjectName("statusSuccess");
    m_statusLabel->style()->unpolish(m_statusLabel);
    m_statusLabel->style()->polish(m_statusLabel);

    emit configSaved();
}

void SettingsWidget::onReset() {
    m_client->setConfig(CozeConfig{});
    loadConfig();
    m_statusLabel->setText("🔄 已恢复默认配置");
    m_statusLabel->setObjectName("");
    m_statusLabel->style()->unpolish(m_statusLabel);
    m_statusLabel->style()->polish(m_statusLabel);

    emit configSaved();
}
