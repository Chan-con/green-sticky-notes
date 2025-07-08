import React, { useState, useEffect, useRef } from 'react';
import '../styles/settings.css';

interface SettingsState {
  showAllHotkey: string;
  hideAllHotkey: string;
  searchHotkey: string;
  pinHotkey: string;
  lockHotkey: string;
  newNoteHotkey: string;
  headerIconSize: number;
  defaultInactiveWidth: number;
  defaultInactiveHeight: number;
  defaultInactiveFontSize: number;
  autoStart: boolean;
}

export const SettingsApp: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    showAllHotkey: '',
    hideAllHotkey: '',
    searchHotkey: '',
    pinHotkey: '',
    lockHotkey: '',
    newNoteHotkey: '',
    headerIconSize: 16,
    defaultInactiveWidth: 100,  // 仮の初期値
    defaultInactiveHeight: 100, // 仮の初期値
    defaultInactiveFontSize: 12,
    autoStart: false
  });
  
  const [originalSettings, setOriginalSettings] = useState<SettingsState>({
    showAllHotkey: '',
    hideAllHotkey: '',
    searchHotkey: '',
    pinHotkey: '',
    lockHotkey: '',
    newNoteHotkey: '',
    headerIconSize: 16,
    defaultInactiveWidth: 100,  // 仮の初期値
    defaultInactiveHeight: 100, // 仮の初期値
    defaultInactiveFontSize: 12,
    autoStart: false
  });
  
  const [listeningFor, setListeningFor] = useState<keyof SettingsState | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isClosingSafely, setIsClosingSafely] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const isClosingSafelyRef = useRef(false);
  const originalSettingsRef = useRef<SettingsState>(originalSettings);

  useEffect(() => {
    // 設定を読み込み
    const loadSettings = async () => {
      try {
        if (window.electronAPI && window.electronAPI.getSettings) {
          const savedSettings = await window.electronAPI.getSettings();
          console.log('[DEBUG] Loaded settings from electron:', savedSettings);
          console.log('[DEBUG] savedSettings.newNoteHotkey:', savedSettings.newNoteHotkey);
          console.log('[DEBUG] Type of newNoteHotkey:', typeof savedSettings.newNoteHotkey);
          console.log('[DEBUG] Is newNoteHotkey undefined?:', savedSettings.newNoteHotkey === undefined);
          
          // デフォルト値をマージして欠損したフィールドを補完
          console.log('[DEBUG] savedSettings.defaultInactiveWidth:', savedSettings.defaultInactiveWidth);
          console.log('[DEBUG] savedSettings.defaultInactiveHeight:', savedSettings.defaultInactiveHeight);
          console.log('[DEBUG] Type of defaultInactiveWidth:', typeof savedSettings.defaultInactiveWidth);
          console.log('[DEBUG] Type of defaultInactiveHeight:', typeof savedSettings.defaultInactiveHeight);
          console.log('[DEBUG] Is defaultInactiveWidth undefined?:', savedSettings.defaultInactiveWidth === undefined);
          console.log('[DEBUG] Is defaultInactiveHeight undefined?:', savedSettings.defaultInactiveHeight === undefined);
          
          const completeSettings = {
            showAllHotkey: savedSettings.showAllHotkey ?? '',
            hideAllHotkey: savedSettings.hideAllHotkey ?? '',
            searchHotkey: savedSettings.searchHotkey ?? '',
            pinHotkey: savedSettings.pinHotkey ?? '',
            lockHotkey: savedSettings.lockHotkey ?? '',
            newNoteHotkey: savedSettings.newNoteHotkey ?? '',
            headerIconSize: savedSettings.headerIconSize ?? 16,
            defaultInactiveWidth: savedSettings.defaultInactiveWidth !== undefined ? savedSettings.defaultInactiveWidth : 150,
            defaultInactiveHeight: savedSettings.defaultInactiveHeight !== undefined ? savedSettings.defaultInactiveHeight : 125,
            defaultInactiveFontSize: savedSettings.defaultInactiveFontSize !== undefined ? savedSettings.defaultInactiveFontSize : 12,
            autoStart: savedSettings.autoStart ?? false
          };
          
          console.log('[DEBUG] Complete settings after merge:', completeSettings);
          setSettings(completeSettings);
          setOriginalSettings(completeSettings);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('設定の読み込みに失敗しました:', error);
        // デフォルト値を設定
        const defaultSettings = {
          showAllHotkey: '',
          hideAllHotkey: '',
          searchHotkey: '',
          pinHotkey: '',
          lockHotkey: '',
          newNoteHotkey: '',
          headerIconSize: 16,
          defaultInactiveWidth: 150,  // 新しい範囲の中間値
          defaultInactiveHeight: 125, // 新しい範囲の中間値
          defaultInactiveFontSize: 12,
          autoStart: false
        };
        setSettings(defaultSettings);
        setOriginalSettings(defaultSettings);
        setIsLoading(false);
      }
    };
    
    loadSettings();

    // ウィンドウが閉じられる前に元の設定に戻す（保存成功時は除く）
    const handleBeforeUnload = () => {
      if (!isClosingSafelyRef.current) {
        sendPreview(originalSettingsRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // コンポーネントが破棄される時も元の設定に戻す（保存成功時は除く）
      if (!isClosingSafelyRef.current && window.electronAPI && window.electronAPI.sendSettingsPreview) {
        window.electronAPI.sendSettingsPreview(originalSettingsRef.current);
      }
    };
  }, []);

  // refの値を最新の状態に同期
  useEffect(() => {
    isClosingSafelyRef.current = isClosingSafely;
  }, [isClosingSafely]);

  useEffect(() => {
    originalSettingsRef.current = originalSettings;
  }, [originalSettings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ホットキー設定をリッスンしている場合
      if (listeningFor) {
        // ホットキー設定時は全てのキーをキャプチャ
        event.preventDefault();
        event.stopPropagation();
        
        const newKeys = new Set(pressedKeys);
        
        // 修飾キーの処理
        if (event.ctrlKey) newKeys.add('Ctrl');
        if (event.shiftKey) newKeys.add('Shift');
        if (event.altKey) newKeys.add('Alt');
        if (event.metaKey) newKeys.add('Meta');
        
        // 通常のキーの処理（修飾キー以外）
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
          const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
          newKeys.add(key);
        }
        
        setPressedKeys(newKeys);
        
        // タイムアウトをリセット
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        
        // 1秒後に入力を確定
        timeoutRef.current = setTimeout(() => {
          if (newKeys.size > 0) {
            const hotkeyString = Array.from(newKeys).join('+');
            setSettings(prev => ({
              ...prev,
              [listeningFor]: hotkeyString
            }));
          }
          
          setListeningFor(null);
          setPressedKeys(new Set());
        }, 1000);
        
        return; // ホットキー設定時は以下の処理をスキップ
      }

      // ホットキー設定中でない場合は、グローバルホットキーのみブロック
      const shouldPreventDefault = (
        event.ctrlKey || event.altKey || event.metaKey ||
        (event.shiftKey && event.key !== 'Shift') ||
        ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(event.key)
      );

      if (shouldPreventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!listeningFor) return;
      
      // キーが離された時も同様に処理を確定
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        if (pressedKeys.size > 0) {
          const hotkeyString = Array.from(pressedKeys).join('+');
          setSettings(prev => ({
            ...prev,
            [listeningFor]: hotkeyString
          }));
        }
        
        setListeningFor(null);
        setPressedKeys(new Set());
      }, 300);
    };

    // 設定画面が開いている間は常にキーイベントを監視
    // より高い優先度でイベントをキャプチャ
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [listeningFor, pressedKeys]);

  const startListening = (key: keyof SettingsState) => {
    setListeningFor(key);
    setPressedKeys(new Set());
  };

  const clearHotkey = (key: keyof SettingsState) => {
    setSettings(prev => ({
      ...prev,
      [key]: ''
    }));
  };

  // プレビュー用の設定変更を送信
  const sendPreview = (newSettings: SettingsState) => {
    console.log('[DEBUG] sendPreview called with:', newSettings);
    if (window.electronAPI && window.electronAPI.sendSettingsPreview) {
      window.electronAPI.sendSettingsPreview(newSettings);
    } else {
      console.log('[DEBUG] electronAPI.sendSettingsPreview not available');
    }
  };

  // ヘッダーアイコンサイズ変更時のハンドラ
  const handleHeaderIconSizeChange = (value: number) => {
    const newSettings = { ...settings, headerIconSize: value };
    setSettings(newSettings);
    sendPreview(newSettings);
  };

  // 非アクティブサイズ変更時のハンドラ
  const handleInactiveSizeChange = (dimension: 'width' | 'height', value: number) => {
    console.log('[DEBUG] handleInactiveSizeChange called:', dimension, value);
    const newSettings = { 
      ...settings, 
      [dimension === 'width' ? 'defaultInactiveWidth' : 'defaultInactiveHeight']: value 
    };
    console.log('[DEBUG] New settings:', newSettings);
    setSettings(newSettings);
    sendPreview(newSettings);
  };

  // 非アクティブフォントサイズ変更時のハンドラ
  const handleInactiveFontSizeChange = (value: number) => {
    const newSettings = { ...settings, defaultInactiveFontSize: value };
    setSettings(newSettings);
    sendPreview(newSettings);
  };

  const handleExportToTxt = async () => {
    console.log('[DEBUG] handleExportToTxt called');
    try {
      setIsExporting(true);
      setErrorMessage('');
      
      console.log('[DEBUG] window.electronAPI exists:', !!window.electronAPI);
      console.log('[DEBUG] selectFolderAndExportNotes exists:', !!window.electronAPI?.selectFolderAndExportNotes);
      
      if (window.electronAPI && window.electronAPI.selectFolderAndExportNotes) {
        console.log('[DEBUG] Calling selectFolderAndExportNotes...');
        const result = await window.electronAPI.selectFolderAndExportNotes();
        console.log('[DEBUG] Export result:', result);
        
        if (result && typeof result === 'object' && result.success) {
          console.log('Export successful:', result.path);
          // 成功メッセージを表示（オプション）
        } else if (result && typeof result === 'object' && !result.success) {
          console.error('[DEBUG] Export failed:', result.error);
          if (result.error !== 'ユーザーによってキャンセルされました') {
            setErrorMessage(result.error || 'エクスポートに失敗しました');
          }
        }
      } else {
        console.error('[DEBUG] electronAPI or selectFolderAndExportNotes not available');
        setErrorMessage('エクスポート機能が利用できません');
      }
    } catch (error) {
      console.error('[DEBUG] Export error:', error);
      setErrorMessage('エクスポート中にエラーが発生しました');
    } finally {
      console.log('[DEBUG] Setting isExporting to false');
      setIsExporting(false);
    }
  };

  const handleSave = async () => {
    try {
      setErrorMessage(''); // エラーメッセージをクリア
      console.log('[DEBUG] handleSave called with settings:', settings);
      
      // ホットキーの重複チェック
      const hotkeys = [
        { key: 'showAllHotkey', label: 'すべてのノートを表示', value: settings.showAllHotkey?.trim() },
        { key: 'hideAllHotkey', label: 'すべてのノートを隠す', value: settings.hideAllHotkey?.trim() },
        { key: 'searchHotkey', label: '検索ウィンドウの表示/非表示', value: settings.searchHotkey?.trim() },
        { key: 'pinHotkey', label: 'アクティブ付箋のピン留め切り替え', value: settings.pinHotkey?.trim() },
        { key: 'lockHotkey', label: 'アクティブ付箋のロック切り替え', value: settings.lockHotkey?.trim() },
        { key: 'newNoteHotkey', label: '新規ノート作成', value: settings.newNoteHotkey?.trim() }
      ].filter(hotkey => hotkey.value && hotkey.value.length > 0);
      
      // 重複チェック
      const duplicateKeys = new Set();
      const duplicateLabels: string[] = [];
      
      for (let i = 0; i < hotkeys.length; i++) {
        for (let j = i + 1; j < hotkeys.length; j++) {
          if (hotkeys[i].value === hotkeys[j].value) {
            duplicateKeys.add(hotkeys[i].value);
            if (!duplicateLabels.includes(hotkeys[i].label)) {
              duplicateLabels.push(hotkeys[i].label);
            }
            if (!duplicateLabels.includes(hotkeys[j].label)) {
              duplicateLabels.push(hotkeys[j].label);
            }
          }
        }
      }
      
      if (duplicateKeys.size > 0) {
        setErrorMessage(`以下のホットキーが重複しています: ${duplicateLabels.join(', ')}`);
        return;
      }
      
      if (window.electronAPI && window.electronAPI.saveSettings) {
        const result: any = await window.electronAPI.saveSettings(settings);
        console.log('[DEBUG] Save result:', result);
        
        if (result && typeof result === 'object' && result.success) {
          // 保存成功時に元の設定を更新とフラグ設定
          setOriginalSettings(settings);
          setIsClosingSafely(true);
          
          // refも即座に更新（確実に最新の値を反映）
          originalSettingsRef.current = settings;
          isClosingSafelyRef.current = true;
          
          console.log('[DEBUG] Settings saved successfully, closing window');
          
          // 少し待ってから設定ウィンドウを閉じる（イベントの競合を避けるため）
          setTimeout(async () => {
            if (window.electronAPI && window.electronAPI.closeSettings) {
              await window.electronAPI.closeSettings();
            }
          }, 300);
        } else if (result && typeof result === 'object' && !result.success) {
          // エラーメッセージを表示
          console.log('[DEBUG] Save failed:', result.error);
          setErrorMessage(result.error || '設定の保存に失敗しました');
        } else {
          // 古い形式（boolean）の場合
          setOriginalSettings(settings);
          setIsClosingSafely(true);
          
          // refも即座に更新（確実に最新の値を反映）
          originalSettingsRef.current = settings;
          isClosingSafelyRef.current = true;
          
          console.log('[DEBUG] Settings saved (legacy format), closing window');
          
          // 少し待ってから設定ウィンドウを閉じる（イベントの競合を避けるため）
          setTimeout(async () => {
            if (window.electronAPI && window.electronAPI.closeSettings) {
              await window.electronAPI.closeSettings();
            }
          }, 300);
        }
      }
    } catch (error) {
      console.error('設定の保存に失敗しました:', error);
      setErrorMessage('設定の保存中にエラーが発生しました');
    }
  };

  return (
    <div className="settings-window">
      <div className="settings-header">
        <span className="settings-title">設定</span>
      </div>
      
      <div className="settings-container">
        <div className="settings-section">
          <h3>外観設定</h3>
          
          <div className="setting-row">
            <label>ヘッダーアイコンサイズ:</label>
            <div className="size-input-group">
              <input
                type="range"
                min="12"
                max="32"
                value={settings.headerIconSize}
                onChange={(e) => handleHeaderIconSizeChange(parseInt(e.target.value))}
                className="size-slider"
              />
              <input
                type="number"
                min="12"
                max="32"
                value={settings.headerIconSize}
                onChange={(e) => handleHeaderIconSizeChange(parseInt(e.target.value) || 16)}
                className="size-input"
              />
              <span className="size-unit">px</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>ホットキー設定</h3>
          
          <div className="hotkey-setting">
            <label>すべてのノートを表示:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'showAllHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : settings.showAllHotkey}
                readOnly
                onClick={() => startListening('showAllHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'showAllHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('showAllHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="hotkey-setting">
            <label>すべてのノートを隠す:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'hideAllHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : settings.hideAllHotkey}
                readOnly
                onClick={() => startListening('hideAllHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'hideAllHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('hideAllHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="hotkey-setting">
            <label>検索ウィンドウの表示/非表示:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'searchHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : settings.searchHotkey}
                readOnly
                onClick={() => startListening('searchHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'searchHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('searchHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="hotkey-setting">
            <label>新しい付箋追加:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'newNoteHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : (settings.newNoteHotkey || '')}
                readOnly
                onClick={() => startListening('newNoteHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'newNoteHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('newNoteHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
        </div>

        <div className="settings-section">
          <h3>ショートカットキー設定</h3>
          
          <div className="hotkey-setting">
            <label>アクティブ付箋のピン留め切り替え:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'pinHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : settings.pinHotkey}
                readOnly
                onClick={() => startListening('pinHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'pinHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('pinHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="hotkey-setting">
            <label>アクティブ付箋のロック切り替え:</label>
            <div className="hotkey-input-group">
              <input
                type="text"
                value={listeningFor === 'lockHotkey' 
                  ? (pressedKeys.size > 0 ? Array.from(pressedKeys).join('+') : 'キーを押してください...') 
                  : settings.lockHotkey}
                readOnly
                onClick={() => startListening('lockHotkey')}
                placeholder="クリックしてキーを設定"
                className={listeningFor === 'lockHotkey' ? 'listening' : ''}
              />
              <button 
                type="button" 
                className="clear-button"
                onClick={() => clearHotkey('lockHotkey')}
              >
                ×
              </button>
            </div>
          </div>
          
        </div>

        <div className="settings-section">
          <h3>サイズ設定</h3>
          
          <div className="setting-row">
            <label htmlFor="defaultInactiveWidth">非アクティブモードの幅:</label>
            <div className="size-input-group">
              <input
                type="range"
                id="defaultInactiveWidth"
                min="50"
                max="300"
                value={settings.defaultInactiveWidth}
                onChange={(e) => handleInactiveSizeChange('width', parseInt(e.target.value))}
                className="size-slider"
              />
              <input
                type="number"
                min="50"
                max="300"
                value={settings.defaultInactiveWidth}
                onChange={(e) => handleInactiveSizeChange('width', parseInt(e.target.value) || 150)}
                className="size-input"
              />
              <span className="size-unit">px</span>
            </div>
          </div>
          
          <div className="setting-row">
            <label htmlFor="defaultInactiveHeight">非アクティブモードの高さ:</label>
            <div className="size-input-group">
              <input
                type="range"
                id="defaultInactiveHeight"
                min="50"
                max="200"
                value={settings.defaultInactiveHeight}
                onChange={(e) => handleInactiveSizeChange('height', parseInt(e.target.value))}
                className="size-slider"
              />
              <input
                type="number"
                min="50"
                max="200"
                value={settings.defaultInactiveHeight}
                onChange={(e) => handleInactiveSizeChange('height', parseInt(e.target.value) || 125)}
                className="size-input"
              />
              <span className="size-unit">px</span>
            </div>
          </div>
          
          <div className="setting-row">
            <label htmlFor="defaultInactiveFontSize">非アクティブモードのフォントサイズ:</label>
            <div className="size-input-group">
              <input
                type="range"
                id="defaultInactiveFontSize"
                min="8"
                max="20"
                value={settings.defaultInactiveFontSize}
                onChange={(e) => handleInactiveFontSizeChange(parseInt(e.target.value))}
                className="size-slider"
              />
              <input
                type="number"
                min="8"
                max="20"
                value={settings.defaultInactiveFontSize}
                onChange={(e) => handleInactiveFontSizeChange(parseInt(e.target.value) || 12)}
                className="size-input"
              />
              <span className="size-unit">px</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>システム設定</h3>
          
          <div className="setting-row">
            <label>PC起動時に自動開始:</label>
            <div className="checkbox-group">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => setSettings(prev => ({ ...prev, autoStart: e.target.checked }))}
                className="auto-start-checkbox"
              />
              <span className="checkbox-label">アプリケーションをWindows起動時に自動で開始する</span>
            </div>
          </div>
          
          <div className="setting-row">
            <label>付箋のエクスポート:</label>
            <div className="export-group">
              <button 
                type="button" 
                onClick={handleExportToTxt}
                disabled={isExporting}
                className="export-button"
              >
                {isExporting ? 'エクスポート中...' : '.txtファイルで出力'}
              </button>
            </div>
          </div>
          
        </div>
        
        {errorMessage && (
          <div className="error-message" style={{ 
            color: 'red', 
            margin: '10px 0', 
            padding: '10px', 
            backgroundColor: '#ffe6e6', 
            border: '1px solid #ff9999', 
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {errorMessage}
          </div>
        )}
        
        <div className="settings-actions">
          <button onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};