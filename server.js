// =============================================
//  AI Text Shrinker — server.js
//  Express backend proxy for Groq API.
//  Keeps your API key secret on the server.
// =============================================

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Serve your frontend files statically ──
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ── Proxy route: /api/shrink ───────────────
// Frontend posts here → we add the API key
// and forward to Groq → stream response back.
app.post('/api/shrink', async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'GROQ_API_KEY environment variable is not set on the server.' }
    });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    // Forward Groq's status code and headers
    res.status(groqRes.status);
    res.setHeader('Content-Type', groqRes.headers.get('content-type') || 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the response back to the browser
    groqRes.body.pipe(res);

  } catch (err) {
    console.error('Groq proxy error:', err);
    res.status(502).json({ error: { message: 'Failed to reach Groq API: ' + err.message } });
  }
});

// ── Fallback: serve index.html for any route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Text Shrinker running on http://localhost:${PORT}`);
});
