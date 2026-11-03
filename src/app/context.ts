/** Shared UI context and action registry (presentation layer only). */

import type { StudyStore } from "../data/store";
import type { Safe } from "../components/html";
import type { AgentApi, PendingProposal } from "../adapters/agent-api";
import type { PeriodKind } from "../analytics";

export type Tab = "summary" | "records" | "analytics" | "subjects" | "settings";

export interface UIState {
  tab: Tab;
  records: { q: string; subject: string; range: "all" | "7" | "30" };
  analytics: { kind: PeriodKind; anchor: string };
  subjectsShowArchived: boolean;
  /** Note typed in the timer sheet before the timer starts. */
  timerDraftNote?: string;
  proposals: PendingProposal[];
}

export interface SheetView {
  title: string;
  /** Left header slot (e.g. キャンセル). */
  leading?: Safe;
  /** Right header slot (e.g. 保存). */
  trailing?: Safe;
  body: Safe;
  /** Re-render this sheet whenever the store changes (e.g. detail views). */
  live?: boolean;
}

export type SheetRenderer = (ctx: Ctx, params: Record<string, string>) => SheetView;

export interface Ctx {
  store: StudyStore;
  ui: UIState;
  agent: AgentApi;
  rerender(): void;
  openSheet(name: string, params?: Record<string, string>): void;
  replaceSheet(name: string, params?: Record<string, string>): void;
  closeSheet(): void;
  rerenderSheet(): void;
  toast(message: string, action?: { label: string; run: () => void }): void;
  /** Wraps a store mutation so read-only / save errors become a toast instead of a crash. */
  safely(fn: () => void): boolean;
}

export type ActionHandler = (ctx: Ctx, el: HTMLElement, ev: Event) => void | Promise<void>;

export const actions: Record<string, ActionHandler> = {};
export const sheets: Record<string, SheetRenderer> = {};
/** Form submit handlers keyed by data-submit. */
export const submits: Record<string, (ctx: Ctx, form: HTMLFormElement) => void | Promise<void>> = {};

export function registerActions(map: Record<string, ActionHandler>) {
  Object.assign(actions, map);
}
export function registerSheets(map: Record<string, SheetRenderer>) {
  Object.assign(sheets, map);
}
export function registerSubmits(map: typeof submits) {
  Object.assign(submits, map);
}
