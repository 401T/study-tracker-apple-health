/**
 * WCAG 2.x contrast check for the text/background token pairs used by the UI.
 * Run: node --experimental-strip-types scripts/check-contrast.ts
 */
type RGBA = [number, number, number, number];
const hex = (h: string): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA;
const lum = ([r, g, b]: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (fg: RGBA, bg: RGBA) => {
  const a = lum(over(fg, bg)), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const rgba = (r: number, g: number, b: number, a: number): RGBA => [r, g, b, a];

const pairs: [string, RGBA, RGBA, number][] = [
  ["light label-secondary on card", rgba(60, 60, 67, 0.78), hex("#ffffff"), 4.5],
  ["light label-secondary on bg", rgba(60, 60, 67, 0.78), hex("#f2f2f7"), 4.5],
  ["light accent-strong on card", hex("#3634a3"), hex("#ffffff"), 4.5],
  ["light white on accent (button)", hex("#ffffff"), hex("#5856d6"), 4.5],
  ["light positive on card", hex("#1e7b34"), hex("#ffffff"), 4.5],
  ["light negative on card", hex("#d70015"), hex("#ffffff"), 4.5],
  ["light orange-ink on card", hex("#c93400"), hex("#ffffff"), 4.5],
  ["light chart goal rule/label on card", hex("#c93400"), hex("#ffffff"), 4.5],
  ["dark label on card", hex("#ffffff"), hex("#1c1c1e"), 4.5],
  ["dark label-secondary on card", rgba(235, 235, 245, 0.68), hex("#1c1c1e"), 4.5],
  ["dark label-secondary on bg", rgba(235, 235, 245, 0.68), hex("#000000"), 4.5],
  ["dark accent-strong on card", hex("#a5a3ff"), hex("#1c1c1e"), 4.5],
  ["dark white on accent (button)", hex("#ffffff"), hex("#5e5ce6"), 4.5],
  ["dark chart bar on card (graphic)", hex("#7d7aff"), hex("#1c1c1e"), 3],
  ["light chart bar on card (graphic)", hex("#5856d6"), hex("#ffffff"), 3],
  ["dark chart goal on card", hex("#ff9f0a"), hex("#1c1c1e"), 4.5],
  ["dark positive on card", hex("#30d158"), hex("#1c1c1e"), 4.5],
  ["dark negative on card", hex("#ff6961"), hex("#1c1c1e"), 4.5],
];
let fail = 0;
for (const [name, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  (min ${min}:1)  ${name}`);
}
process.exit(fail ? 1 : 0);
