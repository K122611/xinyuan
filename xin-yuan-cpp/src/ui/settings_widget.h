#pragma once

#include <QWidget>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>
#include <QFormLayout>

#include "core/coze_client.h"

class SettingsWidget : public QWidget {
    Q_OBJECT
public:
    explicit SettingsWidget(CozeClient* client, QWidget* parent = nullptr);

signals:
    void configSaved();
    void back();

private slots:
    void onSave();
    void onReset();

private:
    CozeClient* m_client;

    QLineEdit* m_tokenInput;
    QLineEdit* m_botIdInput;
    QLineEdit* m_baseUrlInput;
    QPushButton* m_saveButton;
    QPushButton* m_resetButton;
    QPushButton* m_backButton;
    QLabel* m_statusLabel;

    void loadConfig();
};
