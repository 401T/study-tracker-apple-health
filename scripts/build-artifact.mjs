/**
 * Turns the single-file build (dist/index.html) into the page body the claude.ai
 * Artifact tool publishes (dist/artifact.html): no doctype/html/head/body of its
 * own — the publisher wraps it — with <title> first.
 * Run after `vite build`: npm run build:artifact
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("dist/index.html", "utf8");
const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const scripts = [...src.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!styles || scripts.length !== 1) throw new Error(`unexpected build output (styles: ${styles.length}, scripts: ${scripts.length})`);

// Inside the artifact viewer :root is already padded by the safe-area insets.
const artifactCss = `.screen{padding-top:52px}`;

const out = `<title>勉強時間トラッカー</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#eef1f8">
<style>${styles}
${artifactCss}</style>
<div id="root"></div>
<noscript>このアプリを使うにはJavaScriptを有効にしてください。</noscript>
<script type="module">${scripts[0].replace(/<\/script/gi, "<\\/script")}</script>
`;
writeFileSync("dist/artifact.html", out);
console.log(`dist/artifact.html ${(out.length / 1024).toFixed(1)} KB`);
