import React, { useEffect, useState } from 'react';

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
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2rem', padding: '1rem', fontFamily: 'Arial' }}>
      {/* Left: Image */}
      <div style={{ flex: '1 1 50%' }}>
        <img
          src={product?.ProductPreviewURL}
          alt="Bag Preview"
          style={{ width: '100%', maxWidth: '400px' }}
        />
      </div>

      {/* Right: Controls */}
      <div style={{ flex: '1 1 50%' }}>
        <h2>Customize Your Product</h2>

        <div style={{ marginBottom: '1rem' }}>
          <label>Line 1: </label>
          <input value={textLine1} onChange={(e) => setTextLine1(e.target.value)} />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Line 2: </label>
          <input value={textLine2} onChange={(e) => setTextLine2(e.target.value)} />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Font: </label>
            <select value={font} onChange={(e) => setFont(e.target.value)}>
                {availableFonts.map((f) => (
                    <option key={f.Id} value={f.FontName}>{f.FontName}</option>
                ))}
            </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Color: </label>
         <strong>{availableColors.find(c => `rgb(${c.Red}, ${c.Green}, ${c.Blue})` === color)?.Name.split(' - ')[1] || ''}</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
            {availableColors.map((c) => {
              const rgb = `rgb(${c.Red}, ${c.Green}, ${c.Blue})`;
              const isSelected = color === rgb;
              return (
                <button
                  key={c.Id}
                  onClick={() => setColor(rgb)}
                  title={c.Name}
                  style={{
                    backgroundColor: rgb,
                    border: isSelected ? '2px solid black' : '1px solid #ccc',
                    width: '40px',
                    height: '40px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
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
