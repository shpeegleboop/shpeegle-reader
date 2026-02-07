import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Library from './components/Library';
import Reader from './components/Reader';
import useLibrary from './hooks/useLibrary';

// Check if Tauri is available
const isTauri = () => '__TAURI__' in window || '__TAURI_INTERNALS__' in window;

async function openFileDialog() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'EPUB Files', extensions: ['epub'] }],
    });
    if (!selected) return null;
    // Read file via Tauri command
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = await invoke('read_file_bytes', { path: selected });
    return { path: selected, buffer: new Uint8Array(bytes).buffer };
  } else {
    // Browser fallback: use file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return resolve(null);
        const buffer = await file.arrayBuffer();
        resolve({ path: file.name, buffer, fileName: file.name });
      };
      input.click();
    });
  }
}

async function extractMetadata(buffer) {
  // Clone the buffer — ePub consumes/detaches the ArrayBuffer internally,
  // so the original would be unusable for the actual Reader
  const bufferCopy = buffer.slice(0);
  const ePub = (await import('epubjs')).default;
  const book = ePub(bufferCopy);
  await book.ready;

  const meta = await book.loaded.metadata;
  let cover = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const resp = await fetch(coverUrl);
      const blob = await resp.blob();
      cover = await new Promise((res) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.readAsDataURL(blob);
      });
    }
  } catch {}

  book.destroy();

  return {
    title: meta.title || 'Untitled',
    author: meta.creator || '',
    cover,
  };
}

export default function App() {
  const { library, addBook, updateBook, removeBook } = useLibrary();
  const [currentBook, setCurrentBook] = useState(null); // { path, buffer, meta }
  const [loading, setLoading] = useState(false);

  const handleOpenFile = useCallback(async () => {
    setLoading(true);
    try {
      const result = await openFileDialog();
      if (!result) { setLoading(false); return; }

      const meta = await extractMetadata(result.buffer);
      const bookPath = result.path;

      addBook({
        path: bookPath,
        title: meta.title,
        author: meta.author,
        cover: meta.cover,
      });

      setCurrentBook({
        path: bookPath,
        buffer: result.buffer,
        meta: {
          ...meta,
          ...library.books.find((b) => b.path === bookPath),
        },
      });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
    setLoading(false);
  }, [addBook, library.books]);

  const handleOpenBook = useCallback(async (book) => {
    setLoading(true);
    try {
      let buffer;
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const bytes = await invoke('read_file_bytes', { path: book.path });
        buffer = new Uint8Array(bytes).buffer;
      } else {
        // Browser mode: need to re-select file
        const result = await openFileDialog();
        if (!result) { setLoading(false); return; }
        buffer = result.buffer;
      }

      setCurrentBook({
        path: book.path,
        buffer,
        meta: book,
      });
    } catch (err) {
      console.error('Failed to open book:', err);
    }
    setLoading(false);
  }, []);

  const handleUpdateProgress = useCallback((cfi, progress) => {
    if (currentBook?.path) {
      updateBook(currentBook.path, { currentCfi: cfi, progress });
    }
  }, [currentBook?.path, updateBook]);

  const handleBack = useCallback(() => {
    setCurrentBook(null);
  }, []);

  return (
    <div className="h-screen bg-void overflow-hidden">
      {/* Loading overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-void/80 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-purple/30 border-t-purple-glow rounded-full animate-spin" />
              <p className="text-sm text-muted">Loading book...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {currentBook ? (
          <motion.div
            key="reader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <Reader
              bookData={{ buffer: currentBook.buffer }}
              bookMeta={currentBook.meta}
              onBack={handleBack}
              onUpdateProgress={handleUpdateProgress}
            />
          </motion.div>
        ) : (
          <motion.div
            key="library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <Library
              books={library.books}
              onOpenBook={handleOpenBook}
              onOpenFile={handleOpenFile}
              onRemoveBook={removeBook}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
