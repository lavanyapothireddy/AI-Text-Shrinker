/* ============================================
   AI TEXT SHRINKER — app.js
   Powered by Groq API (llama-3.3-70b-versatile)
   ============================================ */

// ── YOUR GROQ API KEY ──────────────────────
// Get your free key at: https://console.groq.com/keys
// WARNING: For production, move this to a backend proxy.
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY_HERE';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
// Other Groq models you can swap in:
// 'llama-3.1-8b-instant'   — ultra fast, lower cost
// 'mixtral-8x7b-32768'     — large 32k context window
// 'gemma2-9b-it'           — Google Gemma 2

// ── DOM References ─────────────────────────
const inputEl        = document.getElementById('inputText');
const outputEl       = document.getElementById('outputArea');
const inputCountEl   = document.getElementById('inputCount');
const outputCountEl  = document.getElementById('outputCount');
const shrinkBtn      = document.getElementById('shrinkBtn');
const lengthSelect   = document.getElementById('lengthSelect');
const customGroup    = document.getElementById('customWrapGroup');
const toneGroup      = document.getElementById('toneGroup');
const wordSlider     = document.getElementById('wordSlider');
const sliderVal      = document.getElementById('sliderVal');
const statsRow       = document.getElementById('statsRow');
const barWrap        = document.getElementById('barWrap');

let abortController  = null;

// ── Utility ────────────────────────────────
function countWords(text) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

// ── Live Word Count (input) ─────────────────
inputEl.addEventListener('input', () => {
  const w = countWords(inputEl.value);
  inputCountEl.textContent = w + ' word' + (w !== 1 ? 's' : '');
});

// ── Slider sync ────────────────────────────
wordSlider.addEventListener('input', () => {
  sliderVal.textContent = wordSlider.value;
});

// ── Length select: show/hide custom slider ──
lengthSelect.addEventListener('change', () => {
  const isCustom = lengthSelect.value === 'custom';
  customGroup.style.display = isCustom ? 'block' : 'none';
  toneGroup.style.display   = isCustom ? 'none'  : 'block';
});

// ── Preset tag click: load sample text ─────
document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    inputEl.value = tag.dataset.text;
    inputEl.dispatchEvent(new Event('input'));
  });
});

// ── Build the AI prompt ─────────────────────
function buildPrompt() {
  const text   = inputEl.value.trim();
  const mode   = document.getElementById('modeSelect').value;
  const tone   = document.getElementById('toneSelect').value;
  const length = lengthSelect.value;

  const modeInstructions = {
    summarize: 'Summarize the following text, preserving the core meaning and most important points.',
    compress:  'Compress the following text, keeping the same structure and key details but removing redundancy and filler.',
    bullets:   'Convert the following text into concise, clear bullet points.',
    tldr:      'Write a TL;DR of 1–2 sentences maximum for the following text.',
    keywords:  'Extract only the most important key phrases and concepts from the following text as a comma-separated list.',
    formal:    'Rewrite the following text in a formal, professional tone but much shorter.',
    casual:    'Rewrite the following text in a casual, friendly tone but much shorter.',
  };

  let lengthInstruction = '';
  if (length === 'shortest')    lengthInstruction = 'Make it as short as possible.';
  else if (length === 'custom') lengthInstruction = `Target approximately ${wordSlider.value} words.`;
  else                          lengthInstruction = `Target approximately ${length}% of the original length.`;

  const toneInstruction = (mode !== 'formal' && mode !== 'casual' && tone !== 'neutral')
    ? `Write in a ${tone} tone.`
    : '';

  return (
    `${modeInstructions[mode]} ${lengthInstruction} ${toneInstruction}\n\n` +
    `Output ONLY the result — no preamble, no explanation, no labels.\n\n` +
    `Text:\n${text}`
  );
}

// ── Main shrink function (streaming) ────────
async function shrinkText() {
  const text = inputEl.value.trim();

  if (!text) {
    outputEl.innerHTML = '<span class="output-placeholder" style="color:var(--danger)">Please enter some text first.</span>';
    return;
  }

  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    outputEl.innerHTML = '<span style="color:var(--danger)"><i class="ti ti-key"></i> Please open app.js and set your GROQ_API_KEY. Get one free at console.groq.com/keys</span>';
    return;
  }

  if (abortController) abortController.abort();
  abortController = new AbortController();

  shrinkBtn.disabled    = true;
  shrinkBtn.innerHTML   = '<span class="spinner"></span> Shrinking…';
  outputEl.textContent  = '';
  outputCountEl.textContent = '…';
  statsRow.style.display = 'none';
  barWrap.style.display  = 'none';

  let fullOutput = '';

  try {
    // ── Groq API — OpenAI-compatible endpoint ──
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        max_tokens:  1024,
        stream:      true,
        temperature: 0.4,   // lower = more focused/consistent output
        messages: [
          {
            role:    'system',
            content: 'You are a precise text compression assistant. Always output ONLY the result — never add preamble, labels, or explanations. Follow the user instructions exactly.'
          },
          {
            role:    'user',
            content: buildPrompt()
          }
        ]
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    // ── Stream SSE chunks (OpenAI-compatible format) ──
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          const delta  = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            fullOutput += delta;
            outputEl.textContent = fullOutput;
            const w = countWords(fullOutput);
            outputCountEl.textContent = w + ' word' + (w !== 1 ? 's' : '');
          }
        } catch (_) {
          // Skip malformed SSE lines
        }
      }
    }

    if (fullOutput) showStats(text, fullOutput);

  } catch (err) {
    if (err.name !== 'AbortError') {
      outputEl.innerHTML =
        `<span style="color:var(--danger)"><i class="ti ti-alert-triangle"></i> Error: ${err.message}</span>`;
    }
  } finally {
    shrinkBtn.disabled  = false;
    shrinkBtn.innerHTML = '<i class="ti ti-wand"></i> Shrink It';
    abortController     = null;
  }
}

// ── Stats panel update ──────────────────────
function showStats(original, output) {
  const wIn  = countWords(original);
  const wOut = countWords(output);
  const pct  = wIn > 0 ? Math.round((1 - wOut / wIn) * 100) : 0;
  const charsSaved = Math.max(0, original.length - output.length);

  document.getElementById('statIn').textContent    = wIn;
  document.getElementById('statOut').textContent   = wOut;
  document.getElementById('statPct').textContent   = pct + '%';
  document.getElementById('statChars').textContent = charsSaved;
  statsRow.style.display = 'grid';

  const barPct = Math.min(100, Math.max(0, pct));
  document.getElementById('barPct').textContent  = barPct + '%';
  document.getElementById('barFill').style.width = barPct + '%';
  barWrap.style.display = 'block';
}

// ── Copy output to clipboard ────────────────
function copyOutput() {
  const text = outputEl.textContent;
  if (!text || text.includes('Your shrunken text')) return;

  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ── Clear everything ────────────────────────
function clearAll() {
  inputEl.value             = '';
  outputEl.innerHTML        = '<span class="output-placeholder">Your shrunken text will appear here…</span>';
  inputCountEl.textContent  = '0 words';
  outputCountEl.textContent = '—';
  statsRow.style.display    = 'none';
  barWrap.style.display     = 'none';
}

// ── Keyboard shortcut: Ctrl/Cmd + Enter ─────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') shrinkText();
});
