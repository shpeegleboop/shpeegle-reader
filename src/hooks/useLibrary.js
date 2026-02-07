import { useState, useEffect } from 'react';

const STORAGE_KEY = 'shpeegle-library';

function load() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : { books: [], lastRead: null };
  } catch {
    return { books: [], lastRead: null };
  }
}

function save(library) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {}
}

export default function useLibrary() {
  const [library, setLibrary] = useState(load);

  useEffect(() => {
    save(library);
  }, [library]);

  const addBook = (book) => {
    setLibrary((prev) => {
      const existing = prev.books.findIndex((b) => b.path === book.path);
      const books = [...prev.books];
      if (existing >= 0) {
        books[existing] = { ...books[existing], ...book, lastOpened: Date.now() };
      } else {
        books.unshift({ ...book, addedAt: Date.now(), lastOpened: Date.now(), progress: 0, currentCfi: null });
      }
      return { ...prev, books, lastRead: book.path };
    });
  };

  const updateBook = (path, updates) => {
    setLibrary((prev) => {
      const books = prev.books.map((b) =>
        b.path === path ? { ...b, ...updates } : b
      );
      return { ...prev, books };
    });
  };

  const removeBook = (path) => {
    setLibrary((prev) => ({
      ...prev,
      books: prev.books.filter((b) => b.path !== path),
      lastRead: prev.lastRead === path ? null : prev.lastRead,
    }));
  };

  return { library, addBook, updateBook, removeBook };
}
