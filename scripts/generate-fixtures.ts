/**
 * Writes SYNTHETIC fixtures (fictional data) to fixtures/synthetic-data/.
 * Run: npm run fixtures
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { syntheticDataset } from "../src/data/synthetic";
import { toCSV, toJSON } from "../src/data/io";
import { toMarkdown } from "../src/adapters/ai-report";
import { fingerprint } from "../src/data/integrity";

const END = "2026-11-03"; // fixed so fixtures are reproducible
const dir = "fixtures/synthetic-data";
mkdirSync(dir, { recursive: true });
const ds = syntheticDataset({ end: END, days: 120, seed: 42 });
// Fixed timestamps so the file is byte-stable between runs.
ds.meta.createdAt = ds.meta.updatedAt = "2026-11-03T21:00:00+09:00";
ds.meta.timezone = "Asia/Tokyo";
for (const r of ds.records) r.timezone = "Asia/Tokyo";
writeFileSync(`${dir}/dataset.json`, toJSON(ds) + "\n");
writeFileSync(`${dir}/records.csv`, toCSV(ds));
writeFileSync(`${dir}/report.md`, toMarkdown(ds, { asOf: END }));
writeFileSync(`${dir}/fingerprint.json`, JSON.stringify(fingerprint(ds), null, 2) + "\n");
console.log(`wrote ${ds.records.length} synthetic records to ${dir}`);
