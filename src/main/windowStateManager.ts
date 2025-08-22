import { BrowserWindow } from 'electron';

export interface WindowState {
  id: string;
  isActive: boolean;
  isTransitioning: boolean;
  lastStateChange: number;
}

export class WindowStateManager {
  private windowStates: Map<string, WindowState> = new Map();
  private readonly TRANSITION_COOLDOWN = 30; // ms - さらに短縮
  private pendingBlurTimeouts: Map<string, NodeJS.Timeout> = new Map(); // ブラーイベントの重複防止

  /**
   * ウィンドウ状態を登録
   */
  registerWindow(windowId: string, isActive: boolean = false): void {
    this.windowStates.set(windowId, {
      id: windowId,
      isActive,
      isTransitioning: false,
      lastStateChange: Date.now()
    });
  }

  /**
   * ウィンドウ状態を削除
   */
  unregisterWindow(windowId: string): void {
    // 保留中のブラーイベントをクリア
    const timeout = this.pendingBlurTimeouts.get(windowId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingBlurTimeouts.delete(windowId);
    }
    this.windowStates.delete(windowId);
  }

  /**
   * 重複ブラーイベントの防止とスケジューリング
   */
  scheduleBlurEvent(windowId: string, callback: () => void, delay: number = 100): void {
    // 既存のブラーイベントをキャンセル
    const existingTimeout = this.pendingBlurTimeouts.get(windowId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // 新しいブラーイベントをスケジュール
    const timeout = setTimeout(() => {
      this.pendingBlurTimeouts.delete(windowId);
      callback();
    }, delay);

    this.pendingBlurTimeouts.set(windowId, timeout);
  }

  /**
   * ウィンドウ状態変更をリクエスト（blur イベント用 - より緩い条件）
   */
  requestBlurStateChange(windowId: string, newState: boolean): boolean {
    const state = this.windowStates.get(windowId);
    if (!state) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Window ${windowId} not registered in state manager`);
      }
      return false;
    }

    // 非アクティブ化のみ許可、さらに緩い条件
    if (newState === false) {
      // blur イベントの場合、ほぼ確実に非アクティブ化を許可
      const timeSinceLastChange = Date.now() - state.lastStateChange;
      
      // 非常に短い間隔（5ms未満）でない限り許可
      if (timeSinceLastChange >= 5) {
        state.isTransitioning = true;
        state.lastStateChange = Date.now();
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`Blur state change approved for window ${windowId}: ${state.isActive} -> ${newState} (${timeSinceLastChange}ms)`);
        }
        
        return true;
      }
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`Blur state change blocked for window ${windowId} - only deactivation allowed via blur or too frequent`);
    }
    return false;
  }

  /**
   * ウィンドウ状態変更をリクエスト
   */
  requestStateChange(windowId: string, newState: boolean): boolean {
    const state = this.windowStates.get(windowId);
    if (!state) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Window ${windowId} not registered in state manager`);
      }
      return false;
    }

    // 連続した状態変更を防ぐ
    const timeSinceLastChange = Date.now() - state.lastStateChange;
    if (state.isTransitioning || timeSinceLastChange < this.TRANSITION_COOLDOWN) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`State change blocked for window ${windowId} - cooldown active`);
      }
      return false;
    }

    // 同じ状態への変更を防ぐ
    if (state.isActive === newState) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`State change blocked for window ${windowId} - already in target state`);
      }
      return false;
    }

    // 状態変更を承認
    state.isTransitioning = true;
    state.lastStateChange = Date.now();
    
    return true;
  }

  /**
   * 状態変更完了を通知
   */
  completeStateChange(windowId: string, newState: boolean): void {
    const state = this.windowStates.get(windowId);
    if (state) {
      state.isActive = newState;
      state.isTransitioning = false;
      state.lastStateChange = Date.now();
    }
  }

  /**
   * ウィンドウが状態変更中かチェック
   */
  isTransitioning(windowId: string): boolean {
    const state = this.windowStates.get(windowId);
    return state?.isTransitioning || false;
  }

  /**
   * 現在のウィンドウ状態を取得
   */
  getWindowState(windowId: string): WindowState | null {
    return this.windowStates.get(windowId) || null;
  }

  /**
   * すべてのアクティブウィンドウを取得
   */
  getActiveWindows(): string[] {
    return Array.from(this.windowStates.values())
      .filter(state => state.isActive)
      .map(state => state.id);
  }

  /**
   * デバッグ用: すべての状態を表示
   */
  debugPrintStates(): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('=== Window States ===');
      this.windowStates.forEach((state, id) => {
        console.log(`${id}: active=${state.isActive}, transitioning=${state.isTransitioning}, lastChange=${new Date(state.lastStateChange).toISOString()}`);
      });
      console.log('===================');
    }
  }
}