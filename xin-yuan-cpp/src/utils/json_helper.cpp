#include "utils/json_helper.h"
#include <stdexcept>

namespace JsonHelper {

std::string getString(const json& obj, const std::string& key, const std::string& defaultValue) {
    if (obj.contains(key) && obj[key].is_string()) {
        return obj[key].get<std::string>();
    }
    return defaultValue;
}

int getInt(const json& obj, const std::string& key, int defaultValue) {
    if (obj.contains(key) && obj[key].is_number_integer()) {
        return obj[key].get<int>();
    }
    return defaultValue;
}

bool getBool(const json& obj, const std::string& key, bool defaultValue) {
    if (obj.contains(key) && obj[key].is_boolean()) {
        return obj[key].get<bool>();
    }
    return defaultValue;
}

bool hasString(const json& obj, const std::string& key) {
    return obj.contains(key) && obj[key].is_string();
}

bool hasObject(const json& obj, const std::string& key) {
    return obj.contains(key) && obj[key].is_object();
}

json parse(const std::string& str) {
    return json::parse(str);
}

std::string toString(const json& obj, bool pretty) {
    return pretty ? obj.dump(2) : obj.dump();
}

} // namespace JsonHelper
