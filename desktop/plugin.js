/*
 * Hermes Kanban Gantt — desktop renderer (BUILD ARTIFACT).
 * Source of truth: src/ — run `npm run build` after editing.
 * Loaded uncompiled by Hermes Desktop; only @hermes/plugin-sdk, react
 * and react/jsx-runtime are importable specifiers.
 */

// src/main.ts
import {
  Badge,
  Button as Button3,
  cn as cn2,
  Codicon as Codicon3,
  Contribute,
  DropdownMenu as DropdownMenu3,
  DropdownMenuContent as DropdownMenuContent3,
  DropdownMenuItem as DropdownMenuItem3,
  DropdownMenuSeparator as DropdownMenuSeparator3,
  DropdownMenuTrigger as DropdownMenuTrigger3,
  EmptyState,
  ErrorState,
  host,
  Loader,
  profileColor,
  profileColorSoft,
  Streamdown,
  useMutation,
  useQuery as useQuery2,
  useQueryClient as useQueryClient2,
  useValue as useValue2,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  WORKSPACE_PAGE_HEADER_AREA
} from "@hermes/plugin-sdk";
import { useMemo as useMemo2, useRef as useRef2, useEffect as useEffect2, useState as useState2 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";

// src/state.ts
import { atom } from "@hermes/plugin-sdk";
var LABEL_W = 300;
var rest = null;
var storage = null;
var $baseUrl = atom("");
var $boardSlug = atom("");
var $labelW = atom(LABEL_W);
var $drawerW = atom(416);
var $drawerDocked = atom(false);
var LABEL_W_MIN = 160;
var LABEL_W_MAX = 640;
var DRAWER_W_MIN = 320;
var DRAWER_W_MAX = 720;
var $openTaskId = atom(null);
var $newTask = atom(null);
var apiBase = () => ($baseUrl.get() || "").trim().replace(/\/+$/, "");
var apiFetch = (path, init) => {
  const base = apiBase();
  if (base) {
    return fetch(`${base}${path}`, {
      method: init?.method || "GET",
      headers: init?.body != null ? { "Content-Type": "application/json" } : void 0,
      body: init?.body != null ? JSON.stringify(init.body) : void 0
    }).then((r) => {
      if (!r.ok) throw new Error(`${init?.method || "GET"} ${path} → HTTP ${r.status}`);
      return r.json();
    });
  }
  if (!rest) return Promise.reject(new Error("backend not ready"));
  return rest(path, init?.body != null ? { method: init.method, body: init.body } : void 0);
};
var fetchTask = (id, board) => apiFetch(`/tasks/${encodeURIComponent(id)}${board ? `?board=${encodeURIComponent(board)}` : ""}`);
var createTask = (values, board) => apiFetch(
  `/tasks${board ? `?board=${encodeURIComponent(board)}` : ""}`,
  { method: "POST", body: values }
);
var fetchProjects = () => apiFetch("/projects");
function setPluginDoors(restFn, storageObj) {
  rest = restFn;
  storage = storageObj;
}
var getStorage = () => storage;

// src/i18n.ts
import { useMemo } from "react";
import { usePluginI18n } from "@hermes/plugin-sdk";
var ID = "kanban-gantt";
var GANTT_LOCALES = {
  en: {
    title: "Kanban Gantt",
    nav: "Kanban Gantt",
    openCommand: "Kanban Gantt: Open timeline view",
    refresh: "Refresh",
    backend: "Backend:",
    allBoards: "All boards",
    board: "Board:",
    noBoard: "no board",
    dockDrawer: "Dock the drawer next to the gantt",
    undockDrawer: "Undock the drawer",
    filterCards: "Filter cards…",
    zoomTimeline: "Zoom timeline",
    nothingToDisplay: "Nothing to display",
    noTasksMatch: "No tasks match the search or filter criteria.",
    emptyBoard: "No data",
    emptyBoardDesc: (board) => `Board ${board} returned no tasks.`,
    cannotLoadBoard: "Cannot load board",
    cannotLoadBoardDesc: (base) => `Backend kanban-gantt unreachable${base ? ` (${base})` : ""} — plugin enabled? gateway restarted?`,
    taskUnreadable: "Task unreadable",
    taskUnreadableDesc: "Backend did not respond.",
    nTasksTotal: (n, status) => `${n} task${n > 1 ? "s" : ""} in total (dominant priority: ${status})`,
    nBlockedWarning: (n) => `${n} blocked task${n > 1 ? "s (requires attention)" : " (requires attention)"}`,
    nSelected: (n) => `${n} selected`,
    statusLabel: "Status:",
    assignLabel: "Assign:",
    assignPlaceholder: "Profile…",
    clearSelection: "Clear selection (Esc)",
    filters: "Filters",
    profiles: "Profiles",
    allProfiles: "All profiles",
    statuses: "Statuses",
    showArchived: "Show archived",
    unassigned: "Unassigned",
    unassignedEmpty: "Unassigned (empty)",
    reassigned: "(reassigned)",
    dependencies: "Dependencies:",
    description: "Description",
    result: "Result",
    latestSummary: "Latest summary",
    runs: (n) => `Runs (${n})`,
    show: "Show",
    hide: "Hide",
    comments: (n) => `Comments (${n})`,
    showPreviousComments: (n) => `Show ${n} previous comment${n > 1 ? "s" : ""}`,
    addCommentPlaceholder: "Add a comment…",
    send: "Send",
    activity: (n) => `Activity (${n})`,
    action: "Action:",
    copyTaskId: "Copy task id",
    copyTitle: "Copy title",
    moveToShort: "Move to",
    unassignAction: "Unassign",
    delete: "Delete",
    confirmDelete: (id) => `Permanently delete task ${id}?`,
    taskDetail: "Task detail",
    actionsMenu: "Actions menu",
    close: "Close",
    selectAll: "Select all",
    selectTask: (name) => `Select ${name}`,
    tasksColumn: "Tasks",
    clickForDetail: "click for details",
    legendShow: (label) => `Click to show ${label}`,
    legendHide: (label) => `Click to hide ${label}`,
    barDoneReal: (name) => `${name} · done (actual duration)`,
    barDoneUnknown: (name) => `${name} · done (duration unknown)`,
    barRunning: (name) => `${name} · running`,
    barBlockedWaiting: (name) => `${name} · blocked — waiting for action`,
    barNotStarted: (name) => `${name} · not started`,
    copyHint: (id) => `${id} — click [...] to copy`,
    newTask: "New task",
    newTaskTitle: "Title",
    newTaskTitlePlaceholder: "What needs to be done?",
    newTaskPriority: "Priority",
    newTaskParent: "Parent",
    newTaskNoParent: "No parent",
    newTaskTriage: "Send to triage",
    newTaskDescriptionPlaceholder: "Optional description…",
    newTaskProject: "Project",
    newTaskNoProject: "No project",
    newTaskWorkspace: "Workspace",
    newTaskWorkspacePath: "Workspace path",
    newTaskWorkspaceInherit: "Inherits the board/project directory",
    newTaskWorkspaceInheritHint: "Leave empty to inherit the board or project directory.",
    newTaskSkills: "Skills (comma-separated)",
    newTaskSkillsPlaceholder: "skill-a, skill-b",
    newTaskModel: "Model",
    newTaskModelInherit: "Profile default",
    newTaskModelHint: "Runs this task on a specific model; empty uses the assignee profile’s own.",
    newTaskGoalMode: "Goal mode",
    create: "Create",
    creating: "Creating…",
    createSubtask: "Create a sub-task",
    created: (title) => `Task “${title}” created`,
    errTitleRequired: "A title is required.",
    errCreate: "The task could not be created.",
    col: {
      triage: "Triage",
      todo: "Todo",
      scheduled: "Scheduled",
      ready: "Ready",
      running: "Running",
      blocked: "Blocked",
      review: "Review",
      done: "Done",
      archived: "Archived"
    },
    actions: {
      done: "Done",
      blocked: "Block",
      unblock: "Unblock",
      review: "Request review",
      reopen: "Reopen",
      archive: "Archive",
      ready: "Set to Ready",
      todo: "Set to Todo",
      triage: "Send to Triage",
      delete: "Delete",
      restore: "Restore"
    }
  },
  fr: {
    title: "Gantt Kanban",
    nav: "Gantt Kanban",
    openCommand: "Gantt Kanban : ouvrir la vue chronologique",
    refresh: "Actualiser",
    backend: "Backend :",
    allBoards: "Tous les boards",
    board: "Board :",
    noBoard: "aucun board",
    dockDrawer: "Ancrer la vue à côté du gantt",
    undockDrawer: "Détacher la vue",
    filterCards: "Filtrer les tâches…",
    zoomTimeline: "Zoom timeline",
    nothingToDisplay: "Rien à afficher",
    noTasksMatch: "Aucune tâche ne correspond aux critères de recherche ou de filtre.",
    emptyBoard: "Aucune donnée",
    emptyBoardDesc: (board) => `Le board ${board} ne renvoie aucune tâche.`,
    cannotLoadBoard: "Impossible de charger le board",
    cannotLoadBoardDesc: (base) => `Backend kanban-gantt injoignable${base ? ` (${base})` : ""} — plugin activé ? gateway relancé ?`,
    taskUnreadable: "Tâche illisible",
    taskUnreadableDesc: "Le backend n’a pas répondu.",
    nTasksTotal: (n, status) => `${n} tâche${n > 1 ? "s au total" : " au total"} (état prioritaire : ${status})`,
    nBlockedWarning: (n) => `${n} tâche${n > 1 ? "s bloquées (nécessitent une intervention)" : " bloquée (nécessite une intervention)"}`,
    nSelected: (n) => `${n} sélectionnée${n > 1 ? "s" : ""}`,
    statusLabel: "État :",
    assignLabel: "Assigner :",
    assignPlaceholder: "Profil…",
    clearSelection: "Tout désélectionner (Échap)",
    filters: "Filtres",
    profiles: "Profils",
    allProfiles: "Tous les profils",
    statuses: "États",
    showArchived: "Afficher les archivés",
    unassigned: "Non assigné",
    unassignedEmpty: "Non assigné (vide)",
    reassigned: "(réaffecté)",
    dependencies: "Dépendances :",
    description: "Description",
    result: "Résultat",
    latestSummary: "Dernier résumé",
    runs: (n) => `Exécutions (${n})`,
    show: "Afficher",
    hide: "Masquer",
    comments: (n) => `Commentaires (${n})`,
    showPreviousComments: (n) => `Afficher les ${n} commentaires précédents`,
    addCommentPlaceholder: "Ajouter un commentaire…",
    send: "Envoyer",
    activity: (n) => `Activité (${n})`,
    action: "Action :",
    copyTaskId: "Copier l’ID de tâche",
    copyTitle: "Copier le titre",
    moveToShort: "Déplacer",
    unassignAction: "Désassigner",
    delete: "Supprimer",
    confirmDelete: (id) => `Supprimer définitivement la tâche ${id} ?`,
    taskDetail: "Détail de la tâche",
    actionsMenu: "Menu actions",
    close: "Fermer",
    selectAll: "Tout sélectionner",
    selectTask: (name) => `Sélectionner ${name}`,
    tasksColumn: "Tâches",
    clickForDetail: "cliquer pour le détail",
    legendShow: (label) => `Cliquer pour réafficher ${label}`,
    legendHide: (label) => `Cliquer pour masquer ${label}`,
    barDoneReal: (name) => `${name} · terminée (durée réelle)`,
    barDoneUnknown: (name) => `${name} · terminée (durée inconnue)`,
    barRunning: (name) => `${name} · en cours`,
    barBlockedWaiting: (name) => `${name} · bloquée — en attente d’action`,
    barNotStarted: (name) => `${name} · non démarrée`,
    copyHint: (id) => `${id} — cliquer sur [...] pour copier`,
    newTask: "Nouvelle tâche",
    newTaskTitle: "Titre",
    newTaskTitlePlaceholder: "Que faut-il faire ?",
    newTaskPriority: "Priorité",
    newTaskParent: "Parent",
    newTaskNoParent: "Aucun parent",
    newTaskTriage: "Envoyer en triage",
    newTaskDescriptionPlaceholder: "Description (facultative)…",
    newTaskProject: "Projet",
    newTaskNoProject: "Aucun projet",
    newTaskWorkspace: "Workspace",
    newTaskWorkspacePath: "Chemin du workspace",
    newTaskWorkspaceInherit: "Hérite du dossier du board/projet",
    newTaskWorkspaceInheritHint: "Laisser vide pour hériter du dossier du board ou du projet.",
    newTaskSkills: "Skills (séparés par des virgules)",
    newTaskSkillsPlaceholder: "skill-a, skill-b",
    newTaskModel: "Modèle",
    newTaskModelInherit: "Modèle du profil",
    newTaskModelHint: "Exécute la tâche sur un modèle précis ; vide = le modèle du profil assigné.",
    newTaskGoalMode: "Mode objectif",
    create: "Créer",
    creating: "Création…",
    createSubtask: "Créer une sous-tâche",
    created: (title) => `Tâche « ${title} » créée`,
    errTitleRequired: "Un titre est requis.",
    errCreate: "La tâche n’a pas pu être créée.",
    col: {
      triage: "Triage",
      todo: "Todo",
      scheduled: "Planifiée",
      ready: "Prête",
      running: "En cours",
      blocked: "Bloquée",
      review: "En revue",
      done: "Terminée",
      archived: "Archivée"
    },
    actions: {
      done: "Terminer",
      blocked: "Bloquer",
      unblock: "Débloquer",
      review: "Demander review",
      reopen: "Réouvrir",
      archive: "Archiver",
      ready: "Mettre à Ready",
      todo: "Mettre à Todo",
      triage: "Renvoyer en triage",
      delete: "Supprimer",
      restore: "Restaurer"
    }
  }
};
function bindI18n(t, template, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(template)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out[key] = typeof value === "function" ? (...args) => t(path, ...args) : value && typeof value === "object" ? bindI18n(t, value, path) : t(path);
  }
  return out;
}
function useGanttI18n() {
  const t = usePluginI18n(ID);
  return useMemo(() => bindI18n(t, GANTT_LOCALES.en), [t]);
}

