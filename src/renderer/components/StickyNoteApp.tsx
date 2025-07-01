import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, RichContent } from '../../types';
import { NoteHeader } from './NoteHeader';
import { NoteContent } from './NoteContent';

declare global {
  interface Window {
    electronAPI: {
      onNoteData: (callback: (note: StickyNote) => void) => void;
      createNote: (nearNoteId?: string) => Promise<StickyNote>;
      updateNote: (noteId: string, updates: Partial<StickyNote>) => Promise<boolean>;
      deleteNote: (noteId: string) => Promise<boolean>;
      setNoteActive: (noteId: string, isActive: boolean) => Promise<void>;
      setNotePin: (noteId: string, isPinned: boolean) => Promise<void>;
      getDisplays: () => Promise<any[]>;
    };
  }
}

export const StickyNoteApp: React.FC = () => {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [isActive, setIsActive] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastEscPressRef = useRef<number>(0);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get('noteId');
    
    window.electronAPI.onNoteData((noteData) => {
      if (!noteId || noteData.id === noteId) {
        setNote(noteData);
        setIsActive(noteData.isActive);
      }
    });
    
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
    
    // クリーンアップ: タイムアウトとイベントリスナーをクリア
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      document.removeEventListener('keydown', handleKeyDown);
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
    }, 300);
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
        note={note}
        isActive={isActive}
        onUpdateNote={updateNoteSetting}
        onCreateNote={createNewNote}
        onTogglePin={togglePin}
        onToggleLock={toggleLock}
      />
      
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