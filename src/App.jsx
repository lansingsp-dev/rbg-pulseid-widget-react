import React, {useEffect, useState, useRef} from 'react';
import debounce from 'lodash.debounce';
import styles from './App.module.css';
import ReactDOM from 'react-dom/client';


/**
 * @typedef {Object} PulseFont
 * @property {number|string} Id
 * @property {string} FontName
 * @property {string} FontPreviewUrl
 * @property {string=} FontType - comma-delimited, e.g. "embroidery-template, ..."
 */

/**
 * @typedef {Object} PulseColour
 * @property {number|string} Id
 * @property {string} Code
 * @property {number} Red
 * @property {number} Green
 * @property {number} Blue
 * @property {string} Name
 */

/**
 * @typedef {Object} PulseProduct
 * @property {string} Code
 * @property {string} ProductPreviewURL
 */

/**
 * @typedef {Object} TemplateElement
 * @property {number|string=} Id
 * @property {string=} ElementName - e.g., "Line1", "Line 2"
 * @property {string=} Text - text content for this element
 * @property {string=} FontOverride - Pulse font name for this element
 * @property {string|number=} TextColour - may be a code (e.g., "1842"), "1842 - Royal Blue", or name
 */

/**
 * @typedef {Object} TemplateFontMap
 * @property {string=} PulseFont - Pulse font identifier/name
 * @property {string=} FontName - UI/display font name used in app
 */

/**
 * @typedef {Object} PulseTemplate
 * @property {number|string} Id
 * @property {string} Code
 * @property {string} Name
 * @property {number=} TextLines - explicit count of supported text lines
 * @property {number=} NumberOfTextLines - alternate field sometimes used by API
 * @property {number=} Lines - another alias seen in API payloads
 * @property {TemplateElement[]=} TemplateElements - element metadata including Text, ElementName, etc.
 * @property {string=} FontOverride - template-level default font
 * @property {string=} DefaultFont - alternate default font field
 * @property {string=} Font - occasional alias
 * @property {string|number=} TextColour - template-level default text color (code or name)
 * @property {string|number=} DefaultColour - alternate color field
 * @property {string|number=} Colour - occasional alias
 * @property {string=} OrderType - e.g., 'embroidery-template'
 * @property {TemplateFontMap[]=} TemplateFonts - mapping from PulseFont -> FontName
 * @property {string=} ThumbnailUrl - cached/normalized thumbnail URL used by UI
 */

/**
 * @typedef {Object} PulseDesign
 * @property {string|number} Sid
 * @property {string} DesignName
 * @property {string} DesignPreviewURL
 * @property {string=} DesignPricingSKU
 * @property {string=} DesignCategory
 * @property {string=} Guid
 */

const DEFAULT_TEMPLATE_CODE = 'RBG_Default_Template';
const MAX_TEXT_LINES = 3;

/**
 * Determine the number of text lines a template supports.
 * Prefers explicit fields, then inspects TemplateElements for text-bearing elements,
 * falls back to parsing Name/Code.
 * Caps at 0..3.
 * @param {PulseTemplate} t
 */
function getTemplateLineCount(t) {
    if (!t) return 1;
    const explicit =
        typeof t.TextLines === 'number' ? t.TextLines :
        typeof t.NumberOfTextLines === 'number' ? t.NumberOfTextLines :
        typeof t.Lines === 'number' ? t.Lines : null;
    if (typeof explicit === 'number') {
        return Math.max(0, Math.min(MAX_TEXT_LINES, explicit));
    }
    // --- Inspect TemplateElements for text-bearing elements ---
    if (Array.isArray(t.TemplateElements)) {
        // Count elements with non-empty Text
        const textElements = t.TemplateElements.filter(
            el => el && typeof el.Text === 'string' && el.Text.trim().length > 0
        );
        if (textElements.length > 0) {
            return Math.max(0, Math.min(MAX_TEXT_LINES, textElements.length));
        }
        // If TemplateElements exists but none have non-empty Text, treat as design-only (0 lines)
        return 0;
    }
    const s = `${t.Name || ''} ${t.Code || ''}`.toLowerCase();
    if (s.includes('design only')) return 0;
    if (s.includes('three') || s.match(/\b3\b/)) return 3;
    if (s.includes('two') || s.match(/\b2\b/)) return 2;
    if (s.includes('one') || s.match(/\b1\b/)) return 1;
    return 1;
}

const apiBase = '/api/pulseid-proxy'; // Netlify proxy path

// Build a proxy URL for any asset or API endpoint. Accepts absolute URLs or endpoints.
const toProxyAssetUrl = (input) => {
  if (!input) return '';
  let u = String(input).trim();
  // Expand token used by PulseID payloads
  u = u.replace('{api domain}', 'https://rockbottom.pulseidconnect.com');
  // Route everything through the proxy. If it's an absolute URL, use `url=`; otherwise `endpoint=`.
  const isAbs = /^https?:\/\//i.test(u);
  const key = isAbs ? 'url' : 'endpoint';
  return `${apiBase}?${key}=${encodeURIComponent(u)}`;
};

const FONT_TYPE_FILTER = 'embroidery-template';
const RENDER_DEBOUNCE_MS = 1000;

function getSelectedColorName(colors, rgb) {
    return colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb)?.Name.split(' - ')[1] || '';
}

function getSelectedColorCode(colors, rgb) {
    const found = colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb);
    return found?.Code || null;
}

function getColorCode(rgb, colors) {
    const match = colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb);
    return match?.Name || '';
}

