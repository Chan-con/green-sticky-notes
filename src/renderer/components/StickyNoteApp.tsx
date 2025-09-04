import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { StickyNote, RichContent, AppSettings } from '../../types';
import { NoteHeader } from './NoteHeader';
import { NoteContent } from './NoteContent';


export const StickyNoteApp: React.FC = memo(() => {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastEscPressRef = useRef<number>(0);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout>();
  const lastSaveRef = useRef<number>(0);
  const isSavingRef = useRef<boolean>(false); // 保存中状態を追跡

  // 再読み込み機能
  const handleReload = useCallback(async () => {
    console.log('[DEBUG] Manual reload requested');
    setLoadingError(null);
    setIsLoading(true);
    
    try {
      // URLからnoteIdを取得
      const urlParams = new URLSearchParams(window.location.search);
      const noteId = urlParams.get('noteId');
      
      if (noteId) {
        // メインプロセス経由でノートデータを再取得
        const result = await window.electronAPI.reloadNote(noteId);
        if (!result.success) {
          setLoadingError('再読み込みできませんでした');
          setIsLoading(false);
        }
        // 成功時はonNoteDataコールバックで自動的に状態が更新される
      } else {
        // noteIdがない場合は単純にページをリロード
        window.location.reload();
      }
    } catch (error) {
      console.error('[ERROR] Reload failed:', error);
      setLoadingError('再読み込みできませんでした');
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const noteId = urlParams.get('noteId');
    
    // タイムアウト設定（5秒でエラー表示）
    const loadingTimeout = setTimeout(() => {
      if (!note) {
        setLoadingError('読み込みに時間がかかっています');
        setIsLoading(false);
      }
    }, 5000);
    
    // 設定を読み込み
    const loadSettings = async () => {
      try {
        const savedSettings = await window.electronAPI.getSettings();
        if (process.env.NODE_ENV === 'development') {
          console.log('[DEBUG] Settings loaded successfully:', savedSettings);
          console.log('[DEBUG] Inactive font size setting:', savedSettings?.defaultInactiveFontSize);
        }
        setSettings(savedSettings);
      } catch (error) {
        console.error('[ERROR] Failed to load settings:', error);
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
        setIsLoading(false);
        clearTimeout(loadingTimeout);
        
        // 非アクティブ状態で空の付箋を自動削除
        if (!noteData.isActive) {
          const isEmpty = isReallyEmpty(noteData.content);
          
          console.log('[DEBUG] Checking empty note deletion:', {
            id: noteData.id,
            isNewlyCreated: noteData.isNewlyCreated,
            contentType: typeof noteData.content,
            contentString: JSON.stringify(getContentAsString(noteData.content)),
            isEmpty: isEmpty
          });
          
          // 新規作成された付箋は削除しない（ユーザーがまだ入力していない可能性があるため）
          if (noteData.isNewlyCreated) {
            console.log('[DEBUG] Skipping deletion - note is newly created');
            return;
          }
          
          if (isEmpty) {
            console.log('[DEBUG] Auto-deleting empty inactive note:', noteData.id);
            // 削除前にすべてのタイマーとイベントリスナーをクリア
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = undefined;
            }
            if (autoSaveIntervalRef.current) {
              clearInterval(autoSaveIntervalRef.current);
              autoSaveIntervalRef.current = undefined;
            }
            if (blurTimeoutRef.current) {
              clearTimeout(blurTimeoutRef.current);
              blurTimeoutRef.current = undefined;
            }
            // ノート削除実行
            window.electronAPI.deleteNote(noteData.id);
            // このウィンドウを閉じる（削除されたノートなので表示する必要なし）
            window.close();
            return;
          }
        }
      }
    });

    // アプリ終了時の緊急保存要求をリッスン
    const handleEmergencySaveRequest = async () => {
      console.log('[SAVE] Emergency save requested by main process');
      try {
        await emergencySave();
        console.log('[SAVE] Emergency save completed successfully');
      } catch (error) {
        console.error('[SAVE] Emergency save failed:', error);
      }
    };

    // IPC イベントリスナーの設定
    window.electronAPI.onEmergencySaveRequest(handleEmergencySaveRequest);

    // set-active イベントもリッスンして、より確実に状態を更新
    window.electronAPI.onSetActive((activeState) => {
      console.log(`[DEBUG] Received set-active event: ${activeState}`);
      setIsActive(activeState);
      
      // 状態変更時にUIを完全に同期
      setIsTransitioning(true);
      
      // 強制再レンダリングと状態リセット
      setRenderKey(prev => prev + 1);
      
      // アクティブ化された場合にエディタにフォーカスを設定
      if (activeState) {
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.focus();
            // カーソルを末尾に移動
            const textLength = contentRef.current.value.length;
            contentRef.current.setSelectionRange(textLength, textLength);
          }
        }, 150); // UI更新完了後にフォーカス
      }
      
      // 短時間後にトランジション状態をクリア
      setTimeout(() => {
        setIsTransitioning(false);
      }, 100);
      
      // ノートデータが存在する場合は、isActiveプロパティも更新
      if (note) {
        setNote(prevNote => prevNote ? { ...prevNote, isActive: activeState } : null);
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
      // デバッグ: すべてのキーイベントをログ出力（開発モードのみ）
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Key pressed:', {
          key: event.key,
          code: event.code,
          isActive: isActive,
          hasNote: !!note,
          isLocked: note?.isLocked,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey
        });
      }

      // ESC１回でアクティブモード終了（ロックされていない場合のみ）
      if (event.key === 'Escape' && isActive && note && !note.isLocked) {
        event.preventDefault();
        console.log('[DEBUG] ESC key detected - processing deactivation');
        
        // 空の付箋は削除
        const isEmpty = isReallyEmpty(note.content);
        
        console.log('[DEBUG] ESC key - checking empty note deletion:', {
          id: note.id,
          isEmpty: isEmpty
        });

        if (isEmpty) {
          console.log('[DEBUG] Deleting empty note on ESC');
          
          // すべてのタイマーをクリア
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = undefined;
          }
          if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
            autoSaveIntervalRef.current = undefined;
          }
          
          window.electronAPI.deleteNote(note.id);
          
          // 少し待ってからウィンドウを閉じる
          setTimeout(() => {
            window.close();
          }, 100);
          
          return;
        }

        // 状態変更を同期的に実行
        setIsTransitioning(true);
        window.electronAPI.setNoteActive(note.id, false)
          .then(() => {
            // バックエンドの状態変更完了後にUIを更新
            setIsActive(false);
            setIsTransitioning(false);
            console.log('[DEBUG] ESC key deactivation completed successfully');
          })
          .catch((error) => {
            console.error('[ERROR] Failed to deactivate note on ESC:', error);
            // 付箋が存在しない場合は、ウィンドウを閉じる
            if (error instanceof Error && error.message.includes('does not exist')) {
              console.log('[DEBUG] Note no longer exists during ESC, closing window');
              window.close();
            }
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
    
    // 定期的な自動保存（15秒間隔、保存状態追跡付き）
    const startAutoSave = () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      autoSaveIntervalRef.current = setInterval(async () => {
        if (note && Date.now() - lastSaveRef.current > 10000 && !isSavingRef.current) { // 10秒以上経過かつ保存中でない場合のみ
          try {
            isSavingRef.current = true;
            console.log('[SAVE] Auto-save starting...');
            await window.electronAPI.updateNote(note.id, { content: note.content });
            lastSaveRef.current = Date.now();
            console.log('[SAVE] Auto-save completed successfully');
          } catch (error) {
            // 削除されたノートの場合は自動保存を停止
            if (error instanceof Error && error.message.includes('note does not exist')) {
              console.log('[SAVE] Auto-save stopped - note was deleted');
              if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
                autoSaveIntervalRef.current = undefined;
              }
              return;
            }
            console.error('[SAVE] Auto-save failed:', error);
          } finally {
            isSavingRef.current = false;
          }
        }
      }, 15000); // 15秒間隔
    };

    // 緊急保存ハンドラー（保存状態追跡付き）
    const emergencySave = async () => {
      if (note) {
        // 既に保存中の場合は少し待つ
        if (isSavingRef.current) {
          console.log('[SAVE] Waiting for ongoing save to complete...');
          let attempts = 0;
          while (isSavingRef.current && attempts < 20) { // 最大2秒待機
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }
        }

        // タイマーの有無に関係なく最新の状態を保存
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        
        try {
          isSavingRef.current = true;
          console.log('[SAVE] Emergency save starting...');
          await window.electronAPI.updateNote(note.id, { content: note.content });
          lastSaveRef.current = Date.now();
          console.log('[SAVE] Emergency save completed successfully');
        } catch (error) {
          // 削除されたノートの場合は保存を停止
          if (error instanceof Error && error.message.includes('note does not exist')) {
            console.log('[SAVE] Emergency save skipped - note was deleted');
            return;
          }
          
          console.error('[SAVE] Emergency save failed:', error);
          // 緊急時は複数回試行
          for (let i = 0; i < 3; i++) {
            try {
              await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
              await window.electronAPI.updateNote(note.id, { content: note.content });
              console.log(`[SAVE] Emergency save succeeded on attempt ${i + 2}`);
              lastSaveRef.current = Date.now();
              break;
            } catch (retryError) {
              // 削除されたノートの場合は再試行も停止
              if (retryError instanceof Error && retryError.message.includes('note does not exist')) {
                console.log('[SAVE] Emergency save retry skipped - note was deleted');
                return;
              }
              console.error(`[SAVE] Emergency save attempt ${i + 2} failed:`, retryError);
            }
          }
        } finally {
          isSavingRef.current = false;
        }
      }
    };

    // ページの可視性変更時に保存
    const handleVisibilityChange = () => {
      if (document.hidden) {
        emergencySave();
      }
    };

    // ページアンロード前に保存（同期的に待機）
    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      e.preventDefault();
      try {
        await emergencySave();
        console.log('Emergency save completed before unload');
      } catch (error) {
        console.error('Emergency save failed before unload:', error);
        // 保存失敗でもユーザーに確認を求める
        e.returnValue = '未保存の変更があります。本当にページを離れますか？';
        return '未保存の変更があります。本当にページを離れますか？';
      }
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
      clearTimeout(loadingTimeout);
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

  const updateNoteContent = async (content: string) => {
    if (!note) {
      console.log('[DEBUG] updateNoteContent: note is null, skipping update');
      return;
    }

    setNote(prev => prev ? { ...prev, content } : null);

    // タイマーをクリア
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    try {
      // 即座に保存して競合状態を回避（contentは文字列なのでサニタイズ不要）
      await window.electronAPI.updateNote(note.id, { content });
      lastSaveRef.current = Date.now();
    } catch (error) {
      console.error('Failed to save note content:', error);
      
      // 付箋が存在しない場合は、ウィンドウを閉じる
      if (error instanceof Error && error.message.includes('does not exist')) {
        console.log('[DEBUG] Note no longer exists during content update, closing window');
        window.close();
        return;
      }
      
      // エラー時は再試行タイマーを設定
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await window.electronAPI.updateNote(note.id, { content });
          lastSaveRef.current = Date.now();
          console.log('Retry save successful');
        } catch (retryError) {
          console.error('Retry save also failed:', retryError);
          // 再試行でも失敗し、付箋が存在しない場合はウィンドウを閉じる
          if (retryError instanceof Error && retryError.message.includes('does not exist')) {
            console.log('[DEBUG] Note no longer exists during retry, closing window');
            window.close();
          }
        }
      }, 1000);
    }
  };

  const updateNoteSetting = async (updates: Partial<StickyNote>) => {
    if (!note) {
      console.log('[DEBUG] updateNoteSetting: note is null, skipping update');
      return;
    }

    // 付箋が削除されていないかチェック
    try {
      setNote(prev => prev ? { ...prev, ...updates } : null);
      await window.electronAPI.updateNote(note.id, updates);
    } catch (error) {
      console.error('[ERROR] Failed to update note:', error);
      // 付箋が存在しない場合は、ウィンドウを閉じる
      if (error instanceof Error && error.message.includes('does not exist')) {
        console.log('[DEBUG] Note no longer exists, closing window');
        window.close();
      }
    }
  };

  const handleNoteClick = async () => {
    if (!isActive && note && !isTransitioning) {
      setIsTransitioning(true);
      try {
        // 付箋をアクティブ化（他の付箋は自動的に非アクティブ化される）
        await window.electronAPI.setNoteActive(note.id, true);
        setIsActive(true);
        
        // 強制的に再レンダリングしてUI状態を同期
        setRenderKey(prev => prev + 1);
        
        setTimeout(() => {
          contentRef.current?.focus();
        }, 100);
      } catch (error) {
        console.error('Failed to activate note:', error);
        // 付箋が存在しない場合は、ウィンドウを閉じる
        if (error instanceof Error && error.message.includes('does not exist')) {
          console.log('[DEBUG] Note no longer exists during activation, closing window');
          window.close();
        }
      } finally {
        setIsTransitioning(false);
      }
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

  // 確実な空判定関数
  const isReallyEmpty = (content: string | RichContent): boolean => {
    if (!content) return true;
    
    let textContent = '';
    if (typeof content === 'string') {
      textContent = content;
    } else {
      textContent = content.blocks
        .filter(block => block.type === 'text')
        .map(block => block.content || '')
        .join('');
    }
    
    // HTMLタグを完全に除去し、エンティティもデコード
    const cleanText = textContent
      .replace(/<[^>]*>/g, '')  // HTMLタグ除去
      .replace(/&nbsp;/g, ' ')  // &nbsp;を空白に
      .replace(/&amp;/g, '&')   // エンティティをデコード
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    
    const isEmpty = cleanText.length === 0;
    console.log(`[DEBUG] isReallyEmpty - original: "${textContent}", clean: "${cleanText}", isEmpty: ${isEmpty}`);
    return isEmpty;
  };

  // ブラーイベントのデバウンス用のタイムアウト
  const blurTimeoutRef = useRef<NodeJS.Timeout>();

  const handleBlur = useCallback(() => {
    if (isActive && note && !note.isLocked) {
      // 既存のタイムアウトをクリア
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      
      // デバウンスでブラー処理を実行
      blurTimeoutRef.current = setTimeout(async () => {
        if (!note) {
          console.log('[DEBUG] Blur event: note is null, skipping');
          return;
        }
        
        const isEmpty = isReallyEmpty(note.content);
        
        console.log('[DEBUG] Blur event - checking empty note deletion:', {
          id: note.id,
          isEmpty: isEmpty
        });

        if (isEmpty) {
          console.log('[DEBUG] Deleting empty note on blur');
          
          // すべてのタイマーをクリア
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = undefined;
          }
          if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
            autoSaveIntervalRef.current = undefined;
          }
          
          window.electronAPI.deleteNote(note.id);
          
          // 少し待ってからウィンドウを閉じる
          setTimeout(() => {
            window.close();
          }, 100);
          
          return;
        }

        try {
          // 状態変更を同期的に実行
          setIsTransitioning(true);
          await window.electronAPI.setNoteActive(note.id, false);
          // バックエンドの状態変更完了後にUIを更新
          setIsActive(false);
          setIsTransitioning(false);
        } catch (error) {
          console.error('[ERROR] Failed to deactivate note:', error);
          // 付箋が存在しない場合は、ウィンドウを閉じる
          if (error instanceof Error && error.message.includes('does not exist')) {
            console.log('[DEBUG] Note no longer exists during blur, closing window');
            window.close();
          }
          setIsTransitioning(false);
        }
      }, 150); // ブラーイベントのデバウンス
    }
  }, [isActive, note]);

  const [isCreatingNote, setIsCreatingNote] = useState(false);

  const createNewNote = async () => {
    if (note && !isCreatingNote) {
      setIsCreatingNote(true);
      try {
        await window.electronAPI.createNote(note.id);
      } catch (error) {
        console.error('Failed to create new note:', error);
      } finally {
        // 500ms後にフラグをリセット（重複作成を防ぐ）
        setTimeout(() => {
          setIsCreatingNote(false);
        }, 500);
      }
    }
  };


  const togglePin = async () => {
    if (!note) return;
    
    try {
      const newPinState = !note.isPinned;
      await updateNoteSetting({ isPinned: newPinState });
      await window.electronAPI.setNotePin(note.id, newPinState);
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      // 付箋が存在しない場合は、ウィンドウを閉じる
      if (error instanceof Error && error.message.includes('does not exist')) {
        console.log('[DEBUG] Note no longer exists during pin toggle, closing window');
        window.close();
      }
    }
  };

  const toggleLock = async () => {
    if (!note) return;
    
    try {
      const newLockState = !note.isLocked;
      await updateNoteSetting({ isLocked: newLockState });
    } catch (error) {
      console.error('Failed to toggle lock:', error);
      // 付箋が存在しない場合は、ウィンドウを閉じる
      if (error instanceof Error && error.message.includes('does not exist')) {
        console.log('[DEBUG] Note no longer exists during lock toggle, closing window');
        window.close();
      }
    }
  };

  if (loadingError) {
    return (
      <div 
        onClick={handleReload}
        style={{ 
          padding: '20px', 
          backgroundColor: '#ffebee', 
          border: '1px solid #f44336',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#d32f2f',
          maxWidth: '250px',
          wordBreak: 'break-word',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#ffcdd2';
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '#ffebee';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }}
        title="クリックして再読み込み"
      >
        <div style={{ 
          fontWeight: 'bold', 
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          📄 付箋を読み込めません
        </div>
        <div style={{ marginBottom: '12px', lineHeight: '1.4' }}>{loadingError}</div>
        <div style={{ 
          fontSize: '11px', 
          opacity: 0.9, 
          fontWeight: 'bold',
          textAlign: 'center',
          marginTop: '8px',
          borderTop: '1px solid rgba(244, 67, 54, 0.3)',
          paddingTop: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px'
        }}>
          � クリックして再読み込み
        </div>
      </div>
    );
  }

  if (!note || isLoading) {
    return (
      <div style={{ 
        padding: '20px', 
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#666',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px'
      }}>
        <div style={{
          width: '20px',
          height: '20px',
          border: '2px solid #ddd',
          borderTop: '2px solid #666',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <div>読み込み中...</div>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
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
      
      <NoteContent
        note={note}
        isActive={isActive}
        ref={contentRef}
        onContentChange={updateNoteContent}
        onBlur={handleBlur}
        inactiveFontSize={(() => {
          const fontSize = settings?.defaultInactiveFontSize ?? 12;
          if (process.env.NODE_ENV === 'development') {
            console.log('[DEBUG] Inactive font size:', fontSize, 'Settings:', settings?.defaultInactiveFontSize);
          }
          return fontSize;
        })()}
      />
    </div>
  );
});