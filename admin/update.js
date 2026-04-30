const WORKER_BASE = 'https://haowei614-decap-oauth.haowei614.workers.dev';
const TOKEN_KEY = 'hc-smart-update-github-token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  kind: '',
  item: null,
  files: [],
  mode: 'new',
  manageKind: 'publication',
  manageSearch: '',
  items: []
};

const MODULE_HINTS = {
  auto: 'Let the parser choose the content type from the text you paste.',
  publication: 'Use this for papers, PDFs, DOIs, and publication metadata.',
  update: 'Use this for talks, awards, visits, events, and other news items.',
  profile: 'Use this for the home resume section: bio, CV, photo, contact, and chips.',
  project: 'Use this for open project cards and project detail pages.'
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
  sampleProfileBtn: document.getElementById('sampleProfileBtn'),
  sampleProjectBtn: document.getElementById('sampleProjectBtn'),
  previewPanel: document.getElementById('previewPanel'),
  previewKind: document.getElementById('previewKind'),
  previewForm: document.getElementById('previewForm'),
  publishBtn: document.getElementById('publishBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  copyJsonBtn: document.getElementById('copyJsonBtn'),
  resultPanel: document.getElementById('resultPanel'),
  resultBox: document.getElementById('resultBox'),
  refreshBtn: document.getElementById('refreshBtn'),
  manageKind: document.getElementById('manageKind'),
  manageSearch: document.getElementById('manageSearch'),
  itemList: document.getElementById('itemList'),
  moduleHint: document.getElementById('moduleHint')
};

function setBusy(button, busy, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function updateModuleHint(kind) {
  if (!els.moduleHint) return;
  els.moduleHint.textContent = MODULE_HINTS[kind] || MODULE_HINTS.auto;
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
    loadItems().catch((err) => setResult(err.message, true));
  } else {
    els.authState.textContent = 'Not signed in';
    els.loginBtn.classList.remove('hidden');
    els.logoutBtn.classList.add('hidden');
    state.items = [];
    els.itemList.innerHTML = '<div class="item-empty">Sign in to load existing items.</div>';
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

function kindLabel(kind) {
  if (kind === 'publication') return 'Publication';
  if (kind === 'update') return 'Update';
  if (kind === 'profile') return 'Profile';
  if (kind === 'project') return 'Project';
  return 'Auto';
}

function itemSummary(item, kind) {
  if (kind === 'publication') {
    return [item.venue, item.year, (item.tags || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
  }
  if (kind === 'project') {
    return [item.slug, item.featured ? 'featured' : '', item.summary].filter(Boolean).join(' · ');
  }
  if (kind === 'profile') {
    return [item.heroMeta, item.location, item.cvUrl ? 'CV' : ''].filter(Boolean).join(' · ');
  }
  return [item.category, item.date, item.pinned ? 'pinned' : ''].filter(Boolean).join(' · ');
}

function renderItemList() {
  const kind = state.manageKind;
  const search = state.manageSearch.trim().toLowerCase();
  const items = state.items.filter((item) => {
    const haystack = [item.title, item.slug, item.summary, item.heroMeta, item.location, item.venue].join(' ').toLowerCase();
    return !search || haystack.includes(search);
  });

  if (!items.length) {
    els.itemList.innerHTML = '<div class="item-empty">No items found.</div>';
    return;
  }

  els.itemList.innerHTML = items.map((item) => `
    <article class="item-card" data-id="${escapeHtml(item.id)}">
      <div>
        <p class="item-title">${escapeHtml(item.title || item.id)}</p>
        <p class="item-meta">${escapeHtml(item.id)} · ${escapeHtml(itemSummary(item, kind))}</p>
      </div>
      <div class="item-actions">
        <button class="button button-ghost" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">Edit</button>
        ${kind === 'profile' ? '' : `<button class="button button-danger" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>`}
      </div>
    </article>
  `).join('');
}

async function loadItems(kind = state.manageKind) {
  if (!state.token) return;
  const data = await api(`/items?kind=${encodeURIComponent(kind)}`);
  state.manageKind = data.kind || kind;
  state.items = Array.isArray(data.items) ? data.items : [];
  els.manageKind.value = state.manageKind;
  updateModuleHint(state.manageKind);
  renderItemList();
}

function openExistingItem(item, kind = state.manageKind) {
  state.kind = kind;
  state.item = normalizeParsed(kind, item);
  state.mode = 'edit';
  state.files = [];
  els.fileInput.value = '';
  renderFiles();
  els.kindSelect.value = kind;
  renderPreview(kind, state.item);
  setPreviewMode('edit');
  els.resultPanel.classList.remove('hidden');
  setResult(`Loaded ${kindLabel(kind).toLowerCase()} ${item.id} for editing.`);
}

async function deleteExistingItem() {
  if (!state.token) throw new Error('Please login with GitHub first.');
  if (!state.item || !state.item.id || !state.kind) throw new Error('Please load an existing entry first.');
  if (state.kind === 'profile') throw new Error('The home profile cannot be deleted.');
  const label = `${kindLabel(state.kind).toLowerCase()} ${state.item.id}`;
  if (!window.confirm(`Delete ${label}? This will remove the entry from the site.`)) return;
  const data = await api('/delete', {
    method: 'POST',
    body: JSON.stringify({
      kind: state.kind,
      id: state.item.id
    })
  });
  setResult(data);
  state.item = null;
  state.kind = '';
  state.mode = 'new';
  state.files = [];
  els.fileInput.value = '';
  renderFiles();
  els.previewPanel.classList.add('hidden');
  await loadItems();
}

function setPreviewMode(mode) {
  state.mode = mode;
  const publishLabel = mode === 'edit' ? 'Save changes to GitHub' : 'Publish to GitHub';
  els.publishBtn.textContent = publishLabel;
  els.publishBtn.dataset.label = publishLabel;
  els.deleteBtn.classList.toggle('hidden', mode !== 'edit' || state.kind === 'profile');
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

  if (kind === 'profile') {
    return {
      id: item.id || 'site-profile',
      heroMeta: item.heroMeta || '',
      heroDescHtml: item.heroDescHtml || '',
      chips: Array.isArray(item.chips) ? item.chips : [],
      cvUrl: item.cvUrl || '',
      email: item.email || '',
      githubUrl: item.githubUrl || '',
      location: item.location || '',
      avatarUrl: item.avatarUrl || '',
      status: item.status || 'published'
    };
  }

  if (kind === 'project') {
    return {
      id: item.id || '',
      slug: item.slug || '',
      title: item.title || '',
      subtitle: item.subtitle || '',
      summary: item.summary || '',
      overview: item.overview || '',
      bodyHtml: item.bodyHtml || '',
      image: item.image || '',
      demoUrl: item.demoUrl || '',
      highlights: Array.isArray(item.highlights) ? item.highlights : [],
      links: Array.isArray(item.links) ? item.links : [],
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
  const readonly = options.readonly ? ' readonly' : '';
  return `<div class="field${wide}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${options.type || 'text'}" value="${escapeHtml(value)}"${readonly}></div>`;
}

function renderPreview(kind, item) {
  state.kind = kind;
  state.item = normalizeParsed(kind, item);
  els.previewKind.textContent = kindLabel(kind);

  if (kind === 'publication') {
    els.previewForm.innerHTML = [
      fieldHtml('id', 'ID', state.item.id, { wide: true, readonly: true }),
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
  } else if (kind === 'profile') {
    els.previewForm.innerHTML = [
      fieldHtml('id', 'ID', state.item.id, { wide: true, readonly: true }),
      fieldHtml('heroMeta', 'Hero meta', state.item.heroMeta, { wide: true }),
      fieldHtml('heroDescHtml', 'Hero description HTML', state.item.heroDescHtml, { wide: true, type: 'textarea', rows: 8 }),
      fieldHtml('chips', 'Chips (comma separated)', state.item.chips.join(', ')),
      fieldHtml('cvUrl', 'CV URL', state.item.cvUrl),
      fieldHtml('email', 'Email', state.item.email),
      fieldHtml('githubUrl', 'GitHub URL', state.item.githubUrl),
      fieldHtml('location', 'Location', state.item.location),
      fieldHtml('avatarUrl', 'Avatar URL', state.item.avatarUrl),
      fieldHtml('status', 'Status', state.item.status, { type: 'select', choices: ['published', 'draft'] })
    ].join('');
  } else if (kind === 'project') {
    els.previewForm.innerHTML = [
      fieldHtml('id', 'ID', state.item.id, { wide: true, readonly: true }),
      fieldHtml('slug', 'Slug', state.item.slug),
      fieldHtml('title', 'Title', state.item.title, { wide: true }),
      fieldHtml('subtitle', 'Subtitle', state.item.subtitle, { wide: true }),
      fieldHtml('summary', 'Summary', state.item.summary, { wide: true, type: 'textarea', rows: 3 }),
      fieldHtml('overview', 'Overview', state.item.overview, { wide: true, type: 'textarea', rows: 5 }),
      fieldHtml('bodyHtml', 'Body HTML', state.item.bodyHtml, { wide: true, type: 'textarea', rows: 8 }),
      fieldHtml('image', 'Image URL', state.item.image),
      fieldHtml('demoUrl', 'Demo / Video URL', state.item.demoUrl),
      fieldHtml('highlights', 'Highlights (comma separated)', state.item.highlights.join(', ')),
      fieldHtml('links', 'Links, one per line: Label | URL', linksToText(state.item.links), { wide: true, type: 'textarea', rows: 3 }),
      fieldHtml('featured', 'Featured on home page', state.item.featured, { type: 'checkbox' }),
      fieldHtml('status', 'Status', state.item.status, { type: 'select', choices: ['published', 'draft'] })
    ].join('');
  } else {
    els.previewForm.innerHTML = [
      fieldHtml('id', 'ID', state.item.id, { wide: true, readonly: true }),
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
  setPreviewMode(state.mode === 'edit' ? 'edit' : 'new');
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

  if (state.kind === 'profile') {
    return {
      id: form.get('id') || state.item.id || 'site-profile',
      heroMeta: form.get('heroMeta') || '',
      heroDescHtml: form.get('heroDescHtml') || '',
      chips: String(form.get('chips') || '').split(',').map((x) => x.trim()).filter(Boolean),
      cvUrl: form.get('cvUrl') || '',
      email: form.get('email') || '',
      githubUrl: form.get('githubUrl') || '',
      location: form.get('location') || '',
      avatarUrl: form.get('avatarUrl') || '',
      status: form.get('status') || 'published'
    };
  }

  if (state.kind === 'project') {
    return {
      id: form.get('id') || state.item.id || '',
      slug: form.get('slug') || '',
      title: form.get('title') || '',
      subtitle: form.get('subtitle') || '',
      summary: form.get('summary') || '',
      overview: form.get('overview') || '',
      bodyHtml: form.get('bodyHtml') || '',
      image: form.get('image') || '',
      demoUrl: form.get('demoUrl') || '',
      highlights: String(form.get('highlights') || '').split(',').map((x) => x.trim()).filter(Boolean),
      links: textToLinks(form.get('links')),
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
  state.mode = 'new';
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
  const data = await api('/save', {
    method: 'POST',
    body: JSON.stringify({
      kind: state.kind,
      item,
      files
    })
  });
  setResult(data);
  state.item = data.item || item;
  state.mode = 'edit';
  renderPreview(state.kind, state.item);
  setPreviewMode('edit');
  state.files = [];
  els.fileInput.value = '';
  renderFiles();
  await loadItems();
}

function copyJson() {
  const item = collectPreview();
  navigator.clipboard.writeText(JSON.stringify({ kind: state.kind, item }, null, 2));
  setResult('Copied preview JSON to clipboard.');
}

function fillSample(type) {
  state.mode = 'new';
  if (type === 'publication') {
    els.kindSelect.value = 'publication';
    els.sourceText.value = 'Add a publication: title is "Automating Multi-view Requirements Engineering with Collaborative LLM Agents". Authors are Haowei Cheng, Jati H. Husen, Hironori Washizaki. Venue is MLSE Workshop 2025. Date is 2025-07-12. Tags are LLM, Requirements, Agents. Mark it as featured.';
    return;
  }
  if (type === 'update') {
    els.kindSelect.value = 'update';
    els.sourceText.value = 'Add an activity update: On 2025-07-12, I presented "Automating Multi-view Requirements Engineering with Collaborative LLM Agents" at the MLSE Workshop in Hakone. The workshop link is https://sites.google.com/view/sig-mlse/. Category is talk. Pin it to the home page.';
    return;
  }
  if (type === 'profile') {
    els.kindSelect.value = 'profile';
    els.sourceText.value = 'Update the home profile. Set hero meta to "Ph.D. Candidate / Software Engineering & AI". Rewrite the bio HTML to mention Waseda University and Generative AI-driven requirements engineering. Chips are GenAI for Requirements Engineering, Reliable Software Systems, and Deep-Fake Speech Detection. CV URL is /assets/pdf/CV-Haowei%20CHENG.pdf. Email is haowei.cheng@fuji.waseda.jp. GitHub URL is https://www.github.com/haowei614. Location is Shinjuku, Tokyo, Japan. Mark it as published.';
    return;
  }
  els.kindSelect.value = 'project';
  els.sourceText.value = 'Add an open project. Slug is re. Title is Requirements Engineering. Subtitle is GenAI-assisted requirements workflows and practical methods. Summary is a focused project page on requirements engineering methods and practices for software development. Overview explains the project focus and current materials. Demo URL is https://www.youtube.com/embed/_llqRnlrzWw?si=8tF5UQ6iDthMaJ8E. Highlights are LLM-assisted requirements analysis, Executable scenario realization in CARLA, and Collaborative workflows for software teams. Mark it as featured.';
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
els.deleteBtn.dataset.label = els.deleteBtn.textContent;
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
els.deleteBtn.addEventListener('click', async () => {
  try {
    setBusy(els.deleteBtn, true, 'Deleting...');
    await deleteExistingItem();
  } catch (err) {
    setResult(err.message, true);
  } finally {
    setBusy(els.deleteBtn, false);
  }
});
els.copyJsonBtn.addEventListener('click', copyJson);
els.samplePubBtn.addEventListener('click', () => fillSample('publication'));
els.sampleNewsBtn.addEventListener('click', () => fillSample('update'));
els.sampleProfileBtn.addEventListener('click', () => fillSample('profile'));
els.sampleProjectBtn.addEventListener('click', () => fillSample('project'));
els.refreshBtn.addEventListener('click', async () => {
  try {
    setBusy(els.refreshBtn, true, 'Refreshing...');
    await loadItems();
    setResult('Refreshed item list.');
  } catch (err) {
    setResult(err.message, true);
  } finally {
    setBusy(els.refreshBtn, false);
  }
});
els.kindSelect.addEventListener('change', () => updateModuleHint(els.kindSelect.value));
els.manageKind.addEventListener('change', async () => {
  state.manageKind = els.manageKind.value;
  await loadItems();
});
els.manageSearch.addEventListener('input', () => {
  state.manageSearch = els.manageSearch.value;
  renderItemList();
});
els.itemList.addEventListener('click', async (event) => {
  const action = event.target && event.target.dataset && event.target.dataset.action;
  const id = event.target && event.target.dataset && event.target.dataset.id;
  if (!action || !id) return;
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (action === 'edit') {
    openExistingItem(item, state.manageKind);
  } else if (action === 'delete') {
    state.kind = state.manageKind;
    state.item = normalizeParsed(state.kind, item);
    state.mode = 'edit';
    renderPreview(state.kind, state.item);
    setPreviewMode('edit');
    await deleteExistingItem();
  }
});
window.addEventListener('message', handleAuthMessage);

updateModuleHint(els.kindSelect.value);
updateAuthUi();
renderFiles();
loadItems().catch((err) => setResult(err.message, true));
