# Green Sticky Notes 軽量化改善プラン

## ⚠️ 絶対に守るべきルール

### 🔒 機能保持の絶対条件
1. **操作性の完全維持**
   - ワンクリックでの即座なアクティブ化
   - ESCキー・フォーカス外しでの自動非アクティブ化
   - ドラッグ&ドロップによる自由な移動
   - リサイズ操作の自然な動作

2. **状態管理の一貫性**
   - アクティブ⇔非アクティブの状態遷移ロジック
   - 位置・サイズの二重管理システム（activeX/Y, inactiveX/Y）
   - ピン留め・ロック機能の完全動作
   - マルチディスプレイ対応の正確性

3. **データ保全性**
   - 入力中テキストの絶対的な保護
   - 自動保存タイミングの維持（500ms + 30秒）
   - アプリクラッシュ時のデータ復旧能力
   - 既存データとの完全互換性

4. **UI/UXの継続性**
   - 現在のヘッダーボタン配置・機能
   - コンテキストメニューの全項目
   - ホットキー動作の完全保持
   - タスクトレイ機能の維持

### 🚫 実装時の禁止事項
1. **破壊的変更の禁止**
   - 既存のデータ形式変更
   - APIの非互換性変更
   - 設定ファイル構造の変更
   - 既存ユーザーワークフローの破綻

2. **パフォーマンス劣化の禁止**
   - 単一付箋操作の応答性低下
   - 新規作成時の遅延増加
   - アクティブ化応答時間の延長
   - メモリリークの発生

3. **機能削除の禁止**
   - 現在動作している全機能の保持
   - 隠し機能・デバッグ機能も含む
   - 開発者向け機能の維持
   - 将来拡張への配慮

### ✅ 改善の検証基準
1. **必須テストケース**
   - 100付箋での全機能動作確認
   - 8時間連続動作でのメモリリーク検証
   - マルチディスプレイ環境での位置精度確認
   - 高負荷時のデータ保存確実性検証

2. **性能基準**
   - クリック→アクティブ化: 100ms以内
   - テキスト入力応答: 50ms以内
   - 付箋移動時の追従性: 60fps維持
   - アプリ起動時間: 現在比で劣化禁止

3. **品質基準**
   - メモリ使用量: 改善前比で50%以下
   - CPU使用率: アイドル時1%未満
   - クラッシュ率: 0.01%未満
   - データ損失: 絶対零

## 🎯 目標
- **機能維持**: 現在の操作性・使用感・機能を完全に保持
- **パフォーマンス向上**: 付箋数増加時の動作重量化を解決
- **段階的実装**: リスクを最小化した段階的な改善

## 📊 現状分析

### パフォーマンス問題の原因
1. **ウィンドウ数の線形増加**: 付箋1つ = BrowserWindow 1つ
2. **全ウィンドウ同時レンダリング**: 非表示でもレンダリング継続
3. **頻繁なIPC通信**: 位置・サイズ更新の度にメイン⇔レンダラー通信
4. **リアルタイム検索**: 全付箋の内容を毎回走査
5. **メモリ蓄積**: ウィンドウ破棄時の不完全なクリーンアップ

### 重量化の閾値
- **10-20付箋**: ほぼ問題なし
- **30-50付箋**: 軽微な遅延
- **50付箋以上**: 明確な動作重量化

## 🚀 改善プラン

### Phase 1: 即効性改善（低リスク）

#### 1.1 レンダリング最適化
```typescript
// 目標: CPU使用率 30-40% 削減
```

**実装項目:**
- **非表示ウィンドウの描画停止**
  ```typescript
  // 非アクティブ時のレンダリング一時停止
  win.webContents.setBackgroundThrottling(false);
  if (!note.isActive) {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  }
  ```

- **CSSアニメーション制御**
  ```css
  /* 非アクティブ時はアニメーション無効 */
  .stay-mode * {
    animation: none !important;
    transition: none !important;
  }
  ```

