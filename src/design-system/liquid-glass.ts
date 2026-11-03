/**
 * Liquid Glass engine (web approximation), adapted from the author's own
 * Molecule app (github.com/401T/molecule, glass.js).
 *
 * - [data-glass]   floating panels: edge refraction of a rounded glass slab
 * - [data-refract] floating controls; value "dome" = lens that magnifies
 * - [data-lens]    containers whose selected child gets a glass "lens" that
 *                  glides to the new selection (GlassEffectContainer-style morph)
 * - press glow     controls light up from the touch point and swell slightly
 *
 * Refraction uses an SVG feDisplacementMap inside `backdrop-filter: url(#…)`,
 * which only Chromium renders. Elsewhere the same elements fall back to blur +
 * specular sheen from glass.css. Reduce Transparency, the in-app "不透明" mode and
 * the "屈折" switch all turn refraction off.
 */

const NS = "http://www.w3.org/2000/svg";
const supported =
  typeof window !== "undefined" &&
  !!(window as unknown as { chrome?: unknown }).chrome &&
  typeof CSS !== "undefined" &&
  CSS.supports("backdrop-filter", "blur(1px)");

let enabled = supported;
const filters = new Map<string, string>();
const tracked = new Set<HTMLElement>();
const lensBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();
let defs: SVGDefsElement | null = null;
let ro: ResizeObserver | null = null;
const reduceTransparency = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-transparency: reduce)") : null;

function ensureDefs() {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  defs = document.createElementNS(NS, "defs") as SVGDefsElement;
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

/** Displacement map: bevel = only the rim bends light; dome = whole lens magnifies. */
function makeMap(w: number, h: number, r: number, mode: "bevel" | "dome"): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  const bevel = Math.max(2, Math.min(mode === "dome" ? Math.min(hw, hh) : 26, Math.min(w, h) * 0.42));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const inside = -sdf;
      let nx = 0, ny = 0, m = 0;
      if (inside > 0) {
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1;
          nx = qx / l;
          ny = qy / l;
        } else if (qx > qy) nx = 1;
        else ny = 1;
        nx *= Math.sign(px) || 1;
        ny *= Math.sign(py) || 1;
        if (inside < bevel) {
          const t = inside / bevel;
          const slope = (1 - t) / Math.sqrt(Math.max(1e-3, t * (2 - t)));
          m = Math.min(1, slope * 0.38);
        }
        if (mode === "dome") {
          const rx = px / hw, ry = py / hh;
          nx = nx * m - rx * 0.55;
          ny = ny * m - ry * 0.55;
          m = 1;
        }
      }
      const i = (y * w + x) * 4;
      d[i] = 128 + Math.max(-1, Math.min(1, nx * m)) * 127;
      d[i + 1] = 128 + Math.max(-1, Math.min(1, ny * m)) * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Refraction filter with slight chromatic aberration (R, G, B displaced by different amounts). */
