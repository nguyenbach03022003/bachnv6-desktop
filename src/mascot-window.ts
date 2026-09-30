import path from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron';
import { MASCOT_TRAY_ICON_DATA_URL } from './mascot-tray-icon';

declare const MASCOT_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MASCOT_WINDOW_VITE_NAME: string;

const WIDTH = 160;
const HEIGHT = 176;
const EDGE_GAP = 12;
const CURSOR_INTERVAL_MS = 50;

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type MascotOverlayController = {
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  dispose: () => void;
};

export type MascotOverlayOptions = {
  /** Restore the existing dashboard, or create it again if it was closed. */
  openDashboard: () => void;
};

/** Native cursor position and programmatic window placement are unavailable on Wayland. */
export function canUseMascotOverlay(): boolean {
  if (process.platform === 'win32') return true;
  if (process.platform !== 'linux') return false;

  const ozonePlatform = app.commandLine.getSwitchValue('ozone-platform').toLowerCase();
  if (ozonePlatform === 'x11') return true;
  if (ozonePlatform === 'wayland') return false;
  return process.env.XDG_SESSION_TYPE?.toLowerCase() !== 'wayland' &&
    !process.env.WAYLAND_DISPLAY;
}

function cornerPosition(display: Electron.Display, corner: Corner) {
  const { workArea } = display;
  const right = workArea.x + Math.max(0, workArea.width - WIDTH - EDGE_GAP);
  const bottom = workArea.y + Math.max(0, workArea.height - HEIGHT - EDGE_GAP);
  return {
    x: corner.endsWith('right') ? right : workArea.x + EDGE_GAP,
    y: corner.startsWith('bottom') ? bottom : workArea.y + EDGE_GAP,
  };
}

function closestCorner(bounds: Electron.Rectangle, display: Electron.Display): Corner {
  const { workArea } = display;
  const isRight = bounds.x + bounds.width / 2 >= workArea.x + workArea.width / 2;
  const isBottom = bounds.y + bounds.height / 2 >= workArea.y + workArea.height / 2;
  return `${isBottom ? 'bottom' : 'top'}-${isRight ? 'right' : 'left'}` as Corner;
}

