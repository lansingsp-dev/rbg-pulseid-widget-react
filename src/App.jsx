import React, { useEffect, useState } from 'react';

const apiBase = '/api/pulseid-proxy'; // Netlify proxy path

const App = () => {
  const [templateOptions, setTemplateOptions] = useState([]);
  const [textLine1, setTextLine1] = useState('');
  const [textLine2, setTextLine2] = useState('');
  const [font, setFont] = useState('Block');
  const [color, setColor] = useState('#990000');
  const [variantId, setVariantId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vId = params.get('variantid');
    setVariantId(vId);

    if (vId) {
        fetch(`${apiBase}?endpoint=/api/Designer/GetProduct&variantId=${vId}`, {
            cache: 'no-store'
        })
            .then(async (res) => {
                const text = await res.text();
                console.log('Raw response:', text); // See what HTML you're actually getting
                try {
                    const data = JSON.parse(text);
                    setTemplateOptions(data);
                } catch (err) {
                    console.error('Failed to parse JSON:', err);
                }
            })
            .catch((err) => {
                console.error('Fetch failed:', err);
            });
  }
  }, []);

  const handlePreview = async () => {
    if (!variantId) return;

    const payload = {
      variantId,
      textLine1,
      textLine2,
      font,
      color
    };

    const res = await fetch(`${apiBase}?endpoint=Designer/GeneratePreview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result?.previewUrl) {
      setPreviewUrl(result.previewUrl);
    }
  };

  return (
    <div style={{ padding: '1rem', fontFamily: 'Arial' }}>
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
          <option value="Block">Block</option>
          <option value="Script">Script</option>
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label>Color: </label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>

      <button onClick={handlePreview}>Preview</button>

      {previewUrl && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Preview</h3>
          <img src={previewUrl} alt="Preview" style={{ maxWidth: '100%' }} />
        </div>
      )}

      <hr />

      <div>
        <h3>Available Templates</h3>
        <ul>
          {templateOptions.map((t) => (
            <li key={t.id}>{t.name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;
