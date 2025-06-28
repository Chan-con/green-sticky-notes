import { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { StickyNote, DisplayInfo, AppSettings } from '../types';
import { DataStore } from './dataStore';

class StickyNotesApp {
  private windows: Map<string, BrowserWindow> = new Map();
  private dataStore: DataStore;
  private tray: Tray | null = null;
  private isQuitting = false;
  private isSystemMinimized = false;

  constructor() {
    this.dataStore = new DataStore();
    this.setupEventHandlers();
    this.setupSystemMinimizeDetection();
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

    win.on('moved', async () => {
      const [x, y] = win.getPosition();
      const currentNote = await this.dataStore.getNote(note.id);
      if (currentNote) {
        this.dataStore.updateNotePosition(note.id, x, y, currentNote.isActive);
      }
    });

    win.on('resized', async () => {
      const [width, height] = win.getSize();
      const currentNote = await this.dataStore.getNote(note.id);
      if (currentNote) {
        this.dataStore.updateNoteSize(note.id, width, height, currentNote.isActive);
      }
    });

    win.on('closed', () => {
      this.windows.delete(note.id);
    });

    this.windows.set(note.id, win);
    return win;
  }

  private async calculateNoteBounds(note: StickyNote) {
    const displays = screen.getAllDisplays();
    const currentDisplay = displays.find(d => d.id.toString() === note.displayId) || screen.getPrimaryDisplay();
    
    // アクティブ/非アクティブ状態に応じて位置とサイズを取得
    let x, y, width, height;
    
    if (note.isActive) {
      // アクティブ状態の場合
      if (note.activeX !== 0 && note.activeY !== 0) {
        // すでにアクティブ位置が設定されている場合
        x = note.activeX;
        y = note.activeY;
      } else {
        // 初回アクティブ化の場合、非アクティブ位置を基準にする
        console.log(`First-time activation for note ${note.id}, using inactive position as base`);
        x = note.inactiveX || 100;
        y = note.inactiveY || 100;
      }
      width = note.activeWidth || 300;
      height = note.activeHeight || 200;
    } else {
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

    // 画面境界チェック（特にアクティブ時の拡大に注意）
    if (x + width > currentDisplay.bounds.x + currentDisplay.bounds.width) {
      x = currentDisplay.bounds.x + currentDisplay.bounds.width - width;
      console.log(`Adjusted X position to prevent overflow: ${x}`);
    }
    if (y + height > currentDisplay.bounds.y + currentDisplay.bounds.height) {
      y = currentDisplay.bounds.y + currentDisplay.bounds.height - height;
      console.log(`Adjusted Y position to prevent overflow: ${y}`);
    }
    if (x < currentDisplay.bounds.x) {
      x = currentDisplay.bounds.x;
      console.log(`Adjusted X position to stay within bounds: ${x}`);
    }
    if (y < currentDisplay.bounds.y) {
      y = currentDisplay.bounds.y;
      console.log(`Adjusted Y position to stay within bounds: ${y}`);
    }

    return { x, y, width, height };
  }


  private handleDisplayChange() {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    
    this.windows.forEach(async (win, noteId) => {
      const note = await this.dataStore.getNote(noteId);
      if (!note) return;

      const noteDisplay = displays.find(d => d.id.toString() === note.displayId);
      
      if (!noteDisplay) {
        const newX = primaryDisplay.bounds.x + 50;
        const newY = primaryDisplay.bounds.y + 50;
        
        win.setPosition(newX, newY);
        await this.dataStore.updateNote(noteId, {
          activeX: newX,
          activeY: newY,
          inactiveX: newX,
          inactiveY: newY,
          displayId: primaryDisplay.id.toString()
        });
      }
    });
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

      console.log(`Current note state:`, {
        activeX: note.activeX, activeY: note.activeY, 
        activeWidth: note.activeWidth, activeHeight: note.activeHeight,
        inactiveX: note.inactiveX, inactiveY: note.inactiveY,
        inactiveWidth: note.inactiveWidth, inactiveHeight: note.inactiveHeight,
        currentActive: note.isActive
      });

      // 現在の位置とサイズを保存してから状態を切り替え
      const [currentX, currentY] = win.getPosition();
      const [currentWidth, currentHeight] = win.getSize();
      
      console.log(`Current window bounds: x=${currentX}, y=${currentY}, width=${currentWidth}, height=${currentHeight}`);
      
      // 現在の状態に応じて位置・サイズを保存
      if (note.isActive && !isActive) {
        // アクティブ→非アクティブ: アクティブ状態の位置・サイズを保存
        await this.dataStore.updateNote(noteId, {
          activeX: currentX,
          activeY: currentY,
          activeWidth: currentWidth,
          activeHeight: currentHeight
        });
        console.log(`Saved active bounds: x=${currentX}, y=${currentY}, width=${currentWidth}, height=${currentHeight}`);
      } else if (!note.isActive && isActive) {
        // 非アクティブ→アクティブ: 非アクティブ状態の位置を保存
        await this.dataStore.updateNote(noteId, {
          inactiveX: currentX,
          inactiveY: currentY
        });
        console.log(`Saved inactive position: x=${currentX}, y=${currentY}`);
      }

      // 状態を更新
      await this.dataStore.updateNote(noteId, { isActive });
      
      // 更新された状態で位置とサイズを再計算
      const updatedNote = await this.dataStore.getNote(noteId);
      if (updatedNote) {
        const bounds = await this.calculateNoteBounds(updatedNote);
        
        console.log(`New bounds:`, bounds);
        
        // 初回アクティブ化時は計算された位置をアクティブ位置として保存
        if (isActive && (note.activeX === 0 && note.activeY === 0)) {
          console.log(`Saving initial active position for note ${noteId}: (${bounds.x}, ${bounds.y})`);
          await this.dataStore.updateNote(noteId, {
            activeX: bounds.x,
            activeY: bounds.y
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
      {
        label: '他のアプリと一緒に最小化',
        type: 'checkbox',
        checked: settings.followSystemMinimize,
        click: async () => {
          await this.toggleFollowSystemMinimize();
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

  private async toggleFollowSystemMinimize() {
    const settings = await this.dataStore.getSettings();
    const newSettings = {
      ...settings,
      followSystemMinimize: !settings.followSystemMinimize
    };
    await this.dataStore.saveSettings(newSettings);
  }

  private setupSystemMinimizeDetection() {
    // Windowsのシステム最小化（Win+D、Win+M等）を検出
    if (process.platform === 'win32') {
      // フォーカス状態の変化を監視してシステム最小化を検出
      app.on('browser-window-blur', async () => {
        // すべてのウィンドウがフォーカスを失った場合、システム最小化の可能性
        setTimeout(async () => {
          const allWindowsHidden = Array.from(this.windows.values()).every(win => 
            !win.isVisible() || win.isMinimized()
          );
          
          if (allWindowsHidden && !this.isSystemMinimized) {
            console.log('System minimize detected');
            this.isSystemMinimized = true;
            await this.handleSystemMinimize();
          }
        }, 100); // 短い遅延で複数のイベントをまとめて処理
      });

      // ウィンドウがフォーカスを取得した場合、システム復元の可能性
      app.on('browser-window-focus', async () => {
        if (this.isSystemMinimized) {
          console.log('System restore detected');
          this.isSystemMinimized = false;
          await this.handleSystemRestore();
        }
      });
    }
  }

  private async handleSystemMinimize() {
    const settings = await this.dataStore.getSettings();
    if (settings.followSystemMinimize) {
      console.log('Following system minimize - hiding all windows');
      this.hideAllWindows();
    }
  }

  private async handleSystemRestore() {
    const settings = await this.dataStore.getSettings();
    if (settings.followSystemMinimize) {
      console.log('Following system restore - showing all windows');
      this.showAllWindows();
    }
  }
}

new StickyNotesApp();