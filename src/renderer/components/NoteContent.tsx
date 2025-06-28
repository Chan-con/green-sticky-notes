import React, { forwardRef } from 'react';
import { StickyNote, RichContent } from '../../types';

interface NoteContentProps {
  note: StickyNote;
  isActive: boolean;
  onContentChange: (content: string) => void;
  onBlur: () => void;
}

export const NoteContent = forwardRef<HTMLTextAreaElement, NoteContentProps>(
  ({ note, isActive, onContentChange, onBlur }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onContentChange(e.target.value);
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

    const handleContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      // ElectronのIPCを通じてコンテキストメニューを表示
      window.electron.showContextMenu();
    };

    const truncateText = (text: string, maxLength: number = 50): string => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    if (isActive) {
      return (
        <textarea
          ref={ref}
          className="note-content"
          value={getContentAsString(note.content)}
          onChange={handleChange}
          onBlur={onBlur}
          onContextMenu={handleContextMenu}
          placeholder="付箋の内容を入力..."
          style={{ fontSize: `${note.fontSize}px` }}
        />
      );
    }

    return (
      <div
        className="note-content stay-mode"
        style={{ 
          fontSize: '12px',
          color: getContentAsString(note.content) ? 'inherit' : 'rgba(0, 0, 0, 0.4)'
        }}
      >
        {getContentAsString(note.content) ? truncateText(getContentAsString(note.content)) : '空の付箋'}
      </div>
    );
  }
);