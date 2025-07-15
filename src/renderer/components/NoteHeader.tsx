import React, { useState, useRef, useEffect, useMemo } from 'react';
import { StickyNote } from '../../types';

interface NoteHeaderProps {
  note: StickyNote;
  isActive: boolean;
  headerIconSize: number;
  onUpdateNote: (updates: Partial<StickyNote>) => Promise<void>;
  onCreateNote: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  onToggleLock: () => Promise<void>;
}

const colorOptions = [
  // レッド・ピンク系グラデーション
  '#FF8A80', '#FFB3BA', '#FFCDD2', '#FFD1DC', '#FFE1E6',
  '#F06292', '#FF99D6', '#F8BBD9', '#FFCCEB', '#FFE6F5',
  '#FF7F9B', '#FF9BAE', '#FFB3C1', '#FFCCD5', '#FFE4E1',
  
  // オレンジ・コーラル系グラデーション  
  '#FF8A65', '#FF9F59', '#FFB366', '#FFCF99', '#FFE4CC',
  '#FF8A4D', '#FFBABA', '#FFC9A0', '#FFE5B4', '#FFDFBA',
  
  // イエロー系グラデーション
  '#FFCC02', '#FFD633', '#FFE066', '#FFEB99', '#FFF5CC',
  '#FFF176', '#FFFFBA', '#F0F4C3', '#DCEDC8', '#DCFF66',
  
  // ライム・グリーン系グラデーション
  '#AED581', '#BAFFC9', '#C7E9B4', '#C8E6C9', '#CCFFE6',
  '#81C784', '#99FF33', '#B3FF66', '#CCFF99', '#E6FFCC',
  '#7FFF00', '#C7FF00', '#D1FF33', '#E6FF99', '#F0FFCC',
  '#00FF7F', '#33FF99', '#66FFB3', '#99FFCC', '#A0FFAB',
  
  // シアン・ティール系グラデーション
  '#00FFFF', '#33FFFF', '#66FFFF', '#99FFFF', '#CCFFFF',
  '#00BFFF', '#33CCFF', '#66D9FF', '#99E6FF', '#CCF2FF',
  '#B2EBF2', '#B2DFDB', '#A0E6FF', '#E1F5FE',
  
  // ブルー系グラデーション
  '#64B5F6', '#7FBFFF', '#99CCFF', '#B3D9FF', '#CCE6FF',
  '#BAE1FF', '#B4D7FF', '#BBDEFB', '#C5CAE9', '#E6F2FF',
  '#7F7FFF', '#9999FF', '#B3B3FF', '#CCCCFF', '#E6E6FF',
  
  // パープル・バイオレット系グラデーション
  '#9575CD', '#C77FFF', '#D199FF', '#DCB3FF', '#E6CCFF',
  '#D4A4FF', '#E1BEE7', '#E6B3FF', '#F0E6FF', '#F3E5F5',
  
  // ホワイト・グレー系グラデーション（カラフルの下に配置）
  '#FFFFFF', '#FAFAFA', '#F5F5F5', '#EEEEEE', '#E8E8E8',
  '#DEDEDE', '#D5D5D5', '#CCCCCC', '#C0C0C0', '#B8B8B8'
];

const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 48];

