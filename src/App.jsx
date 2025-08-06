import React, { useEffect, useState } from 'react';
import styles from './App.module.css';

const apiBase = '/api/pulseid-proxy'; // Netlify proxy path

const App = () => {
  const [product, setProduct] = useState(null);
  const [templateOptions, setTemplateOptions] = useState([]);
  const [textLine1, setTextLine1] = useState('');
  const [textLine2, setTextLine2] = useState('');
  const [font, setFont] = useState('Block');
  const [color, setColor] = useState('rgb(153, 0, 0)'); // instead of hex
  const [variantId, setVariantId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [availableFonts, setAvailableFonts] = useState([]);
  const [availableColors, setAvailableColors] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vId = params.get('variantid');
    setVariantId(vId);

    if (!vId) return;

    const fetchProduct = async () => {
      try {
        const res = await fetch(`${apiBase}?endpoint=/api/Designer/GetProduct&variantId=${vId}`, {
          cache: 'no-store'
        });
        const text = await res.text();
        console.log('Raw response:', text);
        const data = JSON.parse(text);
        setProduct(data);
      } catch (err) {
        console.error('Failed to fetch product:', err);
      }
    };

    const fetchFonts = async () => {
      try {
        const res = await fetch(`${apiBase}?endpoint=/api/Fonts/Get`, { cache: 'no-store' });
        const data = await res.json();
        setAvailableFonts(data);
      } catch (err) {
        console.error('Failed to fetch fonts:', err);
      }
    };

    const fetchColors = async () => {
      try {
        const res = await fetch(`${apiBase}?endpoint=/api/Colours/GetColours`, { cache: 'no-store' });
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

  return (
    <div className={styles.container}>
      {/* Left: Image */}
      <div className={styles.imageContainer}>
        <img
          src={product?.ProductPreviewURL}
          alt="Bag Preview"
          className={styles.image}
        />
      </div>

      {/* Right: Controls */}
      <div className={styles.controlContainer}>
        <h2>Customize Your Product</h2>

        <div className={styles.labelInputDiv}>
          <label>Line 1: </label>
          <input value={textLine1} onChange={(e) => setTextLine1(e.target.value)} />
        </div>

        <div className={styles.labelInputDiv}>
          <label>Line 2: </label>
          <input value={textLine2} onChange={(e) => setTextLine2(e.target.value)} />
        </div>

        <div className={styles.labelInputDiv}>
          <label className={styles.fontLabel}>Font:</label>
          <div className={styles.fontButtonRow}>
            {availableFonts.map((f) => {
              const isSelected = font === f.FontName;
              return (
                <button
                  key={f.Id}
                  onClick={() => setFont(f.FontName)}
                  style={{ fontFamily: f.FontName }}
                  className={isSelected ? styles.fontButtonSelected : styles.fontButton}
                >
                  {f.FontName}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.labelInputDiv}>
          <label className={styles.colorLabel}>Color: </label>
          <span>{availableColors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === color)?.Name.split(' - ')[1] || ''}</span>
          <div className={styles.colorButtonRow}>
            {availableColors.map((c) => {
              const rgb = `rgb(${c.Red}, ${c.Green}, ${c.Blue})`;
              const isSelected = color === rgb;
              return (
                <button
                  key={c.Id}
                  onClick={() => setColor(rgb)}
                  title={c.Name}
                  style={{ backgroundColor: rgb }}
                  className={isSelected ? styles.colorButtonSelected : styles.colorButton}
                >
                </button>
              );
            })}
          </div>
        </div>

        <hr />

        <div>
          <h3>Available Templates</h3>
          <ul>
            {Array.isArray(templateOptions.Templates) && templateOptions.Templates.length > 0 ? (
              templateOptions.Templates.map((t) => (
                <li key={t.id}>{t.name}</li>
              ))
            ) : (
              <li>No templates found.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default App;
