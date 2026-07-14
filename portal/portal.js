/* ============================================================
   ESTARA AI PORTAL — portal.js  (v7 — current projects + add clients)
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

  // Did the user arrive from a password-reset email? (must be read from the
  // URL before createClient, which consumes the hash)
  var isRecovery = /type=recovery/.test(window.location.hash);

  // Custom no-op lock: avoids a known supabase-js issue where the shared
  // cross-tab navigator lock leaves sign-in hanging forever.
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      lock: function (_name, _timeout, fn) { return fn(); }
    }
  });

  /* ---------- State ---------- */
  var profile = null;        // my profile row
  var isAdmin = false;
  var clients = [];          // admin: all profiles
  var selectedClientId = null;
  var inAdminView = false;
  var recoveryMode = false;
  var settings = {};         // portal settings (e.g. booking_url)

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
     Expert hours are tracked separately by the usage counter. */
  var BENEFITS = {
    checkin_call:        { label: "Monthly AI check-in call",              type: "logged", period: "month",   book: true },
    recommendations:     { label: "AI & tooling recommendations",          type: "logged", period: "adhoc" },
    business_review:     { label: "Monthly business review",               type: "logged", period: "month",   book: true },
    priority_email:      { label: "Priority email support",                type: "included" },
    systems_support:     { label: "Ongoing maintenance for built systems", type: "included" },
    discounted_rates:    { label: "Discounted rates on project work",      type: "included" },
    onboarding_call:     { label: "Actionable onboarding call",            type: "logged", period: "once",    book: true },
    client_portal:       { label: "Your Estara client portal",             type: "included" },
    workflow_improve:    { label: "Workflow & automation improvements",    type: "logged", period: "adhoc" },
    strategy_session:    { label: "Monthly strategy session",              type: "logged", period: "month",   book: true },
    quarterly_roadmap:   { label: "Quarterly AI roadmap",                  type: "logged", period: "quarter", book: true },
    fast_turnaround:     { label: "Faster turnaround & priority support",  type: "included" },
    support_chatbot:     { label: "Custom AI support chatbot",             type: "logged", period: "once" },
    branded_portal:      { label: "Custom-branded portal dashboard",       type: "included" },
    consulting:          { label: "Ongoing consulting",                    type: "logged", period: "adhoc",   book: true },
    roadmap_reviews:     { label: "Roadmap planning & performance reviews", type: "logged", period: "quarter", book: true },
    ooh_support:         { label: "Out-of-hours support, first in queue",  type: "included" },
    team_training:       { label: "Quarterly team AI training session",    type: "logged", period: "quarter", book: true }
  };
  var PLAN_KEYS = {
    "AI Essentials": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates",
                      "client_portal", "team_training"],
    "AI Growth": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates",
                  "client_portal", "team_training",
                  "onboarding_call", "workflow_improve", "strategy_session", "quarterly_roadmap", "fast_turnaround"],
    "AI Partner": ["checkin_call", "recommendations", "business_review", "priority_email", "systems_support", "discounted_rates",
                   "client_portal", "team_training",
                   "onboarding_call", "workflow_improve", "strategy_session", "quarterly_roadmap", "fast_turnaround",
                   "support_chatbot", "branded_portal", "consulting", "roadmap_reviews", "ooh_support"]
  };
  function benefitsForPlan(plan) {
    return (PLAN_KEYS[plan] || []).map(function (k) {
      var b = BENEFITS[k];
      return { key: k, label: b.label, type: b.type, period: b.period || null, book: !!b.book };
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

  /* ---------- Auth flow (direct, no event listeners) ---------- */
  var loadedUserId = null;

  // On page load: restore an existing session, handle password-reset links,
  // or show the login form. Sign-in itself is handled by the form below.
  sb.auth.getSession().then(function (res) {
    var session = res.data ? res.data.session : null;
    if (isRecovery && session && session.user) {
      recoveryMode = true;
      show("viewRecovery");
      return;
    }
    if (session && session.user) {
      loadedUserId = session.user.id;
      loadApp(session.user);
    } else {
      show("viewLogin");
    }
  }).catch(function () {
    show("viewLogin");
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
      if (user) {
        loadedUserId = user.id;
        loadApp(user);
      } else {
        setMsg($("loginError"), "Sign-in didn't complete — please try again.");
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
      loadedUserId = null;
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
      // Load portal settings (booking calendar link etc.), then show the app.
      sb.from("settings").select("*").then(function (s) {
        settings = {};
        (s.data || []).forEach(function (r) { settings[r.key] = r.value; });
        $("navUser").textContent = profile.full_name || profile.email;
        $("adminToggleBtn").hidden = !isAdmin;
        show("viewApp");
        if (isAdmin) {
          enterAdminView(); // admin lands on the admin panel
        } else {
          enterClientView();
        }
      });
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
    $("adminDetailView").hidden = true;
    $("adminListView").hidden = false;
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

    fetchProjects(p.id, $("projectsList"), false);
    fetchBenefits(p.id, p.plan, $("benefitsList"), false);
    fetchUpdates(p.id, $("updatesList"), false);
    fetchTickets(p.id, $("ticketsList"), false);
    fetchFiles(p.id, $("filesList"), false);
  }

  /* ---------- Plan benefits (client dashboard + admin status) ---------- */
  function bookingStatusHtml(bk) {
    if (bk.status === "confirmed") {
      return '<p class="benefit-detail benefit-booked">Booked' +
        (bk.preferred_date ? " for " + fmtDate(bk.preferred_date) : "") + ".</p>";
    }
    return '<p class="benefit-detail benefit-booked">Requested' +
      (bk.preferred_date ? " for " + fmtDate(bk.preferred_date) : "") +
      " — we’ll confirm shortly.</p>";
  }

  function fetchBenefits(clientId, plan, listEl, forAdmin) {
    var defs = benefitsForPlan(plan);
    if (!defs.length) {
      listEl.innerHTML = forAdmin
        ? '<p class="empty">Project client — no plan benefits to track.</p>'
        : '<p class="empty">You’re set up as a project client — work is scoped per project rather than as a monthly plan.</p>';
      return;
    }
    sb.from("benefit_log").select("*").eq("client_id", clientId)
      .order("delivered_on", { ascending: false })
      .then(function (res) {
        var logs = res.data || [];
        sb.from("bookings").select("*").eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .then(function (bres) {
            var bookings = bres.data || [];
            renderBenefitGrid(listEl, defs, logs, bookings, forAdmin);
          });
      });
  }

  function renderBenefitGrid(listEl, defs, logs, bookings, forAdmin) {
    listEl.innerHTML = defs.map(function (b) {
      var mine = logs.filter(function (l) { return l.benefit_key === b.key; });
      var latest = mine[0] || null;
      var activeBk = null;
      for (var i = 0; i < bookings.length; i++) {
        var bk = bookings[i];
        if (bk.benefit_key === b.key && (bk.status === "requested" || bk.status === "confirmed")) {
          activeBk = bk; break;
        }
      }
      var chip, detail = "", outstanding = false;
      if (b.type === "included") {
        chip = '<span class="chip chip-green">Active</span>';
        detail = forAdmin ? "Included in the plan — always on." : "Included in your plan — always on.";
      } else if (b.period === "adhoc") {
        chip = mine.length
          ? '<span class="chip chip-accent">' + mine.length + " delivered</span>"
          : '<span class="chip chip-dim">Ongoing</span>';
        detail = latest ? "Last: " + fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "") : "Delivered as and when needed.";
        outstanding = true; // can always book more ad-hoc sessions
      } else if (b.period === "once") {
        var doneOnce = !!latest;
        chip = doneOnce ? '<span class="chip chip-green">Completed</span>' : '<span class="chip chip-dim">Upcoming</span>';
        detail = doneOnce
          ? fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "")
          : (forAdmin ? "Not delivered yet." : "We’ll arrange this with you.");
        outstanding = !doneOnce;
      } else {
        var word = b.period === "quarter" ? "quarter" : "month";
        var done = latest && samePeriod(latest.delivered_on, b.period);
        chip = done
          ? '<span class="chip chip-green">Done this ' + word + "</span>"
          : '<span class="chip chip-amber">Due this ' + word + "</span>";
        detail = latest ? "Last: " + fmtDate(latest.delivered_on) + (latest.note ? " — " + esc(latest.note) : "") : "Not delivered yet.";
        outstanding = !done;
      }
      var extra = "";
      if (b.type === "logged" && b.book && outstanding) {
        if (activeBk) {
          extra = bookingStatusHtml(activeBk);
        } else if (!forAdmin) {
          extra = '<div class="benefit-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="benefit-book" data-key="' + esc(b.key) + '">Book this</button>' +
          "</div>";
        }
      }
      return '<div class="benefit" data-benefit="' + esc(b.key) + '">' +
        '<div class="benefit-head"><span class="benefit-label">' + esc(b.label) + "</span>" + chip + "</div>" +
        '<p class="benefit-detail">' + detail + "</p>" +
        extra +
      "</div>";
    }).join("");
  }

  /* ---------- Booking (client) ---------- */
  function bookFormHtml(key) {
    var def = BENEFITS[key] || { label: "Session" };
    var today = new Date().toISOString().slice(0, 10);
    return '<form class="book-form" data-key="' + esc(key) + '">' +
      '<label>Preferred date</label>' +
      '<input type="date" name="date" min="' + today + '" required />' +
      '<label>Anything we should cover? <span class="label-optional">(optional)</span></label>' +
      '<input type="text" name="note" maxlength="200" placeholder="' + esc(def.label) + '" />' +
      '<div class="form-row">' +
        '<button type="submit" class="btn btn-primary btn-sm">Request booking</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="book-cancel">Cancel</button>' +
      "</div>" +
      (settings.booking_url
        ? '<a class="book-cal-link" href="' + esc(settings.booking_url) + '" target="_blank" rel="noopener">Prefer to pick an exact time? Open our calendar &rarr;</a>'
        : "") +
    "</form>";
  }

  function refreshClientBenefits() {
    fetchBenefits(profile.id, profile.plan, $("benefitsList"), false);
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

  /* ---------- Projects ---------- */
  var adminProjects = [];
  var PROJECT_CHIPS = {
    planned:     '<span class="chip chip-dim">Planned</span>',
    in_progress: '<span class="chip chip-accent">In progress</span>',
    review:      '<span class="chip chip-amber">In review</span>',
    done:        '<span class="chip chip-green">Done</span>'
  };
  function fetchProjects(clientId, listEl, admin) {
    sb.from("projects").select("*").eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .then(function (res) {
        var rows = res.data || [];
        if (admin) adminProjects = rows;
        if (!rows.length) {
          listEl.innerHTML = '<p class="empty">' + (admin ? "No projects yet — add one above." : "No projects on the go right now.") + "</p>";
          return;
        }
        listEl.innerHTML = rows.map(function (p) {
          var pct = Math.max(0, Math.min(100, Number(p.progress) || 0));
          return '<div class="project">' +
            '<div class="project-head"><h3 class="project-name">' + esc(p.name) + "</h3>" + (PROJECT_CHIPS[p.status] || "") + "</div>" +
            (p.description ? '<p class="project-desc">' + esc(p.description) + "</p>" : "") +
            '<div class="usage-bar"><span style="width:' + pct + '%"></span></div>' +
            '<p class="project-meta">' + pct + "% complete" +
              (p.due_date ? " &middot; target " + fmtDate(p.due_date) : "") +
              " &middot; started " + fmtDate(p.created_at) + "</p>" +
            (admin ? '<div class="item-actions">' +
              '<button class="btn btn-ghost btn-sm" data-action="project-edit" data-id="' + p.id + '">Edit</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="project-delete" data-id="' + p.id + '">Remove</button>' +
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
    var bform = e.target.closest("form.book-form");
    if (bform) {
      e.preventDefault();
      var key = bform.getAttribute("data-key");
      var date = bform.querySelector('input[name="date"]').value;
      var note = bform.querySelector('input[name="note"]').value.trim();
      if (!key || !date) return;
      sb.from("bookings").insert({
        client_id: profile.id,
        benefit_key: key,
        preferred_date: date,
        note: note
      }).then(function (res) {
        if (!res.error) refreshClientBenefits();
      });
      return;
    }
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
    var card = e.target.closest(".client-card[data-id]");
    if (card) { openAdminClient(card.getAttribute("data-id")); return; }

    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");

    if (action === "benefit-book") {
      var wrap = btn.closest(".benefit");
      var actions = wrap.querySelector(".benefit-actions");
      if (actions) actions.innerHTML = bookFormHtml(btn.getAttribute("data-key"));
      return;
    }
    if (action === "book-cancel") { refreshClientBenefits(); return; }

    if (action === "booking-confirm") {
      sb.from("bookings").update({ status: "confirmed" }).eq("id", Number(id))
        .then(refreshAdminBookingViews);
    }
    if (action === "booking-decline") {
      sb.from("bookings").update({ status: "declined" }).eq("id", Number(id))
        .then(refreshAdminBookingViews);
    }
    if (action === "booking-done") {
      var key = btn.getAttribute("data-key");
      var when = btn.getAttribute("data-date") || new Date().toISOString().slice(0, 10);
      sb.from("benefit_log").insert({
        client_id: selectedClientId, benefit_key: key, delivered_on: when
      }).then(function () {
        return sb.from("bookings").update({ status: "done" }).eq("id", Number(id));
      }).then(function () {
        refreshAdminBookingViews();
        fetchAdminBenefitLog(selectedClientId);
      });
    }
    if (action === "booking-delete") {
      sb.from("bookings").delete().eq("id", Number(id))
        .then(refreshAdminBookingViews);
    }

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
    if (action === "project-edit") {
      for (var i = 0; i < adminProjects.length; i++) {
        if (String(adminProjects[i].id) === id) { fillProjectForm(adminProjects[i]); break; }
      }
    }
    if (action === "project-delete") {
      sb.from("projects").delete().eq("id", Number(id))
        .then(function () { fetchProjects(selectedClientId, $("adminProjectsList"), true); });
    }
  });

  function refreshTicketLists() {
    if (inAdminView) fetchTickets(selectedClientId, $("adminTicketsList"), true);
    else fetchTickets(profile.id, $("ticketsList"), false);
  }

  /* ============================================================
     ADMIN PANEL — client list
     ============================================================ */
  function dueCount(c, logs) {
    return benefitsForPlan(c.plan).filter(function (b) {
      if (b.type !== "logged" || (b.period !== "month" && b.period !== "quarter")) return false;
      return !logs.some(function (l) {
        return l.client_id === c.id && l.benefit_key === b.key && samePeriod(l.delivered_on, b.period);
      });
    }).length;
  }

  function loadClients() {
    Promise.all([
      sb.from("profiles").select("*").order("created_at", { ascending: true }),
      sb.from("benefit_log").select("client_id, benefit_key, delivered_on"),
      sb.from("tickets").select("client_id, status"),
      sb.from("bookings").select("client_id, status")
    ]).then(function (rs) {
      clients = rs[0].data || [];
      var logs = rs[1].data || [];
      var tks  = rs[2].data || [];
      var bks  = rs[3].data || [];
      $("bookingUrlInput").value = settings.booking_url || "";

      if (!clients.length) {
        $("clientList").innerHTML = '<p class="empty">No clients yet.</p>';
        return;
      }
      $("clientList").innerHTML = clients.map(function (c) {
        var due = dueCount(c, logs);
        var open = tks.filter(function (t) { return t.client_id === c.id && t.status === "open"; }).length;
        var reqs = bks.filter(function (b) { return b.client_id === c.id && b.status === "requested"; }).length;
        var mh = Number(c.monthly_hours) || 0;
        var hu = Number(c.hours_used) || 0;
        var chips = "";
        if (reqs) chips += '<span class="chip chip-accent">' + reqs + " booking request" + (reqs > 1 ? "s" : "") + "</span>";
        if (due)  chips += '<span class="chip chip-amber">' + due + " due</span>";
        if (open) chips += '<span class="chip chip-amber">' + open + " open ticket" + (open > 1 ? "s" : "") + "</span>";
        if (!chips) chips = '<span class="chip chip-green">All caught up</span>';
        return '<button type="button" class="client-card panel" data-id="' + esc(c.id) + '">' +
          '<div class="client-card-top">' +
            '<span class="client-card-name">' + esc(c.full_name || c.email) + (c.is_admin ? ' <span class="client-card-you">(you)</span>' : "") + "</span>" +
            '<span class="chip chip-dim">' + esc(c.plan || "—") + "</span>" +
          "</div>" +
          '<p class="client-card-co">' + esc(c.company || c.email) + " &middot; " + hu + " / " + mh + " hrs used</p>" +
          '<div class="client-card-meta">' + chips + "</div>" +
        "</button>";
      }).join("");
    });
  }

  function selectedClient() {
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].id === selectedClientId) return clients[i];
    }
    return null;
  }

  /* ---------- Admin: open one client ---------- */
  function openAdminClient(id) {
    if (!isAdmin) return;
    selectedClientId = id;
    $("adminListView").hidden = true;
    $("adminDetailView").hidden = false;
    window.scrollTo(0, 0);
    renderAdminClient();
  }

  $("backToClientsBtn").addEventListener("click", function () {
    $("adminDetailView").hidden = true;
    $("adminListView").hidden = false;
    loadClients(); // refresh the at-a-glance numbers
  });

  function refreshAdminBookingViews() {
    var c = selectedClient();
    if (!c) return;
    fetchAdminBookings(c.id);
    fetchBenefits(c.id, c.plan, $("adminBenefitStatus"), true);
  }

  function renderAdminClient() {
    var c = selectedClient();
    if (!c) return;
    $("adminClientName").textContent = c.full_name || c.email;
    $("adminClientMeta").textContent = (c.company ? c.company + " · " : "") + c.email;
    $("adminClientPlan").textContent = c.plan || "—";
    var mh = Number(c.monthly_hours) || 0;
    var hu = Number(c.hours_used) || 0;
    $("adminHoursText").textContent = hu + " / " + mh;
    $("adminHoursBar").style.width = (mh > 0 ? Math.min(100, (hu / mh) * 100) : 0) + "%";
    fetchBenefits(c.id, c.plan, $("adminBenefitStatus"), true);
    fetchAdminBookings(c.id);
    $("adminName").value = c.full_name || "";
    $("adminCompany").value = c.company || "";
    $("adminPlan").value = c.plan || "AI Essentials";
    $("adminMonthlyHours").value = c.monthly_hours != null ? c.monthly_hours : 0;
    $("adminHoursUsed").value = c.hours_used != null ? c.hours_used : 0;
    setMsg($("adminProfileError"), "");
    setMsg($("adminProfileOk"), "");
    renderBenefitOptions(c.plan);
    fetchAdminBenefitLog(c.id);
    resetProjectForm();
    fetchProjects(c.id, $("adminProjectsList"), true);
    fetchUpdates(c.id, $("adminUpdatesList"), true);
    fetchTickets(c.id, $("adminTicketsList"), true);
    fetchFiles(c.id, $("adminFilesList"), true);
  }

  /* ---------- Booking requests (admin) ---------- */
  function fetchAdminBookings(clientId) {
    sb.from("bookings").select("*").eq("client_id", clientId)
      .order("created_at", { ascending: false }).limit(30)
      .then(function (res) {
        var rows = res.data || [];
        if (!rows.length) {
          $("adminBookingsList").innerHTML = '<p class="empty">No booking requests from this client.</p>';
          return;
        }
        var chipMap = {
          requested: '<span class="chip chip-amber">Requested</span>',
          confirmed: '<span class="chip chip-accent">Confirmed</span>',
          done:      '<span class="chip chip-green">Delivered</span>',
          declined:  '<span class="chip chip-dim">Declined</span>'
        };
        $("adminBookingsList").innerHTML = rows.map(function (b) {
          var def = BENEFITS[b.benefit_key];
          var actions = "";
          if (b.status === "requested") {
            actions =
              '<button class="btn btn-primary btn-sm" data-action="booking-confirm" data-id="' + b.id + '">Confirm</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="booking-decline" data-id="' + b.id + '">Decline</button>';
          } else if (b.status === "confirmed") {
            actions =
              '<button class="btn btn-primary btn-sm" data-action="booking-done" data-id="' + b.id + '" data-key="' + esc(b.benefit_key) + '" data-date="' + esc(b.preferred_date || "") + '">Mark delivered</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="booking-decline" data-id="' + b.id + '">Cancel it</button>';
          } else {
            actions = '<button class="btn btn-ghost btn-sm" data-action="booking-delete" data-id="' + b.id + '">Remove</button>';
          }
          return '<div class="item">' +
            '<div class="item-head"><h3>' + esc(def ? def.label : b.benefit_key) + "</h3>" + (chipMap[b.status] || "") + "</div>" +
            '<p class="item-body">' +
              (b.preferred_date ? "Preferred date: " + fmtDate(b.preferred_date) : "No date given") +
              (b.note ? " — “" + esc(b.note) + "”" : "") +
            "</p>" +
            '<p class="item-date">Requested ' + fmtDate(b.created_at) + "</p>" +
            '<div class="item-actions">' + actions + "</div>" +
          "</div>";
        }).join("");
      });
  }

  /* ---------- Add a new client (admin) ---------- */
  var PLAN_DEFAULT_HOURS = { "AI Essentials": 1, "AI Growth": 12, "AI Partner": 30 };
  $("newClientPlan").addEventListener("change", function () {
    $("newClientHours").value = PLAN_DEFAULT_HOURS[this.value] != null ? PLAN_DEFAULT_HOURS[this.value] : 0;
  });
  $("newClientForm").addEventListener("submit", function (e) {
    e.preventDefault();
    setMsg($("newClientError"), "");
    setMsg($("newClientOk"), "");
    var btn = $("newClientSubmit");
    btn.disabled = true;
    btn.textContent = "Creating…";
    sb.functions.invoke("create-client", {
      body: {
        email: $("newClientEmail").value.trim(),
        password: $("newClientPassword").value,
        full_name: $("newClientName").value.trim(),
        company: $("newClientCompany").value.trim(),
        plan: $("newClientPlan").value,
        monthly_hours: Number($("newClientHours").value) || 0
      }
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Create client";
      var err = (res.data && res.data.error) || (res.error && res.error.message);
      if (err) { setMsg($("newClientError"), err); return; }
      $("newClientForm").reset();
      $("newClientHours").value = PLAN_DEFAULT_HOURS[$("newClientPlan").value] || 1;
      setMsg($("newClientOk"), "Client created — send them their email and password so they can log in.");
      loadClients();
    });
  });

  /* ---------- Booking calendar link (admin setting) ---------- */
  $("bookingUrlForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var url = $("bookingUrlInput").value.trim();
    setMsg($("bookingUrlOk"), "");
    sb.from("settings").upsert({ key: "booking_url", value: url }).then(function (res) {
      if (res.error) { setMsg($("bookingUrlOk"), "Couldn't save: " + res.error.message); return; }
      settings.booking_url = url;
      setMsg($("bookingUrlOk"), url ? "Saved — clients will now see your calendar link." : "Cleared — bookings stay in the portal.");
    });
  });

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
      hours_used: Number($("adminHoursUsed").value) || 0
    }).eq("id", selectedClientId).then(function (res) {
      if (res.error) { setMsg($("adminProfileError"), res.error.message); return; }
      // Refresh local copy so the header/status update immediately
      sb.from("profiles").select("*").eq("id", selectedClientId).single().then(function (r) {
        if (r.data) {
          for (var i = 0; i < clients.length; i++) {
            if (clients[i].id === selectedClientId) { clients[i] = r.data; break; }
          }
          if (selectedClientId === profile.id) profile = r.data;
          renderAdminClient();
          setMsg($("adminProfileOk"), "Saved.");
        }
      });
    });
  });

  /* ---------- Projects (admin) ---------- */
  function resetProjectForm() {
    $("adminProjectId").value = "";
    $("adminProjectName").value = "";
    $("adminProjectDesc").value = "";
    $("adminProjectStatus").value = "in_progress";
    $("adminProjectProgress").value = 0;
    $("adminProjectDue").value = "";
    $("adminProjectSubmit").textContent = "Add project";
    $("adminProjectCancel").hidden = true;
    setMsg($("adminProjectError"), "");
  }
  function fillProjectForm(p) {
    $("adminProjectId").value = p.id;
    $("adminProjectName").value = p.name || "";
    $("adminProjectDesc").value = p.description || "";
    $("adminProjectStatus").value = p.status || "in_progress";
    $("adminProjectProgress").value = Number(p.progress) || 0;
    $("adminProjectDue").value = p.due_date || "";
    $("adminProjectSubmit").textContent = "Save changes";
    $("adminProjectCancel").hidden = false;
    $("adminProjectName").focus();
  }
  $("adminProjectCancel").addEventListener("click", resetProjectForm);
  $("adminProjectForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedClientId) return;
    setMsg($("adminProjectError"), "");
    var payload = {
      name: $("adminProjectName").value.trim(),
      description: $("adminProjectDesc").value.trim(),
      status: $("adminProjectStatus").value,
      progress: Math.max(0, Math.min(100, Number($("adminProjectProgress").value) || 0)),
      due_date: $("adminProjectDue").value || null
    };
    var editId = $("adminProjectId").value;
    if (!editId) payload.client_id = selectedClientId;
    var q = editId
      ? sb.from("projects").update(payload).eq("id", Number(editId))
      : sb.from("projects").insert(payload);
    q.then(function (res) {
      if (res.error) { setMsg($("adminProjectError"), res.error.message); return; }
      resetProjectForm();
      fetchProjects(selectedClientId, $("adminProjectsList"), true);
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
