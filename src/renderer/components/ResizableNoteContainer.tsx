import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StickyNote } from '../../types';

interface ResizableNoteContainerProps {
  note: StickyNote;
  isActive: boolean;
  onResize: (width: number, height: number) => void;
  children: React.ReactNode;
}

interface ResizeHandle {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'right' | 'bottom' | 'left';
  cursor: string;
}

const RESIZE_HANDLES: ResizeHandle[] = [
  { position: 'top-left', cursor: 'nw-resize' },
  { position: 'top-right', cursor: 'ne-resize' },
  { position: 'bottom-left', cursor: 'sw-resize' },
  { position: 'bottom-right', cursor: 'se-resize' },
  { position: 'top', cursor: 'n-resize' },
  { position: 'right', cursor: 'e-resize' },
  { position: 'bottom', cursor: 's-resize' },
  { position: 'left', cursor: 'w-resize' }
];

const MIN_WIDTH = 150;
const MIN_HEIGHT = 100;

export const ResizableNoteContainer: React.FC<ResizableNoteContainerProps> = ({
  note,
  isActive,
  onResize,
  children
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent, handle: string) => {
    if (!isActive) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    setResizeHandle(handle);
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      startPositionRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: rect.width,
        height: rect.height
      };
    }
  }, [isActive]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeHandle || !containerRef.current) return;

    const deltaX = e.clientX - startPositionRef.current.x;
    const deltaY = e.clientY - startPositionRef.current.y;
    
    let newWidth = startPositionRef.current.width;
    let newHeight = startPositionRef.current.height;

    switch (resizeHandle) {
      case 'right':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width + deltaX);
        break;
      case 'bottom':
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height + deltaY);
        break;
      case 'left':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width - deltaX);
        break;
      case 'top':
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height - deltaY);
        break;
      case 'bottom-right':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width + deltaX);
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height + deltaY);
        break;
      case 'bottom-left':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width - deltaX);
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height + deltaY);
        break;
      case 'top-right':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width + deltaX);
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height - deltaY);
        break;
      case 'top-left':
        newWidth = Math.max(MIN_WIDTH, startPositionRef.current.width - deltaX);
        newHeight = Math.max(MIN_HEIGHT, startPositionRef.current.height - deltaY);
        break;
    }

    // リアルタイムでサイズを更新
    containerRef.current.style.width = `${newWidth}px`;
    containerRef.current.style.height = `${newHeight}px`;
  }, [isResizing, resizeHandle]);

  const handleMouseUp = useCallback(() => {
    if (!isResizing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    onResize(rect.width, rect.height);
    
    setIsResizing(false);
    setResizeHandle(null);
  }, [isResizing, onResize]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = resizeHandle?.includes('resize') ? 
        RESIZE_HANDLES.find(h => h.position === resizeHandle)?.cursor || 'default' : 'default';
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp, resizeHandle]);

  const currentWidth = isActive ? note.activeWidth : note.inactiveWidth;
  const currentHeight = isActive ? note.activeHeight : note.inactiveHeight;

  return (
    <div
      ref={containerRef}
      className={`resizable-note-container ${isActive ? 'active-mode' : 'stay-mode'}`}
      style={{
        width: `${currentWidth}px`,
        height: `${currentHeight}px`,
        position: 'relative'
      }}
    >
      {children}
      
      {isActive && RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.position}
          className={`resize-handle resize-handle-${handle.position}`}
          style={{
            cursor: handle.cursor,
            position: 'absolute',
            zIndex: 1000
          }}
          onMouseDown={(e) => handleMouseDown(e, handle.position)}
        />
      ))}
    </div>
  );
};