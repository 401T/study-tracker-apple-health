/**
 * SYNTHETIC data generator — fictional subjects and records for demos and tests.
 * Never represents a real person's study history. Every entity carries
 * `extra.synthetic = true` so it can never be mistaken for real data.
 */

import type { StudyDataset, StudyRecord, Subject, Task } from "./schema";
import { emptyDataset } from "./validate";
import { addDays, combineLocal, deviceTimezone, parseLocalDate, today } from "./time";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBJECTS: [string, Subject["color"], number][] = [
  ["数学", "blue", 6 * 3600],
  ["英語", "orange", 5 * 3600],
  ["物理", "purple", 4 * 3600],
  ["化学", "green", 3 * 3600],
  ["国語", "pink", 2 * 3600],
];

const NOTES: Record<string, string[]> = {
  数学: ["微分の応用問題 演習", "数列 漸化式の復習", "ベクトル 内積の問題集", "確率 条件付き確率", "積分 面積の計算"],
  英語: ["長文読解 2題", "単語帳 Unit 12–14", "英作文 添削の見直し", "リスニング演習", "文法 仮定法"],
  物理: ["力学 運動方程式", "電磁気 コンデンサー", "波動 ドップラー効果", "熱力学 状態方程式"],
  化学: ["有機 構造決定", "無機 沈殿反応の暗記", "理論 化学平衡"],
  国語: ["古文 助動詞の識別", "現代文 評論の要約", "漢文 句法"],
};

export function syntheticDataset(opts: { days?: number; seed?: number; end?: string } = {}): StudyDataset {
  const { days = 120, seed = 42, end = today() } = opts;
  const rnd = mulberry32(seed);
  const ds = emptyDataset();
  const created = combineLocal(addDays(end, -days), "08:00");
  const tz = deviceTimezone();

  ds.subjects = SUBJECTS.map(([name, color, goal], i) => ({
    id: `sub_demo_${i + 1}`, name, color, weeklyGoalSec: goal, archived: false, order: i,
    createdAt: created, updatedAt: created, extra: { synthetic: true },
  }));
  const tasks: Task[] = [
    ["sub_demo_1", "青チャート 第3章"], ["sub_demo_1", "過去問 2023年度"], ["sub_demo_2", "長文問題集 1冊目"],
    ["sub_demo_3", "重要問題集 力学"], ["sub_demo_4", "有機化学 まとめノート"],
  ].map(([subjectId, title], i) => ({
    id: `task_demo_${i + 1}`, subjectId, title, status: i === 1 ? "done" : "open", dueDate: null, note: "",
    createdAt: created, updatedAt: created, extra: { synthetic: true },
  }));
  ds.tasks = tasks;

  const records: StudyRecord[] = [];
  let n = 0;
  for (let i = days; i >= 0; i--) {
    const date = addDays(end, -i);
    const dow = parseLocalDate(date).getDay();
    // Slow upward trend, weekends heavier, ~12% rest days; English dips in the last 2 weeks.
    if (rnd() < 0.12) continue;
    const sessions = 1 + Math.floor(rnd() * (dow === 0 || dow === 6 ? 4 : 3));
    let clock = (dow === 0 || dow === 6 ? 9 : 17) * 60 + Math.floor(rnd() * 60);
    for (let k = 0; k < sessions; k++) {
      let si = Math.floor(rnd() * SUBJECTS.length);
      if (si === 1 && i < 14 && rnd() < 0.6) si = 0;
      const subj = ds.subjects[si];
      const dur = Math.round((25 + rnd() * 70 + (days - i) * 0.15) / 5) * 5 * 60;
      const brk = rnd() < 0.5 ? Math.round(rnd() * 3) * 5 * 60 : 0;
      const isTimer = rnd() < 0.75;
      const startAt = combineLocal(date, `${String(Math.floor(clock / 60) % 24).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`);
      const endAt = new Date(Date.parse(startAt) + (dur + brk) * 1000);
      const endISO = combineLocal(date, `${String(endAt.getHours()).padStart(2, "0")}:${String(endAt.getMinutes()).padStart(2, "0")}`);
      const task = tasks.find((t) => t.subjectId === subj.id && rnd() < 0.5);
      const notes = NOTES[subj.name];
      records.push({
        id: `rec_demo_${String(++n).padStart(4, "0")}`,
        date, timezone: tz,
        startAt: isTimer ? startAt : null,
        endAt: isTimer && endISO > startAt ? endISO : null,
        durationSec: dur,
        elapsedSec: isTimer && endISO > startAt ? dur + brk : null,
        breakSec: isTimer && endISO > startAt ? brk : 0,
        subjectId: subj.id,
        taskId: task?.id ?? null,
        note: notes[Math.floor(rnd() * notes.length)],
        source: isTimer && endISO > startAt ? "timer" : "manual",
        createdAt: startAt, updatedAt: startAt, deletedAt: null,
        extra: { synthetic: true },
      });
      clock += Math.round((dur + brk) / 60) + 10 + Math.floor(rnd() * 40);
    }
  }
  ds.records = records;
  // A weekly overall plan for the current and previous weeks (Mon start).
  ds.plans = [0, 1, 2, 3].map((w) => {
    const s = addDays(end, -((parseLocalDate(end).getDay() + 6) % 7) - 7 * w);
    return {
      id: `plan_demo_${w + 1}`, periodStart: s, periodEnd: addDays(s, 6), subjectId: null,
      plannedSec: 18 * 3600, note: "週18時間", createdAt: created, updatedAt: created, extra: { synthetic: true },
    };
  });
  ds.extensions = { synthetic: true, generator: `syntheticDataset(seed=${seed}, days=${days})` };
  return ds;
}
