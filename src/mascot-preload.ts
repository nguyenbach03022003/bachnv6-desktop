import { contextBridge, ipcRenderer } from 'electron';
import type { MascotCursorPoint, MascotOverlayBridge } from './mascot-protocol';

const mascotOverlay: MascotOverlayBridge = {
  onCursor: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const point = value as Partial<MascotCursorPoint>;
      if (typeof point.x !== 'number' || typeof point.y !== 'number' ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      listener({ x: point.x, y: point.y });
    };
    ipcRenderer.on('mascot:cursor', callback);
    return () => ipcRenderer.removeListener('mascot:cursor', callback);
  },
};

contextBridge.exposeInMainWorld('mascotOverlay', mascotOverlay);
