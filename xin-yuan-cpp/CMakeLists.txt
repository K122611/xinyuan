cmake_minimum_required(VERSION 3.16)
project(心元EMOMate VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network)
find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)

set(SOURCES
    src/main.cpp
    src/core/coze_client.cpp
    src/core/session_manager.cpp
    src/utils/json_helper.cpp
    src/ui/chat_bubble.cpp
    src/ui/chat_widget.cpp
    src/ui/settings_widget.cpp
    src/ui/main_window.cpp
    src/ui/emotion_tag.cpp
)

set(HEADERS
    src/core/coze_client.h
    src/core/session_manager.h
    src/utils/json_helper.h
    src/ui/chat_bubble.h
    src/ui/chat_widget.h
    src/ui/settings_widget.h
    src/ui/main_window.h
    src/ui/emotion_tag.h
)

add_executable(${PROJECT_NAME} ${SOURCES} ${HEADERS})

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(${PROJECT_NAME} PRIVATE
    Qt6::Widgets
    Qt6::Network
    CURL::libcurl
    nlohmann_json::nlohmann_json
)

# Copy resources
file(COPY ${CMAKE_SOURCE_DIR}/resources DESTINATION ${CMAKE_BINARY_DIR})

# Windows-specific
if(WIN32)
    set_target_properties(${PROJECT_NAME} PROPERTIES WIN32_EXECUTABLE TRUE)
endif()
