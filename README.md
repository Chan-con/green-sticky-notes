# Green Sticky Notes 🟢

**シンプルで美しいデスクトップ付箋アプリ**

ミニマルなデザインと直感的な操作で、デスクトップに付箋を貼って管理できるElectronアプリケーションです。

## ✨ 特徴

### 🎯 スマートな動作

- **2つのモード**: 非アクティブ時はコンパクト、アクティブ時は編集可能に自動切替
- **インテリジェント配置**: 新しい付箋は親付箋と同じ位置に重ねて配置、設定も自動継承
- **初回展開位置記憶**: 初回アクティブ化時はその場で拡大（左上にジャンプしない）
- **自動削除**: 最後の付箋が空になると新しい付箋が自動作成

### 🎨 カスタマイズ

- **豊富なカラーパレット**: 28色のパステルカラーから選択
- **フォントサイズ調整**: 8px〜48pxまで細かく設定可能
- **設定継承**: 新規付箋は親付箋の色・フォント・ピン設定を自動継承

### 🖥️ ユーザビリティ

- **リサイズ制御**: 非アクティブ時はリサイズ無効で誤操作防止
- **レスポンシブメニュー**: 小さな付箋でもメニューが見切れない設計
- **マルチディスプレイ対応**: 複数画面での使用に完全対応
- **データ永続化**: アプリ終了後も位置・内容・設定が保持

### 🎛️ ヘッダーメニュー（アクティブ時）

- **A** 文字サイズ変更（8px〜48px）
- **🎨** カラーピッカー（28色のパステルカラー）
- **📌** ピン留め（常に最前面表示）
- **🔒** アクティブロック（フォーカス維持）
- **+** 新規付箋追加（現在位置に設定継承で作成）

### 🎛️ ヘッダーメニュー（非アクティブ時）

- **+** 新規付箋追加
- **📌** ピン留め切替

## 🚀 使い方

1. **付箋作成**: `+` ボタンで新規付箋を作成
2. **編集開始**: 非アクティブ付箋をクリックしてアクティブモードに切替
3. **移動**: ヘッダー部分をドラッグして自由に移動
4. **カスタマイズ**: メニューから色・フォントサイズを調整
5. **編集終了**: 付箋外をクリックまたは他の場所にフォーカス移動
6. **削除**: 付箋の内容を空にすると自動削除

## 📥 ダウンロード・インストール

### 📱 エンドユーザー向け

[**Releases**](https://github.com/Chan-con/green-sticky-notes/releases)ページから最新版をダウンロード

#### Linux (AppImage)

**簡単インストール（推奨）**:
1. **ダウンロード**: `Green Sticky-x.x.x.AppImage` と `install-linux.sh`
2. **インストール実行**:
   ```bash
   chmod +x install-linux.sh
   ./install-linux.sh
   ```
   → アプリケーションメニューに自動追加！

**手動実行**:
1. **ダウンロード**: `Green Sticky-x.x.x.AppImage`
2. **実行権限を付与**:
   ```bash
   chmod +x Green\ Sticky-*.AppImage
   ```
3. **実行**:
   ```bash
   ./Green\ Sticky-*.AppImage
   ```

**アンインストール**:
```bash
# uninstall-linux.sh をダウンロードして実行
chmod +x uninstall-linux.sh
./uninstall-linux.sh
```

#### Windows
1. **ダウンロード**: `Green Sticky Setup x.x.x.exe`
2. **インストール**: ダウンロードしたexeファイルを実行
3. **起動**: スタートメニューから「Green Sticky」を検索

#### macOS
1. **ダウンロード**: `Green Sticky-x.x.x.dmg`
2. **インストール**: DMGファイルを開いてアプリケーションフォルダにドラッグ
3. **起動**: Launchpadまたはアプリケーションフォルダから実行

### 👨‍💻 開発者向けセットアップ

```bash
# リポジトリクローン
git clone https://github.com/Chan-con/green-sticky-notes.git
cd green-sticky-notes

# 依存関係のインストール
npm install

# 開発モード（ホットリロード）
npm run dev

# ビルド
npm run build

# アプリケーション起動
npm start

# パッケージ化
npm run package:all
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
