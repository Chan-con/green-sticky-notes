/**
 * データクリーンアップ・分析ツール
 * キャッシュやデータの蓄積状況を確認し、クリーンアップを実行
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export class DataCleanupManager {
  private userDataPath: string;
  private notesPath: string;

  constructor() {
    this.userDataPath = app.getPath('userData');
    this.notesPath = path.join(this.userDataPath, 'notes');
  }

  /**
   * データ使用量分析
   */
  async analyzeDataUsage(): Promise<{
    totalSize: number;
    noteFiles: number;
    orphanedFiles: number;
    cacheSize: number;
    logSize: number;
    details: any[];
  }> {
    const analysis = {
      totalSize: 0,
      noteFiles: 0,
      orphanedFiles: 0,
      cacheSize: 0,
      logSize: 0,
      details: [] as any[]
    };

    try {
      // 1. 付箋ファイルの分析
      if (fs.existsSync(this.notesPath)) {
        const noteFiles = fs.readdirSync(this.notesPath);
        for (const file of noteFiles) {
          const filePath = path.join(this.notesPath, file);
          const stats = fs.statSync(filePath);
          
          analysis.totalSize += stats.size;
          analysis.noteFiles++;
          
          analysis.details.push({
            type: 'note',
            path: filePath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          });
        }
      }

      // 2. キャッシュディレクトリの分析
      const cacheDir = path.join(this.userDataPath, 'Cache');
      if (fs.existsSync(cacheDir)) {
        analysis.cacheSize = this.calculateDirectorySize(cacheDir);
        analysis.totalSize += analysis.cacheSize;
      }

      // 3. ログファイルの分析
      const logFiles = ['logs', 'crash-reports'];
      for (const logDir of logFiles) {
        const logPath = path.join(this.userDataPath, logDir);
        if (fs.existsSync(logPath)) {
          const logSize = this.calculateDirectorySize(logPath);
          analysis.logSize += logSize;
          analysis.totalSize += logSize;
        }
      }

      // 4. 孤立ファイルの検出
      analysis.orphanedFiles = await this.detectOrphanedFiles();

    } catch (error) {
      console.error('Data analysis failed:', error);
    }

    return analysis;
  }

  /**
   * ディレクトリサイズ計算
   */
  private calculateDirectorySize(dirPath: string): number {
    let totalSize = 0;
    
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          totalSize += this.calculateDirectorySize(filePath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      console.error(`Failed to calculate size for ${dirPath}:`, error);
    }
    
    return totalSize;
  }

  /**
   * 孤立ファイルの検出
   */
  private async detectOrphanedFiles(): Promise<number> {
    let orphanedCount = 0;
    
    try {
      // 有効な付箋IDのリストを取得
      const validNoteIds = new Set<string>();
      
      // 設定から有効な付箋を特定（実際のDataStoreの実装に合わせて調整）
      if (fs.existsSync(this.notesPath)) {
        const noteFiles = fs.readdirSync(this.notesPath);
        for (const file of noteFiles) {
          if (file.endsWith('.json')) {
            try {
              const filePath = path.join(this.notesPath, file);
              const content = fs.readFileSync(filePath, 'utf-8');
              const note = JSON.parse(content);
              
              if (note.id) {
                validNoteIds.add(note.id);
              } else {
                orphanedCount++; // IDがない不正なファイル
              }
            } catch (error) {
              orphanedCount++; // パースできない破損ファイル
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Orphaned file detection failed:', error);
    }
    
    return orphanedCount;
  }

  /**
   * 安全なクリーンアップ実行
   */
  async performSafeCleanup(options: {
    clearCache?: boolean;
    clearLogs?: boolean;
    removeOrphaned?: boolean;
    olderThanDays?: number;
  } = {}): Promise<{
    success: boolean;
    freedSpace: number;
    errors: string[];
  }> {
    const result = {
      success: true,
      freedSpace: 0,
      errors: [] as string[]
    };

    try {
      // 1. 古いキャッシュの削除
      if (options.clearCache) {
        const cacheDir = path.join(this.userDataPath, 'Cache');
        if (fs.existsSync(cacheDir)) {
          const sizeBefore = this.calculateDirectorySize(cacheDir);
          await this.clearDirectory(cacheDir, options.olderThanDays);
          const sizeAfter = this.calculateDirectorySize(cacheDir);
          result.freedSpace += sizeBefore - sizeAfter;
        }
      }

      // 2. 古いログの削除
      if (options.clearLogs) {
        const logDirs = ['logs', 'crash-reports'];
        for (const logDir of logDirs) {
          const logPath = path.join(this.userDataPath, logDir);
          if (fs.existsSync(logPath)) {
            const sizeBefore = this.calculateDirectorySize(logPath);
            await this.clearDirectory(logPath, options.olderThanDays || 30);
            const sizeAfter = this.calculateDirectorySize(logPath);
            result.freedSpace += sizeBefore - sizeAfter;
          }
        }
      }

      // 3. 孤立ファイルの削除
      if (options.removeOrphaned) {
        result.freedSpace += await this.removeOrphanedFiles();
      }

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * ディレクトリの条件付きクリア
   */
  private async clearDirectory(dirPath: string, olderThanDays?: number): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    const cutoffDate = olderThanDays 
      ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
      : null;

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);

      if (cutoffDate && stats.mtime > cutoffDate) {
        continue; // 新しいファイルはスキップ
      }

      try {
        if (stats.isDirectory()) {
          await this.clearDirectory(filePath, olderThanDays);
          // ディレクトリが空になったら削除
          if (fs.readdirSync(filePath).length === 0) {
            fs.rmdirSync(filePath);
          }
        } else {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
      }
    }
  }

  /**
   * 孤立ファイルの削除
   */
  private async removeOrphanedFiles(): Promise<number> {
    let freedSpace = 0;
    
    try {
      if (!fs.existsSync(this.notesPath)) return 0;

      const files = fs.readdirSync(this.notesPath);
      for (const file of files) {
        const filePath = path.join(this.notesPath, file);
        
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const note = JSON.parse(content);
          
          // IDがない、または不正な形式の場合は削除
          if (!note.id || typeof note.id !== 'string') {
            const stats = fs.statSync(filePath);
            freedSpace += stats.size;
            fs.unlinkSync(filePath);
            console.log(`Removed orphaned file: ${file}`);
          }
        } catch (error) {
          // パースできないファイルは削除
          const stats = fs.statSync(filePath);
          freedSpace += stats.size;
          fs.unlinkSync(filePath);
          console.log(`Removed corrupted file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Failed to remove orphaned files:', error);
    }
    
    return freedSpace;
  }

  /**
   * データ使用量をフォーマット
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 詳細レポートの生成
   */
  async generateReport(): Promise<string> {
    const analysis = await this.analyzeDataUsage();
    
    let report = `
# Green Sticky Notes データ使用量レポート
生成日時: ${new Date().toLocaleString()}

## 概要
- 総データサイズ: ${this.formatBytes(analysis.totalSize)}
- 付箋ファイル数: ${analysis.noteFiles}
- 孤立ファイル数: ${analysis.orphanedFiles}
- キャッシュサイズ: ${this.formatBytes(analysis.cacheSize)}
- ログサイズ: ${this.formatBytes(analysis.logSize)}

## 詳細
`;

    // サイズの大きいファイル順にソート
    analysis.details.sort((a, b) => b.size - a.size);
    
    for (const detail of analysis.details.slice(0, 20)) { // 上位20件
      report += `- ${detail.path}: ${this.formatBytes(detail.size)} (${detail.modified.toLocaleDateString()})\n`;
    }

    return report;
  }
}
