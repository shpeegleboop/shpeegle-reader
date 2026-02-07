import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import JSZip from 'jszip';
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
  AlertCircle,
} from 'lucide-react';

const FONTS = [
  { label: 'Serif', value: "'Lora', Georgia, serif" },
  { label: 'Sans', value: "'Inter', system-ui, sans-serif" },
  { label: 'System', value: "system-ui, sans-serif" },
];

/* ── Path helpers ─────────────────────────────────────────── */

function normalizePath(path) {
  const parts = path.split('/').filter(Boolean);
  const stack = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p !== '.') stack.push(p);
  }
  return stack.join('/');
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.substring(0, i + 1) : '';
}

function resolveHref(basePath, href) {
  if (!href) return '';
  if (href.startsWith('/')) return normalizePath(href);
  return normalizePath(dirOf(basePath) + href);
}

/* ── Epub parsing with JSZip ──────────────────────────────── */

async function parseEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // 1. Find OPF via container.xml
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid epub: missing container.xml');
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid epub: no rootfile found');

  // 2. Parse OPF
  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error('Invalid epub: missing OPF');
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  // Build manifest: id -> { href, mediaType, fullPath, properties }
  const manifest = {};
  for (const item of opfDoc.querySelectorAll('manifest item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    manifest[id] = {
      href,
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
      fullPath: resolveHref(opfPath, href),
    };
  }

  // Build spine (reading order)
  const spine = [];
  for (const ref of opfDoc.querySelectorAll('spine itemref')) {
    const idref = ref.getAttribute('idref');
    if (manifest[idref]) spine.push({ id: idref, ...manifest[idref] });
  }

  // 3. Parse TOC — try NCX first, then epub3 NAV
  let toc = [];
  const ncxItem = Object.values(manifest).find(
    (m) => m.mediaType === 'application/x-dtbncx+xml'
  );
  if (ncxItem) {
    try {
      const ncxXml = await zip.file(ncxItem.fullPath)?.async('text');
      if (ncxXml) {
        const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml');
        toc = parseNcxPoints(
          ncxDoc.querySelectorAll('navMap > navPoint'),
          ncxItem.fullPath
        );
      }
    } catch {}
  }
  if (!toc.length) {
    const navItem = Object.values(manifest).find((m) =>
      m.properties.includes('nav')
    );
    if (navItem) {
      try {
        const navXml = await zip.file(navItem.fullPath)?.async('text');
        if (navXml) {
          const navDoc = new DOMParser().parseFromString(navXml, 'application/xhtml+xml');
          const navEl =
            navDoc.querySelector('nav[epub\\:type="toc"]') ||
            navDoc.querySelector('nav');
          if (navEl) {
            toc = parseNavOl(navEl.querySelector('ol'), navItem.fullPath);
          }
        }
      } catch {}
    }
  }

  return { zip, spine, manifest, toc };
}

function parseNcxPoints(points, ncxPath) {
  const items = [];
  for (const np of points) {
    const label = np.querySelector(':scope > navLabel > text')?.textContent?.trim() || '';
    const src = np.querySelector(':scope > content')?.getAttribute('src') || '';
    const children = np.querySelectorAll(':scope > navPoint');
    items.push({
      label,
      href: resolveHref(ncxPath, src),
      subitems: children.length ? parseNcxPoints(children, ncxPath) : [],
    });
  }
  return items;
}

function parseNavOl(ol, navPath) {
  if (!ol) return [];
  const items = [];
  for (const li of ol.querySelectorAll(':scope > li')) {
    const a = li.querySelector(':scope > a');
    if (!a) continue;
    const subOl = li.querySelector(':scope > ol');
    items.push({
      label: a.textContent?.trim() || '',
      href: resolveHref(navPath, a.getAttribute('href') || ''),
      subitems: subOl ? parseNavOl(subOl, navPath) : [],
    });
  }
  return items;
}

/* ── Chapter content loading ──────────────────────────────── */

