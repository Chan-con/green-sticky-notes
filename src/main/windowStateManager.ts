import { BrowserWindow } from 'electron';

export interface WindowState {
  id: string;
  isActive: boolean;
  isTransitioning: boolean;
  lastStateChange: number;
}

export class WindowStateManager {
  private windowStates: Map<string, WindowState> = new Map();
  private readonly TRANSITION_COOLDOWN = 300; // ms

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
    this.windowStates.delete(windowId);
  }

  /**
   * ウィンドウ状態変更をリクエスト
   */
  requestStateChange(windowId: string, newState: boolean): boolean {
    const state = this.windowStates.get(windowId);
    if (!state) {
      console.warn(`Window ${windowId} not registered in state manager`);
      return false;
    }

    // 連続した状態変更を防ぐ
    const timeSinceLastChange = Date.now() - state.lastStateChange;
    if (state.isTransitioning || timeSinceLastChange < this.TRANSITION_COOLDOWN) {
      console.log(`State change blocked for window ${windowId} - cooldown active`);
      return false;
    }

    // 同じ状態への変更を防ぐ
    if (state.isActive === newState) {
      console.log(`State change blocked for window ${windowId} - already in target state`);
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
    console.log('=== Window States ===');
    this.windowStates.forEach((state, id) => {
      console.log(`${id}: active=${state.isActive}, transitioning=${state.isTransitioning}, lastChange=${new Date(state.lastStateChange).toISOString()}`);
    });
    console.log('===================');
  }
}