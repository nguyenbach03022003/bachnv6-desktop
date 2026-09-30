import type { ITheme } from '@xterm/xterm';

export type AppTheme = 'light' | 'dark';
const STORAGE_KEY = 'desktop-theme';

export function readTheme(): AppTheme {
  try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); }
  catch { /* The theme still works when browser storage is unavailable. */ }
}

export const terminalThemes: Record<AppTheme, ITheme> = {
  light: {
    background: '#fff0df', foreground: '#422c21', cursor: '#a34616', cursorAccent: '#fff0df',
    selectionBackground: '#eab48399', selectionInactiveBackground: '#eab48355',
    selectionForeground: '#352218',
    black: '#352218', red: '#ad302c', green: '#39612e', yellow: '#805514',
    blue: '#285b91', magenta: '#814681', cyan: '#246566', white: '#665044',
    brightBlack: '#796052', brightRed: '#b8362f', brightGreen: '#416b31',
    brightYellow: '#8a5815', brightBlue: '#32679d', brightMagenta: '#8c4c88',
    brightCyan: '#2a6e70', brightWhite: '#422c21',
  },
  dark: {
    background: '#0c121a', foreground: '#d4e0e9', cursor: '#b9e596',
    selectionBackground: '#627e70aa',
    black: '#17212b', red: '#e58c90', green: '#a9d878', yellow: '#e4c78a',
    blue: '#87b8df', magenta: '#c3a5de', cyan: '#86cbca', white: '#d4e0e9',
    brightBlack: '#6f8291', brightRed: '#f4a3a7', brightGreen: '#c5e6a4',
    brightYellow: '#f3dca7', brightBlue: '#a9d2f2', brightMagenta: '#ddc2f1',
    brightCyan: '#a8e3df', brightWhite: '#f4f8fa',
  },
};