function blobToDataUrl(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onloadend = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

async function loadChapter(zip, spineItem) {
  const raw = await zip.file(spineItem.fullPath)?.async('text');
  if (!raw) return '<p style="color:#9090a0;text-align:center;padding:2em;">Chapter not found.</p>';

  // Parse XHTML; fall back to HTML if malformed
  let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(raw, 'text/html');
  }

  const body = doc.querySelector('body') || doc.documentElement;

  // Strip original stylesheets — we apply our own dark theme
  for (const el of doc.querySelectorAll('style, link[rel="stylesheet"]')) {
    el.remove();
  }
  // Strip inline styles that would override our theme
  for (const el of body.querySelectorAll('[style]')) {
    el.removeAttribute('style');
  }

  // Convert <img> src to data URIs
  const itemDir = dirOf(spineItem.fullPath);
  for (const img of body.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) continue;
    const fullPath = normalizePath(itemDir + src);
    const file = zip.file(fullPath);
    if (file) {
      try {
        const blob = await file.async('blob');
        img.setAttribute('src', await blobToDataUrl(blob));
      } catch {}
    }
  }

  // Convert SVG <image> href to data URIs
  for (const img of body.querySelectorAll('image')) {
    const href = img.getAttribute('xlink:href') || img.getAttribute('href');
    if (!href || href.startsWith('data:')) continue;
    const fullPath = normalizePath(itemDir + href);
    const file = zip.file(fullPath);
    if (file) {
      try {
        const blob = await file.async('blob');
        const dataUrl = await blobToDataUrl(blob);
        img.setAttribute('xlink:href', dataUrl);
        img.setAttribute('href', dataUrl);
      } catch {}
    }
  }

  return body.innerHTML;
}

/* ── Reader Component ─────────────────────────────────────── */

