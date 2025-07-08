export interface ContentBlock {
  id: string;
  type: 'text' | 'image';
  content: string;
  metadata?: any;
}

export interface RichContent {
  blocks: ContentBlock[];
}

export interface StickyNote {
  id: string;
  content: string | RichContent;
  // アクティブ状態の位置とサイズ
  activeX: number;
  activeY: number;
  activeWidth: number;
  activeHeight: number;
  // 非アクティブ状態の位置とサイズ
  inactiveX: number;
  inactiveY: number;
  inactiveWidth: number;
  inactiveHeight: number;
  backgroundColor: string;
  headerColor?: string; // ヘッダー色（オプショナル、未設定時はbackgroundColorを使用）
  fontSize: number;
  isPinned: boolean;
  isLocked: boolean;
  displayId: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// AnchorPoint型は削除

export type DisplayInfo = {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isPrimary: boolean;
};

export interface AppSettings {
  defaultFontSize: number;
  defaultBackgroundColor: string;
  defaultHeaderColor?: string; // デフォルトヘッダー色（オプショナル）
  headerIconSize: number; // ヘッダーアイコンのサイズ（12-32px）
  defaultInactiveWidth: number; // 非アクティブモードのデフォルト幅（100-500px）
  defaultInactiveHeight: number; // 非アクティブモードのデフォルト高さ（100-500px）
  defaultInactiveFontSize: number; // 非アクティブモードのデフォルトフォントサイズ（8-20px）
  showAllHotkey?: string; // すべてのノートを表示するホットキー
  hideAllHotkey?: string; // すべてのノートを隠すホットキー
  searchHotkey?: string; // 検索ウィンドウの表示/非表示を切り替えるホットキー
  pinHotkey?: string; // アクティブ付箋のピン留めを切り替えるホットキー
  lockHotkey?: string; // アクティブ付箋のロックを切り替えるホットキー
  autoStart?: boolean; // PC起動時の自動開始設定
}

// 検索関連の型定義
export interface SearchIndex {
  noteId: string;
  searchText: string; // 検索用の正規化されたテキスト
  previewText: string; // 表示用のプレビューテキスト（最初の100文字程度）
  updatedAt: number;
  createdAt: number;
}

export interface SearchHighlight {
  start: number;
  end: number;
}

export interface SearchResult {
  note: StickyNote;
  relevance: number; // 関連度スコア（0-1）
  highlights: SearchHighlight[]; // ハイライト位置
  matchCount: number; // マッチした回数
}

export interface SearchQuery {
  text: string;
  keywords: string[]; // スペースで分割されたキーワード
  caseSensitive?: boolean;
  maxResults?: number;
}