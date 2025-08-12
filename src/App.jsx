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

const apiBase = '/api/pulseid-proxy'; // Netlify proxy path

const TEMPLATE_CODE = 'Template Emb Test';
const RENDER_DEBOUNCE_MS = 500;

function getSelectedColorName(colors, rgb) {
    return colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb)?.Name.split(' - ')[1] || '';
}

function getColorCode(rgb, colors) {
    const match = colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb);
    return match?.Name || '';
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
            const isSelected = selectedColor === rgb;
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

const App = () => {
    /** @type {[PulseProduct|null, Function]} */
    const [product, setProduct] = useState(null);
    const [textLine1, setTextLine1] = useState('My Custom Text');
    const [font, setFont] = useState('Block');
    const [color, setColor] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    /** @type {[PulseFont[], Function]} */
    const [availableFonts, setAvailableFonts] = useState([]);
    /** @type {[PulseColour[], Function]} */
    const [availableColors, setAvailableColors] = useState([]);

    const [showFonts, setShowFonts] = useState(false);
    const [showColors, setShowColors] = useState(false);
    const [showTextInputs, setShowTextInputs] = useState(false);

    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    const toggleSection = (section) => {
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
                const res = await fetch(`${apiBase}?endpoint=/api/Fonts/GetFonts&dataView=1&getAllowedChars=true`);
                const data = await res.json();
                setAvailableFonts(data);
            } catch (err) {
                console.error('Failed to fetch fonts:', err);
            }
        };

        const fetchColors = async () => {
            try {
                const res = await fetch(`${apiBase}?endpoint=/api/Colours/GetColours`);
                const data = await res.json();
                setAvailableColors(data);
                const whiteColor = data.find(c => c.Code === "1801");
                if (whiteColor) {
                    const rgb = `rgb(${whiteColor.Red}, ${whiteColor.Green}, ${whiteColor.Blue})`;
                    setColor(rgb);
                }
            } catch (err) {
                console.error('Failed to fetch colors:', err);
            }
        };

        void fetchProduct();
        void fetchFonts();
        void fetchColors();
    }, []);

    useEffect(() => {
        if (!textLine1 || !product || !color) return;

        const debouncedRender = debounce(() => {
            const productCode = product?.Code;
            const transparency = "%2300FFFFFF";
            const textColorCode = getColorCode(color, availableColors);

            const renderUrl = `${apiBase}?endpoint=/api/Orders/Render`
                + `&OrderType=embroidery-template`
                + `&ProductCode=${productCode}`
                + `&TemplateCode=${TEMPLATE_CODE}`
                + `&Personalizations[0].ElementName=Line1`
                + `&Personalizations[0].Text=${encodeURIComponent(textLine1)}`
                + `&Personalizations[0].IsText=true`
                + `&Personalizations[0].TextColour=${textColorCode}`
                + `&Personalizations[0].FontName=${encodeURIComponent(font)}`
                + `&Transparency=${transparency}`
                + `&RenderOnProduct=true`
                + `&Dpi=72`;

            setPreviewUrl(renderUrl);
        }, RENDER_DEBOUNCE_MS); // delay in ms

        debouncedRender();
        return () => debouncedRender.cancel();
    }, [textLine1, font, color, product, availableColors]);

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
                            className={styles.toggleButton}
                            onClick={() => toggleSection('text')}
                        >
                            Text
                        </button>
                        <button
                            className={styles.toggleButton}
                            onClick={() => toggleSection('font')}
                        >
                            Font
                        </button>
                        <button
                            className={styles.toggleButton}
                            onClick={() => toggleSection('color')}
                        >
                            Color
                        </button>
                    </div>

                    <div className={`${styles.drawer} ${showTextInputs ? styles.drawerVisible : styles.drawerHidden}`}>
                        <div className={styles.labelInputDiv}>
                            <label className={styles.sectionLabel}>Text:</label>
                            <TextInput value={textLine1} onChange={e => setTextLine1(e.target.value)} />
                        </div>
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
                            <label className={styles.sectionLabel}>Text:</label>
                            <TextInput value={textLine1} onChange={e => setTextLine1(e.target.value)} />
                        </div>

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