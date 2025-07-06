import { StickyNote, SearchIndex, SearchQuery, SearchResult, SearchHighlight } from '../types';

export class SearchService {
  private searchIndex: Map<string, SearchIndex> = new Map();
  private initialized = false;

  constructor() {
    // Empty constructor - initialization is done via initialize method
  }

  async initialize(notes: StickyNote[]): Promise<void> {
    this.buildSearchIndex(notes);
    this.initialized = true;
    if (process.env.NODE_ENV === 'development') {
      console.log(`Search service initialized with ${this.searchIndex.size} indexed notes`);
    }
  }

  private buildSearchIndex(notes: StickyNote[]): void {
    this.searchIndex.clear();
    
    notes.forEach(note => {
      const index = this.createSearchIndex(note);
      this.searchIndex.set(note.id, index);
    });
  }

  private createSearchIndex(note: StickyNote): SearchIndex {
    const content = this.extractTextContent(note.content);
    const searchText = this.normalizeForSearch(content);
    const previewText = this.createPreviewText(content);

    return {
      noteId: note.id,
      searchText,
      previewText,
      updatedAt: note.updatedAt,
      createdAt: note.createdAt
    };
  }

  private extractTextContent(content: string | any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    // RichContent形式の場合
    if (content && content.blocks && Array.isArray(content.blocks)) {
      return content.blocks
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.content || '')
        .join(' ');
    }
    
    return '';
  }

  private normalizeForSearch(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private createPreviewText(content: string, maxLength: number = 100): string {
    const text = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  updateNoteInIndex(note: StickyNote): void {
    if (!this.initialized) return;
    
    const index = this.createSearchIndex(note);
    this.searchIndex.set(note.id, index);
  }

  removeNoteFromIndex(noteId: string): void {
    this.searchIndex.delete(noteId);
  }

  search(query: SearchQuery, notes: StickyNote[]): SearchResult[] {
    if (!this.initialized || !query.text.trim()) {
      return [];
    }

    const normalizedQuery = this.normalizeForSearch(query.text);
    const keywords = query.keywords.length > 0 ? 
      query.keywords.map(k => this.normalizeForSearch(k)) : 
      [normalizedQuery];

    const results: SearchResult[] = [];
    const maxResults = query.maxResults || 50;

    // 各ノートに対して検索を実行
    notes.forEach(note => {
      const searchIndex = this.searchIndex.get(note.id);
      if (!searchIndex) return;

      const searchResult = this.searchInNote(note, searchIndex, keywords, query.caseSensitive || false);
      if (searchResult) {
        results.push(searchResult);
      }
    });

    // 関連度スコアでソート（降順）
    results.sort((a, b) => b.relevance - a.relevance);

    // 最大結果数に制限
    return results.slice(0, maxResults);
  }

  private searchInNote(
    note: StickyNote, 
    searchIndex: SearchIndex, 
    keywords: string[], 
    caseSensitive: boolean
  ): SearchResult | null {
    const searchText = caseSensitive ? 
      this.extractTextContent(note.content) : 
      searchIndex.searchText;
    
    const highlights: SearchHighlight[] = [];
    let totalMatches = 0;
    let relevanceScore = 0;

    // 各キーワードについて検索
    keywords.forEach(keyword => {
      const targetKeyword = caseSensitive ? keyword : keyword.toLowerCase();
      const targetText = caseSensitive ? searchText : searchText.toLowerCase();
      
      const matches = this.findMatches(targetText, targetKeyword);
      totalMatches += matches.length;
      
      // ハイライト位置を計算（大文字小文字を考慮して元のテキストでの位置を計算）
      if (!caseSensitive && matches.length > 0) {
        const originalText = this.extractTextContent(note.content);
        matches.forEach(match => {
          const actualHighlight = this.findActualHighlightPosition(originalText, keyword, match.start);
          if (actualHighlight) {
            highlights.push(actualHighlight);
          }
        });
      } else {
        highlights.push(...matches);
      }

      // 関連度スコアの計算
      relevanceScore += this.calculateKeywordRelevance(matches, keyword, searchText);
    });

    if (totalMatches === 0) {
      return null;
    }

    // 最終的な関連度スコア（0-1の範囲に正規化）
    const finalRelevance = Math.min(relevanceScore / keywords.length, 1);

    return {
      note,
      relevance: finalRelevance,
      highlights: this.mergeOverlappingHighlights(highlights),
      matchCount: totalMatches
    };
  }

  private findMatches(text: string, keyword: string): SearchHighlight[] {
    const matches: SearchHighlight[] = [];
    let startIndex = 0;

    while (true) {
      const index = text.indexOf(keyword, startIndex);
      if (index === -1) break;

      matches.push({
        start: index,
        end: index + keyword.length
      });

      startIndex = index + 1;
    }

    return matches;
  }

  private findActualHighlightPosition(originalText: string, keyword: string, approximateStart: number): SearchHighlight | null {
    // 大文字小文字を無視して実際の位置を見つける
    const lowerOriginal = originalText.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    
    // 近似位置の前後を検索
    const searchStart = Math.max(0, approximateStart - 10);
    const searchEnd = Math.min(lowerOriginal.length, approximateStart + keyword.length + 10);
    const searchArea = lowerOriginal.substring(searchStart, searchEnd);
    
    const relativeIndex = searchArea.indexOf(lowerKeyword);
    if (relativeIndex === -1) {
      // フォールバック：最初に見つかる位置を使用
      const globalIndex = lowerOriginal.indexOf(lowerKeyword);
      if (globalIndex !== -1) {
        return {
          start: globalIndex,
          end: globalIndex + keyword.length
        };
      }
      return null;
    }

    const actualStart = searchStart + relativeIndex;
    return {
      start: actualStart,
      end: actualStart + keyword.length
    };
  }

  private calculateKeywordRelevance(matches: SearchHighlight[], keyword: string, text: string): number {
    if (matches.length === 0) return 0;

    const keywordLength = keyword.length;
    const textLength = text.length;
    
    // 基本スコア（マッチ数に基づく）
    let score = matches.length * 0.1;
    
    // キーワードの長さに基づくボーナス（長いキーワードほど高スコア）
    score += (keywordLength / 10) * 0.3;
    
    // テキストの長さに対する相対的な重要度
    const density = (matches.length * keywordLength) / textLength;
    score += density * 0.6;
    
    return Math.min(score, 1.0);
  }

  private mergeOverlappingHighlights(highlights: SearchHighlight[]): SearchHighlight[] {
    if (highlights.length === 0) return [];

    // 開始位置でソート
    const sorted = highlights.sort((a, b) => a.start - b.start);
    const merged: SearchHighlight[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // 重複または隣接している場合はマージ
      if (current.start <= last.end + 1) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  rebuildIndex(notes: StickyNote[]): void {
    this.buildSearchIndex(notes);
    if (process.env.NODE_ENV === 'development') {
      console.log(`Search index rebuilt with ${this.searchIndex.size} notes`);
    }
  }

  getIndexStats(): { totalNotes: number; indexSize: number } {
    return {
      totalNotes: this.searchIndex.size,
      indexSize: this.searchIndex.size // シンプルな実装では同じ
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}