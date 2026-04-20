/* todos-client.js — To-Do List + Notes tab renderer */
(function () {
  'use strict';

  var API = '/.netlify/functions/todos';
  var NOTES_KEY = 'tb_notes';

  var state = {
    todos: [],
    tier: 'Core',
    busy: false,
  };

  var canRemind = false;

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function apiFetch(method, path, body) {
    var opts = { method: method, headers: { 'content-type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(API + (path || ''), opts);
    return res.json();
  }

  async function loadTodos() {
    var data = await apiFetch('GET', '').catch(function () { return { ok: false }; });
    if (data.ok) {
      state.todos = data.todos || [];
      renderTodos();
    }
  }

  async function addTodo(text, isUrgent, reminderAt) {
    var body = { text: text, is_urgent: isUrgent };
    if (canRemind && reminderAt) body.reminder_at = reminderAt;
    var data = await apiFetch('POST', '', body);
    if (data.ok) {
      state.todos.push(data.todo);
      renderTodos();
    }
  }

  async function toggleDone(id, isDone) {
    var data = await apiFetch('PATCH', '?id=' + id, { is_done: isDone });
    if (data.ok) {
      var idx = state.todos.findIndex(function (t) { return t.id === id; });
      if (idx !== -1) state.todos[idx] = data.todo;
      renderTodos();
    }
  }

  async function deleteTodo(id) {
    await apiFetch('DELETE', '?id=' + id);
    state.todos = state.todos.filter(function (t) { return t.id !== id; });
    renderTodos();
  }

  // ── Render todo list ─────────────────────────────────────────────────────────
  function renderTodos() {
    var list = document.getElementById('todo-list');
    if (!list) return;

    var active = state.todos.filter(function (t) { return !t.is_done; });
    var done   = state.todos.filter(function (t) { return t.is_done; });

    if (state.todos.length === 0) {
      list.innerHTML = '<div class="todo-empty">No tasks yet. Add one below.</div>';
      return;
    }

    function renderItem(t) {
      var urgentClass = t.is_urgent ? ' urgent' : '';
      var doneClass   = t.is_done   ? ' done'   : '';
      var reminder    = t.reminder_at
        ? '<span class="todo-reminder">⏰ ' + esc(new Date(t.reminder_at).toLocaleString()) + '</span>'
        : '';
      var el = document.createElement('div');
      el.className = 'todo-item' + urgentClass + doneClass;
      el.dataset.id = t.id;
      el.innerHTML =
        '<label class="todo-check-wrap">' +
          '<input type="checkbox" class="todo-check"' + (t.is_done ? ' checked' : '') + '>' +
          '<span class="todo-checkmark"></span>' +
        '</label>' +
        '<div class="todo-content">' +
          '<span class="todo-text">' + esc(t.text) + '</span>' +
          reminder +
        '</div>' +
        (t.is_urgent ? '<span class="todo-urgent-badge">Urgent</span>' : '') +
        '<button class="todo-delete" title="Delete" type="button">×</button>';
      return el;
    }

    list.innerHTML = '';
    active.forEach(function (t) { list.appendChild(renderItem(t)); });

    if (done.length > 0) {
      var sep = document.createElement('div');
      sep.className = 'todo-done-sep';
      sep.textContent = 'Completed';
      list.appendChild(sep);
      done.forEach(function (t) { list.appendChild(renderItem(t)); });
    }

    // Bind events
    list.querySelectorAll('.todo-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = this.closest('.todo-item').dataset.id;
        toggleDone(id, this.checked);
      });
    });

    list.querySelectorAll('.todo-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.closest('.todo-item').dataset.id;
        deleteTodo(id);
      });
    });
  }

  // ── Notes ───────────────────────────────────────────────────────────────────
  function initNotes(container) {
    var saved = localStorage.getItem(NOTES_KEY) || '';
    var notesEl = container.querySelector('#notes-area');
    if (!notesEl) return;
    notesEl.innerHTML = saved;

    var debounce;
    notesEl.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        localStorage.setItem(NOTES_KEY, notesEl.innerHTML);
      }, 500);
    });

    // Paste image support
    notesEl.addEventListener('paste', function (e) {
      var items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var reader = new FileReader();
          var file = items[i].getAsFile();
          reader.onload = function (evt) {
            var img = document.createElement('img');
            img.src = evt.target.result;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '4px';
            img.style.margin = '4px 0';
            document.execCommand('insertHTML', false, img.outerHTML);
          };
          reader.readAsDataURL(file);
        }
      }
    });
  }

  // ── Build and inject the panel HTML ─────────────────────────────────────────
  function buildPanel(panelEl, accent) {
    var reminderFields = canRemind
      ? '<div class="todo-reminder-row">' +
          '<label class="todo-label"><input type="checkbox" id="todo-urgent"> Urgent</label>' +
          '<div class="todo-reminder-input" id="todo-reminder-wrap" style="display:none">' +
            '<label class="todo-label">Remind at:</label>' +
            '<input type="datetime-local" id="todo-reminder-at" class="todo-dt-input">' +
          '</div>' +
        '</div>'
      : '';

    panelEl.innerHTML =
      '<div class="td-panel">' +
        '<div class="td-todo-section">' +
          '<div class="td-section-head">To-Do List</div>' +
          '<div id="todo-list" class="todo-list"><div class="todo-empty">Loading…</div></div>' +
          '<form id="todo-add-form" class="todo-add-form">' +
            '<textarea id="todo-input" class="todo-input" placeholder="Add a task…" rows="2"></textarea>' +
            reminderFields +
            '<div class="todo-add-row">' +
              '<button type="submit" class="todo-add-btn">Add Task</button>' +
            '</div>' +
          '</form>' +
        '</div>' +

        '<div class="td-notes-section">' +
          '<button class="td-notes-toggle" id="notes-toggle" type="button">' +
            '<span>Notes</span><span class="td-toggle-arrow">▼</span>' +
          '</button>' +
          '<div id="notes-wrap" class="notes-wrap" style="display:none;">' +
            '<div id="notes-area" class="notes-area" contenteditable="true" ' +
              'data-placeholder="Your notes go here — type, paste images, anything…"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // ── Add form ─────────────────────────────────────────────────────────────
    var form = panelEl.querySelector('#todo-add-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = panelEl.querySelector('#todo-input');
      var text = (input.value || '').trim();
      if (!text) return;

      var isUrgent = false;
      var reminderAt = null;

      if (canRemind) {
        var urgentCb = panelEl.querySelector('#todo-urgent');
        isUrgent = urgentCb && urgentCb.checked;
        var dtInput = panelEl.querySelector('#todo-reminder-at');
        reminderAt = dtInput && dtInput.value ? new Date(dtInput.value).toISOString() : null;
      }

      addTodo(text, isUrgent, reminderAt);
      input.value = '';
      if (canRemind) {
        var urgentCb2 = panelEl.querySelector('#todo-urgent');
        if (urgentCb2) urgentCb2.checked = false;
        var dtInput2 = panelEl.querySelector('#todo-reminder-at');
        if (dtInput2) { dtInput2.value = ''; }
        var wrap = panelEl.querySelector('#todo-reminder-wrap');
        if (wrap) wrap.style.display = 'none';
      }
    });

    if (canRemind) {
      var urgentCb = panelEl.querySelector('#todo-urgent');
      var remindWrap = panelEl.querySelector('#todo-reminder-wrap');
      if (urgentCb && remindWrap) {
        urgentCb.addEventListener('change', function () {
          remindWrap.style.display = this.checked ? 'flex' : 'none';
        });
      }
    }

    // ── Notes toggle ─────────────────────────────────────────────────────────
    var notesToggle = panelEl.querySelector('#notes-toggle');
    var notesWrap   = panelEl.querySelector('#notes-wrap');
    if (notesToggle && notesWrap) {
      notesToggle.addEventListener('click', function () {
        var open = notesWrap.style.display !== 'none';
        notesWrap.style.display = open ? 'none' : 'block';
        var arrow = notesToggle.querySelector('.td-toggle-arrow');
        if (arrow) arrow.textContent = open ? '▼' : '▲';
        if (!open) initNotes(panelEl);
      });
    }
  }

  // ── Inject CSS ────────────────────────────────────────────────────────────────
  function injectStyles(accent) {
    if (document.getElementById('td-styles')) return;
    var style = document.createElement('style');
    style.id = 'td-styles';
    style.textContent = [
      '.td-panel{display:flex;flex-direction:column;flex:1;overflow-y:auto;max-width:680px;margin:0 auto;width:100%;padding:20px 16px 40px}',
      '.td-panel::-webkit-scrollbar{width:3px}',
      '.td-panel::-webkit-scrollbar-thumb{background:#232830;border-radius:3px}',

      '.td-section-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#52606d;margin-bottom:14px}',

      '.todo-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;min-height:40px}',
      '.todo-empty{color:#52606d;font-size:13px;padding:12px 0}',

      '.todo-item{display:flex;align-items:flex-start;gap:10px;background:#0c0e11;border:1px solid #191d22;border-radius:8px;padding:10px 12px;transition:border-color .15s}',
      '.todo-item.urgent{border-color:rgba(239,68,68,.4)}',
      '.todo-item.done{opacity:.5}',
      '.todo-item.done .todo-text{text-decoration:line-through}',

      '.todo-check-wrap{flex-shrink:0;display:flex;align-items:center;padding-top:2px}',
      '.todo-check{width:16px;height:16px;accent-color:' + accent + ';cursor:pointer}',

      '.todo-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.todo-text{font-size:14px;color:#e4ecf2;line-height:1.5;word-break:break-word}',
      '.todo-reminder{font-size:11px;color:#52606d}',
      '.todo-urgent-badge{flex-shrink:0;font-size:10px;padding:2px 7px;border-radius:4px;color:#ef4444;border:1px solid rgba(239,68,68,.4)}',

      '.todo-delete{background:none;border:none;color:#52606d;font-size:18px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;transition:color .15s}',
      '.todo-delete:hover{color:#ef4444}',

      '.todo-done-sep{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#52606d;padding:8px 0 4px;border-top:1px solid #191d22;margin-top:4px}',

      '.todo-add-form{display:flex;flex-direction:column;gap:8px}',
      '.todo-input{background:#0c0e11;border:1px solid #191d22;border-radius:8px;padding:10px 12px;color:#e4ecf2;font:14px Consolas,Monaco,monospace;resize:none;outline:none;transition:border-color .15s;font-size:16px;width:100%}',
      '.todo-input:focus{border-color:' + accent + '}',

      '.todo-reminder-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.todo-label{font-size:13px;color:#8896a4;display:flex;align-items:center;gap:6px;cursor:pointer}',
      '.todo-reminder-input{display:flex;align-items:center;gap:8px}',
      '.todo-dt-input{background:#0c0e11;border:1px solid #191d22;border-radius:6px;padding:6px 8px;color:#e4ecf2;font:13px Consolas,Monaco,monospace;outline:none;color-scheme:dark;font-size:16px}',
      '.todo-dt-input:focus{border-color:' + accent + '}',

      '.todo-add-row{display:flex;gap:8px}',
      '.todo-add-btn{background:' + accent + ';color:#020203;border:none;border-radius:8px;padding:9px 20px;font:700 13px Consolas,Monaco,monospace;cursor:pointer;transition:opacity .15s}',
      '.todo-add-btn:hover{opacity:.85}',

      // Notes section
      '.td-notes-section{margin-top:24px;border-top:1px solid #191d22;padding-top:16px}',
      '.td-notes-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;color:#8896a4;font:700 11px Consolas,Monaco,monospace;text-transform:uppercase;letter-spacing:.1em;cursor:pointer;padding:4px 0;transition:color .15s}',
      '.td-notes-toggle:hover{color:#e4ecf2}',
      '.td-toggle-arrow{font-size:10px}',
      '.notes-wrap{margin-top:12px}',
      '.notes-area{min-height:160px;background:#0c0e11;border:1px solid #191d22;border-radius:8px;padding:14px;color:#e4ecf2;font:14px Consolas,Monaco,monospace;line-height:1.7;outline:none;transition:border-color .15s}',
      '.notes-area:focus{border-color:' + accent + '}',
      '.notes-area:empty::before{content:attr(data-placeholder);color:#52606d;pointer-events:none}',
      '.notes-area img{max-width:100%;border-radius:4px;margin:4px 0}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initTodos = function initTodos(options) {
    var panelEl = options.panel;
    var tier    = options.tier   || 'Core';
    var accent  = options.accent || '#06b6d4';

    state.tier = tier;
    canRemind  = (tier === 'Pro' || tier === 'Black');

    injectStyles(accent);
    buildPanel(panelEl, accent);
    loadTodos();
  };

})();
