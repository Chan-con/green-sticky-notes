import { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, globalShortcut, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { StickyNote, DisplayInfo, AppSettings, SearchQuery } from '../types';
import { DataStore } from './dataStore';
import { WindowStateManager } from './windowStateManager';
import { SearchService } from './searchService';

/**
 * デバッグログ制御関数
 */
function debugLog(...args: any[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
}

/**
 * IPC送信用のオブジェクトサニタイズ機能（メインプロセス側）
 * レンダラープロセスに送信する前にオブジェクトをクリーンアップ
 */
function sanitizeForIPC(obj: any): any {
  try {
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
    console.warn('[IPC-Main] Object serialization failed, using safe fallback:', error);
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
 * 安全なwebContents.send（サニタイズ付き）
 */
function safeSend(webContents: Electron.WebContents, channel: string, ...args: any[]): void {
  try {
    const sanitizedArgs = args.map(arg => sanitizeForIPC(arg));
    webContents.send(channel, ...sanitizedArgs);
  } catch (error) {
    console.error(`[IPC-Main] Failed to send to ${channel}:`, error);
  }
}

class StickyNotesApp {
  private windows: Map<string, BrowserWindow> = new Map();
  private dataStore: DataStore;
  private windowStateManager: WindowStateManager;
  private tray: Tray | null = null;
  private isQuitting = false;
  private pendingTimers: Map<string, { moveTimeout?: NodeJS.Timeout, resizeTimeout?: NodeJS.Timeout }> = new Map();
  private blurTimeouts: Map<string, NodeJS.Timeout> = new Map();
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
      this.showAllWindowsOnly();
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

    // before-quitイベントを一時的に無効化
    // app.on('before-quit', (event) => {
    //   console.log('[BEFORE-QUIT] Event triggered - isQuitting:', this.isQuitting);
    //   if (!this.isQuitting) {
    //     console.log('[BEFORE-QUIT] Setting isQuitting to true and allowing quit');
    //     this.isQuitting = true;
    //   }
    // });
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
        webSecurity: false, // コンテキストメニューのオーバーライドを有効にする
      },
    });

    win.setMenu(null);
    
    if (process.env.NODE_ENV === 'development') {
      win.loadFile(path.join(__dirname, 'index.html'), { 
        query: { noteId: note.id }
      });
    } else {
      win.loadFile(path.join(__dirname, 'index.html'), { query: { noteId: note.id } });
    }

    win.webContents.once('did-finish-load', () => {
      // レンダラープロセスの初期化を確実にするため一度だけ送信
      safeSend(win.webContents, 'note-data', note);
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

    // デフォルトのコンテキストメニューを完全に無効化
    win.webContents.on('context-menu', (event, params) => {
      console.log('[DEBUG] Context menu event intercepted and prevented');
      event.preventDefault();
      
      // 非アクティブ状態の付箋の場合のみカスタムメニューを表示
      this.dataStore.getNote(note.id).then(currentNote => {
        if (currentNote && !currentNote.isActive) {
          console.log('[DEBUG] Showing context menu for inactive note:', note.id);
          this.showInactiveContextMenu(note.id);
        }
      });
      
      return false;
    });

    // キーボードショートカット（F2キー）でリセット機能を提供
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F2') {
        console.log('[DEBUG] F2 key pressed for note:', note.id);
        
        this.dataStore.getNote(note.id).then(currentNote => {
          if (currentNote && !currentNote.isActive) {
            console.log('[DEBUG] Resetting coordinates for inactive note via F2:', note.id);
            this.resetNoteActiveCoordinates(note.id);
          }
        });
      }
    });

    // タイマー管理用オブジェクトを初期化
    if (!this.pendingTimers.has(note.id)) {
      this.pendingTimers.set(note.id, {});
    }
    
    win.on('moved', async () => {
      const [x, y] = win.getPosition();
      const timers = this.pendingTimers.get(note.id)!;
      
      debugLog(`[DEBUG] Window moved - noteId: ${note.id}, position: ${x},${y}, isNewlyCreated: ${note.isNewlyCreated}`);
      
      // 頻繁な更新をデバウンス
      if (timers.moveTimeout) {
        clearTimeout(timers.moveTimeout);
      }
      
      timers.moveTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (!currentNote) return;
        
        debugLog(`[DEBUG] Processing move update - noteId: ${note.id}, isActive: ${currentNote.isActive}, isNewlyCreated: ${currentNote.isNewlyCreated}`);
        
        // 新規ノートの場合、移動時にサイズを保護
        if (currentNote.isNewlyCreated) {
          const [currentWidth, currentHeight] = win.getSize();
          const settings = await this.dataStore.getSettings();
          
          let expectedWidth: number;
          let expectedHeight: number;
          
          if (currentNote.isActive) {
            expectedWidth = 300; // 編集モード
            expectedHeight = 200;
          } else {
            expectedWidth = settings.defaultInactiveWidth || 120; // 表示モード
            expectedHeight = settings.defaultInactiveHeight || 88;
          }
          
          if (currentWidth !== expectedWidth || currentHeight !== expectedHeight) {
            debugLog(`[DEBUG] Move: correcting size for new note ${note.id} from ${currentWidth}x${currentHeight} to ${expectedWidth}x${expectedHeight}`);
            win.setSize(expectedWidth, expectedHeight);
          }
        }
        
        // 移動先のディスプレイを検出
        const newDisplay = this.findDisplayContainingPoint(x, y);
        const updates: Partial<StickyNote> = {};
        
        // ディスプレイが変更された場合
        if (newDisplay.id.toString() !== currentNote.displayId) {
          updates.displayId = newDisplay.id.toString();
          console.log(`[DEBUG] Display changed for note ${note.id}: ${currentNote.displayId} -> ${newDisplay.id.toString()}`);
        }
        
        // 状態に応じて適切な位置フィールドを更新
        if (currentNote.isActive) {
          updates.activeX = x;
          updates.activeY = y;
          console.log(`[DEBUG] Updating active position for note ${note.id}: ${x},${y}`);
        } else {
          updates.inactiveX = x;
          updates.inactiveY = y;
          console.log(`[DEBUG] Updating inactive position for note ${note.id}: ${x},${y}`);
        }
        
        // 一度に更新
        await this.dataStore.updateNote(note.id, updates);
        console.log(`[DEBUG] Move update completed for note ${note.id}`);
        
        // タイマーをクリア
        delete timers.moveTimeout;
      }, 100); // 100msのデバウンス
    });

    win.on('resized', async () => {
      const [width, height] = win.getSize();
      const timers = this.pendingTimers.get(note.id)!;
      
      console.log(`[DEBUG] Window resized - noteId: ${note.id}, size: ${width}x${height}, isNewlyCreated: ${note.isNewlyCreated}`);
      
      // 頻繁なサイズ変更をデバウンス
      if (timers.resizeTimeout) {
        clearTimeout(timers.resizeTimeout);
      }
      
      timers.resizeTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (currentNote) {
          debugLog(`[DEBUG] Processing resize update - noteId: ${note.id}, isActive: ${currentNote.isActive}, isNewlyCreated: ${currentNote.isNewlyCreated}, size: ${width}x${height}`);
          
          // 新規ノートの場合、意図しないサイズ変更を防ぐ
          if (currentNote.isNewlyCreated) {
            const settings = await this.dataStore.getSettings();
            if (currentNote.isActive) {
              // アクティブモードでは編集サイズを維持
              const expectedWidth = 300;
              const expectedHeight = 200;
              if (width !== expectedWidth || height !== expectedHeight) {
                console.log(`[DEBUG] New note resize prevented - restoring edit size ${expectedWidth}x${expectedHeight} (was ${width}x${height})`);
                
                // 強制的にサイズを修正（複数回実行で確実に適用）
                win.setSize(expectedWidth, expectedHeight);
                return;
              }
            } else {
              // 非アクティブモードでは表示サイズを維持
              const expectedWidth = settings.defaultInactiveWidth || 120;
              const expectedHeight = settings.defaultInactiveHeight || 88;
              if (width !== expectedWidth || height !== expectedHeight) {
                console.log(`[DEBUG] New note resize prevented - restoring display size ${expectedWidth}x${expectedHeight} (was ${width}x${height})`);
                
                // サイズを修正
                win.setSize(expectedWidth, expectedHeight);
                return;
              }
            }
          }
          
          // アクティブ・非アクティブに関係なくサイズを記録
          await this.dataStore.updateNoteSize(note.id, width, height, currentNote.isActive);
          console.log(`[DEBUG] Resize update completed for note ${note.id}`);
        }
        
        // タイマーをクリア
        delete timers.resizeTimeout;
      }, 200); // 200msのデバウンス
    });

    // フォーカス損失時の非アクティブ化処理
    win.on('blur', async () => {
      const currentNote = await this.dataStore.getNote(note.id);
      if (currentNote && currentNote.isActive && !currentNote.isLocked) {
        debugLog(`[DEBUG] Blur event triggered for note ${note.id}`);
        
        // WindowStateManagerを使って重複ブラーイベントを防止
        this.windowStateManager.scheduleBlurEvent(note.id, async () => {
          debugLog(`[DEBUG] Processing blur timeout for note ${note.id}`);
          
          // 検索ウィンドウや設定ウィンドウがフォーカスされていないかチェック
          const searchFocused = this.searchWindow && !this.searchWindow.isDestroyed() && this.searchWindow.isFocused();
          const settingsFocused = this.settingsWindow && !this.settingsWindow.isDestroyed() && this.settingsWindow.isFocused();
          
          // 他の付箋ウィンドウがフォーカスされているかチェック
          let otherNoteFocused = false;
          for (const [otherId, otherWin] of this.windows) {
            if (otherId !== note.id && otherWin.isFocused()) {
              otherNoteFocused = true;
              break;
            }
          }
          
          debugLog(`[DEBUG] Focus check: search=${searchFocused}, settings=${settingsFocused}, otherNote=${otherNoteFocused}`);
          
          // 付箋関連のウィンドウがフォーカスされていない場合
          if (!searchFocused && !settingsFocused && !otherNoteFocused) {
            // 複数アクティブモード：アクティブな付箋の数をチェック
            let activeNoteCount = 0;
            for (const [otherId, otherWin] of this.windows) {
              const otherNote = await this.dataStore.getNote(otherId);
              if (otherNote && otherNote.isActive) {
                activeNoteCount++;
              }
            }
            
            console.log(`[DEBUG] Active note count: ${activeNoteCount}`);
            
            if (activeNoteCount <= 1) {
              // アクティブな付箋が1つ以下の場合は全体を非アクティブ化
              console.log(`[DEBUG] Single or no active notes, deactivating all`);
              await this.deactivateAllNotes(undefined, true);
            } else {
              // 複数のアクティブな付箋がある場合は、ブラーした付箋のみ非アクティブ化
              console.log(`[DEBUG] Multiple active notes, deactivating only blurred note ${note.id}`);
              await this.handleSetNoteActive(note.id, false, true);
            }
          } else {
            console.log(`[DEBUG] Note ${note.id} focus moved to related window, keeping active`);
          }
        }, 80); // 80ms待機に短縮
      }
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

      // blurタイムアウトもクリア
      const blurTimeout = this.blurTimeouts.get(note.id);
      if (blurTimeout) {
        clearTimeout(blurTimeout);
        this.blurTimeouts.delete(note.id);
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
    
    // ディスプレイIDが変わった場合でも、座標が有効な範囲内にあるかチェック
    const x = isActive ? note.activeX : note.inactiveX;
    const y = isActive ? note.activeY : note.inactiveY;
    
    if (typeof x === 'number' && typeof y === 'number') {
      // 座標がどのディスプレイ範囲内にあるかチェック
      const containingDisplay = displays.find(display => {
        const bounds = display.bounds;
        return x >= bounds.x && x < bounds.x + bounds.width &&
               y >= bounds.y && y < bounds.y + bounds.height;
      });
      
      if (containingDisplay) {
        return { display: containingDisplay, shouldMigrate: false };
      }
    }
    
    // ディスプレイもなく座標も無効な場合のみプライマリディスプレイに移動
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
      // 設定からデフォルトサイズを取得
      const settings = await this.dataStore.getSettings();
      width = note.inactiveWidth || settings.defaultInactiveWidth || 150;
      height = note.inactiveHeight || settings.defaultInactiveHeight || 100;
    }

    // 数値型を確実にする
    x = Number(x) || 100;
    y = Number(y) || 100;
    if (note.isActive) {
      width = Number(width) || 300;
      height = Number(height) || 200;
    } else {
      // 非アクティブモードでは、新規作成時は設定値、既存は保持
      // 新規作成かどうかは isNewlyCreated フラグで判定
      if (note.isNewlyCreated) {
        const settings = await this.dataStore.getSettings();
        width = settings.defaultInactiveWidth || 150;
        height = settings.defaultInactiveHeight || 100;
        console.log('[DEBUG] calculateNoteBounds - new note, using settings:', width, 'x', height);
      } else {
        width = note.inactiveWidth;
        height = note.inactiveHeight;
        console.log('[DEBUG] calculateNoteBounds - existing note, using stored size:', width, 'x', height, 'for note:', note.id);
      }
    }

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
    console.log('[DEBUG] Display change detected');
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    console.log('[DEBUG] Current displays:', displays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      primary: d.bounds.x === primaryDisplay.bounds.x && d.bounds.y === primaryDisplay.bounds.y
    })));
    
    // 各ウィンドウの処理を並列実行
    const migrationPromises = Array.from(this.windows.entries()).map(async ([noteId, win]) => {
      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      // 現在の位置を取得
      const [currentX, currentY] = win.getPosition();
      
      // 現在の位置に基づいて適切なディスプレイを探す
      const containingDisplay = displays.find(display => {
        const bounds = display.bounds;
        return currentX >= bounds.x && 
               currentX <= bounds.x + bounds.width &&
               currentY >= bounds.y && 
               currentY <= bounds.y + bounds.height;
      });
      
      if (containingDisplay) {
        // 適切なディスプレイが見つかった場合、ディスプレイIDを更新
        if (note.displayId !== containingDisplay.id.toString()) {
          console.log(`[DEBUG] Updating note ${noteId} display ID from ${note.displayId} to ${containingDisplay.id}`);
          await this.dataStore.updateNote(noteId, {
            displayId: containingDisplay.id.toString()
          });
        }
      } else {
        // どのディスプレイにも含まれていない場合は座標を維持（移動しない）
        console.log(`[DEBUG] Note ${noteId} is outside all displays, but preserving coordinates`);
        console.log(`[DEBUG] Current position: (${currentX}, ${currentY}), preserving for future display reconnection`);
        
        // 座標はそのまま維持し、ディスプレイIDのみ更新
        // （将来的にディスプレイが再接続されたときに元の位置に戻れるように）
        // ディスプレイIDは保存されている位置に最も近いディスプレイを推測して設定
        const savedX = note.isActive ? note.activeX : note.inactiveX;
        const savedY = note.isActive ? note.activeY : note.inactiveY;
        
        let targetDisplay = displays.find(display => {
          const bounds = display.bounds;
          const centerX = bounds.x + bounds.width / 2;
          const centerY = bounds.y + bounds.height / 2;
          const distance = Math.sqrt(Math.pow(savedX - centerX, 2) + Math.pow(savedY - centerY, 2));
          return distance < Math.max(bounds.width, bounds.height);
        });
        
        if (!targetDisplay) {
          targetDisplay = primaryDisplay;
        }
        
        // ディスプレイIDのみ更新（座標は変更しない）
        console.log(`[DEBUG] Updating note ${noteId} display ID to ${targetDisplay.id} (coordinate preservation mode)`);
        await this.dataStore.updateNote(noteId, {
          displayId: targetDisplay.id.toString()
        });
      }
    });

    // すべての移行処理を並列実行
    await Promise.all(migrationPromises);
    console.log('[DEBUG] Display change handling completed');
  }

  private setupIpcHandlers() {
    ipcMain.handle('create-note', async (_, nearNoteId?: string) => {
      try {
        console.log('[DEBUG] Creating new note near:', nearNoteId);
        
        let nearNote: StickyNote | null = null;
        if (nearNoteId) {
          nearNote = await this.dataStore.getNote(nearNoteId);
        }
        
        // デフォルト設定を取得
        const settings = await this.dataStore.getSettings();
        const defaultWidth = settings.defaultInactiveWidth || 150;
        const defaultHeight = settings.defaultInactiveHeight || 100;
        
        // 新しい付箋を作成（非アクティブ状態）
        const newNote = await this.dataStore.createNote(nearNote || undefined);
        
        // 位置計算を効率化
        let finalX = newNote.inactiveX;
        let finalY = newNote.inactiveY;
        let targetDisplayId = newNote.displayId;
        
        if (nearNote && nearNoteId) {
          const parentWindow = this.windows.get(nearNoteId);
          if (parentWindow && !parentWindow.isDestroyed()) {
            try {
              const [parentX, parentY] = parentWindow.getPosition();
              
              // 親付箋と同じディスプレイに配置
              targetDisplayId = nearNote.displayId;
              
              // 簡単なオフセット配置（重複回避）
              finalX = parentX + 20;
              finalY = parentY + 20;
              
              // 親付箋があるディスプレイを取得
              const parentDisplay = screen.getAllDisplays().find(d => d.id.toString() === nearNote.displayId) 
                                   || screen.getDisplayNearestPoint({ x: parentX, y: parentY });
              
              // 画面境界の簡易チェック
              const maxX = parentDisplay.bounds.x + parentDisplay.bounds.width - defaultWidth;
              const maxY = parentDisplay.bounds.y + parentDisplay.bounds.height - defaultHeight;
              
              if (finalX > maxX) finalX = parentDisplay.bounds.x + 50;
              if (finalY > maxY) finalY = parentDisplay.bounds.y + 50;
              
            } catch (error) {
              console.warn('[DEBUG] Failed to get parent window position:', error);
            }
          }
        }
        
        // 位置を一度だけ更新
        await this.dataStore.updateNote(newNote.id, { 
          isActive: false,
          inactiveX: finalX,
          inactiveY: finalY,
          displayId: targetDisplayId
        });
        
        // 最終的な付箋データを取得
        const finalNote = await this.dataStore.getNote(newNote.id);
        if (!finalNote) {
          throw new Error('Failed to retrieve created note');
        }
        
        // ウィンドウを作成
        const newWindow = await this.createNoteWindow(finalNote);
        
        // 親付箋の上に表示
        if (nearNoteId && this.windows.has(nearNoteId)) {
          newWindow.moveTop();
        }
        
        console.log('[DEBUG] New note created successfully:', newNote.id);
        return newNote;
        
      } catch (error) {
        console.error('[ERROR] Failed to create new note:', error);
        throw error;
      }
    });

    ipcMain.handle('update-note', async (_, noteId: string, updates: Partial<StickyNote>) => {
      try {
        await this.dataStore.updateNote(noteId, updates);
        
        // 検索インデックスを更新
        const updatedNote = await this.dataStore.getNote(noteId);
        if (updatedNote) {
          this.searchService.updateNoteInIndex(updatedNote);
        }
        
        return true;
      } catch (error) {
        console.error(`Failed to update note ${noteId}:`, error);
        // 本番環境でも重要なエラーをログ出力
        if (process.env.NODE_ENV === 'production') {
          console.error('PRODUCTION ERROR: Note update failed. Data may not be saved.');
        }
        
        // エラーをレンダラープロセスに返す
        throw new Error(`Failed to update note: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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

      // 複数アクティブ対応：他の付箋を非アクティブ化しない
      // アクティブ化する場合でも、他の付箋はそのままにする（マルチアクティブ対応）
      console.log(`[DEBUG] set-note-active: Multi-active mode - not deactivating other notes`);

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
        
        // 新規ノートの場合、サイズは適度なデフォルト値を使用（移動中の一時的な拡大を防ぐ）
        if (note.isNewlyCreated) {
          // 新規ノートの編集モードでは適度なサイズを保存
          updates.activeWidth = 300;
          updates.activeHeight = 200;
          console.log(`[DEBUG] Saving active state (new note, default size): ${currentX},${currentY} size:300x200 for note:${noteId}`);
          // フラグクリアは calculateNoteBounds 実行後に延期
        } else {
          // 既存ノートは現在のサイズを保存
          updates.activeWidth = currentWidth;
          updates.activeHeight = currentHeight;
          console.log(`[DEBUG] Saving active state (existing note): ${currentX},${currentY} size:${currentWidth}x${currentHeight} for note:${noteId}`);
        }
      } else if (!note.isActive && isActive) {
        // 非アクティブ→アクティブ: 非アクティブ状態の位置とサイズを保存
        updates.inactiveX = currentX;
        updates.inactiveY = currentY;
        
        // 新規作成ノートの場合は設定のサイズを使用、既存ノートは現在のサイズを保存
        if (note.isNewlyCreated) {
          const settings = await this.dataStore.getSettings();
          updates.inactiveWidth = settings.defaultInactiveWidth || 120;
          updates.inactiveHeight = settings.defaultInactiveHeight || 88;
          console.log(`[DEBUG] Saving inactive state (new note): ${currentX},${currentY} size:${updates.inactiveWidth}x${updates.inactiveHeight} for note:${noteId}`);
          // 新規ノートのisNewlyCreatedフラグはアクティブ化時にはクリアしない（移動完了後の非アクティブ化まで保持）
        } else {
          updates.inactiveWidth = currentWidth;
          updates.inactiveHeight = currentHeight;
          console.log(`[DEBUG] Saving inactive state (existing note): ${currentX},${currentY} size:${currentWidth}x${currentHeight} for note:${noteId}`);
        }
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
        
        // 初回アクティブ化時の処理（新規ノートの場合は編集モードサイズを使用）
        if (isActive && updatedNote.isNewlyCreated) {
          // 新規ノートの初回アクティブ化では編集モードサイズを使用
          const editWidth = 300;
          const editHeight = 200;
          
          await this.dataStore.updateNote(noteId, {
            activeX: currentX,
            activeY: currentY,
            activeWidth: editWidth,
            activeHeight: editHeight
          });
          
          console.log(`[DEBUG] New note first activation: using edit mode size ${editWidth}x${editHeight}`);
          
          // 編集モードサイズでウィンドウサイズを設定
          win.setBounds({
            x: Math.round(currentX),
            y: Math.round(currentY),
            width: Math.round(editWidth),
            height: Math.round(editHeight)
          });
        } else {
          // 通常の状態変更時は計算された位置とサイズを適用
          console.log(`[DEBUG] Setting bounds for note ${noteId}: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
          win.setBounds({
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
          });
        }
        
        // アクティブ状態に応じてリサイズ可能性を設定
        win.setResizable(isActive);
        
        if (isActive) {
          win.focus();
        }
        
        // 状態変更完了を通知
        this.windowStateManager.completeStateChange(noteId, isActive);
        
        // 非アクティブ化完了後にフラグクリア
        if (!isActive && note.isNewlyCreated) {
          await this.dataStore.updateNote(noteId, { isNewlyCreated: false });
          console.log(`[DEBUG] Clearing isNewlyCreated flag after deactivation for note:${noteId}`);
        }
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

    // URLを含むコンテキストメニュー（新機能）
    ipcMain.handle('show-context-menu-with-url', (event, url: string | null) => {
      const menuTemplate: Electron.MenuItemConstructorOptions[] = [];
      
      // URLが検出された場合、URLを開くオプションを追加
      if (url) {
        menuTemplate.push(
          {
            label: `URLを開く: ${url.length > 30 ? url.substring(0, 27) + '...' : url}`,
            click: async () => {
              try {
                await shell.openExternal(url);
              } catch (error) {
                console.error('Failed to open URL:', error);
              }
            }
          },
          { type: 'separator' }
        );
      }
      
      // 標準的なテキスト編集オプション
      menuTemplate.push(
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
      );
      
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        contextMenu.popup({ window: win });
      }
    });

    // 非アクティブ付箋のヘッダー用コンテキストメニュー
    ipcMain.handle('show-inactive-header-context-menu', (event, noteId: string) => {
      console.log(`[DEBUG] show-inactive-header-context-menu IPC handler called for note: ${noteId}`);
      
      const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'アクティブ時の座標・サイズを初期化',
          click: async () => {
            console.log(`[DEBUG] Context menu item clicked for note: ${noteId}`);
            try {
              const note = await this.dataStore.getNote(noteId);
              if (!note) {
                console.error(`[ERROR] Note not found: ${noteId}`);
                return;
              }

              // アクティブ座標を現在の非アクティブ座標に設定
              const activeWidth = 400;  // デフォルトのアクティブ幅
              const activeHeight = 300; // デフォルトのアクティブ高さ

              await this.dataStore.updateNote(noteId, {
                activeX: note.inactiveX,
                activeY: note.inactiveY,
                activeWidth: activeWidth,
                activeHeight: activeHeight
              });

              console.log(`[DEBUG] Active coordinates reset for note: ${noteId}`);
            } catch (error) {
              console.error('Failed to reset active coordinates:', error);
            }
          }
        }
      ];
      
      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        console.log(`[DEBUG] Showing context menu for note: ${noteId}`);
        contextMenu.popup({ window: win });
      } else {
        console.error(`[DEBUG] Failed to find window for context menu`);
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
      console.log('[DEBUG] get-settings IPC handler - settings from dataStore:', settings);
      const result = {
        showAllHotkey: settings.showAllHotkey || '',
        hideAllHotkey: settings.hideAllHotkey || '',
        searchHotkey: settings.searchHotkey || '',
        pinHotkey: settings.pinHotkey || '',
        lockHotkey: settings.lockHotkey || '',
        newNoteHotkey: settings.newNoteHotkey || '',
        headerIconSize: settings.headerIconSize || 16,
        defaultInactiveWidth: settings.defaultInactiveWidth || 150,
        defaultInactiveHeight: settings.defaultInactiveHeight || 125,
        defaultInactiveFontSize: settings.defaultInactiveFontSize || 12,
        autoStart: autoStartStatus
      };
      console.log('[DEBUG] get-settings IPC handler - returning:', result);
      return result;
    });

    ipcMain.handle('save-settings', async (_, settingsData) => {
      try {
        console.log('[DEBUG] save-settings called with:', settingsData);
        
        // 現在のホットキーを解除
        this.unregisterAllHotkeys();
        
        // 自動開始設定を適用
        if (settingsData.autoStart !== undefined) {
          await this.setAutoStart(settingsData.autoStart);
        }
        
        // 設定を保存
        await this.dataStore.updateSettings(settingsData);
        console.log('[DEBUG] Settings saved successfully');
        
        // 新しいホットキーを登録
        const registrationResult = await this.registerHotkeys(settingsData);
        
        if (registrationResult && registrationResult.length > 0) {
          // ホットキー登録エラーがある場合
          console.log('[DEBUG] Hotkey registration errors:', registrationResult);
          return { 
            success: false, 
            error: registrationResult.join('\n') 
          };
        }
        
        // 既存の全ての付箋ウィンドウに設定変更を通知
        console.log('[DEBUG] Notifying settings change');
        this.notifySettingsChange();
        
        console.log('[DEBUG] save-settings completed successfully');
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
        console.log('[DEBUG] search-notes IPC called with query:', JSON.stringify(query));
        const notes = await this.dataStore.getAllNotes();
        console.log('[DEBUG] Found notes count:', notes.length);
        const results = this.searchService.search(query, notes);
        console.log('[DEBUG] Search results count:', results.length);
        console.log('[DEBUG] First few results:', results.slice(0, 3).map(r => ({
          noteId: r.note.id,
          relevance: r.relevance,
          matchCount: r.matchCount,
          previewText: r.note.content ? (typeof r.note.content === 'string' ? r.note.content.substring(0, 50) : 'RichContent') : 'No content'
        })));
        return results;
      } catch (error) {
        console.error('Error searching notes:', error);
        return [];
      }
    });

    ipcMain.handle('open-note-by-id', async (_, noteId: string) => {
      try {
        console.log(`[DEBUG] open-note-by-id called for ${noteId}`);
        
        const window = this.windows.get(noteId);
        if (!window) {
          console.log(`[DEBUG] Window not found for note ${noteId}`);
          return false;
        }

        // 付箋データを取得
        const note = await this.dataStore.getNote(noteId);
        if (!note) {
          console.log(`[DEBUG] Note data not found for ${noteId}`);
          return false;
        }
        
        // 現在の状態を確認
        const wasActive = note.isActive;
        console.log(`[DEBUG] Note ${noteId} current state: isActive=${wasActive}`);
        
        // 複数アクティブ対応：他の付箋を非アクティブ化しない
        console.log(`[DEBUG] Multi-active mode: skipping deactivation of other notes for ${noteId}`);
        
        if (wasActive) {
          // 既にアクティブな場合は、そのまま表示・フォーカス
          window.show();
          window.focus();
          
          // 検索ウィンドウを閉じる（既にアクティブでも必要）
          if (this.searchWindow && !this.searchWindow.isDestroyed()) {
            this.searchWindow.close();
          }
          
          // 既にアクティブでもテキストエディタへのフォーカス処理を実行
          window.webContents.send('set-active', true);
          
          console.log(`[DEBUG] Note ${noteId} was already active, just showing and focusing`);
          return true;
        }
        
        // 非アクティブからアクティブに切り替える場合
        
        // 1. 現在の非アクティブ位置を保存
        const [currentX, currentY] = window.getPosition();
        const [currentWidth, currentHeight] = window.getSize();
        
        // 2. 非アクティブ座標を更新（現在位置を記録）
        await this.dataStore.updateNote(noteId, {
          inactiveX: currentX,
          inactiveY: currentY,
          inactiveWidth: currentWidth,
          inactiveHeight: currentHeight
        });
        
        // 3. アクティブモードに切り替え
        await this.dataStore.updateNote(noteId, { isActive: true });
        
        // 4. 保存されているアクティブ座標とサイズを使用
        let targetX = note.activeX;
        let targetY = note.activeY;
        let targetWidth = note.activeWidth || 250;  // デフォルト値
        let targetHeight = note.activeHeight || 200; // デフォルト値
        
        // アクティブ座標が無効な場合は現在位置を使用（初回など）
        if (typeof targetX !== 'number' || typeof targetY !== 'number') {
          targetX = currentX;
          targetY = currentY;
          // この場合のみアクティブ座標を更新
          await this.dataStore.updateNote(noteId, {
            activeX: targetX,
            activeY: targetY,
            activeWidth: targetWidth,
            activeHeight: targetHeight
          });
        }
        
        // 5. ウィンドウをアクティブモードの位置・サイズに設定
        window.setBounds({
          x: Math.round(targetX),
          y: Math.round(targetY),
          width: Math.round(targetWidth),
          height: Math.round(targetHeight)
        });
        
        // 6. ウィンドウを表示・フォーカス・リサイズ可能にする
        window.show();
        window.setResizable(true);
        window.setAlwaysOnTop(true, 'screen-saver', 1);
        
        // 検索ウィンドウを閉じてからフォーカスを設定
        if (this.searchWindow && !this.searchWindow.isDestroyed()) {
          this.searchWindow.close();
        }
        
        // WindowStateManagerに状態変更完了を通知（ブラーイベントが即座に発生しないように）
        this.windowStateManager.completeStateChange(noteId, true);
        
        // 少し遅延してからフォーカスを設定（検索選択時のブラーイベント回避）
        setTimeout(() => {
          if (!window.isDestroyed()) {
            window.focus();
            console.log(`[DEBUG] Note ${noteId} focused after search selection`);
          }
        }, 120); // 120msに延長してブラーイベントを回避
        
        // 7. ウィンドウに更新された状態を通知
        const updatedNote = await this.dataStore.getNote(noteId);
        if (updatedNote) {
          safeSend(window.webContents, 'note-data', updatedNote);
          safeSend(window.webContents, 'set-active', true);
        }
        
        console.log(`[DEBUG] Note ${noteId} activated: inactive(${currentX},${currentY}) -> active(${targetX},${targetY})`);
        return true;
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

    ipcMain.handle('export-notes-to-txt', async () => {
      console.log('[DEBUG] export-notes-to-txt IPC handler called');
      try {
        // 現在の日付を取得（YYYY-MM-DD形式）
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        console.log('[DEBUG] Export date string:', dateStr);
        
        // エクスポートフォルダのパスを作成
        const downloadsPath = path.join(os.homedir(), 'Downloads');
        const exportFolderPath = path.join(downloadsPath, dateStr);
        console.log('[DEBUG] Export folder path:', exportFolderPath);
        
        // フォルダが存在しない場合は作成
        if (!fs.existsSync(exportFolderPath)) {
          console.log('[DEBUG] Creating export folder');
          fs.mkdirSync(exportFolderPath, { recursive: true });
        } else {
          console.log('[DEBUG] Export folder already exists');
        }
        
        // すべての付箋を取得
        console.log('[DEBUG] Getting all notes from dataStore');
        const notes = await this.dataStore.getAllNotes();
        console.log('[DEBUG] Retrieved notes count:', notes.length);
        
        if (notes.length === 0) {
          console.log('[DEBUG] No notes to export');
          return {
            success: false,
            error: 'エクスポートする付箋がありません。'
          };
        }
        
        // 各付箋を個別のテキストファイルとして保存
        for (const note of notes) {
          try {
            console.log('[DEBUG] Exporting note:', note.id);
            
            // 作成日時を取得してフォーマット
            const createdAt = new Date(note.createdAt);
            const createdStr = createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            
            // ファイル名を作成（付箋_[作成日時]_[付箋ID].txt）
            const fileName = `付箋_${createdStr}_${note.id}.txt`;
            const filePath = path.join(exportFolderPath, fileName);
            console.log('[DEBUG] Exporting to file:', filePath);
            
            // 付箋の内容を取得
            let content = '';
            
            if (note.content) {
              // リッチコンテンツの場合はテキスト部分のみを抽出
              if (typeof note.content === 'string') {
                // プレーンテキストの場合
                content = note.content;
              } else {
                // リッチコンテンツの場合（HTMLやJSON形式）
                content = this.extractTextFromRichContent(note.content);
              }
            }
            
            // 空の場合はプレースホルダーを設定
            if (!content.trim()) {
              content = '（空の付箋）';
            }
            
            console.log('[DEBUG] Note content length:', content.length);
            
            // ファイルに書き込み
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('[DEBUG] Successfully exported note:', note.id);
            
          } catch (error) {
            console.error(`[ERROR] Error exporting note ${note.id}:`, error);
            // 個別のファイルでエラーが発生しても続行
          }
        }
        
        console.log('[DEBUG] Export completed successfully');
        return {
          success: true,
          path: exportFolderPath
        };
        
      } catch (error) {
        console.error('[ERROR] Error exporting notes:', error);
        if (error instanceof Error) {
          console.error('[ERROR] Error name:', error.name);
          console.error('[ERROR] Error message:', error.message);
          console.error('[ERROR] Error stack:', error.stack);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : '不明なエラーが発生しました。'
        };
      }
    });

    ipcMain.handle('select-folder-and-export-notes', async () => {
      console.log('[DEBUG] select-folder-and-export-notes IPC handler called');
      try {
        // フォルダ選択ダイアログを表示
        const result = await dialog.showOpenDialog({
          title: 'エクスポート先フォルダを選択',
          properties: ['openDirectory'],
          defaultPath: path.join(os.homedir(), 'Downloads')
        });
        
        // ユーザーがキャンセルした場合
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
          console.log('[DEBUG] User canceled folder selection');
          return {
            success: false,
            error: 'ユーザーによってキャンセルされました'
          };
        }
        
        const selectedFolder = result.filePaths[0];
        console.log('[DEBUG] Selected folder:', selectedFolder);
        
        // 現在の日付を取得（YYYY-MM-DD形式）
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        console.log('[DEBUG] Export date string:', dateStr);
        
        // 選択されたフォルダ内に日付フォルダを作成
        const exportFolderPath = path.join(selectedFolder, dateStr);
        console.log('[DEBUG] Export folder path:', exportFolderPath);
        
        // フォルダが存在しない場合は作成
        if (!fs.existsSync(exportFolderPath)) {
          console.log('[DEBUG] Creating export folder');
          fs.mkdirSync(exportFolderPath, { recursive: true });
        } else {
          console.log('[DEBUG] Export folder already exists');
        }
        
        // すべての付箋を取得
        console.log('[DEBUG] Getting all notes from dataStore');
        const notes = await this.dataStore.getAllNotes();
        console.log('[DEBUG] Retrieved notes count:', notes.length);
        
        if (notes.length === 0) {
          console.log('[DEBUG] No notes to export');
          return {
            success: false,
            error: 'エクスポートする付箋がありません。'
          };
        }
        
        // 各付箋を個別のテキストファイルとして保存
        for (const note of notes) {
          try {
            console.log('[DEBUG] Exporting note:', note.id);
            
            // 作成日時を取得してフォーマット
            const createdAt = new Date(note.createdAt);
            const createdStr = createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            
            // ファイル名を作成（付箋_[作成日時]_[付箋ID].txt）
            const fileName = `付箋_${createdStr}_${note.id}.txt`;
            const filePath = path.join(exportFolderPath, fileName);
            console.log('[DEBUG] Exporting to file:', filePath);
            
            // 付箋の内容を取得
            let content = '';
            
            if (note.content) {
              // リッチコンテンツの場合はテキスト部分のみを抽出
              if (typeof note.content === 'string') {
                // プレーンテキストの場合
                content = note.content;
              } else {
                // リッチコンテンツの場合（HTMLやJSON形式）
                content = this.extractTextFromRichContent(note.content);
              }
            }
            
            // 空の場合はプレースホルダーを設定
            if (!content.trim()) {
              content = '（空の付箋）';
            }
            
            console.log('[DEBUG] Note content length:', content.length);
            
            // ファイルに書き込み
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('[DEBUG] Successfully exported note:', note.id);
            
          } catch (error) {
            console.error(`[ERROR] Error exporting note ${note.id}:`, error);
            // 個別のファイルでエラーが発生しても続行
          }
        }
        
        console.log('[DEBUG] Export completed successfully');
        return {
          success: true,
          path: exportFolderPath
        };
        
      } catch (error) {
        console.error('[ERROR] Error in select-folder-and-export-notes:', error);
        if (error instanceof Error) {
          console.error('[ERROR] Error name:', error.name);
          console.error('[ERROR] Error message:', error.message);
          console.error('[ERROR] Error stack:', error.stack);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : '不明なエラーが発生しました。'
        };
      }
    });

    // URLをブラウザで開くIPCハンドラー
    ipcMain.handle('open-url-in-browser', async (_, url: string) => {
      try {
        console.log('[DEBUG] open-url-in-browser called with URL:', url);
        
        // URLバリデーション: https://またはhttp://で始まるURLのみ許可
        if (!url || typeof url !== 'string') {
          console.error('[ERROR] Invalid URL provided:', url);
          return false;
        }
        
        // URLの先頭と末尾の空白を削除
        const trimmedUrl = url.trim();
        
        // プロトコルのチェック（厳密なバリデーション）
        const urlPattern = /^https?:\/\/.+/i;
        if (!urlPattern.test(trimmedUrl)) {
          console.error('[ERROR] URL must start with http:// or https://:', trimmedUrl);
          return false;
        }
        
        // 追加のセキュリティチェック: 不正なスキーム防止
        const urlObj = new URL(trimmedUrl);
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
          console.error('[ERROR] Only HTTP and HTTPS protocols are allowed:', urlObj.protocol);
          return false;
        }
        
        // ホスト名の存在チェック
        if (!urlObj.hostname) {
          console.error('[ERROR] URL must have a valid hostname:', trimmedUrl);
          return false;
        }
        
        // shellモジュールを使用してURLをデフォルトブラウザで開く
        await shell.openExternal(trimmedUrl);
        console.log('[DEBUG] Successfully opened URL in browser:', trimmedUrl);
        
        return true;
      } catch (error) {
        console.error('[ERROR] Failed to open URL in browser:', error);
        if (error instanceof Error) {
          console.error('[ERROR] Error details:', error.message);
        }
        return false;
      }
    });

    // すべての付箋を整列させるIPCハンドラー
    ipcMain.handle('arrange-all-notes', async () => {
      try {
        console.log('[DEBUG] arrange-all-notes IPC handler called');
        await this.arrangeAllNotesInGrid();
        console.log(`[DEBUG] arrange-all-notes completed: notes arranged in grid`);
        return { success: true, movedCount: 0 }; // movedCountは今回は使わないが互換性のため残す
      } catch (error) {
        console.error('[ERROR] Failed to arrange all notes:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // アクティブ座標を初期化するIPCハンドラー
    ipcMain.handle('reset-active-coordinates', async (_, noteId: string) => {
      try {
        console.log(`[DEBUG] reset-active-coordinates IPC handler called for note: ${noteId}`);
        
        const note = await this.dataStore.getNote(noteId);
        if (!note) {
          console.error(`[ERROR] Note not found: ${noteId}`);
          return { success: false, error: '付箋が見つかりませんでした' };
        }

        // アクティブ座標を現在の非アクティブ座標に設定
        const activeWidth = 400;  // デフォルトのアクティブ幅
        const activeHeight = 300; // デフォルトのアクティブ高さ

        await this.dataStore.updateNote(noteId, {
          activeX: note.inactiveX,
          activeY: note.inactiveY,
          activeWidth: activeWidth,
          activeHeight: activeHeight
        });

        console.log(`[DEBUG] reset-active-coordinates completed for note: ${noteId}`);
        return { success: true };
      } catch (error) {
        console.error('[ERROR] Failed to reset active coordinates:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
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
        // 単純にすべてのウィンドウを表示（整列はしない）
        this.windows.forEach(win => {
          win.show();
        });
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
        label: 'すべての付箋を隠す',
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
        click: async () => {
          console.log('[TRAY] Exit menu clicked');
          await this.quitApp();
        }
      },
      {
        label: '強制終了 (デバッグ)',
        click: () => {
          console.log('[TRAY] Force quit clicked');
          process.exit(0);
        }
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

  private showAllWindowsOnly() {
    // 単純にすべてのウィンドウを表示（整列はしない）
    this.windows.forEach(win => {
      win.show();
    });
  }

  private async showAllWindows() {
    console.log('[DEBUG] showAllWindows: Starting arrangement');
    
    // まず簡単にすべてのウィンドウを表示
    this.windows.forEach((win, noteId) => {
      console.log(`[DEBUG] showAllWindows: Showing window for note ${noteId}`);
      win.show();
    });

    // その後、整列処理を実行
    await this.arrangeAllNotesInGrid();
  }

  private hideAllWindows() {
    this.windows.forEach(win => {
      win.hide();
    });
  }

  private async arrangeAllNotesInGrid() {
    console.log('[DEBUG] arrangeAllNotesInGrid: Starting grid arrangement');
    
    try {
      // 全ての付箋を取得
      const allNotes = await this.dataStore.getAllNotes();
      console.log(`[DEBUG] arrangeAllNotesInGrid: Found ${allNotes.length} notes`);
      
      if (allNotes.length === 0) {
        console.log('[DEBUG] arrangeAllNotesInGrid: No notes to arrange');
        return;
      }

      // まず全ての付箋を非アクティブ化
      console.log('[DEBUG] arrangeAllNotesInGrid: Deactivating all notes');
      for (const note of allNotes) {
        if (note.isActive || note.isLocked || note.isPinned) {
          console.log(`[DEBUG] arrangeAllNotesInGrid: Updating note ${note.id} - active:${note.isActive}, locked:${note.isLocked}, pinned:${note.isPinned}`);
          
          await this.dataStore.updateNote(note.id, {
            isActive: false,
            isLocked: false,
            isPinned: false
          });
          
          // ウィンドウに状態変更を通知
          const win = this.windows.get(note.id);
          if (win) {
            win.webContents.send('set-active', false);
            win.webContents.send('set-locked', false);
            win.webContents.send('set-pinned', false);
            console.log(`[DEBUG] arrangeAllNotesInGrid: Sent deactivation signals to note ${note.id}`);
          }
        }
      }

      // 設定を取得
      const settings = await this.dataStore.getSettings();
      
      // プライマリディスプレイの情報を取得
      const primaryDisplay = screen.getPrimaryDisplay();
      const { workArea } = primaryDisplay;
      console.log(`[DEBUG] arrangeAllNotesInGrid: Work area - x:${workArea.x}, y:${workArea.y}, width:${workArea.width}, height:${workArea.height}`);
      
      // 非アクティブ状態のサイズを設定から取得
      const noteWidth = settings.defaultInactiveWidth || 120;
      const noteHeight = settings.defaultInactiveHeight || 89;
      console.log(`[DEBUG] arrangeAllNotesInGrid: Note size - width:${noteWidth}, height:${noteHeight}`);
      
      // グリッドの計算
      const padding = 20; // 付箋間の間隔を大きくしてテスト
      const cols = Math.floor((workArea.width - padding) / (noteWidth + padding));
      const rows = Math.ceil(allNotes.length / cols);
      
      // グリッドの開始位置（左上から配置してテスト）
      const startX = workArea.x + padding;
      const startY = workArea.y + padding;
      
      console.log(`[DEBUG] arrangeAllNotesInGrid: Grid layout ${cols}x${rows}, start position (${startX}, ${startY})`);
      
      // 付箋をグリッドに配置
      for (let i = 0; i < allNotes.length; i++) {
        const note = allNotes[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        const x = startX + col * (noteWidth + padding);
        const y = startY + row * (noteHeight + padding);
        
        console.log(`[DEBUG] arrangeAllNotesInGrid: Positioning note ${note.id} at (${x}, ${y}) - col:${col}, row:${row}`);
        
        // アクティブサイズのデフォルト値を設定
        const activeWidth = 400;
        const activeHeight = 300;
        
        // 位置を更新（非アクティブとアクティブ両方の座標を同じ位置に設定）
        await this.dataStore.updateNote(note.id, {
          // 非アクティブ座標
          inactiveX: x,
          inactiveY: y,
          inactiveWidth: noteWidth,
          inactiveHeight: noteHeight,
          // アクティブ座標も同じ位置に設定（回収不能な付箋の救済のため）
          activeX: x,
          activeY: y,
          activeWidth: activeWidth,
          activeHeight: activeHeight,
          displayId: primaryDisplay.id.toString()
        });
        
        // ウィンドウの位置とサイズを更新
        const win = this.windows.get(note.id);
        if (win) {
          console.log(`[DEBUG] arrangeAllNotesInGrid: Setting window bounds for note ${note.id}`);
          win.setBounds({
            x: x,
            y: y,
            width: noteWidth,
            height: noteHeight
          });
          win.show();
          console.log(`[DEBUG] arrangeAllNotesInGrid: Note ${note.id} positioned and shown`);
        } else {
          console.log(`[DEBUG] arrangeAllNotesInGrid: Window not found for note ${note.id}`);
        }
      }
      
      console.log('[DEBUG] arrangeAllNotesInGrid: Grid arrangement completed');
      
    } catch (error) {
      console.error('[ERROR] arrangeAllNotesInGrid: Failed to arrange notes:', error);
    }
  }





  private async quitApp() {
    console.log('[QUIT] quitApp() called - isQuitting:', this.isQuitting);
    
    if (this.isQuitting) {
      console.log('[QUIT] Already quitting, using process.exit()');
      process.exit(0);
      return;
    }
    
    console.log('[QUIT] Setting isQuitting and forcing quit');
    this.isQuitting = true;
    
    // すべてのウィンドウを強制的に閉じる
    try {
      console.log('[QUIT] Closing all windows...');
      BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.destroy();
        }
      });
      
      console.log('[QUIT] Unregistering hotkeys...');
      this.unregisterAllHotkeys();
    } catch (error) {
      console.log('[QUIT] Error during cleanup:', error);
    }
    
    console.log('[QUIT] Using process.exit() for reliable termination');
    // app.quit()の代わりにprocess.exit()を使用
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }

  private async performGracefulShutdown(): Promise<void> {
    console.log('[SHUTDOWN] Starting graceful shutdown...');
    
    try {
      // 1. 自動保存中のタイマーをすべて強制フラッシュ
      await this.flushAllPendingData();
      
      // 2. データストアの保存を強制実行
      await this.dataStore.forceFlushAll();
      
      // 3. すべてのレンダラープロセスに緊急保存を指示
      for (const [noteId, window] of this.windows) {
        if (!window.isDestroyed()) {
          window.webContents.send('emergency-save-request');
        }
      }
      
      // 4. レンダラープロセスの保存完了を短時間待機
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 5. ホットキーをクリーンアップ
      this.unregisterAllHotkeys();
      
      console.log('[SHUTDOWN] Graceful shutdown completed');
    } catch (error) {
      console.error('[SHUTDOWN] Error during graceful shutdown:', error);
      throw error;
    }
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
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] registerHotkeys - settings:', settings);
        console.log('[DEBUG] registerHotkeys - newNoteHotkey:', settings.newNoteHotkey);
      }
      
      // 重複チェック
      const hotkeys = [
        settings.showAllHotkey?.trim(),
        settings.hideAllHotkey?.trim(),
        settings.searchHotkey?.trim(),
        settings.newNoteHotkey?.trim()
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
              console.log(`[DEBUG] Show all hotkey pressed: ${hotkey}. Settings window open: ${this.isSettingsWindowOpen}`);
            }
            if (!this.isSettingsWindowOpen) {
              console.log(`[DEBUG] Executing showAllWindowsOnly function`);
              this.showAllWindowsOnly();
            } else {
              console.log(`[DEBUG] Skipping showAllWindowsOnly - settings window is open`);
            }
          });
          
          if (success) {
            this.registeredHotkeys.add(hotkey);
            console.log(`[DEBUG] Successfully registered show all hotkey: ${hotkey}`);
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

      // 新しい付箋を追加するホットキー
      if (settings.newNoteHotkey && settings.newNoteHotkey.trim()) {
        const hotkey = settings.newNoteHotkey.trim();
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DEBUG] Registering new note hotkey: "${hotkey}"`);
        }
        
        // 既に登録されているかチェック
        if (globalShortcut.isRegistered(hotkey)) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`New note hotkey already registered by another application: ${hotkey}`);
          }
          registrationErrors.push(`新規付箋ホットキー "${hotkey}" は他のアプリケーションによって使用されています。別のキーを選択してください。`);
        } else {
          const success = globalShortcut.register(hotkey, () => {
            if (process.env.NODE_ENV === 'development') {
              console.log(`New note hotkey pressed. Settings window open: ${this.isSettingsWindowOpen}`);
            }
            if (!this.isSettingsWindowOpen) {
              this.createNewNoteFromTray();
            }
          });
          
          if (success) {
            this.registeredHotkeys.add(hotkey);
            if (process.env.NODE_ENV === 'development') {
              console.log(`New note hotkey registered successfully: ${hotkey}`);
            }
          } else {
            console.error(`Failed to register new note hotkey: ${hotkey}`);
            registrationErrors.push(`新規付箋ホットキー "${hotkey}" の登録に失敗しました`);
          }
        }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DEBUG] No new note hotkey configured (value: "${settings.newNoteHotkey}")`);
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

  /**
   * 非アクティブな付箋のコンテキストメニューを表示
   */
  private async showInactiveContextMenu(noteId: string): Promise<void> {
    console.log(`[DEBUG] Showing context menu for note: ${noteId}`);
    
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: '編集モード時の座標・サイズを初期化',
        click: async () => {
          console.log(`[DEBUG] Context menu item clicked for note: ${noteId}`);
          try {
            const note = await this.dataStore.getNote(noteId);
            if (!note) {
              console.error(`[ERROR] Note not found: ${noteId}`);
              return;
            }

            // アクティブ座標を現在の非アクティブ座標に設定
            const activeWidth = 400;  // デフォルトのアクティブ幅
            const activeHeight = 300; // デフォルトのアクティブ高さ

            await this.dataStore.updateNote(noteId, {
              activeX: note.inactiveX,
              activeY: note.inactiveY,
              activeWidth: activeWidth,
              activeHeight: activeHeight
            });

            console.log(`[DEBUG] Active coordinates reset for note: ${noteId}`);
          } catch (error) {
            console.error('Failed to reset active coordinates:', error);
          }
        }
      }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup();
  }

  /**
   * ノートのアクティブ座標をリセット
   */
  private async resetNoteActiveCoordinates(noteId: string): Promise<void> {
    console.log(`[DEBUG] Resetting active coordinates for note: ${noteId}`);
    
    try {
      const note = await this.dataStore.getNote(noteId);
      if (!note) {
        console.error(`[ERROR] Note not found: ${noteId}`);
        return;
      }

      // アクティブ座標を現在の非アクティブ座標に設定
      const activeWidth = 400;  // デフォルトのアクティブ幅
      const activeHeight = 300; // デフォルトのアクティブ高さ

      await this.dataStore.updateNote(noteId, {
        activeX: note.inactiveX,
        activeY: note.inactiveY,
        activeWidth: activeWidth,
        activeHeight: activeHeight
      });

      console.log(`[DEBUG] Active coordinates reset for note: ${noteId}`);
    } catch (error) {
      console.error('Failed to reset active coordinates:', error);
    }
  }

  /**
   * すべてのアクティブな付箋を非アクティブ化（順次実行）
   * ピン留めされた付箋は除外する
   */
  private async deactivateAllNotes(excludeNoteId?: string, isFromBlurEvent: boolean = false): Promise<void> {
    console.log(`[DEBUG] deactivateAllNotes called, excluding: ${excludeNoteId || 'none'}`);
    
    for (const [noteId, window] of this.windows) {
      if (excludeNoteId && noteId === excludeNoteId) {
        continue; // 除外対象はスキップ
      }
      
      try {
        const note = await this.dataStore.getNote(noteId);
        if (note && note.isActive) {
          // ピン留めされた付箋はアクティブ状態を維持（複数アクティブ対応）
          if (note.isPinned) {
            console.log(`[DEBUG] Skipping pinned note ${noteId} - maintaining active state for multi-active mode`);
            continue;
          }
          
          console.log(`[DEBUG] Deactivating unpinned note ${noteId}`);
          // ピン留めされていない付箋のみ非アクティブ化
          await this.handleSetNoteActive(noteId, false, isFromBlurEvent);
        }
      } catch (error) {
        console.error(`[ERROR] Error checking note ${noteId} for deactivation:`, error);
      }
    }
    
    console.log(`[DEBUG] deactivateAllNotes completed - pinned notes remain active`);
  }

  private async handleSetNoteActive(noteId: string, isActive: boolean, isBlurEvent: boolean = false) {
    console.log(`[DEBUG] handleSetNoteActive called: noteId=${noteId}, isActive=${isActive}, isBlurEvent=${isBlurEvent}`);
    
    const win = this.windows.get(noteId);
    if (!win) {
      console.log(`[DEBUG] handleSetNoteActive: window not found for ${noteId}`);
      return;
    }

    const note = await this.dataStore.getNote(noteId);
    if (!note) {
      console.log(`[DEBUG] handleSetNoteActive: note not found for ${noteId}`);
      return;
    }

    console.log(`[DEBUG] handleSetNoteActive: current note.isActive=${note.isActive}, requested=${isActive}`);

    // 状態変更が許可されているかチェック（blur イベントの場合は専用メソッドを使用）
    const stateChangeAllowed = isBlurEvent 
      ? this.windowStateManager.requestBlurStateChange(noteId, isActive)
      : this.windowStateManager.requestStateChange(noteId, isActive);
    
    if (!stateChangeAllowed) {
      console.log(`[DEBUG] handleSetNoteActive: state change not allowed by windowStateManager for ${noteId}`);
      return;
    }

    // 現在の状態と同じ場合は何もしない（ただし blur イベントの場合は処理を続行）
    if (note.isActive === isActive && !isBlurEvent) {
      console.log(`[DEBUG] handleSetNoteActive: state already ${isActive} for ${noteId}, skipping`);
      this.windowStateManager.completeStateChange(noteId, isActive);
      return;
    }

    console.log(`[DEBUG] handleSetNoteActive: proceeding with state change for ${noteId} from ${note.isActive} to ${isActive}`);

    // 状態切り替え前の現在位置を保存
    const [currentX, currentY] = win.getPosition();
    const [currentWidth, currentHeight] = win.getSize();

    if (isActive) {
      // 非アクティブ → アクティブ
      
      // 1. 非アクティブ座標を保存
      await this.dataStore.updateNote(noteId, {
        inactiveX: currentX,
        inactiveY: currentY,
        inactiveWidth: currentWidth,
        inactiveHeight: currentHeight,
        isActive: true
      });
      
      // 2. アクティブ座標を使用（保存されていない場合は現在位置）
      let targetX = note.activeX;
      let targetY = note.activeY;
      let targetWidth: number;
      let targetHeight: number;
      
      // アクティブ化時は編集モード用のサイズを使用
      if (note.isNewlyCreated) {
        targetWidth = 300; // 編集モード用のデフォルト幅
        targetHeight = 200; // 編集モード用のデフォルト高さ
        console.log(`[DEBUG] handleSetNoteActive: New note activation - using edit mode size ${targetWidth}x${targetHeight}`);
      } else {
        targetWidth = note.activeWidth || 300;
        targetHeight = note.activeHeight || 200;
      }
      
      if (typeof targetX !== 'number' || typeof targetY !== 'number') {
        targetX = currentX;
        targetY = currentY;
        // 初回の場合のみアクティブ座標を設定
        await this.dataStore.updateNote(noteId, {
          activeX: targetX,
          activeY: targetY,
          activeWidth: targetWidth,
          activeHeight: targetHeight
        });
      }
      
      // 3. ウィンドウをアクティブ位置・サイズに設定
      win.setBounds({
        x: Math.round(targetX),
        y: Math.round(targetY),
        width: Math.round(targetWidth),
        height: Math.round(targetHeight)
      });

      // 4. ウィンドウの表示状態を更新
      console.log(`[DEBUG] handleSetNoteActive: setting window ${noteId} to be always on top and focused`);
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.focus();
      safeSend(win.webContents, 'set-active', true);
      
      // 更新されたノートデータをレンダラーに送信
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        safeSend(win.webContents, 'note-data', updatedNote);
      }
      
      console.log(`[DEBUG] Activated note ${noteId}: inactive(${currentX},${currentY}) -> active(${targetX},${targetY})`);
      
    } else {
      // アクティブ → 非アクティブ
      
      // 1. アクティブ座標を保存し、新規作成フラグをクリア
      const updates: Partial<StickyNote> = {
        activeX: currentX,
        activeY: currentY,
        isActive: false
      };

      // 新規ノートの場合、編集モード用のサイズを保存（現在のサイズに関係なく）
      if (note.isNewlyCreated) {
        // 新規ノートは編集モード用のサイズを保存
        updates.activeWidth = 300;
        updates.activeHeight = 200;
        console.log(`[DEBUG] handleSetNoteActive: Saving active state (new note, enforced edit mode size): ${currentX},${currentY} size:${updates.activeWidth}x${updates.activeHeight} for note:${noteId}`);
      } else {
        // 既存ノートは現在のサイズを保存
        updates.activeWidth = currentWidth;
        updates.activeHeight = currentHeight;
        console.log(`[DEBUG] handleSetNoteActive: Saving active state (existing note): ${currentX},${currentY} size:${currentWidth}x${currentHeight} for note:${noteId}`);
      }
      await this.dataStore.updateNote(noteId, updates);
      
      // 2. 非アクティブ座標とサイズを計算
      let targetX = currentX;
      let targetY = currentY;
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        const bounds = await this.calculateNoteBounds(updatedNote, currentX, currentY);
        
        console.log(`[DEBUG] handleSetNoteActive: Setting bounds for note ${noteId}: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
        
        targetX = bounds.x;
        targetY = bounds.y;
        
        // 3. ウィンドウを非アクティブ位置・サイズに設定
        win.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height)
        });
      }

      // フラグクリア（非アクティブ化処理完了後）
      if (note.isNewlyCreated) {
        await this.dataStore.updateNote(noteId, { isNewlyCreated: false });
        console.log(`[DEBUG] handleSetNoteActive: Clearing isNewlyCreated flag after deactivation for note:${noteId}`);
      }

      // 4. ウィンドウの表示状態を更新
      console.log(`[DEBUG] handleSetNoteActive: setting window ${noteId} to not always on top and sending inactive state`);
      win.setAlwaysOnTop(false);
      safeSend(win.webContents, 'set-active', false);
      
      // 更新されたノートデータをレンダラーに送信
      const finalNote = await this.dataStore.getNote(noteId);
      if (finalNote) {
        safeSend(win.webContents, 'note-data', finalNote);
      }
      
      console.log(`[DEBUG] Deactivated note ${noteId}: active(${currentX},${currentY}) -> inactive(${Math.round(targetX)},${Math.round(targetY)})`);
    }

    // リサイズ設定を更新
    win.setResizable(isActive);
    
    if (isActive) {
      win.focus();
    }

    this.windowStateManager.completeStateChange(noteId, isActive);
    console.log(`[DEBUG] handleSetNoteActive: completed state change for ${noteId} to ${isActive}`);
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
      alwaysOnTop: true,
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
      this.searchWindow.loadFile(path.join(__dirname, 'index.html'), {
        query: { search: 'true' }
      });
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

  private async notifySettingsChange() {
    // 全ての付箋ウィンドウに設定変更を通知
    for (const [noteId, window] of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings-changed');
      }
    }
    
    // 設定が保存されたときも非アクティブなノートのサイズを更新（永続化）
    try {
      const settings = await this.dataStore.getSettings();
      await this.updateInactiveNoteSizes(settings, true);
    } catch (error) {
      console.error('Error updating inactive note sizes after settings change:', error);
    }
  }

  private async notifySettingsPreview(previewSettings: any) {
    console.log('[DEBUG] notifySettingsPreview called with:', previewSettings);
    
    // 全ての付箋ウィンドウにプレビュー設定を送信
    for (const [noteId, window] of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings-preview', previewSettings);
      }
    }
    
    // 非アクティブサイズが変更された場合、現在非アクティブなノートのサイズを更新
    if (previewSettings.defaultInactiveWidth !== undefined || previewSettings.defaultInactiveHeight !== undefined) {
      await this.updateInactiveNoteSizes(previewSettings, false);
    }
  }

  private async updateInactiveNoteSizes(previewSettings: any, isPermanent: boolean = false) {
    try {
      const notes = await this.dataStore.getAllNotes();
      const defaultWidth = previewSettings.defaultInactiveWidth;
      const defaultHeight = previewSettings.defaultInactiveHeight;
      
      console.log('[DEBUG] updateInactiveNoteSizes called with:', { defaultWidth, defaultHeight, noteCount: notes.length, isPermanent });
      
      for (const note of notes) {
        if (!note.isActive) {
          const window = this.windows.get(note.id);
          if (window && !window.isDestroyed()) {
            // デフォルトサイズが設定されている場合は、常に適用
            let newWidth = defaultWidth || note.inactiveWidth;
            let newHeight = defaultHeight || note.inactiveHeight;
            
            // 最終的なフォールバック値を設定
            if (!newWidth) newWidth = 200;
            if (!newHeight) newHeight = 150;
            
            console.log('[DEBUG] Note:', note.id, 'isActive:', note.isActive, 'current size:', note.inactiveWidth, 'x', note.inactiveHeight, 'new size:', newWidth, 'x', newHeight);
            
            if (newWidth && newHeight) {
              // 最小サイズ制限を一時的に解除して、設定されたサイズに変更できるようにする
              window.setMinimumSize(Math.min(newWidth, 50), Math.min(newHeight, 50));
              window.setSize(newWidth, newHeight);
              console.log('[DEBUG] Window size changed to:', newWidth, 'x', newHeight);
              
              // 永続化が必要な場合（設定保存時）はデータベースも更新
              if (isPermanent && (defaultWidth || defaultHeight)) {
                // デフォルトサイズが設定されている場合は、常にサイズを更新
                const updates: any = {};
                if (defaultWidth) {
                  updates.inactiveWidth = newWidth;
                }
                if (defaultHeight) {
                  updates.inactiveHeight = newHeight;
                }
                
                console.log('[DEBUG] Updating note', note.id, 'with:', updates);
                await this.dataStore.updateNote(note.id, updates);
                
                // ノートデータをウィンドウに再送信して、データが確実に反映されるようにする
                const updatedNote = await this.dataStore.getNote(note.id);
                if (updatedNote) {
                  safeSend(window.webContents, 'note-data', updatedNote);
                  console.log('[DEBUG] Note data resent to window:', note.id);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error updating inactive note sizes:', error);
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
      this.settingsWindow.loadFile(path.join(__dirname, 'index.html'), {
        query: { settings: 'true' }
      });
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

  /**
   * リッチコンテンツからテキスト部分のみを抽出する
   */
  private extractTextFromRichContent(content: any): string {
    try {
      // 文字列の場合はそのまま返す
      if (typeof content === 'string') {
        return content;
      }
      
      // オブジェクトの場合
      if (typeof content === 'object' && content !== null) {
        // HTMLコンテンツの場合、HTMLタグを除去
        if (typeof content.html === 'string') {
          return content.html.replace(/<[^>]*>/g, '');
        }
        
        // JSON形式のリッチテキストの場合
        if (content.ops && Array.isArray(content.ops)) {
          // Quill.jsのDelta形式の場合
          return content.ops
            .filter((op: any) => op.insert && typeof op.insert === 'string')
            .map((op: any) => op.insert)
            .join('');
        }
        
        // その他のオブジェクトの場合、JSON文字列化してから処理
        const jsonStr = JSON.stringify(content);
        return jsonStr.replace(/[{}"\[\]:,]/g, ' ').trim();
      }
      
      return '';
    } catch (error) {
      console.error('Error extracting text from rich content:', error);
      return '';
    }
  }

  /**
   * すべての付箋をプライマリディスプレイに整列表示
   */
}

new StickyNotesApp();