#!/bin/bash

# Green Sticky Notes Linux インストールスクリプト

echo "🟢 Green Sticky Notes インストーラー"
echo "=================================="

# AppImageファイルを検索
APPIMAGE_FILE=$(find . -name "Green Sticky-*.AppImage" | head -1)

if [ -z "$APPIMAGE_FILE" ]; then
    echo "❌ AppImageファイルが見つかりません"
    echo "💡 GitHub Releasesから Green Sticky-x.x.x.AppImage をダウンロードしてください"
    echo "   https://github.com/Chan-con/green-sticky-notes/releases"
    exit 1
fi

echo "📁 AppImageファイル発見: $APPIMAGE_FILE"

# 実行権限を付与
echo "🔧 実行権限を付与中..."
chmod +x "$APPIMAGE_FILE"

# /opt/ にコピー（オプション）
read -p "🤔 アプリケーションメニューに追加しますか？ (y/N): " INSTALL_MENU

if [ "$INSTALL_MENU" = "y" ] || [ "$INSTALL_MENU" = "Y" ]; then
    echo "📦 システムにインストール中..."
    
    # /opt/に移動
    sudo cp "$APPIMAGE_FILE" /opt/green-sticky.AppImage
    
    # デスクトップエントリを作成
    mkdir -p ~/.local/share/applications/
    
    cat > ~/.local/share/applications/green-sticky.desktop << EOF
[Desktop Entry]
Name=Green Sticky Notes
Comment=Cute pastel sticky notes app
Exec=/opt/green-sticky.AppImage
Icon=/opt/green-sticky.AppImage
Type=Application
Categories=Office;Utility;
StartupWMClass=green-sticky-notes
EOF
    
    # アイコンキャッシュを更新
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database ~/.local/share/applications/
    fi
    
    echo "✅ アプリケーションメニューに追加されました！"
    echo "🚀 アプリケーションメニューから 'Green Sticky Notes' を検索して起動できます"
else
    echo "🚀 直接実行する場合:"
    echo "   ./$APPIMAGE_FILE"
fi

echo ""
echo "✨ インストール完了！"
echo "📝 使い方:"
echo "   1. +ボタンで付箋作成"
echo "   2. 🎨ボタンで50色のパステルカラーから選択"
echo "   3. 📌ボタンでピン留め"
echo ""
echo "🐛 問題が発生した場合:"
echo "   https://github.com/Chan-con/green-sticky-notes/issues"