- **React再レンダリング抑制**
  ```typescript
  // React.memo + useMemo による不要な再レンダリング防止
  const StickyNoteApp = React.memo(({ note }) => {
    const memoizedContent = useMemo(() => note.content, [note.content]);
    return <div>{memoizedContent}</div>;
  });
  ```

#### 1.2 IPC通信最適化
```typescript
// 目標: 通信頻度 60% 削減
```

**実装項目:**
- **バッチ更新システム**
  ```typescript
  // 複数の更新を100ms間隔でまとめて送信
  class BatchUpdateManager {
    private updateQueue: Map<string, Partial<StickyNote>> = new Map();
    
    scheduleUpdate(noteId: string, updates: Partial<StickyNote>) {
      this.updateQueue.set(noteId, { ...this.updateQueue.get(noteId), ...updates });
      this.debouncedFlush();
    }
  }
  ```

- **差分更新**
  ```typescript
  // 変更された部分のみ送信
  const diff = getDifference(previousNote, currentNote);
  if (Object.keys(diff).length > 0) {
    ipcMain.handle('update-note-diff', noteId, diff);
  }
  ```

#### 1.3 検索インデックス最適化
```typescript
// 目標: 検索応答時間 70% 短縮
```

**実装項目:**
- **増分インデックス更新**
  ```typescript
  // 全体再構築ではなく、変更部分のみ更新
  class IncrementalSearchIndex {
    updateNote(noteId: string, oldContent: string, newContent: string) {
      this.removeFromIndex(noteId, oldContent);
      this.addToIndex(noteId, newContent);
    }
  }
  ```

- **検索結果キャッシュ**
  ```typescript
  // 最近の検索結果をメモリキャッシュ
  private searchCache: Map<string, SearchResult[]> = new Map();
  ```

### Phase 2: 構造的改善（中リスク）

#### 2.1 仮想化システム導入
```typescript
// 目標: メモリ使用量 50% 削減
```

**コンセプト:**
- **表示付箋の制限**: 同時表示を最大20付箋に制限
- **オンデマンド生成**: 必要時のみウィンドウ作成
- **バックグラウンド管理**: 非表示付箋はメタデータのみ保持

**実装設計:**
```typescript
class VirtualizedNoteManager {
  private activeWindows: Map<string, BrowserWindow> = new Map();
  private noteMetadata: Map<string, StickyNote> = new Map();
  private maxActiveWindows = 20;
  
  async showNote(noteId: string) {
    if (this.activeWindows.size >= this.maxActiveWindows) {
      await this.virtualizeOldestNote();
    }
    await this.createRealWindow(noteId);
  }
  
  private async virtualizeOldestNote() {
    // 最も古いアクセスのウィンドウを仮想化
    const oldestNote = this.findOldestAccessedNote();
    await this.convertToVirtual(oldestNote);
  }
}
```

#### 2.2 レイジーロード機能
```typescript
// 目標: 起動時間 60% 短縮
```

**実装項目:**
- **段階的ロード**
  ```typescript
  // アプリ起動時は最小限のみロード
  async initializeApp() {
    await this.loadEssentialNotes(); // 最近使用した5付箋のみ
    this.scheduleBackgroundLoading(); // 残りは背景で段階的にロード
  }
  ```

- **ビューポート検出**
  ```typescript
  // 画面内の付箋のみアクティブ化
  class ViewportManager {
    getVisibleNotes(): string[] {
      const displays = screen.getAllDisplays();
      return this.notes.filter(note => 
        this.isInViewport(note, displays)
      );
    }
  }
  ```

### Phase 3: 高度な最適化（高リスク）

#### 3.1 ハイブリッドレンダリング
```typescript
// 目標: 全体パフォーマンス 80% 向上
```

**コンセプト:**
- **軽量表示モード**: 非アクティブ時はCanvas/SVGで描画
- **フル機能モード**: アクティブ時のみHTML/CSS
- **シームレス切り替え**: 状態遷移時の自動切り替え