// src/ui/TitlebarBoardSwitcher.tsx
import { Button, cn, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useQuery, useQueryClient, useValue } from "@hermes/plugin-sdk";
import { jsx, jsxs } from "react/jsx-runtime";
function TitlebarBoardSwitcher() {
  const board = useValue($boardSlug);
  const i18n = useGanttI18n();
  const queryClient2 = useQueryClient();
  const { data } = useQuery({
    queryKey: ["kanban-gantt", "boards", apiBase()],
    queryFn: () => apiFetch("/boards"),
    refetchInterval: 5 * 6e4
  });
  const boards = data?.boards || [];
  const isAllBoards = board === "all" || board === "*";
  const current = isAllBoards ? { slug: "all", label: i18n.allBoards } : boards.find((b) => b.slug === (board || data?.current));
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (getStorage()) getStorage().set("board", slug);
    void queryClient2.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
  };
  return /* @__PURE__ */ jsxs(DropdownMenu, { children: [
    /* @__PURE__ */ jsx(DropdownMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsx(
      Button,
      {
        className: "h-full min-w-0 max-w-full gap-1.5 px-2 [-webkit-app-region:no-drag]",
        size: "sm",
        variant: "ghost",
        children: /* @__PURE__ */ jsxs("span", { className: "flex min-w-0 items-center gap-1.5", children: [
          /* @__PURE__ */ jsx(Codicon, { className: "shrink-0 text-(--ui-text-tertiary)", name: "project", size: "0.8125rem" }),
          /* @__PURE__ */ jsx("span", { className: "shrink-0 text-[0.6875rem] font-medium text-(--ui-text-tertiary)", children: i18n.board.replace(/[:：]\s*$/, "") }),
          /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate text-[0.75rem] font-medium leading-none", children: current?.label || "—" }),
          current && !isAllBoards && typeof current.total === "number" && /* @__PURE__ */ jsx("span", { className: "text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)", children: current.total }),
          /* @__PURE__ */ jsx(Codicon, { className: "shrink-0 text-(--ui-text-tertiary)", name: "chevron-down", size: "0.8125rem" })
        ] })
      }
    ) }),
    /* @__PURE__ */ jsxs(DropdownMenuContent, { align: "center", children: [
      /* @__PURE__ */ jsxs(DropdownMenuItem, { onSelect: () => setBoard("all"), children: [
        /* @__PURE__ */ jsx("span", { className: cn("min-w-0 flex-1 truncate", isAllBoards && "font-semibold text-(--ui-accent)"), children: i18n.allBoards }),
        isAllBoards && /* @__PURE__ */ jsx(Codicon, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
      ] }),
      boards.length > 0 && /* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
      boards.map((b) => {
        const isCurrent = !isAllBoards && b.slug === (board || data?.current);
        return /* @__PURE__ */ jsxs(DropdownMenuItem, { onSelect: () => setBoard(b.slug), children: [
          /* @__PURE__ */ jsx("span", { className: "min-w-0 flex-1 truncate", children: b.label || b.slug }),
          typeof b.total === "number" && /* @__PURE__ */ jsx("span", { className: "text-[0.625rem] tabular-nums text-(--ui-text-quaternary)", children: b.total }),
          isCurrent && /* @__PURE__ */ jsx(Codicon, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
        ] }, b.slug);
      })
    ] })
  ] });
}

// src/ui/NewTaskDialog.tsx
import { useEffect, useRef, useState } from "react";
import {
  Button as Button2,
  Codicon as Codicon2,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu as DropdownMenu2,
  DropdownMenuContent as DropdownMenuContent2,
  DropdownMenuItem as DropdownMenuItem2,
  DropdownMenuSeparator as DropdownMenuSeparator2,
  DropdownMenuTrigger as DropdownMenuTrigger2,
  Input,
  Switch
} from "@hermes/plugin-sdk";

// src/core/gantt-core.ts
var DAY = 86400;
var MIN_BAR = 2 * 3600;
var STATUS_TONE = {
  triage: "var(--ui-text-tertiary)",
  todo: "var(--ui-text-secondary)",
  scheduled: "#a78bfa",
  ready: "#60a5fa",
  running: "#34d399",
  blocked: "#f87171",
  review: "#fbbf24",
  done: "var(--ui-text-tertiary)",
  archived: "var(--ui-text-quaternary)"
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
}
function barRange(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const rs = task.run_started_at;
  const re = task.run_ended_at;
  const realRun = rs != null && re != null && rs < re;
  if (task.status === "done" || task.status === "archived") {
    if (realRun) {
      return { t0: rs, t1: Math.max(rs + min, re), kind: "done", tone: statusTone(task.status) };
    }
    const anchor = task.completed_at ?? task.created_at;
    if (anchor == null) return null;
    return { t0: anchor, t1: anchor + min, kind: "done-instant" };
  }
  if (task.status === "running" || task.status === "review") {
    const start = task.run_started_at ?? task.started_at ?? task.created_at ?? now;
    return { t0: start, t1: Math.max(start + min, now), kind: "progress", tone: statusTone(task.status) };
  }
  if (task.started_at) {
    return { t0: task.started_at, t1: now, kind: "progress", tone: statusTone(task.status) };
  }
  const c = task.created_at;
  return c ? { t0: c, t1: c + min, kind: "todo", tone: statusTone(task.status) } : null;
}
function taskBars(task, now, minBarSec) {
  const min = minBarSec || MIN_BAR;
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const validRuns = runs.filter((r) => r && r.started_at != null);
  if (task.status === "blocked") {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      if (e == null || e <= s) continue;
      bars.push({
        t0: s,
        t1: Math.max(s + min, e),
        kind: "done",
        tone: statusTone("blocked"),
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status
      });
    }
    const waitStart = bars.length ? bars[bars.length - 1].t1 : task.created_at ?? task.started_at ?? now;
    bars.push({
      t0: waitStart,
      t1: Math.max(waitStart + min, now),
      kind: "blocked-wait",
      tone: statusTone("blocked")
    });
    return bars;
  }
  if (validRuns.length > 1) {
    const bars = [];
    for (const r of validRuns) {
      const s = r.started_at;
      const e = r.ended_at;
      const isOngoing = (e == null || r.status === "running") && (task.status === "running" || task.status === "review");
      const t1 = isOngoing ? Math.max(s + min, now) : e != null ? Math.max(s + min, e) : s + min;
      const isFailed = ["crashed", "failed", "timed_out", "gave_up", "blocked"].includes(r.outcome || r.status);
      const tone = isOngoing ? statusTone("running") : isFailed ? statusTone("blocked") : statusTone(r.outcome === "completed" || r.status === "completed" || r.status === "done" ? "done" : "review");
      bars.push({
        t0: s,
        t1,
        kind: isOngoing ? "progress" : "done",
        tone,
        runId: r.id,
        profile: r.profile,
        outcome: r.outcome || r.status,
        isOngoing
      });
    }
    return bars;
  }
  const single = barRange(task, now, min);
  return single ? [single] : [];
}
function shortId(id) {
  return (id || "").replace(/^t_/, "").slice(0, 6);
}
function matchesSearch(task, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || "").toLowerCase();
  const title = (task.title || "").toLowerCase();
  return label.includes(q) || title.includes(q);
}
function buildRows(tasks) {
  const set = new Set(tasks.map((t) => t.id));
  const byId = {};
  for (const t of tasks) byId[t.id] = t;
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) {
    for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  }
  const roots = tasks.filter((t) => !hasParent.has(t.id));
  const rows = [];
  const visited = /* @__PURE__ */ new Set();
  const walk = (id, depth, isChild) => {
    if (visited.has(id)) return;
    visited.add(id);
    rows.push({ task: byId[id], depth, isChild });
    for (const c of adj.get(id) || []) walk(c, depth + 1, true);
  };
  for (const r of roots) walk(r.id, 0, false);
  for (const t of tasks) walk(t.id, 0, Boolean(hasParent.has(t.id)));
  return rows;
}
function computeDomain(visible, minBarSec) {
  const min = minBarSec || MIN_BAR;
  let lo = Infinity, hi = -Infinity, hasProgress = false;
  const now = Date.now() / 1e3;
  for (const t of visible) {
    for (const ts of [t.created_at, t.started_at, t.run_started_at, t.run_ended_at, t.completed_at]) {
      if (ts != null && Number.isFinite(ts)) {
        if (ts < lo) lo = ts;
        if (ts > hi) hi = ts;
      }
    }
    if (Array.isArray(t.runs)) {
      for (const r of t.runs) {
        if (r && r.started_at != null && Number.isFinite(r.started_at)) {
          if (r.started_at < lo) lo = r.started_at;
          if (r.started_at > hi) hi = r.started_at;
        }
        if (r && r.ended_at != null && Number.isFinite(r.ended_at)) {
          if (r.ended_at < lo) lo = r.ended_at;
          if (r.ended_at > hi) hi = r.ended_at;
        }
      }
    }
    if (t.status !== "done" && t.status !== "archived") hasProgress = true;
  }
  if (hasProgress) hi = Math.max(hi, now);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = now - 6 * DAY;
    hi = now;
  }
  if (hi - lo < 7 * DAY) {
    lo = hi - 7 * DAY;
  }
  hi += min;
  return { min: lo, max: hi };
}
function tickUnit(span) {
  return span <= 120 * DAY ? "day" : span <= 730 * DAY ? "week" : "month";
}
function ticks(min, max, unit) {
  const step = unit === "week" ? 7 * DAY : unit === "month" ? 30 * DAY : DAY;
  const out = [];
  let t = Math.floor(min / step) * step;
  while (t <= max) {
    out.push(t);
    t += step;
  }
  return out;
}

