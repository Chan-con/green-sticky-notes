import React, { useState, useEffect, useRef } from 'react';

interface SettingsState {
  showAllHotkey: string;
  hideAllHotkey: string;
}

export const SettingsApp: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    showAllHotkey: '',
    hideAllHotkey: ''
  });
  
  const [listeningFor, setListeningFor] = useState<keyof SettingsState | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
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
          hideAllHotkey: ''
        });
      }
    };
    
    loadSettings();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!listeningFor) return;
      
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

    if (listeningFor) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keyup', handleKeyUp);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
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
      console.log('設定を保存:', settings);
      
      if (window.electronAPI && window.electronAPI.saveSettings) {
        await window.electronAPI.saveSettings(settings);
        console.log('設定が正常に保存されました');
      }
      
      // 設定ウィンドウを閉じる
      if (window.electronAPI && window.electronAPI.closeSettings) {
        await window.electronAPI.closeSettings();
      }
    } catch (error) {
      console.error('設定の保存に失敗しました:', error);
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
          
        </div>
        
        <div className="settings-actions">
          <button onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};