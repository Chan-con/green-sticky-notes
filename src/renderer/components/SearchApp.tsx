import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SearchResult, SearchQuery } from '../../types';
import { SearchResults } from './SearchResults';

interface SearchAppState {
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  selectedIndex: number;
  caseSensitive: boolean;
  maxResults: number;
}

export const SearchApp: React.FC = () => {
  const [state, setState] = useState<SearchAppState>({
    query: '',
    results: [],
    isSearching: false,
    selectedIndex: -1,
    caseSensitive: false,
    maxResults: 50
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const selectedItemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 初期フォーカス
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // 選択アイテムのスクロール追従
  useEffect(() => {
    if (selectedItemRef.current && state.selectedIndex >= 0) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [state.selectedIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 検索ウィンドウがアクティブな間はホットキー競合を避けるため、
      // 主要なキーイベントをキャプチャしてpreventDefaultを呼ぶ
      const shouldPreventDefault = (
        event.key === 'Escape' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        (event.ctrlKey && (event.key === 'k' || event.key === 'K')) ||
        (event.ctrlKey && event.shiftKey) ||
        (event.altKey && (event.key === 'Tab' || event.key.length === 1))
      );

      if (shouldPreventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }

      switch (event.key) {
        case 'Escape':
          if (state.query) {
            // 検索をクリア
            setState(prev => ({ ...prev, query: '', results: [], selectedIndex: -1 }));
            if (searchInputRef.current) {
              searchInputRef.current.focus();
            }
          } else {
            // ウィンドウを閉じる
            handleClose();
          }
          break;
        case 'ArrowDown':
          setState(prev => ({
            ...prev,
            selectedIndex: Math.min(prev.selectedIndex + 1, prev.results.length - 1)
          }));
          break;
        case 'ArrowUp':
          setState(prev => ({
            ...prev,
            selectedIndex: Math.max(prev.selectedIndex - 1, -1)
          }));
          break;
        case 'Enter':
          if (state.selectedIndex >= 0 && state.results[state.selectedIndex]) {
            openNote(state.results[state.selectedIndex]);
          }
          break;
      }
    };

    // より高い優先度でイベントをキャプチャ
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [state.query, state.results, state.selectedIndex]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setState(prev => ({ ...prev, results: [], selectedIndex: -1 }));
      return;
    }

    setState(prev => ({ ...prev, isSearching: true }));

    try {
      const query: SearchQuery = {
        text: searchQuery,
        keywords: searchQuery.split(/\s+/).filter(k => k.length > 0),
        caseSensitive: state.caseSensitive,
        maxResults: state.maxResults
      };

      const results = await window.electronAPI.searchNotes(query);
      setState(prev => ({
        ...prev,
        results,
        isSearching: false,
        selectedIndex: results.length > 0 ? 0 : -1
      }));
    } catch (error) {
      console.error('検索エラー:', error);
      setState(prev => ({
        ...prev,
        results: [],
        isSearching: false,
        selectedIndex: -1
      }));
    }
  }, [state.caseSensitive, state.maxResults]);

  const handleSearchInput = (value: string) => {
    setState(prev => ({ ...prev, query: value }));

    // デバウンス検索
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(value);
    }, 300);
  };

  const openNote = async (result: SearchResult) => {
    try {
      const success = await window.electronAPI.openNoteById(result.note.id);
      if (success) {
        handleClose();
      }
    } catch (error) {
      console.error('ノートを開けませんでした:', error);
    }
  };

  const handleClose = () => {
    if (window.electronAPI.closeSearch) {
      window.electronAPI.closeSearch();
    }
  };

  const toggleCaseSensitive = () => {
    setState(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }));
    if (state.query) {
      performSearch(state.query);
    }
  };



  return (
    <div className="search-window">
      <div className="search-header">
        <div className="search-title">🔍 付箋検索</div>
      </div>
      
      <div className="search-input-container">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="検索キーワードを入力..."
          value={state.query}
          onChange={(e) => handleSearchInput(e.target.value)}
          className="search-input"
        />
        {state.isSearching && <div className="search-spinner">🔄</div>}
      </div>

      <div className="search-options">
        <label className="option-checkbox">
          <input
            type="checkbox"
            checked={state.caseSensitive}
            onChange={toggleCaseSensitive}
          />
          大文字小文字を区別
        </label>
        <div className="results-count">
          {state.results.length > 0 && (
            <span>{state.results.length}件の結果</span>
          )}
        </div>
      </div>

      <SearchResults
        results={state.results}
        selectedIndex={state.selectedIndex}
        onResultClick={openNote}
        onResultHover={(index) => setState(prev => ({ ...prev, selectedIndex: index }))}
        query={state.query}
        isSearching={state.isSearching}
        selectedItemRef={selectedItemRef}
      />

      <div className="search-footer">
        <div className="shortcuts-help">
          <span>↑↓: 選択</span>
          <span>Enter: 開く</span>
          <span>Esc: 閉じる</span>
        </div>
      </div>
    </div>
  );
};

