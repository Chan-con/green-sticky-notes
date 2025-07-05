import React from 'react';
import { createRoot } from 'react-dom/client';
import { StickyNoteApp } from './components/StickyNoteApp';
import { SettingsApp } from './components/SettingsApp';
import './styles/global.css';

const container = document.getElementById('root');
const root = createRoot(container!);

// URLパラメータをチェックして適切なコンポーネントを表示
const urlParams = new URLSearchParams(window.location.search);
const isSettingsPage = urlParams.get('settings') === 'true';

root.render(isSettingsPage ? <SettingsApp /> : <StickyNoteApp />);