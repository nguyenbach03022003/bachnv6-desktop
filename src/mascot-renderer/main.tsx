import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MascotWidget } from '../renderer/MascotWidget';
import './overlay.css';

function MascotOverlay() {
  useEffect(() => window.mascotOverlay?.onCursor(({ x, y }) => {
    // page-mascot listens for window pointermove; the preload only passes
    // window-local coordinates from Electron's main process.
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: x,
      clientY: y,
      pointerType: 'mouse',
    }));
  }), []);

  return (
    <div className="overlay">
      <div className="drag-handle" title="Drag to move the desk companion">
        <span className="drag-dots" aria-hidden="true">⠿</span>
        <span>Move companion</span>
      </div>
      <MascotWidget mode="overlay" size={140} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<MascotOverlay />);
