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
        // ポップアップ内やボタン内のクリックでない場合は閉じる
        if (!target.closest('.color-picker-popup') && 
            !target.closest('.font-size-popup') &&
            !target.closest('.menu-button')) {
          closeAllPopups();
        }
      }
    };

    if (showColorPicker || showFontSizePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
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
    return (
      <div className="note-header" onClick={(e) => e.stopPropagation()}>
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

  const handleFontSizeChange = (fontSize: number) => {
    onUpdateNote({ fontSize });
    setShowFontSizePicker(false);
  };

  return (
    <>
      <div className="note-header" onClick={(e) => e.stopPropagation()}>
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
          className="color-picker-popup" 
          style={{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="color-grid">
            {colorOptions.map((color) => (
              <div
                key={color}
                className={`color-option ${note.backgroundColor === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleColorChange(color);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {showFontSizePicker && (
        <div 
          className="font-size-popup" 
          style={{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {fontSizes.map((size) => (
            <div
              key={size}
              className={`font-size-option ${note.fontSize === size ? 'selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleFontSizeChange(size);
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