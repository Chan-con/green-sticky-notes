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
    if (process.env.NODE_ENV === 'development') {
      console.log('=== DataStore Debug Info ===');
      console.log('App userData path:', app.getPath('userData'));
      console.log('Data directory:', this.dataPath);
      console.log('Notes file:', this.notesFile);
      console.log('Settings file:', this.settingsFile);
      console.log('============================');
    }
    
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
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Loaded and migrated ${migratedNotes.length} notes`);
      }
      
      return migratedNotes;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error loading notes:', error);
        console.error('Error details:', {
          notesFile: this.notesFile,
          fileExists: fs.existsSync(this.notesFile),
          error: error instanceof Error ? error.message : error
        });
      }
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
      // 一時ファイルに書き込み
      fs.writeFileSync(tempFile, data);
      
      // 原子的にリネーム（書き込み完了を保証）
      fs.renameSync(tempFile, this.notesFile);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Saved ${notes.length} notes to ${this.notesFile}`);
      }
      
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error in saveNotesAtomic:', error);
        console.error('Error details:', {
          tempFile,
          notesFile: this.notesFile,
          dataLength: data.length,
          error: error instanceof Error ? error.message : error
        });
      }
      
      // エラーが発生した場合は一時ファイルを削除
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  }

  async createNote(nearNote?: StickyNote): Promise<StickyNote> {
    const notes = await this.getAllNotes();
    const settings = await this.getSettings();
    
    // 設定からデフォルトサイズを取得
    const defaultActiveWidth = 300;
    const defaultActiveHeight = 200;
    const defaultInactiveWidth = settings.defaultInactiveWidth || 150;
    const defaultInactiveHeight = settings.defaultInactiveHeight || 125;
    
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
      // 非アクティブ状態の位置とサイズ（設定から取得）
      inactiveX: baseX,
      inactiveY: baseY,
      inactiveWidth: defaultInactiveWidth,
      inactiveHeight: defaultInactiveHeight,
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
    const notes = await this.getAllNotes();
    const index = notes.findIndex(note => note.id === id);
    
    if (index !== -1) {
      const currentNote = notes[index];
      
      // 数値フィールドの検証と正規化
      const validatedUpdates = this.validateNoteUpdates(updates);
      
      // 更新を適用
      const updatedNote = { 
        ...currentNote, 
        ...validatedUpdates, 
        updatedAt: Date.now() 
      };
      notes[index] = updatedNote;
      
      await this.saveNotes(notes);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Note ${id} updated successfully`);
      }
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Note with ID ${id} not found in ${notes.length} notes`);
      }
    }
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
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Invalid ${field} value: ${value}, setting to default`);
          }
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
    // 数値の検証
    const validX = Math.round(Number(x) || 0);
    const validY = Math.round(Number(y) || 0);
    
    if (isActive) {
      await this.updateNote(id, { activeX: validX, activeY: validY });
    } else {
      await this.updateNote(id, { inactiveX: validX, inactiveY: validY });
    }
  }

  async updateNoteSize(id: string, width: number, height: number, isActive: boolean): Promise<void> {
    if (isActive) {
      // 数値の検証と最小サイズの確保
      const validWidth = Math.max(Math.round(Number(width) || 150), 150);
      const validHeight = Math.max(Math.round(Number(height) || 100), 100);
      
      await this.updateNote(id, { activeWidth: validWidth, activeHeight: validHeight });
    }
    // 非アクティブ時のサイズは固定なので変更しない
  }

  async getSettings(): Promise<AppSettings> {
    try {
      if (!fs.existsSync(this.settingsFile)) {
        const defaultSettings: AppSettings = {
          defaultFontSize: 14,
          defaultBackgroundColor: '#CCFFE6',  // パステルグリーン
          headerIconSize: 16,  // デフォルトヘッダーアイコンサイズ
          defaultInactiveWidth: 150,  // 非アクティブモードのデフォルト幅（50-300の中間値）
          defaultInactiveHeight: 125,  // 非アクティブモードのデフォルト高さ（50-200の中間値）
          defaultInactiveFontSize: 12  // 非アクティブモードのデフォルトフォントサイズ（8-20の中間値）
        };
        console.log('[DEBUG] Settings file not found, creating default:', defaultSettings);
        await this.saveSettings(defaultSettings);
        return defaultSettings;
      }
      const data = fs.readFileSync(this.settingsFile, 'utf8');
      const rawSettings = JSON.parse(data);
      console.log('[DEBUG] Raw settings loaded from file:', rawSettings);
      
      // 欠損したフィールドを補完
      const settings: AppSettings = {
        defaultFontSize: rawSettings.defaultFontSize ?? 14,
        defaultBackgroundColor: rawSettings.defaultBackgroundColor ?? '#CCFFE6',
        headerIconSize: rawSettings.headerIconSize ?? 16,
        defaultInactiveWidth: rawSettings.defaultInactiveWidth ?? 150,
        defaultInactiveHeight: rawSettings.defaultInactiveHeight ?? 125,
        defaultInactiveFontSize: rawSettings.defaultInactiveFontSize ?? 12,
        showAllHotkey: rawSettings.showAllHotkey,
        hideAllHotkey: rawSettings.hideAllHotkey,
        searchHotkey: rawSettings.searchHotkey,
        pinHotkey: rawSettings.pinHotkey,
        lockHotkey: rawSettings.lockHotkey,
        autoStart: rawSettings.autoStart ?? false
      };
      
      console.log('[DEBUG] Settings after field completion:', settings);
      
      // 補完した設定を保存（次回の読み込み時にデフォルト値の適用を避けるため）
      if (rawSettings.defaultInactiveWidth === undefined || rawSettings.defaultInactiveHeight === undefined || rawSettings.defaultInactiveFontSize === undefined) {
        console.log('[DEBUG] Saving completed settings to avoid default fallback next time');
        await this.saveSettings(settings);
      }
      
      return settings;
    } catch (error) {
      console.error('Error loading settings:', error);
      const fallbackSettings = {
        defaultFontSize: 14,
        defaultBackgroundColor: '#CCFFE6',
        headerIconSize: 16,
        defaultInactiveWidth: 150,  // 50-300の中間値
        defaultInactiveHeight: 125,  // 50-200の中間値
        defaultInactiveFontSize: 12  // 8-20の中間値
      };
      console.log('[DEBUG] Using fallback settings:', fallbackSettings);
      return fallbackSettings;
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    try {
      await this.saveSettingsAtomic(settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    try {
      const currentSettings = await this.getSettings();
      const updatedSettings = { ...currentSettings, ...updates };
      console.log('[DEBUG] updateSettings - current:', currentSettings);
      console.log('[DEBUG] updateSettings - updates:', updates);
      console.log('[DEBUG] updateSettings - final:', updatedSettings);
      await this.saveSettings(updatedSettings);
      console.log('[DEBUG] Settings updated successfully');
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
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
      if (process.env.NODE_ENV === 'development') {
        console.log('Emergency data flush completed successfully');
      }
    } catch (error) {
      console.error('Error during emergency data flush:', error);
      throw error;
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}