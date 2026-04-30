const WORKER_BASE = 'https://haowei614-decap-oauth.haowei614.workers.dev';
const TOKEN_KEY = 'hc-smart-update-github-token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  kind: '',
  item: null,
  files: []
};

const els = {
  authState: document.getElementById('authState'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  kindSelect: document.getElementById('kindSelect'),
  sourceText: document.getElementById('sourceText'),
  fileInput: document.getElementById('fileInput'),
  fileList: document.getElementById('fileList'),
  parseBtn: document.getElementById('parseBtn'),
  samplePubBtn: document.getElementById('samplePubBtn'),
  sampleNewsBtn: document.getElementById('sampleNewsBtn'),
  previewPanel: document.getElementById('previewPanel'),
  previewKind: document.getElementById('previewKind'),
  previewForm: document.getElementById('previewForm'),
  publishBtn: document.getElementById('publishBtn'),
  copyJsonBtn: document.getElementById('copyJsonBtn'),
  resultPanel: document.getElementById('resultPanel'),
  resultBox: document.getElementById('resultBox')
};

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = busy ? label : button.dataset.label;
}

function setResult(value, isError) {
  els.resultPanel.classList.remove('hidden');
  els.resultBox.classList.toggle('error', Boolean(isError));
  els.resultBox.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function updateAuthUi() {
  if (state.token) {
    els.authState.textContent = 'Signed in with GitHub';
    els.loginBtn.classList.add('hidden');
    els.logoutBtn.classList.remove('hidden');
  } else {
    els.authState.textContent = 'Not signed in';
    els.loginBtn.classList.remove('hidden');
    els.logoutBtn.classList.add('hidden');
  }
}

function loginWithGitHub() {
  const width = 980;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  window.open(
    `${WORKER_BASE}/auth?provider=github`,
    'githubAuth',
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

function handleAuthMessage(event) {
  const data = event.data;
  if (data === 'authorizing:github') {
    event.source.postMessage('authorizing:github', event.origin);
    return;
  }
  if (typeof data !== 'string' || !data.startsWith('authorization:github:success:')) return;

  const payload = JSON.parse(data.replace('authorization:github:success:', ''));
  state.token = payload.token;
  localStorage.setItem(TOKEN_KEY, state.token);
  updateAuthUi();
}

function renderFiles() {
  if (!state.files.length) {
    els.fileList.innerHTML = '<p class="hint">No attachments selected.</p>';
    return;
  }
  els.fileList.innerHTML = state.files.map((file) => (
    `<div title="${escapeHtml(file.name)}">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB</div>`
  )).join('');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const res = await fetch(`${WORKER_BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${state.token}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { error: text || res.statusText };
  }
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}

function toDateInput(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeParsed(kind, item) {
  if (kind === 'publication') {
    return {
      id: item.id || '',
      title: item.title || '',
      authors: item.authors || '',
      venue: item.venue || '',
      year: Number(item.year || new Date().getFullYear()),
      date: toDateInput(item.date),
      tags: Array.isArray(item.tags) ? item.tags : [],
      abstract: item.abstract || '',
      pdf: item.pdf || '',
      poster: item.poster || '',
      code: item.code || '',
      project: item.project || '',
      doi: item.doi || '',
      externalUrl: item.externalUrl || '',
      featured: Boolean(item.featured),
      status: item.status || 'published'
    };
  }

  return {
    id: item.id || '',
    title: item.title || '',
    date: toDateInput(item.date),
    summary: item.summary || '',
    content: item.content || '',
    links: Array.isArray(item.links) ? item.links : [],
    images: Array.isArray(item.images) ? item.images : [],
    category: item.category || 'event',
    pinned: Boolean(item.pinned),
    status: item.status || 'published'
  };
}

function fieldHtml(name, label, value, options = {}) {
  const wide = options.wide ? ' field-wide' : '';
  if (options.type === 'textarea') {
    return `<div class="field${wide}"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" rows="${options.rows || 4}">${escapeHtml(value)}</textarea></div>`;
  }
  if (options.type === 'checkbox') {
    return `<div class="field"><label class="field-row"><input id="${name}" name="${name}" type="checkbox" ${value ? 'checked' : ''}> ${label}</label></div>`;
  }
  if (options.type === 'select') {
    const choices = options.choices || [];
    return `<div class="field${wide}"><label for="${name}">${label}</label><select id="${name}" name="${name}">${choices.map((choice) => `<option value="${escapeHtml(choice)}" ${choice === value ? 'selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select></div>`;
  }
  return `<div class="field${wide}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${options.type || 'text'}" value="${escapeHtml(value)}"></div>`;
}

function renderPreview(kind, item) {
  state.kind = kind;
  state.item = normalizeParsed(kind, item);
  els.previewKind.textContent = kind;

  if (kind === 'publication') {
    els.previewForm.innerHTML = [
      fieldHtml('title', 'Title', state.item.title, { wide: true }),
      fieldHtml('authors', 'Authors', state.item.authors, { wide: true, type: 'textarea', rows: 3 }),
      fieldHtml('venue', 'Venue', state.item.venue),
      fieldHtml('year', 'Year', state.item.year, { type: 'number' }),
      fieldHtml('date', 'Date', state.item.date, { type: 'date' }),
      fieldHtml('tags', 'Tags (comma separated)', state.item.tags.join(', ')),
      fieldHtml('abstract', 'Abstract', state.item.abstract, { wide: true, type: 'textarea', rows: 4 }),
      fieldHtml('pdf', 'PDF URL', state.item.pdf),
      fieldHtml('poster', 'Poster URL', state.item.poster),
      fieldHtml('code', 'Code URL', state.item.code),
      fieldHtml('project', 'Project URL', state.item.project),
      fieldHtml('doi', 'DOI', state.item.doi),
      fieldHtml('externalUrl', 'External URL', state.item.externalUrl),
      fieldHtml('featured', 'Featured on home page', state.item.featured, { type: 'checkbox' }),
      fieldHtml('status', 'Status', state.item.status, { type: 'select', choices: ['published', 'draft'] })
    ].join('');
  } else {
    els.previewForm.innerHTML = [
      fieldHtml('title', 'Title', state.item.title, { wide: true }),
      fieldHtml('date', 'Date', state.item.date, { type: 'date' }),
      fieldHtml('category', 'Category', state.item.category, { type: 'select', choices: ['event', 'talk', 'award', 'paper', 'job', 'other'] }),
      fieldHtml('summary', 'Summary', state.item.summary, { wide: true, type: 'textarea', rows: 3 }),
      fieldHtml('content', 'Content', state.item.content, { wide: true, type: 'textarea', rows: 5 }),
      fieldHtml('links', 'Links, one per line: Label | URL', linksToText(state.item.links), { wide: true, type: 'textarea', rows: 3 }),
      fieldHtml('pinned', 'Pinned on home page', state.item.pinned, { type: 'checkbox' }),
      fieldHtml('status', 'Status', state.item.status, { type: 'select', choices: ['published', 'draft'] })
    ].join('');
  }

  els.previewPanel.classList.remove('hidden');
  els.previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function linksToText(links) {
  return (links || []).map((link) => `${link.label || 'Link'} | ${link.url || ''}`).join('\n');
}

function textToLinks(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      if (parts.length === 1) return { label: 'Link', url: parts[0] };
      return { label: parts[0] || 'Link', url: parts.slice(1).join('|').trim() };
    });
}

function collectPreview() {
  const form = new FormData(els.previewForm);
  if (state.kind === 'publication') {
    return {
      id: form.get('id') || state.item.id || '',
      title: form.get('title') || '',
      authors: form.get('authors') || '',
      venue: form.get('venue') || '',
      year: Number(form.get('year') || new Date().getFullYear()),
      date: form.get('date') || new Date().toISOString().slice(0, 10),
      tags: String(form.get('tags') || '').split(',').map((x) => x.trim()).filter(Boolean),
      abstract: form.get('abstract') || '',
      pdf: form.get('pdf') || '',
      poster: form.get('poster') || '',
      code: form.get('code') || '',
      project: form.get('project') || '',
      doi: form.get('doi') || '',
      externalUrl: form.get('externalUrl') || '',
      featured: Boolean(form.get('featured')),
      status: form.get('status') || 'published'
    };
  }

  return {
    id: form.get('id') || state.item.id || '',
    title: form.get('title') || '',
    date: form.get('date') || new Date().toISOString().slice(0, 10),
    summary: form.get('summary') || '',
    content: form.get('content') || '',
    links: textToLinks(form.get('links')),
    images: state.item.images || [],
    category: form.get('category') || 'event',
    pinned: Boolean(form.get('pinned')),
    status: form.get('status') || 'published'
  };
}

async function parseSource() {
  if (!state.token) throw new Error('Please login with GitHub first.');
  const text = els.sourceText.value.trim();
  if (!text) throw new Error('Please describe the update first.');

  const data = await api('/parse', {
    method: 'POST',
    body: JSON.stringify({
      kind: els.kindSelect.value,
      text
    })
  });
  renderPreview(data.kind, data.item);
  if (data.warnings && data.warnings.length) setResult({ warnings: data.warnings });
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        base64: result.includes(',') ? result.split(',').pop() : result
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function publishEntry() {
  if (!state.token) throw new Error('Please login with GitHub first.');
  if (!state.kind || !state.item) throw new Error('Please parse and review the entry first.');
  const item = collectPreview();
  const files = await Promise.all(state.files.map(fileToPayload));
  const data = await api('/publish', {
    method: 'POST',
    body: JSON.stringify({
      kind: state.kind,
      item,
      files
    })
  });
  setResult(data);
}

function copyJson() {
  const item = collectPreview();
  navigator.clipboard.writeText(JSON.stringify({ kind: state.kind, item }, null, 2));
  setResult('Copied preview JSON to clipboard.');
}

function fillSample(type) {
  if (type === 'publication') {
    els.kindSelect.value = 'publication';
    els.sourceText.value = 'Add a publication: title is "Automating Multi-view Requirements Engineering with Collaborative LLM Agents". Authors are Haowei Cheng, Jati H. Husen, Hironori Washizaki. Venue is MLSE Workshop 2025. Date is 2025-07-12. Tags are LLM, Requirements, Agents. Mark it as featured.';
    return;
  }
  els.kindSelect.value = 'update';
  els.sourceText.value = 'Add an activity update: On 2025-07-12, I presented "Automating Multi-view Requirements Engineering with Collaborative LLM Agents" at the MLSE Workshop in Hakone. The workshop link is https://sites.google.com/view/sig-mlse/. Category is talk. Pin it to the home page.';
}

els.loginBtn.addEventListener('click', loginWithGitHub);
els.logoutBtn.addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  updateAuthUi();
});
els.fileInput.addEventListener('change', () => {
  state.files = Array.from(els.fileInput.files || []);
  renderFiles();
});
els.parseBtn.dataset.label = els.parseBtn.textContent;
els.publishBtn.dataset.label = els.publishBtn.textContent;
els.parseBtn.addEventListener('click', async () => {
  try {
    setBusy(els.parseBtn, true, 'Parsing...');
    await parseSource();
  } catch (err) {
    setResult(err.message, true);
  } finally {
    setBusy(els.parseBtn, false);
  }
});
els.publishBtn.addEventListener('click', async () => {
  try {
    setBusy(els.publishBtn, true, 'Publishing...');
    await publishEntry();
  } catch (err) {
    setResult(err.message, true);
  } finally {
    setBusy(els.publishBtn, false);
  }
});
els.copyJsonBtn.addEventListener('click', copyJson);
els.samplePubBtn.addEventListener('click', () => fillSample('publication'));
els.sampleNewsBtn.addEventListener('click', () => fillSample('update'));
window.addEventListener('message', handleAuthMessage);

updateAuthUi();
renderFiles();