/** Call after app.whenReady(). Returns null on Wayland and unsupported platforms. */
export function createMascotOverlay(options: MascotOverlayOptions): MascotOverlayController | null {
  if (!canUseMascotOverlay()) return null;
  if (!app.isReady()) throw new Error('Create the mascot overlay after app.whenReady()');

  let overlayWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let cursorTimer: ReturnType<typeof setInterval> | null = null;
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let corner: Corner = 'bottom-right';
  let shouldShow = true;
  let loaded = false;
  let disposed = false;
  let quitting = false;

  function stopPolling() {
    if (cursorTimer) clearInterval(cursorTimer);
    cursorTimer = null;
    lastPointer = null;
  }

  function pollCursor() {
    const window = overlayWindow;
    if (!window || window.isDestroyed() || !window.isVisible() || window.webContents.isLoading()) return;

    // Both screen.getCursorScreenPoint and BrowserWindow bounds use DIP coordinates.
    let pointer: Electron.Point;
    try {
      pointer = screen.getCursorScreenPoint();
    } catch (error) {
      console.warn('Desktop cursor tracking is unavailable; stopping mascot polling', error);
      stopPolling();
      return;
    }
    const bounds = window.getBounds();
    const local = { x: pointer.x - bounds.x, y: pointer.y - bounds.y };
    if (lastPointer?.x === local.x && lastPointer.y === local.y) return;
    lastPointer = local;
    window.webContents.send('mascot:cursor', local);
  }

  function startPolling() {
    if (!cursorTimer) cursorTimer = setInterval(pollCursor, CURSOR_INTERVAL_MS);
    pollCursor();
  }

  function refreshTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open dashboard', click: options.openDashboard },
      { type: 'separator' },
      { label: 'Show mascot', type: 'checkbox', checked: shouldShow, click: ({ checked }) => {
        if (checked) show();
        else hide();
      } },
      {
        label: 'Move mascot to corner',
        submenu: [
          { label: 'Top left', click: () => moveToCorner('top-left') },
          { label: 'Top right', click: () => moveToCorner('top-right') },
          { label: 'Bottom left', click: () => moveToCorner('bottom-left') },
          { label: 'Bottom right', click: () => moveToCorner('bottom-right') },
        ],
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  }

  function moveToCorner(nextCorner: Corner) {
    corner = nextCorner;
    const window = overlayWindow;
    if (!window || window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    const position = cornerPosition(display, corner);
    const [x, y] = window.getPosition();
    if (x !== position.x || y !== position.y) window.setPosition(position.x, position.y);
  }

  function snapAfterDrag() {
    const window = overlayWindow;
    if (!window || window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    corner = closestCorner(window.getBounds(), display);
    moveToCorner(corner);
  }

  function scheduleSnapAfterDrag() {
    if (snapTimer) clearTimeout(snapTimer);
    // X11 has `move` but not the Windows `moved` end-of-drag event.
    snapTimer = setTimeout(() => {
      snapTimer = null;
      snapAfterDrag();
    }, 350);
  }

  function showLoadedWindow(window: BrowserWindow) {
    if (disposed || !shouldShow || window.isDestroyed()) return;
    window.showInactive();
    startPolling();
    refreshTrayMenu();
  }

  function createWindow(): BrowserWindow {
    const position = cornerPosition(screen.getPrimaryDisplay(), corner);
    const window = new BrowserWindow({
      x: position.x,
      y: position.y,
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      title: 'Desk companion',
      webPreferences: {
        preload: path.join(__dirname, 'mascot-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    overlayWindow = window;
    loaded = false;
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('close', (event) => {
      if (!quitting && !disposed && tray) {
        event.preventDefault();
        hide();
      }
    });
    window.on('closed', () => {
      if (overlayWindow === window) overlayWindow = null;
      loaded = false;
      stopPolling();
    });
    if (process.platform === 'win32') window.on('moved', snapAfterDrag);
    else window.on('move', scheduleSnapAfterDrag);

    const load = MASCOT_WINDOW_VITE_DEV_SERVER_URL
      ? window.loadURL(MASCOT_WINDOW_VITE_DEV_SERVER_URL)
      : window.loadFile(path.join(__dirname, `../renderer/${MASCOT_WINDOW_VITE_NAME}/index.html`));
    void load.then(() => {
      loaded = true;
      showLoadedWindow(window);
    }).catch((error: unknown) => {
      console.error('Could not load mascot overlay', error);
      if (!window.isDestroyed()) window.destroy();
    });
    return window;
  }

  function show() {
    if (disposed) return;
    shouldShow = true;
    const window = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : createWindow();
    if (loaded) showLoadedWindow(window);
    refreshTrayMenu();
  }

  function hide() {
    shouldShow = false;
    stopPolling();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    refreshTrayMenu();
  }

  function onDisplaysChanged() {
    moveToCorner(corner);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    quitting = true;
    stopPolling();
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = null;
    app.removeListener('before-quit', dispose);
    screen.removeListener('display-added', onDisplaysChanged);
    screen.removeListener('display-removed', onDisplaysChanged);
    screen.removeListener('display-metrics-changed', onDisplaysChanged);
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    overlayWindow = null;
    tray?.destroy();
    tray = null;
  }

  app.on('before-quit', dispose);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  const icon = nativeImage.createFromDataURL(MASCOT_TRAY_ICON_DATA_URL);
  if (!icon.isEmpty()) {
    try {
      tray = new Tray(icon);
      tray.setToolTip('Bachnv6 desk companion');
      tray.on('double-click', options.openDashboard);
      refreshTrayMenu();
    } catch (error) {
      console.warn('System tray is unavailable; mascot window remains available', error);
    }
  } else {
    console.warn('Mascot tray icon could not be loaded');
  }

  show();
  return { show, hide, isVisible: () => !!overlayWindow?.isVisible(), dispose };
}
