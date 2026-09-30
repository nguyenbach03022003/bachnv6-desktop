import { Mascot } from 'page-mascot';

import foxDirections from '../assets/mascots/fox-directions.webp';
import foxReactions from '../assets/mascots/fox-reactions.webp';
import styles from './MascotWidget.module.css';

export type MascotWidgetProps = {
  className?: string;
  /** The character size in CSS pixels. */
  size?: number;
  /** Use in a transparent mascot window without dashboard card styling. */
  mode?: 'embedded' | 'overlay';
};

/** Fox sprite sheets are bundled from nilbuild/page-mascot, under its MIT license. */
export function MascotWidget({
  className,
  size,
  mode = 'embedded',
}: MascotWidgetProps) {
  const isOverlay = mode === 'overlay';
  const classNames = [styles.widget, isOverlay && styles.overlay, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      <Mascot
        directions={foxDirections}
        reactions={foxReactions}
        size={size ?? (isOverlay ? 140 : 96)}
        label="fox"
        className={styles.mascot}
      />
      {!isOverlay && <span className={styles.caption}>Desk companion</span>}
    </div>
  );
}
