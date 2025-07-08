import { contextBridge, ipcRenderer } from 'electron';
import { StickyNote, SearchQuery } from '../types';

contextBridge.exposeInMainWorld('electronAPI', {
  onNoteData: (callback: (note: StickyNote) => void) => {
    ipcRenderer.on('note-data', (_, note) => callback(note));
  },
  
  onSettingsChanged: (callback: () => void) => {
    ipcRenderer.on('settings-changed', () => callback());
  },
  
  onSettingsPreview: (callback: (settings: any) => void) => {
    ipcRenderer.on('settings-preview', (_, settings) => callback(settings));
  },
  
  sendSettingsPreview: (settings: any) => ipcRenderer.invoke('send-settings-preview', settings),
  
  
  createNote: (nearNoteId?: string) => ipcRenderer.invoke('create-note', nearNoteId),
  updateNote: (noteId: string, updates: Partial<StickyNote>) => 
    ipcRenderer.invoke('update-note', noteId, updates),
  deleteNote: (noteId: string) => ipcRenderer.invoke('delete-note', noteId),
  setNoteActive: (noteId: string, isActive: boolean) => 
    ipcRenderer.invoke('set-note-active', noteId, isActive),
  setNotePin: (noteId: string, isPinned: boolean) => 
    ipcRenderer.invoke('set-note-pin', noteId, isPinned),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  exportNotesToTxt: () => ipcRenderer.invoke('export-notes-to-txt'),
  selectFolderAndExportNotes: () => ipcRenderer.invoke('select-folder-and-export-notes'),
  openUrlInBrowser: (url: string) => ipcRenderer.invoke('open-url-in-browser', url),
  
  // 検索関連のメソッド
  searchNotes: (query: SearchQuery) => ipcRenderer.invoke('search-notes', query),
  openNoteById: (noteId: string) => ipcRenderer.invoke('open-note-by-id', noteId),
  closeSearch: () => ipcRenderer.invoke('close-search'),
  
  // コンソール関連のメソッド
  openConsole: () => ipcRenderer.invoke('open-console'),
});

contextBridge.exposeInMainWorld('electron', {
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
});