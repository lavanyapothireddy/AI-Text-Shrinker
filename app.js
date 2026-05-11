/* =============================================
   AI TEXT SHRINKER — app.js
   Frontend logic. API calls go to /api/shrink
   (our own Express server), which securely
   forwards them to Groq with the secret key.
   ============================================= */

// ── DOM References ──────────────────────────
const inputEl       = document.getElementById('inputText');
const outputEl      = document.getElementById('outputArea');
const inputCountEl  = document.getElementById('inputCount');
const outputCountEl = document.getElementById('outputCount');
const shrinkBtn     = document.getElementById('shrinkBtn');
const lengthSelect  = document.getElementById('lengthSelect');
const customGroup   = document.getElementById('customWrapGroup');
const toneGroup     = document.getElementById('toneGroup');
const wordSlider    = document.getElementById('wordSlider');
const sliderVal     = document.getElementById('sliderVal');
const statsRow      = document.getElementById('statsRow');
const barWrap       = document.getElementById('barWrap');

let abortController = null;

// ── Utility ─────────────────────────────────
function countWords(text) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

// ── Live word count ──────────────────────────
inputEl.addEventListener('input', () => {
  const w = countWords(inputEl.value);
  inputCountEl.textContent = w + ' word' + (w !== 1 ? 's' : '');
});

// ── Slider sync ──────────────────────────────
wordSlider.addEventListener('input', () => {
  sliderVal.textContent = wordSlider.value;
});

// ── Toggle custom word count slider ─────────
lengthSelect.addEventListener('change', () => {
  const isCustom = lengthSelect.value === 'custom';
  customGroup.style.display = isCustom ? 'block' : 'none';
  toneGroup.style.display   = isCustom ? 'none'  : 'block';
});

// ── Sample preset tags ───────────────────────
document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    inputEl.value = tag.dataset.text;
    inputEl.dispatchEvent(new Event('input'));
  });
});

// ── Show / hide API key (if key bar present) ─
function toggleKeyVisibility() {
  const input   = document.getElementById('groqApiKey');
  const eyeIcon = document.getElementById('eyeIcon');
  if (!input) return;
  if (input.type === 'password') {
    input.type       = 'text';
    eyeIcon.className = 'ti ti-eye-off';
  } else {
    input.type       = 'password';
    eyeIcon.className = 'ti ti-eye';
  }
}

// ── Build the AI prompt ──────────────────────
function buildPrompt() {
  const text   = inputEl.value.trim();
  const mode   = document.getElementById('modeSelect').value;
  const tone   = document.getElementById('toneSelect').value;
  const length = lengthSelect.value;

  const modeInstructions = {
    summarize: 'Summarize the following text, preserving the core meaning and most important points.',
    compress:  'Compress the following text, keeping the same structure and key details but removing all redundancy and filler.',
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

// ── Main shrink function (streaming) ─────────
async function shrinkText() {
  const text  = inputEl.value.trim();
  const model = document.getElementById('modelSelect')?.value || 'llama-3.3-70b-versatile';

  if (!text) {
    outputEl.innerHTML = '<span class="output-placeholder" style="color:var(--danger)">Please enter some text first.</span>';
    return;
  }

  // Cancel any in-flight request
  if (abortController) abortController.abort();
  abortController = new AbortController();

  // Loading state
  shrinkBtn.disabled        = true;
  shrinkBtn.innerHTML       = '<span class="spinner"></span> Shrinking…';
  outputEl.textContent      = '';
  outputCountEl.textContent = '…';
  statsRow.style.display    = 'none';
  barWrap.style.display     = 'none';

  let fullOutput = '';

  try {
    // ── POST to our own backend proxy (/api/shrink)
    // The server adds the Groq API key and forwards to Groq.
    const response = await fetch('/api/shrink', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens:  1024,
        stream:      true,
        temperature: 0.4,
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

    // ── Parse the SSE stream ─────────────────
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
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
        } catch (_) { /* skip malformed lines */ }
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

// ── Stats display ─────────────────────────────
function showStats(original, output) {
  const wIn       = countWords(original);
  const wOut      = countWords(output);
  const pct       = wIn > 0 ? Math.round((1 - wOut / wIn) * 100) : 0;
  const charsSaved = Math.max(0, original.length - output.length);

  document.getElementById('statIn').textContent    = wIn;
  document.getElementById('statOut').textContent   = wOut;
  document.getElementById('statPct').textContent   = pct + '%';
  document.getElementById('statChars').textContent = charsSaved;
  statsRow.style.display = 'grid';

  const barPct = Math.min(100, Math.max(0, pct));
  document.getElementById('barPct').textContent    = barPct + '%';
  document.getElementById('barFill').style.width   = barPct + '%';
  barWrap.style.display = 'block';
}

// ── Copy output ───────────────────────────────
function copyOutput() {
  const text = outputEl.textContent;
  if (!text || text.includes('Your shrunken text')) return;

  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }).catch(() => {
    // Older browser fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ── Clear everything ──────────────────────────
function clearAll() {
  inputEl.value             = '';
  outputEl.innerHTML        = '<span class="output-placeholder">Your shrunken text will appear here…</span>';
  inputCountEl.textContent  = '0 words';
  outputCountEl.textContent = '—';
  statsRow.style.display    = 'none';
  barWrap.style.display     = 'none';
}

// ── Keyboard shortcut: Ctrl/Cmd + Enter ──────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') shrinkText();
});
