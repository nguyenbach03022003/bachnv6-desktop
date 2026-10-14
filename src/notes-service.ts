import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type {
  NoteAttachment,
  NoteColor,
  NoteContent,
  NoteContentNode,
  NotePatch,
  StickyNote,
} from './shared/notes-types';

const MAX_NOTES = 200;
const MAX_ATTACHMENTS_PER_NOTE = 20;
const MAX_NOTE_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS: NoteColor[] = ['amber', 'violet', 'mint'];
const NODE_TYPES = new Set([
  'doc', 'paragraph', 'text', 'bulletList', 'orderedList', 'listItem', 'hardBreak',
  'heading', 'blockquote', 'codeBlock', 'horizontalRule',
]);
const MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'underline']);

interface NotesFile {
  version: 1;
  notes: StickyNote[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('Invalid note identifier');
  }
  return value;
}

function normalizeContent(value: unknown): NoteContent {
  if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > MAX_NOTE_JSON_BYTES) {
    throw new Error('Note is too large');
  }

  let nodeCount = 0;
  function visit(raw: unknown, depth: number): NoteContentNode {
    if (!isRecord(raw) || typeof raw.type !== 'string' || !NODE_TYPES.has(raw.type)) {
      throw new Error('Unsupported note content');
    }
    nodeCount += 1;
    if (depth > 32 || nodeCount > 5000) throw new Error('Note is too complex');

    const node: NoteContentNode = { type: raw.type };
    if (raw.type === 'text') {
      if (typeof raw.text !== 'string') throw new Error('Invalid note text');
      node.text = raw.text;
      if (raw.marks !== undefined) {
        if (!Array.isArray(raw.marks)) throw new Error('Invalid note formatting');
        node.marks = raw.marks.map((mark) => {
          if (!isRecord(mark) || typeof mark.type !== 'string' || !MARK_TYPES.has(mark.type)) {
            throw new Error('Unsupported note formatting');
          }
          return { type: mark.type };
        });
      }
      return node;
    }

    if (raw.type === 'heading') {
      const attrs = raw.attrs;
      const level = isRecord(attrs) ? attrs.level : undefined;
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6) {
        throw new Error('Invalid heading level');
      }
      node.attrs = { level };
    } else if (raw.type === 'orderedList') {
      const attrs = raw.attrs;
      const start = isRecord(attrs) ? attrs.start : undefined;
      if (start !== undefined && (!Number.isInteger(start) || (start as number) < 1 || (start as number) > 100000)) {
        throw new Error('Invalid list start');
      }
      if (start !== undefined) node.attrs = { start };
    }

    if (raw.content !== undefined) {
      if (!Array.isArray(raw.content)) throw new Error('Invalid note content');
      node.content = raw.content.map((child) => visit(child, depth + 1));
    }
    return node;
  }

  const document = visit(value, 0);
  if (document.type !== 'doc') throw new Error('Invalid note document');
  return document as NoteContent;
}

function normalizeAttachment(raw: unknown): NoteAttachment {
  if (!isRecord(raw)) throw new Error('Invalid attachment metadata');
  const id = requireId(raw.id);
  const mediaType = raw.mediaType;
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') {
    throw new Error('Unsupported attachment type');
  }
  if (typeof raw.name !== 'string' || raw.name.length > 255 || typeof raw.createdAt !== 'string'
    || !Number.isInteger(raw.byteLength) || (raw.byteLength as number) < 1 || (raw.byteLength as number) > MAX_IMAGE_BYTES) {
    throw new Error('Invalid attachment metadata');
  }
  return {
    id,
    name: raw.name,
    mediaType,
    byteLength: raw.byteLength as number,
    createdAt: raw.createdAt,
  };
}

