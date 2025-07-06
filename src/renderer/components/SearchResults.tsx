import React from 'react';
import { SearchResult } from '../../types';

interface SearchResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  onResultClick: (result: SearchResult) => void;
  onResultHover: (index: number) => void;
  query: string;
  isSearching: boolean;
  selectedItemRef: React.RefObject<HTMLDivElement>;
}

interface HighlightedTextProps {
  result: SearchResult;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({ result }) => {
  const { highlights } = result;
  
  // コンテンツからテキストを抽出
  const extractTextContent = (content: string | any): string => {
    if (typeof content === 'string') {
      return content;
    }
    
    if (content && content.blocks && Array.isArray(content.blocks)) {
      return content.blocks
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.content || '')
        .join(' ');
    }
    
    return '';
  };

  const fullText = extractTextContent(result.note.content);
  const previewLength = 150;
  
  // プレビューテキストを作成（ハイライト部分を含む）
  let previewText = fullText;
  if (highlights.length > 0) {
    // 最初のハイライト周辺を表示
    const firstHighlight = highlights[0];
    const start = Math.max(0, firstHighlight.start - 50);
    const end = Math.min(fullText.length, firstHighlight.start + previewLength);
    previewText = fullText.substring(start, end);
    
    if (start > 0) previewText = '...' + previewText;
    if (end < fullText.length) previewText = previewText + '...';
  } else if (fullText.length > previewLength) {
    previewText = fullText.substring(0, previewLength) + '...';
  }

  if (highlights.length === 0) {
    return <span className="result-text">{previewText}</span>;
  }

  // ハイライトを適用
  const parts: { text: string; highlighted: boolean }[] = [];
  let lastIndex = 0;

  highlights.forEach(highlight => {
    // 調整されたハイライト位置（プレビューテキスト内での相対位置）
    const adjustedStart = Math.max(0, highlight.start - (fullText.length - previewText.length));
    const adjustedEnd = Math.min(previewText.length, highlight.end - (fullText.length - previewText.length));
    
    if (adjustedStart >= 0 && adjustedEnd <= previewText.length && adjustedStart < adjustedEnd) {
      // ハイライト前のテキスト
      if (adjustedStart > lastIndex) {
        parts.push({
          text: previewText.substring(lastIndex, adjustedStart),
          highlighted: false
        });
      }
      
      // ハイライト部分
      parts.push({
        text: previewText.substring(adjustedStart, adjustedEnd),
        highlighted: true
      });
      
      lastIndex = adjustedEnd;
    }
  });

  // 残りのテキスト
  if (lastIndex < previewText.length) {
    parts.push({
      text: previewText.substring(lastIndex),
      highlighted: false
    });
  }

  return (
    <span className="result-text">
      {parts.map((part, index) => (
        <span
          key={index}
          className={part.highlighted ? 'search-highlight' : ''}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
};

export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  selectedIndex,
  onResultClick,
  onResultHover,
  query,
  isSearching,
  selectedItemRef
}) => {
  if (isSearching) {
    return (
      <div className="search-results-container">
        <div className="search-loading">
          <div className="loading-spinner">🔄</div>
          <span>検索中...</span>
        </div>
      </div>
    );
  }

  if (query && results.length === 0) {
    return (
      <div className="search-results-container">
        <div className="no-results">
          <div className="no-results-icon">📭</div>
          <div className="no-results-text">
            「<strong>{query}</strong>」に一致する付箋が見つかりませんでした
          </div>
          <div className="no-results-suggestion">
            検索キーワードを変更してみてください
          </div>
        </div>
      </div>
    );
  }

  if (!query) {
    return (
      <div className="search-results-container">
        <div className="search-placeholder">
          <div className="placeholder-icon">🔍</div>
          <div className="placeholder-text">
            検索キーワードを入力して付箋を検索
          </div>
          <div className="placeholder-tips">
            <div>💡 検索のコツ:</div>
            <ul>
              <li>スペースで区切って複数キーワード検索</li>
              <li>「大文字小文字を区別」で正確な検索</li>
              <li>↑↓キーで結果を選択、Enterで開く</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="search-results-container">
      <div className="results-header">
        <span className="results-count">
          {results.length}件の結果が見つかりました
        </span>
      </div>
      
      <div className="results-list">
        {results.map((result, index) => {
          const isSelected = index === selectedIndex;
          
          return (
            <div
              key={result.note.id}
              ref={isSelected ? selectedItemRef : null}
              className={`search-result-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onResultClick(result)}
              onMouseEnter={() => onResultHover(index)}
              role="button"
              tabIndex={0}
            >
              <div className="result-header">
                <div className="note-info">
                  <div 
                    className="note-color-badge"
                    style={{ 
                      backgroundColor: result.note.backgroundColor,
                      borderColor: result.note.headerColor || result.note.backgroundColor
                    }}
                  />
                </div>
              </div>
              
              <div className="result-content">
                <HighlightedText result={result} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};