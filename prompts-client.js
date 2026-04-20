/* prompts-client.js — native prompts renderer (replaces iframe approach) */
(function () {
  'use strict';

  var PROMPTS_FILE = {
    Core:  '/core_subscriber_prompts.html',
    Pro:   '/pro_subscriber_prompts.html',
    Black: '/black_subscriber_prompts.html',
  };

  var state = {
    tier: 'Core',
    sections: [],   // [{ category, cards: [{ num, title, body }] }]
    fields: {},
    activeCategory: 'All',
    searchQuery: '',
    profile: null,
  };

  // ── Field mapping from profile to prompt {{VARIABLES}} ──────────────────────
  function profileToFields(profile, email) {
    return {
      BUSINESS_NAME:    (profile && profile.business_name)    || '',
      YOUR_FIRST_NAME:  (profile && profile.owner_first_name) || '',
      YOUR_FULL_NAME:   (profile && profile.owner_full_name)  || '',
      CLIENT_NAME:      '',
      BUSINESS_PHONE:   (profile && profile.business_phone)   || '',
      BUSINESS_EMAIL:   email || '',
      WEBSITE:          (profile && profile.website)          || '',
      ABN:              (profile && profile.abn)              || '',
      CITY:             (profile && profile.city)             || '',
    };
  }

  // ── Parse fetched HTML into sections ────────────────────────────────────────
  function parsePromptsHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var sections = [];
    var currentSection = null;

    var container = doc.querySelector('#prompts') || doc.body;
    var children = Array.from(container.children);

    children.forEach(function (el) {
      if (el.classList.contains('section-header')) {
        var h2 = el.querySelector('h2');
        var raw = h2 ? h2.textContent : '';
        var span = el.querySelector('.count');
        var category = raw.replace(span ? span.textContent : '', '').trim();
        currentSection = { category: category, cards: [] };
        sections.push(currentSection);
      } else if (el.classList.contains('prompt-card') && currentSection) {
        var numEl = el.querySelector('.card-num');
        var titleEl = el.querySelector('.card-title');
        var bodyEl = el.querySelector('.card-body');
        currentSection.cards.push({
          num:   numEl   ? numEl.textContent.trim()   : '',
          title: titleEl ? titleEl.textContent.trim() : '',
          body:  bodyEl  ? bodyEl.textContent.trim()  : '',
        });
      }
    });

    return sections;
  }

  // ── Escape HTML ─────────────────────────────────────────────────────────────
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Apply variable substitution to a template body ──────────────────────────
  function applyFields(body, fields) {
    return body.replace(/\{\{(\w+)\}\}/g, function (match, key) {
      var val = fields[key];
      return val
        ? '<span class="pf-filled">' + esc(val) + '</span>'
        : '<span class="pf-var">' + match + '</span>';
    }).replace(/\[([^\]]+)\]/g, function (match, inner) {
      return '<span class="pf-open">[' + esc(inner) + ']</span>';
    });
  }

  // ── Render the full prompts panel ────────────────────────────────────────────
  function render(container) {
    var sections = state.sections;
    var fields   = state.fields;
    var activeCat = state.activeCategory;
    var query    = state.searchQuery.toLowerCase().trim();

    // Collect all categories
    var cats = ['All'].concat(sections.map(function (s) { return s.category; }));

    // Filter sections
    var filtered = sections.filter(function (s) {
      return activeCat === 'All' || s.category === activeCat;
    }).map(function (s) {
      var cards = s.cards.filter(function (c) {
        if (!query) return true;
        return c.title.toLowerCase().includes(query) || c.body.toLowerCase().includes(query);
      });
      return { category: s.category, cards: cards };
    }).filter(function (s) { return s.cards.length > 0; });

    // ── Details panel ────────────────────────────────────────────────────────
    var detailsHtml = '<div class="pf-details-panel">' +
      '<div class="pf-details-bar">Your Details</div>' +
      '<div class="pf-details-grid">' +
      [
        ['BUSINESS_NAME',   'Business Name',        'text',   'e.g. Bright Side Design', false],
        ['YOUR_FIRST_NAME', 'Your First Name',       'text',   'e.g. Sarah',              false],
        ['YOUR_FULL_NAME',  'Your Full Name',        'text',   'e.g. Sarah Mitchell',     false],
        ['CLIENT_NAME',     'Client / Customer Name','text',   'e.g. James',              false],
        ['BUSINESS_PHONE',  'Business Phone',        'text',   'e.g. 0412 345 678',       false],
        ['BUSINESS_EMAIL',  'Business Email',        'text',   'e.g. hello@example.com',  false],
        ['WEBSITE',         'Website',               'text',   'e.g. www.example.com',    true],
        ['ABN',             'ABN / Business Number', 'text',   'e.g. 12 345 678 901',     true],
        ['CITY',            'City / Location',       'text',   'e.g. Melbourne',          true],
      ].map(function (f) {
        var key = f[0], label = f[1], type = f[2], placeholder = f[3], optional = f[4];
        var val = esc(fields[key] || '');
        return '<div><label class="pf-label">' + esc(label) +
          (optional ? ' <span class="pf-optional">(optional)</span>' : '') +
          '</label>' +
          '<input class="pf-input" type="' + type + '" data-field="' + key + '"' +
          ' value="' + val + '" placeholder="' + esc(placeholder) + '"></div>';
      }).join('') +
      '</div></div>';

    // ── Filter chips ─────────────────────────────────────────────────────────
    var chipsHtml = '<div class="pf-chips">' +
      cats.map(function (cat) {
        return '<button class="pf-chip' + (cat === activeCat ? ' active' : '') + '" data-cat="' + esc(cat) + '">' +
          esc(cat) + '</button>';
      }).join('') + '</div>';

    // ── Search ───────────────────────────────────────────────────────────────
    var searchHtml = '<div class="pf-search-row">' +
      '<input class="pf-search" type="search" placeholder="Search templates…" value="' + esc(state.searchQuery) + '">' +
      '</div>';

    // ── Cards ────────────────────────────────────────────────────────────────
    var cardsHtml = filtered.length === 0
      ? '<div class="pf-empty">No templates match your search.</div>'
      : filtered.map(function (s) {
          var header = '<div class="pf-section-header"><h2>' + esc(s.category) +
            '<span class="pf-count">' + s.cards.length + '</span></h2></div>';
          var cards = s.cards.map(function (c) {
            return '<div class="pf-card">' +
              '<div class="pf-card-head">' +
                '<span><span class="pf-num">' + esc(c.num) + '</span>' +
                '<span class="pf-title">' + esc(c.title) + '</span></span>' +
                '<button class="pf-copy-btn" type="button">Copy</button>' +
              '</div>' +
              '<div class="pf-card-body">' + applyFields(c.body, fields) + '</div>' +
            '</div>';
          }).join('');
          return header + cards;
        }).join('');

    container.innerHTML = detailsHtml + searchHtml + chipsHtml +
      '<div class="pf-cards">' + cardsHtml + '</div>';

    // ── Bind inputs ──────────────────────────────────────────────────────────
    container.querySelectorAll('.pf-input').forEach(function (input) {
      input.addEventListener('input', function () {
        state.fields[this.dataset.field] = this.value;
        // Re-render only the card bodies (live update)
        container.querySelectorAll('.pf-card').forEach(function (card, i) {
          var bodies = container.querySelectorAll('.pf-card-body');
          // find card body and re-render
        });
        renderCardBodies(container);
      });
    });

    // ── Bind chips ───────────────────────────────────────────────────────────
    container.querySelectorAll('.pf-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.activeCategory = this.dataset.cat;
        render(container);
      });
    });

    // ── Bind search ──────────────────────────────────────────────────────────
    var searchInput = container.querySelector('.pf-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.searchQuery = this.value;
        render(container);
      });
    }

    // ── Bind copy buttons ────────────────────────────────────────────────────
    container.addEventListener('click', function (e) {
      if (!e.target.classList.contains('pf-copy-btn')) return;
      var body = e.target.closest('.pf-card').querySelector('.pf-card-body');
      var text = body ? body.textContent : '';
      navigator.clipboard.writeText(text).then(function () {
        var btn = e.target;
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.textContent = orig;
          btn.classList.remove('copied');
        }, 1500);
      }).catch(function () {});
    });
  }

  function renderCardBodies(container) {
    // Re-apply field substitution to all visible card bodies without full re-render
    var allCards = state.sections.flatMap(function (s) { return s.cards; });
    var bodies = container.querySelectorAll('.pf-card-body');
    var cardEls = container.querySelectorAll('.pf-card');
    // Match cards to bodies by order
    var visibleCards = [];
    var filtered = state.sections.filter(function (s) {
      return state.activeCategory === 'All' || s.category === state.activeCategory;
    });
    filtered.forEach(function (s) {
      s.cards.filter(function (c) {
        if (!state.searchQuery) return true;
        var q = state.searchQuery.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q);
      }).forEach(function (c) { visibleCards.push(c); });
    });

    bodies.forEach(function (bodyEl, i) {
      if (visibleCards[i]) {
        bodyEl.innerHTML = applyFields(visibleCards[i].body, state.fields);
      }
    });
  }

  // ── Inject CSS ───────────────────────────────────────────────────────────────
  function injectStyles(accent) {
    if (document.getElementById('pf-styles')) return;
    var style = document.createElement('style');
    style.id = 'pf-styles';
    style.textContent = [
      '.pf-panel{display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:0;}',
      '.pf-panel::-webkit-scrollbar{width:3px}',
      '.pf-panel::-webkit-scrollbar-thumb{background:#232830;border-radius:3px}',

      '.pf-details-panel{margin:16px;background:#0c0e11;border:1px solid #191d22;border-radius:6px;overflow:hidden;flex-shrink:0}',
      '.pf-details-bar{padding:10px 18px;background:#0f1216;border-bottom:1px solid #191d22;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:' + accent + '}',
      '.pf-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;padding:16px}',
      '@media(max-width:600px){.pf-details-grid{grid-template-columns:1fr}}',
      '.pf-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8896a4;margin-bottom:4px}',
      '.pf-optional{color:#52606d;text-transform:none;letter-spacing:0;font-size:11px}',
      '.pf-input{width:100%;background:#020203;border:1px solid #232830;border-radius:4px;padding:7px 10px;color:#e4ecf2;font:14px Consolas,Monaco,monospace;outline:none;transition:border-color .15s;font-size:16px}',
      '.pf-input:focus{border-color:' + accent + '}',
      '.pf-input::placeholder{color:#52606d}',

      '.pf-search-row{padding:0 16px 8px;flex-shrink:0}',
      '.pf-search{width:100%;background:#0c0e11;border:1px solid #191d22;border-radius:6px;padding:9px 12px;color:#e4ecf2;font:14px Consolas,Monaco,monospace;outline:none;transition:border-color .15s;font-size:16px}',
      '.pf-search:focus{border-color:' + accent + '}',
      '.pf-search::placeholder{color:#52606d}',

      '.pf-chips{display:flex;gap:6px;overflow-x:auto;padding:0 16px 12px;flex-shrink:0;-webkit-overflow-scrolling:touch}',
      '.pf-chips::-webkit-scrollbar{display:none}',
      '.pf-chip{flex-shrink:0;padding:5px 14px;background:#0c0e11;border:1px solid #232830;border-radius:20px;color:#8896a4;font:11px Consolas,Monaco,monospace;font-weight:700;letter-spacing:.04em;cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.pf-chip:hover{border-color:' + accent + ';color:' + accent + '}',
      '.pf-chip.active{background:' + accent + '1a;border-color:' + accent + ';color:' + accent + '}',

      '.pf-cards{padding:0 16px 32px}',
      '.pf-section-header{padding:14px 0 10px;border-bottom:1px solid #191d22;margin-top:24px;margin-bottom:14px}',
      '.pf-section-header:first-child{margin-top:0}',
      '.pf-section-header h2{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:' + accent + '}',
      '.pf-count{font-size:11px;color:#52606d;margin-left:8px;font-weight:400}',

      '.pf-card{background:#0c0e11;border:1px solid #191d22;border-radius:6px;margin-bottom:12px;overflow:hidden}',
      '.pf-card-head{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid #191d22;background:#0f1216}',
      '.pf-num{font-size:11px;color:#52606d;margin-right:8px}',
      '.pf-title{font-size:13px;font-weight:600;color:#e4ecf2}',
      '.pf-copy-btn{background:transparent;border:1px solid #232830;color:#8896a4;font:11px Consolas,Monaco,monospace;padding:4px 10px;border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:all .15s}',
      '.pf-copy-btn:hover{border-color:' + accent + ';color:' + accent + '}',
      '.pf-copy-btn.copied{background:' + accent + ';border-color:' + accent + ';color:#020203}',
      '.pf-card-body{padding:12px 14px;font-size:13px;line-height:1.7;color:#e4ecf2;white-space:pre-wrap;word-break:break-word}',
      '.pf-filled{color:' + accent + ';font-weight:600}',
      '.pf-var{color:' + accent + ';font-weight:600}',
      '.pf-open{color:#f59e0b}',
      '.pf-empty{padding:32px;text-align:center;color:#52606d;font-size:13px}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.initPrompts = function initPrompts(options) {
    var tier     = options.tier    || 'Core';
    var panelEl  = options.panel;
    var profile  = options.profile || null;
    var email    = options.email   || '';
    var accent   = options.accent  || '#06b6d4';

    state.tier    = tier;
    state.profile = profile;
    state.fields  = profileToFields(profile, email);

    injectStyles(accent);

    var container = document.createElement('div');
    container.className = 'pf-panel';
    panelEl.innerHTML = '';
    panelEl.appendChild(container);

    var file = PROMPTS_FILE[tier] || PROMPTS_FILE['Core'];

    // Show loading state
    container.innerHTML = '<div class="pf-empty">Loading templates…</div>';

    fetch(file)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        state.sections = parsePromptsHtml(html);
        state.activeCategory = 'All';
        state.searchQuery = '';
        render(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="pf-empty">Failed to load templates. Please refresh.</div>';
      });
  };

})();
