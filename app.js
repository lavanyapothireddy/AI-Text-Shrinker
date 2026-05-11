/* ============================================
   AI TEXT SHRINKER — app.js
   All logic: word counting, prompt building,
   Anthropic API streaming, stats, UI updates.
   ============================================ */

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

let abortController  = null;   // allows cancelling in-flight requests

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

  // Mode-specific instructions
  const modeInstructions = {
    summarize: 'Summarize the following text, preserving the core meaning and most important points.',
    compress:  'Compress the following text, keeping the same structure and key details but removing redundancy and filler.',
    bullets:   'Convert the following text into concise, clear bullet points.',
    tldr:      'Write a TL;DR of 1–2 sentences maximum for the following text.',
    keywords:  'Extract only the most important key phrases and concepts from the following text as a comma-separated list.',
    formal:    'Rewrite the following text in a formal, professional tone but much shorter.',
    casual:    'Rewrite the following text in a casual, friendly tone but much shorter.',
  };

  // Length instruction
  let lengthInstruction = '';
  if (length === 'shortest')    lengthInstruction = 'Make it as short as possible.';
  else if (length === 'custom') lengthInstruction = `Target approximately ${wordSlider.value} words.`;
  else                          lengthInstruction = `Target approximately ${length}% of the original length.`;

  // Tone instruction (skip for rewrite modes that already set tone)
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

  // Guard: need input text
  if (!text) {
    outputEl.innerHTML = '<span class="output-placeholder" style="color:var(--danger)">Please enter some text first.</span>';
    return;
  }

  // Cancel any previous request
  if (abortController) abortController.abort();
  abortController = new AbortController();

  // UI: loading state
  shrinkBtn.disabled    = true;
  shrinkBtn.innerHTML   = '<span class="spinner"></span> Shrinking…';
  outputEl.textContent  = '';
  outputCountEl.textContent = '…';
  statsRow.style.display = 'none';
  barWrap.style.display  = 'none';

  let fullOutput = '';

  try {
    // ── Call Anthropic API (streaming) ──────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // NOTE: In production, proxy this through your own backend.
        // Never expose API keys in frontend code.
        // If using Claude.ai artifacts, the key is injected automatically.
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        stream:     true,
        messages:   [{ role: 'user', content: buildPrompt() }]
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    // ── Stream SSE chunks ────────────────────
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
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullOutput += parsed.delta.text;
            outputEl.textContent = fullOutput;

            // Live word count in panel header
            const w = countWords(fullOutput);
            outputCountEl.textContent = w + ' word' + (w !== 1 ? 's' : '');
          }
        } catch (_) {
          // Silently skip malformed SSE lines
        }
      }
    }

    // ── Show stats after stream completes ───
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

  // Compression bar
  const barPct = Math.min(100, Math.max(0, pct));
  document.getElementById('barPct').textContent      = barPct + '%';
  document.getElementById('barFill').style.width     = barPct + '%';
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
    // Fallback for older browsers
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
