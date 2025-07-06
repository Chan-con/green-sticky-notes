import React, { useState, useEffect, useRef } from 'react';
import '../styles/settings.css';

interface SettingsState {
  showAllHotkey: string;
  hideAllHotkey: string;
  searchHotkey: string;
}

export const SettingsApp: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    showAllHotkey: '',
    hideAllHotkey: '',
    searchHotkey: ''
  });
  
  const [listeningFor, setListeningFor] = useState<keyof SettingsState | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>('');
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // 設定を読み込み
    const loadSettings = async () => {
      try {
        if (window.electronAPI && window.electronAPI.getSettings) {
          const savedSettings = await window.electronAPI.getSettings();
          setSettings(savedSettings);
        }
      } catch (error) {
        console.error('設定の読み込みに失敗しました:', error);
        // デフォルト値を設定
        setSettings({
          showAllHotkey: '',
          hideAllHotkey: '',
          searchHotkey: ''
        });
      }
    };
    
    loadSettings();
  }, []);

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

  const handleSave = async () => {
    try {
      setErrorMessage(''); // エラーメッセージをクリア
      
      if (window.electronAPI && window.electronAPI.saveSettings) {
        const result: any = await window.electronAPI.saveSettings(settings);
        if (result && typeof result === 'object' && result.success) {
          // 設定ウィンドウを閉じる
          if (window.electronAPI && window.electronAPI.closeSettings) {
            await window.electronAPI.closeSettings();
          }
        } else if (result && typeof result === 'object' && !result.success) {
          // エラーメッセージを表示
          setErrorMessage(result.error || '設定の保存に失敗しました');
        } else {
          // 古い形式（boolean）の場合
          if (window.electronAPI && window.electronAPI.closeSettings) {
            await window.electronAPI.closeSettings();
          }
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