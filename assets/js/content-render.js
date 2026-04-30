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

  function splitParagraphs(text) {
    return String(text || '')
      .trim()
      .split(/\n{2,}/)
      .filter(Boolean)
      .map(function (block) {
        return '<p>' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function notifyRendered() {
    document.dispatchEvent(new CustomEvent('content-rendered'));
  }

  function publicationCard(item, forHome) {
    const tags = (item.tags || []).map(function (t) {
      return '<span class="tag">' + escapeHtml(t) + '</span>';
    }).join('');

    const doi = String(item.doi || '').trim();
    const doiUrl = doi ? 'https://doi.org/' + doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : '';
    const link = item.pdf || item.externalUrl || doiUrl || item.project || '#';
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
    if (item.doi) actions.push('<a class="btn-mini" href="' + escapeHtml(doiUrl) + '" target="_blank" rel="noopener">DOI</a>');
    if (item.externalUrl) actions.push('<a class="btn-mini" href="' + escapeHtml(item.externalUrl) + '" target="_blank" rel="noopener">Link</a>');
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

  function projectCard(item, forHome) {
    const initials = (item.slug || item.title || 'PR')
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(function (part) { return part[0]; })
      .join('')
      .slice(0, 3)
      .toUpperCase();

    const links = (item.links || []).map(function (l) {
      return '<a href="' + escapeHtml(l.url || '#') + '" target="_blank" rel="noopener">' + escapeHtml(l.label || 'Link') + '</a>';
    }).join('');
    const image = item.image ? '<img class="project-image" src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.title || 'project') + '">' : '';

    if (forHome) {
      return '<article class="project-card reveal">'
        + '<div class="project-icon">' + escapeHtml(initials || 'PR') + '</div>'
        + '<h3 class="project-title">' + escapeHtml(item.title || '') + '</h3>'
        + '<p class="project-desc">' + escapeHtml(item.summary || item.subtitle || '') + '</p>'
        + '<a href="/projects/' + escapeHtml(item.slug || '') + '/" class="project-link">View project page</a>'
        + '</article>';
    }

    return '<article class="project-card">'
      + '<div class="project-icon">' + escapeHtml(initials || 'PR') + '</div>'
      + '<h3 class="project-title">' + escapeHtml(item.title || '') + '</h3>'
      + '<p class="project-desc">' + escapeHtml(item.subtitle || item.summary || '') + '</p>'
      + image
      + '<p class="project-desc">' + escapeHtml(item.summary || '') + '</p>'
      + '<div class="project-links">' + links + '</div>'
      + '</article>';
  }

  function projectDetail(item) {
    const links = (item.links || []).map(function (l) {
      return '<a href="' + escapeHtml(l.url || '#') + '" target="_blank" rel="noopener">' + escapeHtml(l.label || 'Link') + '</a>';
    }).join('');
    const highlights = (item.highlights || []).map(function (x) {
      return '<li>' + escapeHtml(x) + '</li>';
    }).join('');
    const image = item.image ? '<img class="project-image" src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.title || 'project') + '">' : '';
    const body = item.bodyHtml ? item.bodyHtml : splitParagraphs(item.overview || item.summary || '');
    const demo = item.demoUrl ? '<div class="project-links"><a href="' + escapeHtml(item.demoUrl) + '" target="_blank" rel="noopener">Demo / Video</a></div>' : '';

    return '<article class="project-detail">'
      + '<div class="project-detail-hero">'
      + '<div>'
      + '<span class="project-detail-kicker">Open project</span>'
      + '<h1 class="project-detail-title">' + escapeHtml(item.title || '') + '</h1>'
      + '<p class="project-detail-subtitle">' + escapeHtml(item.subtitle || item.summary || '') + '</p>'
      + '</div>'
      + '<div class="project-detail-panel">'
      + image
      + demo
      + '<div class="project-links">' + links + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="project-detail-body">' + body + '</div>'
      + (highlights ? '<div class="project-highlights"><h2 class="year-heading">Highlights</h2><ul>' + highlights + '</ul></div>' : '')
      + '</article>';
  }

  async function renderProfile() {
    const data = await loadJson('/data/profile.json');
    const heroMeta = document.getElementById('hero-meta');
    const heroDesc = document.getElementById('hero-desc');
    const heroChips = document.getElementById('hero-chips');
    const cvLink = document.getElementById('cv-link');
    const emailLink = document.getElementById('email-link');
    const githubLink = document.getElementById('github-link');
    const heroPhoto = document.getElementById('hero-photo');
    const heroLocation = document.getElementById('hero-location');

    if (heroMeta && data.heroMeta) heroMeta.textContent = data.heroMeta;
    if (heroDesc && data.heroDescHtml) heroDesc.innerHTML = data.heroDescHtml;
    if (heroChips && Array.isArray(data.chips)) {
      heroChips.innerHTML = data.chips.map(function (chip) {
        return '<span class="chip">' + escapeHtml(chip) + '</span>';
      }).join('');
    }
    if (cvLink && data.cvUrl) cvLink.setAttribute('href', data.cvUrl);
    if (emailLink && data.email) emailLink.setAttribute('href', 'mailto:' + data.email);
    if (githubLink && data.githubUrl) githubLink.setAttribute('href', data.githubUrl);
    if (heroPhoto && data.avatarUrl) heroPhoto.setAttribute('src', data.avatarUrl);
    if (heroLocation && data.location) heroLocation.textContent = data.location;
  }

  async function renderPublications() {
    const data = await loadJson('/data/publications.json');
    const items = (data.items || []).filter(function (x) { return x.status === 'published'; }).sort(byDateDesc);

    const homeEl = document.getElementById('home-publications');
    if (homeEl) {
      const featured = items.filter(function (x) { return x.featured; });
      const pick = (featured.length ? featured : items).slice(0, 3);
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
      const pick = (pinned.length ? pinned : items).slice(0, 4);
      homeEl.innerHTML = pick.map(function (x) { return updateCard(x, true); }).join('');
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

  async function renderProjects() {
    const data = await loadJson('/data/projects.json');
    const items = (data.items || []).filter(function (x) { return x.status === 'published'; });

    const homeEl = document.getElementById('home-projects');
    if (homeEl) {
      const featured = items.filter(function (x) { return x.featured; });
      const pick = (featured.length ? featured : items).slice(0, 3);
      homeEl.innerHTML = pick.map(function (x) { return projectCard(x, true); }).join('');
    }

    const fullEl = document.getElementById('projects-listing');
    if (fullEl) {
      fullEl.innerHTML = items.map(function (x) { return projectCard(x, false); }).join('');
    }

    const detailEl = document.getElementById('project-detail');
    if (detailEl) {
      const slug = document.body.dataset.projectSlug || '';
      const item = items.find(function (x) { return x.slug === slug; });
      if (item) {
        detailEl.innerHTML = projectDetail(item);
      } else {
        detailEl.innerHTML = '<p class="section-intro">Project not found.</p>';
      }
    }
  }

  Promise.allSettled([renderProfile(), renderPublications(), renderUpdates(), renderProjects()])
    .then(function (results) {
      results.forEach(function (result) {
        if (result.status === 'rejected') console.error(result.reason);
      });
    })
    .finally(function () {
      notifyRendered();
    });
})();
