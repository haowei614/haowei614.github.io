(function () {
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr || '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function byDateDesc(a, b) {
    return new Date(b.date || 0) - new Date(a.date || 0);
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Failed to load ' + path);
    return res.json();
  }

  function notifyRendered() {
    document.dispatchEvent(new CustomEvent('content-rendered'));
  }

  function publicationCard(item, forHome) {
    const tags = (item.tags || []).map(function (t) {
      return '<span class="tag">' + escapeHtml(t) + '</span>';
    }).join('');

    const link = item.pdf || item.project || '#';
    const title = escapeHtml(item.title);
    const venue = escapeHtml(item.venue || '');
    const year = escapeHtml(item.year || '');

    if (forHome) {
      return '<a class="pub-item reveal" href="' + escapeHtml(link) + '" target="_blank" rel="noopener">'
        + '<span class="pub-year">' + year + '</span>'
        + '<div><p class="pub-title">' + title + '</p>'
        + '<p class="pub-venue">' + venue + '</p>'
        + '<div class="pub-tags">' + tags + '</div></div></a>';
    }

    const actions = [];
    if (item.pdf) actions.push('<a class="btn-mini" href="' + escapeHtml(item.pdf) + '" target="_blank" rel="noopener">PDF</a>');
    if (item.poster) actions.push('<a class="btn-mini" href="' + escapeHtml(item.poster) + '" target="_blank" rel="noopener">Poster</a>');
    if (item.code) actions.push('<a class="btn-mini" href="' + escapeHtml(item.code) + '" target="_blank" rel="noopener">Code</a>');
    if (item.project) actions.push('<a class="btn-mini" href="' + escapeHtml(item.project) + '" target="_blank" rel="noopener">Project</a>');

    return '<article class="pub-card">'
      + '<div class="pub-card-head"><span class="pub-year">' + year + '</span><span class="pub-date">' + escapeHtml(fmtDate(item.date)) + '</span></div>'
      + '<h3 class="pub-card-title">' + title + '</h3>'
      + '<p class="pub-card-meta">' + escapeHtml(item.authors || '') + '</p>'
      + '<p class="pub-card-venue">' + venue + '</p>'
      + '<p class="pub-card-abs">' + escapeHtml(item.abstract || '') + '</p>'
      + '<div class="pub-tags">' + tags + '</div>'
      + '<div class="btn-mini-wrap">' + actions.join('') + '</div>'
      + '</article>';
  }

  function updateCard(item, forHome) {
    const links = (item.links || []).map(function (l) {
      return '<a href="' + escapeHtml(l.url || '#') + '" target="_blank" rel="noopener">' + escapeHtml(l.label || 'Link') + '</a>';
    }).join(' · ');

    if (forHome) {
      return '<div class="news-item">'
        + '<span class="news-date">' + escapeHtml(fmtDate(item.date)) + '</span>'
        + '<p class="news-text"><strong>' + escapeHtml(item.title) + '</strong> — ' + escapeHtml(item.summary || '')
        + (links ? ' (' + links + ')' : '') + '</p></div>';
    }

    const images = (item.images || []).map(function (src) {
      return '<img src="' + escapeHtml(src) + '" alt="update image" class="update-image">';
    }).join('');

    return '<article class="update-card">'
      + '<div class="update-head"><span class="pub-year">' + escapeHtml((item.date || '').slice(0, 4)) + '</span><span class="pub-date">' + escapeHtml(fmtDate(item.date)) + '</span></div>'
      + '<h3 class="update-title">' + escapeHtml(item.title || '') + '</h3>'
      + '<p class="update-summary">' + escapeHtml(item.summary || '') + '</p>'
      + (item.content ? '<p class="update-content">' + escapeHtml(item.content) + '</p>' : '')
      + (links ? '<p class="update-links">' + links + '</p>' : '')
      + (images ? '<div class="update-images">' + images + '</div>' : '')
      + '</article>';
  }

  async function renderPublications() {
    const data = await loadJson('/data/publications.json');
    const items = (data.items || []).filter(function (x) { return x.status === 'published'; }).sort(byDateDesc);

    const homeEl = document.getElementById('home-publications');
    if (homeEl) {
      const featured = items.filter(function (x) { return x.featured; });
      const pick = (featured.length >= 3 ? featured : items).slice(0, 3);
      homeEl.innerHTML = pick.map(function (x) { return publicationCard(x, true); }).join('');
    }

    const fullEl = document.getElementById('publications-listing');
    if (fullEl) {
      const grouped = {};
      items.forEach(function (it) {
        const y = String(it.year || 'Unknown');
        if (!grouped[y]) grouped[y] = [];
        grouped[y].push(it);
      });
      const years = Object.keys(grouped).sort(function (a, b) { return Number(b) - Number(a); });
      fullEl.innerHTML = years.map(function (y) {
        return '<section class="year-group"><h2 class="year-heading">' + escapeHtml(y) + '</h2>'
          + '<div class="pub-cards">' + grouped[y].map(function (x) { return publicationCard(x, false); }).join('') + '</div></section>';
      }).join('');
    }
  }

  async function renderUpdates() {
    const data = await loadJson('/data/updates.json');
    const items = (data.items || []).filter(function (x) { return x.status === 'published'; }).sort(byDateDesc);

    const homeEl = document.getElementById('home-updates');
    if (homeEl) {
      const pinned = items.filter(function (x) { return x.pinned; });
      const combined = pinned.concat(items.filter(function (x) { return !x.pinned; }));
      homeEl.innerHTML = combined.slice(0, 5).map(function (x) { return updateCard(x, true); }).join('');
    }

    const fullEl = document.getElementById('updates-listing');
    if (fullEl) {
      const grouped = {};
      items.forEach(function (it) {
        const y = String((it.date || '').slice(0, 4) || 'Unknown');
        if (!grouped[y]) grouped[y] = [];
        grouped[y].push(it);
      });
      const years = Object.keys(grouped).sort(function (a, b) { return Number(b) - Number(a); });
      fullEl.innerHTML = years.map(function (y) {
        return '<section class="year-group"><h2 class="year-heading">' + escapeHtml(y) + '</h2>'
          + '<div class="update-cards">' + grouped[y].map(function (x) { return updateCard(x, false); }).join('') + '</div></section>';
      }).join('');
    }
  }

  Promise.all([renderPublications(), renderUpdates()])
    .catch(function (err) {
      console.error(err);
    })
    .finally(function () {
      notifyRendered();
    });
})();
