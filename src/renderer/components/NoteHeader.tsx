import React, { useState, useRef, useEffect } from 'react';
import { StickyNote } from '../../types';

interface NoteHeaderProps {
  note: StickyNote;
  isActive: boolean;
  onUpdateNote: (updates: Partial<StickyNote>) => Promise<void>;
  onCreateNote: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  onToggleLock: () => Promise<void>;
}

const colorOptions = [
  // ピンク系パステル
  '#FFE1E6', '#FFCCD5', '#FFB3C1', '#FF9BAE', '#FF7F9B',
  
  // コーラル・オレンジ系パステル
  '#FFE4CC', '#FFCF99', '#FFB366', '#FF9F59', '#FF8A4D',
  
  // イエロー系パステル
  '#FFF5CC', '#FFEB99', '#FFE066', '#FFD633', '#FFCC00',
  
  // ライム・イエローグリーン系パステル
  '#F0FFCC', '#E6FF99', '#DCFF66', '#D1FF33', '#C7FF00',
  
  // グリーン系パステル（デフォルト含む）
  '#E6FFCC', '#CCFF99', '#B3FF66', '#99FF33', '#7FFF00',
  '#CCFFE6', '#99FFCC', '#66FFB3', '#33FF99', '#00FF7F',
  
  // ミント・ティール系パステル
  '#CCFFFF', '#99FFFF', '#66FFFF', '#33FFFF', '#00FFFF',
  '#CCF2FF', '#99E6FF', '#66D9FF', '#33CCFF', '#00BFFF',
  
  // ブルー系パステル
  '#E6F2FF', '#CCE6FF', '#B3D9FF', '#99CCFF', '#7FBFFF',
  '#E6E6FF', '#CCCCFF', '#B3B3FF', '#9999FF', '#7F7FFF',
  
  // パープル系パステル
  '#F0E6FF', '#E6CCFF', '#DCB3FF', '#D199FF', '#C77FFF',
  '#FFE6F5', '#FFCCEB', '#FFB3E0', '#FF99D6', '#FF7FCC'
];

const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 48];

// 色の自動調整ユーティリティ関数
const hexToHsl = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
};

