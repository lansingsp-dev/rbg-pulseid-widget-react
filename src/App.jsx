import React, {useEffect, useState} from 'react';
import debounce from 'lodash.debounce';
import styles from './App.module.css';

const apiBase = '/api/pulseid-proxy'; // Netlify proxy path

function rgbToArgbHex(rgb) {
    const result = rgb.match(/\d+/g);
    if (!result) return '#00FFFFFF'; // fallback white
    const [r, g, b] = result.map(n => parseInt(n).toString(16).padStart(2, '0'));
    return `#00${r}${g}${b}`.toUpperCase(); // alpha = 00 (fully transparent)
}

function getColorCode(rgb, colors) {
    const match = colors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === rgb);
    return match?.Name || '';
}

// Preview image component
const PreviewImage = ({src, alt, className}) => (
    <img src={src} alt={alt} className={className}/>
);

// Font selector component
const FontSelector = ({fonts, selectedFont, onSelect, styles}) => (
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

// Color selector component
const ColorSelector = ({colors, selectedColor, onSelect, styles}) => (
    <div className={styles.colorButtonRow}>
        {colors.map((c) => {
            const rgb = `rgb(${c.Red}, ${c.Green}, ${c.Blue})`;
            const isSelected = selectedColor === rgb;
            return (
                <button
                    key={c.Id}
                    onClick={() => onSelect(rgb)}
                    title={c.Name}
                    style={{backgroundColor: rgb}}
                    className={isSelected ? styles.colorButtonSelected : styles.colorButton}
                />
            );
        })}
    </div>
);

// Text input component
const TextInput = ({value, onChange, styles}) => (
    <div className={styles.labelInputDiv}>
        <label>Text:</label>
        <input value={value} onChange={onChange}/>
    </div>
);

const App = () => {
    const [product, setProduct] = useState(null);
    const [templateOptions, setTemplateOptions] = useState([]);
    const [textLine1, setTextLine1] = useState('My Custom Text');
    const [font, setFont] = useState('Block');
    const [color, setColor] = useState(null);
    const [variantId, setVariantId] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [availableFonts, setAvailableFonts] = useState([]);
    const [availableColors, setAvailableColors] = useState([]);

    const [showFonts, setShowFonts] = useState(false);
    const [showColors, setShowColors] = useState(false);
    const [showTextInputs, setShowTextInputs] = useState(false);

    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const vId = params.get('variantid');
        setVariantId(vId);

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

        fetchProduct();
        fetchFonts();
        fetchColors();
    }, []);

    useEffect(() => {
        if (!textLine1 || !product || !color) return;

        const debouncedRender = debounce(() => {
            const templateCode = 'Template Emb Test';
            const productCode = product?.Code;
            const transparency = "%2300FFFFFF";
            const textColorCode = getColorCode(color, availableColors);

            const renderUrl = `${apiBase}?endpoint=/api/Orders/Render`
                + `&OrderType=embroidery-template`
                + `&ProductCode=${productCode}`
                + `&TemplateCode=${templateCode}`
                + `&Personalizations[0].ElementName=Line1`
                + `&Personalizations[0].Text=${encodeURIComponent(textLine1)}`
                + `&Personalizations[0].IsText=true`
                + `&Personalizations[0].TextColour=${textColorCode}`
                + `&Personalizations[0].FontName=${encodeURIComponent(font)}`
                + `&Transparency=${transparency}`
                + `&RenderOnProduct=true`
                + `&Dpi=72`;

            setPreviewUrl(renderUrl);
        }, 500); // delay in ms

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
                            onClick={() => {
                                setShowFonts(prev => !prev);
                                setShowColors(false);
                                setShowTextInputs(false);
                            }}
                        >
                            Fonts
                        </button>
                        <button
                            className={styles.toggleButton}
                            onClick={() => {
                                setShowColors(prev => !prev);
                                setShowFonts(false);
                                setShowTextInputs(false);
                            }}
                        >
                            Colors
                        </button>
                        <button
                            className={styles.toggleButton}
                            onClick={() => {
                                setShowTextInputs(prev => !prev);
                                setShowFonts(false);
                                setShowColors(false);
                            }}
                        >
                            Add Text
                        </button>
                    </div>

                    <div className={`${styles.drawer} ${showTextInputs ? styles.drawerVisible : styles.drawerHidden}`}>
                        <h3>Enter Text</h3>
                        <TextInput value={textLine1} onChange={e => setTextLine1(e.target.value)} styles={styles}/>
                    </div>

                    <div className={`${styles.drawer} ${showFonts ? styles.drawerVisible : styles.drawerHidden}`}>
                        <h3>Select Font</h3>
                        <FontSelector
                            fonts={availableFonts}
                            selectedFont={font}
                            onSelect={setFont}
                            styles={styles}
                        />
                    </div>

                    <div className={`${styles.drawer} ${showColors ? styles.drawerVisible : styles.drawerHidden}`}>
                        <div>
                            <strong>Select Color:</strong>{" "}
                            {availableColors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === color)?.Name.split(' - ')[1] || ''}
                        </div>
                        <ColorSelector
                            colors={availableColors}
                            selectedColor={color}
                            onSelect={setColor}
                            styles={styles}
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
                        <h2>Customize Your Product</h2>
                        <TextInput value={textLine1} onChange={e => setTextLine1(e.target.value)} styles={styles}/>

                        <div className={styles.labelInputDiv}>
                            <label className={styles.fontLabel}>Font:</label>
                            <FontSelector
                                fonts={availableFonts}
                                selectedFont={font}
                                onSelect={setFont}
                                styles={styles}
                            />
                        </div>

                        <div className={styles.labelInputDiv}>
                            <div className={styles.inlineLabel}>
                                <label className={styles.colorLabel}>Color:</label>
                                <span className={styles.selectedColorName}>
                  {availableColors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === color)?.Name.split(' - ')[1] || ''}
                </span>
                            </div>
                            <ColorSelector
                                colors={availableColors}
                                selectedColor={color}
                                onSelect={setColor}
                                styles={styles}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default App;