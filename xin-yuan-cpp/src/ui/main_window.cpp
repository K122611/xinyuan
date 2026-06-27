#include "ui/main_window.h"
#include "ui/chat_widget.h"
#include "ui/settings_widget.h"
#include <QApplication>
#include <QFile>
#include <QMessageBox>
#include <QMenuBar>
#include <QAction>
#include <QListWidgetItem>
#include <QFont>

MainWindow::MainWindow(QWidget* parent)
    : QMainWindow(parent)
{
    m_client = new CozeClient();
    m_sessionMgr = new SessionManager();

    setupUI();
    applyStyle();
    refreshSessionList();

    // 加载第一个会话
    auto sessions = m_sessionMgr->sessions();
    if (!sessions.empty()) {
        loadSession(sessions[0].id);
    } else {
        auto session = m_sessionMgr->createSession("新的对话");
        loadSession(session.id);
    }

    setWindowTitle("心元 EMO-Mate");
    resize(900, 640);
    setMinimumSize(700, 500);
}

MainWindow::~MainWindow() {
    delete m_client;
    delete m_sessionMgr;
}

void MainWindow::setupUI() {
    // 中央 Widget
    auto* centralWidget = new QWidget(this);
    setCentralWidget(centralWidget);

    auto* mainLayout = new QVBoxLayout(centralWidget);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(0);

    // 标题栏
    auto* titleLayout = new QVBoxLayout();
    setupTitleBar(titleLayout);
    mainLayout->addLayout(titleLayout);

    // 分割器：侧边栏 + 内容区
    m_splitter = new QSplitter(Qt::Horizontal, centralWidget);

    // 侧边栏
    m_sidebar = new QWidget();
    m_sidebar->setObjectName("sidebar");
    auto* sidebarLayout = new QVBoxLayout(m_sidebar);
    sidebarLayout->setContentsMargins(0, 0, 0, 0);
    sidebarLayout->setSpacing(0);
    setupSidebar(sidebarLayout);

    // 页面栈
    m_stack = new QStackedWidget();

    m_chatWidget = new ChatWidget(m_client, m_sessionMgr);
    m_stack->addWidget(m_chatWidget); // index 0

    m_settingsWidget = new SettingsWidget(m_client);
    m_stack->addWidget(m_settingsWidget); // index 1

    m_splitter->addWidget(m_sidebar);
    m_splitter->addWidget(m_stack);
    m_splitter->setStretchFactor(0, 0);
    m_splitter->setStretchFactor(1, 1);

    mainLayout->addWidget(m_splitter);

    // 连接设置页信号
    connect(m_settingsWidget, &SettingsWidget::back, this, &MainWindow::onBackToChat);
    connect(m_settingsWidget, &SettingsWidget::configSaved, this, &MainWindow::onConfigSaved);
}

void MainWindow::setupSidebar(QVBoxLayout* layout) {
    // 标题
    auto* sidebarTitle = new QLabel("会话列表", m_sidebar);
    sidebarTitle->setObjectName("sidebarTitle");

    // 新建对话按钮
    m_newSessionButton = new QPushButton("+ 新建对话", m_sidebar);
    m_newSessionButton->setObjectName("newSessionButton");
    m_newSessionButton->setCursor(Qt::PointingHandCursor);

    // 会话列表
    m_sessionList = new QListWidget(m_sidebar);
    m_sessionList->setCursor(Qt::PointingHandCursor);

    // 删除按钮
    m_deleteSessionButton = new QPushButton("删除当前会话", m_sidebar);
    m_deleteSessionButton->setObjectName("deleteButton");
    m_deleteSessionButton->setCursor(Qt::PointingHandCursor);

    // 设置按钮
    m_settingsButton = new QPushButton("⚙  设置", m_sidebar);
    m_settingsButton->setObjectName("settingsButton");
    m_settingsButton->setCursor(Qt::PointingHandCursor);

    layout->addWidget(sidebarTitle);
    layout->addWidget(m_newSessionButton);
    layout->addWidget(m_sessionList);
    layout->addWidget(m_deleteSessionButton);
    layout->addWidget(m_settingsButton);

    // 信号
    connect(m_newSessionButton, &QPushButton::clicked, this, &MainWindow::onNewSession);
    connect(m_sessionList, &QListWidget::currentRowChanged, this, &MainWindow::onSessionSelected);
    connect(m_deleteSessionButton, &QPushButton::clicked, this, &MainWindow::onDeleteSession);
    connect(m_settingsButton, &QPushButton::clicked, this, &MainWindow::onOpenSettings);
}

