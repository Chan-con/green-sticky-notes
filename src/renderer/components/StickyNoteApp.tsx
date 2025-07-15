import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, RichContent, AppSettings } from '../../types';
import { NoteHeader } from './NoteHeader';
import { NoteContent } from './NoteContent';


export const StickyNoteApp: React.FC = () => {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastEscPressRef = useRef<number>(0);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout>();
  const lastSaveRef = useRef<number>(0);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get('noteId');
    
    // 設定を読み込み
    const loadSettings = async () => {
      try {
        const savedSettings = await window.electronAPI.getSettings();
        setSettings(savedSettings);
      } catch (error) {
        console.error('設定の読み込みに失敗しました:', error);
        // デフォルト設定
        setSettings({
          defaultFontSize: 14,
          defaultBackgroundColor: '#CCFFE6',
          headerIconSize: 16,
          defaultInactiveWidth: 200,
          defaultInactiveHeight: 150,
          defaultInactiveFontSize: 12,
          showAllHotkey: '',
          hideAllHotkey: '',
          searchHotkey: '',
          pinHotkey: '',
          lockHotkey: '',
          autoStart: false
        });
      }
    };
    
    loadSettings();
    
    window.electronAPI.onNoteData((noteData) => {
      if (!noteId || noteData.id === noteId) {
        setNote(noteData);
        setIsActive(noteData.isActive);
      }
    });

    // 設定変更イベントをリッスン
    const handleSettingsChanged = () => {
      // 保存が確実に完了するまで少し待ってから設定を読み込み
      setTimeout(() => {
        loadSettings();
        // 強制的に再レンダリングをトリガー
        setRenderKey(prev => prev + 1);
      }, 200);
    };

    // 一時的な設定変更プレビューをリッスン
    const handleSettingsPreview = (previewSettings: AppSettings) => {
      setSettings(previewSettings);
      // 強制的に再レンダリングをトリガー
      setRenderKey(prev => prev + 1);
      
    };

    if (window.electronAPI.onSettingsChanged) {
      window.electronAPI.onSettingsChanged(handleSettingsChanged);
    }

    if (window.electronAPI.onSettingsPreview) {
      window.electronAPI.onSettingsPreview(handleSettingsPreview);
    }
    
    
    // キーボードイベントハンドラー
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC１回でアクティブモード終了（ロックされていない場合のみ）
      if (event.key === 'Escape' && isActive && note && !note.isLocked) {
        event.preventDefault();
        
        // 空の付箋は削除
        const isEmpty = !getContentAsString(note.content).trim();
        if (isEmpty) {
          window.electronAPI.deleteNote(note.id);
          return;
        }
        
        // 状態変更を同期的に実行
        setIsTransitioning(true);
        window.electronAPI.setNoteActive(note.id, false).then(() => {
          // バックエンドの状態変更完了後にUIを更新
          setIsActive(false);
          setIsTransitioning(false);
        });
        return;
      }

      // アクティブモードでのみショートカットキーを処理
      if (!isActive || !note || !settings) return;

      // キーの組み合わせを作成
      const keys = [];
      if (event.ctrlKey) keys.push('Ctrl');
      if (event.shiftKey) keys.push('Shift');
      if (event.altKey) keys.push('Alt');
      if (event.metaKey) keys.push('Meta');
      
      const mainKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        keys.push(mainKey);
      }
      
      const keyCombo = keys.join('+');

      // ピン留めショートカットキー
      if (settings.pinHotkey && keyCombo === settings.pinHotkey) {
        event.preventDefault();
        togglePin();
        return;
      }

      // ロックショートカットキー
      if (settings.lockHotkey && keyCombo === settings.lockHotkey) {
        event.preventDefault();
        const newLockedState = !note.isLocked;
        updateNoteSetting({ isLocked: newLockedState });
        return;
      }
    };
    
    // キーボードイベントリスナーを追加
    document.addEventListener('keydown', handleKeyDown);
    
    // 定期的な自動保存（5秒間隔）
    const startAutoSave = () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      autoSaveIntervalRef.current = setInterval(() => {
        if (note && Date.now() - lastSaveRef.current > 4000) {
          window.electronAPI.updateNote(note.id, { content: note.content });
          lastSaveRef.current = Date.now();
        }
      }, 5000);
    };

    // 緊急保存ハンドラー
    const emergencySave = () => {
      if (note && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        window.electronAPI.updateNote(note.id, { content: note.content });
      }
    };

    // ページの可視性変更時に保存
    const handleVisibilityChange = () => {
      if (document.hidden) {
        emergencySave();
      }
    };

    // ページアンロード前に保存
    const handleBeforeUnload = () => {
      emergencySave();
    };

    // ウィンドウフォーカス喪失時に保存
    const handleWindowBlur = () => {
      emergencySave();
    };

    // イベントリスナーを追加
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('blur', handleWindowBlur);
    
    if (note) {
      startAutoSave();
    }
    
    // クリーンアップ: タイムアウトとイベントリスナーをクリア
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isActive, note]);

  useEffect(() => {
    if (note) {
      document.body.style.backgroundColor = note.backgroundColor;
      
      // ヘッダーの色を取得（カスタム色または自動生成色）
      let headerColor = note.headerColor;
      if (!headerColor) {
        // ヘッダー色が設定されていない場合はデフォルトの半透明白
        headerColor = 'rgba(255, 255, 255, 0.3)';
      }
      
      // RGB値を抽出してアルファ値を調整した色を生成
      let scrollbarColor = headerColor;
      let scrollbarHoverColor = headerColor;
      let popupBackgroundColor = 'rgba(255, 255, 255, 0.95)';
      let popupHoverColor = 'rgba(240, 240, 240, 0.95)';
      
      // ヘッダー色がHEX形式の場合、rgba形式に変換してアルファ値を調整
      if (headerColor.startsWith('#')) {
        const r = parseInt(headerColor.slice(1, 3), 16);
        const g = parseInt(headerColor.slice(3, 5), 16);
        const b = parseInt(headerColor.slice(5, 7), 16);
        scrollbarColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
        scrollbarHoverColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
        // 白ベース + ヘッダー色を8%混ぜた背景色
        const mixedR = Math.round(255 * 0.92 + r * 0.08);
        const mixedG = Math.round(255 * 0.92 + g * 0.08);
        const mixedB = Math.round(255 * 0.92 + b * 0.08);
        popupBackgroundColor = `rgba(${mixedR}, ${mixedG}, ${mixedB}, 0.95)`;
        // ホバー時は少し濃く
        const hoverR = Math.round(240 * 0.85 + r * 0.15);
        const hoverG = Math.round(240 * 0.85 + g * 0.15);
        const hoverB = Math.round(240 * 0.85 + b * 0.15);
        popupHoverColor = `rgba(${hoverR}, ${hoverG}, ${hoverB}, 0.95)`;
      } else if (headerColor.startsWith('rgba')) {
        // すでにrgba形式の場合、アルファ値を調整
        const match = headerColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
          const [, r, g, b] = match;
          scrollbarColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
          scrollbarHoverColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
          // 白ベース + ヘッダー色を8%混ぜた背景色
          const mixedR = Math.round(255 * 0.92 + parseInt(r) * 0.08);
          const mixedG = Math.round(255 * 0.92 + parseInt(g) * 0.08);
          const mixedB = Math.round(255 * 0.92 + parseInt(b) * 0.08);
          popupBackgroundColor = `rgba(${mixedR}, ${mixedG}, ${mixedB}, 0.95)`;
          // ホバー時は少し濃く
          const hoverR = Math.round(240 * 0.85 + parseInt(r) * 0.15);
          const hoverG = Math.round(240 * 0.85 + parseInt(g) * 0.15);
          const hoverB = Math.round(240 * 0.85 + parseInt(b) * 0.15);
          popupHoverColor = `rgba(${hoverR}, ${hoverG}, ${hoverB}, 0.95)`;
        }
      }
      
      // 既存のスタイルタグがあれば削除
      const existingStyle = document.getElementById('scrollbar-style');
      if (existingStyle) {
        existingStyle.remove();
      }
      
      // 新しいスタイルタグを追加
      const style = document.createElement('style');
      style.id = 'scrollbar-style';
      style.textContent = `
        .note-content {
          scrollbar-gutter: stable;
        }
        .note-content::-webkit-scrollbar {
          width: 6px;
          position: absolute;
        }
        .note-content::-webkit-scrollbar-thumb {
          background: ${scrollbarColor} !important;
        }
        .note-content::-webkit-scrollbar-thumb:hover {
          background: ${scrollbarHoverColor} !important;
        }
        .font-size-popup::-webkit-scrollbar-thumb {
          background: ${scrollbarColor} !important;
        }
        .font-size-popup::-webkit-scrollbar-thumb:hover {
          background: ${scrollbarHoverColor} !important;
        }
        .color-picker-popup {
          background: ${popupBackgroundColor} !important;
          border: 1px solid ${headerColor || 'rgba(255, 255, 255, 0.3)'} !important;
        }
        .color-picker-popup::-webkit-scrollbar {
          width: 6px;
        }
        .color-picker-popup::-webkit-scrollbar-track {
          background: transparent;
        }
        .color-picker-popup::-webkit-scrollbar-thumb {
          background: ${scrollbarColor} !important;
          border-radius: 3px;
        }
        .color-picker-popup::-webkit-scrollbar-thumb:hover {
          background: ${scrollbarHoverColor} !important;
        }
        .font-size-popup {
          background: ${popupBackgroundColor} !important;
          border: 1px solid ${headerColor || 'rgba(255, 255, 255, 0.3)'} !important;
        }
        .font-size-option.selected,
        .font-size-option:hover {
          background: ${popupHoverColor} !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, [note?.backgroundColor, note?.headerColor]);

  const updateNoteContent = (content: string) => {
    if (!note) return;

    setNote(prev => prev ? { ...prev, content } : null);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      window.electronAPI.updateNote(note.id, { content });
      lastSaveRef.current = Date.now();
    }, 100);
  };

  const updateNoteSetting = async (updates: Partial<StickyNote>) => {
    if (!note) return;

    setNote(prev => prev ? { ...prev, ...updates } : null);
    await window.electronAPI.updateNote(note.id, updates);
  };

  const handleNoteClick = async () => {
    if (!isActive && note && !isTransitioning) {
      setIsTransitioning(true);
      await window.electronAPI.setNoteActive(note.id, true);
      setIsActive(true);
      setIsTransitioning(false);
      
      setTimeout(() => {
        contentRef.current?.focus();
      }, 100);
    }
  };

  const getContentAsString = (content: string | RichContent): string => {
    if (typeof content === 'string') {
      return content;
    }
    return content.blocks
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('\n');
  };

  // ブラーイベントのデバウンス用のタイムアウト
  const blurTimeoutRef = useRef<NodeJS.Timeout>();

  const handleBlur = () => {
    if (isActive && note && !note.isLocked) {
      // 既存のタイムアウトをクリア
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      
      // デバウンスでブラー処理を実行
      blurTimeoutRef.current = setTimeout(async () => {
        const isEmpty = !getContentAsString(note.content).trim();
        
        if (isEmpty) {
          window.electronAPI.deleteNote(note.id);
          return;
        }

        // 状態変更を同期的に実行
        setIsTransitioning(true);
        await window.electronAPI.setNoteActive(note.id, false);
        // バックエンドの状態変更完了後にUIを更新
        setIsActive(false);
        setIsTransitioning(false);
      }, 150); // ブラーイベントのデバウンス
    }
  };

  const createNewNote = async () => {
    if (note) {
      await window.electronAPI.createNote(note.id);
    }
  };


  const togglePin = async () => {
    if (!note) return;
    
    const newPinState = !note.isPinned;
    await updateNoteSetting({ isPinned: newPinState });
    await window.electronAPI.setNotePin(note.id, newPinState);
  };

  const toggleLock = async () => {
    if (!note) return;
    
    const newLockState = !note.isLocked;
    await updateNoteSetting({ isLocked: newLockState });
  };

  if (!note) {
    return <div>Loading...</div>;
  }

  return (
    <div 
      className={`sticky-note ${isActive ? 'active-mode' : 'stay-mode'} ${isTransitioning ? 'transitioning' : ''}`}
      style={{ backgroundColor: note.backgroundColor }}
      onClick={!isActive && !isTransitioning ? handleNoteClick : undefined}
    >
      <NoteHeader
        key={`header-${renderKey}-${isActive ? 'active' : 'inactive'}-${settings?.headerIconSize ?? 16}`}
        note={note}
        isActive={isActive}
        headerIconSize={settings?.headerIconSize ?? 16}
        onUpdateNote={updateNoteSetting}
        onCreateNote={createNewNote}
        onTogglePin={togglePin}
        onToggleLock={toggleLock}
      />
      {/* デバッグ情報 */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{fontSize: '10px', color: 'red', position: 'absolute', top: '0', right: '0', background: 'white', padding: '2px'}}>
          RenderKey: {renderKey}, IconSize: {settings?.headerIconSize ?? 16}
        </div>
      )}
      
      <NoteContent
        note={note}
        isActive={isActive}
        ref={contentRef}
        onContentChange={updateNoteContent}
        onBlur={handleBlur}
        inactiveFontSize={settings?.defaultInactiveFontSize ?? 12}
      />
    </div>
  );
};