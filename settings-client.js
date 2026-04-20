/* settings-client.js — Profile & Settings panel (all tiers) */
(function () {
  'use strict';

  var PROFILE_API  = '/.netlify/functions/business-profile';
  var BOOKING_BASE = 'https://textboss.com.au/book.html?owner=';

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  function injectStyles(accent) {
    if (document.getElementById('sf-styles')) return;
    var s = document.createElement('style');
    s.id = 'sf-styles';
    s.textContent = [
      '.sf-panel{max-width:520px;margin:0 auto;padding:24px 20px 60px;overflow-y:auto;height:100%;display:flex;flex-direction:column;gap:24px}',
      '.sf-section{background:#0c0e11;border:1px solid #191d22;border-radius:10px;padding:20px}',
      '.sf-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#52606d;margin-bottom:4px}',
      '.sf-section-desc{font-size:12px;color:#52606d;margin-bottom:16px;line-height:1.55}',

      '.sf-avatar-row{display:flex;align-items:center;gap:16px;margin-bottom:4px}',
      '.sf-avatar{width:72px;height:72px;border-radius:50%;background:#232830;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#52606d;border:2px solid #232830;cursor:pointer;transition:border-color .15s}',
      '.sf-avatar:hover{border-color:' + accent + '}',
      '.sf-avatar img{width:100%;height:100%;object-fit:cover}',
      '.sf-avatar-hint{font-size:12px;color:#52606d;margin-top:4px}',

      '.sf-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}',
      '.sf-field:last-of-type{margin-bottom:0}',
      '.sf-label{font-size:12px;color:#8896a4;font-weight:600}',
      '.sf-input{background:#020203;border:1px solid #232830;border-radius:7px;padding:9px 12px;color:#e4ecf2;font:15px Consolas,Monaco,monospace;outline:none;width:100%;transition:border-color .15s}',
      '.sf-input:focus{border-color:' + accent + '}',
      '.sf-input[readonly]{opacity:.45;cursor:default}',

      '.sf-save-btn{background:' + accent + ';color:#020203;border:none;border-radius:8px;padding:10px 24px;font:700 13px Consolas,Monaco,monospace;cursor:pointer;transition:opacity .15s;margin-top:4px}',
      '.sf-save-btn:hover{opacity:.85}',
      '.sf-save-btn:disabled{opacity:.5;cursor:default}',
      '.sf-ghost-btn{background:transparent;color:' + accent + ';border:1px solid ' + accent + ';border-radius:8px;padding:9px 20px;font:700 13px Consolas,Monaco,monospace;cursor:pointer;transition:opacity .15s}',
      '.sf-ghost-btn:hover{opacity:.75}',
      '.sf-ghost-btn:disabled{opacity:.4;cursor:default}',

      '.sf-link-box{display:flex;align-items:center;gap:8px;background:#020203;border:1px solid #232830;border-radius:7px;padding:10px 12px;margin-bottom:10px}',
      '.sf-link-url{flex:1;font-size:12px;color:' + accent + ';word-break:break-all;line-height:1.4}',

      '.sf-status{font-size:12px;color:#52606d;margin-top:6px;min-height:16px}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildPanel(panelEl, accent, initialProfile, userEmail) {
    var p = initialProfile || {};
    var hasScheduling = (p._tier === 'Pro' || p._tier === 'Black');

    var bookingSection = hasScheduling ? (
      '<div class="sf-section" id="sf-booking-section">' +
        '<div class="sf-section-title">Your booking link</div>' +
        '<div class="sf-section-desc">Share this link anywhere — your website, Instagram bio, email signature. Clients tap it to book an appointment with you directly, without needing to message you first.</div>' +
        '<div id="sf-booking-body"></div>' +
      '</div>'
    ) : '';

    panelEl.innerHTML =
      '<div class="sf-panel">' +

        bookingSection +

        '<div class="sf-section">' +
          '<div class="sf-section-title">Profile photo</div>' +
          '<div class="sf-section-desc">Shown on your public booking page so clients know who they\'re booking with.</div>' +
          '<div class="sf-avatar-row">' +
            '<div class="sf-avatar" id="sf-avatar-preview">' +
              (p.avatar_data
                ? '<img src="' + esc(p.avatar_data) + '" alt="avatar">'
                : esc((p.owner_first_name || 'T').charAt(0).toUpperCase())) +
            '</div>' +
            '<div>' +
              '<button type="button" class="sf-ghost-btn" id="sf-avatar-btn">Upload photo</button>' +
              '<input type="file" id="sf-avatar-input" accept="image/*" style="display:none">' +
              '<div class="sf-avatar-hint">Square JPG or PNG · max 200 KB</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="sf-section">' +
          '<div class="sf-section-title">Personal details</div>' +
          '<div class="sf-section-desc">Used to auto-fill your prompt templates — you won\'t need to type your name into every message.</div>' +
          '<div class="sf-field"><label class="sf-label">First name</label>' +
            '<input class="sf-input" id="sf-first-name" type="text" placeholder="Jane" maxlength="100" value="' + esc(p.owner_first_name || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">Full name</label>' +
            '<input class="sf-input" id="sf-full-name" type="text" placeholder="Jane Smith" maxlength="200" value="' + esc(p.owner_full_name || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">Login email</label>' +
            '<input class="sf-input" id="sf-email" type="email" value="' + esc(userEmail || '') + '" readonly></div>' +
        '</div>' +

        '<div class="sf-section">' +
          '<div class="sf-section-title">Business details</div>' +
          '<div class="sf-section-desc">Shown on your booking page and used to fill in prompts with your business info.</div>' +
          '<div class="sf-field"><label class="sf-label">Business name</label>' +
            '<input class="sf-input" id="sf-biz-name" type="text" placeholder="Jane\'s Salon" maxlength="200" value="' + esc(p.business_name || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">Business phone</label>' +
            '<input class="sf-input" id="sf-phone" type="text" placeholder="+61 4xx xxx xxx" maxlength="40" value="' + esc(p.business_phone || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">City</label>' +
            '<input class="sf-input" id="sf-city" type="text" placeholder="Melbourne" maxlength="100" value="' + esc(p.city || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">Website (optional)</label>' +
            '<input class="sf-input" id="sf-website" type="text" placeholder="https://yourbusiness.com" maxlength="200" value="' + esc(p.website || '') + '"></div>' +
          '<div class="sf-field"><label class="sf-label">ABN (optional)</label>' +
            '<input class="sf-input" id="sf-abn" type="text" placeholder="12 345 678 901" maxlength="20" value="' + esc(p.abn || '') + '"></div>' +

          '<button type="button" class="sf-save-btn" id="sf-save-btn">Save changes</button>' +
          '<div class="sf-status" id="sf-status"></div>' +
        '</div>' +

      '</div>';

    // ── Shared status helper ───────────────────────────────────────────────────
    var statusEl = panelEl.querySelector('#sf-status');
    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? '#ef4444' : '#52606d';
      if (!isErr) setTimeout(function () { statusEl.textContent = ''; }, 2500);
    }

    // ── Booking link section ───────────────────────────────────────────────────
    if (hasScheduling) {
      renderBookingLink(panelEl, p.booking_slug || null, accent);
    }

    // ── Avatar upload ──────────────────────────────────────────────────────────
    var avatarBtn   = panelEl.querySelector('#sf-avatar-btn');
    var avatarInput = panelEl.querySelector('#sf-avatar-input');
    var avatarPrev  = panelEl.querySelector('#sf-avatar-preview');

    if (avatarBtn) avatarBtn.addEventListener('click', function () { avatarInput.click(); });
    if (avatarInput) {
      avatarInput.addEventListener('change', function () {
        var file = avatarInput.files[0];
        if (!file) return;
        if (file.size > 200000) { setStatus('Image too large — must be under 200 KB.', true); return; }
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        var ctx = canvas.getContext('2d');
        var img = new window.Image();
        img.onload = async function () {
          var size = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 256, 256);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          avatarPrev.innerHTML = '<img src="' + dataUrl + '" alt="avatar">';
          updateHeaderAvatar(dataUrl, null);
          try {
            var res = await fetch(PROFILE_API, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ avatar_data: dataUrl }),
            });
            var data = await res.json();
            if (data.ok) setStatus('Photo saved.');
            else setStatus('Save failed — try again.', true);
          } catch (_) { setStatus('Save failed — check connection.', true); }
        };
        img.src = URL.createObjectURL(file);
        avatarInput.value = '';
      });
    }

    // ── Save profile ───────────────────────────────────────────────────────────
    var saveBtn = panelEl.querySelector('#sf-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        var get = function (id) { var el = panelEl.querySelector('#' + id); return el ? el.value.trim() : ''; };
        var firstName = get('sf-first-name');
        try {
          var res = await fetch(PROFILE_API, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              owner_first_name: firstName || null,
              owner_full_name:  get('sf-full-name')  || null,
              business_name:    get('sf-biz-name')   || null,
              business_phone:   get('sf-phone')      || null,
              city:             get('sf-city')       || null,
              website:          get('sf-website')    || null,
              abn:              get('sf-abn')        || null,
            }),
          });
          var data = await res.json();
          if (data.ok) { setStatus('Saved.'); updateHeaderAvatar(null, firstName); }
          else setStatus('Save failed — try again.', true);
        } catch (_) { setStatus('Save failed — check connection.', true); }
        saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
      });
    }
  }

  // ── Booking link sub-renderer (called on init + after generate) ─────────────
  function renderBookingLink(panelEl, slug, accent) {
    var body = panelEl.querySelector('#sf-booking-body');
    if (!body) return;
    body.innerHTML = '';

    if (slug) {
      var url = BOOKING_BASE + encodeURIComponent(slug);

      var linkBox = document.createElement('div');
      linkBox.className = 'sf-link-box';
      var urlSpan = document.createElement('span');
      urlSpan.className = 'sf-link-url';
      urlSpan.textContent = url;
      linkBox.appendChild(urlSpan);
      body.appendChild(linkBox);

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'sf-save-btn';
      copyBtn.textContent = 'Copy link';
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(url).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
        }).catch(function () {
          copyBtn.textContent = 'Copy failed';
          setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
        });
      });
      btnRow.appendChild(copyBtn);

      var regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.className = 'sf-ghost-btn';
      regenBtn.textContent = 'Regenerate';
      regenBtn.title = 'Creates a new link — your old link will stop working';
      regenBtn.addEventListener('click', async function () {
        if (!confirm('This will create a new link. Your old link will stop working immediately. Continue?')) return;
        regenBtn.disabled = true; regenBtn.textContent = 'Generating…';
        await generateSlug(panelEl, accent);
      });
      btnRow.appendChild(regenBtn);
      body.appendChild(btnRow);

    } else {
      var desc = document.createElement('p');
      desc.style.cssText = 'font-size:13px;color:#8896a4;margin-bottom:14px;line-height:1.55';
      desc.textContent = 'You don\'t have a booking link yet. Generate one and share it anywhere — clients can book without messaging you first.';
      body.appendChild(desc);

      var genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'sf-save-btn';
      genBtn.textContent = 'Generate booking link';
      genBtn.addEventListener('click', async function () {
        genBtn.disabled = true; genBtn.textContent = 'Generating…';
        await generateSlug(panelEl, accent);
      });
      body.appendChild(genBtn);
    }
  }

  async function generateSlug(panelEl, accent) {
    try {
      var res = await fetch(PROFILE_API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generateSlug: true }),
      });
      var data = await res.json();
      if (data.ok && data.profile && data.profile.booking_slug) {
        renderBookingLink(panelEl, data.profile.booking_slug, accent);
      }
    } catch (_) {}
  }

  function updateHeaderAvatar(dataUrl, firstName) {
    var av = document.getElementById('app-avatar');
    if (!av) return;
    if (dataUrl) {
      av.innerHTML = '<img src="' + dataUrl + '" alt="avatar">';
    } else if (firstName && !av.querySelector('img')) {
      av.textContent = firstName.charAt(0).toUpperCase();
    }
  }

  window.initSettings = function (opts) {
    var panel     = opts.panel;
    var accent    = opts.accent    || '#06b6d4';
    var profile   = opts.profile   || {};
    var userEmail = opts.userEmail || '';
    var tier      = opts.tier      || 'Core';

    // Stash tier on profile so buildPanel can gate the booking link section
    profile._tier = tier;

    injectStyles(accent);
    buildPanel(panel, accent, profile, userEmail);
  };

})();
