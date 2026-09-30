/** The editor stores its document as JSON; HTML is never persisted or sent over IPC. */
export interface NoteContentNode {
  type: string;
  content?: NoteContentNode[];
  text?: string;
  marks?: Array<{ type: string }>;
  attrs?: Record<string, unknown>;
}

export interface NoteContent extends NoteContentNode {
  type: 'doc';
}

export type NoteColor = 'amber' | 'violet' | 'mint';

export interface NoteAttachment {
  id: string;
  name: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  createdAt: string;
}

export interface StickyNote {
  id: string;
  color: NoteColor;
  content: NoteContent;
  attachments: NoteAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface NotePatch {
  color?: NoteColor;
  content?: NoteContent;
}

/** The preload exposes only these fixed operations to the dashboard renderer. */
export interface NotesApi {
  list(): Promise<StickyNote[]>;
  create(): Promise<StickyNote>;
  update(id: string, patch: NotePatch): Promise<StickyNote>;
  remove(id: string): Promise<void>;
  pickAttachment(id: string): Promise<NoteAttachment | null>;
  readAttachment(id: string, attachmentId: string): Promise<string>;
  removeAttachment(id: string, attachmentId: string): Promise<void>;
}
