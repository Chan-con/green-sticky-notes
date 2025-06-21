import React from 'react';
import { createRoot } from 'react-dom/client';
import { StickyNoteApp } from './components/StickyNoteApp';
import './styles/global.css';

const container = document.getElementById('root');
const root = createRoot(container!);

root.render(<StickyNoteApp />);