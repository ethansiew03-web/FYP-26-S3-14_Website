/* index-effects.js - extra background for index.html only.
   Load it BEFORE js/main.js. It sets window.bgScene, which main.js reads every frame.

   What it does:
     hero (top of page)     the drifting particle field, like the original
     below the hero         the particles fade out and the planet horizon rises in
     just before "Ready     the planet fades away again, back to the flat navy
     to audit your app?"
     screenshots            slide slightly slower than the text beside them (parallax)
*/
(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel) => document.querySelector(sel);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  const hero = $(".hero");
  const ctaSect = $(".cta");
  const parallaxEls = Array.from(document.querySelectorAll("[data-parallax]"));

  let H = window.innerHeight;
  const S = { particles: 1, planet: 0, rise: 0 };

  // Works out how visible the particles / planet are for the current scroll position
  function measure() {
    const heroBottom = hero ? hero.getBoundingClientRect().bottom : 0; // px from top of screen
    const ctaTop = ctaSect ? ctaSect.getBoundingClientRect().top : H * 2;

    // Particles: full while the hero is on screen, gone once it has scrolled away
    S.particles = 1 - smooth(H * 0.85, H * 0.25, heroBottom);

    // Planet: fades in as the hero leaves, fades out just before the closing section
    S.planet = smooth(H * 0.85, H * 0.25, heroBottom) * (1 - smooth(H * 1.0, H * 0.55, ctaTop));

    // Rise: 0 -> 1 across the whole stretch the planet is on screen
    const total = ctaTop - H * 0.55 - (heroBottom - H * 0.25);
    S.rise = smooth(0, 1, clamp01((H * 0.25 - heroBottom) / Math.max(1, total)));
  }

  // The planet horizon
  function drawPlanet(ctx, W, H) {
    const reveal = S.planet,
      rise = S.rise;
    if (reveal <= 0) return;
    ctx.globalAlpha = reveal;

    // Hazy grey-blue sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#5E6B78");
    sky.addColorStop(0.5, "#7C8692");
    sky.addColorStop(1, "#4A535D");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Huge planet: its edge peaks off the left and slopes down to the right
    const R = W * 2.4;
    const cx = -W * 0.25;
    const edgeY = H * (1.15 - 0.85 * rise);
    const cy = edgeY + R;

    const rims = [
      ["rgba(225,230,235,0.35)", 34],
      ["rgba(150,158,168,0.55)", 20],
      ["rgba(95,102,112,0.8)", 9],
    ];
    for (const [col, off] of rims) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, R + off, 0, Math.PI * 2);
      ctx.fill();
    }
    const body = ctx.createLinearGradient(0, edgeY, 0, edgeY + H * 0.9);
    body.addColorStop(0, "#4B525B");
    body.addColorStop(0.35, "#262B32");
    body.addColorStop(1, "#05070A");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Dark shadow sweeping in from the bottom-left
    const shade = ctx.createRadialGradient(0, H, 0, 0, H, Math.max(W, H) * 0.9);
    shade.addColorStop(0, "rgba(0,0,0,0.85)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // main.js calls these every frame
  window.bgScene = {
    before(ctx, w, h) {
      H = h;
      measure();
    }, // runs first: work out the numbers
    particles: () => S.particles, // 0 - 1 brightness of the particle field
    after: drawPlanet, // runs last: planet is drawn over the particles
  };

  /* ===== Parallax on the screenshots ===== */
  function onScroll() {
    const h = window.innerHeight;
    const off = reduceMotion || window.innerWidth < 760;
    for (const el of parallaxEls) {
      if (off) {
        el.style.setProperty("--py", "0px");
        continue;
      }
      const pr = el.parentElement.getBoundingClientRect();
      const centre = pr.top + pr.height / 2 - h / 2;
      el.style.setProperty("--py", (-centre * parseFloat(el.dataset.parallax)).toFixed(1) + "px");
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
})();
