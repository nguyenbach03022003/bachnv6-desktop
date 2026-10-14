import { useEffect, useRef, useState } from 'react';
import styles from './ImageViewer.module.css';

export function ImageViewer() {
  const [image, setImage] = useState<{ name: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let active = true;
    void window.dashboard?.notesWorkspace.getImage().then((value) => {
      if (active) { setImage(value); document.title = value.name; }
    }).catch(() => { if (active) setError('Could not load this image.'); });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.dashboard?.close();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'desktop-theme') document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function changeZoom(multiplier: number) {
    const current = zoom ?? (dimensions.width && imageRef.current ? Math.min(
      imageRef.current.clientWidth / dimensions.width, imageRef.current.clientHeight / dimensions.height,
    ) : 1);
    setZoom(Math.min(4, Math.max(.1, current * multiplier)));
  }

  return <main className={styles.viewer} aria-label="Image viewer">
    <header className={styles.toolbar}>
      <span className={styles.name} title={image?.name}>{image?.name ?? 'Image'}</span>
      <div className={styles.actions}>
        <button type="button" disabled={!dimensions.width} aria-label="Zoom out" onClick={() => changeZoom(1 / 1.25)}>−</button>
        <span role="status" className={styles.zoom}>{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
        <button type="button" disabled={!dimensions.width} aria-label="Zoom in" onClick={() => changeZoom(1.25)}>+</button>
        <button type="button" aria-pressed={zoom === null} onClick={() => setZoom(null)}>Fit to window</button>
        <button type="button" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>Actual size</button>
      </div>
    </header>
    <div className={`${styles.stage} ${zoom === null ? styles.fit : ''}`}>
      {error ? <p className={styles.message} role="alert">{error}</p> : !image ? <p className={styles.message} role="status">Loading image…</p> :
        <div className={styles.canvas}>
          <img ref={imageRef} src={image.source} alt={image.name} draggable={false}
            style={zoom !== null && dimensions.width ? { width: dimensions.width * zoom, height: dimensions.height * zoom } : undefined}
            onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setError('This image could not be displayed.')} />
        </div>}
    </div>
    <footer className={styles.footer}>
      <span>{dimensions.width ? `${dimensions.width.toLocaleString('en')} × ${dimensions.height.toLocaleString('en')} pixels` : ''}</span>
      <span>Scroll to explore · Esc to close</span>
    </footer>
  </main>;
}
