import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ePub from 'epubjs';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Type,
  Minus,
  Plus,
  Maximize2,
  Minimize2,
  BookOpen,
  X,
} from 'lucide-react';

const FONTS = [
  { label: 'Serif', value: "'Lora', Georgia, serif" },
  { label: 'Sans', value: "'Inter', system-ui, sans-serif" },
  { label: 'System', value: "system-ui, sans-serif" },
];

export default function Reader({ bookData, bookMeta, onBack, onUpdateProgress }) {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const tocRef = useRef([]);

  const [currentChapter, setCurrentChapter] = useState('');
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    try { return parseInt(localStorage.getItem('shpeegle-fontsize')) || 18; } catch { return 18; }
  });
  const [fontFamily, setFontFamily] = useState(() => {
    try { return localStorage.getItem('shpeegle-fontfamily') || FONTS[0].value; } catch { return FONTS[0].value; }
  });
  const [lineHeight, setLineHeight] = useState(() => {
    try { return parseFloat(localStorage.getItem('shpeegle-lineheight')) || 1.8; } catch { return 1.8; }
  });
  const [progress, setProgress] = useState(0);
  const [isFullWidth, setIsFullWidth] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [toc, setToc] = useState([]);
  const [isReady, setIsReady] = useState(false);

  // Save settings
  useEffect(() => {
    try {
      localStorage.setItem('shpeegle-fontsize', fontSize);
      localStorage.setItem('shpeegle-fontfamily', fontFamily);
      localStorage.setItem('shpeegle-lineheight', lineHeight);
    } catch {}
  }, [fontSize, fontFamily, lineHeight]);

  // Apply styles to rendition
  const applyStyles = useCallback((rendition) => {
    if (!rendition) return;
    rendition.themes.default({
      'html, body': {
        background: '#0a0a0c !important',
        color: '#e4e4ec !important',
      },
      'body': {
        'font-family': `${fontFamily} !important`,
        'font-size': `${fontSize}px !important`,
        'line-height': `${lineHeight} !important`,
        'padding': '0 !important',
        'margin': '0 !important',
      },
      'p, li, td, th, dd, dt, span': {
        'font-family': `${fontFamily} !important`,
        'font-size': `${fontSize}px !important`,
        'line-height': `${lineHeight} !important`,
        'color': '#e4e4ec !important',
      },
      'h1, h2, h3, h4, h5, h6': {
        'font-family': "'Inter', system-ui, sans-serif !important",
        'color': '#f4f4fa !important',
        'margin-top': '1.5em !important',
        'margin-bottom': '0.5em !important',
      },
      'h1': { 'font-size': '1.6em !important' },
      'h2': { 'font-size': '1.35em !important' },
      'h3': { 'font-size': '1.15em !important' },
      'a': { 'color': '#8b5cf6 !important' },
      'a:hover': { 'color': '#a78bfa !important' },
      'img': {
        'max-width': '100% !important',
        'height': 'auto !important',
        'border-radius': '4px',
      },
      'blockquote': {
        'border-left': '3px solid #7c3aed !important',
        'padding-left': '1em !important',
        'margin-left': '0 !important',
        'color': '#9090a0 !important',
        'font-style': 'italic',
      },
      'pre, code': {
        'background': '#1a1a1f !important',
        'color': '#e4e4ec !important',
        'border-radius': '4px !important',
        'padding': '0.2em 0.4em !important',
        'font-size': '0.9em !important',
      },
      'table': {
        'border-collapse': 'collapse !important',
      },
      'td, th': {
        'border': '1px solid #2a2a32 !important',
        'padding': '0.5em !important',
      },
      'hr': {
        'border': 'none !important',
        'border-top': '1px solid #2a2a32 !important',
        'margin': '2em 0 !important',
      },
      '::selection': {
        'background': 'rgba(124, 58, 237, 0.3) !important',
      },
    });
  }, [fontSize, fontFamily, lineHeight]);

  // Initialize book
  useEffect(() => {
    if (!bookData || !viewerRef.current) return;

    const book = ePub(bookData.buffer);
    bookRef.current = book;

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
    });
    renditionRef.current = rendition;

    applyStyles(rendition);

    // Load TOC
    book.loaded.navigation.then((nav) => {
      tocRef.current = nav.toc;
      setToc(nav.toc);
    });

    // Display book (resume from saved position or start)
    const startCfi = bookMeta?.currentCfi;
    if (startCfi) {
      rendition.display(startCfi);
    } else {
      rendition.display();
    }

    rendition.on('rendered', () => {
      setIsReady(true);
    });

    // Track location changes
    rendition.on('relocated', (location) => {
      const pct = book.locations?.percentageFromCfi?.(location.start.cfi) ?? 0;
      setProgress(pct);
      setAtStart(location.atStart);
      setAtEnd(location.atEnd);
      onUpdateProgress?.(location.start.cfi, pct);

      // Find current chapter
      const href = location.start.href;
      const findChapter = (items) => {
        for (const item of items) {
          if (item.href && href.includes(item.href.split('#')[0])) return item.label?.trim();
          if (item.subitems?.length) {
            const found = findChapter(item.subitems);
            if (found) return found;
          }
        }
        return null;
      };
      setCurrentChapter(findChapter(tocRef.current) || '');
    });

    // Generate locations for progress
    book.ready.then(() => {
      return book.locations.generate(1024);
    });

    // Keyboard nav
    rendition.on('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') rendition.next();
      if (e.key === 'ArrowLeft') rendition.prev();
    });

    return () => {
      rendition.destroy();
      book.destroy();
    };
  }, [bookData]);

  // Re-apply styles when settings change
  useEffect(() => {
    if (renditionRef.current && isReady) {
      applyStyles(renditionRef.current);
    }
  }, [fontSize, fontFamily, lineHeight, applyStyles, isReady]);

  const goNext = () => renditionRef.current?.next();
  const goPrev = () => renditionRef.current?.prev();
  const goToHref = (href) => {
    renditionRef.current?.display(href);
    setShowToc(false);
  };

  // Keyboard handler for main window
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') {
        if (showToc) setShowToc(false);
        else if (showSettings) setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showToc, showSettings]);

  return (
    <div className="h-full flex flex-col bg-void">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-abyss/80 backdrop-blur-sm z-20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="ml-1">
            <h2 className="text-sm font-medium text-bright leading-tight line-clamp-1 max-w-[300px]">
              {bookMeta?.title || 'Untitled'}
            </h2>
            {currentChapter && (
              <p className="text-xs text-muted line-clamp-1">{currentChapter}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowToc(!showToc); setShowSettings(false); }}
            className={`p-2 rounded-lg transition-colors ${showToc ? 'text-purple-glow bg-purple-muted/30' : 'text-muted hover:text-bright hover:bg-surface'}`}
          >
            <List size={18} />
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowToc(false); }}
            className={`p-2 rounded-lg transition-colors ${showSettings ? 'text-purple-glow bg-purple-muted/30' : 'text-muted hover:text-bright hover:bg-surface'}`}
          >
            <Type size={18} />
          </button>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface transition-colors"
          >
            {isFullWidth ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      {/* Main reading area */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* TOC panel */}
        <AnimatePresence>
          {showToc && (
            <motion.div
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute left-0 top-0 bottom-0 w-80 bg-abyss border-r border-border z-10 flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-bright">Table of Contents</h3>
                <button
                  onClick={() => setShowToc(false)}
                  className="p-1 rounded text-muted hover:text-bright"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <TocTree items={toc} onSelect={goToHref} level={0} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute right-0 top-0 bottom-0 w-72 bg-abyss border-l border-border z-10 flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-bright">Reading Settings</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 rounded text-muted hover:text-bright"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-6">
                {/* Font size */}
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">
                    Font Size
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                      className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-bright hover:border-border-light transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-sm font-medium text-bright w-12 text-center">{fontSize}px</span>
                    <button
                      onClick={() => setFontSize((s) => Math.min(32, s + 1))}
                      className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-bright hover:border-border-light transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {/* Font family */}
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">
                    Font
                  </label>
                  <div className="flex flex-col gap-2">
                    {FONTS.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setFontFamily(f.value)}
                        className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          fontFamily === f.value
                            ? 'bg-purple-muted/30 border border-purple/40 text-purple-glow'
                            : 'bg-surface border border-border text-text hover:border-border-light'
                        }`}
                        style={{ fontFamily: f.value }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Line height */}
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">
                    Line Height
                  </label>
                  <input
                    type="range"
                    min="1.2"
                    max="2.4"
                    step="0.1"
                    value={lineHeight}
                    onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    className="w-full accent-purple"
                  />
                  <div className="flex justify-between text-xs text-muted mt-1">
                    <span>Tight</span>
                    <span>{lineHeight.toFixed(1)}</span>
                    <span>Loose</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Prev page click zone */}
        <button
          onClick={goPrev}
          disabled={atStart}
          className="absolute left-0 top-0 bottom-0 w-16 z-[5] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group"
        >
          <div className="p-2 rounded-full bg-surface/80 border border-border text-muted group-hover:text-bright">
            <ChevronLeft size={20} />
          </div>
        </button>

        {/* Epub viewport */}
        <div className={`flex-1 transition-all duration-300 ${isFullWidth ? 'mx-0' : 'mx-auto max-w-3xl'}`}>
          <div ref={viewerRef} className="h-full" />
        </div>

        {/* Next page click zone */}
        <button
          onClick={goNext}
          disabled={atEnd}
          className="absolute right-0 top-0 bottom-0 w-16 z-[5] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group"
        >
          <div className="p-2 rounded-full bg-surface/80 border border-border text-muted group-hover:text-bright">
            <ChevronRight size={20} />
          </div>
        </button>
      </div>

      {/* Bottom progress bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-abyss/80 flex-shrink-0">
        <span className="text-xs text-muted w-10">{Math.round(progress * 100)}%</span>
        <div className="flex-1 h-1 rounded-full bg-surface overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-purple to-purple-glow rounded-full"
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <BookOpen size={12} className="text-muted" />
      </div>
    </div>
  );
}

function TocTree({ items, onSelect, level }) {
  if (!items?.length) return null;
  return (
    <ul className={level > 0 ? 'ml-4' : ''}>
      {items.map((item, i) => (
        <li key={i}>
          <button
            onClick={() => onSelect(item.href)}
            className="w-full text-left px-4 py-2 text-sm text-text hover:text-bright hover:bg-surface/50 transition-colors leading-snug"
            style={{ paddingLeft: `${16 + level * 16}px` }}
          >
            {item.label?.trim() || 'Untitled'}
          </button>
          {item.subitems?.length > 0 && (
            <TocTree items={item.subitems} onSelect={onSelect} level={level + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
