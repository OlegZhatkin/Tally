#!/bin/bash
set -e

echo "🔨 Собираем AIUsageBar..."

xcodebuild -project AIUsageBar.xcodeproj \
           -scheme AIUsageBar \
           -configuration Release \
           -derivedDataPath build \
           build

APP_PATH="build/Build/Products/Release/Tally.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Сборка не удалась — .app не найден"
    exit 1
fi

# --- Сгенерировать .icns из цветной иконки для тома DMG ---
echo "🎨 Готовим иконку тома..."
ICONSET="build/VolumeIcon.iconset"
ICNS="build/VolumeIcon.icns"
SRC="icon/icon_color_1024.png"
rm -rf "$ICONSET" "$ICNS"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
    sips -z $s $s        "$SRC" --out "$ICONSET/icon_${s}x${s}.png"     >/dev/null
    sips -z $((s*2)) $((s*2)) "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICNS"

echo "📦 Создаём DMG..."
rm -f AIUsageBar.dmg AIUsageBar.rw.dmg

# Готовим папку-стейджинг: приложение + ссылка на /Applications
STAGE="build/dmg_staging"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP_PATH" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# Создаём read-write DMG, чтобы выставить иконку тома и расположение окна, потом конвертируем в сжатый
hdiutil create -volname "Tally" \
               -srcfolder "$STAGE" \
               -ov -format UDRW \
               AIUsageBar.rw.dmg

MOUNT_DIR="$(hdiutil attach AIUsageBar.rw.dmg -nobrowse -noverify -noautoopen | grep "/Volumes/" | sed 's/.*\(\/Volumes\/.*\)/\1/')"

# Иконка тома: кладём .icns как /Volumes/.../.VolumeIcon.icns и помечаем том кастомной иконкой
cp "$ICNS" "$MOUNT_DIR/.VolumeIcon.icns"
SetFile -a C "$MOUNT_DIR" 2>/dev/null || /usr/bin/SetFile -a C "$MOUNT_DIR" 2>/dev/null || true

# Раскладка окна: иконки, крупный размер, app слева — стрелка — Applications справа
osascript <<EOF 2>/dev/null || true
tell application "Finder"
    tell disk "Tally"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {200, 120, 700, 460}
        set theViewOptions to the icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 110
        set position of item "Tally.app" of container window to {130, 160}
        set position of item "Applications" of container window to {370, 160}
        update without registering applications
        delay 1
        close
    end tell
end tell
EOF

sync
hdiutil detach "$MOUNT_DIR" -quiet
hdiutil convert AIUsageBar.rw.dmg -format UDZO -ov -o AIUsageBar.dmg >/dev/null
rm -f AIUsageBar.rw.dmg
rm -rf "$STAGE"

echo "✅ Готово: AIUsageBar.dmg"
echo "   Размер: $(du -sh AIUsageBar.dmg | cut -f1)"