function filterFor(w: number, h: number, r: number, mode: "bevel" | "dome", chroma = true): string {
  const key = `${w}x${h}r${Math.round(r)}${mode}${chroma ? "c" : ""}`;
  const hit = filters.get(key);
  if (hit) return hit;
  const id = `lg${filters.size}`;
  const f = document.createElementNS(NS, "filter");
  f.id = id;
  for (const [k, v] of Object.entries({ "color-interpolation-filters": "sRGB", filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", x: 0, y: 0, width: w, height: h }))
    f.setAttribute(k, String(v));
  const short = Math.min(w, h);
  // Bars and buttons (< 90px tall) bend only gently; strong bending over text looks smeared.
  const base = mode === "dome" ? -Math.min(26, short * 0.5) : short < 90 ? short * 0.2 : Math.min(60, short * 0.9);
  const ca = mode === "dome" ? 0.06 : 0.08;
  const disp = (s: number, res: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(base * s).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
  const map = `<feImage href="${makeMap(w, h, r, mode)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`;
  f.innerHTML =
    w * h > 40000 || !chroma
      ? map + disp(1, "out")
      : map + disp(1, "dr") + disp(1 - ca, "dg") + disp(1 - 2 * ca, "db") +
        '<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>' +
        '<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>' +
        '<feColorMatrix in="db" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>' +
        '<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>' +
        '<feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>';
  ensureDefs().appendChild(f);
  filters.set(key, id);
  return id;
}

const active = () =>
  enabled && !reduceTransparency?.matches && document.documentElement.dataset.glass !== "reduced" && !matchMedia("(prefers-contrast: more)").matches;

function apply(el: HTMLElement) {
  if (!active()) {
    el.style.removeProperty("backdrop-filter");
    el.style.removeProperty("-webkit-backdrop-filter");
    return;
  }
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (w < 4 || h < 4) return;
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
  const mode = el.dataset.refract === "dome" ? "dome" : "bevel";
  const id = filterFor(Math.ceil(w / 2) * 2, Math.ceil(h / 2) * 2, r, mode, el.dataset.chroma !== "off");
  const blur = el.dataset.blur ?? (el.hasAttribute("data-glass") ? "var(--glass-blur)" : mode === "dome" ? "0px" : h < 90 ? "10px" : "4px");
  // Blur first, then bend: refracting an unblurred backdrop leaves sharp, smeared text under the glass.
  el.style.backdropFilter = `blur(${blur}) url(#${id}) saturate(190%) brightness(1.04)`;
}

function track(el: HTMLElement) {
  if (tracked.has(el)) return;
  tracked.add(el);
  ro?.observe(el);
  apply(el);
}

/** Selected-item lens. `data-lens="key"` keeps the position across re-renders so it glides. */
function attachLens(container: HTMLElement) {
  if (container.querySelector(":scope > .lens")) return;
  const lens = document.createElement("span");
  lens.className = "lens";
  lens.setAttribute("aria-hidden", "true");
  container.prepend(lens);
  const key = container.dataset.lens || "";
  const place = (animate: boolean) => {
    const on = container.querySelector<HTMLElement>(':scope > [aria-checked="true"], :scope > [aria-current="page"], :scope > [aria-pressed="true"], :scope > .on');
    if (!on || !on.offsetWidth) {
      lens.style.opacity = "0";
      return;
    }
    const box = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    const prev = key ? lensBoxes.get(key) : undefined;
    lens.classList.add("no-anim");
    const set = (b: typeof box) => {
      lens.style.width = `${b.w}px`;
      lens.style.height = `${b.h}px`;
      lens.style.transform = `translate(${b.x}px, ${b.y}px)`;
    };
    lens.style.opacity = "1";
    if (animate && prev && (prev.x !== box.x || prev.y !== box.y)) {
      set(prev);
      void lens.offsetWidth;
      lens.classList.remove("no-anim");
      requestAnimationFrame(() => set(box));
    } else {
      set(box);
      void lens.offsetWidth;
      lens.classList.remove("no-anim");
    }
    if (key) lensBoxes.set(key, box);
  };
  place(true);
  new ResizeObserver(() => place(false)).observe(container);
}

export const LiquidGlass = {
  get supported() {
    return supported;
  },
  init() {
    if (supported && typeof ResizeObserver !== "undefined") ro = new ResizeObserver((es) => es.forEach((e) => apply(e.target as HTMLElement)));
    // Press feedback: glow from the touch point, slight swell.
    const sel = ".glass-interactive, .btn, .chip, .tab, .segmented > button, .round-button, .bar-button, .nav-item";
    let cur: HTMLElement | null = null;
    const release = () => {
      cur?.classList.remove("is-pressed");
      cur = null;
    };
    document.addEventListener("pointerdown", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      el.classList.add("is-pressed");
      cur = el;
    }, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    reduceTransparency?.addEventListener?.("change", () => tracked.forEach(apply));
    window.addEventListener("resize", () => LiquidGlass.refresh());
  },
  /** Call after inserting new markup. */
  scan(root: ParentNode = document) {
    for (const el of [...tracked]) if (!el.isConnected) {
      tracked.delete(el);
      ro?.unobserve(el);
    }
    if (supported) root.querySelectorAll<HTMLElement>("[data-glass], [data-refract]").forEach(track);
    root.querySelectorAll<HTMLElement>("[data-lens]").forEach(attachLens);
  },
  setEnabled(on: boolean) {
    enabled = supported && on;
    tracked.forEach(apply);
  },
  refresh() {
    tracked.forEach(apply);
  },
};
