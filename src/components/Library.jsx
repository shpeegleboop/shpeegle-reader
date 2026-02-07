import { motion } from 'framer-motion';
import { BookOpen, Plus, Trash2, Clock } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Library({ books, onOpenBook, onOpenFile, onRemoveBook }) {
  return (
    <div className="h-full flex flex-col bg-void">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-muted/50 flex items-center justify-center">
            <BookOpen size={20} className="text-purple-glow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-bright">Shpeegle Reader</h1>
            <p className="text-xs text-muted">Your epub library</p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onOpenFile}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple text-white text-sm font-medium hover:bg-purple-dim transition-colors"
        >
          <Plus size={16} />
          Open Book
        </motion.button>
      </div>

      {/* Book grid */}
      <div className="flex-1 overflow-y-auto p-8">
        {books.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-sm"
            >
              <div className="w-20 h-20 rounded-2xl bg-surface border border-border flex items-center justify-center mx-auto mb-6">
                <BookOpen size={36} className="text-muted" />
              </div>
              <h2 className="text-lg font-semibold text-bright mb-2">No books yet</h2>
              <p className="text-sm text-muted mb-6 leading-relaxed">
                Open an .epub file to start reading. Your library will appear here.
              </p>
              <button
                onClick={onOpenFile}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-purple text-white text-sm font-medium hover:bg-purple-dim transition-colors"
              >
                <Plus size={16} />
                Open your first book
              </button>
            </motion.div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {books.map((book, i) => (
              <motion.div
                key={book.path}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="group relative"
              >
                <button
                  onClick={() => onOpenBook(book)}
                  className="w-full text-left"
                >
                  {/* Book cover */}
                  <div className="aspect-[2/3] rounded-lg overflow-hidden mb-3 bg-surface border border-border group-hover:border-purple/40 transition-all duration-200 group-hover:shadow-lg group-hover:shadow-purple/5 relative">
                    {book.cover ? (
                      <img
                        src={book.cover}
                        alt={book.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-surface to-raised">
                        <BookOpen size={28} className="text-muted mb-3" />
                        <span className="text-xs text-muted text-center font-medium leading-tight line-clamp-3">
                          {book.title || 'Untitled'}
                        </span>
                      </div>
                    )}
                    {/* Progress bar */}
                    {book.progress > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-abyss/80">
                        <div
                          className="h-full bg-purple-glow"
                          style={{ width: `${Math.round(book.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-text group-hover:text-bright transition-colors line-clamp-2 leading-snug">
                    {book.title || 'Untitled'}
                  </h3>
                  {book.author && (
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{book.author}</p>
                  )}
                  {book.lastOpened && (
                    <p className="text-xs text-muted/60 mt-1 flex items-center gap-1">
                      <Clock size={10} />
                      {timeAgo(book.lastOpened)}
                    </p>
                  )}
                </button>

                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveBook(book.path);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-abyss/80 border border-border text-muted hover:text-crimson-glow hover:border-crimson/40 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
