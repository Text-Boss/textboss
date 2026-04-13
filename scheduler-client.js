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
    renderCalendar();
    renderDayDetail(selectedDate);
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
  function renderServices() {
    var container = document.getElementById('svc-list');
    if (!container) return;
    var services = (cachedProfile && cachedProfile.services) ? cachedProfile.services : [];
    container.innerHTML = '';

    services.forEach(function (svc, idx) {
      var item = document.createElement('div');
      item.className = 'svc-item';
      item.innerHTML =
        '<div><div class="svc-name">' + escapeHtml(svc.name) + '</div>' +
        '<div class="svc-dur">' + escapeHtml(String(svc.duration_minutes || 60)) + ' minutes</div></div>';
      var actions = document.createElement('div');
      actions.className = 'svc-actions';
      var removeBtn = document.createElement('button');
      removeBtn.className = 'svc-btn';
      removeBtn.textContent = 'Remove';
      (function (i) {
        removeBtn.addEventListener('click', async function () {
          var updated = (cachedProfile.services || []).filter(function (_, j) { return j !== i; });
          await saveBusinessProfile({ services: updated });
          renderServices();
        });
      })(idx);
      actions.appendChild(removeBtn);
      item.appendChild(actions);
      container.appendChild(item);
    });

    var addBtn = document.createElement('button');
    addBtn.className = 'add-svc-btn';
    addBtn.textContent = '+ Add service';
    addBtn.addEventListener('click', function () {
      addBtn.style.display = 'none';
      var row = document.createElement('div');
      row.className = 'svc-row';
      row.innerHTML =
        '<input type="text" placeholder="Service name" class="svc-new-name">' +
        '<input type="number" placeholder="Min" min="5" step="5" class="svc-new-dur">' +
        '<button class="svc-row-save" type="button">Save</button>' +
        '<button class="svc-row-remove svc-row-cancel" type="button">&times;</button>';
      container.insertBefore(row, addBtn);
      row.querySelector('.svc-row-cancel').addEventListener('click', function () {
        row.remove();
        addBtn.style.display = '';
      });
      row.querySelector('.svc-row-save').addEventListener('click', async function () {
        var name = row.querySelector('.svc-new-name').value.trim();
        var dur = parseInt(row.querySelector('.svc-new-dur').value, 10);
        if (!name || !dur) return;
        var updated = (cachedProfile && cachedProfile.services ? cachedProfile.services : []).concat([{ name: name, duration_minutes: dur }]);
        var ok = await saveBusinessProfile({ services: updated });
        if (ok) renderServices();
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
    wizData = { occupation: '', services: [{ name: '', duration_minutes: 60 }], bufferBefore: 15, bufferAfter: 15 };
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
      for (var i = 1; i <= 3; i++) {
        var dot = document.createElement('div');
        dot.className = 'wizard-step-dot' + (i < wizStep ? ' done' : i === wizStep ? ' active' : '');
        stepIndicator.appendChild(dot);
      }
    }

    if (wizStep === 1) {
      if (titleEl) titleEl.textContent = 'What do you do?';
      if (subEl) subEl.textContent = 'Your occupation helps the AI give relevant scheduling advice.';
      if (nextBtn) nextBtn.textContent = 'Next \u2192';
      bodyEl.innerHTML =
        '<div class="wizard-field"><label>Your occupation</label>' +
        '<input type="text" id="wiz-occupation" placeholder="e.g. Mobile Hairdresser, Plumber, Personal Trainer" value="' + escapeHtml(wizData.occupation) + '"></div>';

    } else if (wizStep === 2) {
      if (titleEl) titleEl.textContent = 'What services do you offer?';
      if (subEl) subEl.textContent = 'Add the services you book. The AI uses these durations to find the right slots.';
      if (nextBtn) nextBtn.textContent = 'Next \u2192';
      var html = '<div id="wiz-svc-list">';
      wizData.services.forEach(function (svc, i) {
        html +=
          '<div class="svc-row">' +
          '<input type="text" class="wiz-svc-name" placeholder="Service name" value="' + escapeHtml(svc.name) + '">' +
          '<input type="number" class="wiz-svc-dur" placeholder="Min" min="5" step="5" value="' + escapeHtml(String(svc.duration_minutes || '')) + '">' +
          '<button class="svc-row-remove" type="button" data-idx="' + i + '">&times;</button></div>';
      });
      html += '</div><button class="add-svc-btn" id="wiz-add-svc" type="button">+ Add service</button>';
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('.svc-row-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          saveWizardStep2();
          wizData.services.splice(idx, 1);
          renderWizardStep();
        });
      });
      var addSvcBtn = document.getElementById('wiz-add-svc');
      if (addSvcBtn) {
        addSvcBtn.addEventListener('click', function () {
          saveWizardStep2();
          wizData.services.push({ name: '', duration_minutes: 60 });
          renderWizardStep();
        });
      }

    } else if (wizStep === 3) {
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
    var el = document.getElementById('wiz-occupation');
    if (el) wizData.occupation = el.value.trim();
  }

  function saveWizardStep2() {
    var rows = document.querySelectorAll('#wiz-svc-list .svc-row');
    wizData.services = Array.from(rows).map(function (row) {
      var nameEl = row.querySelector('.wiz-svc-name');
      var durEl  = row.querySelector('.wiz-svc-dur');
      return {
        name: nameEl ? nameEl.value.trim() : '',
        duration_minutes: durEl ? (parseInt(durEl.value, 10) || 60) : 60
      };
    });
  }

  function saveWizardStep3() {
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
          nextBtn.disabled = true;
          nextBtn.textContent = 'Saving\u2026';
          var ok = await saveBusinessProfile({
            occupation: wizData.occupation,
            services: wizData.services.filter(function (s) { return s.name; }),
            buffer_before_minutes: wizData.bufferBefore,
            buffer_after_minutes: wizData.bufferAfter,
            onboarding_complete: true
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

    // Load data
    await loadBusinessProfile();
    await loadAppointments();

    // Onboarding check
    if (!cachedProfile || !cachedProfile.onboarding_complete) showWizard();

    // Render sidebar panels
    renderWorkingHours();
    renderServices();
    renderBookingLink();

    // Notification prompt
    checkNotificationPrompt();

    // Bind interactive elements
    bindWorkingHoursForm();
    bindSchedulerChat();
    bindWizardButtons();
    bindIcalExport();

    // Unlock form now that all handlers are registered
    if (submitBtn) submitBtn.disabled = false;
    if (schedStatusEl) schedStatusEl.textContent = 'Ready.';
  }

  global.initScheduler = initScheduler;

})(window);
