/* WTF Atlas — hash-routed static app over data/insights.json */
(function () {
  'use strict';

  var DB = null;
  var el = function (id) { return document.getElementById(id); };
  var main = el('main');

  /* ---------- helpers ---------- */

  /* Title-case industry/geography tags for display, keeping acronyms upper */
  var ACRONYMS = { ai: 'AI', ev: 'EV', vc: 'VC', it: 'IT', us: 'US', eu: 'EU', fintech: 'FinTech' };
  function disp(s) {
    if (!s) return '';
    if (ACRONYMS[s.toLowerCase()]) return ACRONYMS[s.toLowerCase()];
    return s.replace(/(^|[\s-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function epLabel(ep) {
    if (ep.episode == null) return 'WTF Special';
    return 'EP #' + ep.episode;
  }

  function epShortTitle(ep) {
    var t = ep.title || ep.raw_title || '';
    if (t.length > 62) t = t.slice(0, 60) + '…';
    return t;
  }

  function seriesName(s) {
    return ({
      main: 'WTF is with Nikhil Kamath',
      people: 'People by WTF',
      finance: 'WTF is Finance',
      online: 'WTF Online'
    })[s] || s || '';
  }

  function byId(vid) { return (DB && DB.epMap && DB.epMap[vid]) || null; }

  function epHref(vid) { return '#/episode/' + vid; }

  /* link to the exact card inside its episode: #/episode/<vid>/<tab>/<index> */
  function itemHref(kind, it) {
    var ep = byId(it.video_id);
    if (!ep) return epHref(it.video_id);
    var key = function (x) { return (x.text || '') + '|' + (x.metric || '') + '|' + (x.value || ''); };
    var k = key(it), idx = -1;
    (ep[kind] || []).some(function (x, i) { if (key(x) === k) { idx = i; return true; } return false; });
    return epHref(it.video_id) + '/' + kind + (idx >= 0 ? '/' + idx : '');
  }

  function safeEp(vid) {
    var ep = byId(vid);
    if (!ep) return null;
    ep.title = ep.title || ep.raw_title || '';
    return ep;
  }

  function guestNames(ep) {
    return (ep.guests || []).filter(Boolean);
  }

  /* count items per episode for the episode rows */
  function epCounts(ep) {
    return {
      insights: ep.insights.length,
      data: ep.data_points.length,
      quotes: ep.quotes.length,
      ideas: ep.ideas.length,
      stories: ep.stories.length
    };
  }

  /* ---------- card renderers ---------- */

  function footHtml(item, opts) {
    opts = opts || {};
    var ep = safeEp(item.video_id);
    var h = '<div class="card-foot">';
    h += '<span class="who">' + esc(item.speaker || 'Unattributed') + '</span>';
    if (ep && !opts.sameEpisode) {
      h += '<a class="src-link" href="' + epHref(item.video_id) + '">' +
           esc(epLabel(ep)) + ' · ' + esc(epShortTitle(ep)) + '</a>';
    } else if (ep) {
      h += '<a class="src-link" href="' + esc(ep.youtube) + '" target="_blank" rel="noopener">on YouTube ↗</a>';
    }
    if (item.industry) h += '<span class="pill">' + esc(disp(item.industry)) + '</span>';
 if (item.geography) h += '<span class="pill">' + esc(disp(item.geography)) + '</span>';
    h += '</div>';
    return h;
  }

  function insightCard(it, opts) {
    return '<article class="card">' +
      '<p class="card-text">' + esc(it.text) + '</p>' + footHtml(it, opts) + '</article>';
  }

  function dataCard(it, opts) {
    return '<article class="card is-data"><div class="dp">' +
      '<span class="dp-val">' + esc(it.value) + '</span>' +
      '<span class="dp-metric">' + esc(it.metric) +
      (it.unit ? ' <span class="dp-unit">(' + esc(it.unit) + ')</span>' : '') +
      '</span></div>' +
      (it.context ? '<p class="card-text">' + esc(it.context) + '</p>' : '') +
      footHtml(it, opts) + '</article>';
  }

  function quoteCard(it, opts) {
    return '<article class="card is-quote"><p class="card-text">&ldquo;' + esc(it.text) +
      '&rdquo;</p>' + footHtml(it, opts) +
      (it.theme ? '<span class="pill" style="margin-left:52px">' + esc(it.theme) + '</span>' : '') +
      '</article>';
  }

  function ideaCard(it, opts) {
    return '<article class="card is-idea"><p class="card-text">' + esc(it.text) + '</p>' +
      footHtml(it, opts) +
      (it.type ? '<span class="pill" style="margin-left:52px">' + esc(it.type) + '</span>' : '') +
      '</article>';
  }

  function storyCard(it, opts) {
    return '<article class="card is-story"><p class="card-text">' + esc(it.text) + '</p>' +
      footHtml(it, opts) +
      (it.lesson ? '<p class="card-text" style="font-size:14px;color:var(--ink-3);margin-top:-4px">→ ' + esc(it.lesson) + '</p>' : '') +
      '</article>';
  }

  var RENDER = {
    insights: insightCard,
    data_points: dataCard,
    quotes: quoteCard,
    ideas: ideaCard,
    stories: storyCard
  };

  function cardsOf(kind, items, opts) {
    if (!items.length) {
      return '<div class="empty"><h3>Nothing here yet</h3><p>No ' + kind +
        ' to show here.</p></div>';
    }
    return '<div class="cards">' + items.map(function (it) {
      return RENDER[kind](it, opts);
    }).join('') + '</div>';
  }

  function chipsHtml(filterDim, keys, active, counts) {
    var h = '<div class="chips" role="group" aria-label="Filter">';
    h += '<button class="chip" data-filter="' + filterDim + '" data-key="" aria-pressed="' +
         (!active ? 'true' : 'false') + '">All</button>';
    keys.forEach(function (k) {
      h += '<button class="chip" data-filter="' + filterDim + '" data-key="' + esc(k) +
           '" aria-pressed="' + (active === k ? 'true' : 'false') + '">' + esc(disp(k)) +
           '<span class="n">' + (counts[k] || 0) + '</span></button>';
    });
    return h + '</div>';
  }

  /* ============================ VIEWS ============================ */

  function stat(n, l) { return '<div class="stat"><div class="stat-n">' + n + '</div><div class="stat-l">' + l + '</div></div>'; }

  var DIMKEY = { industry: 'industries', geography: 'geographies' };
  function tagData(dim) { return DB[DIMKEY[dim] || dim + 's'] || {}; }
  function safeKeys(dim) { return Object.keys(tagData(dim)); }

  function viewHome() {
    var m = DB.meta || {};
    m.counts = m.counts || {};
    var eps = m.episodes || DB.episodes.length;
    var top = safeKeys('industry').slice(0, 6);
    var h = '<section class="hero">' +
      '<p class="hero-eyebrow">Nikhil Kamath · WTF podcast</p>' +
      '<h1>Everything the <em>smartest guests</em> said, made findable.</h1>' +
      '<p class="hero-sub">Insights, numbers, quotes and ideas from ' + eps +
      ' episodes — organised by industry, geography and person, each one linked back to the episode it came from.</p>' +
      '<div class="stat-row">' +
      stat(eps, 'Episodes') +
      stat(m.counts.insights || 0, 'Insights') +
      stat(m.counts.data_points || 0, 'Data points') +
      stat(m.counts.quotes || 0, 'Quotes') +
      stat(m.counts.ideas || 0, 'Ideas') +
      stat(m.counts.stories || 0, 'Stories') +
      '</div></section>';

    if (top.length) {
      h += '<section><div class="section-head"><h2>Browse by industry</h2>' +
           '<span class="count">' + safeKeys('industry').length + ' sectors</span>' +
           '<span class="rule"></span></div>' + tagGrid('industry', top) + '</section>';
    }
    if (DB.items.insights.length) {
      h += '<section><div class="section-head"><h2>Featured insights</h2>' +
           '<span class="count">' + DB.items.insights.length + ' total</span><span class="rule"></span></div>' +
           cardsOf('insights', DB.items.insights.slice(0, 8)) + '</section>';
    }
    if (DB.items.quotes.length) {
      h += '<section><div class="section-head"><h2>Quotes worth keeping</h2>' +
           '<span class="count">' + DB.items.quotes.length + ' total</span><span class="rule"></span></div>' +
           cardsOf('quotes', DB.items.quotes.slice(0, 5)) + '</section>';
    }
    return h;
  }

  function tagGrid(dim, keys) {
    var h = '<div class="tag-grid">';
    keys.forEach(function (k) {
      var t = tagData(dim)[k];
      if (!t) return;
      var pct = Math.round((t.episode_count / Math.max(1, DB.meta.episodes || DB.episodes.length)) * 100);
      h += '<a class="tag-card" href="#/' + dim + 's/' + encodeURIComponent(k) + '">' +
           '<h3>' + esc(disp(k)) + '</h3>' +
           '<div class="meta"><span><b>' + t.episode_count + '</b> episodes</span>' +
           (t.insights ? '<span><b>' + t.insights + '</b> insights</span>' : '') +
           '</div><div class="bar"><i style="width:' + Math.max(4, pct) + '%"></i></div></a>';
    });
    return h + '</div>';
  }

  function viewTagList(dim) {
    var title = dim === 'industry' ? 'Industries' : 'Geographies';
    var keys = safeKeys(dim);
    var sub = dim === 'industry'
      ? 'Every sector the show has covered, ranked by how many episodes touch it.'
      : 'Every country and region the guests talked about, ranked the same way.';
    return '<section class="page-head"><h1>' + title + '</h1><p>' + sub + '</p></section>' +
      '<section>' + tagGrid(dim, keys) + '</section>';
  }

  function viewTagDetail(dim, key) {
    var tag = tagData(dim)[key];
    if (!tag) return notFound('No such ' + dim);
    var h = '<section class="page-head">' +
      '<h1>' + esc(disp(key)) + '</h1>' +
      '<p>' + tag.episode_count + ' episodes · ' + (tag.insights || 0) + ' tagged insights · ' +
      (tag.data_points || 0) + ' data points.</p></section>';

    h += '<div class="section-head"><h2>Insights</h2><span class="count">' +
      countTagged('insights', dim, key) + '</span><span class="rule"></span></div>';
    h += cardsOf('insights', filterTagged('insights', dim, key));

    h += '<div class="section-head"><h2>Numbers</h2><span class="count">' +
      countTagged('data_points', dim, key) + '</span><span class="rule"></span></div>';
    h += cardsOf('data_points', filterTagged('data_points', dim, key));

    h += '<div class="section-head"><h2>Ideas</h2><span class="rule"></span></div>';
    h += cardsOf('ideas', filterTagged('ideas', dim, key));

    h += '<div class="section-head"><h2>Episodes</h2><span class="count">' +
      tag.episode_count + '</span><span class="rule"></span></div>' +
      epList(tag.episodes.map(byId).filter(Boolean));
    return h;
  }

  function countTagged(kind, dim, key) {
    return filterTagged(kind, dim, key).length;
  }
  /* an item matches a tag if the item itself is tagged OR its episode covers it */
  function filterTagged(kind, dim, key) {
    return DB.items[kind].filter(function (it) {
      if (it[dim] === key) return true;
      var ep = byId(it.video_id);
      return !!(ep && ep[dim === 'industry' ? 'industries' : 'geographies'] &&
                ep[dim === 'industry' ? 'industries' : 'geographies'].indexOf(key) !== -1);
    });
  }

  function viewList(kind, label, blurb, filterDim) {
    var keys = filterDim ? safeKeys(filterDim) : [];
    var counts = {};
    keys.forEach(function (k) { counts[k] = filterTagged(kind, filterDim, k).length; });
    var active = filterDim && state.filters[filterDim];
    var h = '<section class="page-head"><h1>' + label + '</h1><p>' + blurb + '</p></section>';
    if (filterDim && keys.length) h += chipsHtml(filterDim, keys, active, counts);
    var items = DB.items[kind];
    if (active) items = filterTagged(kind, filterDim, active);
    h += '<div class="section-head"><h2>' + (active ? disp(active) : label) + '</h2><span class="count">' +
         items.length + '</span><span class="rule"></span></div>';
    h += cardsOf(kind, items);
    return h;
  }

  function viewEpisodes() {
    var eps = DB.episodes.slice().sort(function (a, b) {
      if (a.series !== b.series) return (a.series || '').localeCompare(b.series || '');
      return (a.episode == null ? 999 : a.episode) - (b.episode == null ? 999 : b.episode);
    });
    var h = '<section class="page-head"><h1>Episodes</h1><p>' + eps.length +
      ' episodes across ' + DB.meta.series.length + ' series. Open one to deep-dive its numbers, stories and data.</p></section>';
    h += '<div class="ep-list">' + eps.map(function (ep) {
      var c = epCounts(ep);
      return '<a class="ep-row" href="' + epHref(ep.video_id) + '">' +
        '<span class="ep-num">' + esc(epLabel(ep)) + '</span>' +
        '<span class="ep-main"><span class="ep-title">' + esc(ep.title) + '</span>' +
        '<span class="ep-guests">' + esc(seriesName(ep.series)) +
        (guestNames(ep).length ? ' · with ' + esc(guestNames(ep).join(', ')) : '') +
        '</span></span>' +
        '<span class="ep-counts">' +
          cnt(c.insights, 'ins') + cnt(c.data_points, 'data') +
          cnt(c.quotes, 'quote') + cnt(c.ideas, 'idea') +
        '</span></a>';
    }).join('') + '</div>';
    return h;

    function cnt(n, l) { return '<span class="ep-count"><b>' + n + '</b>' + l + '</span>'; }
  }

  var TABS = [
    ['insights', 'Insights'], ['data_points', 'Numbers & data'],
    ['quotes', 'Quotes'], ['ideas', 'Ideas'], ['stories', 'Stories']
  ];

  function viewEpisode(vid, tab) {
    var ep = byId(vid);
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'insights';
    if (!ep) return notFound('Unknown episode');
    var h = '<section class="epd-head">' +
      '<a class="back" href="#/episodes">← All episodes</a>' +
      '<h1>' + esc(ep.title) + '</h1>' +
      '<div class="epd-meta">' +
        '<span class="pill ep">' + esc(epLabel(ep)) + '</span>' +
        '<span>' + esc(seriesName(ep.series)) + '</span>' +
        (guestNames(ep).length ? '<span>with <strong>' + esc(guestNames(ep).join(', ')) + '</strong></span>' : '') +
        '<a href="' + esc(ep.youtube) + '" target="_blank" rel="noopener">Watch on YouTube ↗</a>' +
      '</div>' +
      '<div class="chips" style="margin-top:16px">' +
        ep.industries.map(function (i) {
          return '<a class="chip" href="#/industries/' + encodeURIComponent(i) + '">' + esc(disp(i)) + '</a>';
        }).join('') +
        ep.geographies.map(function (g) {
          return '<a class="chip" href="#/geographies/' + encodeURIComponent(g) + '">' + esc(disp(g)) + '</a>';
        }).join('') +
      '</div></section>';

    h += '<div class="epd-tabs" role="tablist">' + TABS.map(function (t, i) {
      return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' +
        (t[0] === tab ? 'true' : 'false') + '">' + t[1] +
        ' <span style="opacity:.5">' + ep[t[0]].length + '</span></button>';
    }).join('') + '</div>';

    h += '<div id="tabPanel">' + cardsOf(tab, ep[tab], {sameEpisode:true}) + '</div>';
    return h;
  }

  function notFound(msg) {
    return '<div class="empty"><h3>' + esc(msg) + '</h3>' +
      '<p><a href="#/">Back to the atlas</a></p></div>';
  }

  function epList(eps) {
    if (!eps.length) return '<div class="empty"><h3>No episodes</h3></div>';
    return '<div class="ep-list">' + eps.map(function (ep) {
      return '<a class="ep-row" href="' + epHref(ep.video_id) + '">' +
        '<span class="ep-num">' + esc(epLabel(ep)) + '</span>' +
        '<span class="ep-main"><span class="ep-title">' + esc(ep.title) + '</span>' +
        '<span class="ep-guests">' + esc(seriesName(ep.series)) +
        (guestNames(ep).length ? ' · with ' + esc(guestNames(ep).join(', ')) : '') +
        '</span></span></a>';
    }).join('') + '</div>';
  }

  /* ============================ Router ============================ */

  var state = { filters: {} };
  var lastRoot = null, lastEp = null;

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    var root = parts[0] || '';

    document.querySelectorAll('.nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      a.classList.toggle('active', href === '#/' + root || (!root && href === '#/'));
    });

    var html;
    try {
      if (!root) html = viewHome();
      else if (root === 'industries') html = parts[1] ? viewTagDetail('industry', parts[1]) : viewTagList('industry');
      else if (root === 'geographies') html = parts[1] ? viewTagDetail('geography', parts[1]) : viewTagList('geography');
      else if (root === 'data') html = viewList('data_points', 'Data', 'Every specific number stated on the show, with the context that makes it matter.', 'industry');
      else if (root === 'quotes') html = viewList('quotes', 'Quotes', 'The lines worth writing down, and who said them.', null);
      else if (root === 'ideas') html = viewList('ideas', 'Ideas', 'Opportunities, theses and contrarian bets proposed by the guests.', null);
      else if (root === 'stories') html = viewList('stories', 'Stories', 'Concrete anecdotes with named entities — and the lesson attached.', null);
      else if (root === 'episodes') html = viewEpisodes();
      else if (root === 'episode' && parts[1]) html = viewEpisode(parts[1], parts[2]);
      else html = notFound('Page not found');
    } catch (err) {
      html = notFound('Error rendering ' + (root || 'home') + ': ' + err.message);
    }

    main.innerHTML = html;

    /* deep link from search: #/episode/<vid>/<tab>/<index> -> scroll to + flash the card */
    var target = root === 'episode' && parts[3] != null &&
      main.querySelectorAll('#tabPanel .card')[+parts[3]];
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
    } else if (!(root === 'episode' && lastRoot === 'episode' && lastEp === parts[1])) {
      /* keep scroll position when only switching tabs inside the same episode */
      window.scrollTo(0, 0);
    }
    lastRoot = root;
    lastEp = parts[1] || null;
  }

  /* delegated clicks: filter chips + episode tabs */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip[data-filter]');
    if (chip) {
      var dim = chip.getAttribute('data-filter');
      var key = chip.getAttribute('data-key');
      state.filters[dim] = key || null;
      route();
      return;
    }
    var tab = e.target.closest('.epd-tabs button');
    if (tab) {
      var m = location.hash.match(/^#\/episode\/([^/]+)/);
      if (m) location.hash = '#/episode/' + m[1] + '/' + tab.getAttribute('data-tab');
      return;
    }
  });

  /* ============================ Search ============================ */

  var modal = el('searchModal'), input = el('searchInput'), results = el('searchResults');
  var selIdx = 0, srItems = [];

  function openSearch() {
    modal.hidden = false;
    input.value = ''; results.innerHTML = '';
    selIdx = 0; srItems = [];
    input.focus();
  }
  function closeSearch() { modal.hidden = true; }

  el('searchBtn').addEventListener('click', openSearch);
  modal.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeSearch(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault(); openSearch();
    }
    if (e.key === 'Escape') closeSearch();
    if (!modal.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      selIdx = Math.max(0, Math.min(srItems.length - 1,
        selIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      paintSel();
    }
    if (!modal.hidden && e.key === 'Enter' && srItems[selIdx]) {
      location.hash = srItems[selIdx].hash; closeSearch();
    }
  });

  function paintSel() {
    results.querySelectorAll('.sr-item').forEach(function (n, i) {
      n.classList.toggle('sel', i === selIdx);
      if (i === selIdx) n.scrollIntoView({ block: 'nearest' });
    });
  }

  function hl(text, q) {
    var s = esc(text);
    if (!q) return s;
    try {
      return s.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'),
        '<mark>$1</mark>');
    } catch (e) { return s; }
  }

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    srItems = [];
    if (q.length < 2) { results.innerHTML = '<div class="sr-group">Type to search</div>'; return; }

    var groups = [
      ['insights', 'Insights'], ['data_points', 'Data'], ['quotes', 'Quotes'],
      ['ideas', 'Ideas'], ['stories', 'Stories']
    ];
    var html = '', selIdxReset = true;
    groups.forEach(function (g) {
      var kind = g[0];
      var hits = DB.items[kind].filter(function (it) {
        var hay = ((it.text || '') + ' ' + (it.speaker || '') + ' ' +
                   (it.metric || '') + ' ' + (it.context || '') + ' ' +
                   (it.episode_title || '') + ' ' + (it.theme || '')).toLowerCase();
        return hay.indexOf(q) !== -1;
      }).slice(0, 6);
      if (!hits.length) return;
      html += '<div class="sr-group">' + g[1] + '</div>';
      hits.forEach(function (it) {
        var idx = srItems.length;
        srItems.push({ hash: itemHref(kind, it) });
        var label = it.text || it.metric || '';
        var ep = safeEp(it.video_id);
        html += '<button class="sr-item" data-i="' + idx + '">' +
          '<span class="t">' + hl(label, input.value.trim()) + '</span>' +
          '<span class="s"><span>' + esc(it.speaker || '') + '</span>' +
          (ep ? '<span>' + esc(epLabel(ep)) + '</span>' +
                 '<span>' + esc(epShortTitle(ep)) + '</span>' : '') +
          '</span></button>';
      });
    });
    results.innerHTML = html || '<div class="sr-group">No matches</div>';
    selIdx = 0;
    paintSel();
  });

  results.addEventListener('click', function (e) {
    var item = e.target.closest('.sr-item');
    if (item) {
      location.hash = srItems[+item.getAttribute('data-i')].hash;
      closeSearch();
    }
  });

  /* ============================ boot ============================ */

  main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading the atlas…</div>';

  fetch('data/insights.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      d.epMap = {};
      d.episodes.forEach(function (ep) { d.epMap[ep.video_id] = ep; });
      DB = d;
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function (err) {
      main.innerHTML = '<div class="empty"><h3>Could not load data</h3><p>' +
        esc(String(err)) + '</p></div>';
    });
})();
