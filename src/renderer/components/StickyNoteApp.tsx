import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, RichContent, AppSettings } from '../../types';
import { NoteHeader } from './NoteHeader';
import { NoteContent } from './NoteContent';


export const StickyNoteApp: React.FC = () => {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [renderKey, setRenderKey] = useState(0);
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
          showAllHotkey: '',
          hideAllHotkey: '',
          searchHotkey: '',
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
      console.log('[DEBUG] Settings changed event received, note ID:', noteId, 'isActive:', isActive);
      // 保存が確実に完了するまで少し待ってから設定を読み込み
      setTimeout(() => {
        loadSettings();
        // 強制的に再レンダリングをトリガー
        setRenderKey(prev => prev + 1);
      }, 200);
    };

    // 一時的な設定変更プレビューをリッスン
    const handleSettingsPreview = (previewSettings: AppSettings) => {
      console.log('[DEBUG] Settings preview received, note ID:', noteId, 'isActive:', isActive, 'headerIconSize:', previewSettings.headerIconSize);
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
    
    
    // ESC２回連続検出のキーボードイベントハンドラー
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isActive && note) {
        const currentTime = Date.now();
        const timeSinceLastEsc = currentTime - lastEscPressRef.current;
        
        if (timeSinceLastEsc <= 500) {
          // 500ms以内の２回目のESC押下：非アクティブモードに切り替え
          event.preventDefault();
          setIsActive(false);
          window.electronAPI.setNoteActive(note.id, false);
          lastEscPressRef.current = 0; // リセット
        } else {
          // 初回のESC押下：タイムスタンプを記録
          lastEscPressRef.current = currentTime;
        }
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
    }
  }, [note?.backgroundColor]);

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

  const handleNoteClick = () => {
    if (!isActive && note) {
      setIsActive(true);
      // setNoteActive で状態更新も同時に行うので、updateNote は不要
      window.electronAPI.setNoteActive(note.id, true);
      
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
      blurTimeoutRef.current = setTimeout(() => {
        const isEmpty = !getContentAsString(note.content).trim();
        
        if (isEmpty) {
          window.electronAPI.deleteNote(note.id);
          return;
        }

        setIsActive(false);
        // setNoteActive で状態更新も同時に行うので、updateNote は不要
        window.electronAPI.setNoteActive(note.id, false);
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
      className={`sticky-note ${isActive ? 'active-mode' : 'stay-mode'}`}
      style={{ backgroundColor: note.backgroundColor }}
      onClick={!isActive ? handleNoteClick : undefined}
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
      />
    </div>
  );
};