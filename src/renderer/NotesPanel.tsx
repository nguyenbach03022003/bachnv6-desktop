import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, ExternalLink, ImagePlus, Italic, List, ListOrdered, Minus, Plus, Strikethrough, StickyNote as StickyNoteIcon, Trash2, Underline, X } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import type { NoteAttachment, NoteColor, NoteContent, NoteContentNode, StickyNote } from '../shared/notes-types';
import styles from './NotesPanel.module.css';
import { VocabularyPanel } from './VocabularyPanel';
import { InputLanguageButton } from './InputLanguage';

type SaveStatus = { noteId: string; kind: 'saved' | 'unsaved' | 'saving' | 'error' } | null;

const COLORS: Array<{ id: NoteColor; label: string }> = [
  { id: 'amber', label: 'Amber' },
  { id: 'violet', label: 'Violet' },
  { id: 'mint', label: 'Mint' },
];

function noteTitle(note: StickyNote): string {
  function textFrom(node: NoteContent): string {
    const parts: string[] = [];
    function visit(value: NoteContentNode): void {
      if (value.text) parts.push(value.text);
      value.content?.forEach(visit);
    }
    visit(node);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const firstBlock = note.content.content?.find((block) => block.type === 'heading')
    ?? note.content.content?.find((block) => textFrom({ type: 'doc', content: [block] }));
  const text = firstBlock ? textFrom({ type: 'doc', content: [firstBlock] }) : '';
  return text ? (text.length > 32 ? `${text.slice(0, 32)}…` : text) : 'Untitled note';
}

function AttachmentPreview({
  noteId,
  attachment,
  onRemove,
}: {
  noteId: string;
  attachment: NoteAttachment;
  onRemove: (attachmentId: string) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.dashboard?.notes?.readAttachment(noteId, attachment.id).then((dataUrl) => {
      if (active) setSource(dataUrl);
    }).catch(() => {
      if (active) setSource(null);
    });
    return () => { active = false; };
  }, [noteId, attachment.id]);

  return (
    <div className={styles.attachment}>
      {source ? <button type="button" className={styles.imageButton} aria-label={`View ${attachment.name}`} title="Open image in a larger window"
        onClick={() => {
          setError(null);
          void window.dashboard?.notesWorkspace.openImage(noteId, attachment.id).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Could not open this image.');
          });
        }}><img src={source} alt={attachment.name} /></button> : <span className={styles.attachmentFallback}>Image unavailable</span>}
      <div className={styles.attachmentCaption}>
        <span title={attachment.name}>{attachment.name}</span>
        <button type="button" aria-label={`Remove ${attachment.name}`} title="Remove attachment" onClick={() => onRemove(attachment.id)}>
          <MorphIcon icon={X} size={13} reducedMotion="user" />
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function NoteEditor({
  note,
  status,
  busy,
  readOnly,
  onChange,
  onBlur,
  onColor,
  onPickAttachment,
  onRemoveAttachment,
}: {
  note: StickyNote;
  status: SaveStatus;
  busy: boolean;
  readOnly: boolean;
  onChange: (id: string, content: NoteContent) => void;
  onBlur: (id: string) => void;
  onColor: (id: string, color: NoteColor) => void;
  onPickAttachment: (id: string) => void;
  onRemoveAttachment: (id: string, attachmentId: string) => void;
}) {
  const [, setRevision] = useState(0);
  const editor = useEditor({
    extensions: [StarterKit.configure({
      link: false,
    })],
    content: note.content,
    immediatelyRender: false,
    editorProps: {
      attributes: { 'aria-label': 'Note content', class: styles.editable },
    },
    onUpdate: ({ editor: current }) => onChange(note.id, current.getJSON() as NoteContent),
    onBlur: () => onBlur(note.id),
  }, [note.id]);

  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setRevision((value) => value + 1);
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
    };
  }, [editor]);

  const headingLevel = [1, 2, 3, 4, 5, 6].find((level) => editor?.isActive('heading', { level }));
  const blockStyle = editor?.isActive('codeBlock') ? 'code' : editor?.isActive('blockquote') ? 'quote'
    : headingLevel ? `heading${headingLevel}` : 'paragraph';

  function changeBlockStyle(value: string): void {
    if (!editor) return;
    const chain = editor.chain().focus().clearNodes();
    if (/^heading[1-6]$/.test(value)) chain.setHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    else if (value === 'quote') chain.setParagraph().setBlockquote().run();
    else if (value === 'code') chain.setCodeBlock().run();
    else chain.setParagraph().run();
  }

  const saveLabel = busy ? 'Working…' : status?.noteId === note.id ? {
    saved: 'Saved locally',
    unsaved: 'Saving soon…',
    saving: 'Saving…',
    error: 'Could not save',
  }[status.kind] : 'Saved locally';

  return (
    <div className={styles.noteBody}>
      <div className={styles.structureRow}>
        <select aria-label="Text style" value={blockStyle} disabled={!editor} onChange={(event) => changeBlockStyle(event.target.value)}>
          <option value="paragraph">Paragraph</option>
          <option value="heading1">Heading 1 · Title</option>
          <option value="heading2">Heading 2 · Section</option>
          <option value="heading3">Heading 3 · Subsection</option>
          <option value="heading4">Heading 4</option>
          <option value="heading5">Heading 5</option>
          <option value="heading6">Heading 6</option>
          <option value="quote">Quote</option>
          <option value="code">Code block</option>
        </select>
        <button type="button" aria-label="Insert divider" title="Insert a section divider" disabled={!editor}
          onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <MorphIcon icon={Minus} size={16} reducedMotion="user" />
        </button>
      </div>
      <div className={styles.toolbar} aria-label="Note formatting">
        <div className={styles.formatButtons}>
          <button type="button" aria-label="Bold" title="Bold" aria-pressed={editor?.isActive('bold') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <MorphIcon icon={Bold} size={15} reducedMotion="user" />
          </button>
          <button type="button" aria-label="Italic" title="Italic" aria-pressed={editor?.isActive('italic') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <MorphIcon icon={Italic} size={15} reducedMotion="user" />
          </button>
          <button type="button" aria-label="Underline" title="Underline" aria-pressed={editor?.isActive('underline') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <MorphIcon icon={Underline} size={15} reducedMotion="user" />
          </button>
          <button type="button" aria-label="Strikethrough" title="Strikethrough" aria-pressed={editor?.isActive('strike') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <MorphIcon icon={Strikethrough} size={15} reducedMotion="user" />
          </button>
          <button type="button" aria-label="Bullet list" title="Bullet list" aria-pressed={editor?.isActive('bulletList') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <MorphIcon icon={List} size={15} reducedMotion="user" />
          </button>
          <button type="button" aria-label="Numbered list" title="Numbered list" aria-pressed={editor?.isActive('orderedList') ?? false} disabled={!editor}
            onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <MorphIcon icon={ListOrdered} size={15} reducedMotion="user" />
          </button>
        </div>
        <button className={styles.attachButton} type="button" aria-label="Attach screenshot" title="Choose a screenshot to attach"
          disabled={busy}
          onClick={() => onPickAttachment(note.id)}>
          <MorphIcon icon={ImagePlus} size={16} reducedMotion="user" />
        </button>
      </div>
      <div className={styles.colorRow}>
        <span>Paper color</span>
        <div className={styles.swatches} role="group" aria-label="Note color">
          {COLORS.map((color) => (
            <button key={color.id} type="button" className={styles[color.id]}
              aria-label={`${color.label} note`} title={color.label} aria-pressed={note.color === color.id}
              disabled={busy}
              onClick={() => onColor(note.id, color.id)} />
          ))}
        </div>
      </div>
      <div className={`${styles.paper} ${styles[`paper${note.color}`]}`}>
        <EditorContent editor={editor} className={styles.editor} />
        {note.attachments.length > 0 && (
          <div className={styles.attachments} aria-label="Attached screenshots">
            {note.attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} noteId={note.id} attachment={attachment}
                onRemove={(attachmentId) => onRemoveAttachment(note.id, attachmentId)} />
            ))}
          </div>
        )}
      </div>
      <div className={styles.saveStatus} role="status">{saveLabel} · Enter: paragraph · Shift+Enter: line break</div>
    </div>
  );
}

export function NotesPanel({ initialSelectedId = null, detached = false }: {
  initialSelectedId?: string | null;
  detached?: boolean;
}) {
  const notesApi = window.dashboard?.notes;
  const [space, setSpace] = useState<'notes' | 'vocabulary'>(() =>
    window.localStorage.getItem('bachnv6-note-space') === 'vocabulary' ? 'vocabulary' : 'notes');
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [vocabularyBusy, setVocabularyBusy] = useState(false);
  const transferInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const pending = useRef(new Map<string, NoteContent>());
  const editRevisions = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const writesInFlight = useRef(0);
  const saveFailureCount = useRef(0);
  const allowUnload = useRef(false);
  const closePending = useRef(false);
  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedId) ?? null, [notes, selectedId]);

  useEffect(() => {
    if (loading) return;
    void window.dashboard?.notesWorkspace.setContext({ selectedId, space }).catch(() => undefined);
  }, [loading, selectedId, space]);

  useEffect(() => {
    if (!detached) return;
    return window.dashboard?.notesWorkspace.onMergeRequested(() => {
      if (busy || vocabularyBusy || transferring) {
        setError('Please wait for the current operation to finish before merging.');
        return;
      }
      void window.dashboard?.close().catch(() => setError('Could not merge the notes window.'));
    });
  }, [detached, busy, vocabularyBusy, transferring]);

  useEffect(() => {
    if (!notesApi) {
      setLoading(false);
      return;
    }
    let active = true;
    void notesApi.list().then((loaded) => {
      if (!active) return;
      setNotes(loaded);
      setSelectedId((current) => current && loaded.some((note) => note.id === current) ? current : loaded[0]?.id ?? null);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Could not load local notes.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [notesApi]);

  async function detachNotes(): Promise<void> {
    if (busy || vocabularyBusy || transferInFlight.current || !window.dashboard) return;
    transferInFlight.current = true;
    setTransferring(true);
    setError(null);
    const initialFailures = saveFailureCount.current;
    try {
      do {
        await Promise.all([...pending.current.keys()].map((id) => flushNote(id)));
        await saveTail.current;
        if (saveFailureCount.current !== initialFailures) throw new Error('Could not save your latest edit. Please retry before detaching.');
      } while (pending.current.size || writesInFlight.current);
      await window.dashboard.notesWorkspace.detach({ selectedId, space });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the notes window.');
    } finally {
      transferInFlight.current = false;
      setTransferring(false);
    }
  }

  const flushNote = useCallback((id: string): Promise<void> => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const content = pending.current.get(id);
    if (!content || !notesApi) return saveTail.current;
    const revision = editRevisions.current.get(id) ?? 0;
    pending.current.delete(id);
    setSaveStatus({ noteId: id, kind: 'saving' });
    writesInFlight.current += 1;
    const write = saveTail.current.catch(() => undefined).then(async () => {
      const saved = await notesApi.update(id, { content });
      setNotes((current) => current.map((note) => note.id === id ? { ...note, updatedAt: saved.updatedAt } : note));
      if (editRevisions.current.get(id) === revision && !pending.current.has(id)) {
        setSaveStatus({ noteId: id, kind: 'saved' });
      }
    });
    saveTail.current = write.catch(() => {
      // Keep the draft in memory so another edit or blur can retry it.
      if (editRevisions.current.get(id) === revision && !pending.current.has(id)) {
        pending.current.set(id, content);
        saveFailureCount.current += 1;
        setSaveStatus({ noteId: id, kind: 'error' });
        setError('Could not save this note. Your text remains in the editor.');
      }
    }).finally(() => {
      writesInFlight.current -= 1;
    });
    return saveTail.current;
  }, [notesApi]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    for (const id of pending.current.keys()) void flushNote(id);
  }, [flushNote]);

  useEffect(() => {
    // Electron can cancel a close from beforeunload. Finish pending writes first,
    // then request the close again. Keep the window open if saving fails.
    if (!notesApi) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current || (pending.current.size === 0 && writesInFlight.current === 0)) return;
      event.returnValue = false;
      if (closePending.current) return;
      closePending.current = true;
      const initialFailures = saveFailureCount.current;
      void (async () => {
        while (true) {
          await Promise.all([...pending.current.keys()].map((id) => flushNote(id)));
          const currentTail = saveTail.current;
          await currentTail;
          if (saveFailureCount.current !== initialFailures) {
            setError('Could not save your latest edit. The app stayed open so you can retry.');
            closePending.current = false;
            return;
          }
          if (pending.current.size === 0 && writesInFlight.current === 0 && currentTail === saveTail.current) break;
        }
        allowUnload.current = true;
        try {
          await window.dashboard?.close();
        } catch {
          allowUnload.current = false;
          closePending.current = false;
          setError('Could not close the window after saving.');
        }
      })().catch(() => {
        closePending.current = false;
        setError('Could not save your latest edit. The app stayed open so you can retry.');
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushNote, notesApi]);

  const changeContent = useCallback((id: string, content: NoteContent) => {
    allowUnload.current = false;
    setNotes((current) => current.map((note) => note.id === id ? { ...note, content } : note));
    editRevisions.current.set(id, (editRevisions.current.get(id) ?? 0) + 1);
    pending.current.set(id, content);
    const oldTimer = timers.current.get(id);
    if (oldTimer) clearTimeout(oldTimer);
    timers.current.set(id, setTimeout(() => { void flushNote(id); }, 450));
    setSaveStatus({ noteId: id, kind: 'unsaved' });
    setError(null);
  }, [flushNote]);

  async function createNote(): Promise<void> {
    if (!notesApi || busy) return;
    setBusy(true);
    setError(null);
    try {
      const note = await notesApi.create();
      setNotes((current) => [...current, note]);
      setSelectedId(note.id);
      setSaveStatus({ noteId: note.id, kind: 'saved' });
    } catch {
      setError('Could not create a note.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(): Promise<void> {
    if (!notesApi || !selectedNote || busy) return;
    if (!window.confirm('Delete this note and its attachments?')) return;
    const id = selectedNote.id;
    setBusy(true);
    setError(null);
    try {
      await flushNote(id);
      await notesApi.remove(id);
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.delete(id);
      pending.current.delete(id);
      setNotes((current) => current.filter((note) => note.id !== id));
      setSelectedId((current) => current === id ? notes.find((note) => note.id !== id)?.id ?? null : current);
      setSaveStatus(null);
    } catch {
      setError('Could not delete this note.');
    } finally {
      setBusy(false);
    }
  }

  async function recolorNote(id: string, color: NoteColor): Promise<void> {
    if (!notesApi || busy) return;
    const original = notes.find((note) => note.id === id)?.color;
    if (original === color) return;
    setBusy(true);
    setNotes((current) => current.map((note) => note.id === id ? { ...note, color } : note));
    setError(null);
    try {
      const saved = await notesApi.update(id, { color });
      setNotes((current) => current.map((note) => note.id === id ? { ...note, updatedAt: saved.updatedAt } : note));
    } catch {
      setNotes((current) => current.map((note) => note.id === id ? { ...note, color: original ?? 'amber' } : note));
      setError('Could not save the note color.');
    } finally {
      setBusy(false);
    }
  }

  async function pickAttachment(id: string): Promise<void> {
    if (!notesApi || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attachment = await notesApi.pickAttachment(id);
      if (attachment) setNotes((current) => current.map((note) => note.id === id
        ? { ...note, attachments: [...note.attachments, attachment] } : note));
    } catch {
      setError('Could not attach that image. Choose a PNG, JPEG, or WebP image under 10 MB.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAttachment(id: string, attachmentId: string): Promise<void> {
    if (!notesApi || busy) return;
    setBusy(true);
    setError(null);
    try {
      await notesApi.removeAttachment(id, attachmentId);
      setNotes((current) => current.map((note) => note.id === id
        ? { ...note, attachments: note.attachments.filter((item) => item.id !== attachmentId) } : note));
    } catch {
      setError('Could not remove this attachment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Notes and vocabulary">
      <div className={styles.workspaceActions}>
      {detached && <InputLanguageButton />}
      <div className={styles.spaceTabs} role="group" aria-label="Choose learning space">
        <button type="button" disabled={busy || vocabularyBusy || transferring} aria-pressed={space === 'notes'} onClick={() => {
          if (selectedId) void flushNote(selectedId);
          setSpace('notes');
          window.localStorage.setItem('bachnv6-note-space', 'notes');
        }}>Sticky notes</button>
        <button type="button" disabled={busy || vocabularyBusy || transferring} aria-pressed={space === 'vocabulary'} onClick={() => {
          if (selectedId) void flushNote(selectedId);
          setSpace('vocabulary');
          window.localStorage.setItem('bachnv6-note-space', 'vocabulary');
        }}>Vocabulary</button>
      </div>
        <button type="button" className={styles.newButton} disabled={!notesApi || loading || busy || vocabularyBusy || transferring}
          aria-label={detached ? 'Merge notes into dashboard' : 'Detach notes window'}
          onClick={() => {
            if (detached) void window.dashboard?.notesWorkspace.merge().catch(() => setError('Could not merge the notes window.'));
            else void detachNotes();
          }}><MorphIcon icon={ExternalLink} size={14} reducedMotion="user" />{detached ? 'Merge back' : transferring ? 'Saving…' : 'Detach'}</button>
      </div>
      <fieldset className={styles.controls} disabled={transferring}>
      {space === 'vocabulary' ? <VocabularyPanel onBusyChange={setVocabularyBusy} /> : <>
      <div className={styles.heading}>
        <div className={styles.headingTitle}>
          <MorphIcon icon={StickyNoteIcon} size={17} reducedMotion="user" aria-hidden="true" />
          <h2>Sticky notes</h2>
        </div>
        <button type="button" className={styles.newButton} aria-label="Create note" title="Create note"
          disabled={!notesApi || loading || busy} onClick={() => { void createNote(); }}>
          <MorphIcon icon={Plus} size={15} reducedMotion="user" /> New
        </button>
      </div>

      {loading ? <p className={styles.message}>Loading notes…</p> : !notesApi ? (
        <p className={styles.message}>Notes are available in the desktop app.</p>
      ) : notes.length === 0 ? (
        <div className={styles.empty}>
          <span>Keep your ideas here.</span>
          <button type="button" onClick={() => { void createNote(); }} disabled={busy}>Create your first note</button>
        </div>
      ) : (
        <>
          <div className={styles.notePicker}>
            <select aria-label="Choose note" value={selectedId ?? ''} onChange={(event) => {
              if (selectedId) void flushNote(selectedId);
              setSelectedId(event.target.value);
            }}>
              {notes.map((note) => <option key={note.id} value={note.id}>{noteTitle(note)}</option>)}
            </select>
            <button type="button" aria-label="Delete selected note" title="Delete selected note"
              disabled={!selectedNote || busy} onClick={() => { void deleteNote(); }}>
              <MorphIcon icon={Trash2} size={15} reducedMotion="user" />
            </button>
          </div>
          {selectedNote && <NoteEditor key={selectedNote.id} note={selectedNote} status={saveStatus} busy={busy} readOnly={transferring}
            onChange={changeContent} onBlur={(id) => { void flushNote(id); }}
            onColor={(id, color) => { void recolorNote(id, color); }}
            onPickAttachment={(id) => { void pickAttachment(id); }}
            onRemoveAttachment={(id, attachmentId) => { void removeAttachment(id, attachmentId); }} />}
        </>
      )}
      </>}
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
