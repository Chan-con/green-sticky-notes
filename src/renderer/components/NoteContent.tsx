import React, { forwardRef } from 'react';
import { StickyNote } from '../../types';

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

    const truncateText = (text: string, maxLength: number = 50): string => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    if (isActive) {
      return (
        <textarea
          ref={ref}
          className="note-content"
          value={note.content}
          onChange={handleChange}
          onBlur={onBlur}
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
          color: note.content ? 'inherit' : 'rgba(0, 0, 0, 0.4)'
        }}
      >
        {note.content ? truncateText(note.content) : '空の付箋'}
      </div>
    );
  }
);