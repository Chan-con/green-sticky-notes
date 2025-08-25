import { StickyNote } from '../types';

/**
 * Phase 1: IPC通信最適化 - バッチ更新システム
 */

export class BatchUpdateManager {
  private updateQueue: Map<string, Partial<import('../types').StickyNote>> = new Map();
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly FLUSH_DELAY = 100; // 100ms間隔でバッチ処理

  constructor(private flushCallback: (updates: Map<string, Partial<import('../types').StickyNote>>) => Promise<void>) {}

  /**
   * 更新をキューに追加
   */
  scheduleUpdate(noteId: string, updates: Partial<import('../types').StickyNote>): void {
    // 既存の更新と新しい更新をマージ
    const existingUpdates = this.updateQueue.get(noteId) || {};
    const mergedUpdates = { ...existingUpdates, ...updates };
    
    this.updateQueue.set(noteId, mergedUpdates);
    
    // デバウンス処理
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
    
    this.flushTimeout = setTimeout(() => {
      this.flush();
    }, this.FLUSH_DELAY);
  }

  /**
   * 即座にフラッシュ（緊急時用）
   */
  async forceFlush(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    await this.flush();
  }

  /**
   * キューされた更新を一括で実行
   */
  private async flush(): Promise<void> {
    if (this.updateQueue.size === 0) {
      return;
    }

    const updates = new Map(this.updateQueue);
    this.updateQueue.clear();
    this.flushTimeout = null;

    try {
      // IPCでシリアライズ可能なオブジェクトに変換してからMapに戻す
      const serializedEntries: [string, Partial<StickyNote>][] = Array.from(updates.entries()).map(([key, value]) => [
        key, 
        // Dateオブジェクトなどを文字列に変換
        JSON.parse(JSON.stringify(value)) as Partial<StickyNote>
      ]);
      
      const serializedUpdates = new Map<string, Partial<StickyNote>>(serializedEntries);
      await this.flushCallback(serializedUpdates);
      console.log(`[PERF] Batch update completed: ${updates.size} notes updated`);
    } catch (error) {
      console.error('[PERF] Batch update failed:', error);
      // エラー時は個別更新にフォールバック
      for (const [noteId, noteUpdates] of updates) {
        try {
          const serializedUpdate = JSON.parse(JSON.stringify(noteUpdates)) as Partial<StickyNote>;
          await this.flushCallback(new Map([[noteId, serializedUpdate]]));
        } catch (individualError) {
          console.error(`[PERF] Individual update failed for note ${noteId}:`, individualError);
        }
      }
    }
  }

  /**
   * クリーンアップ
   */
  destroy(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
    this.updateQueue.clear();
  }
}

/**
 * 差分計算ユーティリティ
 */
export class DiffUtils {
  /**
   * オブジェクトの差分を計算
   */
  static getDifference<T extends Record<string, any>>(oldObj: T, newObj: T): Partial<T> {
    const diff: Partial<T> = {};
    
    for (const key in newObj) {
      if (oldObj[key] !== newObj[key]) {
        diff[key] = newObj[key];
      }
    }
    
    return diff;
  }

  /**
   * 深い比較（ネストしたオブジェクト用）
   */
  static getDeepDifference<T extends Record<string, any>>(oldObj: T, newObj: T): Partial<T> {
    const diff: Partial<T> = {};
    
    for (const key in newObj) {
      if (typeof newObj[key] === 'object' && newObj[key] !== null) {
        if (typeof oldObj[key] === 'object' && oldObj[key] !== null) {
          const nestedDiff = this.getDeepDifference(oldObj[key], newObj[key]);
          if (Object.keys(nestedDiff).length > 0) {
            diff[key] = nestedDiff as T[Extract<keyof T, string>];
          }
        } else {
          diff[key] = newObj[key];
        }
      } else if (oldObj[key] !== newObj[key]) {
        diff[key] = newObj[key];
      }
    }
    
    return diff;
  }
}