// --- Utilities for Template Element/Color/Font Extraction ---

/**
 * Heuristic rank for common PulseID element names, so our UI order matches
 * the renderer's intended mapping. Lower rank sorts earlier.
 * 1: Top/Text/Line1/Upper, 2: Bottom/Bot/Line2/Lower, 3: Line3, else 999
 */
function rankElementName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return 999;
  // Explicit top synonyms
  if (/(^|\b)(top|upper)\b/.test(n)) return 1;
  if (/^text$/.test(n)) return 1;
  if (/line\s*1\b/.test(n)) return 1;
  // Explicit bottom synonyms
  if (/(^|\b)(bottom|bot|lower)\b/.test(n)) return 2;
  if (/line\s*2\b/.test(n)) return 2;
  // Third line
  if (/line\s*3\b/.test(n)) return 3;
  return 999;
}

/**
 * Returns true if the template exposes a Design element in TemplateElements.
 * The check is case-insensitive on ElementName === "Design".
 * If there are no TemplateElements, we treat it as NOT supporting Design.
 */
function templateSupportsDesign(t) {
  if (!t || !Array.isArray(t.TemplateElements)) return false;
  return t.TemplateElements.some(el => String(el?.ElementName || '').trim().toLowerCase() === 'design');
}

/**
 * Returns an array of element names for the selected template, in correct order for text lines.
 * Falls back to ["Line1", ...] if not available.
 * @param {PulseTemplate} template
 * @param {number} count
 * @returns {string[]}
 */
function getElementNamesForTemplate(template, count) {
  const fallback = Array.from({ length: count }, (_, i) => `Line${i + 1}`);
  if (!template || !Array.isArray(template.TemplateElements)) return fallback;

  // Collect text-capable elements with their name and rank
  const els = template.TemplateElements
    .filter(el => el && typeof el.Text === 'string')
    .map(el => {
      const name = String(el.ElementName || '').trim();
      const rank = rankElementName(name);
      // If no rank, try to infer numeric order fallback
      const numeric = parseInt(name.match(/line\s*(\d+)/i)?.[1] || '999', 10);
      return { name: name || '', rank, numeric };
    })
    .filter(e => e.name);

  if (els.length === 0) return fallback;

  els.sort((a, b) => (a.rank - b.rank) || (a.numeric - b.numeric) || a.name.localeCompare(b.name));
  const ordered = els.map(e => e.name);

  while (ordered.length < count) ordered.push(`Line${ordered.length + 1}`);
  return ordered.slice(0, count);
}

/**
 * Attempt to resolve a PulseColour to an RGB string from a variety of inputs
 * e.g. "1678 - Orange", "1678", "Orange", exact Name, Code, or rgb()/hex string.
 * More tolerant implementation.
 */
