import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, readTheme } from './theme';
import { NotesWindow } from './NotesWorkspace';
import { ImageViewer } from './ImageViewer';
import { InputLanguageProvider } from './InputLanguage';

applyTheme(readTheme());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <React.StrictMode>
    <InputLanguageProvider>
      {window.location.hash === '#notes' ? <NotesWindow /> : window.location.hash === '#image' ? <ImageViewer /> : <App />}
    </InputLanguageProvider>
  </React.StrictMode>,
);
