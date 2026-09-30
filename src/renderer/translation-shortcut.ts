export const TRANSLATE_SELECTION_SHORTCUT = 'Ctrl+T';
export const TRANSLATE_SELECTION_ARIA_SHORTCUT = 'Control+T';

export function isTranslateSelectionShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
    && !event.isComposing && !event.getModifierState('AltGraph')
    && (event.code === 'KeyT' || event.key.toLowerCase() === 't');
}
