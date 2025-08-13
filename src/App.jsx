import React, {useEffect, useState} from 'react';
import debounce from 'lodash.debounce';
import styles from './App.module.css';

/**
 * @typedef {Object} PulseFont
 * @property {number|string} Id
 * @property {string} FontName
 * @property {string} FontPreviewUrl
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
 * @typedef {Object} PulseTemplate
 * @property {number|string} Id
 * @property {string} Code
 * @property {string} Name
 * @property {number=} TextLines
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

const FONT_TYPE_FILTER = 'embroidery-template';
const RENDER_DEBOUNCE_MS = 500;

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
 * Returns an array of element names for the selected template, in correct order for text lines.
 * Falls back to ["Line1", ...] if not available.
 * @param {PulseTemplate} template
 * @param {number} count
 * @returns {string[]}
 */
function getElementNamesForTemplate(template, count) {
  const fallback = Array.from({ length: count }, (_, i) => `Line${i + 1}`);
  if (!template || !Array.isArray(template.TemplateElements)) return fallback;

  // Collect text-capable elements and attempt to order them by any numeric suffix in ElementName
  const els = template.TemplateElements
    .filter(el => el && typeof el.Text === 'string')
    .map(el => {
      const name = String(el.ElementName || '').trim();
      const order = parseInt(name.match(/line\s*(\d+)/i)?.[1] || '999', 10);
      return { name: name || '', order };
    })
    .filter(e => e.name);

  if (els.length === 0) return fallback;

  els.sort((a, b) => a.order - b.order);
  const ordered = els.map(e => e.name);

  // Pad or trim to the requested count
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

    // Sort text elements by any numeric suffix in ElementName: Line1, Line2, etc.
    textEls.sort((a, b) => {
        const ai = parseInt((a.ElementName || '').match(/line\s*(\d+)/i)?.[1] || '999', 10);
        const bi = parseInt((b.ElementName || '').match(/line\s*(\d+)/i)?.[1] || '999', 10);
        return ai - bi;
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
const PreviewImage = ({src, alt, className}) => (
    <img src={src} alt={alt} className={className}/>
);

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
                        src={f.FontPreviewUrl.replace('{api domain}', 'rockbottom.pulseidconnect.com')}
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
                        src={(t.ThumbnailUrl || '').replace('{api domain}', 'rockbottom.pulseidconnect.com')}
                        alt={t.Name}
                        className={styles.templatePreviewImage}
                    />
                </button>
            );
        })}
    </div>
);

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
    /** @type {[PulseFont[], Function]} */
    const [availableFonts, setAvailableFonts] = useState([]);
    /** @type {[PulseColour[], Function]} */
    const [availableColors, setAvailableColors] = useState([]);
    /** @type {[PulseTemplate[], Function]} */
    const [availableTemplates, setAvailableTemplates] = useState([]);
    /** @type {[PulseTemplate|null, Function]} */
    const [selectedTemplate, setSelectedTemplate] = useState(null);

    // In-memory (React state) store for thumbnails
    const [templateThumbByCode, setTemplateThumbByCode] = useState({});     // { [code]: url }

    // Helper to fetch/get a template thumbnail using React state as cache
    const getTemplateThumbnail = async (code) => {
      if (templateThumbByCode[code]) return templateThumbByCode[code];
      try {
        const tr = await fetch(`${apiBase}?endpoint=/api/Templates/GetThumbnail&id=${encodeURIComponent(code)}`);
        const thumb = await tr.text();
        const normalized = (thumb || '').replace('{api domain}', 'rockbottom.pulseidconnect.com');
        setTemplateThumbByCode(prev => ({ ...prev, [code]: normalized }));
        return normalized;
      } catch (e) {
        console.error('Thumbnail fetch failed for', code, e);
        return '';
      }
    };

    // --- State for template initialization ---
    const [templateInitPending, setTemplateInitPending] = useState(false);

    const [showFonts, setShowFonts] = useState(false);
    const [showColors, setShowColors] = useState(false);
    const [showTextInputs, setShowTextInputs] = useState(false);
    const [showTemplate, setShowTemplate] = useState(false);

    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    const toggleSection = (section) => {
        setShowTemplate(section === 'template' ? prev => !prev : false);
        setShowTextInputs(section === 'text' ? prev => !prev : false);
        setShowFonts(section === 'font' ? prev => !prev : false);
        setShowColors(section === 'color' ? prev => !prev : false);
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const vId = params.get('variantid');

        if (!vId) return;

        const fetchProduct = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/Designer/GetProduct&variantId=${vId}`);
                const text = await res.text();
                const data = JSON.parse(text);
                setProduct(data);
            } catch (err) {
                console.error('Failed to fetch product:', err);
            }
        };

        const fetchFonts = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/Fonts/GetFonts`);
                const data = await res.json();
                const filteredFonts = data.filter(f =>
                    typeof f.FontType === 'string' &&
                    f.FontType.split(',').map(type => type.trim()).includes(FONT_TYPE_FILTER)
                );
                setAvailableFonts(filteredFonts);
            } catch (err) {
                console.error('Failed to fetch fonts:', err);
            }
        };

        const fetchColors = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/Colours/GetColours`);
                const data = await res.json();
                setAvailableColors(data);
            } catch (err) {
                console.error('Failed to fetch colors:', err);
            }
        };

        const fetchTemplates = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/Templates/ListTemplates`);
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
                  setTemplateInitPending(true);
                  const count = getTemplateLineCount(first);
                  setTextLines((prev) => {
                    const next = [...(Array.isArray(prev) ? prev : [''])];
                    while (next.length < count) next.push('');
                    return next.slice(0, Math.min(MAX_TEXT_LINES, count));
                  });
                }
            } catch (err) {
                console.error('Failed to fetch templates:', err);
            }
        };

        void fetchProduct();
        void fetchFonts();
        void fetchColors();
        void fetchTemplates();
    }, []);

    const handleSelectTemplate = (tpl) => {
        setSelectedTemplate(tpl);
        setTemplateInitPending(true);
        const count = getTemplateLineCount(tpl);
        setTextLines((prev) => {
          const next = [...(Array.isArray(prev) ? prev : [''])];
          while (next.length < count) next.push('');
          return next.slice(0, Math.min(MAX_TEXT_LINES, count));
        });
    };
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
            const orderType = selectedTemplate.OrderType;

            const elementNames = getElementNamesForTemplate(selectedTemplate, textLines.length);
            const parts = [];
            textLines.forEach((txt, idx) => {
              if (typeof txt === 'string' && txt.trim().length > 0) {
                const elName = elementNames[idx] || `Line${idx + 1}`;
                parts.push(`&Personalizations[${idx}].ElementName=${encodeURIComponent(elName)}`);
                parts.push(`&Personalizations[${idx}].Text=${encodeURIComponent(txt)}`);
                parts.push(`&Personalizations[${idx}].IsText=true`);
                parts.push(`&Personalizations[${idx}].TextColour=${textColorCode}`);
                parts.push(`&Personalizations[${idx}].FontOverride=${encodeURIComponent(font)}`);
              }
            });

            const renderUrl = `${apiBase}?endpoint=/api/Orders/Render`
                + `&OrderType=${encodeURIComponent(orderType)}`
                + `&ProductCode=${productCode}`
                + `&TemplateCode=${encodeURIComponent(templateCode)}`
                + parts.join('')
                + `&Transparency=${transparency}`
                + `&RenderOnProduct=true`
                + `&Dpi=72`;

            setPreviewUrl(renderUrl);
        }, RENDER_DEBOUNCE_MS);

        debouncedRender();
        return () => debouncedRender.cancel();
    }, [textLines, font, color, product, availableColors, selectedTemplate]);

    return (
        <div className={isMobile ? styles.appContainer : styles.container}>
            {isMobile ? (
            // Mobile layout
                <>
                    <div className={styles.fullscreenPreview}>
                        <PreviewImage
                            src={previewUrl?.startsWith('data:image') ? previewUrl : (previewUrl || product?.ProductPreviewURL)}
                            alt="Bag Preview"
                            className={styles.fullscreenImage}
                        />
                    </div>

                    <div className={styles.floatingControls}>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('template')}
                        >
                            Template
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('text')}
                        >
                            Text
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('font')}
                        >
                            Font
                        </button>
                        <button
                            className={styles.drawerToggleButton}
                            onClick={() => toggleSection('color')}
                        >
                            Color
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

                    <div className={`${styles.drawer} ${showTextInputs ? styles.drawerVisible : styles.drawerHidden}`}>
                        <TextInputsSection
                          selectedTemplate={selectedTemplate}
                          textLines={textLines}
                          setTextLines={setTextLines}
                        />
                    </div>

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
                </>
            ) : (
            // Desktop layout
                <>
                    <div className={styles.imageContainer}>
                        <PreviewImage
                            src={previewUrl?.startsWith('data:image') ? previewUrl : (previewUrl || product?.ProductPreviewURL)}
                            alt="Bag Preview"
                            className={styles.image}
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

                        <TextInputsSection
                          selectedTemplate={selectedTemplate}
                          textLines={textLines}
                          setTextLines={setTextLines}
                        />

                        <div className={styles.labelInputDiv}>
                            <label className={styles.sectionLabel}>Font:</label>
                            <FontSelector
                                fonts={availableFonts}
                                selectedFont={font}
                                onSelect={setFont}
                            />
                        </div>

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
                    </div>
                </>
            )}
        </div>
    );
};

export default App;