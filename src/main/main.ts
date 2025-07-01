import { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { StickyNote, DisplayInfo, AppSettings } from '../types';
import { DataStore } from './dataStore';
import { WindowStateManager } from './windowStateManager';

class StickyNotesApp {
  private windows: Map<string, BrowserWindow> = new Map();
  private dataStore: DataStore;
  private windowStateManager: WindowStateManager;
  private tray: Tray | null = null;
  private isQuitting = false;

  constructor() {
    this.dataStore = new DataStore();
    this.windowStateManager = new WindowStateManager();
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // シングルインスタンス確保
    const gotTheLock = app.requestSingleInstanceLock();
    
    if (!gotTheLock) {
      // 既に起動中の場合は終了
      console.log('Another instance is already running. Exiting...');
      app.quit();
      return;
    }
    
    // 2つ目のインスタンスが起動しようとした場合の処理
    app.on('second-instance', () => {
      console.log('Second instance detected, showing existing windows');
      this.showAllWindows();
    });

    app.whenReady().then(() => {
      this.createTray();
      this.createInitialNotes();
      this.setupIpcHandlers();
      
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

    app.on('before-quit', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.hideAllWindows();
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

    // 位置更新用のデバウンス
    let moveTimeout: NodeJS.Timeout | null = null;
    
    win.on('moved', async () => {
      const [x, y] = win.getPosition();
      
      // 頻繁な更新をデバウンス
      if (moveTimeout) {
        clearTimeout(moveTimeout);
      }
      
      moveTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (!currentNote) return;
        
        // 移動先のディスプレイを検出
        const newDisplay = this.findDisplayContainingPoint(x, y);
        const updates: Partial<StickyNote> = {};
        
        // ディスプレイが変更された場合
        if (newDisplay.id.toString() !== currentNote.displayId) {
          console.log(`=== Move Event Display Change ===`);
          console.log(`Note ${note.id} moved to display ${newDisplay.id} from ${currentNote.displayId}`);
          console.log(`Position: (${x}, ${y}), State: ${currentNote.isActive ? 'active' : 'inactive'}`);
          updates.displayId = newDisplay.id.toString();
        }
        
        // 状態に応じて適切な位置フィールドを更新
        if (currentNote.isActive) {
          updates.activeX = x;
          updates.activeY = y;
          console.log(`Updated active position for ${note.id}: (${x}, ${y}) on display ${newDisplay.id}`);
        } else {
          updates.inactiveX = x;
          updates.inactiveY = y;
          console.log(`Updated inactive position for ${note.id}: (${x}, ${y}) on display ${newDisplay.id}`);
        }
        
        // 一度に更新
        await this.dataStore.updateNote(note.id, updates);
      }, 100); // 100msのデバウンス
    });

    // サイズ変更用のデバウンス
    let resizeTimeout: NodeJS.Timeout | null = null;
    
    win.on('resized', async () => {
      const [width, height] = win.getSize();
      
      // 頻繁なサイズ変更をデバウンス
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = setTimeout(async () => {
        const currentNote = await this.dataStore.getNote(note.id);
        if (currentNote && currentNote.isActive) {
          // アクティブ時のみサイズを記録
          await this.dataStore.updateNoteSize(note.id, width, height, true);
          console.log(`Updated active size for ${note.id}: ${width}x${height}`);
        }
      }, 200); // 200msのデバウンス
    });

    win.on('closed', () => {
      this.windows.delete(note.id);
      this.windowStateManager.unregisterWindow(note.id);
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
    
    console.log(`Finding display for point (${x}, ${y}) among ${displays.length} displays`);
    
    for (const display of displays) {
      const bounds = display.bounds;
      console.log(`Checking display ${display.id}: bounds ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
      if (x >= bounds.x && x < bounds.x + bounds.width &&
          y >= bounds.y && y < bounds.y + bounds.height) {
        console.log(`Point (${x}, ${y}) found in display ${display.id}`);
        return display;
      }
    }
    
    // どのディスプレイにも見つからない場合はプライマリディスプレイを返す
    console.log(`Point (${x}, ${y}) not found in any display, using primary`);
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
    console.log(`Display ${targetDisplayId} not found for note ${note.id}. Migrating to primary display.`);
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
        console.log(`Using saved active position for note ${note.id}: (${x}, ${y})`);
      } else {
        // 初回アクティブ化の場合は現在位置をそのまま維持（境界チェックも最小限に）
        console.log(`First-time activation for note ${note.id}, staying at current position`);
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
    console.log(`Actual display for position (${x}, ${y}): ${actualDisplay.id}`);
    
    // 記録されたdisplayIdと実際のディスプレイの比較
    const savedDisplayId = note.displayId;
    const actualDisplayId = actualDisplay.id.toString();
    const displayChanged = savedDisplayId !== actualDisplayId;
    
    if (displayChanged) {
      console.log(`Display changed for note ${note.id}: ${savedDisplayId} -> ${actualDisplayId}`);
    }
    
    // フォールバック: 記録されたディスプレイが存在しない場合のチェック
    const { display: savedDisplay, shouldMigrate } = this.findValidDisplayForNote(note, note.isActive);
    
    // 使用するディスプレイを決定（移行が必要な場合はプライマリディスプレイを使用）
    const currentDisplay = shouldMigrate ? screen.getPrimaryDisplay() : actualDisplay;
    
    // 移行が必要な場合の処理
    if (shouldMigrate) {
      console.log(`Saved display ${savedDisplayId} no longer exists, migrating to primary display`);
      // プライマリディスプレイの安全な位置を計算
      const primaryBounds = currentDisplay.bounds;
      const safeMargin = 50;
      x = primaryBounds.x + safeMargin;
      y = primaryBounds.y + safeMargin;
      console.log(`Migrated note ${note.id} to safe position: (${x}, ${y}) on primary display ${currentDisplay.id}`);
    } else {
      // 最小限の境界チェック（初回アクティブ化時は特に緩く）
      const bounds = currentDisplay.bounds;
      const isFirstTimeActive = note.isActive && (note.activeX === 0 && note.activeY === 0);
      
      // 詳細なデバッグ情報を出力
      console.log(`=== Display Analysis for ${note.id} ===`);
      console.log(`Note saved displayId: ${savedDisplayId}`);
      console.log(`Actual display for position (${x}, ${y}): ${actualDisplayId}`);
      console.log(`Display changed: ${displayChanged}`);
      console.log(`Should migrate: ${shouldMigrate}`);
      console.log(`Current display bounds:`, {
        displayId: currentDisplay.id,
        bounds: bounds,
        notePosition: { x, y, width, height },
        isActive: note.isActive,
        isFirstTimeActive: isFirstTimeActive
      });
      
      // 境界チェックをより寛容にする
      if (isFirstTimeActive) {
        // 初回アクティブ化時は境界チェックをスキップ
        console.log(`Skipping boundary adjustment for first-time activation of note ${note.id}`);
      } else if (displayChanged) {
        // ディスプレイが変わった場合は最小限の調整のみ
        console.log(`Display changed for note ${note.id}, minimal boundary adjustment only`);
        // 完全に画面外の場合のみ調整（非常に緩い条件）
        const isCompletelyOutside = 
          x + width < bounds.x || x > bounds.x + bounds.width ||
          y + height < bounds.y || y > bounds.y + bounds.height;
          
        if (isCompletelyOutside) {
          const oldX = x, oldY = y;
          x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
          y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));
          console.log(`Adjusted completely outside position for display change ${note.id}: (${oldX}, ${oldY}) -> (${x}, ${y})`);
        } else {
          console.log(`Position OK for display change ${note.id}: (${x}, ${y}) - no adjustment needed`);
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
          console.log(`Adjusted barely visible position for note ${note.id}: (${oldX}, ${oldY}) -> (${x}, ${y})`);
        } else {
          console.log(`Position OK for note ${note.id}: (${x}, ${y}) within display bounds`);
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
    
    console.log('Display configuration changed. Checking note positions...');
    
    // 各ウィンドウの処理を並列実行
    const migrationPromises = Array.from(this.windows.entries()).map(async ([noteId, win]) => {
      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      const noteDisplay = displays.find(d => d.id.toString() === note.displayId);
      
      if (!noteDisplay) {
        console.log(`Display ${note.displayId} no longer available for note ${noteId}. Migrating to primary display.`);
        
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
        
        console.log(`Note ${noteId} migrated to primary display at position (${newX}, ${newY})`);
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
          
          console.log(`Note ${noteId} position adjusted to stay within display bounds: (${adjustedX}, ${adjustedY})`);
        }
      }
    });
    
    // すべての移行処理を並列実行
    await Promise.all(migrationPromises);
    console.log('Display change handling completed.');
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
          
          console.log(`Positioning new note at parent location: (${parentX}, ${parentY})`);
          
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
            console.log(`New note window moved to top above parent`);
          }
        }
      }
      
      return newNote;
    });

    ipcMain.handle('update-note', async (_, noteId: string, updates: Partial<StickyNote>) => {
      await this.dataStore.updateNote(noteId, updates);
      return true;
    });

    ipcMain.handle('delete-note', async (_, noteId: string) => {
      const win = this.windows.get(noteId);
      if (win) {
        win.close();
      }
      await this.dataStore.deleteNote(noteId);
      
      // 削除後、残りの付箋数をチェック
      const remainingNotes = await this.dataStore.getAllNotes();
      if (remainingNotes.length === 0) {
        console.log('Last note deleted, creating new note at top-left');
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
      console.log(`Setting note ${noteId} active: ${isActive}`);
      const win = this.windows.get(noteId);
      if (!win) return;

      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      // 状態変更が許可されているかチェック
      if (!this.windowStateManager.requestStateChange(noteId, isActive)) {
        console.log(`State change rejected for note ${noteId}`);
        return;
      }

      // 現在の位置とサイズを正確に取得
      const [currentX, currentY] = win.getPosition();
      const [currentWidth, currentHeight] = win.getSize();
      
      console.log(`Current window bounds: x=${currentX}, y=${currentY}, width=${currentWidth}, height=${currentHeight}`);
      console.log(`Switching note ${noteId} from ${note.isActive ? 'active' : 'inactive'} to ${isActive ? 'active' : 'inactive'}`);
      
      // 状態変更を原子的に実行
      const updates: Partial<StickyNote> = { isActive };
      
      // 現在の状態に応じて位置・サイズを保存
      if (note.isActive && !isActive) {
        // アクティブ→非アクティブ: アクティブ状態の位置・サイズを保存
        updates.activeX = currentX;
        updates.activeY = currentY;
        updates.activeWidth = currentWidth;
        updates.activeHeight = currentHeight;
        console.log(`Saving active bounds: x=${currentX}, y=${currentY}, width=${currentWidth}, height=${currentHeight}`);
      } else if (!note.isActive && isActive) {
        // 非アクティブ→アクティブ: 非アクティブ状態の位置を保存
        updates.inactiveX = currentX;
        updates.inactiveY = currentY;
        console.log(`Saving inactive position: x=${currentX}, y=${currentY}`);
      }

      // 一度の更新で状態変更を実行
      await this.dataStore.updateNote(noteId, updates);
      
      // 更新された状態で位置とサイズを再計算（現在のウィンドウ位置を基準に）
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        const bounds = await this.calculateNoteBounds(updatedNote, currentX, currentY);
        
        console.log(`New bounds:`, bounds);
        
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
          console.log(`Migrating note ${noteId} to display ${bounds.displayId} with position (${bounds.x}, ${bounds.y})`);
          await this.dataStore.updateNote(noteId, migrationUpdates);
        } else if (bounds.displayChanged) {
          // 実際の位置に基づくディスプレイ変更（自然な移動）
          migrationUpdates.displayId = bounds.displayId;
          console.log(`Natural display change for note ${noteId}: ${updatedNote.displayId} -> ${bounds.displayId}`);
          await this.dataStore.updateNote(noteId, migrationUpdates);
        }
        
        // 初回アクティブ化時は現在位置をアクティブ位置として保存
        if (isActive && (note.activeX === 0 && note.activeY === 0)) {
          console.log(`Saving initial active position for note ${noteId}: (${currentX}, ${currentY})`);
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
  }

  private createTray() {
    console.log('Starting tray creation...');
    console.log('Platform:', process.platform);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('__dirname:', __dirname);
    console.log('process.resourcesPath:', process.resourcesPath);
    
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

      console.log('Trying icon paths:', possiblePaths);
      
      const fs = require('fs');
      let trayIconPath = null;
      
      // 存在するパスを見つける
      for (const iconPath of possiblePaths) {
        console.log('Checking path:', iconPath);
        if (fs.existsSync(iconPath)) {
          trayIconPath = iconPath;
          console.log('Found icon at:', iconPath);
          break;
        }
      }

      if (!trayIconPath) {
        console.error('No tray icon found in any of the paths:', possiblePaths);
        // フォールバック: nativeImageで空のアイコンを作成
        const { nativeImage } = require('electron');
        const emptyIcon = nativeImage.createEmpty();
        this.tray = new Tray(emptyIcon);
        console.log('Created tray with empty icon');
      } else {
        this.tray = new Tray(trayIconPath);
        console.log('Created tray with icon:', trayIconPath);
      }

      this.tray.setToolTip('Green Sticky Notes');
      
      // トレイアイコンがクリックされた時の処理
      this.tray.on('click', () => {
        console.log('Tray clicked');
        this.showAllWindows();
      });
      
      // 右クリック時のコンテキストメニュー
      this.tray.on('right-click', () => {
        console.log('Tray right-clicked');
        this.tray?.popUpContextMenu();
      });
      
      this.updateTrayMenu();
      console.log('Tray setup completed');
      
      // トレイが正常に作成されたか確認
      if (this.tray && !this.tray.isDestroyed()) {
        console.log('Tray is active and visible');
      } else {
        console.error('Tray creation failed or tray was destroyed');
      }
      
    } catch (error) {
      console.error('Failed to create tray:', error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
    }
  }

  private async updateTrayMenu() {
    if (!this.tray) return;

    const isAutoStartEnabled = await this.getAutoStartStatus();
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
        label: 'PC起動時に自動開始',
        type: 'checkbox',
        checked: isAutoStartEnabled,
        click: async () => {
          await this.toggleAutoStart();
          this.updateTrayMenu(); // メニューを更新
        }
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
        
        console.log(`New note created from tray: ${newNote.id}`);
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

  private async getAutoStartStatus(): Promise<boolean> {
    return app.getLoginItemSettings().openAtLogin;
  }

  private async toggleAutoStart() {
    const isEnabled = app.getLoginItemSettings().openAtLogin;
    app.setLoginItemSettings({
      openAtLogin: !isEnabled,
      openAsHidden: true
    });
  }



}

new StickyNotesApp();