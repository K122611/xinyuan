#include <QApplication>
#include <QFile>
#include <QFont>
#include <QIcon>
#include <QDir>

#include "ui/main_window.h"

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    // 应用信息
    app.setApplicationName("心元EMOMate");
    app.setApplicationVersion("1.0.0");
    app.setOrganizationName("XinYuan");
    app.setOrganizationDomain("xinyuan.emo");

    // 设置默认字体
    QFont defaultFont("Microsoft YaHei", 12);
    defaultFont.setStyleStrategy(QFont::PreferAntialias);
    app.setFont(defaultFont);

    // 确保工作目录正确（resources/style.qss 的相对路径）
    QDir::setCurrent(QApplication::applicationDirPath());

    // 全局暗色调色板
    QPalette darkPalette;
    darkPalette.setColor(QPalette::Window, QColor("#0F172A"));
    darkPalette.setColor(QPalette::WindowText, QColor("#E2E8F0"));
    darkPalette.setColor(QPalette::Base, QColor("#1E293B"));
    darkPalette.setColor(QPalette::AlternateBase, QColor("#0F172A"));
    darkPalette.setColor(QPalette::ToolTipBase, QColor("#1E293B"));
    darkPalette.setColor(QPalette::ToolTipText, QColor("#E2E8F0"));
    darkPalette.setColor(QPalette::Text, QColor("#E2E8F0"));
    darkPalette.setColor(QPalette::Button, QColor("#334155"));
    darkPalette.setColor(QPalette::ButtonText, QColor("#CBD5E1"));
    darkPalette.setColor(QPalette::BrightText, QColor("#FFFFFF"));
    darkPalette.setColor(QPalette::Link, QColor("#8B5CF6"));
    darkPalette.setColor(QPalette::Highlight, QColor("#7C3AED"));
    darkPalette.setColor(QPalette::HighlightedText, QColor("#FFFFFF"));
    app.setPalette(darkPalette);

    // 创建并显示主窗口
    MainWindow mainWindow;
    mainWindow.show();

    return app.exec();
}
