export type MascotCursorPoint = { x: number; y: number };

export type MascotOverlayBridge = {
  /** Cursor coordinates relative to the mascot window, in CSS/DIP pixels. */
  onCursor: (listener: (point: MascotCursorPoint) => void) => () => void;
};

declare global {
  interface Window {
    mascotOverlay?: MascotOverlayBridge;
  }
}
