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
}