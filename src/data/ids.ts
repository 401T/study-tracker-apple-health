/** Collision-resistant ids. Existing ids are never regenerated — only new entities get one. */
export function newId(prefix: "rec" | "sub" | "task" | "plan" | "bak"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
