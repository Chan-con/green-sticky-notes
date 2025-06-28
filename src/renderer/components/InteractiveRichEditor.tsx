import React, { useRef, useCallback, useState, useEffect } from 'react';
import { ContentBlock, RichContent, StickyNote } from '../../types';

interface InteractiveRichEditorProps {
  note: StickyNote;
  isActive: boolean;
  onContentChange: (content: RichContent) => void;
  onBlur: () => void;
}

interface ContentLine {
  type: 'text' | 'image';
  id: string;
  content: string;
  metadata?: any;
}

export const InteractiveRichEditor: React.FC<InteractiveRichEditorProps> = ({
  note,
  isActive,
  onContentChange,
  onBlur
}) => {
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [isEditingText, setIsEditingText] = useState(false);

  // content を行ベースの構造に変換
  const getContentLines = useCallback((): ContentLine[] => {
    let richContent: RichContent;
    
    if (typeof note.content === 'string') {
      richContent = {
        blocks: note.content ? [{
          id: `text-${Date.now()}`,
          type: 'text',
          content: note.content
        }] : []
      };
    } else {
      richContent = note.content;
    }

    const lines: ContentLine[] = [];
    let textLines: string[] = [];
    
    // テキストブロックを行に分割
    richContent.blocks.forEach(block => {
      if (block.type === 'text') {
        textLines = textLines.concat(block.content.split('\n'));
      }
    });

    // 画像ブロックを収集
    const imageBlocks = richContent.blocks.filter(block => block.type === 'image');

    // テキスト行を追加
    textLines.forEach((line, index) => {
      lines.push({
        type: 'text',
        id: `text-line-${index}`,
        content: line
      });
    });

    // 画像を最後に追加（後で位置調整可能）
    imageBlocks.forEach(block => {
      lines.push({
        type: 'image',
        id: block.id,
        content: block.content,
        metadata: block.metadata
      });
    });

    return lines;
  }, [note.content]);

  const [contentLines, setContentLines] = useState<ContentLine[]>(getContentLines());

  useEffect(() => {
    setContentLines(getContentLines());
  }, [getContentLines]);

  // 行ベース構造をRichContentに変換
  const linesToRichContent = useCallback((lines: ContentLine[]): RichContent => {
    const textLines = lines.filter(line => line.type === 'text').map(line => line.content);
    const imageBlocks = lines.filter(line => line.type === 'image');

    const blocks: ContentBlock[] = [];

    // テキストブロックを作成
    if (textLines.length > 0) {
      blocks.push({
        id: `text-${Date.now()}`,
        type: 'text',
        content: textLines.join('\n')
      });
    }

    // 画像ブロックを追加
    imageBlocks.forEach(line => {
      blocks.push({
        id: line.id,
        type: 'image',
        content: line.content,
        metadata: line.metadata
      });
    });

    return { blocks };
  }, []);

  // コンテンツ更新
  const updateContent = useCallback((newLines: ContentLine[]) => {
    setContentLines(newLines);
    const richContent = linesToRichContent(newLines);
    onContentChange(richContent);
  }, [linesToRichContent, onContentChange]);

  // テキスト行の変更
  const updateTextLine = useCallback((lineIndex: number, newText: string) => {
    const newLines = [...contentLines];
    if (newLines[lineIndex] && newLines[lineIndex].type === 'text') {
      newLines[lineIndex] = { ...newLines[lineIndex], content: newText };
      updateContent(newLines);
    }
  }, [contentLines, updateContent]);

  // 新しいテキスト行を追加
  const addTextLine = useCallback((afterIndex: number) => {
    const newLines = [...contentLines];
    newLines.splice(afterIndex + 1, 0, {
      type: 'text',
      id: `text-line-${Date.now()}`,
      content: ''
    });
    updateContent(newLines);
  }, [contentLines, updateContent]);

  // 画像を削除
  const removeImage = useCallback((imageId: string) => {
    const newLines = contentLines.filter(line => line.id !== imageId);
    updateContent(newLines);
  }, [contentLines, updateContent]);

  // 画像を更新
  const updateImage = useCallback((imageId: string, updates: any) => {
    const newLines = contentLines.map(line =>
      line.id === imageId ? { ...line, metadata: { ...line.metadata, ...updates } } : line
    );
    updateContent(newLines);
  }, [contentLines, updateContent]);

  // 画像を指定位置に移動
  const moveImageToPosition = useCallback((imageId: string, targetIndex: number) => {
    const newLines = [...contentLines];
    const imageIndex = newLines.findIndex(line => line.id === imageId);
    
    if (imageIndex !== -1) {
      const [imageItem] = newLines.splice(imageIndex, 1);
      newLines.splice(targetIndex, 0, imageItem);
      updateContent(newLines);
    }
  }, [contentLines, updateContent]);

  // ファイルを画像として読み込む
  const readFileAsImage = useCallback((file: File): Promise<ContentLine> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Not an image file'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            type: 'image',
            id: `image-${Date.now()}-${Math.random()}`,
            content: e.target?.result as string,
            metadata: {
              width: Math.min(img.width, 300),
              height: Math.min(img.height, 300 * (img.height / img.width)),
              alt: file.name,
              originalName: file.name
            }
          });
        };
        img.onerror = () => reject(new Error('Invalid image file'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  // ドラッグ&ドロップ処理
  const handleDrop = useCallback(async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDropTargetIndex(null);
    
    if (!isActive) return;

    // 内部画像の移動
    if (draggedImageId) {
      moveImageToPosition(draggedImageId, dropIndex);
      setDraggedImageId(null);
      return;
    }

    // 外部ファイルの処理
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      try {
        for (const file of imageFiles) {
          const imageLine = await readFileAsImage(file);
          const newLines = [...contentLines];
          newLines.splice(dropIndex, 0, imageLine);
          updateContent(newLines);
        }
      } catch (error) {
        console.error('Failed to process image files:', error);
      }
    }
  }, [isActive, draggedImageId, moveImageToPosition, contentLines, updateContent, readFileAsImage]);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  // 画像ドラッグ開始
  const handleImageDragStart = useCallback((e: React.DragEvent, imageId: string) => {
    setDraggedImageId(imageId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // 画像ドラッグ終了
  const handleImageDragEnd = useCallback(() => {
    setDraggedImageId(null);
    setDropTargetIndex(null);
  }, []);

  // クリップボード処理
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    
    if (imageItems.length > 0 && isActive) {
      e.preventDefault();
      
      try {
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) {
            const imageLine = await readFileAsImage(file);
            const newLines = [...contentLines, imageLine];
            updateContent(newLines);
          }
        }
      } catch (error) {
        console.error('Failed to process clipboard images:', error);
      }
    }
  }, [isActive, readFileAsImage, contentLines, updateContent]);

  // 非アクティブ時の表示用テキスト取得
  const getDisplayText = useCallback((): string => {
    const textLines = contentLines.filter(line => line.type === 'text');
    const text = textLines.map(line => line.content).join(' ');
    return text.length > 50 ? text.substring(0, 50) + '...' : text || '空の付箋';
  }, [contentLines]);

  // アクティブ時
  if (isActive) {
    return (
      <div 
        className="interactive-rich-editor"
        style={{ 
          flex: 1,
          padding: '12px',
          fontSize: `${note.fontSize}px`,
          lineHeight: '1.4',
          overflowY: 'auto'
        }}
        onPaste={handlePaste}
      >
        {contentLines.map((line, index) => (
          <div key={`line-${index}`} style={{ position: 'relative' }}>
            {/* ドロップゾーン */}
            <div
              style={{
                height: '4px',
                background: dropTargetIndex === index ? 'var(--green-dark)' : 'transparent',
                margin: '2px 0',
                borderRadius: '2px',
                transition: 'background 0.2s'
              }}
              onDrop={(e) => handleDrop(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
            />
            
            {line.type === 'text' ? (
              <input
                type="text"
                value={line.content}
                onChange={(e) => updateTextLine(index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTextLine(index);
                  }
                }}
                onBlur={onBlur}
                placeholder={index === 0 ? "付箋の内容を入力..." : ""}
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                  padding: '2px 0',
                  lineHeight: 'inherit'
                }}
              />
            ) : (
              <div
                style={{ 
                  display: 'inline-block',
                  position: 'relative',
                  margin: '4px 0',
                  maxWidth: '100%'
                }}
                draggable
                onDragStart={(e) => handleImageDragStart(e, line.id)}
                onDragEnd={handleImageDragEnd}
              >
                <img
                  src={line.content}
                  alt={line.metadata?.alt || 'Image'}
                  style={{
                    maxWidth: '100%',
                    width: `${line.metadata?.width || 200}px`,
                    height: `${line.metadata?.height || 150}px`,
                    objectFit: 'contain',
                    borderRadius: '4px',
                    border: draggedImageId === line.id ? '2px dashed var(--green-dark)' : '1px solid #ddd',
                    cursor: 'move',
                    opacity: draggedImageId === line.id ? 0.6 : 1
                  }}
                />
                
                {/* 削除ボタン */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(line.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    width: '20px',
                    height: '20px',
                    background: '#ff4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    fontSize: '12px',
                    lineHeight: '1'
                  }}
                  title="画像を削除"
                >
                  ×
                </button>
                
                {/* リサイズハンドル */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    width: '12px',
                    height: '12px',
                    background: 'var(--green-dark)',
                    border: '2px solid white',
                    borderRadius: '50%',
                    cursor: 'se-resize'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const startX = e.clientX;
                    const startWidth = line.metadata?.width || 200;
                    const startHeight = line.metadata?.height || 150;
                    const aspectRatio = startWidth / startHeight;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const deltaX = moveEvent.clientX - startX;
                      const newWidth = Math.max(50, startWidth + deltaX);
                      const newHeight = newWidth / aspectRatio;

                      updateImage(line.id, {
                        width: newWidth,
                        height: newHeight
                      });
                    };

                    const handleMouseUp = () => {
                      document.removeEventListener('mousemove', handleMouseMove);
                      document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                  }}
                />
              </div>
            )}
          </div>
        ))}
        
        {/* 最後のドロップゾーン */}
        <div
          style={{
            height: '8px',
            background: dropTargetIndex === contentLines.length ? 'var(--green-dark)' : 'transparent',
            margin: '4px 0',
            borderRadius: '2px',
            transition: 'background 0.2s'
          }}
          onDrop={(e) => handleDrop(e, contentLines.length)}
          onDragOver={(e) => handleDragOver(e, contentLines.length)}
          onDragLeave={handleDragLeave}
        />
      </div>
    );
  }

  // 非アクティブ時
  const imageCount = contentLines.filter(line => line.type === 'image').length;
  
  return (
    <div
      className="interactive-rich-editor inactive"
      style={{
        flex: 1,
        padding: '12px',
        fontSize: '12px',
        color: contentLines.length > 0 ? 'inherit' : 'rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      {contentLines.length > 0 ? (
        <div>
          {getDisplayText()}
          {imageCount > 0 && (
            <span style={{ fontSize: '11px', color: 'rgba(0, 0, 0, 0.6)' }}>
              {' '}📷 {imageCount}
            </span>
          )}
        </div>
      ) : (
        '空の付箋'
      )}
    </div>
  );
};