import { StickyNote, SearchQuery, SearchResult } from '../types';

declare global {
  interface Window {
    electron: {
      showContextMenu: () => Promise<void>;
    };
    electronAPI: {
      onNoteData: (callback: (note: StickyNote) => void) => void;
      onSettingsChanged: (callback: () => void) => void;
      onSettingsPreview: (callback: (settings: any) => void) => void;
      sendSettingsPreview: (settings: any) => Promise<void>;
      createNote: (nearNoteId?: string) => Promise<StickyNote>;
      updateNote: (noteId: string, updates: Partial<StickyNote>) => Promise<boolean>;
      deleteNote: (noteId: string) => Promise<boolean>;
      setNoteActive: (noteId: string, isActive: boolean) => Promise<void>;
      setNotePin: (noteId: string, isPinned: boolean) => Promise<void>;
      getDisplays: () => Promise<any[]>;
      closeSettings: () => Promise<void>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<boolean>;
      exportNotesToTxt: () => Promise<{success: boolean; path?: string; error?: string}>;
      selectFolderAndExportNotes: () => Promise<{success: boolean; path?: string; error?: string}>;
      openUrlInBrowser: (url: string) => Promise<boolean>;
      
      // 検索関連のメソッド
      searchNotes: (query: SearchQuery) => Promise<SearchResult[]>;
      openNoteById: (noteId: string) => Promise<boolean>;
      closeSearch: () => void;
      
      // コンソール関連のメソッド
      openConsole: () => Promise<void>;
    };
  }
}

export {};