#pragma once

#include <nlohmann/json.hpp>
#include <string>

using json = nlohmann::json;

// JSON 工具函数
namespace JsonHelper {

// 安全获取字符串字段，带默认值
std::string getString(const json& obj, const std::string& key, const std::string& defaultValue = "");

// 安全获取整数字段
int getInt(const json& obj, const std::string& key, int defaultValue = 0);

// 安全获取布尔字段
bool getBool(const json& obj, const std::string& key, bool defaultValue = false);

// 检查字段是否存在且为指定类型
bool hasString(const json& obj, const std::string& key);
bool hasObject(const json& obj, const std::string& key);

// 解析 JSON 字符串
json parse(const std::string& str);

// 序列化为字符串
std::string toString(const json& obj, bool pretty = false);

} // namespace JsonHelper
