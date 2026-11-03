import { boot } from "./app";

const root = document.getElementById("root");
if (root) {
  boot(root).catch((e) => {
    root.innerHTML = `<div style="padding:24px;font-family:system-ui">起動できませんでした: ${String((e as Error).message).replace(/</g, "&lt;")}<br>保存データは変更されていません。</div>`;
    console.error(e);
  });
}
