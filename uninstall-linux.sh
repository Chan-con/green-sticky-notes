#!/bin/bash

# Green Sticky Notes Linux アンインストールスクリプト

echo "🟢 Green Sticky Notes アンインストーラー"
echo "======================================"

# システムからアンインストール
if [ -f "/opt/green-sticky.AppImage" ]; then
    echo "📦 システムからアプリケーションを削除中..."
    sudo rm -f /opt/green-sticky.AppImage
    echo "✅ /opt/green-sticky.AppImage を削除しました"
else
    echo "ℹ️  システムにインストールされたアプリケーションが見つかりません"
fi

# デスクトップエントリを削除
if [ -f "$HOME/.local/share/applications/green-sticky.desktop" ]; then
    echo "🗑️  アプリケーションメニューから削除中..."
    rm -f "$HOME/.local/share/applications/green-sticky.desktop"
    echo "✅ アプリケーションメニューから削除しました"
else
    echo "ℹ️  アプリケーションメニューにエントリが見つかりません"
fi

# アイコンキャッシュを更新
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database ~/.local/share/applications/ 2>/dev/null
fi

# ユーザーデータの削除確認
echo ""
read -p "💾 アプリのデータ（付箋の内容）も削除しますか？ (y/N): " DELETE_DATA

if [ "$DELETE_DATA" = "y" ] || [ "$DELETE_DATA" = "Y" ]; then
    DATA_DIR="$HOME/.config/green-sticky-notes"
    if [ -d "$DATA_DIR" ]; then
        echo "🗑️  ユーザーデータを削除中..."
        rm -rf "$DATA_DIR"
        echo "✅ ユーザーデータを削除しました"
    else
        echo "ℹ️  ユーザーデータが見つかりません"
    fi
else
    echo "💾 ユーザーデータは保持されます"
    echo "   場所: ~/.config/green-sticky-notes/"
fi

# ローカルAppImageファイルの確認
LOCAL_APPIMAGE=$(find . -name "Green Sticky-*.AppImage" 2>/dev/null | head -1)
if [ -n "$LOCAL_APPIMAGE" ]; then
    echo ""
    read -p "📁 ローカルのAppImageファイル ($LOCAL_APPIMAGE) も削除しますか？ (y/N): " DELETE_LOCAL

    if [ "$DELETE_LOCAL" = "y" ] || [ "$DELETE_LOCAL" = "Y" ]; then
        rm -f "$LOCAL_APPIMAGE"
        echo "✅ ローカルAppImageファイルを削除しました"
    else
        echo "📁 ローカルAppImageファイルは保持されます"
    fi
fi

echo ""
echo "🎉 アンインストール完了！"
echo "👋 Green Sticky Notes をご利用いただき、ありがとうございました"
echo ""
echo "🐛 問題がありましたら報告をお願いします:"
echo "   https://github.com/Chan-con/green-sticky-notes/issues"