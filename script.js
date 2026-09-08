/* ============================================================
   ESTARA AI — script.js  (v13 — "Engineered")
   Nav · mobile menu · scroll reveals · counters ·
   3D wireframe brain (Three.js, hero only)
   ============================================================ */

(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Sticky nav ---------- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () { links.classList.toggle("open"); });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") links.classList.remove("open");
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.1 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ---------- Animated counters (optional [data-count]) ---------- */
  var counters = document.querySelectorAll("[data-count]");
  function animateCounter(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (reducedMotion) { el.textContent = target.toLocaleString(); return; }
    var start = null;
    function tick(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / 1600, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if (counters.length && "IntersectionObserver" in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { animateCounter(entry.target); cio.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ============================================================
     3D WIREFRAME BRAIN
     Procedurally generated: two hemispheres (lateral surfaces
     rounded, medial faces flat), cortical folds, hand-drawn-style
     sulci curves, a cerebellum with folia rings and a brain stem.
     A nearest-neighbour "synapse" network links the points and
     signals travel along it. Reacts to the mouse; slow rotation.
     ============================================================ */
  var canvas = document.getElementById("brainCanvas");
  if (!canvas || typeof THREE === "undefined") return;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  } catch (err) {
    canvas.style.display = "none";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.1, 4.1);

  var BASE_X = 0.3, BASE_Y = -0.85;
  var group = new THREE.Group();
  group.rotation.x = BASE_X;
  group.rotation.y = BASE_Y;
  scene.add(group);

  /* deterministic pseudo-random: the brain looks identical on every load */
  var seed = 11;
  function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  /* cortical folds: layered sines modulate the surface radius */
  function folds(t, p) {
    return 1 + 0.06 * Math.sin(6 * t + 2 * p) + 0.05 * Math.sin(10 * p + 1.7 * t) + 0.03 * Math.sin(15 * t - 4 * p);
  }

  /* a point on the surface of hemisphere s (-1 left, +1 right) at spherical angles (t, p) */
  function surf(s, t, p) {
    var r = folds(t, p);
    var px = Math.sin(p) * Math.cos(t), py = Math.cos(p), pz = Math.sin(p) * Math.sin(t);
    var lateral = px * s > 0;
    var x = s * (0.05 + Math.abs(px) * (lateral ? 0.56 : 0.14)) * r;
    var y = py * 0.64 * r + 0.08;
    var z = pz * 0.98 * r;
    if (z > 0.5) y -= (z - 0.5) * 0.25;          // frontal lobe slopes down
    if (z < -0.55) y += (z + 0.55) * 0.35;       // occipital lobe tapers
    if (y < -0.3) y = -0.3 + (y + 0.3) * 0.55;   // flatter underside
    return [x, y, z];
  }

  var pts = [], curves = [];
  var s, i, k, t, p, q, line;

  /* cerebrum surface points */
  for (s = -1; s <= 1; s += 2) {
    for (i = 0; i < 650; i++) {
      t = 2 * Math.PI * rand(); p = Math.acos(2 * rand() - 1);
      q = surf(s, t, p); pts.push(q[0], q[1], q[2]);
    }
  }

  /* sulci: wandering curves drawn on each hemisphere */
  for (s = -1; s <= 1; s += 2) {
    for (i = 0; i < 18; i++) {
      t = 2 * Math.PI * rand(); p = 0.35 + rand() * 2.2;
      var dir = rand() * Math.PI * 2;
      line = [];
      for (k = 0; k < 46; k++) {
        q = surf(s, t, p); line.push(q[0], q[1], q[2]);
        dir += (rand() - 0.5) * 0.5;
        t += Math.cos(dir) * 0.05; p += Math.sin(dir) * 0.05;
        if (p < 0.25) p = 0.25; if (p > 2.6) p = 2.6;
      }
      curves.push(line);
    }
  }

  /* cerebellum: points + horizontal folia rings */
  for (i = 0; i < 220; i++) {
    t = 2 * Math.PI * rand(); p = Math.acos(2 * rand() - 1);
    var cr = 1 + 0.05 * Math.sin(12 * t);
    pts.push(Math.sin(p) * Math.cos(t) * 0.5 * cr, Math.cos(p) * 0.3 * cr - 0.62, Math.sin(p) * Math.sin(t) * 0.4 * cr - 0.75);
  }
  for (i = 0; i < 7; i++) {
    var yy = -0.62 + (-0.26 + i * 0.085);
    var rad = Math.sqrt(Math.max(0, 1 - Math.pow((yy + 0.62) / 0.3, 2)));
    line = [];
    for (k = 0; k <= 40; k++) {
      var a = Math.PI * (0.15 + 0.7 * k / 40);
      var w = 1 + 0.05 * Math.sin(10 * a);
      line.push(Math.cos(a) * 0.5 * rad * w, yy, -0.75 - Math.sin(a) * 0.4 * rad * w);
    }
    curves.push(line);
  }

  /* brain stem */
  for (i = 0; i < 70; i++) {
    var sa = rand() * 6.283, rr = 0.13 * Math.sqrt(rand()), sy = -0.78 - rand() * 0.4;
    pts.push(Math.cos(sa) * rr, sy, -0.35 + Math.sin(sa) * rr - (sy + 0.78) * 0.3);
  }

  var count = pts.length / 3;
  var positions = new Float32Array(pts);

  /* nearest-neighbour synapse network */
  var LINK = 0.17, LINK2 = LINK * LINK;
  var adj = [], edge = [];
  for (i = 0; i < count; i++) adj.push([]);
  for (var a1 = 0; a1 < count; a1++) {
    var ax = positions[a1 * 3], ay = positions[a1 * 3 + 1], az = positions[a1 * 3 + 2];
    for (var b1 = a1 + 1; b1 < count; b1++) {
      var dx = ax - positions[b1 * 3]; if (dx > LINK || dx < -LINK) continue;
      var dy = ay - positions[b1 * 3 + 1]; if (dy > LINK || dy < -LINK) continue;
      var dz = az - positions[b1 * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < LINK2 && adj[a1].length < 7 && adj[b1].length < 7) {
        edge.push(a1, b1); adj[a1].push(b1); adj[b1].push(a1);
      }
    }
  }
  var linePos = new Float32Array(edge.length * 3);
  for (i = 0; i < edge.length; i++) {
    var pi = edge[i] * 3;
    linePos[i * 3] = positions[pi]; linePos[i * 3 + 1] = positions[pi + 1]; linePos[i * 3 + 2] = positions[pi + 2];
  }

  /* geometry */
  var pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  group.add(new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: 0x0a0a0a, size: 0.032, transparent: true, opacity: 0.85, sizeAttenuation: true })));

  var lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x2f5bff, transparent: true, opacity: 0.22 })));

  var sulciMat = new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.75 });
  curves.forEach(function (c) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(c), 3));
    group.add(new THREE.Line(g, sulciMat));
  });

  /* travelling signals */
  var SIGNALS = 48;
  var sigPos = new Float32Array(SIGNALS * 3);
  var signals = [];
  for (i = 0; i < SIGNALS; i++) {
    var st = Math.floor(rand() * count);
    while (!adj[st].length) st = Math.floor(rand() * count);
    signals.push({ from: st, to: adj[st][0], t: rand(), speed: 0.012 + rand() * 0.02 });
  }
  var sigGeo = new THREE.BufferGeometry();
  sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3));
  group.add(new THREE.Points(sigGeo, new THREE.PointsMaterial({ color: 0x2f5bff, size: 0.065, transparent: true, opacity: 0.95, sizeAttenuation: true })));

  function stepSignals() {
    for (var n = 0; n < SIGNALS; n++) {
      var sg = signals[n];
      sg.t += sg.speed;
      if (sg.t >= 1) {
        sg.t = 0;
        var nb = adj[sg.to], prev = sg.from;
        sg.from = sg.to;
        sg.to = nb.length > 1 ? nb[(nb.indexOf(prev) + 1 + Math.floor(Math.random() * (nb.length - 1))) % nb.length] : nb[0];
      }
      var f = sg.from * 3, to = sg.to * 3;
      sigPos[n * 3] = positions[f] + (positions[to] - positions[f]) * sg.t;
      sigPos[n * 3 + 1] = positions[f + 1] + (positions[to + 1] - positions[f + 1]) * sg.t;
      sigPos[n * 3 + 2] = positions[f + 2] + (positions[to + 2] - positions[f + 2]) * sg.t;
    }
    sigGeo.attributes.position.needsUpdate = true;
  }

  /* sizing */
  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  /* mouse influence — tracked across the whole window */
  var targetX = 0, targetY = 0;
  window.addEventListener("mousemove", function (ev) {
    targetY = ((ev.clientX / window.innerWidth) - 0.5) * 0.9;
    targetX = ((ev.clientY / window.innerHeight) - 0.5) * 0.5;
  }, { passive: true });

  /* render loop — pauses while the hero is off-screen */
  var spin = 0, running = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) { running = entries[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
  }
  function frame() {
    requestAnimationFrame(frame);
    if (!running) return;
    spin += 0.0022;
    group.rotation.y += ((BASE_Y + spin + targetY) - group.rotation.y) * 0.05;
    group.rotation.x += ((BASE_X + targetX) - group.rotation.x) * 0.05;
    stepSignals();
    renderer.render(scene, camera);
  }
  if (reducedMotion) {
    stepSignals();
    renderer.render(scene, camera);
  } else {
    frame();
  }
})();