const hslToHex = (h: number, s: number, l: number): string => {
  h /= 360;
  s /= 100;
  l /= 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (c: number) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// 調和の取れたヘッダー色を生成する関数
const generateHeaderColor = (bodyColor: string): string => {
  const [h, s, l] = hexToHsl(bodyColor);
  
  // 明度を調整してヘッダー色を生成
  // ボディが明るい場合は少し暗く、暗い場合は少し明るく
  let newL = l;
  if (l > 70) {
    // 明るい色の場合、少し暗くして深みを出す
    newL = Math.max(l - 15, 50);
  } else if (l < 40) {
    // 暗い色の場合、少し明るくしてコントラストを出す
    newL = Math.min(l + 20, 60);
  } else {
    // 中間的な明度の場合、彩度を少し上げる
    newL = l + 10;
  }
  
  // 彩度も少し調整して統一感を出す
  const newS = Math.min(s + 5, 100);
  
  return hslToHex(h, newS, newL);
};

export const NoteHeader: React.FC<NoteHeaderProps> = ({
  note,
  isActive,
  onUpdateNote,
  onCreateNote,
  onTogglePin,
  onToggleLock
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  
  // ダブルクリック検出用
  const [clickTimeout, setClickTimeout] = useState<NodeJS.Timeout | null>(null);
  const [clickCount, setClickCount] = useState(0);
  
  // ポップアップ要素への参照
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const fontSizePickerRef = useRef<HTMLDivElement>(null);

  // isActiveが変更されたときにポップアップを閉じる
  useEffect(() => {
    if (!isActive) {
      closeAllPopups();
    }
  }, [isActive]);

  // ポップアップ外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showColorPicker || showFontSizePicker) {
        const target = event.target as Element;
        
        // メニューボタンのクリックは無視
        if (target.closest('.menu-button')) {
          return;
        }

        let isInsidePopup = false;

        // カラーピッカーが開いている場合の物理的境界判定
        if (showColorPicker && colorPickerRef.current) {
          const rect = colorPickerRef.current.getBoundingClientRect();
          const x = event.clientX;
          const y = event.clientY;
          
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            isInsidePopup = true;
          }
        }

        // フォントサイズピッカーが開いている場合の物理的境界判定
        if (showFontSizePicker && fontSizePickerRef.current) {
          const rect = fontSizePickerRef.current.getBoundingClientRect();
          const x = event.clientX;
          const y = event.clientY;
          
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            isInsidePopup = true;
          }
        }

        // ポップアップ外部のクリックの場合のみ閉じる
        if (!isInsidePopup) {
          closeAllPopups();
        }
      }
    };

    if (showColorPicker || showFontSizePicker) {
      // マウスイベントを使用して座標ベースの判定
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [showColorPicker, showFontSizePicker]);

  const handleButtonClick = (e: React.MouseEvent, action: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  const calculatePopupPosition = (buttonRef: React.RefObject<HTMLButtonElement>) => {
    if (!buttonRef.current) return { top: 0, left: 0 };
    
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // ポップアップの推定サイズ
    const popupWidth = 220;
    const popupHeight = 200;
    
    let top = buttonRect.bottom + 5;
    let left = buttonRect.left;
    
    // 右端を超える場合は左寄せ
    if (left + popupWidth > windowWidth) {
      left = Math.max(5, windowWidth - popupWidth - 5);
    }
    
    // 下端を超える場合は上に表示
    if (top + popupHeight > windowHeight) {
      top = Math.max(5, buttonRect.top - popupHeight - 5);
    }
    
    // ボタンと重なる場合の回避処理
    if (top < buttonRect.bottom && top + popupHeight > buttonRect.top) {
      // 下側にスペースがある場合
      if (buttonRect.bottom + popupHeight <= windowHeight) {
        top = buttonRect.bottom + 5;
      } 
      // 上側にスペースがある場合
      else if (buttonRect.top - popupHeight >= 0) {
        top = buttonRect.top - popupHeight - 5;
      }
      // どちらもだめな場合は右側に表示
      else {
        top = buttonRect.top;
        left = buttonRect.right + 5;
        // 右側も画面を超える場合は左側に
        if (left + popupWidth > windowWidth) {
          left = Math.max(5, buttonRect.left - popupWidth - 5);
        }
      }
    }
    
    // 最小位置制限
    top = Math.max(5, top);
    left = Math.max(5, left);
    
    return { top, left };
  };

  const closeAllPopups = () => {
    setShowColorPicker(false);
    setShowFontSizePicker(false);
  };

  if (!isActive) {
    const headerStyle = note.headerColor ? { backgroundColor: note.headerColor } : {};
    return (
      <div className="note-header" style={headerStyle} onClick={(e) => e.stopPropagation()}>
        <div className="header-menu">
          <button
            className="menu-button"
            title="新規付箋追加"
            onMouseDown={(e) => handleButtonClick(e, onCreateNote)}
          >
            +
          </button>
          
          <button
            className="menu-button"
            title="ピン留"
            onMouseDown={(e) => handleButtonClick(e, onTogglePin)}
          >
            {note.isPinned ? '📍' : '📌'}
          </button>
        </div>
      </div>
    );
  }

  const handleColorChange = (color: string) => {
    onUpdateNote({ backgroundColor: color });
    setShowColorPicker(false);
  };

  const handleHeaderColorChange = (color: string) => {
    onUpdateNote({ headerColor: color });
    setShowColorPicker(false);
  };

  const handleAutoColorAdjust = (color: string) => {
    const headerColor = generateHeaderColor(color);
    onUpdateNote({ 
      backgroundColor: color,
      headerColor: headerColor
    });
    setShowColorPicker(false);
  };

  const handleFontSizeChange = (fontSize: number) => {
    onUpdateNote({ fontSize });
    setShowFontSizePicker(false);
  };

  const headerStyle = note.headerColor ? { backgroundColor: note.headerColor } : {};
  
  return (
    <>
      <div className="note-header" style={headerStyle} onClick={(e) => e.stopPropagation()}>
        <div className="header-menu">
          <button
            ref={fontButtonRef}
            className="menu-button"
            title="文字サイズ"
            onMouseDown={(e) => handleButtonClick(e, () => {
              closeAllPopups();
              const newShow = !showFontSizePicker;
              if (newShow) {
                const position = calculatePopupPosition(fontButtonRef);
                setPopupPosition(position);
              }
              setShowFontSizePicker(newShow);
            })}
          >
            A
          </button>
          
          <button
            ref={colorButtonRef}
            className="menu-button"
            title="カラーピッカー"
            onMouseDown={(e) => handleButtonClick(e, () => {
              closeAllPopups();
              const newShow = !showColorPicker;
              if (newShow) {
                const position = calculatePopupPosition(colorButtonRef);
                setPopupPosition(position);
              }
              setShowColorPicker(newShow);
            })}
          >
            🎨
          </button>
          
          <button
            className="menu-button"
            title="ピン留"
            onMouseDown={(e) => handleButtonClick(e, onTogglePin)}
          >
            {note.isPinned ? '📍' : '📌'}
          </button>
          
          <button
            className="menu-button"
            title={note.isLocked ? "アクティブロック解除" : "アクティブロック"}
            onMouseDown={(e) => handleButtonClick(e, onToggleLock)}
          >
            <span style={note.isLocked ? {} : { transform: 'rotate(40deg)', display: 'inline-block' }}>
              {note.isLocked ? '🔒' : '🔓'}
            </span>
          </button>
        </div>
      </div>

      {showColorPicker && (
        <div 
          ref={colorPickerRef}
          className="color-picker-popup" 
          style={{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="color-grid">
            {colorOptions.map((color) => (
              <div
                key={color}
                className={`color-option ${note.backgroundColor === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                title="左クリック: ボディ色変更 | 右クリック: ヘッダー色変更 | ダブルクリック: 自動調整"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  
                  if (clickTimeout) {
                    clearTimeout(clickTimeout);
                    setClickTimeout(null);
                  }

                  const newCount = clickCount + 1;
                  setClickCount(newCount);

                  if (newCount === 1) {
                    // 単一クリック: 300ms待機してダブルクリックでないことを確認
                    const timeout = setTimeout(() => {
                      handleColorChange(color);
                      setClickCount(0);
                    }, 300);
                    setClickTimeout(timeout);
                  } else if (newCount === 2) {
                    // ダブルクリック: 自動調整
                    handleAutoColorAdjust(color);
                    setClickCount(0);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  // 右クリック: ヘッダー色変更
                  handleHeaderColorChange(color);
                  
                  // 進行中のクリックカウントをリセット
                  if (clickTimeout) {
                    clearTimeout(clickTimeout);
                    setClickTimeout(null);
                  }
                  setClickCount(0);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {showFontSizePicker && (
        <div 
          ref={fontSizePickerRef}
          className="font-size-popup" 
          style={{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {fontSizes.map((size) => (
            <div
              key={size}
              className={`font-size-option ${note.fontSize === size ? 'selected' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                handleFontSizeChange(size);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
              }}
            >
              {size}px
            </div>
          ))}
        </div>
      )}

    </>
  );
};