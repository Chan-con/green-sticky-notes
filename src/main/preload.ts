import { contextBridge, ipcRenderer } from 'electron';
import { StickyNote, SearchQuery } from '../types';

/**
 * IPC通信用のオブジェクトサニタイズ機能
 * ElectronのIPCではシリアライゼーション不可能なオブジェクトでエラーが発生するため
 */
function sanitizeForIPC(obj: any): any {
  try {
    // JSON.stringify/parseでシリアライゼーション可能かテスト
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      // 特定の型のハンドリング
      if (value instanceof Date) {
        return value.getTime(); // DateをTimestampに変換
      }
      if (typeof value === 'function') {
        return undefined; // 関数は除外
      }
      if (value instanceof Error) {
        return { name: value.name, message: value.message }; // エラーオブジェクトは安全な形に変換
      }
      return value;
    }));
  } catch (error) {
    console.warn('[IPC-Preload] Object serialization failed, using safe fallback:', error);
    // 最後の手段：プリミティブ値のみを抽出
    if (typeof obj === 'object' && obj !== null) {
      const safe: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' || 
            typeof value === 'number' || 
            typeof value === 'boolean' || 
            value === null) {
          safe[key] = value;
        }
      }
      return safe;
    }
    return obj;
  }
}

/**
 * 安全なIPCインボーク（エラーハンドリング付き）
 */
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  try {
    // 引数をサニタイズ
    const sanitizedArgs = args.map(arg => sanitizeForIPC(arg));
    return await ipcRenderer.invoke(channel, ...sanitizedArgs);
  } catch (error) {
    console.error(`[IPC-Preload] Failed to invoke ${channel}:`, error);
    throw error;
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  onNoteData: (callback: (note: StickyNote) => void) => {
    ipcRenderer.on('note-data', (_, note) => callback(note));
  },
  
  onSetActive: (callback: (isActive: boolean) => void) => {
    ipcRenderer.on('set-active', (_, isActive) => callback(isActive));
  },
  
  onSettingsChanged: (callback: () => void) => {
    ipcRenderer.on('settings-changed', () => callback());
  },
  
  onSettingsPreview: (callback: (settings: any) => void) => {
    ipcRenderer.on('settings-preview', (_, settings) => callback(settings));
  },
  
  sendSettingsPreview: (settings: any) => safeIpcInvoke('send-settings-preview', settings),
  
  
  createNote: (nearNoteId?: string) => safeIpcInvoke('create-note', nearNoteId),
  updateNote: (noteId: string, updates: Partial<StickyNote>) => 
    safeIpcInvoke('update-note', noteId, updates),
  deleteNote: (noteId: string) => safeIpcInvoke('delete-note', noteId),
  setNoteActive: (noteId: string, isActive: boolean) => 
    safeIpcInvoke('set-note-active', noteId, isActive),
  setNotePin: (noteId: string, isPinned: boolean) => 
    safeIpcInvoke('set-note-pin', noteId, isPinned),
  getDisplays: () => safeIpcInvoke('get-displays'),
  closeSettings: () => safeIpcInvoke('close-settings'),
  getSettings: () => safeIpcInvoke('get-settings'),
  saveSettings: (settings: any) => safeIpcInvoke('save-settings', settings),
  exportNotesToTxt: () => safeIpcInvoke('export-notes-to-txt'),
  selectFolderAndExportNotes: () => safeIpcInvoke('select-folder-and-export-notes'),
  openUrlInBrowser: (url: string) => safeIpcInvoke('open-url-in-browser', url),
  arrangeAllNotes: () => safeIpcInvoke('arrange-all-notes'),
  
  // 検索関連のメソッド
  searchNotes: (query: SearchQuery) => safeIpcInvoke('search-notes', query),
  openNoteById: (noteId: string) => safeIpcInvoke('open-note-by-id', noteId),
  closeSearch: () => safeIpcInvoke('close-search'),
  
  // コンソール関連のメソッド
  openConsole: () => safeIpcInvoke('open-console'),
});

contextBridge.exposeInMainWorld('electron', {
  showContextMenu: () => safeIpcInvoke('show-context-menu'),
  showContextMenuWithUrl: (url: string | null) => safeIpcInvoke('show-context-menu-with-url', url),
  showInactiveHeaderContextMenu: (noteId: string) => safeIpcInvoke('show-inactive-header-context-menu', noteId),
});