function findColourRgbFromTemplateValue(value, colours) {
    if (!value || !Array.isArray(colours) || colours.length === 0) return null;
    const s = String(value).trim();

    // Pass-through rgb()/hex
    if (/^rgb\(/i.test(s)) return s;
    if (/^#?[0-9a-f]{6}$/i.test(s)) return s.startsWith('#') ? s : `#${s}`;

    // Try code first if it starts with digits (e.g., "1842 - Royal Blue" or "1842")
    const codeMatch = s.match(/^(\d{3,4})/);
    if (codeMatch) {
        const code = codeMatch[1];
        const byCode = colours.find(c => String(c.Code) === code);
        if (byCode) return `rgb(${byCode.Red}, ${byCode.Green}, ${byCode.Blue})`;
    }

    // Exact name match
    let byName = colours.find(c => String(c.Name).toLowerCase() === s.toLowerCase());
    if (byName) return `rgb(${byName.Red}, ${byName.Green}, ${byName.Blue})`;

    // Name contains / overlap (handles "1842 - Royal Blue" vs. "Royal Blue")
    byName = colours.find(c => String(c.Name).toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(String(c.Name).toLowerCase()));
    if (byName) return `rgb(${byName.Red}, ${byName.Green}, ${byName.Blue})`;

    // Try the part after "-" as a display name
    const parts = s.split(/\s*-\s*/);
    if (parts.length > 1) {
        const tail = parts.slice(1).join(' - ');
        const byTail = colours.find(c => String(c.Name).toLowerCase().includes(tail.toLowerCase()));
        if (byTail) return `rgb(${byTail.Red}, ${byTail.Green}, ${byTail.Blue})`;
    }

    return null;
}

/**
 * Initialize Text inputs, Font, and Color from a template's TemplateElements
 * Falls back to line count heuristics when elements are missing.
 */
function deriveControlsFromTemplate(template, colours) {
    const result = { lines: null, font: null, colorRgb: null };
    if (!template) return result;

    const elements = Array.isArray(template.TemplateElements) ? template.TemplateElements : [];

    // Allow top-level fallbacks (some list responses include defaults on the template itself)
    const topLevelFont = template.FontOverride || template.DefaultFont || template.Font || null;
    const topLevelColour = template.TextColour || template.DefaultColour || template.Colour || null;

    // Prefer elements that actually carry Text for line initialization
    const textEls = elements.filter(el => el && typeof el.Text === 'string');

    // Sort text elements with the same heuristic as getElementNamesForTemplate
    textEls.sort((a, b) => {
      const an = String(a.ElementName || '');
      const bn = String(b.ElementName || '');
      const ar = rankElementName(an);
      const br = rankElementName(bn);
      if (ar !== br) return ar - br;
      const ai = parseInt(an.match(/line\s*(\d+)/i)?.[1] || '999', 10);
      const bi = parseInt(bn.match(/line\s*(\d+)/i)?.[1] || '999', 10);
      if (ai !== bi) return ai - bi;
      return an.localeCompare(bn);
    });

    if (textEls.length > 0) {
        result.lines = textEls.slice(0, 3).map(el => String(el.Text || ''));
    } else {
        // No explicit text-bearing elements; fall back to template metadata
        const count = getTemplateLineCount(template);
        result.lines = Array.from({ length: Math.min(count, 3) }, () => '');
    }

    // --- Font resolution: prefer a text element that specifies FontOverride; otherwise any element with FontOverride; otherwise top-level
    const fontEl = textEls.find(el => el && el.FontOverride) || elements.find(el => el && el.FontOverride);
    if (fontEl && fontEl.FontOverride) {
      result.font = String(fontEl.FontOverride);
    } else if (topLevelFont) {
      result.font = String(topLevelFont);
    }

    // --- Color resolution: prefer a text element's TextColour; otherwise any element's TextColour; otherwise top-level
    const colorEl = textEls.find(el => el && el.TextColour) || elements.find(el => el && el.TextColour);
    if (colorEl && colorEl.TextColour) {
      const rgb = findColourRgbFromTemplateValue(colorEl.TextColour, colours);
      if (rgb) result.colorRgb = rgb;
    } else if (topLevelColour) {
      const rgb = findColourRgbFromTemplateValue(topLevelColour, colours);
      if (rgb) result.colorRgb = rgb;
    }

    return result;
}

// Preview image component
const PreviewImage = ({src, alt, className, onLoad, onError}) => (
  <img src={src} alt={alt} className={className} onLoad={onLoad} onError={onError} />
);

// Spinner overlay wrapper for preview image
const PreviewWithSpinner = ({ src, alt, imgClassName, showSpinner, onLoaded, imgKey }) => (
  <div className={styles.imageWrapper}>
    <PreviewImage
      key={imgKey}
      src={src}
      alt={alt}
      className={imgClassName}
      onLoad={onLoaded}
      onError={onLoaded}
    />
    <div className={showSpinner ? styles.spinnerOverlay : styles.spinnerHidden}>
      <div className={styles.spinner} />
    </div>
  </div>
);

// Stable key for a design, used for selection and caching
function designKey(d) {
    return d.$id;
}

/**
 * @param {{
 *  fonts: PulseFont[],
 *  selectedFont: string,
 *  onSelect: (name: string) => void
 * }} props
 */
const FontSelector = ({fonts, selectedFont, onSelect}) => (
    <div className={styles.fontButtonRow}>
        {fonts.map((f) => {
            const isSelected = selectedFont === f.FontName;
            return (
                <button
                    key={f.Id}
                    onClick={() => onSelect(f.FontName)}
                    className={isSelected ? styles.fontButtonSelected : styles.fontButton}
                >
                    <img
                        src={toProxyAssetUrl(f.FontPreviewUrl)}
                        alt={f.FontName}
                        className={styles.fontPreviewImage}
                    />
                </button>
            );
        })}
    </div>
);

/**
 * @param {{
 *  colors: PulseColour[],
 *  selectedColor: string|null,
 *  onSelect: (rgb: string) => void
 * }} props
 */
const ColorSelector = ({colors, selectedColor, onSelect}) => (
    <div className={styles.colorButtonRow}>
        {colors.map(/** @param {PulseColour} c */ (c) => {
            const rgb = `rgb(${c.Red}, ${c.Green}, ${c.Blue})`;
            const selectedName = getSelectedColorName(colors, selectedColor);
            const selectedCode = getSelectedColorCode(colors, selectedColor);
            const thisName = (c.Name || '').split(' - ')[1] || c.Name || '';
            const isSelected = (
                selectedColor === rgb ||
                (selectedName && thisName && selectedName.toLowerCase() === thisName.toLowerCase()) ||
                (selectedCode && String(selectedCode) === String(c.Code))
            );
            return (
                <button
                    key={c.Id}
                    onClick={() => onSelect(rgb)}
                    title={c.Name}
                    style={/** @type {import('react').CSSProperties} */ ({ '--swatch': rgb })}
                    className={isSelected ? styles.colorButtonSelected : styles.colorButton}
                />
            );
        })}
    </div>
);

// Text input component
const TextInput = ({value, onChange}) => (
    <input className={styles.textInput} value={value} onChange={onChange} />
);

/**
 * @param {{
 *  templates: PulseTemplate[],
 *  selectedTemplateCode: string|null,
 *  onSelect: (tpl: PulseTemplate) => void
 * }} props
 */
const TemplateSelector = ({templates, selectedTemplateCode, onSelect}) => (
    <div className={styles.fontButtonRow}>
        {templates.map((t) => {
            const isSelected = selectedTemplateCode === t.Code;
            return (
                <button
                    key={t.Id ?? t.Code}
                    onClick={() => onSelect(t)}
                    className={isSelected ? styles.templateButtonSelected : styles.templateButton}
                    title={t.Name}
                >
                    <img
                        src={t.ThumbnailUrl}
                        alt={t.Name}
                        className={styles.templatePreviewImage}
                    />
                </button>
            );
        })}
    </div>
);

/**
 * @param {{
 *  designs: PulseDesign[],
 *  selectedDesignKey: string|null,
 *  onSelect: (design: PulseDesign) => void
 * }} props
 */
const DesignSelector = ({ designs, selectedDesignKey, onSelect }) => {
    const rowRef = useRef(null);
    const itemRefs = useRef(new Map());
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const updateArrows = () => {
        const scrollContainer = rowRef.current;
        if (!scrollContainer) return;
        const EPS = 2;
        const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
        setCanLeft(scrollContainer.scrollLeft > EPS);
        setCanRight(scrollContainer.scrollLeft < maxScrollLeft - EPS);
    };

    useEffect(() => {
        updateArrows();
        const scrollContainer = rowRef.current; if (!scrollContainer) return;
        const onScroll = () => {
            requestAnimationFrame(updateArrows);
        };
        scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', updateArrows);
        return () => {
            scrollContainer.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', updateArrows);
        };
    }, []);

    // Recalculate arrows whenever the row resizes (image loading can change scrollWidth)
    useEffect(() => {
        const el = rowRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => updateArrows());
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (selectedDesignKey == null) return;
        const el = itemRefs.current.get(selectedDesignKey);
        if (el && el.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        setTimeout(updateArrows, 200);
    }, [selectedDesignKey]);

    // Re-evaluate arrows once designs render (images can change scrollWidth)
    useEffect(() => {
        updateArrows();
        // delay to allow layout/scrollWidth to settle after images load
        const id = setTimeout(updateArrows, 250);
        return () => clearTimeout(id);
    }, [designs]);

    const scrollByAmount = (dir) => {
        const el = rowRef.current; if (!el) return;
        const delta = Math.round(el.clientWidth * 0.6) * (dir === 'left' ? -1 : 1);
        const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
        const target = Math.max(0, Math.min(el.scrollLeft + delta, maxLeft));
        el.scrollTo({ left: target, behavior: 'smooth' });
        setTimeout(updateArrows, 200);
    };

    return (
        <div className={styles.designsContainer}>
            <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); scrollByAmount('left'); }}
                className={`${styles.scrollArrow} ${styles.scrollArrowLeft} ${!canLeft ? styles.scrollArrowDisabled : ''}`}
                aria-label="Scroll designs left"
            >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>

            <div ref={rowRef} className={styles.designsRow}>
                {designs.map(d => {
                    const key = designKey(d);
                    const isSel = selectedDesignKey === key;
                    return (
                        <button
                            key={key}
                            ref={(el) => {
                                if (el) itemRefs.current.set(key, el); else itemRefs.current.delete(key);
                            }}
                            onClick={() => onSelect(d)}
                            className={isSel ? styles.designButtonSelected : styles.designButton}
                            title={d.DesignName}
                            aria-pressed={isSel}
                        >
                            <img
                                src={d.ThumbnailUrl || (d.DesignPreviewURL ? toProxyAssetUrl(d.DesignPreviewURL) : '')}
                                loading="lazy"
                                alt={d.DesignName}
                                className={styles.designPreviewImage}
                                onLoad={updateArrows}
                                onError={(e) => {
                                    if (e.currentTarget.dataset.fallbackTried) return; // only try once
                                    e.currentTarget.dataset.fallbackTried = '1';
                                    const alt = d.$id ?? d.Code ?? d.DesignName ?? '';
                                    e.currentTarget.src = alt ? `${apiBase}?endpoint=/api/api/Designs/RenderPNG/${encodeURIComponent(String(alt))}` : '';
                                }}
                            />
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); scrollByAmount('right'); }}
                className={`${styles.scrollArrow} ${styles.scrollArrowRight} ${!canRight ? styles.scrollArrowDisabled : ''}`}
                aria-label="Scroll designs right"
            >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>
        </div>
    );
};

