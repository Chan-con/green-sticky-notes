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
  '#90EE90', '#FFE4B5', '#FFB6C1', '#E6E6FA',
  '#FFEFD5', '#F0FFF0', '#FFF8DC', '#E0FFFF',
  '#FFFACD', '#F5F5DC', '#FFEBCD', '#FAFAD2',
  // 追加のパステルカラー16色
  '#FFD1DC', '#E1F5FE', '#F3E5F5', '#FFF3E0',
  '#E8F5E8', '#FFF9C4', '#FFECB3', '#FCE4EC',
  '#F1F8E9', '#E3F2FD', '#F9FBE7', '#FFCDD2',
  '#C8E6C9', '#DCEDC8', '#F8BBD9', '#B39DDB'
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
            className={`menu-button ${note.isPinned ? 'active' : ''}`}
            title="ピン留"
            onMouseDown={(e) => handleButtonClick(e, onTogglePin)}
          >
            📌
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
            className={`menu-button ${note.isPinned ? 'active' : ''}`}
            title="ピン留"
            onMouseDown={(e) => handleButtonClick(e, onTogglePin)}
          >
            📌
          </button>
          
          <button
            className={`menu-button ${note.isLocked ? 'active' : ''}`}
            title={note.isLocked ? "アクティブロック解除" : "アクティブロック"}
            onMouseDown={(e) => handleButtonClick(e, onToggleLock)}
          >
            {note.isLocked ? '🔒' : '🔓'}
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