function normalizeNote(raw: unknown): StickyNote {
  if (!isRecord(raw)) throw new Error('Invalid stored note');
  const id = requireId(raw.id);
  if (!COLORS.includes(raw.color as NoteColor) || typeof raw.createdAt !== 'string'
    || typeof raw.updatedAt !== 'string' || !Array.isArray(raw.attachments)
    || raw.attachments.length > MAX_ATTACHMENTS_PER_NOTE) {
    throw new Error('Invalid stored note');
  }
  return {
    id,
    color: raw.color as NoteColor,
    content: normalizeContent(raw.content),
    attachments: raw.attachments.map(normalizeAttachment),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function imageFormat(bytes: Buffer): { mediaType: NoteAttachment['mediaType']; extension: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mediaType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function extensionFor(mediaType: NoteAttachment['mediaType']): string {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
  }
}

/** Register a narrow, dashboard-only IPC surface for local notes. Call once after app.whenReady(). */
export function registerNotesIpc(getDashboardWindow: () => BrowserWindow | null): {
  readImage(noteId: unknown, attachmentId: unknown): Promise<{ name: string; source: string }>;
} {
  const notesDir = path.join(app.getPath('userData'), 'notes');
  const notesPath = path.join(notesDir, 'notes.json');
  const attachmentDir = path.join(notesDir, 'attachments');
  let loadedNotes: StickyNote[] | null = null;
  let operationTail: Promise<unknown> = Promise.resolve();

  function assertDashboardSender(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getDashboardWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown window');
    }
    return window;
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation);
    operationTail = result.catch(() => undefined);
    return result;
  }

  async function load(): Promise<StickyNote[]> {
    if (loadedNotes) return loadedNotes;
    let json: string;
    try {
      json = await fs.readFile(notesPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        loadedNotes = [];
        return loadedNotes;
      }
      throw error;
    }
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.notes) || parsed.notes.length > MAX_NOTES) {
      throw new Error('Invalid notes file');
    }
    loadedNotes = parsed.notes.map(normalizeNote);
    return loadedNotes;
  }

  async function persist(nextNotes: StickyNote[]): Promise<void> {
    await fs.mkdir(notesDir, { recursive: true });
    const tempPath = path.join(notesDir, `notes-${randomUUID()}.tmp`);
    const file: NotesFile = { version: 1, notes: nextNotes };
    try {
      await fs.writeFile(tempPath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, notesPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    loadedNotes = nextNotes;
  }

  function findNote(notes: StickyNote[], rawId: unknown): StickyNote {
    const id = requireId(rawId);
    const note = notes.find((item) => item.id === id);
    if (!note) throw new Error('Note not found');
    return note;
  }

  function attachmentPath(attachment: NoteAttachment): string {
    return path.join(attachmentDir, `${requireId(attachment.id)}.${extensionFor(attachment.mediaType)}`);
  }

  ipcMain.handle('notes:list', (event) => {
    assertDashboardSender(event);
    return serialize(async () => [...await load()]);
  });

  ipcMain.handle('notes:create', (event) => {
    assertDashboardSender(event);
    return serialize(async () => {
      const notes = await load();
      if (notes.length >= MAX_NOTES) throw new Error('Note limit reached');
      const now = new Date().toISOString();
      const note: StickyNote = {
        id: randomUUID(),
        color: 'amber',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        attachments: [],
        createdAt: now,
        updatedAt: now,
      };
      await persist([...notes, note]);
      return note;
    });
  });

  ipcMain.handle('notes:update', (event, rawId: unknown, rawPatch: unknown) => {
    assertDashboardSender(event);
    if (!isRecord(rawPatch) || Object.keys(rawPatch).length === 0
      || Object.keys(rawPatch).some((key) => key !== 'color' && key !== 'content')) {
      throw new Error('Invalid note update');
    }
    const patch: NotePatch = {};
    if (rawPatch.color !== undefined) {
      if (!COLORS.includes(rawPatch.color as NoteColor)) throw new Error('Invalid note color');
      patch.color = rawPatch.color as NoteColor;
    }
    if (rawPatch.content !== undefined) patch.content = normalizeContent(rawPatch.content);
    const id = requireId(rawId);
    return serialize(async () => {
      const notes = await load();
      const oldNote = findNote(notes, id);
      const note: StickyNote = {
        ...oldNote,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await persist(notes.map((item) => item.id === id ? note : item));
      return note;
    });
  });

  ipcMain.handle('notes:delete', (event, rawId: unknown) => {
    assertDashboardSender(event);
    const id = requireId(rawId);
    return serialize(async () => {
      const notes = await load();
      const note = findNote(notes, id);
      await persist(notes.filter((item) => item.id !== id));
      await Promise.all(note.attachments.map((attachment) =>
        fs.rm(attachmentPath(attachment), { force: true }).catch((error: unknown) => {
          console.warn('Could not remove note attachment', error);
        })));
    });
  });

  ipcMain.handle('notes:pick-attachment', async (event, rawId: unknown) => {
    const window = assertDashboardSender(event);
    const id = requireId(rawId);
    await serialize(async () => { findNote(await load(), id); });
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Attach a screenshot to this note',
      buttonLabel: 'Attach image',
      properties: ['openFile'],
      filters: [{ name: 'Screenshots', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    assertDashboardSender(event);

    const selectedPath = filePaths[0];
    const stats = await fs.stat(selectedPath);
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_IMAGE_BYTES) {
      throw new Error('Image must be a file of 10 MB or less');
    }
    const bytes = await fs.readFile(selectedPath);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image must be 10 MB or less');
    const format = imageFormat(bytes);
    if (!format) throw new Error('Choose a PNG, JPEG, or WebP image');
    const attachment: NoteAttachment = {
      id: randomUUID(),
      name: path.basename(selectedPath).slice(0, 255),
      mediaType: format.mediaType,
      byteLength: bytes.length,
      createdAt: new Date().toISOString(),
    };

    return serialize(async () => {
      const notes = await load();
      const oldNote = findNote(notes, id);
      if (oldNote.attachments.length >= MAX_ATTACHMENTS_PER_NOTE) throw new Error('Attachment limit reached');
      await fs.mkdir(attachmentDir, { recursive: true });
      const destination = attachmentPath(attachment);
      await fs.writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
      const note: StickyNote = {
        ...oldNote,
        attachments: [...oldNote.attachments, attachment],
        updatedAt: new Date().toISOString(),
      };
      try {
        await persist(notes.map((item) => item.id === id ? note : item));
      } catch (error) {
        await fs.rm(destination, { force: true }).catch(() => undefined);
        throw error;
      }
      return attachment;
    });
  });

  function readImage(rawId: unknown, rawAttachmentId: unknown): Promise<{ name: string; source: string }> {
    const id = requireId(rawId);
    const attachmentId = requireId(rawAttachmentId);
    return serialize(async () => {
      const note = findNote(await load(), id);
      const attachment = note.attachments.find((item) => item.id === attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      const bytes = await fs.readFile(attachmentPath(attachment));
      if (bytes.length > MAX_IMAGE_BYTES || imageFormat(bytes)?.mediaType !== attachment.mediaType) {
        throw new Error('Invalid attachment data');
      }
      return { name: attachment.name, source: `data:${attachment.mediaType};base64,${bytes.toString('base64')}` };
    });
  }

  ipcMain.handle('notes:read-attachment', async (event, rawId: unknown, rawAttachmentId: unknown) => {
    assertDashboardSender(event);
    return (await readImage(rawId, rawAttachmentId)).source;
  });

  ipcMain.handle('notes:remove-attachment', (event, rawId: unknown, rawAttachmentId: unknown) => {
    assertDashboardSender(event);
    const id = requireId(rawId);
    const attachmentId = requireId(rawAttachmentId);
    return serialize(async () => {
      const notes = await load();
      const note = findNote(notes, id);
      const attachment = note.attachments.find((item) => item.id === attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      const updated: StickyNote = {
        ...note,
        attachments: note.attachments.filter((item) => item.id !== attachmentId),
        updatedAt: new Date().toISOString(),
      };
      await persist(notes.map((item) => item.id === id ? updated : item));
      await fs.rm(attachmentPath(attachment), { force: true }).catch((error: unknown) => {
        console.warn('Could not remove note attachment', error);
      });
    });
  });
  return { readImage };
}
