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
    
    // デバッグ情報をログ出力
    console.log('=== DataStore Debug Info ===');
    console.log('App userData path:', app.getPath('userData'));
    console.log('Data directory:', this.dataPath);
    console.log('Notes file:', this.notesFile);
    console.log('Settings file:', this.settingsFile);
    console.log('============================');
    
    this.ensureDataDirectory();
  }

  private ensureDataDirectory() {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  async getAllNotes(): Promise<StickyNote[]> {
    try {
      console.log(`Loading notes from: ${this.notesFile}`);
      
      if (!fs.existsSync(this.notesFile)) {
        console.log('Notes file does not exist, returning empty array');
        return [];
      }
      
      const stats = fs.statSync(this.notesFile);
      console.log(`Notes file size: ${stats.size} bytes`);
      
      const data = fs.readFileSync(this.notesFile, 'utf8');
      console.log(`Read ${data.length} characters from notes file`);
      
      const notes = JSON.parse(data);
      console.log(`Parsed ${notes.length} notes from file`);
      
      // 古い形式のデータを新しい形式に移行
      const migratedNotes = notes.map((note: any) => this.migrateNoteFormat(note));
      console.log(`Migrated ${migratedNotes.length} notes`);
      
      return migratedNotes;
    } catch (error) {
      console.error('Error loading notes:', error);
      console.error('Error details:', {
        notesFile: this.notesFile,
        fileExists: fs.existsSync(this.notesFile),
        error: error instanceof Error ? error.message : error
      });
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
      backgroundColor: note.backgroundColor || '#CCFFE6',
      headerColor: note.headerColor, // headerColorはオプショナルなのでundefinedでも良い
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
      await this.saveNotesAtomic(notes);
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  private async saveNotesAtomic(notes: StickyNote[]): Promise<void> {
    const tempFile = this.notesFile + '.tmp';
    const data = JSON.stringify(notes, null, 2);
    
    try {
      console.log(`Saving ${notes.length} notes to ${this.notesFile}`);
      
      // 一時ファイルに書き込み
      fs.writeFileSync(tempFile, data);
      console.log(`Temporary file written: ${tempFile}`);
      
      // 原子的にリネーム（書き込み完了を保証）
      fs.renameSync(tempFile, this.notesFile);
      console.log(`File successfully saved: ${this.notesFile}`);
      
      // ファイルサイズを確認
      const stats = fs.statSync(this.notesFile);
      console.log(`Saved file size: ${stats.size} bytes`);
      
    } catch (error) {
      console.error('Error in saveNotesAtomic:', error);
      console.error('Error details:', {
        tempFile,
        notesFile: this.notesFile,
        dataLength: data.length,
        error: error instanceof Error ? error.message : error
      });
      
      // エラーが発生した場合は一時ファイルを削除
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log('Temporary file cleaned up');
      }
      throw error;
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
      headerColor: nearNote ? nearNote.headerColor : settings.defaultHeaderColor, // 親付箋のヘッダー色を引き継ぐ
      fontSize: nearNote ? nearNote.fontSize : settings.defaultFontSize,
      isPinned: nearNote ? nearNote.isPinned : false,  // 親付箋のピン設定を引き継ぐ
      isLocked: false,
      displayId: nearNote ? nearNote.displayId : '1', // 親付箋のディスプレイを引き継ぐ
      isActive: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    notes.push(newNote);
    await this.saveNotes(notes);
    return newNote;
  }

  async updateNote(id: string, updates: Partial<StickyNote>): Promise<void> {
    console.log(`=== updateNote called ===`);
    console.log(`Note ID: ${id}`);
    console.log(`Updates:`, updates);
    
    const notes = await this.getAllNotes();
    const index = notes.findIndex(note => note.id === id);
    
    if (index !== -1) {
      const currentNote = notes[index];
      console.log(`Found note at index ${index}`);
      console.log(`Current note content length: ${typeof currentNote.content === 'string' ? currentNote.content.length : 'N/A'}`);
      
      // 数値フィールドの検証と正規化
      const validatedUpdates = this.validateNoteUpdates(updates);
      console.log(`Validated updates:`, validatedUpdates);
      
      // 更新を適用
      const updatedNote = { 
        ...currentNote, 
        ...validatedUpdates, 
        updatedAt: Date.now() 
      };
      notes[index] = updatedNote;
      
      console.log(`Updated note content length: ${typeof updatedNote.content === 'string' ? updatedNote.content.length : 'N/A'}`);
      
      await this.saveNotes(notes);
      console.log(`Note ${id} updated successfully`);
    } else {
      console.warn(`Note with ID ${id} not found in ${notes.length} notes`);
    }
    console.log(`=== updateNote finished ===`);
  }

  private validateNoteUpdates(updates: Partial<StickyNote>): Partial<StickyNote> {
    const validated = { ...updates };
    
    // 数値フィールドの検証
    const numericFields = ['activeX', 'activeY', 'activeWidth', 'activeHeight', 
                          'inactiveX', 'inactiveY', 'inactiveWidth', 'inactiveHeight'] as const;
    
    numericFields.forEach(field => {
      if (field in validated) {
        const value = validated[field] as number;
        if (typeof value !== 'number' || isNaN(value)) {
          console.warn(`Invalid ${field} value: ${value}, setting to default`);
          delete validated[field];
        } else {
          // 整数に丸める
          validated[field] = Math.round(value) as any;
        }
      }
    });
    
    return validated;
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.getAllNotes();
    const filteredNotes = notes.filter(note => note.id !== id);
    await this.saveNotes(filteredNotes);
  }

  async updateNotePosition(id: string, x: number, y: number, isActive: boolean): Promise<void> {
    console.log(`Updating position for note ${id}: x=${x}, y=${y}, isActive=${isActive}`);
    
    // 数値の検証
    const validX = Math.round(Number(x) || 0);
    const validY = Math.round(Number(y) || 0);
    
    if (isActive) {
      await this.updateNote(id, { activeX: validX, activeY: validY });
      console.log(`Updated active position: activeX=${validX}, activeY=${validY}`);
    } else {
      await this.updateNote(id, { inactiveX: validX, inactiveY: validY });
      console.log(`Updated inactive position: inactiveX=${validX}, inactiveY=${validY}`);
    }
  }

  async updateNoteSize(id: string, width: number, height: number, isActive: boolean): Promise<void> {
    console.log(`Updating size for note ${id}: width=${width}, height=${height}, isActive=${isActive}`);
    
    if (isActive) {
      // 数値の検証と最小サイズの確保
      const validWidth = Math.max(Math.round(Number(width) || 150), 150);
      const validHeight = Math.max(Math.round(Number(height) || 100), 100);
      
      await this.updateNote(id, { activeWidth: validWidth, activeHeight: validHeight });
      console.log(`Updated active size: activeWidth=${validWidth}, activeHeight=${validHeight}`);
    }
    // 非アクティブ時のサイズは固定なので変更しない
  }

  async getSettings(): Promise<AppSettings> {
    try {
      if (!fs.existsSync(this.settingsFile)) {
        const defaultSettings: AppSettings = {
          defaultFontSize: 14,
          defaultBackgroundColor: '#CCFFE6'  // パステルグリーン
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
        defaultBackgroundColor: '#CCFFE6'
      };
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    try {
      await this.saveSettingsAtomic(settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  private async saveSettingsAtomic(settings: AppSettings): Promise<void> {
    const tempFile = this.settingsFile + '.tmp';
    const data = JSON.stringify(settings, null, 2);
    
    try {
      // 一時ファイルに書き込み
      fs.writeFileSync(tempFile, data);
      
      // 原子的にリネーム（書き込み完了を保証）
      fs.renameSync(tempFile, this.settingsFile);
    } catch (error) {
      // エラーが発生した場合は一時ファイルを削除
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  }

  async forceFlushAll(): Promise<void> {
    try {
      const notes = await this.getAllNotes();
      await this.saveNotesAtomic(notes);
      console.log('Emergency data flush completed successfully');
    } catch (error) {
      console.error('Error during emergency data flush:', error);
      throw error;
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}