// src/ui/NewTaskDialog.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function StatusDot({ status }) {
  return /* @__PURE__ */ jsx2(
    "span",
    {
      className: "h-2 w-2 shrink-0 rounded-full",
      style: { backgroundColor: statusTone(status) },
      "aria-hidden": "true"
    }
  );
}
var WORKSPACE_KINDS = ["scratch", "worktree", "dir"];
function Field({ label, children }) {
  return /* @__PURE__ */ jsxs2("div", { className: "flex min-w-0 flex-col gap-0.5", children: [
    /* @__PURE__ */ jsx2("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: label }),
    children
  ] });
}
function Picker({ value, children, ariaLabel }) {
  return /* @__PURE__ */ jsxs2(DropdownMenu2, { children: [
    /* @__PURE__ */ jsx2(DropdownMenuTrigger2, { asChild: true, children: /* @__PURE__ */ jsxs2(
      "button",
      {
        type: "button",
        "aria-label": ariaLabel,
        className: "flex min-w-0 items-center gap-1.5 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 py-0.5 text-left text-[11px] text-(--ui-text-secondary) cursor-pointer",
        children: [
          /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: value }),
          /* @__PURE__ */ jsx2(Codicon2, { className: "shrink-0 text-(--ui-text-quaternary)", name: "chevron-down", size: "0.75rem" })
        ]
      }
    ) }),
    /* @__PURE__ */ jsx2(DropdownMenuContent2, { align: "start", className: "min-w-[13rem]", children })
  ] });
}
function NewTaskDialog({
  open,
  boardSlug,
  assignees = [],
  tasks,
  projects = [],
  defaultParentId,
  busy = false,
  onSubmit,
  onClose,
  i18n
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("0");
  const [parentId, setParentId] = useState("");
  const [triage, setTriage] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [workspaceKind, setWorkspaceKind] = useState("scratch");
  const [workspacePath, setWorkspacePath] = useState("");
  const [skills, setSkills] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [goalMode, setGoalMode] = useState(false);
  const keyRef = useRef("");
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setAssignee("");
    setPriority("0");
    setParentId(defaultParentId || "");
    setTriage(false);
    setProjectId("");
    setWorkspaceKind("scratch");
    setWorkspacePath("");
    setSkills("");
    setModelOverride("");
    setGoalMode(false);
    keyRef.current = `kg-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, [open, defaultParentId]);
  const parentOptions = tasks.filter((task) => task.id === defaultParentId || task.status !== "done" && task.status !== "archived" && (!boardSlug || !task.board || task.board === boardSlug));
  const chosenParent = parentOptions.find((task) => task.id === parentId);
  const chosenProject = projects.find((project) => project.id === projectId);
  const canSubmit = title.trim().length > 0 && !busy;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      body: body.trim() || void 0,
      assignee: assignee.trim() || void 0,
      priority: Number(priority) || 0,
      parentId: parentId || void 0,
      triage,
      projectId: projectId || void 0,
      workspaceKind,
      workspacePath: workspaceKind === "scratch" ? void 0 : workspacePath.trim() || void 0,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      modelOverride: modelOverride.trim() || void 0,
      goalMode,
      idempotencyKey: keyRef.current
    });
  };
  return /* @__PURE__ */ jsx2(Dialog, { open, onOpenChange: (next) => {
    if (!next) onClose();
  }, children: /* @__PURE__ */ jsxs2(DialogContent, { className: "w-[min(32rem,94vw)] max-w-none", children: [
    /* @__PURE__ */ jsx2(DialogHeader, { children: /* @__PURE__ */ jsx2(DialogTitle, { children: i18n.newTask }) }),
    /* @__PURE__ */ jsxs2("div", { className: "flex max-h-[min(66vh,36rem)] flex-col gap-2.5 overflow-y-auto pr-0.5", children: [
      /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskTitle, children: /* @__PURE__ */ jsx2(
        Input,
        {
          autoFocus: true,
          value: title,
          placeholder: i18n.newTaskTitlePlaceholder,
          onChange: (event) => setTitle(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }
        }
      ) }),
      /* @__PURE__ */ jsx2(Field, { label: i18n.description, children: /* @__PURE__ */ jsx2(
        "textarea",
        {
          rows: 3,
          value: body,
          placeholder: i18n.newTaskDescriptionPlaceholder,
          onChange: (event) => setBody(event.target.value),
          className: "w-full resize-y bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-1 text-[11px]"
        }
      ) }),
      /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-2 gap-2.5", children: [
        /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskProject, children: /* @__PURE__ */ jsxs2(Picker, { value: chosenProject ? chosenProject.name : i18n.newTaskNoProject, ariaLabel: i18n.newTaskProject, children: [
          /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setProjectId(""), children: [
            /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: i18n.newTaskNoProject }),
            !projectId && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
          ] }),
          projects.length > 0 && /* @__PURE__ */ jsx2(DropdownMenuSeparator2, {}),
          projects.map((project) => /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setProjectId(project.id), children: [
            /* @__PURE__ */ jsxs2("span", { className: "flex min-w-0 flex-1 flex-col", children: [
              /* @__PURE__ */ jsx2("span", { className: "truncate", children: project.name }),
              project.path ? /* @__PURE__ */ jsx2("span", { className: "truncate font-mono text-[9.5px] text-(--ui-text-quaternary)", children: project.path }) : null
            ] }),
            projectId === project.id && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
          ] }, project.id))
        ] }) }),
        /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskWorkspace, children: /* @__PURE__ */ jsx2(Picker, { value: workspaceKind, ariaLabel: i18n.newTaskWorkspace, children: WORKSPACE_KINDS.map((kind) => /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setWorkspaceKind(kind), children: [
          /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate font-mono text-[11px]", children: kind }),
          workspaceKind === kind && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
        ] }, kind)) }) })
      ] }),
      workspaceKind !== "scratch" && /* @__PURE__ */ jsxs2(Field, { label: i18n.newTaskWorkspacePath, children: [
        /* @__PURE__ */ jsx2(
          Input,
          {
            value: workspacePath,
            placeholder: i18n.newTaskWorkspaceInherit,
            onChange: (event) => setWorkspacePath(event.target.value)
          }
        ),
        /* @__PURE__ */ jsx2("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: i18n.newTaskWorkspaceInheritHint })
      ] }),
      /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-2 gap-2.5", children: [
        /* @__PURE__ */ jsx2(Field, { label: i18n.assignLabel, children: /* @__PURE__ */ jsxs2(Picker, { value: assignee || i18n.unassigned, ariaLabel: i18n.assignLabel, children: [
          /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setAssignee(""), children: [
            /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: i18n.unassigned }),
            !assignee && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
          ] }),
          assignees.length > 0 && /* @__PURE__ */ jsx2(DropdownMenuSeparator2, {}),
          assignees.map((name) => /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setAssignee(name), children: [
            /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: name }),
            assignee === name && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
          ] }, name))
        ] }) }),
        /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskPriority, children: /* @__PURE__ */ jsx2(
          "input",
          {
            type: "number",
            min: "0",
            step: "1",
            value: priority,
            onChange: (event) => setPriority(event.target.value),
            className: "bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]"
          }
        ) })
      ] }),
      /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskSkills, children: /* @__PURE__ */ jsx2(
        Input,
        {
          value: skills,
          placeholder: i18n.newTaskSkillsPlaceholder,
          onChange: (event) => setSkills(event.target.value)
        }
      ) }),
      /* @__PURE__ */ jsxs2(Field, { label: i18n.newTaskModel, children: [
        /* @__PURE__ */ jsx2(
          Input,
          {
            value: modelOverride,
            placeholder: i18n.newTaskModelInherit,
            onChange: (event) => setModelOverride(event.target.value)
          }
        ),
        /* @__PURE__ */ jsx2("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: i18n.newTaskModelHint })
      ] }),
      /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskParent, children: /* @__PURE__ */ jsxs2(
        Picker,
        {
          value: chosenParent ? /* @__PURE__ */ jsxs2("span", { className: "flex min-w-0 items-center gap-1.5", children: [
            /* @__PURE__ */ jsx2(StatusDot, { status: chosenParent.status }),
            /* @__PURE__ */ jsx2("span", { className: "min-w-0 truncate", children: chosenParent.title })
          ] }) : i18n.newTaskNoParent,
          ariaLabel: i18n.newTaskParent,
          children: [
            /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setParentId(""), children: [
              /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: i18n.newTaskNoParent }),
              !parentId && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
            ] }),
            parentOptions.length > 0 && /* @__PURE__ */ jsx2(DropdownMenuSeparator2, {}),
            parentOptions.map((task) => /* @__PURE__ */ jsxs2(DropdownMenuItem2, { onSelect: () => setParentId(task.id), children: [
              /* @__PURE__ */ jsxs2("span", { className: "flex min-w-0 flex-1 items-center gap-1.5", children: [
                /* @__PURE__ */ jsx2(StatusDot, { status: task.status }),
                /* @__PURE__ */ jsx2("span", { className: "min-w-0 flex-1 truncate", children: task.title })
              ] }),
              parentId === task.id && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
            ] }, task.id))
          ]
        }
      ) }),
      /* @__PURE__ */ jsxs2("div", { className: "flex flex-wrap items-center gap-4", children: [
        /* @__PURE__ */ jsxs2("label", { className: "flex items-center gap-2 text-[11px] text-(--ui-text-secondary)", children: [
          /* @__PURE__ */ jsx2(Switch, { checked: triage, onCheckedChange: (value) => setTriage(Boolean(value)) }),
          i18n.newTaskTriage
        ] }),
        /* @__PURE__ */ jsxs2("label", { className: "flex items-center gap-2 text-[11px] text-(--ui-text-secondary)", children: [
          /* @__PURE__ */ jsx2(Switch, { checked: goalMode, onCheckedChange: (value) => setGoalMode(Boolean(value)) }),
          i18n.newTaskGoalMode
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs2(DialogFooter, { className: "gap-2", children: [
      /* @__PURE__ */ jsx2(Button2, { variant: "ghost", onClick: onClose, disabled: busy, children: i18n.cancel }),
      /* @__PURE__ */ jsx2(Button2, { onClick: submit, disabled: !canSubmit, children: busy ? i18n.creating : i18n.create })
    ] })
  ] }) });
}

// src/main.ts
var ID2 = "kanban-gantt";
var ROW_H = 28;
var BAR_H = 14;
var MIN_BAR_SEC = 2 * 3600;
var ZOOM_MIN = 0.2;
var ZOOM_MAX = 1.8;
var ZOOM_STEP = 0.05;
function toast(kind, message) {
  try {
    if (host && typeof host.notify === "function" && message) {
      host.notify({ kind, message });
    }
  } catch {
  }
}
function Ruler({ min, max, pxPerSec }) {
  const unit = tickUnit(max - min);
  const tickValues = ticks(min, max, unit);
  const dayWidth = pxPerSec * DAY;
  const showWeekday = unit === "day" && dayWidth >= 50;
  return jsxs3("div", {
    className: "relative border-b border-(--ui-stroke-secondary) select-none text-[10px]",
    style: { height: showWeekday ? "32px" : "24px" },
    children: tickValues.map((t) => {
      const left = Math.round((t - min) * pxPerSec);
      const d = new Date(t * 1e3);
      const label = unit === "month" ? d.toLocaleDateString(void 0, { month: "short", year: "2-digit" }) : d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
      const weekday = showWeekday ? d.toLocaleDateString(void 0, { weekday: "short" }).replace(/\./g, "").slice(0, 3).toUpperCase() : null;
      return jsxs3("div", {
        className: "absolute top-0 flex flex-col",
        style: { left: `${left}px` },
        children: [
          jsx3("div", { className: "h-1.5 w-px bg-(--ui-stroke-tertiary)" }),
          weekday ? jsx3("div", { className: "pl-0.5 text-[8.5px] font-semibold text-(--ui-text-tertiary) leading-none pt-0.5", children: weekday }) : null,
          jsx3("div", { className: "pl-0.5 text-(--ui-text-tertiary) leading-tight", children: label })
        ]
      });
    })
  });
}
function Bar({ task, bar, pxPerSec, min, onOpen }) {
  const i18n = useGanttI18n();
  const left = Math.round((bar.t0 - min) * pxPerSec);
  const top = Math.round((ROW_H - BAR_H) / 2);
  const tone = bar.tone || statusTone(task.status);
  const style = { top: `${top}px`, height: `${BAR_H}px`, left: `${left}px`, cursor: "pointer" };
  let title = task.title;
  if (bar.kind === "done") {
    style.background = tone === "var(--ui-text-tertiary)" ? "#60a5fa" : tone;
    style.opacity = "0.85";
    title = i18n.barDoneReal(task.title);
  } else if (bar.kind === "done-instant") {
    style.background = tone === "var(--ui-text-tertiary)" ? "#60a5fa" : tone;
    style.opacity = "0.55";
    style.width = style.width || "4px";
    style.borderRadius = "999px";
    title = i18n.barDoneUnknown(task.title);
  } else if (bar.kind === "progress") {
    style.background = `color-mix(in srgb, ${tone} 22%, transparent)`;
    style.border = `1px solid ${tone}`;
    title = i18n.barRunning(task.title);
  } else if (bar.kind === "blocked-wait") {
    style.border = `1px dashed ${tone}`;
    style.background = `color-mix(in srgb, ${tone} 10%, transparent)`;
    title = i18n.barBlockedWaiting(task.title);
  } else {
    style.border = `1px dashed ${tone}`;
    style.background = "transparent";
    title = i18n.barNotStarted(task.title);
  }
  if (bar.t1 != null) {
    style.width = `${Math.max(Math.round((bar.t1 - bar.t0) * pxPerSec), 2)}px`;
  }
  const children = [];
  if (bar.kind === "progress") {
    children.push(jsx3("div", {
      className: "absolute rounded-sm",
      style: {
        left: 0,
        top: 0,
        bottom: 0,
        width: "100%",
        background: tone,
        opacity: 0.75
      }
    }));
    if (task.status === "running") {
      children.push(jsx3("div", { className: "kg-arc", style: { "--kanban-tone": tone } }));
    }
  }
  const onClick = onOpen ? () => onOpen(task.id) : void 0;
  if (bar.kind === "done" || bar.kind === "done-instant") {
    return jsx3("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick });
  }
  return jsxs3("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick, children });
}
function cleanTitle(title, label) {
  if (!title) return "(sans titre)";
  let t = title.trim();
  if (t.startsWith("[")) {
    const idx = t.indexOf("]");
    if (idx > 0) {
      t = t.slice(idx + 1).trim();
    }
  }
  return t || title;
}
function ResizeHandle({ get, set, min, max, resetTo, storageKey, growDirection = "right" }) {
  const drag = useRef2(null);
  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startPointer: e.clientX, startW: get() };
    const onMove = (ev) => {
      const d = drag.current;
      if (!d) return;
      const delta = growDirection === "right" ? ev.clientX - d.startPointer : d.startPointer - ev.clientX;
      set(Math.min(max, Math.max(min, Math.round(d.startW + delta))));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (getStorage()) getStorage().set(storageKey, String(get()));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return jsx3("div", {
    onPointerDown,
    onDoubleClick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      set(resetTo);
      if (getStorage()) getStorage().set(storageKey, String(resetTo));
    },
    className: cn2(
      "absolute z-40 touch-none transition-colors hover:bg-(--ui-accent)/30 active:bg-(--ui-accent)/50 cursor-col-resize"
    ),
    style: {
      touchAction: "none",
      // Inline positioning: negative Tailwind offsets may be missing from the
      // desktop's compiled CSS, which shifts the drawer handle ~16px inward.
      top: 0,
      bottom: 0,
      ...growDirection === "right" ? { right: -5, width: 10 } : { left: -4, width: 8 }
    },
    role: "separator",
    "aria-orientation": "vertical"
  });
}
function TaskRow({ task, depth, isChild, now, pxPerSec, min, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge }) {
  const i18n = useGanttI18n();
  const labelW = useValue2($labelW);
  const bars = taskBars(task, now);
  const label = task.label ? `[${task.label}]` : "";
  const name = cleanTitle(task.title, task.label);
  const connector = isChild ? jsx3("span", {
    className: "absolute",
    style: {
      // Drawn BEFORE the checkbox (visually left of it) and sized so its
      // right edge lands exactly on the checkbox's left edge: with the
      // label padding-left of `depth * 12 + 8`, the connector spans
      // [depth*12+2, depth*12+8] — 6px wide, no overlap with the box.
      left: `${depth * 12 + 2}px`,
      top: "calc(50% - 12px)",
      width: "6px",
      height: "12px",
      borderLeft: "1px solid var(--ui-stroke-secondary)",
      borderBottom: "1px solid var(--ui-stroke-secondary)"
    }
  }) : null;
  const dotColor = (bars.length > 0 ? bars[bars.length - 1]?.tone : null) || statusTone(task.status);
  const STATUS_ICON = {
    triage: "question",
    todo: "circle-large-outline",
    scheduled: "clock",
    ready: "play-circle",
    running: "pulse",
    blocked: "warning",
    review: "eye",
    done: "check",
    archived: "archive"
  };
  const statusIcon = STATUS_ICON[task.status] || "circle-large-outline";
  const statusTitle = i18n.col?.[task.status] || task.status;
  return jsxs3("div", {
    className: cn2(
      "group grid items-center border-b border-(--ui-stroke-tertiary)/40 transition-colors cursor-pointer",
      isSelected ? "bg-(--ui-accent)/12 font-semibold" : isChecked ? "bg-(--ui-accent)/6" : isEven ? "bg-black/[0.02] dark:bg-white/[0.02]" : "bg-transparent",
      "hover:bg-(--ui-accent)/8"
    ),
    style: { gridTemplateColumns: `${labelW}px ${timelineW}px`, height: `${ROW_H}px` },
    onClick: (e) => {
      if (e.target.tagName === "INPUT" && e.target.type === "checkbox") return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        onToggleCheck(task.id, !isChecked, e.nativeEvent);
      } else {
        onOpen(task.id);
      }
    },
    children: [
      jsxs3("div", {
        className: cn2(
          "relative flex items-center gap-1.5 min-w-0 sticky left-0 z-10 self-stretch",
          isSelected ? "font-semibold text-(--ui-accent)" : ""
        ),
        "data-glass-opaque": true,
        style: {
          paddingLeft: `${depth * 12 + 8}px`,
          paddingRight: "8px",
          width: `${labelW}px`,
          // Opaque fill spanning the full row height, tinted like the row
          // itself so the selection/check highlight stays visible through it.
          backgroundColor: isSelected ? "color-mix(in srgb, var(--ui-accent) 12%, var(--ui-bg-chrome))" : isChecked ? "color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-chrome))" : isEven ? "color-mix(in srgb, var(--ui-text-primary) 2%, var(--ui-bg-chrome))" : "var(--ui-bg-chrome)"
        },
        children: [
          connector,
          jsx3("input", {
            type: "checkbox",
            checked: Boolean(isChecked),
            onChange: (e) => onToggleCheck(task.id, e.target.checked, e.nativeEvent),
            onClick: (e) => e.stopPropagation(),
            className: "shrink-0 rounded cursor-pointer mr-1",
            "aria-label": i18n.selectTask(name)
          }),
          jsx3("span", {
            className: "inline-flex items-center justify-center shrink-0 self-center",
            style: { color: dotColor },
            title: statusTitle,
            "aria-label": statusTitle,
            children: task.status === "running" ? jsxs3("span", {
              className: "relative inline-flex items-center justify-center",
              children: [
                jsx3("div", { className: "kg-arc", style: { "--kanban-tone": dotColor } }),
                jsx3(Codicon3, { name: statusIcon, size: "0.85rem" })
              ]
            }) : jsx3(Codicon3, { name: statusIcon, size: "0.85rem" })
          }),
          showBoardBadge && task.board ? jsx3(Badge, {
            size: "xs",
            variant: "outline",
            className: "shrink-0 font-mono text-[9px] px-1 py-0 h-3.5 max-w-[80px] truncate leading-tight",
            title: `${i18n.board} ${task.board}`,
            children: task.board
          }) : null,
          jsxs3("span", {
            className: cn2(
              "relative inline-flex items-center min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] text-left select-none px-1 py-0.5 rounded",
              task.status === "running" && "font-medium",
              isSelected ? "font-bold text-(--ui-accent)" : ""
            ),
            title: `${showBoardBadge && task.board ? `[${task.board}] ` : ""}${name} (${task.id}) — ${i18n.clickForDetail}`,
            children: [
              task.status === "running" ? jsx3("div", { className: "kg-arc", style: { "--kanban-tone": dotColor } }) : null,
              name
            ]
          })
        ]
      }),
      jsxs3("div", {
        className: "relative overflow-hidden",
        style: { height: `${ROW_H}px` },
        children: bars.length > 0 ? bars.map((b, idx) => jsx3(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, onOpen })) : [jsx3("div", { key: "empty", className: "text-(--ui-text-quaternary) text-[10px]", children: "—" })]
      })
    ]
  });
}
function ProfileAvatar({ name, size = "1rem" }) {
  const color = profileColor(name);
  const initials = (() => {
    const parts = (name || "?").split(/[\s_\-./]+/).filter(Boolean);
    return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
  })();
  return jsx3("span", {
    className: "grid shrink-0 place-items-center rounded-full font-semibold select-none text-[8px]",
    style: {
      backgroundColor: color ? profileColorSoft(color, 22) : "var(--ui-bg-quaternary, rgba(150,150,150,0.15))",
      color: color ?? "var(--ui-text-secondary)",
      height: size,
      width: size
    },
    title: name,
    children: initials
  });
}
var ALL_STATUS_KEYS = ["ready", "running", "review", "blocked", "scheduled", "todo", "triage", "done"];
function FilterDropdown({
  assignees,
  selectedAssignees,
  onToggleAssignee,
  onClearAssignees,
  disabledStatuses,
  onToggleStatus,
  showArchived,
  onToggleArchived
}) {
  const i18n = useGanttI18n();
  const active = selectedAssignees.size > 0 || disabledStatuses.size > 0 || showArchived;
  return jsxs3(DropdownMenu3, {
    children: [
      jsx3(DropdownMenuTrigger3, {
        asChild: true,
        children: jsx3(Button3, {
          size: "icon-xs",
          variant: "ghost",
          className: cn2(active && "bg-(--ui-control-active-background) text-(--ui-accent)"),
          "aria-label": i18n.filters,
          children: jsx3(Codicon3, { name: "filter", size: "0.85rem" })
        })
      }),
      jsxs3(DropdownMenuContent3, {
        align: "start",
        className: "min-w-[12rem] p-1",
        children: [
          jsx3("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.profiles }),
          jsxs3(DropdownMenuItem3, {
            onClick: onClearAssignees,
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx3("span", { className: "flex-1 font-medium", children: i18n.allProfiles }),
              selectedAssignees.size === 0 ? jsx3(Codicon3, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
            ]
          }),
          assignees.map((name) => {
            const isChecked = selectedAssignees.has(name);
            return jsxs3(DropdownMenuItem3, {
              key: name,
              onClick: () => onToggleAssignee(name),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx3(ProfileAvatar, { name, size: "1rem" }),
                jsx3("span", { className: "flex-1", children: name }),
                isChecked ? jsx3(Codicon3, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          jsx3(DropdownMenuSeparator3, {}),
          jsx3("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.statuses }),
          ALL_STATUS_KEYS.map((s) => {
            const isVisible = !disabledStatuses.has(s);
            const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
            const label = i18n.col?.[s] || meta.label;
            return jsxs3(DropdownMenuItem3, {
              key: s,
              onClick: () => onToggleStatus(s),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx3("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                jsx3("span", { className: cn2("flex-1", !isVisible && "line-through opacity-50"), children: label }),
                isVisible ? jsx3(Codicon3, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          jsx3(DropdownMenuSeparator3, {}),
          jsxs3(DropdownMenuItem3, {
            onClick: () => onToggleArchived(!showArchived),
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx3("span", { className: "flex-1", children: i18n.showArchived }),
              showArchived ? jsx3(Codicon3, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
            ]
          })
        ]
      })
    ]
  });
}
function Legend({ disabledStatuses, onToggleStatus }) {
  const i18n = useGanttI18n();
  const item = (statusKey, color, txt) => {
    const isExcluded = disabledStatuses ? disabledStatuses.has(statusKey) : false;
    const label = i18n.col?.[statusKey] || txt;
    return jsxs3("button", {
      type: "button",
      onClick: onToggleStatus ? () => onToggleStatus(statusKey) : void 0,
      className: cn2(
        "inline-flex items-center gap-1.5 text-[10px] cursor-pointer bg-transparent border-0 p-0 select-none transition-opacity hover:opacity-100",
        isExcluded ? "opacity-40 line-through text-(--ui-text-quaternary)" : "text-(--ui-text-tertiary)"
      ),
      title: isExcluded ? i18n.legendShow(label) : i18n.legendHide(label),
      children: [
        jsx3("div", {
          className: "h-2 w-3 rounded-xs shrink-0",
          style: { backgroundColor: color, opacity: isExcluded ? 0.3 : 1 }
        }),
        jsx3("span", { children: label })
      ]
    });
  };
  return jsxs3("div", {
    className: "flex flex-wrap items-center gap-3 pt-2 border-t border-(--ui-stroke-tertiary)/50 shrink-0 mt-auto select-none",
    children: [
      item("ready", "#60a5fa", "Ready"),
      item("running", "#34d399", "Running"),
      item("review", "#fbbf24", "Review"),
      item("blocked", "#f87171", "Blocked"),
      item("scheduled", "#a78bfa", "Scheduled"),
      item("todo", "var(--ui-text-secondary)", "Todo"),
      item("triage", "var(--ui-text-tertiary)", "Triage"),
      item("done", "var(--ui-text-tertiary)", "Done"),
      item("archived", "var(--ui-text-quaternary)", "Archived")
    ]
  });
}
function WeekendBands({ min, max, pxPerSec }) {
  const step = DAY;
  const bands = [];
  let t = Math.floor(min / step) * step;
  while (t <= max) {
    const d = new Date(t * 1e3);
    const dayOfWeek = d.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const left = Math.round((t - min) * pxPerSec);
      const width = Math.round(DAY * pxPerSec);
      bands.push(jsx3("div", {
        className: "absolute top-0 bottom-0 pointer-events-none bg-black/15 dark:bg-black/25",
        style: { left: `${left}px`, width: `${width}px` }
      }, t));
    }
    t += step;
  }
  return jsxs3("div", { className: "absolute inset-0 pointer-events-none z-0", children: bands });
}
var STATUS_META = {
  triage: { tone: "var(--ui-text-tertiary)", label: "Triage" },
  todo: { tone: "var(--ui-text-secondary)", label: "Todo" },
  scheduled: { tone: "#a78bfa", label: "Scheduled" },
  ready: { tone: "#60a5fa", label: "Ready" },
  running: { tone: "#34d399", label: "Running" },
  blocked: { tone: "#f87171", label: "Blocked" },
  review: { tone: "#fbbf24", label: "Review" },
  done: { tone: "var(--ui-text-tertiary)", label: "Done" },
  archived: { tone: "var(--ui-text-quaternary)", label: "Archived" }
};
var STATUS_ORDER = ["triage", "todo", "ready", "blocked", "running", "review", "done"];
var ACTION_MATRIX = {
  triage: { primary: ["todo"], more: ["blocked", "archive"] },
  todo: { primary: ["ready"], more: ["blocked", "review", "archive"] },
  scheduled: { primary: ["ready"], more: ["blocked", "archive"] },
  ready: { primary: ["done", "blocked"], more: ["review", "archive"] },
  running: { primary: ["done", "review"], more: ["blocked"] },
  blocked: { primary: ["ready"], more: ["review", "archive"] },
  review: { primary: ["done", "reopen"], more: ["blocked"] },
  done: { primary: ["archive"], more: ["ready"] },
  archived: { primary: ["done"], more: [] }
};
function AssigneeBadge({ assignee, assignees = [], onAssign, disabled }) {
  const i18n = useGanttI18n();
  const current = assignee || i18n.unassigned;
  return jsxs3(DropdownMenu3, { children: [
    jsx3(DropdownMenuTrigger3, {
      asChild: true,
      disabled,
      children: jsx3("button", {
        type: "button",
        className: "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle, transparent) hover:bg-(--chrome-action-hover)",
        children: [
          assignee ? jsx3(ProfileAvatar, { name: assignee, size: "0.9rem" }) : jsx3("span", { className: "text-(--ui-text-tertiary)", children: "👤" }),
          jsx3("span", { children: current }),
          jsx3("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs3(DropdownMenuContent3, {
      align: "start",
      className: "min-w-[10rem] p-1",
      children: [
        jsx3(DropdownMenuItem3, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px] text-(--ui-text-tertiary)",
          onClick: () => onAssign(""),
          children: [
            jsx3("span", { className: "flex-1", children: i18n.unassignedEmpty }),
            !assignee ? jsx3("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }),
        assignees.map((name) => {
          const isCur = name === assignee;
          return jsx3(DropdownMenuItem3, {
            key: name,
            className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
            onClick: () => onAssign(name),
            children: [
              jsx3(ProfileAvatar, { name, size: "0.9rem" }),
              jsx3("span", { className: "flex-1", children: name }),
              isCur ? jsx3("span", { className: "opacity-60", children: "✓" }) : null
            ]
          }, name);
        })
      ]
    })
  ] });
}
function SelectionBar({
  selected,
  onClear,
  onStatus,
  onAssign,
  onArchive,
  onDelete,
  assignees = [],
  busy = false
}) {
  const i18n = useGanttI18n();
  const [menu, setMenu] = useState2(null);
  const [customAssignee, setCustomAssignee] = useState2("");
  if (selected.size === 0) return null;
  return jsx3("div", {
    className: "pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-150",
    children: jsxs3("div", {
      className: "pointer-events-auto flex items-center gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1.5 pr-1.5 pl-3.5 shadow-xl",
      children: [
        jsx3("span", { className: "mr-1 text-xs tabular-nums font-medium text-(--ui-text-secondary)", children: i18n.nSelected(selected.size) }),
        // Move to dropdown
        jsxs3(DropdownMenu3, {
          open: menu === "move",
          onOpenChange: (open) => setMenu(open ? "move" : null),
          children: [
            jsx3(DropdownMenuTrigger3, {
              asChild: true,
              children: jsxs3(Button3, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx3("span", { children: i18n.moveToShort }),
                  jsx3(Codicon3, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsx3(DropdownMenuContent3, {
              align: "center",
              className: "min-w-[9rem] p-1",
              children: STATUS_ORDER.map((s) => {
                const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
                const label = i18n.col?.[s] || meta.label;
                return jsxs3(DropdownMenuItem3, {
                  key: s,
                  onClick: () => {
                    setMenu(null);
                    onStatus(s);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx3("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                    jsx3("span", { className: "flex-1", children: label })
                  ]
                });
              })
            })
          ]
        }),
        // Assign dropdown
        jsxs3(DropdownMenu3, {
          open: menu === "assign",
          onOpenChange: (open) => setMenu(open ? "assign" : null),
          children: [
            jsx3(DropdownMenuTrigger3, {
              asChild: true,
              children: jsxs3(Button3, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx3("span", { children: i18n.assignLabel.replace(":", "") }),
                  jsx3(Codicon3, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsxs3(DropdownMenuContent3, {
              align: "center",
              className: "min-w-[10rem] p-1",
              children: [
                assignees.map((name) => jsx3(DropdownMenuItem3, {
                  key: name,
                  onClick: () => {
                    setMenu(null);
                    onAssign(name);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx3(ProfileAvatar, { name, size: "0.85rem" }),
                    jsx3("span", { className: "flex-1", children: name })
                  ]
                })),
                assignees.length > 0 ? jsx3(DropdownMenuSeparator3, {}) : null,
                jsx3(DropdownMenuItem3, {
                  onClick: () => {
                    setMenu(null);
                    onAssign("");
                  },
                  className: "text-xs py-1.5 cursor-pointer text-(--ui-text-tertiary)",
                  children: i18n.unassignAction
                })
              ]
            })
          ]
        }),
        // Archive button
        jsx3(Button3, {
          disabled: busy,
          onClick: onArchive,
          size: "xs",
          variant: "ghost",
          className: "text-xs",
          children: i18n.actions.archive
        }),
        // Delete button
        jsx3(Button3, {
          disabled: busy,
          onClick: onDelete,
          size: "xs",
          variant: "ghost",
          className: "text-destructive text-xs hover:bg-destructive/10",
          children: i18n.delete
        }),
        // Clear button (✕)
        jsx3(Button3, {
          "aria-label": i18n.clearSelection,
          onClick: onClear,
          size: "icon-xs",
          variant: "ghost",
          className: "ml-1 text-(--ui-text-quaternary) hover:text-(--ui-text-primary)",
          children: jsx3(Codicon3, { name: "close", size: "0.8rem" })
        })
      ]
    })
  });
}
function StatusBadge({ status, onPick, disabled }) {
  const i18n = useGanttI18n();
  const meta = STATUS_META[status] || STATUS_META.todo;
  const label = i18n.col?.[status] || meta.label;
  const isRunning = status === "running";
  return jsxs3(DropdownMenu3, { children: [
    jsx3(DropdownMenuTrigger3, {
      asChild: true,
      disabled,
      children: jsx3("button", {
        type: "button",
        className: "relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer",
        style: { background: `color-mix(in srgb, ${meta.tone} 18%, transparent)`, color: "inherit", border: `1px solid color-mix(in srgb, ${meta.tone} 45%, transparent)` },
        children: [
          isRunning ? jsx3("div", { className: "kg-arc", style: { "--kanban-tone": meta.tone } }) : null,
          jsx3("span", { className: "h-2 w-2 rounded-full", style: { backgroundColor: meta.tone } }),
          jsx3("span", { children: label }),
          jsx3("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs3(DropdownMenuContent3, {
      align: "start",
      className: "min-w-[9rem] p-1",
      children: STATUS_ORDER.map((s) => {
        const m = STATUS_META[s];
        const current = s === status;
        const l = i18n.col?.[s] || m.label;
        return jsx3(DropdownMenuItem3, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
          onClick: () => {
            if (!current) onPick(s);
          },
          disabled: current,
          children: [
            jsx3("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: m.tone } }),
            jsx3("span", { className: "flex-1", children: l }),
            current ? jsx3("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }, s);
      })
    })
  ] });
}
function TaskDrawer({ taskId, board, onClose, assignees = [], docked = false, onToggleDock }) {
  const drawerW = useValue2($drawerW);
  const i18n = useGanttI18n();
  const scrollContainerRef = useRef2(null);
  const prevTaskIdRef = useRef2(null);
  const { data, isLoading, isError, refetch } = useQuery2({
    queryKey: ["kanban-gantt", "task", apiBase(), board, taskId],
    queryFn: () => fetchTask(taskId, board),
    enabled: Boolean(taskId)
  });
  useEffect2(() => {
    if (taskId && prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [taskId]);
  const [comment, setComment] = useState2("");
  const [actionError, setActionError] = useState2(null);
  const [runsOpen, setRunsOpen] = useState2(false);
  const [commentsOpen, setCommentsOpen] = useState2(true);
  const [showAllComments, setShowAllComments] = useState2(false);
  const statusMutation = useMutation({
    mutationFn: (payload) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/status${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: payload }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const commentMutation = useMutation({
    mutationFn: (body) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/comments${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "POST", body }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const assignMutation = useMutation({
    mutationFn: (profile) => apiFetch(
      `/tasks/${encodeURIComponent(taskId)}/assignee${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: { profile } }
    ),
    onSuccess: () => {
      setActionError(null);
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
    },
    onError: (error) => setActionError(String(error?.message || error))
  });
  const st = data?.task?.status || "todo";
  const matrix = ACTION_MATRIX[st] || { primary: [], more: [] };
  const more = matrix.more || [];
  const actionLabel = (a) => i18n.actions?.[a] || a;
  return jsxs3("div", {
    className: docked ? "relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4" : "absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4",
    "data-glass-opaque": true,
    role: "dialog",
    "aria-label": i18n.taskDetail,
    style: { width: `${drawerW}px` },
    children: [
      jsx3(ResizeHandle, {
        get: () => $drawerW.get(),
        set: (w) => $drawerW.set(w),
        min: DRAWER_W_MIN,
        max: DRAWER_W_MAX,
        resetTo: 416,
        storageKey: "drawerW",
        growDirection: "left"
      }),
      // Pinned top section: header, actions and title with bottom separator
      jsxs3("div", {
        className: "flex flex-col gap-2 pb-3 border-b border-(--ui-stroke-tertiary) shrink-0",
        children: [
          // Top row: status, assignee, task id, [...] menu, close
          jsxs3("div", {
            className: "flex items-center justify-between gap-1.5",
            children: [
              jsxs3("div", { className: "flex flex-wrap items-center gap-1.5 min-w-0", children: [
                jsx3(Button3, { size: "icon-xs", variant: "ghost", onClick: onToggleDock, "aria-label": docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? "»" : "«" }),
                StatusBadge({
                  status: data?.task?.status,
                  disabled: statusMutation.isPending,
                  onPick: (next) => {
                    const action = next === "done" ? "done" : next === "blocked" ? "blocked" : next === "ready" ? "ready" : next === "todo" ? "todo" : next === "review" ? "review" : next === "triage" ? "triage" : null;
                    if (action) statusMutation.mutate({ action });
                  }
                }),
                jsx3(AssigneeBadge, {
                  assignee: data?.task?.assignee,
                  assignees,
                  disabled: assignMutation.isPending,
                  onAssign: (profile) => assignMutation.mutate(profile)
                }),
                jsx3("span", {
                  className: "text-[11px] font-mono text-(--ui-text-quaternary) hover:text-(--ui-text-secondary) cursor-help select-all",
                  title: i18n.copyHint(taskId),
                  children: shortId(taskId)
                })
              ] }),
              jsxs3("div", { className: "flex items-center gap-1 shrink-0", children: [
                jsxs3(DropdownMenu3, { children: [
                  jsx3(DropdownMenuTrigger3, {
                    asChild: true,
                    children: jsx3("button", {
                      type: "button",
                      className: "inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent",
                      "aria-label": i18n.actionsMenu,
                      children: jsx3(Codicon3, { name: "ellipsis", size: "0.9rem" })
                    })
                  }),
                  jsxs3(DropdownMenuContent3, {
                    align: "end",
                    className: "min-w-[11rem] p-1 text-xs",
                    children: [
                      jsx3(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => void navigator.clipboard.writeText(taskId),
                        children: i18n.copyTaskId
                      }),
                      jsx3(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => {
                          if (data?.task?.title) void navigator.clipboard.writeText(data.task.title);
                        },
                        children: i18n.copyTitle
                      }),
                      jsx3(DropdownMenuSeparator3, {}),
                      // Creation verb reachable from a task: the new task starts
                      // as a child of this one.
                      jsx3(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => $newTask.set({ parentId: taskId }),
                        children: jsxs3("span", { className: "flex items-center gap-2", children: [
                          jsx3(Codicon3, { name: "add", size: "0.85rem" }),
                          i18n.createSubtask
                        ] })
                      }),
                      more.length ? jsx3(DropdownMenuSeparator3, {}) : null,
                      more.map((a) => jsx3(DropdownMenuItem3, {
                        key: a,
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => statusMutation.mutate({ action: a }),
                        children: actionLabel(a)
                      })),
                      jsx3(DropdownMenuSeparator3, {}),
                      jsx3(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-500/10",
                        onClick: () => {
                          if (confirm(i18n.confirmDelete(taskId))) {
                            statusMutation.mutate({ action: "delete" });
                            onClose();
                          }
                        },
                        children: i18n.delete
                      })
                    ]
                  })
                ] }),
                jsx3(Button3, { size: "icon-xs", variant: "ghost", onClick: onClose, "aria-label": i18n.close, children: "✕" })
              ] })
            ]
          }),
          // Primary actions bar placed ABOVE the title
          (matrix.primary || []).length ? jsxs3("div", { className: "flex flex-wrap items-center gap-1.5 py-0.5", children: [
            jsx3("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary) mr-1", children: i18n.action }),
            (matrix.primary || []).map((a) => jsx3(Button3, {
              key: a,
              size: "xs",
              disabled: statusMutation.isPending,
              onClick: () => statusMutation.mutate({ action: a }),
              children: actionLabel(a)
            }))
          ] }) : null,
          // Title kept always visible
          jsx3("div", { className: "text-base font-semibold leading-snug", children: cleanTitle(data?.task?.title, data?.task?.label) })
        ]
      }),
      actionError ? jsx3("div", { className: "text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded p-1.5 shrink-0", children: actionError }) : null,
      // Scrollable content underneath the pinned header + title
      isLoading ? jsx3("div", { className: "py-8 flex justify-center", children: jsx3(Loader, {}) }) : isError ? jsx3(ErrorState, { title: i18n.taskUnreadable, description: i18n.taskUnreadableDesc }) : jsxs3("div", { ref: scrollContainerRef, className: "flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pt-1", children: [
        (data?.task?.dependencies || []).length ? jsxs3("div", { className: "text-[11px]", children: [
          jsx3("span", { className: "text-[10px] uppercase text-(--ui-text-tertiary)", children: i18n.dependencies }),
          ...(data.task.dependencies || []).map((d, i) => jsxs3("span", { title: d.id, children: [
            i > 0 ? " · " : null,
            jsx3("span", { className: "text-(--ui-text-secondary)", children: `${d.relation === "parent" ? "⬅" : "➡"} ${d.title}` })
          ] }, i))
        ] }) : null,
        // 1. Description (no max-h clamp)
        data?.task?.body ? jsxs3("div", { className: "flex flex-col gap-1", children: [
          jsx3("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.description }),
          jsx3("div", {
            className: "text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx3(Streamdown, { children: data.task.body })
          })
        ] }) : null,
        // 2. Result (no max-h clamp)
        data?.task?.result ? jsxs3("div", { className: "flex flex-col gap-1", children: [
          jsx3("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.result }),
          jsx3("div", {
            className: "text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx3(Streamdown, { children: data.task.result })
          })
        ] }) : null,
        // 3. Latest summary (highlighted when blocked or done/completed)
        data?.task?.latest_summary ? jsxs3("div", { className: "flex flex-col gap-1", children: [
          jsx3("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.latestSummary }),
          jsx3("div", {
            className: cn2(
              "text-[11px] prose prose-sm kg-prose max-w-none rounded p-2.5 transition-colors",
              data?.task?.status === "blocked" ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : data?.task?.status === "done" || data?.task?.status === "archived" ? "border border-emerald-500/35 bg-emerald-500/10" : "border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)"
            ),
            children: jsx3(Streamdown, { children: data.task.latest_summary })
          })
        ] }) : null,
        // 4. Run history (Collapsible section, collapsed by default, no internal scrollbar)
        (data?.task?.runs || []).length ? jsxs3("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
          jsxs3("button", {
            type: "button",
            className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
            onClick: () => setRunsOpen((o) => !o),
            children: [
              jsxs3("div", { className: "flex items-center gap-1.5", children: [
                jsx3("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: runsOpen ? "▼" : "▶" }),
                jsx3("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.runs(data.task.runs.length) })
              ] }),
              jsx3("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: runsOpen ? i18n.hide : i18n.show })
            ]
          }),
          runsOpen ? jsx3("div", { className: "flex flex-col gap-2 pt-1", children: data.task.runs.map((r, i) => {
            const failed = ["crashed", "failed", "timed_out", "gave_up"].includes(r.outcome || r.status);
            const isDiffProfile = r.profile && data?.task?.assignee && r.profile !== data.task.assignee;
            const durationStr = (() => {
              if (!r.started_at) return "";
              const end = r.ended_at || Math.floor(Date.now() / 1e3);
              const sec = Math.max(0, end - r.started_at);
              if (sec < 60) return `${sec}s`;
              if (sec < 3600) return `${Math.floor(sec / 60)}m`;
              const h = Math.floor(sec / 3600);
              const m = Math.floor(sec % 3600 / 60);
              return m > 0 ? `${h}h ${m}m` : `${h}h`;
            })();
            const dateStr = r.started_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(new Date(r.started_at * 1e3)) : "";
            return jsxs3("div", {
              key: r.id || i,
              className: "flex flex-col gap-1 text-[11px] border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
              children: [
                jsxs3("div", { className: "flex flex-wrap items-center gap-1.5 text-[10px]", children: [
                  jsx3(Badge, { size: "xs", variant: failed ? "destructive" : r.ended_at ? "muted" : "secondary", children: r.outcome || r.status || "run" }),
                  r.profile ? jsxs3("span", { className: cn2("font-medium", isDiffProfile ? "text-amber-500 font-semibold" : "text-(--ui-text-secondary)"), children: [
                    "👤 ",
                    r.profile,
                    isDiffProfile ? jsx3("span", { className: "text-[9px] text-(--ui-text-quaternary) ml-1", children: i18n.reassigned }) : null
                  ] }) : null,
                  durationStr ? jsx3("span", { className: "text-(--ui-text-tertiary)", children: `⏱ ${durationStr}` }) : null,
                  dateStr ? jsx3("span", { className: "text-(--ui-text-quaternary) ml-auto text-[9.5px]", children: dateStr }) : null
                ] }),
                r.summary ? jsx3("div", { className: "prose prose-sm kg-prose max-w-none text-[11px] mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50", children: jsx3(Streamdown, { children: r.summary }) }) : null
              ]
            });
          }) }) : null
        ] }) : null,
        // 5. Commentaires (Collapsible section, open by default, 3 latest by default with button to show previous, no internal scrollbar)
        (() => {
          const commentsList = data?.task?.comments || [];
          const totalComments = commentsList.length;
          const visibleComments = showAllComments ? commentsList : commentsList.slice(-3);
          const hiddenCount = totalComments - visibleComments.length;
          return jsxs3("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
            jsxs3("button", {
              type: "button",
              className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
              onClick: () => {
                setCommentsOpen((o) => {
                  if (o) setShowAllComments(false);
                  return !o;
                });
              },
              children: [
                jsxs3("div", { className: "flex items-center gap-1.5", children: [
                  jsx3("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: commentsOpen ? "▼" : "▶" }),
                  jsx3("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.comments(totalComments) })
                ] }),
                jsx3("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: commentsOpen ? i18n.hide : i18n.show })
              ]
            }),
            commentsOpen ? jsxs3("div", { className: "flex flex-col gap-1.5 pt-1", children: [
              hiddenCount > 0 ? jsx3("button", {
                type: "button",
                className: "text-[10.5px] text-(--ui-accent) hover:underline cursor-pointer border-0 bg-transparent text-left py-0.5 select-none",
                onClick: () => setShowAllComments(true),
                children: `↑ ${i18n.showPreviousComments(hiddenCount)}`
              }) : null,
              visibleComments.map((c, i) => {
                const dateStr = c.created_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.created_at * 1e3)) : "";
                return jsxs3("div", {
                  key: c.id || i,
                  className: "text-[11px] border border-(--ui-stroke-tertiary)/60 rounded p-1.5 bg-(--ui-bg-subtle, transparent)",
                  children: [
                    jsxs3("div", { className: "flex items-center gap-1.5 text-[10px] text-(--ui-text-tertiary) mb-0.5", children: [
                      jsx3("span", { className: "font-medium text-(--ui-text-secondary)", children: c.author || "?" }),
                      dateStr ? jsx3("span", { className: "ml-auto text-(--ui-text-quaternary)", children: dateStr }) : null
                    ] }),
                    jsx3("div", { className: "prose prose-sm kg-prose max-w-none text-[11px]", children: jsx3(Streamdown, { children: c.body || "" }) })
                  ]
                });
              }),
              jsxs3("div", { className: "flex gap-1.5 mt-1", children: [
                jsx3("input", {
                  type: "text",
                  value: comment,
                  placeholder: i18n.addCommentPlaceholder,
                  className: "flex-1 bg-transparent border border-(--ui-stroke-tertiary) rounded px-1.5 py-0.5 text-[11px]",
                  onInput: (event) => setComment(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === "Enter" && comment.trim()) {
                      commentMutation.mutate({ body: comment.trim() });
                      setComment("");
                    }
                  }
                }),
                jsx3(Button3, {
                  size: "xs",
                  disabled: !comment.trim() || commentMutation.isPending,
                  onClick: () => {
                    commentMutation.mutate({ body: comment.trim() });
                    setComment("");
                  },
                  children: i18n.send
                })
              ] })
            ] }) : null
          ] });
        })(),
        // 6. Activité (Derniers événements)
        (data?.task?.events || []).length ? jsxs3("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1", children: [
          jsx3("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.activity(data.task.events.length) }),
          jsx3("div", { className: "flex flex-col gap-0.5 max-h-32 overflow-auto", children: data.task.events.slice(-12).reverse().map((e, i) => jsx3("div", {
            key: i,
            className: "text-[10px] text-(--ui-text-tertiary)",
            children: String(e.kind || "event")
          }, i)) })
        ] }) : null
      ] })
    ]
  });
}
function KanbanGanttPage() {
  const i18n = useGanttI18n();
  const queryClient2 = useQueryClient2();
  const base = useValue2($baseUrl);
  const board = useValue2($boardSlug);
  const openTaskId = useValue2($openTaskId);
  const newTask = useValue2($newTask);
  const labelW = useValue2($labelW);
  const drawerW = useValue2($drawerW);
  const drawerDocked = useValue2($drawerDocked);
  const { data: boardsData } = useQuery2({
    queryKey: ["kanban-gantt", "boards", apiBase()],
    queryFn: () => apiFetch("/boards"),
    refetchInterval: 5 * 6e4
  });
  const { data: projectsData } = useQuery2({
    queryKey: ["kanban-gantt", "projects", apiBase()],
    queryFn: () => fetchProjects(),
    staleTime: 6e4
  });
  const { data, isLoading, isError } = useQuery2({
    queryKey: ["kanban-gantt", "gantt", apiBase(), board],
    queryFn: () => apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ""}`),
    refetchInterval: 6e4
  });
  const [showArchived, setShowArchived] = useState2(false);
  const [selectedAssignees, setSelectedAssignees] = useState2(() => /* @__PURE__ */ new Set());
  const [disabledStatuses, setDisabledStatuses] = useState2(() => {
    const saved = getStorage() ? getStorage().get("disabledStatuses", null) : null;
    return Array.isArray(saved) ? new Set(saved) : /* @__PURE__ */ new Set();
  });
  const [search, setSearch] = useState2("");
  const [selectedIds, setSelectedIds] = useState2(() => /* @__PURE__ */ new Set());
  const [bulkAssignee, setBulkAssignee] = useState2("");
  const lastCheckedIdRef = useRef2(null);
  const [zoom, setZoom] = useState2(() => {
    const saved = getStorage() ? getStorage().get("zoom", null) : null;
    return saved != null && Number.isFinite(Number(saved)) ? Number(saved) : 1;
  });
  const containerRef = useRef2(null);
  const scrollerRef = useRef2(null);
  const [trackW, setTrackW] = useState2(0);
  const handleToggleAssignee = (name) => {
    setSelectedAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const handleClearAssignees = () => setSelectedAssignees(/* @__PURE__ */ new Set());
  const handleToggleStatus = (status) => {
    if (status === "archived") {
      setShowArchived((v) => !v);
      return;
    }
    setDisabledStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      if (getStorage()) getStorage().set("disabledStatuses", [...next]);
      return next;
    });
  };
  const derived = useMemo2(() => {
    if (!data || !data.tasks) return null;
    let visible = data.tasks;
    if (!showArchived) visible = visible.filter((t) => !t.archived);
    if (disabledStatuses.size > 0) {
      visible = visible.filter((t) => !disabledStatuses.has(t.status));
    }
    if (selectedAssignees.size > 0) {
      visible = visible.filter((t) => t.assignee && selectedAssignees.has(t.assignee));
    }
    visible = visible.filter((t) => matchesSearch(t, search));
    const rows2 = buildRows(visible);
    const domain2 = computeDomain(visible);
    const allAssignees = Array.from(new Set(data.tasks.map((t) => t.assignee).filter(Boolean))).sort();
    return { rows: rows2, domain: domain2, total: visible.length, tasks: visible, allAssignees };
  }, [data, showArchived, disabledStatuses, selectedAssignees, search]);
  const createTaskMutation = useMutation({
    mutationFn: (values) => createTask(values, board),
    onSuccess: (response, values) => {
      $newTask.set(null);
      toast("info", i18n.created(values.title));
      void queryClient2.invalidateQueries({ queryKey: ["kanban-gantt"] });
      $openTaskId.set(response.task_id);
    },
    onError: (error) => {
      const message = String(error && error.message || error || "");
      toast("error", /title is required/i.test(message) ? i18n.errTitleRequired : i18n.errCreate);
    }
  });
  const handleToggleCheck = (id, checked, nativeEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const rowsList = derived?.rows || [];
      const taskIds = rowsList.map((r) => r.task.id);
      if (nativeEvent?.shiftKey && lastCheckedIdRef.current && taskIds.includes(lastCheckedIdRef.current)) {
        const lastIdx = taskIds.indexOf(lastCheckedIdRef.current);
        const curIdx = taskIds.indexOf(id);
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = start; i <= end; i++) {
          if (checked) next.add(taskIds[i]);
          else next.delete(taskIds[i]);
        }
      } else {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastCheckedIdRef.current = id;
  };
  useEffect2(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          setSelectedIds(/* @__PURE__ */ new Set());
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, derived]);
  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) => apiFetch(`/tasks/bulk${board ? `?board=${encodeURIComponent(board)}` : ""}`, {
      method: "POST",
      body: { ids, action }
    }),
    onSuccess: () => {
      setSelectedIds(/* @__PURE__ */ new Set());
      setBulkAssignee("");
      void queryClient2.invalidateQueries({ queryKey: ["kanban-gantt"] });
    }
  });
  const handleZoomChange = (val) => {
    setZoom(val);
    if (getStorage()) getStorage().set("zoom", val);
  };
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (getStorage()) getStorage().set("board", slug);
    setSearch("");
    void queryClient2.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
  };
  useEffect2(() => {
    if (!board && boardsData?.boards?.length) {
      const fallback = boardsData.current || boardsData.boards[0].slug;
      if (fallback) setBoard(fallback);
    }
  }, [boardsData, board]);
  useEffect2(() => {
    const el = containerRef.current;
    if (!el) return;
    const observe = () => setTrackW(el.getBoundingClientRect().width);
    observe();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(observe);
      ro.observe(el);
    } else {
      window.addEventListener("resize", observe);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", observe);
    };
  }, []);
  const boards = boardsData?.boards || [];
  const isAllBoards = board === "all" || board === "*";
  const currentBoardObj = isAllBoards ? { slug: "all", label: i18n.allBoards } : boards.find((b) => b.slug === (board || boardsData?.current));
  const boardLabel = (slug) => {
    if (slug === "all" || slug === "*") return i18n.allBoards;
    return boards.find((b) => b.slug === slug)?.label || slug || "—";
  };
  const hasAutoScrolledBoardRef = useRef2(null);
  useEffect2(() => {
    const el = scrollerRef.current;
    if (el && board && hasAutoScrolledBoardRef.current !== board) {
      hasAutoScrolledBoardRef.current = board;
      el.scrollLeft = el.scrollWidth;
    }
  }, [board, derived, trackW]);
  if (isLoading && !data) {
    return jsx3("div", { className: "flex h-full items-center justify-center p-8", children: jsx3(Loader, {}) });
  }
  if (isError) {
    return jsx3("div", { className: "p-6", children: jsx3(ErrorState, {
      title: i18n.cannotLoadBoard,
      description: i18n.cannotLoadBoardDesc(base)
    }) });
  }
  if (!derived || !derived.domain) {
    return jsx3("div", { className: "p-6", children: jsx3(EmptyState, { title: i18n.emptyBoard, description: i18n.emptyBoardDesc(boardLabel(board)) }) });
  }
  const now = Date.now() / 1e3;
  const { rows, domain } = derived;
  const visibleWidth = Math.max(trackW - labelW - 24, 300);
  const baseDayWidth = visibleWidth / 7;
  const basePerSec = baseDayWidth / DAY;
  const pxPerSec = basePerSec * zoom;
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec));
  const grid = rows.map((row, idx) => jsx3(TaskRow, {
    ...row,
    now,
    pxPerSec,
    min: domain.min,
    timelineW,
    onOpen: (id) => $openTaskId.set(id),
    isSelected: openTaskId === row.task.id,
    isChecked: selectedIds.has(row.task.id),
    onToggleCheck: handleToggleCheck,
    isEven: idx % 2 === 0,
    showBoardBadge: isAllBoards
  }, row.task.id));
  const STATUS_PRIORITY = ["blocked", "running", "review", "ready", "scheduled", "todo", "triage", "done", "archived"];
  const blockedCount = derived.tasks.filter((t) => t.status === "blocked").length;
  const dominantStatus = (() => {
    const present = new Set(derived.tasks.map((t) => t.status));
    for (const s of STATUS_PRIORITY) {
      if (present.has(s)) return s;
    }
    return "todo";
  })();
  const dominantTone = statusTone(dominantStatus);
  const dockDrawer = Boolean(openTaskId && drawerDocked);
  return jsxs3("div", {
    ref: containerRef,
    // No root padding: the desktop shell already insets plugin pages, and the
    // demo adds its own body padding (tests/demo.html).
    className: cn2("relative h-full flex", dockDrawer ? "flex-row gap-3" : "flex-col"),
    children: [
      // Page-header chrome: exists exactly while this page is mounted — the
      // board switcher is projected into the workspace page-header band (the
      // tab row above the page), like the official kanban plugin's switcher
      // (WORKSPACE_PAGE_HEADER_AREA, NOT titleBar.center).
      jsx3(Contribute, { area: WORKSPACE_PAGE_HEADER_AREA, id: "kanban-gantt:board-switcher", children: jsx3(TitlebarBoardSwitcher, {}) }),
      // Main column (header + chart + legend). When the drawer is docked it
      // becomes a flex sibling of this column, so the gantt shrinks to make
      // room instead of being covered. Carries the view padding (the desktop
      // shell already insets contributed pages; the demo adds its own).
      jsxs3("div", {
        className: "flex flex-col flex-1 min-h-0 min-w-0 pl-3 py-2",
        children: [
          // Top header row: Left title + task count badge + blocked badge + filter + search, Center board switcher, Right refresh
          jsxs3("div", {
            className: "flex flex-wrap items-center justify-between gap-2 mb-2",
            children: [
              // Left: Title + Task Count Badge + Blocked Badge + Filter + Search Field
              jsxs3("div", {
                className: "inline-flex items-center gap-2 text-sm font-medium",
                children: [
                  jsx3("span", { className: "font-semibold", children: i18n.title }),
                  jsx3("span", {
                    className: "inline-flex items-center justify-center rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs cursor-help",
                    title: i18n.nTasksTotal(derived.total, dominantStatus),
                    style: {
                      backgroundColor: `color-mix(in srgb, ${dominantTone} 18%, transparent)`,
                      borderColor: `color-mix(in srgb, ${dominantTone} 40%, transparent)`,
                      borderWidth: "1px",
                      color: dominantTone
                    },
                    children: `${derived.total}`
                  }),
                  blockedCount > 0 ? jsxs3("span", {
                    className: "inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs text-[#f87171] border border-[#f87171]/40 bg-[#f87171]/18 cursor-help",
                    title: i18n.nBlockedWarning(blockedCount),
                    children: [
                      jsx3(Codicon3, { name: "warning", size: "0.8rem" }),
                      jsx3("span", { children: `${blockedCount}` })
                    ]
                  }) : null,
                  jsx3(FilterDropdown, {
                    assignees: derived.allAssignees || [],
                    selectedAssignees,
                    onToggleAssignee: handleToggleAssignee,
                    onClearAssignees: handleClearAssignees,
                    disabledStatuses,
                    onToggleStatus: handleToggleStatus,
                    showArchived,
                    onToggleArchived: setShowArchived
                  }),
                  jsxs3("div", {
                    className: "inline-flex items-center gap-1.5 border-b border-transparent focus-within:border-(--ui-stroke-secondary) px-1 py-0.5 ml-1",
                    children: [
                      jsx3(Codicon3, { name: "search", size: "0.85rem", className: "text-(--ui-text-quaternary)" }),
                      jsx3("input", {
                        type: "search",
                        value: search,
                        placeholder: i18n.filterCards,
                        className: "bg-transparent border-0 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none w-48",
                        onInput: (event) => setSearch(event.target.value)
                      })
                    ]
                  })
                ]
              }),
              // Board switcher moved to the desktop titlebar band (titleBar.center)
              // — see TitlebarBoardSwitcher above.
              // Right: Refresh button + Zoom control
              jsxs3("div", {
                className: "inline-flex items-center gap-3",
                children: [
                  jsxs3("span", { className: "inline-flex items-center gap-1.5", children: [
                    jsx3("input", {
                      type: "range",
                      min: String(ZOOM_MIN),
                      max: String(ZOOM_MAX),
                      step: String(ZOOM_STEP),
                      value: String(zoom),
                      onInput: (event) => handleZoomChange(Number(event.target.value)),
                      className: "w-24",
                      "aria-label": i18n.zoomTimeline
                    }),
                    jsx3("span", { className: "text-[10px] tabular-nums text-(--ui-text-tertiary) w-8 text-right shrink-0", children: `${Math.round(zoom * 100)}%` })
                  ] }),
                  jsx3(Button3, { size: "xs", onClick: () => void queryClient2.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] }), children: i18n.refresh }),
                  // Far right: the board's only creation verb.
                  jsx3(Button3, {
                    size: "xs",
                    variant: "default",
                    onClick: () => $newTask.set({ parentId: "" }),
                    children: jsxs3("span", { className: "flex items-center gap-1", children: [
                      jsx3(Codicon3, { name: "add", size: "0.85rem" }),
                      i18n.newTask
                    ] })
                  })
                ]
              })
            ]
          }),
          rows.length === 0 ? jsx3("div", {
            className: "py-10",
            children: jsx3(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch })
          }) : jsxs3("div", {
            className: "mt-2 border border-(--ui-stroke-tertiary) rounded-md overflow-hidden flex-1 min-h-0 flex flex-col relative",
            children: [
              jsx3(SelectionBar, {
                selected: selectedIds,
                onClear: () => setSelectedIds(/* @__PURE__ */ new Set()),
                onStatus: (status) => bulkMutation.mutate({ action: status, ids: [...selectedIds] }),
                onAssign: (profile) => bulkMutation.mutate({ action: "assign", ids: [...selectedIds], assignee: profile }),
                onArchive: () => bulkMutation.mutate({ action: "archive", ids: [...selectedIds] }),
                onDelete: () => {
                  if (confirm(i18n.confirmDelete(`${selectedIds.size} tasks`))) {
                    bulkMutation.mutate({ action: "delete", ids: [...selectedIds] });
                  }
                },
                assignees: derived.allAssignees || [],
                busy: bulkMutation.isPending
              }),
              jsxs3("div", {
                ref: scrollerRef,
                className: "overflow-auto flex-1 min-h-0 relative",
                children: [
                  jsxs3("div", {
                    className: "grid w-max sticky top-0 z-20 bg-(--ui-bg-chrome)",
                    "data-glass-opaque": true,
                    style: { gridTemplateColumns: `${labelW}px ${timelineW}px` },
                    children: [
                      jsxs3("div", {
                        className: "sticky left-0 z-30 bg-(--ui-bg-chrome) border-r border-b border-(--ui-stroke-tertiary) flex items-center px-2 gap-1.5",
                        "data-glass-opaque": true,
                        style: { height: pxPerSec * DAY >= 50 && tickUnit(domain.max - domain.min) === "day" ? "32px" : "24px" },
                        children: [
                          jsx3("input", {
                            type: "checkbox",
                            checked: Boolean(derived.rows.length > 0 && selectedIds.size === derived.rows.length),
                            ref: (el) => {
                              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < derived.rows.length;
                            },
                            onChange: (e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(derived.rows.map((r) => r.task.id)));
                              } else {
                                setSelectedIds(/* @__PURE__ */ new Set());
                              }
                            },
                            className: "rounded cursor-pointer",
                            "aria-label": i18n.selectAll
                          }),
                          jsx3("span", { className: "text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none", children: i18n.tasksColumn }),
                          jsx3(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: (w) => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: "labelW"
                          })
                        ]
                      }),
                      jsx3(Ruler, { min: domain.min, max: domain.max, pxPerSec })
                    ]
                  }),
                  jsxs3("div", {
                    className: "relative flex flex-col w-max",
                    children: [
                      jsx3("div", {
                        className: "absolute top-0 bottom-0 pointer-events-none z-0",
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: jsx3(WeekendBands, { min: domain.min, max: domain.max, pxPerSec })
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),
          jsx3("div", {
            children: jsx3(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus })
          })
        ]
      }),
      openTaskId ? jsx3(TaskDrawer, {
        taskId: openTaskId,
        board,
        assignees: derived.allAssignees || [],
        onClose: () => $openTaskId.set(null),
        docked: dockDrawer,
        onToggleDock: () => {
          const next = !drawerDocked;
          $drawerDocked.set(next);
          if (getStorage()) getStorage().set("drawerDocked", next ? "1" : "0");
        }
      }) : null,
      // Creation dialog (toolbar button, or "create a sub-task" from a task).
      jsx3(NewTaskDialog, {
        open: Boolean(newTask),
        boardSlug: board && board !== "all" && board !== "*" ? board : void 0,
        assignees: derived && derived.allAssignees || [],
        tasks: data && data.tasks || [],
        projects: projectsData && projectsData.projects || [],
        defaultParentId: newTask ? newTask.parentId : "",
        busy: createTaskMutation.isPending,
        onSubmit: (values) => createTaskMutation.mutate(values),
        onClose: () => $newTask.set(null),
        i18n
      })
    ]
  });
}
var plugin = {
  id: ID2,
  name: "Kanban Gantt",
  // Read by the host from the module itself (contrib/plugins.ts), before
  // `register` runs and before any locale bundle exists — so this descriptor
  // cannot follow the app locale: it stays in the bundles' fallback language.
  description: "Gantt view (progress over time) of the kanban board — search, zoom, task detail + actions.",
  register(ctx) {
    setPluginDoors(ctx.rest, ctx.storage);
    $baseUrl.set((ctx.storage.get("baseUrl", "") || "").replace(/\/+$/, ""));
    $boardSlug.set(ctx.storage.get("board", "") || "");
    $labelW.set(Number(ctx.storage.get("labelW", LABEL_W)) || LABEL_W);
    $drawerW.set(Number(ctx.storage.get("drawerW", 416)) || 416);
    $drawerDocked.set(ctx.storage.get("drawerDocked", "0") === "1");
    if (ctx.i18n && typeof ctx.i18n.register === "function") {
      ctx.i18n.register(GANTT_LOCALES);
    }
    const tNow = (key) => ctx.i18n && typeof ctx.i18n.t === "function" ? ctx.i18n.t(key) : GANTT_LOCALES.en[key];
    if (!document.getElementById("kg-arc-style")) {
      const style = document.createElement("style");
      style.id = "kg-arc-style";
      style.textContent = `
@property --kg-arc-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.kg-arc {
  pointer-events: none; position: absolute; inset: -2px; border-radius: 4px;
  padding: 1.5px;
  background: conic-gradient(from var(--kg-arc-angle), transparent 0deg,
    var(--kanban-tone, var(--ui-stroke-primary)) 55deg, transparent 110deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: kg-arc-spin 2.2s linear infinite;
}
@keyframes kg-arc-spin { to { --kg-arc-angle: 360deg; } }
/* Readability: ticket bodies, results, summaries and comments render agent
   markdown through Streamdown into Tailwind typography containers (prose),
   whose palette defaults to light-background ink (#374151) and is illegible
   on the app's dark surfaces. Typography reads every colour from a
   --tw-prose-* custom property, so map those onto the app's own theme tokens
   (which flip with :root.dark) instead of pinning literals: one block that is
   readable in BOTH themes, scoped to .kg-prose so drawer chrome, cards and
   controls are untouched. */
.kg-prose {
  --tw-prose-body: var(--ui-text-primary);
  --tw-prose-headings: var(--ui-text-primary);
  --tw-prose-lead: var(--ui-text-secondary);
  --tw-prose-links: var(--ui-accent);
  --tw-prose-bold: var(--ui-text-primary);
  --tw-prose-counters: var(--ui-text-secondary);
  --tw-prose-bullets: var(--ui-text-tertiary);
  --tw-prose-hr: var(--ui-stroke-tertiary);
  --tw-prose-quotes: var(--ui-text-primary);
  --tw-prose-quote-borders: var(--ui-stroke-tertiary);
  --tw-prose-captions: var(--ui-text-tertiary);
  --tw-prose-code: var(--ui-text-primary);
  --tw-prose-pre-code: var(--ui-text-primary);
  --tw-prose-pre-bg: var(--ui-bg-tertiary);
  --tw-prose-th-borders: var(--ui-stroke-secondary);
  --tw-prose-td-borders: var(--ui-stroke-tertiary);
  color: var(--tw-prose-body);
}
/* Typography paints code/pre from its own dark palette; keep them on the app's
   surfaces. Link decoration and list indent are the two typography choices
   worth keeping explicit at this size. */
.kg-prose :where(code) { background: var(--ui-bg-tertiary); padding: .08em .32em; border-radius: 3px; }
.kg-prose :where(pre) { background: var(--ui-bg-tertiary); padding: .5em .6em; border-radius: 4px; }
.kg-prose :where(pre code) { background: transparent; padding: 0; }
.kg-prose a { text-decoration: underline; }
.kg-prose :where(ul, ol) { padding-left: 1.1em; }
`;
      document.head.appendChild(style);
    }
    ctx.registerMany([
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/kanban-gantt" },
        render: () => jsx3(KanbanGanttPage, {})
      },
      {
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        order: 70,
        data: { codicon: "calendar", label: "Kanban Gantt", path: "/kanban-gantt" }
      },
      {
        id: "open",
        area: PALETTE_AREA,
        data: {
          id: "kanbanGantt.open",
          label: tNow("openCommand"),
          keywords: ["kanban", "gantt", "timeline"],
          run: () => host.navigate("/kanban-gantt")
        }
      }
    ]);
  }
};
var main_default = plugin;
export {
  KanbanGanttPage,
  main_default as default
};
