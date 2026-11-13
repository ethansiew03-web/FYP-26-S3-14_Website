/* main.js - JavaScript shared by every page that uses styles.css.
   1. Mailing list form (checks the fields only, does NOT save emails yet)
   2. Fade-in on scroll (.reveal)
   3. Animated particle background on <canvas id="bg">
      index.html also loads js/index-effects.js (before this file). That file sets
      window.bgScene, which fades the particles and draws the planet.
*/

/* ===== 1. Mailing list form ===== */
const mailingForm = document.getElementById("mailing-form");
if (mailingForm) {
  mailingForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("mail-email");
    const consent = document.getElementById("mail-consent");
    const msg = document.getElementById("mail-msg");
    if (!email.checkValidity()) { msg.textContent = "Enter a valid email address."; return; }
    if (!consent.checked) { msg.textContent = "Tick the box to agree to marketing emails."; return; }
    msg.textContent = "Feature coming soon.";
  });
}

/* ===== 2. Fade-in on scroll ===== */
const io = new IntersectionObserver((entries) => {
  entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));


/* ===== 3. Background animation ===== */
(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Optional extra motion (only the home page has it). See js/index-effects.js
  const scene = window.bgScene || null;

  // Small seeded random generator so the particle field looks the same every visit
  let seed = 321;
  function rand() {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  const between = (a, b) => a + rand() * (b - a);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ---- Settings you can tweak ----
  const DEPTH = 60, SPREAD = 45, SPEED = 1.6, HORIZON = 0.42;

  // ---- Build the particle field ----
  const pts = [];
  const add = (x, y, z) => pts.push({ x, y, z, b: between(1, 1), tw: rand() * Math.PI * 2 });
  for (let c = 0; c < 55; c++) {
    const cx = between(-SPREAD, SPREAD), cy = between(-7, -0.8), cz = between(0, DEPTH);
    const nx = 2 + Math.floor(rand() * 5), ny = 1 + Math.floor(rand() * 3), nz = 2 + Math.floor(rand() * 5);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++)
      if (rand() < 0.55) add(cx + i * 0.45, cy + j * 0.45, cz + k * 0.45);
  }
  for (let l = 0; l < 30; l++) {
    let x = between(-SPREAD, SPREAD), y = between(-6, -0.5), z = between(0, DEPTH);
    const dx = (rand() - 0.5) * 0.3, n = 10 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) { add(x, y, z); x += dx; z += 1.2; }
  }
  for (let s = 0; s < 500; s++) add(between(-SPREAD, SPREAD), between(-9, 0.6), between(0, DEPTH));

  // Soft glowing dot that every particle is drawn with
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const sctx = sprite.getContext("2d");
  const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "#fff"); g.addColorStop(0.25, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)");
  sctx.fillStyle = g; sctx.fillRect(0, 0, 32, 32);

  let W, H, dpr, focal;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    focal = Math.max(W, H * 1.2) * 0.55;
  }

  function drawParticles(time, camZ) {
    const camX = Math.sin(time * 0.04) * 5, horizonY = H * HORIZON;
    const fade = scene && scene.particles ? scene.particles() : 1;   // home page fades the particles out
    if (fade <= 0) return;
    for (const p of pts) {
      const z = ((p.z - camZ) % DEPTH + DEPTH) % DEPTH;
      if (z < 0.8) continue;
      const x = ((p.x - camX + SPREAD) % (SPREAD * 2) + SPREAD * 2) % (SPREAD * 2) - SPREAD;
      const sx = W / 2 + x * focal / z, sy = horizonY - p.y * focal / z;
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
      const far = clamp01((DEPTH - z) / 28), near = clamp01((z - 0.8) / 3);
      const twinkle = 0.8 + 0.2 * Math.sin(time * 1.5 + p.tw);
      const size = Math.min(10, Math.max(2.6, 55 / z));
      ctx.globalAlpha = fade * p.b * far * near * twinkle;
      ctx.drawImage(sprite, sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function draw(time, camZ) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background colour (same navy as the header)
    ctx.fillStyle = "#1E293B"; ctx.fillRect(0, 0, W, H);

    if (scene && scene.before) scene.before(ctx, W, H, time);
    drawParticles(time, camZ);
    if (scene && scene.after) scene.after(ctx, W, H);
  }

  layout();

  // Visitors who prefer reduced motion get a still picture instead of an animation
  if (reduceMotion) {
    const still = () => draw(0, 0);
    if (scene) window.addEventListener("scroll", still, { passive: true });
    window.addEventListener("resize", () => { layout(); still(); });
    still();
    return;
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 120); });

  let last = performance.now(), camZ = 0;
  function frameLoop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    camZ += SPEED * dt;
    draw(now / 1000, camZ);
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
})();

