/* followup-client.js — Text Boss Follow-Up UI
 * Shared module for app-pro.html and app-black.html.
 * Call window.initFollowUps({ tier, followUpLimit }) when the
 * Follow-Ups tab is first activated.
 */
(function (global) {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var _tier = 'Pro';
  var _followUpLimit = 10;

  // ── State ────────────────────────────────────────────────────────────────────
  var cachedJobs = [];
  var cachedMessages = [];
  var cachedProfile = null;
  var activeSubTab = 'log';
  var pendingDrafts = null;
  var pendingBody = null;
  var fuBusy = false;

  // ── Utilities ────────────────────────────────────────────────────────────────
  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function daysFromNow(dateStr) {
    var now = new Date(todayStr() + 'T00:00:00');
    var target = new Date(dateStr + 'T00:00:00');
    var diff = Math.round((target - now) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff < 0) return Math.abs(diff) + 'd overdue';
    return 'In ' + diff + ' days';
  }

  async function getJson(url, options) {
    var res = await fetch(url, options);
    var data = await res.json();
    return { response: res, data: data };
  }

  // ── API calls ───────────────────────────────────────────────────────────────
  async function loadJobs() {
    try {
      var result = await getJson('/.netlify/functions/follow-up', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.ok) {
        cachedJobs = result.data.jobs || [];
      }
    } catch (_) {}
  }

  async function loadPendingMessages() {
    try {
      var result = await getJson('/.netlify/functions/follow-up?pending=true', {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.ok) {
        cachedMessages = result.data.messages || [];
      }
    } catch (_) {}
  }

  async function loadJobMessages(jobId) {
    try {
      var result = await getJson('/.netlify/functions/follow-up?messages=true&jobId=' + encodeURIComponent(jobId), {
        method: 'GET', credentials: 'same-origin'
      });
      if (result.data.ok) {
        return result.data.messages || [];
      }
    } catch (_) {}
    return [];
  }

  async function loadBusinessProfile() {
    try {
      var result = await getJson('/.netlify/functions/business-profile', {
        method: 'GET', credentials: 'same-origin'
      });
      cachedProfile = (result.data.ok) ? (result.data.profile || null) : null;
    } catch (_) {
      cachedProfile = null;
    }
    return cachedProfile;
  }

  async function submitFollowUp(body) {
    return await getJson('/.netlify/functions/follow-up', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async function markMessage(messageId, action) {
    return await getJson('/.netlify/functions/follow-up', {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: messageId, action: action })
    });
  }

  async function cancelJob(jobId) {
    return await getJson('/.netlify/functions/follow-up', {
      method: 'DELETE', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: jobId })
    });
  }

  // ── Sub-tab switching ───────────────────────────────────────────────────────
  function showSubTab(name) {
    activeSubTab = name;
    document.querySelectorAll('.fu-subtab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-fu-tab') === name);
    });
    document.querySelectorAll('.fu-subpanel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'fu-panel-' + name);
    });
  }

  // ── Render: Log Service form ────────────────────────────────────────────────
  function renderLogForm() {
    var form = document.getElementById('fu-log-form');
    if (!form) return;

    // Build service options from business profile
    var serviceOptions = '<option value="">Type or select a service...</option>';
    if (cachedProfile && cachedProfile.services && Array.isArray(cachedProfile.services)) {
      cachedProfile.services.forEach(function (svc) {
        var label = svc.name || svc;
        serviceOptions += '<option value="' + escapeHtml(label) + '">' + escapeHtml(label) + '</option>';
      });
    }

    form.innerHTML =
      '<div class="fu-field">' +
        '<label>Client name <span class="fu-req">*</span></label>' +
        '<input type="text" id="fu-client-name" placeholder="Jane Smith" required>' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Service <span class="fu-req">*</span></label>' +
        '<div class="fu-combo">' +
          '<select id="fu-service-select">' + serviceOptions + '</select>' +
          '<input type="text" id="fu-service-text" placeholder="e.g. Ceramic Coating">' +
        '</div>' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Date completed <span class="fu-req">*</span></label>' +
        '<input type="date" id="fu-service-date" value="' + todayStr() + '">' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Client contact</label>' +
        '<input type="text" id="fu-client-contact" placeholder="Phone or email (optional)">' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Notes</label>' +
        '<input type="text" id="fu-notes" placeholder="Any details for the follow-up messages (optional)">' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Review link</label>' +
        '<input type="url" id="fu-review-link" placeholder="https://g.page/...">' +
      '</div>' +
      '<div class="fu-field">' +
        '<label>Rebooking link</label>' +
        '<input type="url" id="fu-rebooking-link" placeholder="https://...">' +
      '</div>' +
      '<div class="fu-actions">' +
        '<button type="submit" class="primary-btn" id="fu-generate-btn">Generate Follow-Ups</button>' +
        '<span class="fu-status" id="fu-status"></span>' +
      '</div>' +
      '<div id="fu-preview" class="fu-preview"></div>';

    // Sync select → text
    var sel = document.getElementById('fu-service-select');
    var txt = document.getElementById('fu-service-text');
    if (sel && txt) {
      sel.addEventListener('change', function () {
        if (sel.value) txt.value = sel.value;
      });
    }
  }

  function getServiceValue() {
    var txt = document.getElementById('fu-service-text');
    var sel = document.getElementById('fu-service-select');
    if (txt && txt.value.trim()) return txt.value.trim();
    if (sel && sel.value) return sel.value;
    return '';
  }

  // ── Render: Preview of AI-generated drafts ──────────────────────────────────
  function renderPreview(job, messages) {
    var container = document.getElementById('fu-preview');
    if (!container) return;

    var html = '<div class="fu-preview-header">Preview: ' + escapeHtml(messages.length) + ' follow-up messages for ' + escapeHtml(job.client_name) + '</div>';
    messages.forEach(function (msg) {
      html +=
        '<div class="fu-preview-card">' +
          '<div class="fu-preview-meta">' +
            '<span class="fu-preview-date">' + escapeHtml(formatDate(msg.send_date)) + '</span>' +
            '<span class="fu-preview-purpose">' + escapeHtml(msg.purpose) + '</span>' +
          '</div>' +
          '<div class="fu-preview-text">' + escapeHtml(msg.draft_message) + '</div>' +
        '</div>';
    });
    html += '<div class="fu-preview-done">Follow-ups scheduled. Switch to the <strong>Upcoming</strong> tab to manage them.</div>';

    container.innerHTML = html;
    container.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Render: Upcoming messages ───────────────────────────────────────────────
  function renderUpcoming() {
    var container = document.getElementById('fu-upcoming-list');
    if (!container) return;

    if (cachedMessages.length === 0) {
      container.innerHTML = '<div class="fu-empty">No pending follow-up messages.</div>';
      return;
    }

    // Enrich messages with job data
    var jobMap = {};
    cachedJobs.forEach(function (j) { jobMap[j.id] = j; });

    var html = '';
    cachedMessages.forEach(function (msg) {
      var job = jobMap[msg.job_id] || {};
      var dateLabel = daysFromNow(msg.send_date);
      var isOverdue = dateLabel.indexOf('overdue') !== -1;
      var isToday = dateLabel === 'Today';

      html +=
        '<div class="fu-msg-card' + (isOverdue ? ' overdue' : '') + (isToday ? ' today' : '') + '" data-msg-id="' + escapeHtml(msg.id) + '">' +
          '<div class="fu-msg-header">' +
            '<div class="fu-msg-client">' + escapeHtml(job.client_name || 'Unknown') + '</div>' +
            '<div class="fu-msg-badge ' + (isOverdue ? 'badge-overdue' : isToday ? 'badge-today' : 'badge-future') + '">' + escapeHtml(dateLabel) + '</div>' +
          '</div>' +
          '<div class="fu-msg-service">' + escapeHtml(job.service_name || '') + ' &middot; ' + escapeHtml(msg.purpose) + '</div>' +
          '<div class="fu-msg-draft">' + escapeHtml(msg.draft_message) + '</div>' +
          '<div class="fu-msg-actions">' +
            '<button class="fu-action-btn fu-copy-btn" data-draft="' + escapeHtml(msg.draft_message) + '">Copy Message</button>' +
            '<button class="fu-action-btn fu-sent-btn" data-msg-id="' + escapeHtml(msg.id) + '">Mark as Sent</button>' +
            '<button class="fu-action-btn fu-skip-btn" data-msg-id="' + escapeHtml(msg.id) + '">Skip</button>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    // Bind action buttons
    container.querySelectorAll('.fu-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-draft');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = 'Copy Message'; }, 1500);
          });
        }
      });
    });

    container.querySelectorAll('.fu-sent-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        btn.textContent = 'Updating...';
        await markMessage(btn.getAttribute('data-msg-id'), 'sent');
        await loadPendingMessages();
        renderUpcoming();
      });
    });

    container.querySelectorAll('.fu-skip-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        btn.textContent = 'Skipping...';
        await markMessage(btn.getAttribute('data-msg-id'), 'skipped');
        await loadPendingMessages();
        renderUpcoming();
      });
    });
  }

  // ── Render: History ─────────────────────────────────────────────────────────
  function renderHistory() {
    var container = document.getElementById('fu-history-list');
    if (!container) return;

    if (cachedJobs.length === 0) {
      container.innerHTML = '<div class="fu-empty">No follow-up jobs yet. Log a completed service to get started.</div>';
      return;
    }

    var html = '';
    cachedJobs.forEach(function (job) {
      var statusCls = 'fu-status-' + (job.status || 'active');
      html +=
        '<div class="fu-job-card">' +
          '<div class="fu-job-header">' +
            '<div class="fu-job-client">' + escapeHtml(job.client_name) + '</div>' +
            '<span class="fu-job-badge ' + statusCls + '">' + escapeHtml(job.status) + '</span>' +
          '</div>' +
          '<div class="fu-job-meta">' +
            escapeHtml(job.service_name) + ' &middot; ' + escapeHtml(formatDate(job.service_date)) +
          '</div>' +
          (job.status === 'active'
            ? '<div class="fu-job-actions"><button class="fu-action-btn fu-cancel-btn" data-job-id="' + escapeHtml(job.id) + '">Cancel</button></div>'
            : '') +
        '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.fu-cancel-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        btn.textContent = 'Cancelling...';
        await cancelJob(btn.getAttribute('data-job-id'));
        await loadJobs();
        await loadPendingMessages();
        renderHistory();
        renderUpcoming();
      });
    });
  }

  // ── Form submission ─────────────────────────────────────────────────────────
  function bindLogForm() {
    var form = document.getElementById('fu-log-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (fuBusy) return;

      var clientName   = (document.getElementById('fu-client-name') || {}).value || '';
      var serviceName  = getServiceValue();
      var serviceDate  = (document.getElementById('fu-service-date') || {}).value || '';
      var clientContact = (document.getElementById('fu-client-contact') || {}).value || '';
      var notes        = (document.getElementById('fu-notes') || {}).value || '';
      var reviewLink   = (document.getElementById('fu-review-link') || {}).value || '';
      var rebookingLink = (document.getElementById('fu-rebooking-link') || {}).value || '';

      if (!clientName.trim() || !serviceName.trim() || !serviceDate.trim()) {
        setStatus('Client name, service, and date are required.');
        return;
      }

      fuBusy = true;
      var btn = document.getElementById('fu-generate-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
      setStatus('Generating follow-up messages...');

      var body = {
        client_name: clientName.trim(),
        service_name: serviceName.trim(),
        service_date: serviceDate,
      };
      if (clientContact.trim()) body.client_contact = clientContact.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (reviewLink.trim()) body.review_link = reviewLink.trim();
      if (rebookingLink.trim()) body.rebooking_link = rebookingLink.trim();

      try {
        var result = await submitFollowUp(body);
        if (result.data.ok) {
          setStatus('Follow-ups created.');
          renderPreview(result.data.job, result.data.messages);
          // Refresh data
          await loadJobs();
          await loadPendingMessages();
          renderUpcoming();
          renderHistory();
        } else {
          var reason = result.data.reason || 'unknown error';
          if (reason === 'follow_up_limit_reached') {
            setStatus('Active follow-up limit reached (' + _followUpLimit + '). Cancel an existing job first.');
          } else {
            setStatus('Error: ' + reason);
          }
        }
      } catch (err) {
        setStatus('Network error. Try again.');
      } finally {
        fuBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Generate Follow-Ups'; }
      }
    });
  }

  function setStatus(text) {
    var el = document.getElementById('fu-status');
    if (el) el.textContent = text;
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  global.initFollowUps = async function initFollowUps(opts) {
    _tier = opts.tier || 'Pro';
    _followUpLimit = opts.followUpLimit || 10;

    // Bind sub-tab buttons
    document.querySelectorAll('.fu-subtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-fu-tab');
        showSubTab(tab);
        if (tab === 'upcoming') {
          loadPendingMessages().then(renderUpcoming);
        } else if (tab === 'history') {
          loadJobs().then(renderHistory);
        }
      });
    });

    // Load profile for service dropdown
    await loadBusinessProfile();

    // Render the log form
    renderLogForm();
    bindLogForm();

    // Load initial data
    await Promise.all([loadJobs(), loadPendingMessages()]);
    renderUpcoming();
    renderHistory();

    // Check if opened via #follow-ups hash
    if (window.location.hash === '#follow-ups') {
      showSubTab('upcoming');
    }
  };

})(window);
