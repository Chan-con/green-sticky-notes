import { contextBridge, ipcRenderer } from 'electron';
import { StickyNote } from '../types';

contextBridge.exposeInMainWorld('electronAPI', {
  onNoteData: (callback: (note: StickyNote) => void) => {
    ipcRenderer.on('note-data', (_, note) => callback(note));
  },
  
  
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
});

contextBridge.exposeInMainWorld('electron', {
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
});