#pragma once

#include <QMainWindow>
#include <QStackedWidget>
#include <QListWidget>
#include <QSplitter>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>

#include "core/coze_client.h"
#include "core/session_manager.h"

class ChatWidget;
class SettingsWidget;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(QWidget* parent = nullptr);
    ~MainWindow();

private slots:
    void onNewSession();
    void onSessionSelected(int index);
    void onDeleteSession();
    void onOpenSettings();
    void onBackToChat();
    void onConfigSaved();

private:
    CozeClient* m_client;
    SessionManager* m_sessionMgr;

    // 主布局
    QSplitter* m_splitter;
    QStackedWidget* m_stack;

    // 侧边栏
    QWidget* m_sidebar;
    QListWidget* m_sessionList;
    QPushButton* m_newSessionButton;
    QPushButton* m_settingsButton;
    QPushButton* m_deleteSessionButton;

    // 页面
    ChatWidget* m_chatWidget;
    SettingsWidget* m_settingsWidget;

    // 标题栏
    QWidget* m_titleBar;
    QLabel* m_titleLabel;

    void setupUI();
    void setupSidebar(QVBoxLayout* layout);
    void setupTitleBar(QVBoxLayout* layout);
    void applyStyle();
    void refreshSessionList();
    void loadSession(const std::string& sessionId);
};
