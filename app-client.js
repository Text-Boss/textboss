(function () {
  async function getJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    return { response, data };
  }

  function redirectDenied() {
    window.location.href = "/denied.html";
  }

  function appendMessage(threadNode, role, text) {
    var isAI = role !== "user";
    var wrap  = document.createElement("div");
    wrap.className = "msg " + (isAI ? "msg-ai" : "msg-user");

    var label = document.createElement("div");
    label.className  = "msg-label";
    label.textContent = isAI ? "TB \u203a" : "you";
    wrap.appendChild(label);

    var bubble = document.createElement("div");
    bubble.className  = "msg-text";
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (isAI) {
      var copyBtn = document.createElement("button");
      copyBtn.className   = "copy-btn";
      copyBtn.type        = "button";
      copyBtn.textContent = "Copy";
      copyBtn.setAttribute("aria-label", "Copy message to clipboard");
      copyBtn.addEventListener("click", function () {
        function done() {
          copyBtn.textContent = "\u2713 Copied";
          setTimeout(function () { copyBtn.textContent = "Copy"; }, 1500);
        }
        function fallback() {
          try {
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(bubble);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("copy");
            sel.removeAllRanges();
            done();
          } catch (_) {
            copyBtn.textContent = "Select manually";
            setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
          }
        }
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
          fallback();
        }
      });
      wrap.appendChild(copyBtn);
    }

    threadNode.appendChild(wrap);
    threadNode.scrollTop = threadNode.scrollHeight;
    return wrap;
  }

  function showTyping(threadNode) {
    var wrap = document.createElement("div");
    wrap.className = "msg msg-ai msg-typing";
    var label = document.createElement("div");
    label.className  = "msg-label";
    label.textContent = "TB \u203a";
    var bubble = document.createElement("div");
    bubble.className = "msg-text";
    bubble.innerHTML = "<span class='tdot'></span><span class='tdot'></span><span class='tdot'></span>";
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    threadNode.appendChild(wrap);
    threadNode.scrollTop = threadNode.scrollHeight;
    return wrap;
  }

  function relativeTime(dateStr) {
    var now = Date.now();
    var then = new Date(dateStr).getTime();
    var diff = Math.floor((now - then) / 1000);

    if (diff < 60) { return "just now"; }
    if (diff < 3600) { return Math.floor(diff / 60) + "m ago"; }
    if (diff < 86400) { return Math.floor(diff / 3600) + "h ago"; }
    if (diff < 604800) { return Math.floor(diff / 86400) + "d ago"; }

    return new Date(dateStr).toLocaleDateString();
  }

  async function boot() {
    var root = document.querySelector("[data-app-tier]");
    if (!root) {
      return;
    }

    var expectedTier = root.getAttribute("data-app-tier");
    var statusNode = document.getElementById("app-status");
    var threadNode = document.getElementById("app-output");
    var form = document.getElementById("chat-form");
    var messageInput = document.getElementById("chat-message");
    var logoutButton = document.getElementById("logout-button");
    var sidebarToggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("threads-sidebar");
    var sidebarClose = document.getElementById("sidebar-close");
    var threadsList = document.getElementById("threads-list");
    var newChatButton = document.getElementById("new-chat-button");

    var inputLimit   = Number(root.getAttribute("data-input-limit") || 4000);
    var charCount    = document.getElementById("char-count");
    var backdrop     = document.getElementById("sidebar-backdrop");

    var currentThreadId = null;
    var conversation    = [];
    var busy            = false;

    function setStatus(message) {
      if (statusNode) {
        statusNode.textContent = message;
      }
    }

    var session = await getJson("/.netlify/functions/session-verify", {
      method: "GET",
      credentials: "same-origin",
    }).catch(function () {
      return null;
    });

    if (!session || !session.data.ok || session.data.tier !== expectedTier) {
      redirectDenied();
      return;
    }

    setStatus("Ready.");

    function openSidebar() {
      if (sidebar)   sidebar.classList.add("open");
      if (backdrop)  backdrop.classList.add("visible");
    }
    function closeSidebar() {
      if (sidebar)   sidebar.classList.remove("open");
      if (backdrop)  backdrop.classList.remove("visible");
    }
    function toggleSidebar() {
      if (sidebar && sidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    }

    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", toggleSidebar);
    }
    if (sidebarClose) {
      sidebarClose.addEventListener("click", closeSidebar);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeSidebar);
    }

    async function loadThreadsList() {
      if (!threadsList) {
        return;
      }

      try {
        var result = await getJson("/.netlify/functions/threads", {
          method: "GET",
          credentials: "same-origin",
        });

        if (!result.data.ok) {
          return;
        }

        threadsList.innerHTML = "";
        var threads = result.data.threads || [];

        threads.forEach(function (thread) {
          var item = document.createElement("button");
          item.className = "thread-item";
          if (thread.id === currentThreadId) {
            item.classList.add("active");
          }
          item.setAttribute("data-thread-id", thread.id);

          var title = document.createElement("span");
          title.className = "thread-title";
          title.textContent = thread.title || "New conversation";
          item.appendChild(title);

          var time = document.createElement("span");
          time.className = "thread-time";
          time.textContent = relativeTime(thread.updated_at || thread.created_at);
          item.appendChild(time);

          item.addEventListener("click", function () {
            loadThread(thread.id);
          });

          threadsList.appendChild(item);
        });
      } catch (e) {
        // silent fail
      }
    }

    async function loadThread(threadId) {
      try {
        var result = await getJson("/.netlify/functions/threads?id=" + threadId, {
          method: "GET",
          credentials: "same-origin",
        });

        if (!result.data.ok || !result.data.thread) {
          return;
        }

        currentThreadId = threadId;
        conversation = [];
        threadNode.innerHTML = "";

        var messages = result.data.thread.messages || [];
        messages.forEach(function (msg) {
          appendMessage(threadNode, msg.role, msg.content);

          if (msg.role === "user") {
            conversation.push({
              role: "user",
              content: [{ type: "input_text", text: msg.content }],
            });
          } else {
            conversation.push({
              role: "assistant",
              content: [{ type: "output_text", text: msg.content }],
            });
          }
        });

        setStatus("Ready.");
        loadThreadsList();

        if (window.innerWidth < 820) { closeSidebar(); }
      } catch (e) {
        setStatus("Failed to load thread.");
      }
    }

    async function createNewThread() {
      try {
        var result = await getJson("/.netlify/functions/threads", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!result.data.ok || !result.data.thread) {
          return;
        }

        currentThreadId = result.data.thread.id;
        conversation = [];
        threadNode.innerHTML = "";
        setStatus("Ready.");
        loadThreadsList();

        if (window.innerWidth < 820) { closeSidebar(); }
      } catch (e) {
        setStatus("Failed to create thread.");
      }
    }

    if (newChatButton) {
      newChatButton.addEventListener("click", createNewThread);
    }

    await loadThreadsList();

    if (!currentThreadId) {
      await createNewThread();
    }

    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (busy) return;

        var message = String(messageInput.value || "").trim();
        if (!message) { setStatus("Enter a message first."); return; }

        if (message.length > inputLimit) {
          setStatus("Too long — " + message.length + "/" + inputLimit + " chars max.");
          return;
        }

        busy = true;
        appendMessage(threadNode, "user", message);
        messageInput.value = "";
        messageInput.style.height = "auto";
        if (charCount) { charCount.textContent = ""; charCount.className = "char-count"; }
        setStatus("Generating\u2026");

        var typing          = showTyping(threadNode);
        var historySnapshot = conversation.slice();

        conversation.push({
          role: "user",
          content: [{ type: "input_text", text: message }],
        });

        try {
          var result = await getJson("/.netlify/functions/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: message,
              conversation: historySnapshot,
              threadId: currentThreadId,
            }),
          });

          typing.remove();

          if (!result.data.ok) {
            conversation.pop();
            if (result.data.denied) {
              redirectDenied();
            } else {
              setStatus("Error: " + (result.data.reason || "unknown"));
            }
            busy = false;
            return;
          }

          var output = result.data.output || "";
          appendMessage(threadNode, "assistant", output);
          conversation.push({
            role: "assistant",
            content: [{ type: "output_text", text: output }],
          });
          setStatus("Ready.");
          loadThreadsList();
        } catch (_) {
          typing.remove();
          conversation.pop();
          setStatus("Request failed — check your connection.");
        }

        busy = false;
      });

      messageInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          form.requestSubmit();
        }
      });

      messageInput.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 200) + "px";

        if (charCount) {
          var used      = this.value.length;
          var remaining = inputLimit - used;
          var threshold = Math.floor(inputLimit * 0.25);
          if (used > 0 && remaining < threshold) {
            charCount.textContent = remaining + " chars remaining";
            charCount.className   = "char-count" + (remaining < 200 ? " warn" : "");
          } else {
            charCount.textContent = "";
            charCount.className   = "char-count";
          }
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", async function () {
        try {
          await fetch("/.netlify/functions/session-logout", {
            method: "POST",
            credentials: "same-origin",
          });
        } finally {
          window.location.href = "/access.html";
        }
      });
    }
  }

  boot();
})();
