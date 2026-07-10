/* ============================================================
   ESTARA AI PORTAL — portal.js  (v2 — sign-in fix)
   Auth (Supabase) · client dashboard · admin panel
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Config & client ---------- */
  var cfg = window.PORTAL_CONFIG || {};
  var configured =
    cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("supabase.co") !== -1 &&
    cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.length > 40;

  var views = ["viewLoading", "viewConfig", "viewLogin", "viewForgot", "viewRecovery", "viewApp"];
  function show(id) {
    views.forEach(function (v) {
      document.getElementById(v).hidden = v !== id;
    });
  }
  function $(id) { return document.getElementById(id); }

  if (!configured) { show("viewConfig"); return; }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ---------- State ---------- */
  var profile = null;        // my profile row
  var isAdmin = false;
  var clients = [];          // admin: all profiles
  var selectedClientId = null;
  var inAdminView = false;
  var recoveryMode = false;

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function setMsg(el, text) {
    el.hidden = !text;
    el.textContent = text || "";
  }
  function statusChip(status) {
    var map = {
      planned:     { cls: "chip-dim",    label: "Planned" },
      in_progress: { cls: "chip-amber",  label: "In progress" },
      done:        { cls: "chip-green",  label: "Done" },
      open:        { cls: "chip-amber",  label: "Open" },
      resolved:    { cls: "chip-green",  label: "Resolved" }
    };
    var m = map[status] || { cls: "chip-dim", label: status };
    return '<span class="chip ' + m.cls + '">' + esc(m.label) + "</span>";
  }

  /* ---------- Plan benefits (mirrors the plans on estaraai.com) ----------
     type "logged"   = delivered on dates, tracked in benefit_log
                       (period: month / quarter / once / adhoc)
     type "included" = always-on as part of the plan
     Hours & automations are tracked separately by the usage counters. */
  var BENEFITS = {
    checkin_call:        { label: "Monthly AI check-in call",              type: "logged", period: "month" },
    recommendations:     { label: "AI & tooling recommendations",          type: "logged", period: "adhoc" },
    business_review:     { label: "Monthly business review",               type: "logged", period: "month" },
    priority_email:      { label: "Priority email support",                type: "included" },
    systems_support:     { label: "Support for systems we've built you",   type: "included" },
    discounted_rates:    { label: "Discounted rates on project work",      type: "included" },
    onboarding_call:     { label: "Actionable onboarding call",            type: "logged", period: "once" },
    client_portal:       { label: "Your Estara client portal",             type: "included" },
    workflow_improve:    { label: "Workflow & automation improvements",    type: "logged", period: "adhoc" },
    strategy_session:    { label: "Monthly strategy session",              type: "logged", period: "month" },
    quarterly_roadmap:   { label: "Quarterly AI roadmap",                  type: "logged", period: "quarter" },
    fast_turnaround:     { label: "Faster turnaround & priority support",  type: "included" },
    support_chatbot:     { label: "Custom AI support chatbot",             type: "logged", period: "once" },
    branded_portal:      { label: "Custom-branded portal dashboard",       type: "included" },
    consulting:          { label: "Ongoing consulting",                    type: "logged", period: "adhoc" },
    roadmap_reviews:     { label: "Roadmap planning & performance reviews", type: "logged", period: "quarter" },
    ooh_support:         { label: "Out-of-hours support, first in queue",  type: "included" }
  };
  var PLAN_KEYS = {
    "AI Essentials": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates"],
    "AI Growth": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates",
                  "onboarding_call", "client_portal", "workflow_improve", "strategy_session", "quarterly_roadmap", "fast_turnaround"],
    "AI Partner": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates",
                   "onboarding_call", "client_portal", "workflow_improve", "strategy_session", "quarterly_roadmap", "fast_turnaround",
                   "support_chatbot", "branded_portal", "consulting", "roadmap_reviews", "ooh_support"]
  };
  function benefitsForPlan(plan) {
    return (PLAN_KEYS[plan] || []).map(function (k) {
      var b = BENEFITS[k];
      return { key: k, label: b.label, type: b.type, period: b.period || null };
    });
  }
  function samePeriod(dateStr, period) {
    if (!dateStr) return false;
    var d = new Date(dateStr + "T00:00:00");
    var now = new Date();
    if (period === "month") {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (period === "quarter") {
      return d.getFullYear() === now.getFullYear() &&
        Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
    }
    return true; // "once" / "adhoc": any entry counts
  }

  /* ---------- Auth flow ---------- */
  var loadedUserId = null;
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") {
      recoveryMode = true;
      show("viewRecovery");
      return;
    }
    if (recoveryMode) return; // stay on the set-new-password form
    if (session && session.user) {
      if (loadedUserId === session.user.id) return; // already loaded (token refresh etc.)
      loadedUserId = session.user.id;
      // Defer: making Supabase calls directly inside this callback can
      // deadlock the auth client's internal lock (sign-in never resolves).
      var u = session.user;
      setTimeout(function () { loadApp(u); }, 0);
    } else {
      loadedUserId = null;
      show("viewLogin");
    }
  });

  sb.auth.getSession().then(function (res) {
    var session = res.data ? res.data.session : null;
    if (recoveryMode) return;
    if (session && session.user) {
      if (loadedUserId === session.user.id) return;
      loadedUserId = session.user.id;
      loadApp(session.user);
    } else if (!loadedUserId) {
      show("viewLogin");
    }
  });

  /* ---------- Login ---------- */
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("loginBtn");
    setMsg($("loginError"), "");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    var settled = false;
    function resetBtn() {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
    // Watchdog: never leave the button stuck
    setTimeout(function () {
      if (!settled) {
        resetBtn();
        setMsg($("loginError"), "That took too long — please try again.");
      }
    }, 10000);
    sb.auth.signInWithPassword({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value
    }).then(function (res) {
      settled = true;
      resetBtn();
      if (res.error) {
        var msg = /invalid/i.test(res.error.message)
          ? "Incorrect email or password."
          : res.error.message;
        setMsg($("loginError"), msg);
        return;
      }
      var user = res.data && res.data.user;
      if (user && loadedUserId !== user.id) {
        loadedUserId = user.id;
        loadApp(user);
      }
    }).catch(function (err) {
      settled = true;
      resetBtn();
      setMsg($("loginError"), "Sign-in failed: " + (err && err.message ? err.message : "unknown error"));
    });
  });

  /* ---------- Forgot password ---------- */
  $("forgotBtn").addEventListener("click", function () {
    $("forgotEmail").value = $("loginEmail").value;
    setMsg($("forgotError"), "");
    setMsg($("forgotOk"), "");
    show("viewForgot");
  });
  $("backToLoginBtn").addEventListener("click", function () { show("viewLogin"); });

  $("forgotForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("forgotSendBtn");
    setMsg($("forgotError"), "");
    setMsg($("forgotOk"), "");
    btn.disabled = true;
    sb.auth.resetPasswordForEmail($("forgotEmail").value.trim(), {
      redirectTo: window.location.origin + "/portal/"
    }).then(function (res) {
      btn.disabled = false;
      if (res.error) setMsg($("forgotError"), res.error.message);
      else setMsg($("forgotOk"), "If that account exists, a reset link is on its way. Check your inbox.");
    });
  });

  /* ---------- Set new password (from reset email) ---------- */
  $("recoveryForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var p1 = $("newPassword").value;
    var p2 = $("newPassword2").value;
    setMsg($("recoveryError"), "");
    if (p1 !== p2) { setMsg($("recoveryError"), "Passwords don't match."); return; }
    var btn = $("recoveryBtn");
    btn.disabled = true;
    sb.auth.updateUser({ password: p1 }).then(function (res) {
      btn.disabled = false;
      if (res.error) { setMsg($("recoveryError"), res.error.message); return; }
      recoveryMode = false;
      sb.auth.getUser().then(function (r) {
        if (r.data && r.data.user) loadApp(r.data.user);
        else show("viewLogin");
      });
    });
  });

  /* ---------- Sign out ---------- */
  $("signOutBtn").addEventListener("click", function () {
    sb.auth.signOut().then(function () {
      profile = null; isAdmin = false; inAdminView = false;
      show("viewLogin");
    });
  });

  /* ---------- Load app after sign-in ---------- */
  function loadApp(user) {
    show("viewLoading");
    sb.from("profiles").select("*").eq("id", user.id).single().then(function (res) {
      if (res.error || !res.data) {
        show("viewLogin");
        setMsg($("loginError"), "Couldn't load your account. Please contact support@estaraai.com.");
        return;
      }
      profile = res.data;
      isAdmin = !!profile.is_admin;
      $("navUser").textContent = profile.full_name || profile.email;
      $("adminToggleBtn").hidden = !isAdmin;
      show("viewApp");
      if (isAdmin) {
        enterAdminView(); // admin lands on the admin panel
      } else {
        enterClientView();
      }
    });
  }

  /* ---------- View switching (admin <-> client preview) ---------- */
  $("adminToggleBtn").addEventListener("click", function () {
    if (inAdminView) enterClientView(); else enterAdminView();
  });

  function enterClientView() {
    inAdminView = false;
    $("adminView").hidden = true;
    $("clientView").hidden = false;
    $("adminToggleBtn").textContent = "Admin panel";
    renderClientDashboard(profile);
  }

  function enterAdminView() {
    if (!isAdmin) return;
    inAdminView = true;
    $("clientView").hidden = true;
    $("adminView").hidden = false;
    $("adminToggleBtn").textContent = "My dashboard";
    loadClients();
  }

  /* ============================================================
     CLIENT DASHBOARD
     ============================================================ */
  function renderClientDashboard(p) {
    var first = (p.full_name || "").split(" ")[0];
    $("welcomeTitle").textContent = first ? "Welcome, " + first : "Welcome";
    $("welcomeSub").textContent = (p.company ? p.company + " — " : "") + "here's where your work with Estara AI stands.";
    $("planName").textContent = p.plan || "—";

    var mh = Number(p.monthly_hours) || 0;
    var hu = Number(p.hours_used) || 0;
    $("hoursText").textContent = hu + " / " + mh;
    $("hoursBar").style.width = (mh > 0 ? Math.min(100, (hu / mh) * 100) : 0) + "%";
    $("autosText").textContent = (Number(p.automations_delivered) || 0) + " / " + (Number(p.automations_included) || 0);

    fetchBenefits(p.id, p.plan, $("benefitsList"));
    fetchUpdates(p.id, $("updatesList"), false);
    fetchTickets(p.id, $("ticketsList"), false);
    fetchFiles(p.id, $("filesList"), false);
  }

  /* ---------- Plan benefits (client) ---------- */
  function fetchBenefits(clientId, plan, listEl) {
    var defs = benefitsForPlan(plan);
    if (!defs.length) {
      listEl.innerHTML = '<p class="empty">You’re set up as a project client — work is scoped per project rather than as a monthly plan.</p>';
      return;
    }
    sb.from("benefit_log").select("*").eq("client_id", clientId)
      .order("delivered_on", { ascending: false })
      .then(function (res) {
        var logs = res.data || [];
        listEl.innerHTML = defs.map(function (b) {
          var mine = logs.filter(function (l) { return l.benefit_key === b.key; });
          var latest = mine[0] || null;
          var chip, detail = "";
          if (b.type === "included") {
            chip = '<span class="chip chip-green">Active</span>';
            detail = "Included in your plan — always on.";
          } else if (b.period === "adhoc") {
            chip = mine.length
              ? '<span class="chip chip-accent">' + mine.length + " delivered</span>"
              : '<span class="chip chip-dim">Ongoing</span>';
            detail = latest ? "Last: " + fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "") : "Delivered as and when needed.";
          } else if (b.period === "once") {
            var doneOnce = !!latest;
            chip = doneOnce ? '<span class="chip chip-green">Completed</span>' : '<span class="chip chip-dim">Upcoming</span>';
            detail = doneOnce ? fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "") : "We’ll arrange this with you.";
          } else {
            var word = b.period === "quarter" ? "quarter" : "month";
            var done = latest && samePeriod(latest.delivered_on, b.period);
            chip = done
              ? '<span class="chip chip-green">Done this ' + word + "</span>"
              : '<span class="chip chip-amber">Due this ' + word + "</span>";
            detail = latest ? "Last: " + fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "") : "Not delivered yet.";
          }
          return '<div class="benefit">' +
            '<div class="benefit-head"><span class="benefit-label">' + esc(b.label) + "</span>" + chip + "</div>" +
            '<p class="benefit-detail">' + detail + "</p>" +
          "</div>";
        }).join("");
      });
  }

  /* ---------- Updates ---------- */
  function fetchUpdates(clientId, listEl, admin) {
    sb.from("updates").select("*").eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) {
          listEl.innerHTML = '<p class="empty">No updates yet' + (admin ? "." : " — they'll appear here as work progresses.") + "</p>";
          return;
        }
        listEl.innerHTML = rows.map(function (u) {
          return '<div class="item">' +
            '<div class="item-head"><h3>' + esc(u.title) + "</h3>" + statusChip(u.status) + "</div>" +
            '<p class="item-body">' + esc(u.body) + "</p>" +
            '<p class="item-date">' + fmtDate(u.created_at) + "</p>" +
            (admin ? '<div class="item-actions">' +
              '<button class="btn btn-ghost btn-sm" data-action="update-status" data-id="' + u.id + '" data-status="' + esc(u.status) + '">Next status</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="update-delete" data-id="' + u.id + '">Delete</button>' +
            "</div>" : "") +
          "</div>";
        }).join("");
      });
  }

  /* ---------- Tickets ---------- */
  function ticketHtml(t, admin) {
    var msgs = (t.ticket_messages || []).slice().sort(function (a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });
    var thread = msgs.map(function (m) {
      var mine = m.is_admin_sender;
      return '<div class="msg ' + (mine ? "msg-admin" : "msg-client") + '">' +
        esc(m.body) +
        '<span class="msg-meta">' + (mine ? "Estara AI" : "You") + " · " + fmtDate(m.created_at) + "</span>" +
      "</div>";
    }).join("");
    if (admin) {
      thread = msgs.map(function (m) {
        var fromAdmin = m.is_admin_sender;
        return '<div class="msg ' + (fromAdmin ? "msg-admin" : "msg-client") + '">' +
          esc(m.body) +
          '<span class="msg-meta">' + (fromAdmin ? "You (Estara)" : "Client") + " · " + fmtDate(m.created_at) + "</span>" +
        "</div>";
      }).join("");
    }
    return '<div class="item" data-ticket="' + t.id + '">' +
      '<div class="item-head"><h3>' + esc(t.subject) + "</h3>" + statusChip(t.status) + "</div>" +
      '<p class="item-date">Opened ' + fmtDate(t.created_at) + "</p>" +
      '<div class="thread">' + thread + "</div>" +
      (t.status !== "resolved"
        ? '<form class="reply-form" data-action="reply" data-id="' + t.id + '">' +
            '<input type="text" placeholder="Write a reply…" maxlength="1000" required />' +
            '<button type="submit" class="btn btn-primary btn-sm">Send</button>' +
          "</form>"
        : "") +
      (admin
        ? '<div class="item-actions">' +
            (t.status !== "resolved"
              ? '<button class="btn btn-ghost btn-sm" data-action="ticket-resolve" data-id="' + t.id + '">Mark resolved</button>'
              : '<button class="btn btn-ghost btn-sm" data-action="ticket-reopen" data-id="' + t.id + '">Reopen</button>') +
          "</div>"
        : "") +
    "</div>";
  }

  function fetchTickets(clientId, listEl, admin) {
    sb.from("tickets").select("*, ticket_messages(*)").eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) {
          listEl.innerHTML = '<p class="empty">No support requests' + (admin ? " for this client." : " yet.") + "</p>";
          return;
        }
        listEl.innerHTML = rows.map(function (t) { return ticketHtml(t, admin); }).join("");
      });
  }

  /* ---------- Files ---------- */
  function fetchFiles(clientId, listEl, admin) {
    sb.from("files").select("*").eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) {
          listEl.innerHTML = '<p class="empty">No files shared yet.</p>';
          return;
        }
        listEl.innerHTML = rows.map(function (f) {
          return '<div class="item">' +
            '<div class="item-head"><a class="file-link" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + " &rarr;</a>" +
            '<span class="item-date">' + fmtDate(f.created_at) + "</span></div>" +
            (f.note ? '<p class="item-body">' + esc(f.note) + "</p>" : "") +
            (admin ? '<div class="item-actions"><button class="btn btn-ghost btn-sm" data-action="file-delete" data-id="' + f.id + '">Remove</button></div>' : "") +
          "</div>";
        }).join("");
      });
  }

  /* ---------- New ticket (client) ---------- */
  $("newTicketBtn").addEventListener("click", function () {
    $("ticketForm").hidden = !$("ticketForm").hidden;
  });
  $("ticketCancelBtn").addEventListener("click", function () {
    $("ticketForm").hidden = true;
  });
  $("ticketForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var subject = $("ticketSubject").value.trim();
    var body = $("ticketBody").value.trim();
    if (!subject || !body) return;
    sb.from("tickets").insert({ client_id: profile.id, subject: subject })
      .select().single()
      .then(function (res) {
        if (res.error || !res.data) return;
        return sb.from("ticket_messages").insert({
          ticket_id: res.data.id, sender_id: profile.id, is_admin_sender: false, body: body
        });
      })
      .then(function () {
        $("ticketForm").hidden = true;
        $("ticketSubject").value = "";
        $("ticketBody").value = "";
        fetchTickets(profile.id, $("ticketsList"), false);
      });
  });

  /* ---------- Shared list actions (event delegation) ---------- */
  document.addEventListener("submit", function (e) {
    var form = e.target.closest('form[data-action="reply"]');
    if (!form) return;
    e.preventDefault();
    var input = form.querySelector("input");
    var body = input.value.trim();
    if (!body) return;
    var ticketId = form.getAttribute("data-id");
    sb.from("ticket_messages").insert({
      ticket_id: Number(ticketId),
      sender_id: profile.id,
      is_admin_sender: inAdminView && isAdmin,
      body: body
    }).then(function () { refreshTicketLists(); });
  });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");

    if (action === "ticket-resolve" || action === "ticket-reopen") {
      sb.from("tickets").update({ status: action === "ticket-resolve" ? "resolved" : "open" })
        .eq("id", Number(id)).then(refreshTicketLists);
    }
    if (action === "update-status") {
      var next = { planned: "in_progress", in_progress: "done", done: "planned" }[btn.getAttribute("data-status")] || "in_progress";
      sb.from("updates").update({ status: next }).eq("id", Number(id))
        .then(function () { fetchUpdates(selectedClientId, $("adminUpdatesList"), true); });
    }
    if (action === "update-delete") {
      sb.from("updates").delete().eq("id", Number(id))
        .then(function () { fetchUpdates(selectedClientId, $("adminUpdatesList"), true); });
    }
    if (action === "file-delete") {
      sb.from("files").delete().eq("id", Number(id))
        .then(function () { fetchFiles(selectedClientId, $("adminFilesList"), true); });
    }
    if (action === "benefit-delete") {
      sb.from("benefit_log").delete().eq("id", Number(id))
        .then(function () { fetchAdminBenefitLog(selectedClientId); });
    }
  });

  function refreshTicketLists() {
    if (inAdminView) fetchTickets(selectedClientId, $("adminTicketsList"), true);
    else fetchTickets(profile.id, $("ticketsList"), false);
  }

  /* ============================================================
     ADMIN PANEL
     ============================================================ */
  function loadClients() {
    sb.from("profiles").select("*").order("created_at", { ascending: true })
      .then(function (res) {
        clients = res.data || [];
        var sel = $("clientSelect");
        sel.innerHTML = clients.map(function (c) {
          var label = (c.full_name || c.email) + (c.company ? " — " + c.company : "") + (c.is_admin ? " (admin)" : "");
          return '<option value="' + esc(c.id) + '">' + esc(label) + "</option>";
        }).join("");
        var keep = clients.some(function (c) { return c.id === selectedClientId; });
        selectedClientId = keep ? selectedClientId : (clients.length ? clients[0].id : null);
        if (selectedClientId) {
          sel.value = selectedClientId;
          renderAdminClient();
        }
      });
  }

  $("clientSelect").addEventListener("change", function () {
    selectedClientId = this.value;
    renderAdminClient();
  });

  function selectedClient() {
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].id === selectedClientId) return clients[i];
    }
    return null;
  }

  function renderAdminClient() {
    var c = selectedClient();
    if (!c) return;
    $("adminName").value = c.full_name || "";
    $("adminCompany").value = c.company || "";
    $("adminPlan").value = c.plan || "AI Essentials";
    $("adminMonthlyHours").value = c.monthly_hours != null ? c.monthly_hours : 0;
    $("adminHoursUsed").value = c.hours_used != null ? c.hours_used : 0;
    $("adminAutosIncluded").value = c.automations_included != null ? c.automations_included : 0;
    $("adminAutosDelivered").value = c.automations_delivered != null ? c.automations_delivered : 0;
    setMsg($("adminProfileError"), "");
    setMsg($("adminProfileOk"), "");
    renderBenefitOptions(c.plan);
    fetchAdminBenefitLog(c.id);
    fetchUpdates(c.id, $("adminUpdatesList"), true);
    fetchTickets(c.id, $("adminTicketsList"), true);
    fetchFiles(c.id, $("adminFilesList"), true);
  }

  /* ---------- Benefit logging (admin) ---------- */
  function renderBenefitOptions(plan) {
    var loggable = benefitsForPlan(plan).filter(function (b) { return b.type === "logged"; });
    $("adminBenefitKey").innerHTML = loggable.length
      ? loggable.map(function (b) {
          return '<option value="' + esc(b.key) + '">' + esc(b.label) + "</option>";
        }).join("")
      : '<option value="">No loggable benefits on this plan</option>';
    $("adminBenefitDate").value = new Date().toISOString().slice(0, 10);
  }

  function fetchAdminBenefitLog(clientId) {
    sb.from("benefit_log").select("*").eq("client_id", clientId)
      .order("delivered_on", { ascending: false }).limit(30)
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) {
          $("adminBenefitLog").innerHTML = '<p class="empty">Nothing logged for this client yet.</p>';
          return;
        }
        $("adminBenefitLog").innerHTML = rows.map(function (l) {
          var def = BENEFITS[l.benefit_key];
          return '<div class="item">' +
            '<div class="item-head"><h3>' + esc(def ? def.label : l.benefit_key) + "</h3>" +
            '<span class="item-date">' + fmtDate(l.delivered_on) + "</span></div>" +
            (l.note ? '<p class="item-body">' + esc(l.note) + "</p>" : "") +
            '<div class="item-actions"><button class="btn btn-ghost btn-sm" data-action="benefit-delete" data-id="' + l.id + '">Remove</button></div>' +
          "</div>";
        }).join("");
      });
  }

  $("adminBenefitForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var key = $("adminBenefitKey").value;
    if (!selectedClientId || !key) return;
    sb.from("benefit_log").insert({
      client_id: selectedClientId,
      benefit_key: key,
      delivered_on: $("adminBenefitDate").value,
      note: $("adminBenefitNote").value.trim()
    }).then(function (res) {
      if (res.error) return;
      $("adminBenefitNote").value = "";
      fetchAdminBenefitLog(selectedClientId);
    });
  });

  /* ---------- Save client profile ---------- */
  $("adminProfileForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedClientId) return;
    setMsg($("adminProfileError"), "");
    setMsg($("adminProfileOk"), "");
    sb.from("profiles").update({
      full_name: $("adminName").value.trim(),
      company: $("adminCompany").value.trim(),
      plan: $("adminPlan").value,
      monthly_hours: Number($("adminMonthlyHours").value) || 0,
      hours_used: Number($("adminHoursUsed").value) || 0,
      automations_included: Number($("adminAutosIncluded").value) || 0,
      automations_delivered: Number($("adminAutosDelivered").value) || 0
    }).eq("id", selectedClientId).then(function (res) {
      if (res.error) { setMsg($("adminProfileError"), res.error.message); return; }
      setMsg($("adminProfileOk"), "Saved.");
      loadClients();
      if (selectedClientId === profile.id) {
        sb.from("profiles").select("*").eq("id", profile.id).single().then(function (r) {
          if (r.data) profile = r.data;
        });
      }
    });
  });

  /* ---------- Post update ---------- */
  $("adminUpdateForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedClientId) return;
    sb.from("updates").insert({
      client_id: selectedClientId,
      title: $("adminUpdateTitle").value.trim(),
      body: $("adminUpdateBody").value.trim(),
      status: $("adminUpdateStatus").value
    }).then(function (res) {
      if (res.error) return;
      $("adminUpdateTitle").value = "";
      $("adminUpdateBody").value = "";
      fetchUpdates(selectedClientId, $("adminUpdatesList"), true);
    });
  });

  /* ---------- Share file ---------- */
  $("adminFileForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedClientId) return;
    sb.from("files").insert({
      client_id: selectedClientId,
      name: $("adminFileName").value.trim(),
      url: $("adminFileUrl").value.trim(),
      note: $("adminFileNote").value.trim()
    }).then(function (res) {
      if (res.error) return;
      $("adminFileName").value = "";
      $("adminFileUrl").value = "";
      $("adminFileNote").value = "";
      fetchFiles(selectedClientId, $("adminFilesList"), true);
    });
  });

})();
