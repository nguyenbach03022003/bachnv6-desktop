export interface NotesContext {
  selectedId: string | null;
  space: 'notes' | 'vocabulary';
}

export interface NotesWorkspaceState extends NotesContext {
  detached: boolean;
}

export interface NotesWorkspaceApi {
  getState(): Promise<NotesWorkspaceState>;
  detach(context: NotesContext): Promise<void>;
  merge(): Promise<void>;
  focus(): Promise<void>;
  setContext(context: NotesContext): Promise<void>;
  onStateChanged(listener: (state: NotesWorkspaceState) => void): () => void;
  onMergeRequested(listener: () => void): () => void;
  openImage(noteId: string, attachmentId: string): Promise<void>;
  getImage(): Promise<{ name: string; source: string }>;
}
