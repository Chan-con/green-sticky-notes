# Green Sticky - 付箋アプリ

シンプルで高機能な付箋アプリケーションです。

## 特徴

### 基本機能
- 付箋の位置とコンテンツをリアルタイムで保存
- アプリを閉じても設定が保持される
- マルチディスプレイ対応

### モード
- **ステイモード**: コンパクトな表示（12文字×3行程度）
- **アクティブモード**: 編集可能な表示

### ヘッダーメニュー
- 📝 文字サイズ変更
- ➕ 新規付箋追加
- ⚓ アンカーポイント設定（自動/左上/右上/左下/右下）
- 🎨 カラーピッカー
- 📌 ピン留め（常に最前面）
- 🗑️ 削除（空の付箋のみ）

### 使い方
1. ステイモードの付箋をクリックしてアクティブモード切替
2. ヘッダーをドラッグして移動
3. メニューから各種設定を変更
4. 付箋外をクリックまたはフォーカスを失うとステイモードに戻る
5. 空の付箋は自動的に削除されるか、ゴミ箱ボタンで手動削除

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発モード（ホットリロード）
npm run dev

# ビルド
npm run build

# アプリケーション起動
npm start

# パッケージ化
npm run package
```

## 技術仕様

- **フレームワーク**: Electron + React + TypeScript
- **スタイリング**: CSS3 + CSS Variables
- **データ保存**: JSON ファイル（ユーザーデータディレクトリ）
- **ディスプレイ管理**: Electron Screen API

## ファイル構成

```
src/
├── main/          # Electronメインプロセス
│   ├── main.ts    # アプリケーション起動・ウィンドウ管理
│   ├── dataStore.ts # データ永続化
│   └── preload.ts # レンダラープロセスとの通信
├── renderer/      # Reactレンダラープロセス
│   ├── components/ # Reactコンポーネント
│   ├── styles/    # CSSスタイル
│   └── index.tsx  # エントリーポイント
└── types/         # TypeScript型定義
```

データは以下の場所に保存されます：
- Linux: `~/.config/green-sticky/sticky-notes-data/`
- Windows: `%APPDATA%/green-sticky/sticky-notes-data/`
- macOS: `~/Library/Application Support/green-sticky/sticky-notes-data/`