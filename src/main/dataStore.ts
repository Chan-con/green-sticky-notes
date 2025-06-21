import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { StickyNote, AppSettings } from '../types';

export class DataStore {
  private dataPath: string;
  private notesFile: string;
  private settingsFile: string;

  constructor() {
    this.dataPath = path.join(app.getPath('userData'), 'sticky-notes-data');
    this.notesFile = path.join(this.dataPath, 'notes.json');
    this.settingsFile = path.join(this.dataPath, 'settings.json');
    this.ensureDataDirectory();
  }

  private ensureDataDirectory() {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  async getAllNotes(): Promise<StickyNote[]> {
    try {
      if (!fs.existsSync(this.notesFile)) {
        return [];
      }
      const data = fs.readFileSync(this.notesFile, 'utf8');
      const notes = JSON.parse(data);
      
      // 古い形式のデータを新しい形式に移行
      const migratedNotes = notes.map((note: any) => this.migrateNoteFormat(note));
      
      return migratedNotes;
    } catch (error) {
      console.error('Error loading notes:', error);
      return [];
    }
  }

  private migrateNoteFormat(note: any): StickyNote {
    // 新しい形式のデータかチェック
    if (note.activeX !== undefined && note.activeY !== undefined) {
      return note as StickyNote;
    }

    // 古い形式から新しい形式に変換
    const minWidth = 150;
    const minHeight = 100;
    const defaultActiveWidth = 300;
    const defaultActiveHeight = 200;

    return {
      id: note.id,
      content: note.content || '',
      activeX: note.x || 100,
      activeY: note.y || 100,
      activeWidth: note.width || defaultActiveWidth,
      activeHeight: note.height || defaultActiveHeight,
      inactiveX: note.x || 100,
      inactiveY: note.y || 100,
      inactiveWidth: minWidth,
      inactiveHeight: minHeight,
      backgroundColor: note.backgroundColor || '#90EE90',
      fontSize: note.fontSize || 14,
      isPinned: note.isPinned || false,
      isLocked: note.isLocked || false,
      displayId: note.displayId || '1',
      isActive: note.isActive || false,
      createdAt: note.createdAt || Date.now(),
      updatedAt: note.updatedAt || Date.now()
    };
  }

  async getNote(id: string): Promise<StickyNote | null> {
    const notes = await this.getAllNotes();
    return notes.find(note => note.id === id) || null;
  }

  async saveNotes(notes: StickyNote[]): Promise<void> {
    try {
      fs.writeFileSync(this.notesFile, JSON.stringify(notes, null, 2));
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  async createNote(nearNote?: StickyNote): Promise<StickyNote> {
    const notes = await this.getAllNotes();
    const settings = await this.getSettings();
    
    // 最小サイズで開始
    const minWidth = 150;
    const minHeight = 100;
    const defaultActiveWidth = 300;
    const defaultActiveHeight = 200;
    
    // 基本位置（後でメイン側で衝突回避処理される）
    const baseX = nearNote ? nearNote.inactiveX : 100;
    const baseY = nearNote ? nearNote.inactiveY : 100;
    
    const newNote: StickyNote = {
      id: this.generateId(),
      content: '',
      // アクティブ状態の位置とサイズ（初回は未設定）
      activeX: 0, // 初回アクティブ化時に設定される
      activeY: 0, // 初回アクティブ化時に設定される
      activeWidth: defaultActiveWidth,
      activeHeight: defaultActiveHeight,
      // 非アクティブ状態の位置とサイズ（最小サイズ固定）
      inactiveX: baseX,
      inactiveY: baseY,
      inactiveWidth: minWidth,
      inactiveHeight: minHeight,
      backgroundColor: nearNote ? nearNote.backgroundColor : settings.defaultBackgroundColor,
      fontSize: nearNote ? nearNote.fontSize : settings.defaultFontSize,
      isPinned: nearNote ? nearNote.isPinned : false,  // 親付箋のピン設定を引き継ぐ
      isLocked: false,
      displayId: '1',
      isActive: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    notes.push(newNote);
    await this.saveNotes(notes);
    return newNote;
  }

  async updateNote(id: string, updates: Partial<StickyNote>): Promise<void> {
    const notes = await this.getAllNotes();
    const index = notes.findIndex(note => note.id === id);
    
    if (index !== -1) {
      notes[index] = { ...notes[index], ...updates, updatedAt: Date.now() };
      await this.saveNotes(notes);
    }
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.getAllNotes();
    const filteredNotes = notes.filter(note => note.id !== id);
    await this.saveNotes(filteredNotes);
  }

  async updateNotePosition(id: string, x: number, y: number, isActive: boolean): Promise<void> {
    console.log(`Updating position for note ${id}: x=${x}, y=${y}, isActive=${isActive}`);
    if (isActive) {
      await this.updateNote(id, { activeX: x, activeY: y });
      console.log(`Updated active position: activeX=${x}, activeY=${y}`);
    } else {
      await this.updateNote(id, { inactiveX: x, inactiveY: y });
      console.log(`Updated inactive position: inactiveX=${x}, inactiveY=${y}`);
    }
  }

  async updateNoteSize(id: string, width: number, height: number, isActive: boolean): Promise<void> {
    console.log(`Updating size for note ${id}: width=${width}, height=${height}, isActive=${isActive}`);
    if (isActive) {
      await this.updateNote(id, { activeWidth: width, activeHeight: height });
      console.log(`Updated active size: activeWidth=${width}, activeHeight=${height}`);
    }
    // 非アクティブ時のサイズは固定なので変更しない
  }

  async getSettings(): Promise<AppSettings> {
    try {
      if (!fs.existsSync(this.settingsFile)) {
        const defaultSettings: AppSettings = {
          defaultFontSize: 14,
          defaultBackgroundColor: '#7FDD4C'  // より鮮やかなグリーン
        };
        await this.saveSettings(defaultSettings);
        return defaultSettings;
      }
      const data = fs.readFileSync(this.settingsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading settings:', error);
      return {
        defaultFontSize: 14,
        defaultBackgroundColor: '#90EE90'
      };
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}