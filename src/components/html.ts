/**
 * Minimal safe templating. Every interpolated value is HTML-escaped unless it
 * is already a `Safe` (produced by `html` or `raw`). User text (notes, subject
 * names) can therefore never inject markup.
 */

export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHTML = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return escapeHTML(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

/** Trusted markup only (icons, pre-built SVG). Never pass user input. */
export const raw = (s: string) => new Safe(s);

/** Attribute helper for optional attributes: attr("aria-current", cond && "page"). */
export function attr(name: string, value: string | number | false | null | undefined): Safe {
  return value === false || value === null || value === undefined ? raw("") : raw(` ${name}="${escapeHTML(String(value))}"`);
}
