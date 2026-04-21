/* scheduler-client.js — Text Boss v2 Scheduler UI
 * Shared module for app-pro.html and app-black.html.
 * Call window.initScheduler({ tier, inputLimit, enableIcalExport }) when the
 * Scheduler tab is first activated.
 */
(function (global) {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var _tier = 'Pro';
  var _inputLimit = 6000;
  var _enableIcalExport = false;

  // ── State ────────────────────────────────────────────────────────────────────
  var schedConversation = [];
  var schedBusy = false;
  var cachedAppointments = [];
  var cachedProfile = null;
  var selectedDate = todayStr();
  var calMonth, calYear;

  // Busy block state
  var cachedBusyBlocks = [];
  var lastImportBatchId = null;

  // Services state (relational table)
  var cachedServices = [];

  // Wizard state
  var wizStep = 1;
  var wizData = {};

  // ── Utilities ────────────────────────────────────────────────────────────────
  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function padTwo(n) {
    return String(n).padStart(2, '0');
  }

  function daysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
  }

  function firstDayOfMonth(month, year) {
    return new Date(year, month, 1).getDay();
  }

  function formatDateLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
  }

  function formatMonthLabel(month, year) {
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return months[month] + ' ' + year;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function getJson(url, options) {
    var res = await fetch(url, options);
    var data = await res.json();
    return { response: res, data: data };
  }

  // ── Business Profile API ─────────────────────────────────────────────────────
  async function loadBusinessProfile() {
    try {
      var result = await getJson('/.netlify/functions/business-profile', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.denied) { window.location.href = '/access.html'; return null; }
      cachedProfile = (result.data.ok) ? (result.data.profile || null) : null;
    } catch (_) {
      cachedProfile = null;
    }
    return cachedProfile;
  }

  async function saveBusinessProfile(updates) {
    try {
      var result = await getJson('/.netlify/functions/business-profile', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (result.data.ok && result.data.profile) {
        cachedProfile = result.data.profile;
      }
      return result.data.ok;
    } catch (_) {
      return false;
    }
  }

  // ── Appointments API ─────────────────────────────────────────────────────────
  async function loadAppointments() {
    try {
      var result = await getJson('/.netlify/functions/appointments', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.denied) { window.location.href = '/access.html'; return; }
      if (result.data.ok) {
        cachedAppointments = result.data.appointments || [];
      }
    } catch (_) {}
    updateSchedulerBadge();
    renderCalendar();
    renderDayDetail(selectedDate);
  }

  function updateSchedulerBadge() {
    var badge = document.getElementById('scheduler-badge');
    var panel = document.getElementById('upcoming-appts');
    var today = todayStr();
    var upcoming = cachedAppointments
      .filter(function (a) { return a.status === 'confirmed' && a.scheduled_date >= today; })
      .sort(function (a, b) { return a.scheduled_date < b.scheduled_date ? -1 : 1; });

    if (badge) {
      if (upcoming.length > 0) {
        badge.textContent = String(upcoming.length);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    if (panel) {
      if (upcoming.length > 0) {
        var html = '<div class="upcoming-appts-title">Upcoming confirmed</div>';
        upcoming.forEach(function (a) {
          var d = a.scheduled_date; // YYYY-MM-DD
          var parts = d.split('-');
          var dateLabel = parts[2] + '/' + parts[1] + '/' + parts[0].slice(2);
          var time = a.scheduled_time ? a.scheduled_time.slice(0, 5) : '';
          var name = a.client_name || a.title || 'Appointment';
          var svc = a.service_name ? ' &mdash; ' + a.service_name : '';
          html += '<div class="upcoming-appt-row">'
            + '<span class="upcoming-appt-dot"></span>'
            + '<span class="upcoming-appt-date">' + dateLabel + (time ? ' ' + time : '') + '</span>'
            + '<span class="upcoming-appt-name">' + name + svc + '</span>'
            + '</div>';
        });
        panel.innerHTML = html;
        panel.style.display = '';
      } else {
        panel.style.display = 'none';
      }
    }
  }

  // ── Busy Blocks API ──────────────────────────────────────────────────────────
  async function loadBusyBlocks() {
    try {
      var result = await getJson('/.netlify/functions/busy-blocks', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.denied) { window.location.href = '/access.html'; return; }
      if (result.data.ok) {
        cachedBusyBlocks = result.data.blocks || [];
      }
    } catch (_) {}
    renderBusyBlocks();
  }

  async function loadServices() {
    try {
      var result = await getJson('/.netlify/functions/services', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.ok && Array.isArray(result.data.services)) {
        cachedServices = result.data.services;
      }
    } catch (_) {}
  }

  async function deleteBusyBlock(id) {
    try {
      await fetch('/.netlify/functions/busy-blocks?id=' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin'
      });
      cachedBusyBlocks = cachedBusyBlocks.filter(function (b) { return b.id !== id; });
      renderBusyBlocks();
    } catch (_) {}
  }

  async function undoLastImport() {
    if (!lastImportBatchId) return;
    try {
      await fetch('/.netlify/functions/busy-blocks?batch=' + encodeURIComponent(lastImportBatchId), {
        method: 'DELETE', credentials: 'same-origin'
      });
      lastImportBatchId = null;
      await loadBusyBlocks();
      var statusEl = document.getElementById('import-status');
      if (statusEl) { statusEl.textContent = 'Import undone.'; statusEl.className = 'import-status'; }
    } catch (_) {}
  }

  function renderBusyBlocks() {
    var container = document.getElementById('busy-block-list');
    if (!container) return;
    container.innerHTML = '';

    // Show undo button if there's a recent import batch
    if (lastImportBatchId) {
      var undoBtn = document.createElement('button');
      undoBtn.className = 'undo-import-btn';
      undoBtn.type = 'button';
      undoBtn.textContent = 'Undo last import';
      undoBtn.addEventListener('click', undoLastImport);
      container.appendChild(undoBtn);
    }

    // Show up to 20 upcoming busy blocks
    var upcoming = cachedBusyBlocks
      .filter(function (b) { return b.block_date >= todayStr(); })
      .slice(0, 20);

    if (upcoming.length === 0 && !lastImportBatchId) {
      var empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.style.marginTop = '8px';
      empty.textContent = 'No busy blocks. Tell the AI to block time, or import an .ics file.';
      container.appendChild(empty);
      return;
    }

    upcoming.forEach(function (block) {
      var item = document.createElement('div');
      item.className = 'busy-block-item';

      var info = document.createElement('div');
      info.className = 'busy-block-info';

      var dateEl = document.createElement('div');
      dateEl.className = 'busy-block-date';
      dateEl.textContent = block.block_date;

      var timeEl = document.createElement('div');
      timeEl.className = 'busy-block-time';
      timeEl.textContent = block.start_time + '\u2013' + block.end_time;

      info.appendChild(dateEl);
      info.appendChild(timeEl);

      if (block.label) {
        var labelEl = document.createElement('div');
        labelEl.className = 'busy-block-label';
        labelEl.textContent = escapeHtml(block.label);
        info.appendChild(labelEl);
      }

      var srcBadge = document.createElement('span');
      srcBadge.className = 'busy-block-src ' + (block.source === 'ical_import' ? 'ical' : 'ai');
      srcBadge.textContent = block.source === 'ical_import' ? 'ics' : 'ai';

      var removeBtn = document.createElement('button');
      removeBtn.className = 'busy-block-remove';
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      (function (bid) {
        removeBtn.addEventListener('click', function () { deleteBusyBlock(bid); });
      })(block.id);

      item.appendChild(info);
      item.appendChild(srcBadge);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

  function bindIcalImport() {
    var importBtn  = document.getElementById('ical-import-btn');
    var fileInput  = document.getElementById('ical-import-file');
    var statusEl   = document.getElementById('import-status');
    if (!importBtn || !fileInput) return;

    importBtn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', async function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      fileInput.value = '';

      if (statusEl) { statusEl.textContent = 'Importing\u2026'; statusEl.className = 'import-status'; }
      importBtn.disabled = true;

      try {
        var text = await file.text();
        var result = await getJson('/.netlify/functions/ical-import', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ icsContent: text })
        });

        if (result.data.ok) {
          var n = result.data.imported || 0;
          if (statusEl) {
            statusEl.textContent = n + ' event' + (n === 1 ? '' : 's') + ' imported' +
              (result.data.skipped ? ' (' + result.data.skipped + ' outside window or cancelled)' : '') + '.';
            statusEl.className = 'import-status ok';
          }
          if (result.data.batch_id) {
            lastImportBatchId = result.data.batch_id;
          }
          await loadBusyBlocks();
        } else {
          var reason = result.data.reason || 'unknown';
          var msg = reason === 'invalid_ics_format' ? 'Not a valid .ics file.'
                  : reason === 'file_too_large'     ? 'File too large (max 800 KB).'
                  : reason === 'block_limit_reached' ? 'Busy block limit reached. Remove some before importing more.'
                  : 'Import failed (' + reason + ').';
          if (statusEl) { statusEl.textContent = msg; statusEl.className = 'import-status err'; }
        }
      } catch (_) {
        if (statusEl) { statusEl.textContent = 'Import failed \u2014 check your connection.'; statusEl.className = 'import-status err'; }
      }

      importBtn.disabled = false;
    });
  }

  // ── Push subscription ─────────────────────────────────────────────────────────
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var output = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) {
      output[i] = rawData.charCodeAt(i);
    }
    return output;
  }

  async function enableNotifications() {
    var metaEl = document.querySelector('meta[name="vapid-public-key"]');
    if (!metaEl || !metaEl.content) return false;
    try {
      var permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
      var reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      }
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(metaEl.content)
      });
      await fetch('/.netlify/functions/push-subscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub)
      });
      return true;
    } catch (err) {
      console.error('Push subscription error:', err);
      return false;
    }
  }

  // ── Notification prompt ───────────────────────────────────────────────────────
  function checkNotificationPrompt() {
    var prompt = document.getElementById('notify-prompt');
    if (!prompt) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { return; }
    if (localStorage.getItem('tb_notify_dismissed') === '1') return;
    if (Notification.permission === 'denied' || Notification.permission === 'granted') return;
    prompt.style.display = 'flex';

    var enableBtn = document.getElementById('notify-enable');
    var dismissBtn = document.getElementById('notify-dismiss');
    if (enableBtn) {
      enableBtn.addEventListener('click', async function () {
        prompt.style.display = 'none';
        await enableNotifications();
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        prompt.style.display = 'none';
        localStorage.setItem('tb_notify_dismissed', '1');
      });
    }
  }

  // ── Calendar ─────────────────────────────────────────────────────────────────
  function renderCalendar() {
    var grid = document.getElementById('cal-grid');
    var monthLabel = document.getElementById('cal-month-label');
    if (!grid) return;
    if (monthLabel) monthLabel.textContent = formatMonthLabel(calMonth, calYear);
    grid.innerHTML = '';

    // Day-of-week headers
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'cal-day-label';
      el.textContent = d;
      grid.appendChild(el);
    });

    var firstDay = firstDayOfMonth(calMonth, calYear);
    var totalDays = daysInMonth(calMonth, calYear);
    var today = todayStr();

    // Build appointment date lookup
    var apptDates = {};
    cachedAppointments.forEach(function (a) {
      if (a.status === 'confirmed') {
        apptDates[a.scheduled_date] = (apptDates[a.scheduled_date] || 0) + 1;
      }
    });

    // Prev-month padding
    var prevTotal = daysInMonth(calMonth === 0 ? 11 : calMonth - 1, calMonth === 0 ? calYear - 1 : calYear);
    for (var i = 0; i < firstDay; i++) {
      var el = document.createElement('div');
      el.className = 'cal-day other-month';
      el.textContent = prevTotal - firstDay + 1 + i;
      grid.appendChild(el);
    }

    // Current-month days
    for (var day = 1; day <= totalDays; day++) {
      var dateStr = calYear + '-' + padTwo(calMonth + 1) + '-' + padTwo(day);
      var cls = 'cal-day';
      if (dateStr === today) cls += ' today';
      if (dateStr === selectedDate) cls += ' selected';
      var cell = document.createElement('div');
      cell.className = cls;
      var num = document.createElement('span');
      num.textContent = day;
      cell.appendChild(num);
      if (apptDates[dateStr]) {
        var dot = document.createElement('span');
        dot.className = 'cal-dot' + (apptDates[dateStr] > 1 ? ' has-multiple' : '');
        cell.appendChild(dot);
      }
      (function (ds) {
        cell.addEventListener('click', function () {
          selectedDate = ds;
          renderCalendar();
          renderDayDetail(ds);
        });
      })(dateStr);
      grid.appendChild(cell);
    }

    // Next-month padding
    var used = firstDay + totalDays;
    var fill = used <= 35 ? 35 - used : 42 - used;
    for (var j = 1; j <= fill; j++) {
      var el = document.createElement('div');
      el.className = 'cal-day other-month';
      el.textContent = j;
      grid.appendChild(el);
    }
  }

  function renderDayDetail(dateStr) {
    var container = document.getElementById('day-detail');
    if (!container) return;

    var appts = cachedAppointments
      .filter(function (a) { return a.scheduled_date === dateStr; })
      .sort(function (a, b) { return (a.scheduled_time || '').localeCompare(b.scheduled_time || ''); });

    container.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'day-detail-header';
    var dateLabel = document.createElement('span');
    dateLabel.className = 'day-detail-date';
    dateLabel.textContent = formatDateLabel(dateStr);
    var addBtn = document.createElement('button');
    addBtn.className = 'day-add-btn';
    addBtn.title = 'Book on this day';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', function () {
      var ta = document.getElementById('sched-message');
      if (ta) { ta.value = 'Book an appointment on ' + formatDateLabel(dateStr) + ' — '; ta.focus(); }
    });
    header.appendChild(dateLabel);
    header.appendChild(addBtn);
    container.appendChild(header);

    if (appts.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = 'No appointments';
      container.appendChild(empty);
      return;
    }

    appts.forEach(function (appt) {
      var card = document.createElement('div');
      card.className = 'appt-card';
      var row = document.createElement('div');
      row.className = 'appt-card-row';

      var timeCol = document.createElement('div');
      timeCol.className = 'appt-time-col';
      var timeEl = document.createElement('div');
      timeEl.className = 'appt-time';
      timeEl.textContent = appt.scheduled_time || '';
      timeCol.appendChild(timeEl);
      if (appt.duration_minutes) {
        var durEl = document.createElement('div');
        durEl.className = 'appt-dur';
        durEl.textContent = appt.duration_minutes + ' min';
        timeCol.appendChild(durEl);
      }

      var bar = document.createElement('div');
      bar.className = 'appt-bar ' + (appt.status || 'confirmed');

      var info = document.createElement('div');
      info.className = 'appt-info';
      var titleEl = document.createElement('div');
      titleEl.className = 'appt-title' + (appt.status === 'cancelled' ? ' cancelled' : '');
      titleEl.textContent = appt.title || 'Appointment';
      info.appendChild(titleEl);
      if (appt.client_name) {
        var clientEl = document.createElement('div');
        clientEl.className = 'appt-client';
        clientEl.textContent = appt.client_name;
        info.appendChild(clientEl);
      }

      var badge = document.createElement('span');
      badge.className = 'appt-status-badge ' + (appt.status || 'confirmed');
      badge.textContent = appt.status || 'confirmed';

      row.appendChild(timeCol);
      row.appendChild(bar);
      row.appendChild(info);
      row.appendChild(badge);
      card.appendChild(row);
      var calDrop = buildCalendarDropdown(appt);
      if (calDrop) card.appendChild(calDrop);
      container.appendChild(card);
    });
  }

  function navigateMonth(delta) {
    calMonth += delta;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calMonth < 0)  { calMonth = 11; calYear--; }
    renderCalendar();
  }

  // ── Sidebar sub-tabs ─────────────────────────────────────────────────────────
  function showSidebarPanel(name) {
    document.querySelectorAll('.sidebar-panel').forEach(function (p) { p.classList.remove('active'); });
    var target = document.getElementById('sidebar-' + name);
    if (target) target.classList.add('active');
    document.querySelectorAll('.sidebar-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-sidebar-panel') === name);
    });
  }

  // ── Working Hours ─────────────────────────────────────────────────────────────
  var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function renderWorkingHours() {
    var list = document.getElementById('wh-list');
    if (!list) return;
    var wh = (cachedProfile && cachedProfile.working_hours) ? cachedProfile.working_hours : {};
    list.innerHTML = '';
    var keys = Object.keys(wh).sort(function (a, b) { return Number(a) - Number(b); });
    if (keys.length === 0) {
      list.innerHTML = '<div class="day-empty">No working hours set. Add below.</div>';
      return;
    }
    keys.forEach(function (key) {
      var slot = wh[key];
      var el = document.createElement('div');
      el.className = 'wh-slot';
      el.innerHTML =
        '<div><div class="wh-day">' + escapeHtml(DAY_NAMES[Number(key)] || 'Day ' + key) + '</div>' +
        '<div class="wh-time">' + escapeHtml(slot.start) + ' \u2013 ' + escapeHtml(slot.end) + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'wh-remove';
      btn.textContent = 'Remove';
      (function (k) {
        btn.addEventListener('click', async function () {
          var updated = Object.assign({}, cachedProfile.working_hours);
          delete updated[k];
          await saveBusinessProfile({ working_hours: updated });
          renderWorkingHours();
        });
      })(key);
      el.appendChild(btn);
      list.appendChild(el);
    });
  }

  function renderSlotDurationSetting() {
    var container = document.getElementById('slot-dur-container');
    if (!container) return;
    container.innerHTML = '';

    var label = document.createElement('div');
    label.className = 'wh-section-label';
    label.style.marginTop = '1rem';
    label.style.fontWeight = '600';
    label.textContent = 'Slot Duration';

    var row = document.createElement('div');
    row.className = 'slot-dur-row';
    row.style.display = 'flex'; row.style.gap = '0.5rem'; row.style.marginTop = '0.4rem'; row.style.alignItems = 'center';

    var sel = document.createElement('select');
    sel.id = 'slot-dur-select';
    sel.className = 'wh-select';
    [15, 30, 45, 60, 90].forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = v + ' min';
      if ((cachedProfile && cachedProfile.slot_duration_min || 30) === v) opt.selected = true;
      sel.appendChild(opt);
    });

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'svc-btn'; saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026';
      await saveBusinessProfile({ slot_duration_min: Number(sel.value) });
      saveBtn.disabled = false; saveBtn.textContent = 'Saved';
      setTimeout(function () { saveBtn.textContent = 'Save'; }, 1500);
    });

    row.appendChild(sel);
    row.appendChild(saveBtn);
    container.appendChild(label);
    container.appendChild(row);
  }

  function populateProfilePanel() {
    var p = cachedProfile || {};
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
    set('prof-first-name', p.owner_first_name);
    set('prof-full-name',  p.owner_full_name);
    set('prof-biz-name',   p.business_name);
    set('prof-phone',      p.business_phone);
    set('prof-city',       p.city);
    set('prof-website',    p.website);
    set('prof-abn',        p.abn);

    var av = document.getElementById('settings-avatar');
    var headerAv = document.getElementById('app-avatar');
    if (av) {
      if (p.avatar_data) {
        av.innerHTML = '<img src="' + p.avatar_data + '" alt="avatar" style="width:100%;height:100%;object-fit:cover">';
      } else if (p.owner_first_name) {
        av.textContent = p.owner_first_name.charAt(0).toUpperCase();
      } else {
        av.textContent = 'TB';
      }
    }
    if (headerAv) {
      if (p.avatar_data) {
        headerAv.innerHTML = '<img src="' + p.avatar_data + '" alt="avatar">';
      } else if (p.owner_first_name) {
        headerAv.textContent = p.owner_first_name.charAt(0).toUpperCase();
      } else {
        headerAv.textContent = 'TB';
      }
    }
  }

  function bindProfilePanel() {
    var uploadBtn  = document.getElementById('avatar-upload-btn');
    var fileInput  = document.getElementById('avatar-file-input');
    var saveBtn    = document.getElementById('prof-save-btn');
    var statusEl   = document.getElementById('prof-status');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        if (file.size > 200000) {
          if (statusEl) statusEl.textContent = 'Image too large (max 200 KB).';
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        var ctx = canvas.getContext('2d');
        var img = new window.Image();
        img.onload = async function () {
          var size = Math.min(img.width, img.height);
          var ox = (img.width  - size) / 2;
          var oy = (img.height - size) / 2;
          ctx.drawImage(img, ox, oy, size, size, 0, 0, 256, 256);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          var av = document.getElementById('settings-avatar');
          if (av) av.innerHTML = '<img src="' + dataUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover">';
          var headerAv = document.getElementById('app-avatar');
          if (headerAv) headerAv.innerHTML = '<img src="' + dataUrl + '" alt="avatar">';
          await saveBusinessProfile({ avatar_data: dataUrl });
          if (statusEl) { statusEl.textContent = 'Photo saved.'; setTimeout(function () { statusEl.textContent = ''; }, 2000); }
        };
        img.src = URL.createObjectURL(file);
        fileInput.value = '';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026';
        var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
        await saveBusinessProfile({
          owner_first_name: get('prof-first-name') || null,
          owner_full_name:  get('prof-full-name')  || null,
          business_name:    get('prof-biz-name')   || null,
          business_phone:   get('prof-phone')       || null,
          city:             get('prof-city')        || null,
          website:          get('prof-website')     || null,
          abn:              get('prof-abn')         || null,
        });
        saveBtn.disabled = false; saveBtn.textContent = 'Saved';
        setTimeout(function () { saveBtn.textContent = 'Save'; }, 1500);
        if (statusEl) { statusEl.textContent = 'Profile saved.'; setTimeout(function () { statusEl.textContent = ''; }, 2000); }
      });
    }

    populateProfilePanel();
  }

  function bindWorkingHoursForm() {
    var form = document.getElementById('wh-add-form');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var dayEl   = form.querySelector('[name="wh-day"]');
      var startEl = form.querySelector('[name="wh-start"]');
      var endEl   = form.querySelector('[name="wh-end"]');
      var addBtn  = form.querySelector('button[type="submit"]');
      if (!dayEl || !startEl || !endEl || !startEl.value || !endEl.value) return;
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding\u2026'; }
      var wh = (cachedProfile && cachedProfile.working_hours) ? Object.assign({}, cachedProfile.working_hours) : {};
      wh[dayEl.value] = { start: startEl.value, end: endEl.value };
      await saveBusinessProfile({ working_hours: wh });
      startEl.value = '09:00';
      endEl.value = '17:00';
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add'; }
      renderWorkingHours();
    });
  }

  // ── Services ──────────────────────────────────────────────────────────────────
  function buildServiceForm(svc) {
    var row = document.createElement('div');
    row.className = 'svc-row';

    var nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.className = 'svc-new-name'; nameInput.placeholder = 'Service name'; nameInput.maxLength = 100;
    if (svc) nameInput.value = svc.title;

    var durInput = document.createElement('input');
    durInput.type = 'number'; durInput.className = 'svc-new-dur'; durInput.placeholder = 'Duration (min)'; durInput.min = 15; durInput.step = 15;
    if (svc) durInput.value = svc.duration_min;

    var priceInput = document.createElement('input');
    priceInput.type = 'number'; priceInput.className = 'svc-new-price'; priceInput.placeholder = 'Price (optional)'; priceInput.min = 0; priceInput.step = '0.01';
    if (svc && svc.price != null) priceInput.value = svc.price;

    var bufferInput = document.createElement('input');
    bufferInput.type = 'number'; bufferInput.className = 'svc-new-buffer'; bufferInput.placeholder = 'Buffer (min)'; bufferInput.min = 0; bufferInput.max = 240; bufferInput.value = (svc ? svc.buffer_time_min : 0) || 0;

    var descInput = document.createElement('input');
    descInput.type = 'text'; descInput.className = 'svc-new-desc'; descInput.placeholder = 'Description (optional)'; descInput.maxLength = 500;
    if (svc && svc.description) descInput.value = svc.description;

    var errEl = document.createElement('div');
    errEl.className = 'svc-error'; errEl.style.color = 'var(--warn, #f87171)'; errEl.style.fontSize = '0.75rem';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'svc-row-save'; saveBtn.textContent = 'Save';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'svc-row-remove svc-row-cancel'; cancelBtn.textContent = '\u00d7';

    row.appendChild(nameInput);
    row.appendChild(durInput);
    row.appendChild(priceInput);
    row.appendChild(bufferInput);
    row.appendChild(descInput);
    row.appendChild(errEl);
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);

    return { row, nameInput, durInput, priceInput, bufferInput, descInput, errEl, saveBtn, cancelBtn };
  }

  function renderServices() {
    var container = document.getElementById('svc-list');
    if (!container) return;
    container.innerHTML = '';

    cachedServices.forEach(function (svc) {
      var item = document.createElement('div');
      item.className = 'svc-item';

      var header = document.createElement('div');
      header.className = 'svc-header';

      var titleEl = document.createElement('div');
      titleEl.className = 'svc-name';
      titleEl.textContent = svc.title;

      var metaParts = [svc.duration_min + ' min'];
      if (svc.price != null) metaParts.push('$' + Number(svc.price).toFixed(2));
      if (svc.buffer_time_min > 0) metaParts.push('buffer: ' + svc.buffer_time_min + 'min');
      var metaEl = document.createElement('div');
      metaEl.className = 'svc-dur';
      metaEl.textContent = metaParts.join('  ·  ');

      header.appendChild(titleEl);
      header.appendChild(metaEl);
      item.appendChild(header);

      if (svc.description) {
        var descEl = document.createElement('div');
        descEl.className = 'svc-desc';
        descEl.textContent = svc.description;
        item.appendChild(descEl);
      }

      var actions = document.createElement('div');
      actions.className = 'svc-actions';

      var editBtn = document.createElement('button');
      editBtn.className = 'svc-btn';
      editBtn.textContent = 'Edit';
      (function (s, itemEl) {
        editBtn.addEventListener('click', function () {
          var f = buildServiceForm(s);
          itemEl.replaceWith(f.row);
          f.cancelBtn.addEventListener('click', function () {
            f.row.replaceWith(itemEl);
          });
          f.saveBtn.addEventListener('click', async function () {
            var dur = parseInt(f.durInput.value, 10);
            if (!f.nameInput.value.trim()) { f.errEl.textContent = 'Name required.'; return; }
            if (!dur || dur % 15 !== 0) { f.errEl.textContent = 'Duration must be a multiple of 15 (e.g. 15, 30, 45, 60).'; return; }
            f.saveBtn.disabled = true; f.saveBtn.textContent = 'Saving\u2026';
            try {
              var res = await fetch('/.netlify/functions/services?id=' + encodeURIComponent(s.id), {
                method: 'PATCH', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  title:          f.nameInput.value.trim(),
                  duration_min:   dur,
                  price:          f.priceInput.value !== '' ? Number(f.priceInput.value) : null,
                  buffer_time_min: Number(f.bufferInput.value) || 0,
                  description:    f.descInput.value.trim() || null,
                }),
              });
              var data = await res.json();
              if (data.ok) { await loadServices(); renderServices(); }
              else { f.errEl.textContent = data.reason || 'Save failed.'; f.saveBtn.disabled = false; f.saveBtn.textContent = 'Save'; }
            } catch (_) { f.errEl.textContent = 'Request failed.'; f.saveBtn.disabled = false; f.saveBtn.textContent = 'Save'; }
          });
        });
      })(svc, item);

      var removeBtn = document.createElement('button');
      removeBtn.className = 'svc-btn';
      removeBtn.textContent = 'Remove';
      (function (id) {
        removeBtn.addEventListener('click', async function () {
          removeBtn.disabled = true; removeBtn.textContent = 'Removing\u2026';
          try {
            await fetch('/.netlify/functions/services?id=' + encodeURIComponent(id), {
              method: 'DELETE', credentials: 'same-origin'
            });
            await loadServices(); renderServices();
          } catch (_) { removeBtn.disabled = false; removeBtn.textContent = 'Remove'; }
        });
      })(svc.id);

      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);
      item.appendChild(actions);
      container.appendChild(item);
    });

    var addBtn = document.createElement('button');
    addBtn.className = 'add-svc-btn';
    addBtn.textContent = '+ Add service';
    addBtn.addEventListener('click', function () {
      addBtn.style.display = 'none';
      var f = buildServiceForm(null);
      container.insertBefore(f.row, addBtn);
      f.cancelBtn.addEventListener('click', function () {
        f.row.remove();
        addBtn.style.display = '';
      });
      f.saveBtn.addEventListener('click', async function () {
        var dur = parseInt(f.durInput.value, 10);
        if (!f.nameInput.value.trim()) { f.errEl.textContent = 'Name required.'; return; }
        if (!dur || dur % 15 !== 0) { f.errEl.textContent = 'Duration must be a multiple of 15 (e.g. 15, 30, 45, 60).'; return; }
        f.saveBtn.disabled = true; f.saveBtn.textContent = 'Adding\u2026';
        try {
          var res = await fetch('/.netlify/functions/services', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              title:          f.nameInput.value.trim(),
              duration_min:   dur,
              price:          f.priceInput.value !== '' ? Number(f.priceInput.value) : null,
              buffer_time_min: Number(f.bufferInput.value) || 0,
              description:    f.descInput.value.trim() || null,
            }),
          });
          var data = await res.json();
          if (data.ok) { await loadServices(); renderServices(); }
          else { f.errEl.textContent = data.reason || 'Save failed.'; f.saveBtn.disabled = false; f.saveBtn.textContent = 'Save'; addBtn.style.display = ''; }
        } catch (_) { f.errEl.textContent = 'Request failed.'; f.saveBtn.disabled = false; f.saveBtn.textContent = 'Save'; }
      });
    });
    container.appendChild(addBtn);
  }

  // ── Client Booking Link ────────────────────────────────────────────────────────
  function renderBookingLink() {
    var container = document.getElementById('booking-link-section');
    if (!container) return;
    container.innerHTML = '';

    var slug = (cachedProfile && cachedProfile.booking_slug) ? cachedProfile.booking_slug : null;

    if (slug) {
      var bookingUrl = 'https://textboss.com.au/book.html?owner=' + encodeURIComponent(slug);
      var urlEl = document.createElement('div');
      urlEl.className = 'booking-link-url';
      urlEl.textContent = bookingUrl;
      container.appendChild(urlEl);

      var copyBtn = document.createElement('button');
      copyBtn.className = 'booking-link-copy';
      copyBtn.textContent = 'Copy Link';
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(bookingUrl).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy Link'; }, 2000);
        }).catch(function () {
          // Fallback: select text
          var ta = document.createElement('textarea');
          ta.value = bookingUrl;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy Link'; }, 2000);
        });
      });
      container.appendChild(copyBtn);
    } else {
      var genBtn = document.createElement('button');
      genBtn.className = 'booking-link-generate';
      genBtn.textContent = 'Generate Booking Link';
      genBtn.addEventListener('click', async function () {
        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';
        var ok = await saveBusinessProfile({ generateSlug: true });
        if (ok) {
          renderBookingLink();
        } else {
          genBtn.disabled = false;
          genBtn.textContent = 'Generate Booking Link';
        }
      });
      container.appendChild(genBtn);
    }
  }

  // ── Onboarding wizard ─────────────────────────────────────────────────────────
  function showWizard() {
    var overlay = document.getElementById('wizard-overlay');
    if (overlay) overlay.classList.remove('hidden');
    wizStep = 1;
    wizData = {
      firstName: '', fullName: '', businessName: '', businessPhone: '',
      businessEmail: '', website: '', abn: '', city: '',
      occupation: '',
      services: [{ name: '', duration_min: 60, price: null }],
      bufferBefore: 15, bufferAfter: 15
    };
    renderWizardStep();
  }

  function hideWizard() {
    var overlay = document.getElementById('wizard-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function renderWizardStep() {
    var stepIndicator = document.getElementById('wizard-steps');
    var titleEl = document.getElementById('wizard-title');
    var subEl = document.getElementById('wizard-sub');
    var bodyEl = document.getElementById('wizard-body');
    var nextBtn = document.getElementById('wizard-next');
    if (!bodyEl) return;

    if (stepIndicator) {
      stepIndicator.innerHTML = '';
      for (var i = 1; i <= 4; i++) {
        var dot = document.createElement('div');
        dot.className = 'wizard-step-dot' + (i < wizStep ? ' done' : i === wizStep ? ' active' : '');
        stepIndicator.appendChild(dot);
      }
    }

    if (wizStep === 1) {
      if (titleEl) titleEl.textContent = 'Tell us about yourself';
      if (subEl) subEl.textContent = 'This fills in your prompt templates automatically so you rarely have to type your details again.';
      if (nextBtn) nextBtn.textContent = 'Next \u2192';
      bodyEl.innerHTML =
        '<div class="wizard-field"><label>First name</label>' +
        '<input type="text" id="wiz-first-name" placeholder="Jane" maxlength="100" value="' + escapeHtml(wizData.firstName) + '"></div>' +
        '<div class="wizard-field"><label>Full name</label>' +
        '<input type="text" id="wiz-full-name" placeholder="Jane Smith" maxlength="200" value="' + escapeHtml(wizData.fullName) + '"></div>' +
        '<div class="wizard-field"><label>Business name</label>' +
        '<input type="text" id="wiz-biz-name" placeholder="Jane\'s Salon" maxlength="200" value="' + escapeHtml(wizData.businessName) + '"></div>' +
        '<div class="wizard-field"><label>Business phone</label>' +
        '<input type="text" id="wiz-biz-phone" placeholder="+61 4xx xxx xxx" maxlength="40" value="' + escapeHtml(wizData.businessPhone) + '"></div>' +
        '<div class="wizard-field"><label>Business email <span style="color:#52606d;font-weight:400">(optional)</span></label>' +
        '<input type="email" id="wiz-biz-email" placeholder="hello@yourbusiness.com" maxlength="200" value="' + escapeHtml(wizData.businessEmail) + '"></div>' +
        '<div class="wizard-field"><label>City</label>' +
        '<input type="text" id="wiz-city" placeholder="Melbourne" maxlength="100" value="' + escapeHtml(wizData.city) + '"></div>' +
        '<div class="wizard-field"><label>Website <span style="color:#52606d;font-weight:400">(optional)</span></label>' +
        '<input type="text" id="wiz-website" placeholder="https://yourbusiness.com" maxlength="200" value="' + escapeHtml(wizData.website) + '"></div>' +
        '<div class="wizard-field"><label>ABN <span style="color:#52606d;font-weight:400">(optional)</span></label>' +
        '<input type="text" id="wiz-abn" placeholder="12 345 678 901" maxlength="20" value="' + escapeHtml(wizData.abn) + '"></div>';

    } else if (wizStep === 2) {
      if (titleEl) titleEl.textContent = 'What do you do?';
      if (subEl) subEl.textContent = 'Your occupation helps the AI give relevant scheduling advice.';
      if (nextBtn) nextBtn.textContent = 'Next \u2192';
      bodyEl.innerHTML =
        '<div class="wizard-field"><label>Your occupation</label>' +
        '<input type="text" id="wiz-occupation" placeholder="e.g. Mobile Hairdresser, Plumber, Personal Trainer" value="' + escapeHtml(wizData.occupation) + '"></div>';

    } else if (wizStep === 3) {
      if (titleEl) titleEl.textContent = 'What services do you offer?';
      if (subEl) subEl.textContent = 'Add the services you book. Durations must be multiples of 15 min. Price is optional.';
      if (nextBtn) nextBtn.textContent = 'Next \u2192';
      var html = '<div id="wiz-svc-list">';
      wizData.services.forEach(function (svc, i) {
        html +=
          '<div class="svc-row">' +
          '<input type="text" class="wiz-svc-name" placeholder="Service name" value="' + escapeHtml(svc.name) + '">' +
          '<input type="number" class="wiz-svc-dur" placeholder="Min" min="15" step="15" value="' + escapeHtml(String(svc.duration_min || '')) + '">' +
          '<input type="number" class="wiz-svc-price" placeholder="Price (opt)" min="0" step="0.01" value="' + escapeHtml(svc.price != null ? String(svc.price) : '') + '">' +
          '<button class="svc-row-remove" type="button" data-idx="' + i + '">&times;</button></div>';
      });
      html += '</div><div id="wiz-svc-error" style="color:#ef4444;font-size:12px;margin-top:6px;display:none"></div>';
      html += '<button class="add-svc-btn" id="wiz-add-svc" type="button">+ Add service</button>';
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('.svc-row-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          saveWizardStep3();
          wizData.services.splice(idx, 1);
          renderWizardStep();
        });
      });
      var addSvcBtn = document.getElementById('wiz-add-svc');
      if (addSvcBtn) {
        addSvcBtn.addEventListener('click', function () {
          saveWizardStep3();
          wizData.services.push({ name: '', duration_min: 30, price: null });
          renderWizardStep();
        });
      }

    } else if (wizStep === 4) {
      if (titleEl) titleEl.textContent = 'Buffer times';
      if (subEl) subEl.textContent = 'How much travel or prep time do you need around appointments?';
      if (nextBtn) nextBtn.textContent = 'Finish';
      bodyEl.innerHTML =
        '<div class="buffer-row">' +
        '<div class="buffer-field"><label>Before appointment</label>' +
        '<div class="buffer-input-wrap"><input type="number" id="wiz-buf-before" min="0" step="5" value="' + wizData.bufferBefore + '"><span class="buffer-unit">min</span></div></div>' +
        '<div class="buffer-field"><label>After appointment</label>' +
        '<div class="buffer-input-wrap"><input type="number" id="wiz-buf-after" min="0" step="5" value="' + wizData.bufferAfter + '"><span class="buffer-unit">min</span></div></div>' +
        '</div>';
    }
  }

  function saveWizardStep1() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    wizData.firstName     = g('wiz-first-name');
    wizData.fullName      = g('wiz-full-name');
    wizData.businessName  = g('wiz-biz-name');
    wizData.businessPhone = g('wiz-biz-phone');
    wizData.businessEmail = g('wiz-biz-email');
    wizData.city          = g('wiz-city');
    wizData.website       = g('wiz-website');
    wizData.abn           = g('wiz-abn');
  }

  function saveWizardStep2() {
    var el = document.getElementById('wiz-occupation');
    if (el) wizData.occupation = el.value.trim();
  }

  function saveWizardStep3() {
    var rows = document.querySelectorAll('#wiz-svc-list .svc-row');
    wizData.services = Array.from(rows).map(function (row) {
      var nameEl  = row.querySelector('.wiz-svc-name');
      var durEl   = row.querySelector('.wiz-svc-dur');
      var priceEl = row.querySelector('.wiz-svc-price');
      var dur = parseInt(durEl ? durEl.value : '', 10) || 30;
      dur = Math.max(15, Math.round(dur / 15) * 15);
      var price = priceEl && priceEl.value !== '' ? parseFloat(priceEl.value) : null;
      return {
        name:         nameEl ? nameEl.value.trim() : '',
        duration_min: dur,
        price:        (price !== null && !isNaN(price) && price >= 0) ? price : null,
      };
    });
  }

  async function saveWizardServicesToRelational(services) {
    var valid = services.filter(function (s) { return s.name && s.duration_min >= 15; });
    var results = [];
    for (var i = 0; i < valid.length; i++) {
      var s = valid[i];
      try {
        var res = await fetch('/.netlify/functions/services', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title:        s.name,
            duration_min: s.duration_min,
            price:        s.price,
            sort_order:   i,
          }),
        });
        var data = await res.json();
        if (data.ok) results.push(data.service);
      } catch (_) {}
    }
    return results;
  }

  function saveWizardStep4() {
    var bb = document.getElementById('wiz-buf-before');
    var ba = document.getElementById('wiz-buf-after');
    if (bb) wizData.bufferBefore = parseInt(bb.value, 10) || 0;
    if (ba) wizData.bufferAfter  = parseInt(ba.value, 10) || 0;
  }

  function bindWizardButtons() {
    var nextBtn = document.getElementById('wizard-next');
    var skipBtn = document.getElementById('wizard-skip');
    if (nextBtn) {
      nextBtn.addEventListener('click', async function () {
        if (wizStep === 1) {
          saveWizardStep1();
          wizStep++;
          renderWizardStep();
        } else if (wizStep === 2) {
          saveWizardStep2();
          wizStep++;
          renderWizardStep();
        } else if (wizStep === 3) {
          saveWizardStep3();
          wizStep++;
          renderWizardStep();
        } else if (wizStep === 4) {
          saveWizardStep4();
          nextBtn.disabled = true;
          nextBtn.textContent = 'Saving\u2026';
          // Save services to relational table
          var svcsToSave = wizData.services.filter(function (s) { return s.name; });
          if (svcsToSave.length > 0) {
            await saveWizardServicesToRelational(svcsToSave);
          }
          var ok = await saveBusinessProfile({
            owner_first_name:      wizData.firstName     || null,
            owner_full_name:       wizData.fullName      || null,
            business_name:         wizData.businessName  || null,
            business_phone:        wizData.businessPhone || null,
            website:               wizData.website       || null,
            abn:                   wizData.abn           || null,
            city:                  wizData.city          || null,
            occupation:            wizData.occupation,
            buffer_before_minutes: wizData.bufferBefore,
            buffer_after_minutes:  wizData.bufferAfter,
            onboarding_complete:   true
          });
          nextBtn.disabled = false;
          nextBtn.textContent = 'Finish';
          if (ok) {
            hideWizard();
            renderWorkingHours();
            renderServices();
          } else {
            var errEl = document.getElementById('wizard-save-error');
            if (!errEl) {
              errEl = document.createElement('p');
              errEl.id = 'wizard-save-error';
              errEl.style.cssText = 'color:#ef4444;font-size:12px;margin-top:10px;text-align:center;';
              var footer = document.querySelector('.wizard-footer');
              if (footer) footer.insertAdjacentElement('afterbegin', errEl);
            }
            errEl.textContent = 'Save failed \u2014 check your connection and try again.';
          }
        }
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', async function () {
        await saveBusinessProfile({ onboarding_complete: true });
        hideWizard();
      });
    }
  }

  // ── Action chips ──────────────────────────────────────────────────────────────
  function renderActionChip(action, container) {
    var tool = action.tool || '';
    var icon, label, cls;
    if (tool === 'book_appointment' || tool === 'create_appointment') {
      icon = '\u2713'; label = 'Appointment created'; cls = 'chip-green';
    } else if (tool === 'cancel_appointment') {
      icon = '\u2715'; label = 'Appointment cancelled'; cls = 'chip-red';
    } else if (tool === 'reschedule_appointment') {
      icon = '\u21bb'; label = 'Appointment updated'; cls = 'chip-amber';
    } else if (tool === 'add_busy_block') {
      var n = (action.result && action.result.blocked) ? action.result.blocked : 1;
      icon = '\uD83D\uDEAB'; label = n + ' time ' + (n === 1 ? 'block' : 'blocks') + ' added'; cls = 'chip-amber';
      // Reload busy block list so sidebar updates immediately
      loadBusyBlocks();
    } else {
      return;
    }
    var chip = document.createElement('div');
    chip.className = 'action-chip ' + cls;
    chip.innerHTML = '<span class="chip-icon">' + icon + '</span> ' + label;
    container.appendChild(chip);
  }

  // ── Scheduler chat ────────────────────────────────────────────────────────────
  function appendSchedulerMessage(role, text, actions) {
    var threadNode = document.getElementById('sched-output');
    if (!threadNode) return null;
    var isAI = role !== 'user';
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (isAI ? 'msg-ai' : 'msg-user');

    var label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = isAI ? 'SCHEDULER' : 'you';
    wrap.appendChild(label);

    var bubble = document.createElement('div');
    bubble.className = 'msg-text';
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (isAI && actions && actions.length > 0) {
      var chipsRow = document.createElement('div');
      chipsRow.className = 'action-chips';
      actions.forEach(function (a) { renderActionChip(a, chipsRow); });
      wrap.appendChild(chipsRow);
    }

    if (isAI) {
      var copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () {
            copyBtn.textContent = '\u2713 Copied';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
          });
        }
      });
      wrap.appendChild(copyBtn);
    }

    threadNode.appendChild(wrap);
    threadNode.scrollTop = threadNode.scrollHeight;
    return wrap;
  }

  function showSchedulerTyping() {
    var threadNode = document.getElementById('sched-output');
    if (!threadNode) return null;
    var wrap = document.createElement('div');
    wrap.className = 'msg msg-ai msg-typing';
    var label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = 'SCHEDULER';
    var bubble = document.createElement('div');
    bubble.className = 'msg-text';
    bubble.innerHTML = "<span class='tdot'></span><span class='tdot'></span><span class='tdot'></span>";
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    threadNode.appendChild(wrap);
    threadNode.scrollTop = threadNode.scrollHeight;
    return wrap;
  }

  function bindSchedulerChat() {
    var schedForm = document.getElementById('sched-form');
    var schedMessage = document.getElementById('sched-message');
    var schedStatus = document.getElementById('sched-status');
    var schedCharCount = document.getElementById('sched-char-count');
    if (!schedForm) return;

    schedForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (schedBusy) return;
      var message = String(schedMessage.value || '').trim();
      if (!message) { schedStatus.textContent = 'Enter a message first.'; return; }
      if (message.length > _inputLimit) {
        schedStatus.textContent = 'Too long \u2014 ' + message.length + '/' + _inputLimit + ' chars max.';
        return;
      }

      schedBusy = true;
      appendSchedulerMessage('user', message);
      schedMessage.value = '';
      schedMessage.style.height = 'auto';
      if (schedCharCount) { schedCharCount.textContent = ''; schedCharCount.className = 'char-count'; }
      schedStatus.textContent = 'Scheduling\u2026';

      var typing = showSchedulerTyping();
      var historySnapshot = schedConversation.slice();
      schedConversation.push({ role: 'user', content: [{ type: 'input_text', text: message }] });

      try {
        var result = await getJson('/.netlify/functions/schedule-chat', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: message, conversation: historySnapshot })
        });
        if (typing) typing.remove();
        if (!result.data.ok) {
          schedConversation.pop();
          if (result.data.denied) {
            window.location.href = '/access.html';
            return;
          }
          schedStatus.textContent = 'Error: ' + (result.data.reason || 'unknown');
          schedBusy = false;
          return;
        }
        var output = result.data.output || '';
        var actions = result.data.actions || [];
        appendSchedulerMessage('assistant', output, actions);
        schedConversation.push({ role: 'assistant', content: [{ type: 'output_text', text: output }] });
        schedStatus.textContent = 'Ready.';
        if (actions.length > 0) await loadAppointments();
      } catch (_) {
        if (typing) typing.remove();
        schedConversation.pop();
        schedStatus.textContent = 'Request failed \u2014 check your connection.';
      }
      schedBusy = false;
    });

    schedMessage.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); schedForm.requestSubmit(); }
    });

    schedMessage.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
      if (schedCharCount) {
        var used = this.value.length;
        var remaining = _inputLimit - used;
        var threshold = Math.floor(_inputLimit * 0.25);
        if (used > 0 && remaining < threshold) {
          schedCharCount.textContent = remaining + ' chars remaining';
          schedCharCount.className = 'char-count' + (remaining < 200 ? ' warn' : '');
        } else {
          schedCharCount.textContent = '';
          schedCharCount.className = 'char-count';
        }
      }
    });
  }

  // ── Per-appointment "Add to Calendar" ────────────────────────────────────────
  function _padZ(n) { return n < 10 ? '0' + n : '' + n; }

  function buildCalendarDropdown(appt) {
    if (appt.status === 'cancelled') return null;
    var d    = (appt.scheduled_date || '').replace(/-/g, '');
    var tRaw = (appt.scheduled_time || '00:00').split(':');
    var h    = parseInt(tRaw[0], 10) || 0;
    var m    = parseInt(tRaw[1] || '0', 10) || 0;
    var dur  = appt.duration_minutes || 60;
    var eH   = Math.floor((h * 60 + m + dur) / 60) % 24;
    var eM   = (h * 60 + m + dur) % 60;
    var startDt = d + 'T' + _padZ(h) + _padZ(m) + '00';
    var endDt   = d + 'T' + _padZ(eH) + _padZ(eM) + '00';
    var title   = appt.title || appt.client_name || 'Appointment';
    var descr   = appt.client_name ? 'Client: ' + appt.client_name : '';

    var googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) +
      '&dates=' + startDt + '/' + endDt +
      (descr ? '&details=' + encodeURIComponent(descr) : '');

    var startIso = appt.scheduled_date + 'T' + _padZ(h) + ':' + _padZ(m) + ':00';
    var endIso   = appt.scheduled_date + 'T' + _padZ(eH) + ':' + _padZ(eM) + ':00';
    var outlookUrl = 'https://outlook.live.com/calendar/0/action/compose' +
      '?subject=' + encodeURIComponent(title) +
      '&startdt=' + encodeURIComponent(startIso) +
      '&enddt='   + encodeURIComponent(endIso) +
      (descr ? '&body=' + encodeURIComponent(descr) : '');

    var icsContent = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Text Boss//EN',
      'BEGIN:VEVENT',
      'DTSTART:' + startDt,
      'DTEND:'   + endDt,
      'SUMMARY:' + title,
      descr ? 'DESCRIPTION:' + descr : '',
      'UID:' + appt.id + '-single@textboss',
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    var wrap = document.createElement('div');
    wrap.className = 'cal-add-wrap';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-add-btn';
    btn.textContent = '+ Add to Calendar';

    var drop = document.createElement('div');
    drop.className = 'cal-dropdown';

    var gLink = document.createElement('a');
    gLink.href = googleUrl; gLink.target = '_blank'; gLink.rel = 'noopener noreferrer';
    gLink.textContent = 'Google Calendar';

    var oLink = document.createElement('a');
    oLink.href = outlookUrl; oLink.target = '_blank'; oLink.rel = 'noopener noreferrer';
    oLink.textContent = 'Outlook';

    var iLink = document.createElement('a');
    iLink.href = '#'; iLink.textContent = 'Apple / iCal (.ics)';
    iLink.addEventListener('click', function (e) {
      e.preventDefault();
      var blob = new Blob([icsContent], { type: 'text/calendar' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = 'appointment.ics';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    drop.appendChild(gLink);
    drop.appendChild(oLink);
    drop.appendChild(iLink);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = drop.classList.contains('open');
      document.querySelectorAll('.cal-dropdown.open').forEach(function (el) { el.classList.remove('open'); });
      if (!open) drop.classList.add('open');
    });

    wrap.appendChild(btn);
    wrap.appendChild(drop);
    return wrap;
  }

  // ── iCal export ──────────────────────────────────────────────────────────────
  function bindIcalExport() {
    if (!_enableIcalExport) return;
    var btn = document.getElementById('ical-export');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var confirmed = cachedAppointments.filter(function (a) { return a.status === 'confirmed'; });
      if (confirmed.length === 0) return;
      var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Text Boss//Black//EN'];
      confirmed.forEach(function (appt) {
        var dateStr = appt.scheduled_date.replace(/-/g, '');
        var timeStr = appt.scheduled_time.replace(/:/g, '') + '00';
        var dur = appt.duration_minutes || 60;
        var durH = Math.floor(dur / 60);
        var durM = dur % 60;
        var durStr = 'PT' + (durH > 0 ? durH + 'H' : '') + (durM > 0 ? durM + 'M' : '');
        if (!durStr || durStr === 'PT') durStr = 'PT1H';
        lines.push('BEGIN:VEVENT');
        lines.push('DTSTART:' + dateStr + 'T' + timeStr);
        lines.push('DURATION:' + durStr);
        lines.push('SUMMARY:' + (appt.title || appt.client_name || 'Appointment'));
        if (appt.client_name) lines.push('DESCRIPTION:Client: ' + appt.client_name);
        lines.push('UID:' + appt.id + '@textboss');
        lines.push('END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'textboss-appointments.ics';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    });
  }

  // ── Main init ─────────────────────────────────────────────────────────────────
  async function initScheduler(config) {
    _tier            = (config && config.tier)             || 'Pro';
    _inputLimit      = (config && config.inputLimit)       || 6000;
    _enableIcalExport = !!(config && config.enableIcalExport);

    // Block the form until fully initialised — prevents submit before handlers are bound
    var submitBtn = document.querySelector('#sched-form button[type="submit"]');
    var schedStatusEl = document.getElementById('sched-status');
    if (submitBtn) submitBtn.disabled = true;
    if (schedStatusEl) schedStatusEl.textContent = 'Loading\u2026';

    document.addEventListener('click', function () {
      document.querySelectorAll('.cal-dropdown.open').forEach(function (el) { el.classList.remove('open'); });
    });

    var now = new Date();
    calMonth = now.getMonth();
    calYear  = now.getFullYear();

    // Sidebar sub-tab buttons
    document.querySelectorAll('.sidebar-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        showSidebarPanel(tab.getAttribute('data-sidebar-panel'));
      });
    });

    // Calendar navigation
    var prevBtn = document.getElementById('cal-prev');
    var nextBtn = document.getElementById('cal-next');
    if (prevBtn) prevBtn.addEventListener('click', function () { navigateMonth(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { navigateMonth(1); });

    // Load data — profile first (needed for slot_duration_min), then rest in parallel
    await loadBusinessProfile();
    await Promise.all([loadAppointments(), loadBusyBlocks(), loadServices()]);

    // Onboarding check
    if (!cachedProfile || !cachedProfile.onboarding_complete) showWizard();

    // Render sidebar panels
    renderWorkingHours();
    renderSlotDurationSetting();
    renderServices();
    renderBookingLink();

    // Notification prompt
    checkNotificationPrompt();

    // Bind interactive elements
    bindWorkingHoursForm();
    bindSchedulerChat();
    bindWizardButtons();
    bindIcalExport();
    bindIcalImport();
    bindProfilePanel();

    // Unlock form now that all handlers are registered
    if (submitBtn) submitBtn.disabled = false;
    if (schedStatusEl) schedStatusEl.textContent = 'Ready.';
  }

  global.initScheduler = initScheduler;

  global.refreshScheduler = async function refreshScheduler() {
    await loadAppointments();
  };

  // Refresh badge when page regains visibility (e.g., returning from another app)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      loadAppointments();
    }
  });

  // Called on page load (before any tab is clicked) to immediately show wizard
  // if the user hasn't completed onboarding yet.
  global.checkOnboardingOnLoad = async function checkOnboardingOnLoad(opts) {
    try {
      var res = await fetch('/.netlify/functions/business-profile', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      var profile = data.profile || null;
      if (!profile || !profile.onboarding_complete) {
        // Ensure wizard HTML is in the DOM (app-core doesn't have it)
        var overlay = document.getElementById('wizard-overlay');
        if (!overlay) return;
        // Pre-seed wizData with any existing values
        cachedProfile = profile;
        showWizard();
        bindWizardButtons();
      }
    } catch (_) {}
  };

})(window);