**実装設計:**
```typescript
class HybridRenderer {
  // 軽量描画（非アクティブ用）
  renderAsCanvas(note: StickyNote): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    // シンプルなテキスト描画
    ctx.fillStyle = note.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillText(this.truncateText(note.content), 10, 20);
    
    return canvas;
  }
  
  // フル機能描画（アクティブ用）
  renderAsDOM(note: StickyNote): React.Component {
    return <StickyNoteApp note={note} />;
  }
}
```

#### 3.2 Worker分離
```typescript
// 目標: UIブロッキング解消
```

**実装項目:**
- **検索Worker**
  ```typescript
  // 検索処理を専用Workerに分離
  class SearchWorker {
    constructor() {
      this.worker = new Worker('./search-worker.js');
    }
    
    async search(query: string): Promise<SearchResult[]> {
      return new Promise((resolve) => {
        this.worker.postMessage({ type: 'search', query });
        this.worker.onmessage = (e) => resolve(e.data.results);
      });
    }
  }
  ```

- **データ処理Worker**
  ```typescript
  // ファイルI/O、JSONパースを分離
  class DataWorker {
    async saveNotes(notes: StickyNote[]): Promise<void> {
      // バックグラウンドで保存処理
    }
  }
  ```

## 📈 実装スケジュール

### Week 1-2: Phase 1 実装
- [ ] レンダリング最適化
- [ ] IPC通信改善
- [ ] 検索インデックス高速化
- [ ] **期待効果**: 30-40% パフォーマンス改善

### Week 3-4: Phase 2 実装
- [ ] 仮想化システム基盤
- [ ] レイジーロード機能
- [ ] ビューポート管理
- [ ] **期待効果**: 50-60% パフォーマンス改善

### Week 5-6: Phase 3 実装（オプション）
- [ ] ハイブリッドレンダリング
- [ ] Worker分離
- [ ] **期待効果**: 70-80% パフォーマンス改善

## 🔍 検証・測定方法

### パフォーマンス指標
```typescript
interface PerformanceMetrics {
  windowCreationTime: number;      // ウィンドウ作成時間
  renderTime: number;              // レンダリング時間
  memoryUsage: number;             // メモリ使用量
  ipcLatency: number;              // IPC通信遅延
  searchResponseTime: number;      // 検索応答時間
  cpuUsage: number;               // CPU使用率
}
```

### テストシナリオ
1. **付箋数別テスト**: 10/30/50/100付箋での動作確認
2. **操作レスポンス**: クリック→アクティブ化の応答時間
3. **メモリリーク**: 長時間使用での メモリ増加確認
4. **マルチディスプレイ**: 複数モニター環境での動作

## 🛡️ リスク管理

### 低リスク改善（Phase 1）
- **実装容易**: 既存コードへの最小限の変更
- **後戻り可能**: 問題時の迅速なロールバック
- **段階的導入**: 機能単位での個別テスト

### 中リスク改善（Phase 2）
- **十分なテスト**: 仮想化システムの徹底検証
- **フェーズ導入**: 小さな機能から段階的に導入
- **フォールバック**: 従来システムとの併存期間

### 高リスク改善（Phase 3）
- **プロトタイプ**: 別ブランチでの事前実装・検証
- **A/Bテスト**: 新旧システムの並行運用
- **段階的移行**: ユーザーが選択可能な設定

## 🎯 期待効果

### 短期（Phase 1 完了後）
- **30-40% 性能向上**
- **現機能100% 維持**
- **50付箋まで快適動作**

### 中期（Phase 2 完了後）
- **50-60% 性能向上**
- **メモリ使用量半減**
- **100付箋まで実用的動作**

### 長期（Phase 3 完了後）
- **70-80% 性能向上**
- **200付箋以上でも快適**
- **将来拡張への基盤確立**

---

**推奨アプローチ**: Phase 1から順次実装し、各段階で効果を測定しながら進行することで、リスクを最小化しつつ最大の改善効果を得ることができます。