void MainWindow::setupTitleBar(QVBoxLayout* layout) {
    m_titleBar = new QWidget();
    m_titleBar->setObjectName("titleBar");

    auto* titleBarLayout = new QHBoxLayout(m_titleBar);
    titleBarLayout->setContentsMargins(16, 0, 16, 0);
    titleBarLayout->setSpacing(0);

    m_titleLabel = new QLabel("💜 心元 EMO-Mate");
    m_titleLabel->setFont(QFont("Microsoft YaHei", 14, QFont::Bold));

    titleBarLayout->addWidget(m_titleLabel);
    titleBarLayout->addStretch();

    layout->addWidget(m_titleBar);
}

void MainWindow::applyStyle() {
    QFile styleFile("resources/style.qss");
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        QString style = QString::fromUtf8(styleFile.readAll());
        setStyleSheet(style);
        styleFile.close();
    }
}

void MainWindow::refreshSessionList() {
    m_sessionList->blockSignals(true);
    m_sessionList->clear();

    auto sessions = m_sessionMgr->sessions();
    for (const auto& s : sessions) {
        QString title = QString::fromStdString(s.title);
        if (title.isEmpty()) title = "对话";

        auto* item = new QListWidgetItem(title);
        item->setData(Qt::UserRole, QString::fromStdString(s.id));
        m_sessionList->addItem(item);
    }

    // 选中当前会话
    std::string currentId = m_sessionMgr->currentSession().id;
    for (int i = 0; i < m_sessionList->count(); i++) {
        if (m_sessionList->item(i)->data(Qt::UserRole).toString().toStdString() == currentId) {
            m_sessionList->setCurrentRow(i);
            break;
        }
    }

    m_sessionList->blockSignals(false);
}

void MainWindow::loadSession(const std::string& sessionId) {
    m_sessionMgr->switchTo(sessionId);
    m_chatWidget->loadSession(sessionId);
}

void MainWindow::onNewSession() {
    auto session = m_sessionMgr->createSession("新的对话");
    refreshSessionList();

    // 选中新会话
    for (int i = 0; i < m_sessionList->count(); i++) {
        if (m_sessionList->item(i)->data(Qt::UserRole).toString().toStdString() == session.id) {
            m_sessionList->setCurrentRow(i);
            break;
        }
    }

    loadSession(session.id);
    m_stack->setCurrentIndex(0);
}

void MainWindow::onSessionSelected(int index) {
    if (index < 0) return;
    auto* item = m_sessionList->item(index);
    if (!item) return;

    std::string sessionId = item->data(Qt::UserRole).toString().toStdString();
    loadSession(sessionId);
    m_stack->setCurrentIndex(0);
}

void MainWindow::onDeleteSession() {
    auto sessions = m_sessionMgr->sessions();
    if (sessions.size() <= 1) {
        QMessageBox::information(this, "提示", "至少保留一个会话哦~");
        return;
    }

    std::string currentId = m_sessionMgr->currentSession().id;
    auto result = QMessageBox::question(this, "确认删除",
        "确定要删除当前会话吗？\n对话记录将无法恢复。",
        QMessageBox::Yes | QMessageBox::No);

    if (result == QMessageBox::Yes) {
        m_sessionMgr->deleteSession(currentId);
        refreshSessionList();

        auto remaining = m_sessionMgr->sessions();
        if (!remaining.empty()) {
            loadSession(remaining[0].id);
            refreshSessionList();
        }
    }
}

void MainWindow::onOpenSettings() {
    m_stack->setCurrentIndex(1);
}

void MainWindow::onBackToChat() {
    m_stack->setCurrentIndex(0);
}

void MainWindow::onConfigSaved() {
    refreshSessionList();
}
