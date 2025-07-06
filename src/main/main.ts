import { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, globalShortcut } from 'electron';
import * as path from 'path';
import { StickyNote, DisplayInfo, AppSettings, SearchQuery } from '../types';
import { DataStore } from './dataStore';
import { WindowStateManager } from './windowStateManager';
import { SearchService } from './searchService';

class StickyNotesApp {
  private windows: Map<string, BrowserWindow> = new Map();
  private dataStore: DataStore;
  private windowStateManager: WindowStateManager;
  private tray: Tray | null = null;
  private isQuitting = false;
  private pendingTimers: Map<string, { moveTimeout?: NodeJS.Timeout, resizeTimeout?: NodeJS.Timeout }> = new Map();
  private settingsWindow: BrowserWindow | null = null;
  private searchWindow: BrowserWindow | null = null;
  private consoleWindow: BrowserWindow | null = null;
  private registeredHotkeys: Set<string> = new Set();
  private searchService: SearchService;
  private isSettingsWindowOpen: boolean = false;

  constructor() {
    this.dataStore = new DataStore();
    this.windowStateManager = new WindowStateManager();
    this.searchService = new SearchService();
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // シングルインスタンス確保
    const gotTheLock = app.requestSingleInstanceLock();
    
    if (!gotTheLock) {
      // 既に起動中の場合は終了
      app.quit();
      return;
    }
    
    // 2つ目のインスタンスが起動しようとした場合の処理
    app.on('second-instance', () => {
      this.showAllWindows();
    });

    app.whenReady().then(async () => {
      this.createTray();
      this.createInitialNotes();
      this.setupIpcHandlers();
      
      // 検索サービスを初期化
      await this.initializeSearchService();
      
      // 保存済みホットキーを復元
      await this.restoreHotkeys();
      
      // screenイベントはapp.whenReady()後に設定
      screen.on('display-added', () => this.handleDisplayChange());
      screen.on('display-removed', () => this.handleDisplayChange());
      screen.on('display-metrics-changed', () => this.handleDisplayChange());
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createInitialNotes();
        }
      });
    });

    app.on('window-all-closed', () => {
      // タスクトレイがある場合はアプリを終了しない
      if (process.platform !== 'darwin' && this.isQuitting) {
        app.quit();
      }
    });

    app.on('before-quit', async (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        try {
          await this.flushAllPendingData();
          await this.dataStore.forceFlushAll();
          
          // ホットキーをクリーンアップ
          this.unregisterAllHotkeys();
          
          this.isQuitting = true;
          this.hideAllWindows();
          
          // データ保存完了後に実際に終了
          setTimeout(() => {
            app.quit();
          }, 100);
        } catch (error) {
          console.error('Error saving data before quit:', error);
          this.isQuitting = true;
          app.quit();
        }
      }
    });
  }

  private async createInitialNotes() {
    const notes = await this.dataStore.getAllNotes();
    
    if (notes.length === 0) {
      const newNote = await this.dataStore.createNote();
      await this.createNoteWindow(newNote);
    } else {
      for (const note of notes) {
        await this.createNoteWindow(note);
      }
    }
  }


  private async createNoteWindow(note: StickyNote): Promise<BrowserWindow> {
    // ウィンドウ作成時は既存の位置データを信頼し、最小限の調整のみ行う
    const bounds = await this.calculateNoteBounds(note);
    
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      alwaysOnTop: note.isPinned,
      skipTaskbar: true,
      resizable: note.isActive, // 非アクティブ時はリサイズ無効
      minWidth: 150,
      minHeight: 100,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        devTools: true, // コンソールボタンから開発者ツールを開けるように有効化
      },
    });

    win.setMenu(null);
    
    if (process.env.NODE_ENV === 'development') {
      win.loadURL(`http://localhost:3000?noteId=${note.id}`);
    } else {
      win.loadFile(path.join(__dirname, 'index.html'), { query: { noteId: note.id } });
    }

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('note-data', note);
    });

    // 開発者ツールのショートカットキーをブロック
    win.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });

    // タイマー管理用オブジェクトを初期化
    if (!this.pendingTimers.has(note.id)) {
      this.pendingTimers.set(note.id, {});
    }
    
    win.on('moved', async () => {
      const [x, y] = win.getPosition();
      const timers = this.pendingTimers.get(note.id)!;
      
      // 頻繁な更新をデバウンス
      if (timers.moveTimeout) {
        clearTimeout(timers.moveTimeout);
      }
      
      timers.moveTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (!currentNote) return;
        
        // 移動先のディスプレイを検出
        const newDisplay = this.findDisplayContainingPoint(x, y);
        const updates: Partial<StickyNote> = {};
        
        // ディスプレイが変更された場合
        if (newDisplay.id.toString() !== currentNote.displayId) {
          updates.displayId = newDisplay.id.toString();
        }
        
        // 状態に応じて適切な位置フィールドを更新
        if (currentNote.isActive) {
          updates.activeX = x;
          updates.activeY = y;
        } else {
          updates.inactiveX = x;
          updates.inactiveY = y;
        }
        
        // 一度に更新
        await this.dataStore.updateNote(note.id, updates);
        
        // タイマーをクリア
        delete timers.moveTimeout;
      }, 100); // 100msのデバウンス
    });

    win.on('resized', async () => {
      const [width, height] = win.getSize();
      const timers = this.pendingTimers.get(note.id)!;
      
      // 頻繁なサイズ変更をデバウンス
      if (timers.resizeTimeout) {
        clearTimeout(timers.resizeTimeout);
      }
      
      timers.resizeTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (currentNote && currentNote.isActive) {
          // アクティブ時のみサイズを記録
          await this.dataStore.updateNoteSize(note.id, width, height, true);
        }
        
        // タイマーをクリア
        delete timers.resizeTimeout;
      }, 200); // 200msのデバウンス
    });

    win.on('closed', () => {
      this.windows.delete(note.id);
      this.windowStateManager.unregisterWindow(note.id);
      
      // ペンディング中のタイマーをクリア
      const timers = this.pendingTimers.get(note.id);
      if (timers) {
        if (timers.moveTimeout) clearTimeout(timers.moveTimeout);
        if (timers.resizeTimeout) clearTimeout(timers.resizeTimeout);
        this.pendingTimers.delete(note.id);
      }
    });

    this.windows.set(note.id, win);
    this.windowStateManager.registerWindow(note.id, note.isActive);
    return win;
  }

  /**
   * 指定された位置がどのディスプレイにあるかを検出
   */
  private findDisplayContainingPoint(x: number, y: number) {
    const displays = screen.getAllDisplays();
    
    for (const display of displays) {
      const bounds = display.bounds;
      if (x >= bounds.x && x < bounds.x + bounds.width &&
          y >= bounds.y && y < bounds.y + bounds.height) {
        return display;
      }
    }
    
    // どのディスプレイにも見つからない場合はプライマリディスプレイを返す
    return screen.getPrimaryDisplay();
  }

  /**
   * 記録されたディスプレイが存在しない場合のフォールバック処理
   */
  private findValidDisplayForNote(note: StickyNote, isActive: boolean): { display: any, shouldMigrate: boolean } {
    const displays = screen.getAllDisplays();
    const targetDisplayId = note.displayId;
    
    // 記録されたディスプレイを検索
    const savedDisplay = displays.find(d => d.id.toString() === targetDisplayId);
    
    if (savedDisplay) {
      return { display: savedDisplay, shouldMigrate: false };
    }
    
    // ディスプレイがない場合はプライマリディスプレイに移動
    return { display: screen.getPrimaryDisplay(), shouldMigrate: true };
  }

  /**
   * ユーザーが設定した位置を正確に復元する
   */
  private async calculateNoteBounds(note: StickyNote, currentWindowX?: number, currentWindowY?: number) {
    // アクティブ/非アクティブ状態に応じて位置とサイズを取得
    let x, y, width, height;
    
    if (note.isActive) {
      // アクティブ状態の場合
      if (note.activeX !== 0 && note.activeY !== 0) {
        // すでにアクティブ位置が設定されている場合はそのまま使用
        x = note.activeX;
        y = note.activeY;
      } else {
        // 初回アクティブ化の場合は現在位置をそのまま維持（境界チェックも最小限に）
        x = currentWindowX !== undefined ? currentWindowX : (note.inactiveX || 100);
        y = currentWindowY !== undefined ? currentWindowY : (note.inactiveY || 100);
      }
      width = note.activeWidth || 300;
      height = note.activeHeight || 200;
    } else {
      // 非アクティブ状態は記録された位置を正確に復元
      x = note.inactiveX || 100;
      y = note.inactiveY || 100;
      width = note.inactiveWidth || 150;
      height = note.inactiveHeight || 100;
    }

    // 数値型を確実にする
    x = Number(x) || 100;
    y = Number(y) || 100;
    width = Number(width) || (note.isActive ? 300 : 150);
    height = Number(height) || (note.isActive ? 200 : 100);

    // 実際の位置からディスプレイを検出（より正確な方法）
    const actualDisplay = this.findDisplayContainingPoint(x, y);
    
    // 記録されたdisplayIdと実際のディスプレイの比較
    const savedDisplayId = note.displayId;
    const actualDisplayId = actualDisplay.id.toString();
    const displayChanged = savedDisplayId !== actualDisplayId;
    
    // フォールバック: 記録されたディスプレイが存在しない場合のチェック
    const { display: savedDisplay, shouldMigrate } = this.findValidDisplayForNote(note, note.isActive);
    
    // 使用するディスプレイを決定（移行が必要な場合はプライマリディスプレイを使用）
    const currentDisplay = shouldMigrate ? screen.getPrimaryDisplay() : actualDisplay;
    
    // 移行が必要な場合の処理
    if (shouldMigrate) {
      // プライマリディスプレイの安全な位置を計算
      const primaryBounds = currentDisplay.bounds;
      const safeMargin = 50;
      x = primaryBounds.x + safeMargin;
      y = primaryBounds.y + safeMargin;
    } else {
      // 最小限の境界チェック（初回アクティブ化時は特に緩く）
      const bounds = currentDisplay.bounds;
      const isFirstTimeActive = note.isActive && (note.activeX === 0 && note.activeY === 0);
      
      
      // 境界チェックをより寛容にする
      if (isFirstTimeActive) {
        // 初回アクティブ化時は境界チェックをスキップ
      } else if (displayChanged) {
        // ディスプレイが変わった場合は最小限の調整のみ
        // 完全に画面外の場合のみ調整（非常に緩い条件）
        const isCompletelyOutside = 
          x + width < bounds.x || x > bounds.x + bounds.width ||
          y + height < bounds.y || y > bounds.y + bounds.height;
          
        if (isCompletelyOutside) {
          const oldX = x, oldY = y;
          x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
          y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));
        }
      } else {
        // 同じディスプレイ内での通常の境界チェック
        const margin = 100; // より大きなマージンでユーザーの意図を尊重
        const isVirtuallyOutside = 
          x + margin > bounds.x + bounds.width ||  // 左端が右端より外
          x + width - margin < bounds.x ||         // 右端が左端より外
          y + margin > bounds.y + bounds.height || // 上端が下端より外
          y + height - margin < bounds.y;          // 下端が上端より外
          
        if (isVirtuallyOutside) {
          const oldX = x, oldY = y;
          x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
          y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));
        }
      }
    }

    return { 
      x, 
      y, 
      width, 
      height, 
      displayId: currentDisplay.id.toString(),
      shouldMigrate,
      displayChanged
    };
  }


  private async handleDisplayChange() {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // 各ウィンドウの処理を並列実行
    const migrationPromises = Array.from(this.windows.entries()).map(async ([noteId, win]) => {
      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      const noteDisplay = displays.find(d => d.id.toString() === note.displayId);
      
      if (!noteDisplay) {
        // プライマリディスプレイの安全な位置を計算
        const safeMargin = 50;
        const newX = primaryDisplay.bounds.x + safeMargin;
        const newY = primaryDisplay.bounds.y + safeMargin;
        
        // ウィンドウを新しい位置に移動
        win.setPosition(newX, newY);
        
        // データベースを更新（状態に応じて適切なフィールドを更新）
        const updates: Partial<StickyNote> = {
          displayId: primaryDisplay.id.toString()
        };
        
        if (note.isActive) {
          updates.activeX = newX;
          updates.activeY = newY;
        } else {
          updates.inactiveX = newX;
          updates.inactiveY = newY;
        }
        
        await this.dataStore.updateNote(noteId, updates);
      } else {
        // ディスプレイが存在する場合は、境界チェックを実行
        const [currentX, currentY] = win.getPosition();
        const bounds = noteDisplay.bounds;
        
        const isOutside = 
          currentX < bounds.x || currentX > bounds.x + bounds.width ||
          currentY < bounds.y || currentY > bounds.y + bounds.height;
        
        if (isOutside) {
          const adjustedX = Math.max(bounds.x, Math.min(currentX, bounds.x + bounds.width - 150));
          const adjustedY = Math.max(bounds.y, Math.min(currentY, bounds.y + bounds.height - 100));
          
          win.setPosition(adjustedX, adjustedY);
          
          // 調整された位置をデータベースに保存
          const updates: Partial<StickyNote> = {};
          if (note.isActive) {
            updates.activeX = adjustedX;
            updates.activeY = adjustedY;
          } else {
            updates.inactiveX = adjustedX;
            updates.inactiveY = adjustedY;
          }
          
          await this.dataStore.updateNote(noteId, updates);
        }
      }
    });
    
    // すべての移行処理を並列実行
    await Promise.all(migrationPromises);
  }

  private setupIpcHandlers() {
    ipcMain.handle('create-note', async (_, nearNoteId?: string) => {
      let nearNote: StickyNote | null = null;
      if (nearNoteId) {
        nearNote = await this.dataStore.getNote(nearNoteId);
      }
      
      const newNote = await this.dataStore.createNote(nearNote || undefined);
      // 新しい付箋は非アクティブ状態で作成
      await this.dataStore.updateNote(newNote.id, { isActive: false });
      
      // 親付箋と同じ位置に配置
      if (nearNote) {
        const parentWindow = this.windows.get(nearNoteId!);
        if (parentWindow) {
          // 親付箋の現在位置を取得
          const [parentX, parentY] = parentWindow.getPosition();
          const [parentWidth, parentHeight] = parentWindow.getSize();
          
          
          // 画面境界チェック
          const display = screen.getAllDisplays().find(d => d.id.toString() === newNote.displayId) || screen.getPrimaryDisplay();
          const noteWidth = 150; // 非アクティブ時のデフォルト幅
          const noteHeight = 100; // 非アクティブ時のデフォルト高さ
          
          let finalX = parentX;
          let finalY = parentY;
          
          // 画面境界チェックと修正
          if (finalX + noteWidth > display.bounds.x + display.bounds.width) {
            finalX = display.bounds.x + display.bounds.width - noteWidth;
          }
          if (finalY + noteHeight > display.bounds.y + display.bounds.height) {
            finalY = display.bounds.y + display.bounds.height - noteHeight;
          }
          if (finalX < display.bounds.x) finalX = display.bounds.x;
          if (finalY < display.bounds.y) finalY = display.bounds.y;
          
          // 位置を更新（非アクティブ位置のみ設定、アクティブ位置は初回アクティブ化時に設定）
          await this.dataStore.updateNote(newNote.id, { 
            inactiveX: finalX, 
            inactiveY: finalY
          });
        }
      }
      
      const finalNote = await this.dataStore.getNote(newNote.id);
      if (finalNote) {
        // 作成位置のディスプレイIDを設定
        const noteDisplay = this.findDisplayContainingPoint(finalNote.inactiveX, finalNote.inactiveY);
        if (noteDisplay.id.toString() !== finalNote.displayId) {
          await this.dataStore.updateNote(newNote.id, { displayId: noteDisplay.id.toString() });
        }
        
        const newWindow = await this.createNoteWindow(finalNote);
        
        // 新しい付箋を手前に表示（親付箋より上のレイヤー）
        if (nearNoteId) {
          const parentWindow = this.windows.get(nearNoteId);
          if (parentWindow) {
            newWindow.moveTop();
          }
        }
      }
      
      return newNote;
    });

    ipcMain.handle('update-note', async (_, noteId: string, updates: Partial<StickyNote>) => {
      await this.dataStore.updateNote(noteId, updates);
      
      // 検索インデックスを更新
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        this.searchService.updateNoteInIndex(updatedNote);
      }
      
      return true;
    });

    ipcMain.handle('delete-note', async (_, noteId: string) => {
      const win = this.windows.get(noteId);
      if (win) {
        win.close();
      }
      
      // 検索インデックスから削除
      this.searchService.removeNoteFromIndex(noteId);
      
      await this.dataStore.deleteNote(noteId);
      
      // 削除後、残りの付箋数をチェック
      const remainingNotes = await this.dataStore.getAllNotes();
      if (remainingNotes.length === 0) {
        // 左上に新規付箋を作成
        const display = screen.getPrimaryDisplay();
        const newNote = await this.dataStore.createNote();
        
        // 左上位置に設定（非アクティブ位置のみ）
        await this.dataStore.updateNote(newNote.id, {
          inactiveX: display.bounds.x + 50,
          inactiveY: display.bounds.y + 50,
          isActive: false
        });
        
        const finalNote = await this.dataStore.getNote(newNote.id);
        if (finalNote) {
          // 作成位置のディスプレイIDを設定
          const noteDisplay = this.findDisplayContainingPoint(finalNote.inactiveX, finalNote.inactiveY);
          if (noteDisplay.id.toString() !== finalNote.displayId) {
            await this.dataStore.updateNote(newNote.id, { displayId: noteDisplay.id.toString() });
          }
          
          await this.createNoteWindow(finalNote);
        }
      }
      
      return true;
    });

    ipcMain.handle('set-note-active', async (_, noteId: string, isActive: boolean) => {
      const win = this.windows.get(noteId);
      if (!win) return;

      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      // 状態変更が許可されているかチェック
      if (!this.windowStateManager.requestStateChange(noteId, isActive)) {
        return;
      }

      // 現在の位置とサイズを正確に取得
      const [currentX, currentY] = win.getPosition();
      const [currentWidth, currentHeight] = win.getSize();
      
      
      // 状態変更を原子的に実行
      const updates: Partial<StickyNote> = { isActive };
      
      // 現在の状態に応じて位置・サイズを保存
      if (note.isActive && !isActive) {
        // アクティブ→非アクティブ: アクティブ状態の位置・サイズを保存
        updates.activeX = currentX;
        updates.activeY = currentY;
        updates.activeWidth = currentWidth;
        updates.activeHeight = currentHeight;
      } else if (!note.isActive && isActive) {
        // 非アクティブ→アクティブ: 非アクティブ状態の位置を保存
        updates.inactiveX = currentX;
        updates.inactiveY = currentY;
      }

      // 一度の更新で状態変更を実行
      await this.dataStore.updateNote(noteId, updates);
      
      // 更新された状態で位置とサイズを再計算（現在のウィンドウ位置を基準に）
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        const bounds = await this.calculateNoteBounds(updatedNote, currentX, currentY);
        
        // ディスプレイ変更の処理
        const migrationUpdates: Partial<StickyNote> = {};
        
        if (bounds.shouldMigrate) {
          // ディスプレイが存在しない場合の移行
          migrationUpdates.displayId = bounds.displayId;
          if (isActive) {
            migrationUpdates.activeX = bounds.x;
            migrationUpdates.activeY = bounds.y;
          } else {
            migrationUpdates.inactiveX = bounds.x;
            migrationUpdates.inactiveY = bounds.y;
          }
          await this.dataStore.updateNote(noteId, migrationUpdates);
        } else if (bounds.displayChanged) {
          // 実際の位置に基づくディスプレイ変更（自然な移動）
          migrationUpdates.displayId = bounds.displayId;
          await this.dataStore.updateNote(noteId, migrationUpdates);
        }
        
        // 初回アクティブ化時は現在位置をアクティブ位置として保存
        if (isActive && (note.activeX === 0 && note.activeY === 0)) {
          await this.dataStore.updateNote(noteId, {
            activeX: currentX,
            activeY: currentY,
            displayId: bounds.displayId  // ディスプレイIDも同時に更新
          });
        }
        
        // setBoundsに渡すオブジェクトの型を確実にする
        win.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height)
        });
        
        // アクティブ状態に応じてリサイズ可能性を設定
        win.setResizable(isActive);
        
        if (isActive) {
          win.focus();
        }
        
        // 状態変更完了を通知
        this.windowStateManager.completeStateChange(noteId, isActive);
      }
    });

    ipcMain.handle('set-note-pin', (_, noteId: string, isPinned: boolean) => {
      const win = this.windows.get(noteId);
      if (win) {
        win.setAlwaysOnTop(isPinned);
      }
    });

    ipcMain.handle('get-displays', () => {
      return screen.getAllDisplays().map(display => ({
        id: display.id.toString(),
        bounds: display.bounds,
        isPrimary: display === screen.getPrimaryDisplay()
      }));
    });

    ipcMain.handle('show-context-menu', (event) => {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '元に戻す',
          accelerator: 'Ctrl+Z',
          role: 'undo'
        },
        {
          label: 'やり直し',
          accelerator: 'Ctrl+Y',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: '切り取り',
          accelerator: 'Ctrl+X',
          role: 'cut'
        },
        {
          label: 'コピー',
          accelerator: 'Ctrl+C',
          role: 'copy'
        },
        {
          label: '貼り付け',
          accelerator: 'Ctrl+V',
          role: 'paste'
        },
        { type: 'separator' },
        {
          label: 'すべて選択',
          accelerator: 'Ctrl+A',
          role: 'selectAll'
        }
      ]);
      
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        contextMenu.popup({ window: win });
      }
    });

    ipcMain.handle('close-settings', () => {
      if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
        this.settingsWindow.close();
        this.isSettingsWindowOpen = false;
        if (process.env.NODE_ENV === 'development') {
          console.log('Settings window closed via IPC, hotkeys enabled');
        }
      }
    });

    ipcMain.handle('get-settings', async () => {
      const settings = await this.dataStore.getSettings();
      const autoStartStatus = await this.getAutoStartStatus();
      return {
        showAllHotkey: settings.showAllHotkey || '',
        hideAllHotkey: settings.hideAllHotkey || '',
        searchHotkey: settings.searchHotkey || '',
        headerIconSize: settings.headerIconSize || 16,
        autoStart: autoStartStatus
      };
    });

    ipcMain.handle('save-settings', async (_, settingsData) => {
      try {
        // 現在のホットキーを解除
        this.unregisterAllHotkeys();
        
        // 自動開始設定を適用
        if (settingsData.autoStart !== undefined) {
          await this.setAutoStart(settingsData.autoStart);
        }
        
        // 設定を保存
        await this.dataStore.updateSettings(settingsData);
        
        // 新しいホットキーを登録
        const registrationResult = await this.registerHotkeys(settingsData);
        
        if (registrationResult && registrationResult.length > 0) {
          // ホットキー登録エラーがある場合
          return { 
            success: false, 
            error: registrationResult.join('\n') 
          };
        }
        
        // 既存の全ての付箋ウィンドウに設定変更を通知
        this.notifySettingsChange();
        
        return { success: true };
      } catch (error) {
        console.error('Error saving settings:', error);
        return { 
          success: false, 
          error: '設定の保存中にエラーが発生しました' 
        };
      }
    });

    ipcMain.handle('send-settings-preview', (_, previewSettings) => {
      this.notifySettingsPreview(previewSettings);
    });

    // 検索関連のIPCハンドラー
    ipcMain.handle('search-notes', async (_, query: SearchQuery) => {
      try {
        const notes = await this.dataStore.getAllNotes();
        const results = this.searchService.search(query, notes);
        return results;
      } catch (error) {
        console.error('Error searching notes:', error);
        return [];
      }
    });

    ipcMain.handle('open-note-by-id', async (_, noteId: string) => {
      try {
        const window = this.windows.get(noteId);
        if (window) {
          window.show();
          window.focus();
          // アクティブ状態にする
          await this.handleSetNoteActive(noteId, true);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Error opening note:', error);
        return false;
      }
    });

    ipcMain.handle('close-search', () => {
      if (this.searchWindow && !this.searchWindow.isDestroyed()) {
        this.searchWindow.close();
      }
    });

    ipcMain.handle('open-console', () => {
      this.openConsole();
    });

  }

  private createTray() {
    
    try {
      // 複数のアイコンパスを試す
      const possiblePaths = [];
      
      if (process.platform === 'win32') {
        // 開発環境のパス候補
        possiblePaths.push(
          path.join(process.cwd(), 'src/assets/icons/win/icon-16.png'),
          path.join(__dirname, '../../src/assets/icons/win/icon-16.png'),
          path.join(__dirname, '../assets/icons/win/icon-16.png')
        );
        
        // 本番環境のパス候補（app.asarに含まれる場合）
        possiblePaths.push(
          path.join(process.resourcesPath, 'app.asar', 'src/assets/icons/win/icon-16.png'),
          path.join(process.resourcesPath, 'app', 'src/assets/icons/win/icon-16.png'),
          path.join(process.resourcesPath, 'src/assets/icons/win/icon-16.png'),
          path.join(__dirname, '../src/assets/icons/win/icon-16.png')
        );
      }

      
      const fs = require('fs');
      let trayIconPath = null;
      
      // 存在するパスを見つける
      for (const iconPath of possiblePaths) {
        if (fs.existsSync(iconPath)) {
          trayIconPath = iconPath;
          break;
        }
      }

      if (!trayIconPath) {
        console.error('No tray icon found in any of the paths:', possiblePaths);
        // フォールバック: nativeImageで空のアイコンを作成
        const { nativeImage } = require('electron');
        const emptyIcon = nativeImage.createEmpty();
        this.tray = new Tray(emptyIcon);
      } else {
        this.tray = new Tray(trayIconPath);
      }

      this.tray.setToolTip('Green Sticky Notes');
      
      // トレイアイコンがクリックされた時の処理
      this.tray.on('click', () => {
        this.showAllWindows();
      });
      
      // 右クリック時のコンテキストメニュー
      this.tray.on('right-click', () => {
        this.tray?.popUpContextMenu();
      });
      
      this.updateTrayMenu();
      
    } catch (error) {
      console.error('Failed to create tray:', error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
    }
  }

  private async updateTrayMenu() {
    if (!this.tray) return;

    const settings = await this.dataStore.getSettings();
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '新しい付箋を追加',
        click: () => this.createNewNoteFromTray()
      },
      { type: 'separator' },
      {
        label: 'すべてのノートを表示',
        click: () => this.showAllWindows()
      },
      {
        label: 'すべてのノートを隠す',
        click: () => this.hideAllWindows()
      },
      { type: 'separator' },
      {
        label: '検索',
        click: () => this.toggleSearch()
      },
      { type: 'separator' },
      {
        label: '設定',
        click: () => this.openSettings()
      },
      { type: 'separator' },
      {
        label: 'アプリを終了',
        click: () => this.quitApp()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  private async createNewNoteFromTray() {
    try {
      // デフォルト設定で新規付箋を作成（引き継ぎ元なし）
      const newNote = await this.dataStore.createNote();
      
      // 作成位置のディスプレイIDを設定
      const noteDisplay = this.findDisplayContainingPoint(newNote.inactiveX, newNote.inactiveY);
      if (noteDisplay.id.toString() !== newNote.displayId) {
        await this.dataStore.updateNote(newNote.id, { displayId: noteDisplay.id.toString() });
      }
      
      // 最終的な付箋データを取得
      const finalNote = await this.dataStore.getNote(newNote.id);
      if (finalNote) {
        // ウィンドウを作成して表示
        const newWindow = await this.createNoteWindow(finalNote);
        newWindow.show();
        newWindow.focus();
      }
    } catch (error) {
      console.error('Failed to create note from tray:', error);
    }
  }

  private showAllWindows() {
    this.windows.forEach(win => {
      win.show();
      win.focus();
    });
  }

  private hideAllWindows() {
    this.windows.forEach(win => {
      win.hide();
    });
  }





  private quitApp() {
    this.isQuitting = true;
    app.quit();
  }

  // ホットキー管理メソッド
  private async restoreHotkeys() {
    try {
      const settings = await this.dataStore.getSettings();
      await this.registerHotkeys(settings);
    } catch (error) {
      console.error('Error restoring hotkeys:', error);
    }
  }

  private async registerHotkeys(settings: Partial<AppSettings>): Promise<string[]> {
    try {
      const registrationErrors: string[] = [];
      
      // 重複チェック
      const hotkeys = [
        settings.showAllHotkey?.trim(),
        settings.hideAllHotkey?.trim(),
        settings.searchHotkey?.trim()
      ].filter(Boolean);
      
      const uniqueHotkeys = new Set(hotkeys);
      if (hotkeys.length !== uniqueHotkeys.size) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Hotkey conflict: Multiple hotkeys are identical', hotkeys);
        }
        registrationErrors.push('ホットキーが重複しています');
        return registrationErrors;
      }

      // すべてのノートを表示するホットキー
      if (settings.showAllHotkey && settings.showAllHotkey.trim()) {
        const hotkey = settings.showAllHotkey.trim();
        
        // 既に登録されているかチェック
        if (globalShortcut.isRegistered(hotkey)) {
          console.warn(`Hotkey already registered by another application: ${hotkey}`);
          registrationErrors.push(`ホットキー "${hotkey}" は他のアプリケーションによって使用されています`);
        } else {
          const success = globalShortcut.register(hotkey, () => {
            if (process.env.NODE_ENV === 'development') {
              console.log(`Show all hotkey pressed. Settings window open: ${this.isSettingsWindowOpen}`);
            }
            if (!this.isSettingsWindowOpen) {
              this.showAllWindows();
            }
          });
          
          if (success) {
            this.registeredHotkeys.add(hotkey);
          } else {
            console.error(`Failed to register show all hotkey: ${hotkey}`);
            registrationErrors.push(`ホットキー "${hotkey}" の登録に失敗しました`);
          }
        }
      }

      // すべてのノートを隠すホットキー
      if (settings.hideAllHotkey && settings.hideAllHotkey.trim()) {
        const hotkey = settings.hideAllHotkey.trim();
        
        // 既に登録されているかチェック
        if (globalShortcut.isRegistered(hotkey)) {
          console.warn(`Hotkey already registered by another application: ${hotkey}`);
          registrationErrors.push(`ホットキー "${hotkey}" は他のアプリケーションによって使用されています`);
        } else {
          const success = globalShortcut.register(hotkey, () => {
            if (process.env.NODE_ENV === 'development') {
              console.log(`Hide all hotkey pressed. Settings window open: ${this.isSettingsWindowOpen}`);
            }
            if (!this.isSettingsWindowOpen) {
              this.hideAllWindows();
            }
          });
          
          if (success) {
            this.registeredHotkeys.add(hotkey);
          } else {
            console.error(`Failed to register hide all hotkey: ${hotkey}`);
            registrationErrors.push(`ホットキー "${hotkey}" の登録に失敗しました`);
          }
        }
      }

      // 検索ウィンドウを開くホットキー
      if (settings.searchHotkey && settings.searchHotkey.trim()) {
        const hotkey = settings.searchHotkey.trim();
        
        // 既に登録されているかチェック
        if (globalShortcut.isRegistered(hotkey)) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Search hotkey already registered by another application: ${hotkey}`);
          }
          registrationErrors.push(`検索ホットキー "${hotkey}" は他のアプリケーションによって使用されています。別のキーを選択してください。`);
        } else {
          const success = globalShortcut.register(hotkey, () => {
            if (process.env.NODE_ENV === 'development') {
              console.log(`Search hotkey pressed. Settings window open: ${this.isSettingsWindowOpen}`);
            }
            if (!this.isSettingsWindowOpen) {
              this.toggleSearch();
            }
          });
          
          if (success) {
            this.registeredHotkeys.add(hotkey);
            if (process.env.NODE_ENV === 'development') {
              console.log(`Search hotkey registered successfully: ${hotkey}`);
            }
          } else {
            console.error(`Failed to register search hotkey: ${hotkey}`);
            registrationErrors.push(`ホットキー "${hotkey}" の登録に失敗しました`);
          }
        }
      }


      // エラーがあった場合の処理
      if (registrationErrors.length > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Hotkey registration errors:', registrationErrors);
        }
        // ホットキー登録に失敗してもアプリは正常に動作する
        // 設定画面で使用できないホットキーについてユーザーに通知される
      }
      
      return registrationErrors;
    } catch (error) {
      console.error('Error registering hotkeys:', error);
      return ['ホットキーの登録中にエラーが発生しました'];
    }
  }

  private unregisterAllHotkeys() {
    try {
      for (const hotkey of this.registeredHotkeys) {
        globalShortcut.unregister(hotkey);
      }
      this.registeredHotkeys.clear();
      
      // 念のため、すべてのショートカットを解除
      globalShortcut.unregisterAll();
    } catch (error) {
      console.error('Error unregistering hotkeys:', error);
    }
  }

  private async initializeSearchService() {
    try {
      const notes = await this.dataStore.getAllNotes();
      await this.searchService.initialize(notes);
    } catch (error) {
      console.error('Failed to initialize search service:', error);
    }
  }

  private async handleSetNoteActive(noteId: string, isActive: boolean) {
    const win = this.windows.get(noteId);
    if (!win) return;

    const note = await this.dataStore.getNote(noteId);
    if (!note) return;

    // 状態変更が許可されているかチェック
    if (!this.windowStateManager.requestStateChange(noteId, isActive)) {
      return;
    }

    await this.dataStore.updateNote(noteId, { isActive });
    this.windowStateManager.completeStateChange(noteId, isActive);
    
    // ウィンドウサイズとリサイズ設定を更新
    const updatedNote = await this.dataStore.getNote(noteId);
    if (updatedNote) {
      const bounds = await this.calculateNoteBounds(updatedNote);
      win.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      });
      win.setResizable(isActive);
      
      if (isActive) {
        win.focus();
      }
    }
  }

  private toggleSearch() {
    if (process.env.NODE_ENV === 'development') {
      console.log('toggleSearch() called');
    }
    // 既に検索ウィンドウが開いている場合は閉じる
    if (this.searchWindow && !this.searchWindow.isDestroyed()) {
      this.searchWindow.close();
      return;
    }

    this.openSearch();
  }

  private openSearch() {
    if (process.env.NODE_ENV === 'development') {
      console.log('openSearch() called');
    }
    // 既に検索ウィンドウが開いている場合は前面に表示
    if (this.searchWindow && !this.searchWindow.isDestroyed()) {
      this.searchWindow.focus();
      return;
    }

    this.searchWindow = new BrowserWindow({
      width: 600,
      height: 500,
      resizable: false,
      frame: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        devTools: false, // 開発者ツールを無効化
      },
      show: false,
    });

    // 検索ウィンドウが閉じられた時の処理
    this.searchWindow.on('closed', () => {
      this.searchWindow = null;
    });

    // 開発者ツールのショートカットキーをブロック（検索ウィンドウ）
    this.searchWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });

    // 検索ウィンドウの内容を読み込み
    if (process.env.NODE_ENV === 'development') {
      this.searchWindow.loadURL('http://localhost:3000?search=true');
    } else {
      this.searchWindow.loadFile(path.join(__dirname, 'index.html'), { query: { search: 'true' } });
    }

    this.searchWindow.once('ready-to-show', () => {
      this.searchWindow?.show();
      this.searchWindow?.focus();
    });
  }

  private closeSearch() {
    if (this.searchWindow && !this.searchWindow.isDestroyed()) {
      this.searchWindow.close();
    }
  }

  private notifySettingsChange() {
    // 全ての付箋ウィンドウに設定変更を通知
    for (const [noteId, window] of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings-changed');
      }
    }
  }

  private notifySettingsPreview(previewSettings: any) {
    // 全ての付箋ウィンドウにプレビュー設定を送信
    for (const [noteId, window] of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings-preview', previewSettings);
      }
    }
  }

  private openSettings() {
    
    // 既に設定ウィンドウが開いている場合は前面に表示
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 450,
      height: 300,
      resizable: false,
      frame: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        devTools: true, // コンソールボタンから開発者ツールを開けるように有効化
      },
      show: false,
    });

    // 設定ウィンドウが閉じられた時の処理
    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
      this.isSettingsWindowOpen = false;
      if (process.env.NODE_ENV === 'development') {
        console.log('Settings window closed, hotkeys enabled');
      }
    });

    // 開発者ツールのショートカットキーをブロック（設定ウィンドウ）
    this.settingsWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });

    // 設定ウィンドウの内容を読み込み
    if (process.env.NODE_ENV === 'development') {
      this.settingsWindow.loadURL('http://localhost:3000?settings=true');
    } else {
      this.settingsWindow.loadFile(path.join(__dirname, 'index.html'), { query: { settings: 'true' } });
    }

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow?.show();
      this.isSettingsWindowOpen = true;
      if (process.env.NODE_ENV === 'development') {
        console.log('Settings window opened, hotkeys disabled');
      }
    });
  }

  private async getAutoStartStatus(): Promise<boolean> {
    return app.getLoginItemSettings().openAtLogin;
  }

  private async setAutoStart(enabled: boolean) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
  }

  private async toggleAutoStart() {
    const isEnabled = app.getLoginItemSettings().openAtLogin;
    app.setLoginItemSettings({
      openAtLogin: !isEnabled,
      openAsHidden: true
    });
  }

  private async flushAllPendingData(): Promise<void> {
    const flushPromises: Promise<void>[] = [];
    
    for (const [noteId, timers] of this.pendingTimers.entries()) {
      if (timers.moveTimeout) {
        clearTimeout(timers.moveTimeout);
        // 移動処理を即座に実行
        flushPromises.push(this.flushMoveUpdate(noteId));
      }
      
      if (timers.resizeTimeout) {
        clearTimeout(timers.resizeTimeout);
        // リサイズ処理を即座に実行
        flushPromises.push(this.flushResizeUpdate(noteId));
      }
    }
    
    this.pendingTimers.clear();
    
    if (flushPromises.length > 0) {
      await Promise.all(flushPromises);
    }
  }

  private async flushMoveUpdate(noteId: string): Promise<void> {
    const win = this.windows.get(noteId);
    if (!win) return;
    
    const [x, y] = win.getPosition();
    const currentNote = await this.dataStore.getNote(noteId);
    if (!currentNote) return;
    
    const newDisplay = this.findDisplayContainingPoint(x, y);
    const updates: Partial<StickyNote> = {};
    
    if (newDisplay.id.toString() !== currentNote.displayId) {
      updates.displayId = newDisplay.id.toString();
    }
    
    if (currentNote.isActive) {
      updates.activeX = x;
      updates.activeY = y;
    } else {
      updates.inactiveX = x;
      updates.inactiveY = y;
    }
    
    await this.dataStore.updateNote(noteId, updates);
  }

  private async flushResizeUpdate(noteId: string): Promise<void> {
    const win = this.windows.get(noteId);
    if (!win) return;
    
    const [width, height] = win.getSize();
    const currentNote = await this.dataStore.getNote(noteId);
    if (currentNote && currentNote.isActive) {
      await this.dataStore.updateNoteSize(noteId, width, height, true);
    }
  }

  private openConsole() {
    // 既存の付箋ウィンドウがある場合、そのウィンドウの開発者ツールを開く
    const firstWindow = Array.from(this.windows.values())[0];
    if (firstWindow && !firstWindow.isDestroyed()) {
      firstWindow.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    // 付箋ウィンドウがない場合は設定ウィンドウの開発者ツールを開く
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      // 設定ウィンドウのdevToolsを一時的に有効にして開く
      this.settingsWindow.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    // どのウィンドウもない場合は新しいコンソールウィンドウを作成
    if (this.consoleWindow && !this.consoleWindow.isDestroyed()) {
      this.consoleWindow.focus();
      return;
    }

    this.consoleWindow = new BrowserWindow({
      width: 800,
      height: 600,
      resizable: true,
      frame: true,
      title: 'Green Sticky Notes - Console',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true,
      },
      show: false,
    });

    // コンソールウィンドウが閉じられた時の処理
    this.consoleWindow.on('closed', () => {
      this.consoleWindow = null;
    });

    // 開発者ツールを開く
    this.consoleWindow.webContents.openDevTools({ mode: 'detach' });

    // 空のページを読み込み
    this.consoleWindow.loadURL('data:text/html,<html><body><h1>Green Sticky Notes Console</h1><p>開発者ツールでメインプロセスのログを確認できます。</p></body></html>');

    this.consoleWindow.once('ready-to-show', () => {
      this.consoleWindow?.show();
      this.consoleWindow?.focus();
    });
  }

}

new StickyNotesApp();