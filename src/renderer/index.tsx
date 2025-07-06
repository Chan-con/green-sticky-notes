import React from 'react';
import { createRoot } from 'react-dom/client';
import { StickyNoteApp } from './components/StickyNoteApp';
import { SettingsApp } from './components/SettingsApp';
import { SearchApp } from './components/SearchApp';
import './styles/global.css';
import './styles/search.css';

const container = document.getElementById('root');
const root = createRoot(container!);

// URLパラメータをチェックして適切なコンポーネントを表示
const urlParams = new URLSearchParams(window.location.search);
const isSettingsPage = urlParams.get('settings') === 'true';
const isSearchPage = urlParams.get('search') === 'true';

// 適切なアプリコンポーネントを選択
let AppComponent;
if (isSettingsPage) {
  AppComponent = <SettingsApp />;
} else if (isSearchPage) {
  AppComponent = <SearchApp />;
} else {
  AppComponent = <StickyNoteApp />;
}

root.render(AppComponent);