interface PopupPosition {
  top: number;
  left: number;
  maxWidth?: number;
  maxHeight?: number;
}

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
  headerIconSize,
  onUpdateNote,
  onCreateNote,
  onTogglePin,
  onToggleLock
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ top: 0, left: 0 });
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  
  // ダブルクリック検出用（カラーピッカーで使用）
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
        
        // より包括的にポップアップ要素をチェック
        const isInsideColorPicker = target.closest('.color-picker-popup');
        const isInsideFontSizePicker = target.closest('.font-size-popup');
        const isMenuButton = target.closest('.menu-button');
        
        // さらに、物理的境界判定も追加でチェック
        let isInsidePopupArea = false;
        
        if (showColorPicker && colorPickerRef.current) {
          const rect = colorPickerRef.current.getBoundingClientRect();
          const x = event.clientX;
          const y = event.clientY;
          
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            isInsidePopupArea = true;
          }
        }

        if (showFontSizePicker && fontSizePickerRef.current) {
          const rect = fontSizePickerRef.current.getBoundingClientRect();
          const x = event.clientX;
          const y = event.clientY;
          
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            isInsidePopupArea = true;
          }
        }

        // DOM検索または座標判定のいずれかで内部と判定されれば閉じない
        if (!isInsideColorPicker && !isInsideFontSizePicker && !isMenuButton && !isInsidePopupArea) {
          closeAllPopups();
        }
      }
    };

    if (showColorPicker || showFontSizePicker) {
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

  const calculatePopupPosition = (buttonRef: React.RefObject<HTMLButtonElement>): PopupPosition => {
    if (!buttonRef.current) return { top: 0, left: 0 };
    
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // ヘッダーエリアを取得（note-headerクラスの要素）
    const headerElement = buttonRef.current.closest('.note-header');
    const headerRect = headerElement ? headerElement.getBoundingClientRect() : null;
    
    // ポップアップの推定サイズ（縦に細いウィンドウの場合は動的調整）
    const popupWidth = Math.min(220, windowWidth - 20);
    const popupHeight = Math.min(200, windowHeight * 0.6); // 画面の60%まで
    
    // 利用可能な垂直スペースを計算
    const spaceBelow = headerRect ? windowHeight - headerRect.bottom : windowHeight - buttonRect.bottom;
    const spaceAbove = headerRect ? headerRect.top : buttonRect.top;
    
    let top = 0;
    let left = buttonRect.left;
    
    // 右端を超える場合は左寄せ
    if (left + popupWidth > windowWidth) {
      left = Math.max(5, windowWidth - popupWidth - 5);
    }
    
    // 縦に細いウィンドウの場合の特別処理
    if (windowHeight < 300 || (headerRect && spaceBelow < 100 && spaceAbove < 100)) {
      // 非常に小さいウィンドウの場合でも、必ずヘッダーの下に配置
      top = headerRect ? headerRect.bottom + 5 : buttonRect.bottom + 5;
      left = 5;
      // この場合はポップアップサイズを更に小さくする
      const availableHeight = windowHeight - top - 20;
      return { 
        top, 
        left,
        maxWidth: windowWidth - 20,
        maxHeight: Math.max(50, availableHeight) // 最低50pxは確保
      };
    }
    
    // 位置計算の優先順位を明確化
    // 1. まずヘッダーの下に配置を試す
    if (headerRect && spaceBelow >= popupHeight + 15) {
      top = headerRect.bottom + 10;
    }
    // 2. 下に配置できない場合は上に配置を試す
    else if (headerRect && spaceAbove >= popupHeight + 15) {
      top = headerRect.top - popupHeight - 10;
    }
    // 3. 両方に配置できない場合は左右に配置を試す
    else if (headerRect) {
      // 右側に表示を試す
      if (headerRect.right + popupWidth + 15 <= windowWidth) {
        top = headerRect.top;
        left = headerRect.right + 10;
      } 
      // 左側に表示を試す
      else if (headerRect.left - popupWidth - 15 >= 0) {
        top = headerRect.top;
        left = headerRect.left - popupWidth - 10;
      }
      // どちらもだめな場合は強制的に下に配置（画面を超えても）
      else {
        top = headerRect.bottom + 10;
      }
    }
    // 4. ヘッダーがない場合（フォールバック）
    else {
      top = buttonRect.bottom + 10;
    }
    
    // 最小位置制限（ただし、ヘッダーとの重なりを考慮）
    if (headerRect) {
      // ヘッダーと重なる場合の最小位置は、ヘッダーの下
      const minTop = headerRect.bottom + 5;
      if (top < minTop) {
        top = minTop;
      }
    } else {
      top = Math.max(5, top);
    }
    left = Math.max(5, left);
    
    // 画面を超える場合の最終調整（但し、ヘッダーとの重なりを防ぐ）
    if (top + popupHeight > windowHeight) {
      const adjustedTop = Math.max(5, windowHeight - popupHeight - 5);
      // 調整後の位置がヘッダーと重なるかチェック
      if (headerRect && adjustedTop < headerRect.bottom) {
        // 重なる場合は、ヘッダーの下に配置し、高さを調整
        top = headerRect.bottom + 5;
        return {
          top,
          left,
          maxHeight: windowHeight - top - 10
        };
      } else {
        top = adjustedTop;
      }
    }
    
    return { top, left };
  };

  const closeAllPopups = () => {
    setShowColorPicker(false);
    setShowFontSizePicker(false);
  };

  // スタイルをuseMemoで管理して確実に再計算されるようにする
  const headerStyle = useMemo(() => ({
    ...(note.headerColor ? { backgroundColor: note.headerColor } : {}),
    padding: `${Math.max(4, headerIconSize * 0.3)}px ${Math.max(8, headerIconSize * 0.6)}px`
  }), [note.headerColor, headerIconSize]);
  
  const iconStyle = useMemo(() => ({
    fontSize: `${headerIconSize}px`,
    width: `${headerIconSize + 8}px`,
    height: `${headerIconSize + 8}px`
  }), [headerIconSize]);


  if (!isActive) {
    
    return (
      <div className="note-header" style={headerStyle} onClick={(e) => e.stopPropagation()}>
        <div className="header-menu">
          <button
            className="menu-button"
            style={iconStyle}
            title="新規付箋追加"
            onMouseDown={(e) => handleButtonClick(e, onCreateNote)}
          >
            +
          </button>
          
          <button
            className="menu-button"
            style={iconStyle}
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

  return (
    <>
      <div className="note-header" style={headerStyle} onClick={(e) => e.stopPropagation()}>
        <div className="header-menu">
          <button
            className="menu-button"
            style={iconStyle}
            title="新規付箋追加"
            onMouseDown={(e) => handleButtonClick(e, onCreateNote)}
          >
            +
          </button>
          
          <button
            ref={fontButtonRef}
            className="menu-button"
            style={iconStyle}
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
            style={iconStyle}
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
            style={iconStyle}
            title="ピン留"
            onMouseDown={(e) => handleButtonClick(e, onTogglePin)}
          >
            {note.isPinned ? '📍' : '📌'}
          </button>
          
          <button
            className="menu-button"
            style={iconStyle}
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
          style={{ 
            top: `${popupPosition.top}px`, 
            left: `${popupPosition.left}px`,
            ...(popupPosition.maxWidth && { maxWidth: `${popupPosition.maxWidth}px` }),
            ...(popupPosition.maxHeight && { maxHeight: `${popupPosition.maxHeight}px` })
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
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
          style={{ 
            top: `${popupPosition.top}px`, 
            left: `${popupPosition.left}px`,
            ...(popupPosition.maxWidth && { maxWidth: `${popupPosition.maxWidth}px` }),
            ...(popupPosition.maxHeight && { maxHeight: `${popupPosition.maxHeight}px` })
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }}
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