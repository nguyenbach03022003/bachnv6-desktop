declare module '@viettelex/core' {
  export interface TypingAction { kind: number; backspaces: number; insert: string }
  export class VietTelexEngine {
    feed(character: string): TypingAction;
    backspace(): TypingAction;
    commitBoundary(): TypingAction;
    reset(): void;
    resetContext(): void;
    destroy(): void;
  }
  export interface FieldHandle { (): void; setEnabled(enabled: boolean): void }
  export const REPLACE: number;
  export const PASSTHROUGH: number;
  export function loadModule(): Promise<unknown>;
  export function createEngine(options?: { inputMethod?: 'telex'; modernTone?: boolean }): Promise<VietTelexEngine>;
  export function attach(element: HTMLElement, options: { enabled: boolean; inputMethod: 'telex'; modernTone: boolean; toggleKey: null }): Promise<FieldHandle>;
}