export default function Reader({ bookData, bookMeta, onBack, onUpdateProgress }) {
  const contentRef = useRef(null);

  const [epubData, setEpubData] = useState(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterHtml, setChapterHtml] = useState('');
  const [chapterLoading, setChapterLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentLabel, setCurrentLabel] = useState('');

  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullWidth, setIsFullWidth] = useState(false);

  const [fontSize, setFontSize] = useState(() => {
    try { return parseInt(localStorage.getItem('shpeegle-fontsize')) || 18; } catch { return 18; }
  });
  const [fontFamily, setFontFamily] = useState(() => {
    try { return localStorage.getItem('shpeegle-fontfamily') || FONTS[0].value; } catch { return FONTS[0].value; }
  });
  const [lineHeight, setLineHeight] = useState(() => {
    try { return parseFloat(localStorage.getItem('shpeegle-lineheight')) || 1.8; } catch { return 1.8; }
  });

  const progress = epubData
    ? (chapterIndex + 1) / epubData.spine.length
    : 0;

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem('shpeegle-fontsize', fontSize);
      localStorage.setItem('shpeegle-fontfamily', fontFamily);
      localStorage.setItem('shpeegle-lineheight', lineHeight);
    } catch {}
  }, [fontSize, fontFamily, lineHeight]);

  // Parse epub on mount
  useEffect(() => {
    if (!bookData?.buffer) return;
    setLoading(true);
    setError(null);
    const buf = bookData.buffer.slice ? bookData.buffer.slice(0) : bookData.buffer;
    parseEpub(buf)
      .then((data) => {
        setEpubData(data);
        // Restore saved position (we store chapter index as the "cfi")
        const saved = bookMeta?.currentCfi;
        const startIdx =
          typeof saved === 'number' && saved >= 0 && saved < data.spine.length
            ? saved
            : 0;
        setChapterIndex(startIdx);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Epub parse error:', err);
        setError(err.message || 'Could not parse this epub file.');
        setLoading(false);
      });
  }, [bookData]);

  // Load chapter content when chapterIndex or epubData changes
  useEffect(() => {
    if (!epubData) return;
    const item = epubData.spine[chapterIndex];
    if (!item) return;

    setChapterLoading(true);
    loadChapter(epubData.zip, item)
      .then((html) => {
        setChapterHtml(html);
        setChapterLoading(false);
        // Scroll to top of new chapter
        contentRef.current?.scrollTo(0, 0);
        // Report progress
        const pct = (chapterIndex + 1) / epubData.spine.length;
        onUpdateProgress?.(chapterIndex, pct);
        // Find chapter label in TOC
        const basePath = item.fullPath.split('#')[0];
        const findLabel = (items) => {
          for (const t of items) {
            if (t.href.split('#')[0] === basePath) return t.label;
            if (t.subitems?.length) {
              const found = findLabel(t.subitems);
              if (found) return found;
            }
          }
          return null;
        };
        setCurrentLabel(
          findLabel(epubData.toc) ||
          `${chapterIndex + 1} / ${epubData.spine.length}`
        );
      })
      .catch(() => {
        setChapterHtml('<p style="color:#9090a0;padding:2em;text-align:center;">Failed to load chapter.</p>');
        setChapterLoading(false);
      });
  }, [epubData, chapterIndex]);

  // Navigation
  const goPrev = useCallback(() => {
    setChapterIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setChapterIndex((i) =>
      Math.min((epubData?.spine.length || 1) - 1, i + 1)
    );
  }, [epubData]);

  const goToHref = useCallback(
    (href) => {
      if (!epubData) return;
      const basePath = href.split('#')[0];
      const idx = epubData.spine.findIndex(
        (s) => s.fullPath.split('#')[0] === basePath
      );
      if (idx >= 0) setChapterIndex(idx);
      setShowToc(false);
    },
    [epubData]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') {
        if (showToc) setShowToc(false);
        else if (showSettings) setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showToc, showSettings, goNext, goPrev]);

  // Dynamic dark theme CSS for epub content
  const contentStyles = useMemo(
    () => `
    .epub-body {
      color: #e4e4ec;
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      line-height: ${lineHeight};
      padding: 40px 48px 80px;
      max-width: 100%;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .epub-body * { max-width: 100%; box-sizing: border-box; }
    .epub-body p, .epub-body li, .epub-body td, .epub-body th,
    .epub-body dd, .epub-body dt, .epub-body figcaption { color: #e4e4ec; }
    .epub-body span { color: inherit; }
    .epub-body h1, .epub-body h2, .epub-body h3,
    .epub-body h4, .epub-body h5, .epub-body h6 {
      font-family: 'Inter', system-ui, sans-serif;
      color: #f4f4fa;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    .epub-body h1 { font-size: 1.6em; }
    .epub-body h2 { font-size: 1.35em; }
    .epub-body h3 { font-size: 1.15em; }
    .epub-body a { color: #8b5cf6; text-decoration: none; }
    .epub-body a:hover { text-decoration: underline; }
    .epub-body img {
      max-width: 100%; height: auto;
      border-radius: 4px;
      display: block;
      margin: 1em auto;
    }
    .epub-body svg { max-width: 100%; height: auto; }
    .epub-body blockquote {
      border-left: 3px solid #7c3aed;
      padding-left: 1em;
      margin-left: 0;
      color: #9090a0;
      font-style: italic;
    }
    .epub-body pre, .epub-body code {
      background: #1a1a1f;
      color: #e4e4ec;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .epub-body pre { padding: 1em; overflow-x: auto; }
    .epub-body code { padding: 0.15em 0.3em; }
    .epub-body table { border-collapse: collapse; width: 100%; }
    .epub-body td, .epub-body th {
      border: 1px solid #2a2a32;
      padding: 0.5em;
    }
    .epub-body hr {
      border: none;
      border-top: 1px solid #2a2a32;
      margin: 2em 0;
    }
    .epub-body p { margin: 0.8em 0; }
    .epub-body ul, .epub-body ol { padding-left: 1.5em; }
    .epub-body li { margin: 0.3em 0; }
    .epub-body figure { margin: 1em 0; text-align: center; }
    .epub-body figcaption { font-size: 0.85em; color: #9090a0; margin-top: 0.5em; }
    .epub-body sup, .epub-body sub { font-size: 0.75em; }
    .epub-body em { font-style: italic; }
    .epub-body strong, .epub-body b { color: #f4f4fa; font-weight: 600; }
    .epub-body div { color: inherit; }
    .epub-body section { color: inherit; }
  `,
    [fontFamily, fontSize, lineHeight]
  );

  // Error state
  if (error) {
    return (
      <div className="h-full flex flex-col bg-void">
        <div className="flex items-center px-4 py-2.5 border-b border-border bg-abyss/80">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8 max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-crimson-muted/50 border border-crimson/30 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} className="text-crimson-glow" />
            </div>
            <h3 className="text-lg font-semibold text-bright mb-2">Couldn't open book</h3>
            <p className="text-sm text-muted mb-6">{error}</p>
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple text-white text-sm font-medium hover:bg-purple-dim transition-colors"
            >
              <ArrowLeft size={16} /> Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-void">
      <style dangerouslySetInnerHTML={{ __html: contentStyles }} />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-abyss/80 backdrop-blur-sm z-20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface transition-colors"
            title="Back to library"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="ml-1">
            <h2 className="text-sm font-medium text-bright leading-tight line-clamp-1 max-w-[300px]">
              {bookMeta?.title || 'Untitled'}
            </h2>
            {currentLabel && (
              <p className="text-xs text-muted line-clamp-1">{currentLabel}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowToc(!showToc); setShowSettings(false); }}
            className={`p-2 rounded-lg transition-colors ${showToc ? 'text-purple-glow bg-purple-muted/30' : 'text-muted hover:text-bright hover:bg-surface'}`}
            title="Table of Contents"
          >
            <List size={18} />
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowToc(false); }}
            className={`p-2 rounded-lg transition-colors ${showSettings ? 'text-purple-glow bg-purple-muted/30' : 'text-muted hover:text-bright hover:bg-surface'}`}
            title="Reading settings"
          >
            <Type size={18} />
          </button>
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface transition-colors"
            title={isFullWidth ? 'Narrow view' : 'Wide view'}
          >
            {isFullWidth ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex relative min-h-0 overflow-hidden">
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
                <button onClick={() => setShowToc(false)} className="p-1 rounded text-muted hover:text-bright">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <TocTree items={epubData?.toc || []} onSelect={goToHref} level={0} />
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
                <button onClick={() => setShowSettings(false)} className="p-1 rounded text-muted hover:text-bright">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-6">
                {/* Font size */}
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">Font Size</label>
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
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">Font</label>
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
                  <label className="text-xs text-muted uppercase tracking-wider font-medium block mb-2">Line Height</label>
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

        {/* Reader content */}
        <div
          ref={contentRef}
          className={`flex-1 min-h-0 overflow-y-auto transition-all duration-300 ${
            isFullWidth ? '' : 'mx-auto max-w-3xl'
          } w-full`}
          style={{ background: '#0a0a0c' }}
        >
          {loading || chapterLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-purple/30 border-t-purple-glow rounded-full animate-spin" />
                <p className="text-xs text-muted">
                  {loading ? 'Opening book...' : 'Loading chapter...'}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="epub-body"
              dangerouslySetInnerHTML={{ __html: chapterHtml }}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-abyss/80 flex-shrink-0">
        <button
          onClick={goPrev}
          disabled={chapterIndex === 0}
          className="p-1.5 rounded text-muted hover:text-bright transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 flex items-center gap-3">
          <span className="text-xs text-muted w-10 text-right">
            {Math.round(progress * 100)}%
          </span>
          <div className="flex-1 h-1 rounded-full bg-surface overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-purple to-purple-glow rounded-full"
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <span className="text-xs text-muted whitespace-nowrap">
            {chapterIndex + 1} / {epubData?.spine.length || '?'}
          </span>
        </div>
        <button
          onClick={goNext}
          disabled={chapterIndex >= (epubData?.spine.length || 1) - 1}
          className="p-1.5 rounded text-muted hover:text-bright transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
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
            {item.label || 'Untitled'}
          </button>
          {item.subitems?.length > 0 && (
            <TocTree items={item.subitems} onSelect={onSelect} level={level + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
