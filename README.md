# AI Usage Bar 🤖

Menubar приложение для macOS, которое показывает лимиты использования Claude и ChatGPT прямо в строке меню.

## Скриншот

```
┌─────────────────────────────────┐
│ AI Usage          ↺             │
│ ┌─────────┬──────────────────┐  │
│ │  Claude  │    ChatGPT       │  │
│ └─────────┴──────────────────┘  │
│                                 │
│  Сегодня              38 / 60   │
│  ████████████░░░░░░  63%        │
│                                 │
│  За неделю           240 / 300  │
│  ████████████████░░  80%        │
│                                 │
│  Сброс через 4 ч 20 мин         │
└─────────────────────────────────┘
```

## Требования

- macOS 13.0 (Ventura) или новее
- Xcode 15+

## Установка и сборка

### 1. Открыть проект

```bash
open AIUsageBar.xcodeproj
```

### 2. Собрать (Xcode)

`Cmd+B` — собрать  
`Cmd+R` — запустить

### 3. Создать DMG для дистрибуции

```bash
# Собрать Release версию
xcodebuild -project AIUsageBar.xcodeproj \
           -scheme AIUsageBar \
           -configuration Release \
           -derivedDataPath build \
           build

# Найти .app
APP_PATH="build/Build/Products/Release/AIUsageBar.app"

# Создать DMG
hdiutil create -volname "AI Usage Bar" \
               -srcfolder "$APP_PATH" \
               -ov -format UDZO \
               AIUsageBar.dmg

echo "✅ AIUsageBar.dmg готов!"
```

### Одной командой (скрипт)

```bash
chmod +x build_dmg.sh
./build_dmg.sh
```

## Авторизация

Приложение использует cookies вашего браузера через встроенный WKWebView.  
При первом запуске нажмите "Войти" — откроется браузер для авторизации.  
После входа приложение автоматически получит данные о лимитах.

## Как работает

- Загружает `claude.ai/settings` и `chatgpt.com` через WKWebView
- Парсит данные об использовании через JavaScript
- Обновляется каждые 15 минут
- Cookies сохраняются между запусками

## Известные ограничения

- Claude и ChatGPT не предоставляют публичный API для лимитов подписки
- Парсинг может сломаться при обновлении сайтов (откройте issue если это случилось)
- Для работы нужен активный интернет

## Лицензия

MIT