// Reusable Text Inputs section to avoid duplication
const TextInputsSection = ({ selectedTemplate, textLines, setTextLines }) => {
  const count = getTemplateLineCount(selectedTemplate ?? {});
  if (count <= 0) return null;
  return (
    <div className={styles.labelInputDiv}>
      <label className={styles.sectionLabel}>Text:</label>
      {Array.from({ length: Math.min(MAX_TEXT_LINES, count) }).map((_, i) => (
        <TextInput
          key={i}
          value={textLines[i] ?? ''}
          onChange={(e) => {
            const next = [...textLines];
            next[i] = e.target.value;
            setTextLines(next);
          }}
        />
      ))}
    </div>
  );
};

const App = () => {
    /** @type {[PulseProduct|null, Function]} */
    const [product, setProduct] = useState(null);
    const [textLines, setTextLines] = useState(['My Custom Text']); // up to 3 lines
    const [font, setFont] = useState('Block');
    const [color, setColor] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [pendingUrl, setPendingUrl] = useState('');
    const [displayedUrl, setDisplayedUrl] = useState('');
    const [isRendering, setIsRendering] = useState(false);
    /** @type {[PulseFont[], Function]} */
    const [availableFonts, setAvailableFonts] = useState([]);
    /** @type {[PulseColour[], Function]} */
    const [availableColors, setAvailableColors] = useState([]);
    /** @type {[PulseTemplate[], Function]} */
    const [availableTemplates, setAvailableTemplates] = useState([]);
    /** @type {[PulseTemplate|null, Function]} */
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    /** @type {[PulseDesign[], Function]} */
    const [availableDesigns, setAvailableDesigns] = useState([]);
    /** @type {[PulseDesign|null, Function]} */
    const [selectedDesign, setSelectedDesign] = useState(null);
    const [imgKey, setImgKey] = useState(0);           // force img remount on src change so onLoad always fires
    const [lastRenderUrl, setLastRenderUrl] = useState(''); // track last URL to avoid unnecessary spinner

    // In-memory (React state) store for thumbnails
    const [templateThumbByCode, setTemplateThumbByCode] = useState({});     // { [code]: url }

    // In-memory (React state) store for design thumbnails
    const [designThumbByKey, setDesignThumbByKey] = useState({}); // { [key]: url }

    // Helper to fetch/get a design thumbnail using React state as cache
    const getDesignThumbnail = async (design) => {
        const key = designKey(design);
        if (!key) return '';
        if (designThumbByKey[key]) return designThumbByKey[key];

        const url = `${apiBase}?endpoint=/api/api/Designs/RenderPNG/${encodeURIComponent(design.DesignName)}`;
        setDesignThumbByKey(prev => ({ ...prev, [key]: url }));
        return url;
    };

    // Helper to fetch/get a template thumbnail using React state as cache
    const getTemplateThumbnail = async (code) => {
      if (templateThumbByCode[code]) return templateThumbByCode[code];
      try {
        const tr = await fetch(`${apiBase}?endpoint=/api/api/Templates/GetThumbnail&id=${encodeURIComponent(code)}`);
        const thumb = await tr.text();
        const normalized = (thumb || '').replace('{api domain}', 'https://rockbottom.pulseidconnect.com');
        const proxied = toProxyAssetUrl(normalized);
        setTemplateThumbByCode(prev => ({ ...prev, [code]: proxied }));
        return proxied;
      } catch (e) {
        console.error('[RBG]', 'Thumbnail fetch failed for', code, e);
        return '';
      }
    };

    // --- State for template initialization ---
    const [templateInitPending, setTemplateInitPending] = useState(false);

    const [showFonts, setShowFonts] = useState(false);
    const [showColors, setShowColors] = useState(false);
    const [showTextInputs, setShowTextInputs] = useState(false);
    const [showTemplate, setShowTemplate] = useState(false);
    const [showDesigns, setShowDesigns] = useState(false);

    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
      const checkMobile = () => setIsMobile(window.innerWidth < 768);
      checkMobile(); // run once on mount
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Derived: Does the selected template have any text lines?
    const hasTextLines = getTemplateLineCount(selectedTemplate ?? {}) > 0;

    const toggleSection = (section) => {
        // Prevent text/font/color drawers when the template has no text elements
        if ((section === 'text' || section === 'font' || section === 'color') && !hasTextLines) {
            setShowTextInputs(false);
            setShowFonts(false);
            setShowColors(false);
            return;
        }
        // Prevent opening Designs when the current template doesn't support a Design element
        if (section === 'designs' && !templateSupportsDesign(selectedTemplate)) {
            // also ensure the design drawer is closed
            setShowDesigns(false);
            return;
        }
        setShowTemplate(section === 'template' ? (prev) => !prev : false);
        setShowDesigns(section === 'designs' ? (prev) => !prev : false);
        setShowTextInputs(section === 'text' ? (prev) => !prev : false);
        setShowFonts(section === 'font' ? (prev) => !prev : false);
        setShowColors(section === 'color' ? (prev) => !prev : false);
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const vId = params.get('variantid') || params.get('sku');

        if (!vId) return;

        const fetchProduct = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/api/Designer/GetProduct&variantId=${vId}`);
                const text = await res.text();
                const data = JSON.parse(text);
                setProduct(data);
                // Set initial displayedUrl if available
                if (data?.ProductPreviewURL) setDisplayedUrl(data.ProductPreviewURL);
            } catch (err) {
                console.error('[RBG]', 'Failed to fetch product:', err);
            }
        };

        const fetchFonts = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/api/Fonts/GetFonts`);
                const data = await res.json();
                const filteredFonts = data.filter(f =>
                    typeof f.FontType === 'string' &&
                    f.FontType.split(',').map(type => type.trim()).includes(FONT_TYPE_FILTER)
                );
                setAvailableFonts(filteredFonts);
            } catch (err) {
                console.error('[RBG]', 'Failed to fetch fonts:', err);
            }
        };

        const fetchColors = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/api/Colours/GetColours`);
                const data = await res.json();
                setAvailableColors(data);
            } catch (err) {
                console.error('[RBG]', 'Failed to fetch colors:', err);
            }
        };

        const fetchTemplates = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/api/Templates/ListTemplates`);
                const data = await res.json();
                // Filter templates whose Code starts with 'RBG_'
                const rbg = Array.isArray(data) ? data.filter(t => typeof t.Code === 'string' && t.Code.startsWith('RBG_')) : [];

                // For each template, fetch/remember its thumbnail
                const withThumbs = await Promise.all(rbg.map(async (t) => {
                  const thumb = await getTemplateThumbnail(t.Code);
                  return { ...t, ThumbnailUrl: thumb };
                }));

                setAvailableTemplates(withThumbs);

                if (withThumbs.length > 0) {
                  const first = withThumbs[0];
                  setSelectedTemplate(first);
                  // Clear any previously selected design if this template doesn't support a Design element
                  if (!templateSupportsDesign(first)) {
                    setSelectedDesign(null);
                    setShowDesigns(false);
                  }
                  setTemplateInitPending(true);
                  const count = getTemplateLineCount(first);
                  setTextLines((prev) => {
                    const next = [...(Array.isArray(prev) ? prev : [''])];
                    while (next.length < count) next.push('');
                    return next.slice(0, Math.min(MAX_TEXT_LINES, count));
                  });
                }
            } catch (err) {
                console.error('[RBG]', 'Failed to fetch templates:', err);
            }
        };

        const fetchDesigns = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/api/Designs/GetDesigns`);
                const data = await res.json();
                const rawList = Array.isArray(data) ? data : [];
                const withThumbs = await Promise.all(
                    rawList.map(async (d) => ({
                        ...d,
                        ThumbnailUrl: await getDesignThumbnail(d),
                    }))
                );
                setAvailableDesigns(withThumbs);
                if (!selectedDesign && withThumbs.length > 0) setSelectedDesign(withThumbs[0]);
            } catch (err) {
                console.error('[RBG]', 'Failed to fetch designs:', err);
            }
        };

        void fetchProduct();
        void fetchFonts();
        void fetchColors();
        void fetchTemplates();
        void fetchDesigns();
    }, []);

    const handleSelectTemplate = (tpl) => {
        setSelectedTemplate(tpl);
        // If the new template lacks a Design element, clear any selected design and close the drawer
        if (!templateSupportsDesign(tpl)) {
          setSelectedDesign(null);
          setShowDesigns(false);
        }
        setTemplateInitPending(true);
        const count = getTemplateLineCount(tpl);
        setTextLines((prev) => {
          const next = [...(Array.isArray(prev) ? prev : [''])];
          while (next.length < count) next.push('');
          return next.slice(0, Math.min(MAX_TEXT_LINES, count));
        });
        // Close drawers when selecting a design-only template (no text lines)
        if (count <= 0) {
          setShowTextInputs(false);
          setShowFonts(false);
          setShowColors(false);
        }
    };

    const handleSelectDesign = (d) => setSelectedDesign(d);

// Map a Pulse font (e.g., "Block Regular") to a UI FontName (e.g., "Block")
// Prefer mapping via Template.TemplateFonts (PulseFont -> FontName), then fall back to tolerant matching
function resolveFontFromOverride(tpl, override, availableFonts) {
  if (!override || !Array.isArray(availableFonts) || availableFonts.length === 0) return null;
  const ov = String(override).trim();

  // 1) Try mapping through TemplateFonts
  const tf = Array.isArray(tpl?.TemplateFonts) ? tpl.TemplateFonts : [];
  const byPulse = tf.find(f => String(f.PulseFont || '').toLowerCase() === ov.toLowerCase());
  if (byPulse && byPulse.FontName) {
    const found = availableFonts.find(f => String(f.FontName || '').toLowerCase() === String(byPulse.FontName).toLowerCase());
    if (found) return found.FontName;
  }

  // 2) Forgiving compare directly against availableFonts[].FontName
  const normalize = s => String(s).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const nOv = normalize(ov);

  // a) exact case-insensitive
  let found = availableFonts.find(f => String(f.FontName).toLowerCase() === ov.toLowerCase());
  if (found) return found.FontName;

  // b) punctuation-insensitive
  found = availableFonts.find(f => normalize(f.FontName) === nOv);
  if (found) return found.FontName;

  // c) prefix/suffix tolerant
  found = availableFonts.find(f => normalize(f.FontName).startsWith(nOv) || nOv.startsWith(normalize(f.FontName)));
  return found ? found.FontName : null;
}

    // --- Template/Color/Font/Lines initialization effect ---
    useEffect(() => {
        if (
          !templateInitPending ||
          !selectedTemplate ||
          availableColors.length === 0 ||
          availableFonts.length === 0
        ) return;

        const { lines, font: tplFont, colorRgb } = deriveControlsFromTemplate(selectedTemplate, availableColors);

        if (Array.isArray(lines)) {
            const trimmed = lines.slice(0, MAX_TEXT_LINES);
            setTextLines(trimmed);
        }
        if (tplFont) {
          const resolved = resolveFontFromOverride(selectedTemplate, tplFont, availableFonts) || tplFont;
          setFont(resolved);
        }
        if (colorRgb) {
          setColor(colorRgb);
        } else if (color == null) {
          const white = availableColors.find(c => c.Code === "1801");
          if (white) setColor(`rgb(${white.Red}, ${white.Green}, ${white.Blue})`);
        }

        setTemplateInitPending(false);
    }, [templateInitPending, selectedTemplate, availableColors.length, availableFonts.length]);

    useEffect(() => {
        if (!product || !color) return;
        const debouncedRender = debounce(() => {
            const productCode = product?.Code;
            const transparency = "%2300FFFFFF";
            const textColorCode = getColorCode(color, availableColors);
            const templateCode = selectedTemplate?.Code || DEFAULT_TEMPLATE_CODE;
            const orderType = selectedTemplate?.OrderType || 'embroidery-template';

            const elementNames = getElementNamesForTemplate(selectedTemplate, textLines.length);
            const parts = [];

            let pIndex = 0;
            textLines.forEach((txt, i) => {
              if (typeof txt === 'string' && txt.trim().length > 0) {
                const elName = elementNames[i] || `Line${i + 1}`;
                parts.push(`&Personalizations[${pIndex}].ElementName=${encodeURIComponent(elName)}`);
                parts.push(`&Personalizations[${pIndex}].Text=${encodeURIComponent(txt)}`);
                parts.push(`&Personalizations[${pIndex}].IsText=true`);
                parts.push(`&Personalizations[${pIndex}].TextColour=${textColorCode}`);
                parts.push(`&Personalizations[${pIndex}].FontOverride=${encodeURIComponent(font)}`);
                pIndex++;
              }
            });

            const designName = String(selectedDesign?.DesignName || '').trim();
            if (designName) {
              parts.push(`&Personalizations[${pIndex}].ElementName=Design`);
              parts.push(`&Personalizations[${pIndex}].Design=${encodeURIComponent(designName)}`);
            }

            const newUrl = `${apiBase}?endpoint=/api/api/Orders/Render`
              + `&OrderType=${encodeURIComponent(orderType)}`
              + `&ProductCode=${productCode}`
              + `&TemplateCode=${encodeURIComponent(templateCode)}`
              + parts.join('')
              + `&Transparency=${transparency}`
              + `&RenderOnProduct=true`
              + `&Dpi=72`;

            if (newUrl !== lastRenderUrl) {
              setIsRendering(true);
              setPendingUrl(newUrl);
              setLastRenderUrl(newUrl);
            }
        }, RENDER_DEBOUNCE_MS);

        debouncedRender();
        return () => debouncedRender.cancel();
    }, [textLines, font, color, product, availableColors, selectedTemplate, selectedDesign]);

    // Preload pendingUrl and only swap in when loaded
    useEffect(() => {
      if (!pendingUrl) return;
      const img = new window.Image();
      img.onload = () => {
        setPreviewUrl(pendingUrl);     // keep as the 'current' render URL
        setDisplayedUrl(pendingUrl);   // actually shown in the UI
        setImgKey(k => k + 1);         // ensure onLoad fires in PreviewImage
        setIsRendering(false);
      };
      img.onerror = () => {
        // if the render failed to load, stop spinner but keep the last good image
        setIsRendering(false);
      };
      img.src = pendingUrl;
      return () => {
        img.onload = null;
        img.onerror = null;
      };
    }, [pendingUrl]);

    useEffect(() => {
      if (!isRendering) return;
      const id = setTimeout(() => setIsRendering(false), 10000); // auto-hide after 10 seconds
      return () => clearTimeout(id);
    }, [isRendering, imgKey]);

    return (
        <div className={isMobile ? styles.appContainer : styles.container}>
            {isMobile ? (
            // Mobile layout
                <>
                    <div className={styles.fullscreenPreview}>
                        <PreviewWithSpinner
                          src={displayedUrl || product?.ProductPreviewURL}
                          alt="Bag Preview"
                          imgClassName={styles.fullscreenImage}
                          showSpinner={isRendering}
                          onLoaded={() => setIsRendering(false)}
                          imgKey={imgKey}
                        />
                    </div>

                    <div className={styles.floatingControls}>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('template')}
                            aria-label="Template"
                        >
                            <span className={styles.btnIcon} aria-hidden>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="8" height="8" rx="1"></rect>
                                <rect x="13" y="3" width="8" height="8" rx="1"></rect>
                                <rect x="3" y="13" width="8" height="8" rx="1"></rect>
                                <rect x="13" y="13" width="8" height="8" rx="1"></rect>
                              </svg>
                            </span>
                            <span className={styles.btnLabel}>Template</span>
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('designs')}
                            aria-label="Designs"
                            disabled={!templateSupportsDesign(selectedTemplate)}
                        >
                            <span className={styles.btnIcon} aria-hidden>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                                <rect x="14" y="4" width="7" height="7" rx="1"></rect>
                                <rect x="4" y="14" width="7" height="7" rx="1"></rect>
                                <path d="M14 14h6v6h-6z"></path>
                              </svg>
                            </span>
                            <span className={styles.btnLabel}>Designs</span>
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('text')}
                            aria-label="Text"
                            disabled={!hasTextLines}
                        >
                            <span className={styles.btnIcon} aria-hidden>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="4 7 4 4 20 4 20 7" />
                                <line x1="9" y1="20" x2="15" y2="20" />
                                <line x1="12" y1="4" x2="12" y2="20" />
                              </svg>
                            </span>
                            <span className={styles.btnLabel}>Text</span>
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('font')}
                            aria-label="Font"
                            disabled={!hasTextLines}
                        >
                            <span className={styles.btnIcon} aria-hidden>Aa</span>
                            <span className={styles.btnLabel}>Font</span>
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('color')}
                            aria-label="Color"
                            disabled={!hasTextLines}
                        >
                            <span className={styles.btnIcon} aria-hidden>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3a9 9 0 0 0-9 9c0 4.97 4.03 9 9 9h.8a2.7 2.7 0 0 0 0-5.4H11a1.6 1.6 0 0 1 0-3.2h2.2a4.8 4.8 0 0 0 0-9.6z" />
                                <circle cx="7.5" cy="12" r="1.2" />
                                <circle cx="9.5" cy="8" r="1.2" />
                                <circle cx="14.5" cy="8" r="1.2" />
                                <circle cx="17" cy="11" r="1.2" />
                              </svg>
                            </span>
                            <span className={styles.btnLabel}>Color</span>
                        </button>
                    </div>

                    <div className={`${styles.drawer} ${showTemplate ? styles.drawerVisible : styles.drawerHidden}`}>
                        <div className={styles.labelInputDiv}>
                            <label className={styles.sectionLabel}>Template:</label>
                            <TemplateSelector
                                templates={availableTemplates}
                                selectedTemplateCode={selectedTemplate?.Code ?? null}
                                onSelect={handleSelectTemplate}
                            />
                        </div>
                    </div>

                    {templateSupportsDesign(selectedTemplate) && (
                      <div className={`${styles.drawer} ${showDesigns ? styles.drawerVisible : styles.drawerHidden}`}>
                          <div className={styles.labelInputDiv}>
                              <label className={styles.sectionLabel}>Designs:</label>
                              {selectedDesign && (
                                <span className={styles.selectedDesignInfo}>
                                  <img
                                    className={styles.selectedDesignThumb}
                                    src={selectedDesign.ThumbnailUrl || (selectedDesign.DesignPreviewURL ? toProxyAssetUrl(selectedDesign.DesignPreviewURL) : '')}
                                    alt={selectedDesign.DesignName}
                                  />
                                  <span className={styles.selectedDesignName}>{selectedDesign.DesignName}</span>
                                </span>
                              )}
                              <DesignSelector
                                  designs={availableDesigns}
                                  selectedDesignKey={selectedDesign ? designKey(selectedDesign) : null}
                                  onSelect={handleSelectDesign}
                              />
                          </div>
                      </div>
                    )}

                    {hasTextLines && (
                      <div className={`${styles.drawer} ${showTextInputs ? styles.drawerVisible : styles.drawerHidden}`}>
                          <TextInputsSection
                            selectedTemplate={selectedTemplate}
                            textLines={textLines}
                            setTextLines={setTextLines}
                          />
                      </div>
                    )}

                    {hasTextLines && (
                      <div className={`${styles.drawer} ${showFonts ? styles.drawerVisible : styles.drawerHidden}`}>
                          <div className={styles.labelInputDiv}>
                              <label className={styles.sectionLabel}>Font:</label>
                              <FontSelector
                                  fonts={availableFonts}
                                  selectedFont={font}
                                  onSelect={setFont}
                              />
                          </div>
                      </div>
                    )}

                    {hasTextLines && (
                      <div className={`${styles.drawer} ${showColors ? styles.drawerVisible : styles.drawerHidden}`}>
                          <div className={styles.inlineLabel}>
                              <label className={styles.sectionLabel}>Color:</label>
                              <span className={styles.selectedColorName}>
                                {getSelectedColorName(availableColors, color)}
                              </span>
                          </div>
                          <ColorSelector
                              colors={availableColors}
                              selectedColor={color}
                              onSelect={setColor}
                          />
                      </div>
                    )}
                </>
            ) : (
            // Desktop layout
                <>
                    <div className={styles.imageContainer}>
                        <PreviewWithSpinner
                          src={displayedUrl || product?.ProductPreviewURL}
                          alt="Bag Preview"
                          imgClassName={styles.image}
                          showSpinner={isRendering}
                          onLoaded={() => setIsRendering(false)}
                          imgKey={imgKey}
                        />
                    </div>

                    <div className={styles.controlContainer}>
                        <h2 className={styles.sectionTitle}>Customize Your Product</h2>

                        <div className={styles.labelInputDiv}>
                            <label className={styles.sectionLabel}>Template:</label>
                            <TemplateSelector
                                templates={availableTemplates}
                                selectedTemplateCode={selectedTemplate?.Code ?? null}
                                onSelect={handleSelectTemplate}
                            />
                        </div>

                        {templateSupportsDesign(selectedTemplate) && (
                          <div className={styles.labelInputDiv}>
                              <label className={styles.sectionLabel}>Designs:</label>
                              {selectedDesign && (
                                <span className={styles.selectedDesignInfo}>
                                  <img
                                    className={styles.selectedDesignThumb}
                                    src={selectedDesign.ThumbnailUrl || (selectedDesign.DesignPreviewURL ? toProxyAssetUrl(selectedDesign.DesignPreviewURL) : '')}
                                    alt={selectedDesign.DesignName}
                                  />
                                  <span className={styles.selectedDesignName}>{selectedDesign.DesignName}</span>
                                </span>
                              )}
                              <DesignSelector
                                  designs={availableDesigns}
                                  selectedDesignKey={selectedDesign ? designKey(selectedDesign) : null}
                                  onSelect={handleSelectDesign}
                              />
                          </div>
                        )}

                        <TextInputsSection
                          selectedTemplate={selectedTemplate}
                          textLines={textLines}
                          setTextLines={setTextLines}
                        />

                        {hasTextLines && (
                          <div className={styles.labelInputDiv}>
                              <label className={styles.sectionLabel}>Font:</label>
                              <FontSelector
                                  fonts={availableFonts}
                                  selectedFont={font}
                                  onSelect={setFont}
                              />
                          </div>
                        )}

                        {hasTextLines && (
                          <div className={styles.labelInputDiv}>
                              <div className={styles.inlineLabel}>
                                  <label className={styles.sectionLabel}>Color:</label>
                                  <span className={styles.selectedColorName}>
                                      {getSelectedColorName(availableColors, color)}
                                  </span>
                              </div>
                              <ColorSelector
                                  colors={availableColors}
                                  selectedColor={color}
                                  onSelect={setColor}
                              />
                          </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// --- Embed / Auto-mount support for Page Builder ---------------------------
/**
 * Programmatically mount the widget into a specific DOM element.
 * @param {HTMLElement} el
 */
export function mountRbgDesigner(el) {
  if (!el) return;
  // Prevent double-mounts if this script is included more than once or re-run
  if (el.dataset.rbgMounted === '1') return;
  el.dataset.rbgMounted = '1';
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// If this script is loaded on a page that already contains the container,
// auto-mount so it "just works" in BigCommerce Page Builder.
if (typeof window !== 'undefined') {
  const container = document.getElementById('rbgDesigner');
  if (container) {
    try {
      mountRbgDesigner(container);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[RBG]', 'Failed to mount rbg-pulseid-widget:', e);
    }
  }
}

export default App;