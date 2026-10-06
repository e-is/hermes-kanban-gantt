/*
 * Hermes Kanban Gantt — desktop renderer (BUILD ARTIFACT).
 * Source of truth: src/ — run `npm run build` after editing.
 * Loaded uncompiled by Hermes Desktop; only @hermes/plugin-sdk, react
 * and react/jsx-runtime are importable specifiers.
 */

// src/main.ts
import {
  Badge,
  Button as Button5,
  cn as cn3,
  Codicon as Codicon5,
  ConfirmDialog,
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
  Textarea,
  useMutation,
  useQuery as useQuery2,
  useQueryClient as useQueryClient2,
  useValue as useValue2,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  WORKSPACE_PAGE_HEADER_AREA
} from "@hermes/plugin-sdk";
import { useMemo as useMemo2, useRef as useRef2, useEffect as useEffect3, useState as useState4 } from "react";
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";

// src/state.ts
import { atom } from "@hermes/plugin-sdk";
var LABEL_W = 300;
var rest = null;
var storage = null;
var socket = null;
var $baseUrl = atom("");
var $boardSlug = atom("");
var $connectionScope = atom("");
var $labelW = atom(LABEL_W);
var $drawerW = atom(416);
var $drawerDocked = atom(false);
var LABEL_W_MIN = 160;
var LABEL_W_MAX = 640;
var DRAWER_W_MIN = 320;
var DRAWER_W_MAX = 720;
var $openTaskId = atom(null);
var $newTask = atom(null);
var $wsEnabled = atom(false);
var $moveUnderId = atom(null);
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
  const opts = { method: init?.method || "GET" };
  if (init?.body != null) opts.body = init.body;
  return rest(path, opts);
};
var fetchTask = (id, board) => apiFetch(`/tasks/${encodeURIComponent(id)}${board ? `?board=${encodeURIComponent(board)}` : ""}`);
var createTask = (values, board) => apiFetch(
  `/tasks${board ? `?board=${encodeURIComponent(board)}` : ""}`,
  { method: "POST", body: values }
);
var fetchProjects = () => apiFetch("/projects");
var fetchProfiles = () => apiFetch("/profiles");
var setParent = (id, parentId, mode, board) => apiFetch(
  `/tasks/${encodeURIComponent(id)}/parent${board ? `?board=${encodeURIComponent(board)}` : ""}`,
  { method: "POST", body: { parentId, mode: mode || "add" } }
);
var removeParent = (id, parentId, board) => apiFetch(
  `/tasks/${encodeURIComponent(id)}/parent/${encodeURIComponent(parentId)}${board ? `?board=${encodeURIComponent(board)}` : ""}`,
  { method: "DELETE" }
);
function setPluginDoors(restFn, storageObj, socketFn) {
  rest = restFn;
  storage = storageObj;
  socket = typeof socketFn === "function" ? socketFn : null;
}
var getStorage = () => storage;
var getSocket = () => socket;

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
    refreshWhy: "Live updates are off for this gateway or client, so the page follows a 60 s poll — refresh now instead of waiting.",
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
    boardGoneTitle: (slug) => `Board ${slug} is not on this gateway`,
    boardGoneDesc: (next) => next ? `Showing ${next} instead — that board was remembered from another gateway.` : `Showing this gateway's current board instead.`,
    boardMissingTitle: "That board is not on this gateway",
    boardMissingDesc: (slug, next) => next ? `Board ${slug} does not exist here. This gateway's current board is ${next}.` : `Board ${slug} does not exist on this gateway.`,
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
    editDescription: "Edit description",
    cancelEdit: "Cancel edit",
    save: "Save",
    noDescription: "No description",
    unsavedDescTitle: "Description not saved",
    unsavedDescBody: "You changed this description but have not saved it. Save it before opening another task?",
    saveAndOpen: "Save and open",
    keepEditing: "Keep editing",
    discardChanges: "Discard changes",
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
    parents: "Parents",
    children: "Children",
    noParents: "No parent",
    noChildren: "No child",
    removeParentLink: (title) => `Remove the link to ${title}`,
    openTask: (title) => `Open ${title}`,
    reparentTitle: (n) => `This task already has ${n} parent${n > 1 ? "s" : ""}. What do you want to do?`,
    reparentCurrent: "Current parents",
    reparentTarget: (title) => `New parent: ${title}`,
    moveUnderTitle: (title) => `Move ${title} under…`,
    reasonLinked: "Already a parent",
    reparentAdd: "Add a new parent",
    reparentReplace: "Replace with this single parent",
    removeParentConfirmTitle: (title) => `Remove the link to ${title}?`,
    removeParentConfirmDesc: "Only this parent link is dropped — the task keeps its other relationships.",
    cancel: "Cancel",
    moveUnder: "Move under…",
    moveUnderSearch: "Search a task…",
    moveUnderEmpty: "No task matches",
    movedUnder: (child, parent) => `${child} moved under ${parent}`,
    gatedNotice: (child) => `${child} went back to todo: its new parent is not finished yet.`,
    errSelf: "A task cannot be moved under itself.",
    errCycle: "That move would create a cycle.",
    errRunning: "A running task cannot be moved under another task.",
    errOtherBoard: "Both tasks must belong to the same board.",
    errReparent: "The move was refused by the kanban board.",
    expandTask: (name) => `Expand ${name}`,
    collapseTask: (name) => `Collapse ${name}`,
    expandTaskHidden: (name, n) => `Expand ${name} (${n} hidden)`,
    collapseAll: "Collapse every task",
    expandAll: "Expand every task",
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
    newTaskProjectSearch: "Search a project…",
    newTaskParentSearch: "Search a task…",
    newTaskNoMatch: "No match",
    create: "Create",
    creating: "Creating…",
    createSubtask: "Create a sub-task",
    moveToBoard: "Move to another board",
    movePickBoard: "Pick the target board…",
    moveNoOtherBoards: "No other board available — create one first.",
    moving: "Moving…",
    moveConfirm: "Move",
    moveWithChildren: (n) => `This task has ${n} child${n > 1 ? "ren" : ""} — they will move with it.`,
    moveNoChildren: "No children — the task moves alone.",
    confirmMove: (title, board) => `Move "${title}" to board "${board}"?`,
    confirmMoveChildren: (n) => `Move the ${n} child task${n > 1 ? "s" : ""} too? They must travel with their parent.`,
    moveChildrenBlock: "Impossible to move a task without its children — reassign the children to another parent (or delete them) first, then move again.",
    confirmMoveParentLoss: (n) => `This task has ${n} parent${n > 1 ? "s" : ""} on the current board. After the move it will have NO parent. Are you sure?`,
    movedTo: (board) => `Moved to board "${board}" ✔`,
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
    refreshWhy: "Les mises à jour en direct sont désactivées pour cette gateway ou ce client : la page suit un sondage de 60 s — actualisez maintenant plutôt que d'attendre.",
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
    boardGoneTitle: (slug) => `Le board ${slug} n'est pas sur cette gateway`,
    boardGoneDesc: (next) => next ? `Affichage de ${next} à la place — ce board avait été mémorisé sur une autre gateway.` : `Affichage du board courant de cette gateway.`,
    boardMissingTitle: `Ce board n'est pas sur cette gateway`,
    boardMissingDesc: (slug, next) => next ? `Le board ${slug} n'existe pas ici. Le board courant de cette gateway est ${next}.` : `Le board ${slug} n'existe pas sur cette gateway.`,
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
    editDescription: "Modifier la description",
    cancelEdit: "Annuler la modification",
    save: "Enregistrer",
    noDescription: "Aucune description",
    unsavedDescTitle: "Description non enregistrée",
    unsavedDescBody: "Vous avez modifié cette description sans l'enregistrer. L'enregistrer avant d'ouvrir une autre tâche ?",
    saveAndOpen: "Enregistrer et ouvrir",
    keepEditing: "Continuer l'édition",
    discardChanges: "Abandonner les modifications",
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
    parents: "Parents",
    children: "Enfants",
    noParents: "Aucun parent",
    noChildren: "Aucun enfant",
    removeParentLink: (title) => `Retirer le lien avec ${title}`,
    openTask: (title) => `Ouvrir ${title}`,
    reparentTitle: (n) => `Cette tâche a déjà ${n} parent${n > 1 ? "s" : ""}. Que voulez-vous faire ?`,
    reparentCurrent: "Parents actuels",
    reparentTarget: (title) => `Nouveau parent : ${title}`,
    moveUnderTitle: (title) => `Déplacer ${title} sous…`,
    reasonLinked: "Déjà parent",
    reparentAdd: "Ajouter un nouveau parent",
    reparentReplace: "Remplacer par ce parent unique",
    removeParentConfirmTitle: (title) => `Retirer le lien avec ${title} ?`,
    removeParentConfirmDesc: "Seul ce lien de parenté est retiré — la tâche conserve ses autres relations.",
    cancel: "Annuler",
    moveUnder: "Déplacer sous…",
    moveUnderSearch: "Rechercher une tâche…",
    moveUnderEmpty: "Aucune tâche ne correspond",
    movedUnder: (child, parent) => `${child} déplacée sous ${parent}`,
    gatedNotice: (child) => `${child} repasse en todo : son nouveau parent n’est pas terminé.`,
    errSelf: "Une tâche ne peut pas être déplacée sous elle-même.",
    errCycle: "Ce déplacement créerait un cycle.",
    errRunning: "Une tâche en cours d’exécution ne peut pas être déplacée sous une autre.",
    errOtherBoard: "Les deux tâches doivent appartenir au même board.",
    errReparent: "Le déplacement a été refusé par le board kanban.",
    expandTask: (name) => `Déplier ${name}`,
    collapseTask: (name) => `Replier ${name}`,
    expandTaskHidden: (name, n) => `Déplier ${name} (${n} masquée${n > 1 ? "s" : ""})`,
    collapseAll: "Tout replier",
    expandAll: "Tout déplier",
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
    newTaskProjectSearch: "Rechercher un projet…",
    newTaskParentSearch: "Rechercher une tâche…",
    newTaskNoMatch: "Aucun résultat",
    create: "Créer",
    creating: "Création…",
    createSubtask: "Créer une sous-tâche",
    moveToBoard: "Déplacer vers un autre board",
    movePickBoard: "Choisir le board cible…",
    moveNoOtherBoards: "Aucun autre board disponible — créez-en un d’abord.",
    moving: "Déplacement…",
    moveConfirm: "Déplacer",
    moveWithChildren: (n) => `Cette tâche a ${n} enfant${n > 1 ? "s" : ""} — il${n > 1 ? "s" : ""} sera${n > 1 ? "ont" : ""} déplacé${n > 1 ? "s" : ""} avec elle.`,
    moveNoChildren: "Aucun enfant — la tâche part seule.",
    confirmMove: (title, board) => `Êtes-vous sûr de vouloir déplacer « ${title} » vers le board « ${board} » ?`,
    confirmMoveChildren: (n) => `Déplacer aussi les ${n} tâche${n > 1 ? "s" : ""} enfant${n > 1 ? "s" : ""} ? Elle${n > 1 ? "s" : ""} doi${n > 1 ? "vent" : "t"} voyager avec leur parent.`,
    moveChildrenBlock: "Impossible de déplacer une tâche sans ses enfants — réaffectez d’abord les enfants à un autre parent (ou supprimez-les), puis redéplacez la tâche.",
    confirmMoveParentLoss: (n) => `Cette tâche a ${n} parent${n > 1 ? "s" : ""} sur le board courant. Après le déplacement elle n’aura PLUS de parent. Êtes-vous sûr ?`,
    movedTo: (board) => `Déplacé vers le board « ${board} » ✔`,
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

// src/core/ws-core.ts
var WS_FIRST_FRAME_MS = 5e3;
var WS_HEARTBEAT_MS = 2e4;
var WS_IDLE_MS = Math.round(WS_HEARTBEAT_MS * 2.5);
var WS_BACKOFF_BASE_MS = 500;
var WS_BACKOFF_MAX_MS = 1e4;
var WS_MAX_ATTEMPTS = 1;
var WS_REARM_MS = 5 * 6e4;
var WS_STATE = {
  off: "off",
  // not attempted (flag off, oauth/2nd backend, no board)
  connecting: "connecting",
  live: "live",
  // at least one snapshot applied
  dead: "dead"
  // gave up → polling only
};
function nextBackoff(attempt, rand = Math.random) {
  const capped = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(capped / 2 + capped / 2 * rand());
}
function classifyFrame(frame, lastVersion) {
  if (!frame || typeof frame !== "object") return { kind: "ignore" };
  if (frame.type === "heartbeat") {
    return { kind: "heartbeat", version: Number(frame.version) || 0 };
  }
  if (frame.type !== "snapshot") return { kind: "ignore" };
  const version = Number(frame.version);
  if (!Number.isFinite(version) || !Array.isArray(frame.tasks)) return { kind: "ignore" };
  if (lastVersion != null && version === lastVersion) return { kind: "stale", version };
  if (lastVersion != null && version < lastVersion) {
    return { kind: "snapshot", version, gap: false, restart: true };
  }
  const gap = lastVersion != null && version > lastVersion + 1;
  return { kind: "snapshot", version, gap, restart: false };
}
function frameToQueryData(frame) {
  return {
    board: frame.board,
    generated_at: frame.generated_at,
    tasks: frame.tasks || [],
    labels: frame.labels || []
  };
}
function canPush(board) {
  return !!board && board !== "all" && board !== "*";
}
function eventsPath(board) {
  return `/events?board=${encodeURIComponent(board || "")}`;
}

// src/ws.ts
var LOG = "[kanban-gantt ws]";
function subscribeGantt(socketDoor, opts) {
  const { board, onSnapshot, onResync, onState } = opts || {};
  const now = opts && opts.now || (() => Date.now());
  if (typeof socketDoor !== "function" || !board) {
    onState && onState(WS_STATE.off);
    return () => {
    };
  }
  let disposed = false;
  let attempts = 0;
  let lastVersion = null;
  let disposeSocket = null;
  let firstTimer = null;
  let idleTimer = null;
  let retryTimer = null;
  let rearmTimer = null;
  let live = false;
  const clearTimers = () => {
    if (firstTimer) {
      clearTimeout(firstTimer);
      firstTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (rearmTimer) {
      clearTimeout(rearmTimer);
      rearmTimer = null;
    }
  };
  const drop = (why) => {
    clearTimers();
    if (disposeSocket) {
      try {
        disposeSocket();
      } catch (err) {
        console.debug(LOG, "dispose failed", err);
      }
      disposeSocket = null;
    }
    return why;
  };
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => give("silence"), WS_IDLE_MS);
  };
  const give = (why) => {
    if (disposed) return;
    drop(why);
    live = false;
    console.debug(LOG, "socket unusable (" + why + ")");
    if (attempts < WS_MAX_ATTEMPTS) {
      const delay = nextBackoff(attempts);
      attempts += 1;
      onState && onState(WS_STATE.connecting);
      console.debug(LOG, "reconnect in " + delay + "ms");
      retryTimer = setTimeout(start, delay);
    } else {
      onState && onState(WS_STATE.dead);
      console.debug(LOG, "re-arming in " + WS_REARM_MS + "ms");
      rearmTimer = setTimeout(() => {
        rearmTimer = null;
        if (disposed) return;
        attempts = 0;
        start();
      }, WS_REARM_MS);
    }
  };
  function start() {
    if (disposed) return;
    retryTimer = null;
    onState && onState(live ? WS_STATE.live : WS_STATE.connecting);
    disposeSocket = socketDoor(eventsPath(board), (frame) => {
      if (disposed) return;
      if (firstTimer) {
        clearTimeout(firstTimer);
        firstTimer = null;
      }
      const verdict = classifyFrame(frame, lastVersion);
      if (verdict.kind === "ignore" || verdict.kind === "stale") return;
      armIdle();
      if (verdict.kind === "heartbeat") return;
      if (verdict.restart) {
        console.debug(LOG, "version went back " + lastVersion + " → " + verdict.version + ": new server stream");
      }
      lastVersion = verdict.version;
      attempts = 0;
      live = true;
      onState && onState(WS_STATE.live);
      if (verdict.gap) {
        console.debug(LOG, "version gap at " + verdict.version + " → REST resync");
        onResync && onResync(verdict.version);
      }
      onSnapshot && onSnapshot(frameToQueryData(frame), verdict.version);
    });
    firstTimer = setTimeout(() => give("no-first-frame"), WS_FIRST_FRAME_MS);
    console.debug(LOG, "subscribed", eventsPath(board), "at", now());
  }
  start();
  return function dispose() {
    disposed = true;
    drop("dispose");
    onState && onState(WS_STATE.off);
  };
}

// src/ui/TitlebarBoardSwitcher.tsx
import { Button, cn, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useQuery, useQueryClient, useValue } from "@hermes/plugin-sdk";
import { jsx, jsxs } from "react/jsx-runtime";
function TitlebarBoardSwitcher() {
  const board = useValue($boardSlug);
  const i18n = useGanttI18n();
  const queryClient = useQueryClient();
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
    void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
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
  Popover,
  PopoverContent,
  PopoverTrigger,
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
var STATUS_ICON = {
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
function statusIcon(status) {
  return STATUS_ICON[status] || "circle-large-outline";
}
function descendantsOf(tasks, rootId) {
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, t.children || []);
  const out = /* @__PURE__ */ new Set();
  const stack = [...adj.get(rootId) || []];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...adj.get(id) || []);
  }
  return out;
}
function relationsOf(tasks, taskId) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  if (!task) return { parents: [], children: [] };
  const pick = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
  return { parents: pick(task.parents), children: pick(task.children) };
}
function dropCandidates(tasks, draggedId, boardSlug) {
  const dragged = tasks.find((t) => t.id === draggedId);
  const below = descendantsOf(tasks, draggedId);
  const alreadyLinked = new Set(dragged && dragged.parents || []);
  return tasks.map((task) => {
    let reason = null;
    if (task.id === draggedId) reason = "self";
    else if (below.has(task.id)) reason = "descendant";
    else if (boardSlug && task.board && task.board !== boardSlug) reason = "other-board";
    else if (alreadyLinked.has(task.id)) reason = "linked";
    return { task, allowed: reason === null, reason };
  });
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
function resolveBoardSlug(stored, known, current) {
  const remembered = typeof stored === "string" ? stored.trim() : "";
  const slugs = (known || []).map((b) => typeof b === "string" ? b : b && b.slug).filter(Boolean);
  const currentSlug = (current || "").trim();
  const wanted = (currentSlug && slugs.includes(currentSlug) ? currentSlug : slugs[0]) || "";
  if (!slugs.length) return { slug: remembered, fallback: false, suggested: "" };
  if (!remembered) return { slug: "", fallback: false, suggested: wanted };
  if (remembered === "all" || remembered === "*") return { slug: remembered, fallback: false, suggested: "" };
  if (slugs.includes(remembered)) return { slug: remembered, fallback: false, suggested: "" };
  return { slug: "", fallback: true, suggested: wanted };
}
function isMissingBoardError(error) {
  const message = typeof error === "string" ? error : error && (error.message || error.detail || error.error) || "";
  return /database not found|does not exist|no such board/i.test(String(message));
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
var TREE_SLOT = 16;
var TREE_SQUARE = 13;
var TREE_AXIS = TREE_SQUARE / 2;
var TREE_INSET = 6;
function treeMarks(depth, continuation = [], lastSibling = false) {
  const guides = [];
  for (let level = 0; level < continuation.length; level++) {
    if (continuation[level]) guides.push(TREE_INSET + level * TREE_SLOT + TREE_AXIS);
  }
  const child = depth > 0;
  const elbowX = child ? TREE_INSET + (depth - 1) * TREE_SLOT + TREE_AXIS : null;
  return {
    indent: TREE_INSET + depth * TREE_SLOT,
    squareX: TREE_INSET + depth * TREE_SLOT,
    guides,
    elbowX,
    elbowW: child ? TREE_SLOT - TREE_AXIS : 0,
    elbowHalf: child && Boolean(lastSibling)
  };
}
function treeRows(tasks, opts = {}) {
  const fold = opts.fold || /* @__PURE__ */ new Map();
  const search = opts.search || "";
  const selected = opts.selected || /* @__PURE__ */ new Set();
  const set = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) adj.set(t.id, (t.children || []).filter((c) => set.has(c)));
  const hasParent = /* @__PURE__ */ new Set();
  for (const t of tasks) for (const p of t.parents || []) if (set.has(p)) hasParent.add(t.id);
  const halo = /* @__PURE__ */ new Set();
  for (const id of selected) for (const d of descendantsOf(tasks, id)) halo.add(d);
  const rows = [];
  const shown = /* @__PURE__ */ new Set();
  const covered = /* @__PURE__ */ new Set();
  const markCovered = (root) => {
    const stack = [...adj.get(root) || []];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      covered.add(id);
      for (const c of adj.get(id) || []) stack.push(c);
    }
  };
  const walk = (id, depth, isChild, secondary, cont, hasFollowing) => {
    const task = byId.get(id);
    const kids = adj.get(id) || [];
    markCovered(id);
    const onlySecondary = kids.length > 0 && kids.every((c) => shown.has(c));
    const open = search ? true : fold.has(id) ? !fold.get(id) : !onlySecondary;
    const collapsed = kids.length > 0 && !open;
    rows.push({
      task,
      depth,
      isChild,
      secondary,
      continuation: cont,
      lastSibling: !hasFollowing,
      hasChildren: kids.length > 0,
      secondaryOnly: onlySecondary,
      collapsed,
      hiddenCount: 0,
      matched: Boolean(search) && matchesSearch(task, search),
      descendantOfSelected: halo.has(id)
    });
    if (secondary || !open) return;
    const ordered = [...kids.filter((c) => !shown.has(c)), ...kids.filter((c) => shown.has(c))];
    ordered.forEach((c, i) => {
      const isSecondary = shown.has(c);
      const isLast = i === ordered.length - 1;
      if (!isSecondary) shown.add(c);
      walk(c, depth + 1, true, isSecondary, [...cont, hasFollowing], !isLast);
    });
  };
  for (const t of tasks) {
    if (hasParent.has(t.id) || shown.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, false, false, [], false);
  }
  for (const t of tasks) {
    if (shown.has(t.id) || covered.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, hasParent.has(t.id), false, [], false);
  }
  const printed = new Set(rows.map((r) => r.task.id));
  for (const row of rows) {
    if (!row.collapsed) continue;
    let n = 0;
    const stack = [...adj.get(row.task.id) || []];
    const seen = /* @__PURE__ */ new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (!printed.has(id)) n += 1;
      for (const c of adj.get(id) || []) stack.push(c);
    }
    row.hiddenCount = n;
  }
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
function SearchPicker({
  value,
  options,
  selectedId,
  onPick,
  ariaLabel,
  searchPlaceholder,
  emptyLabel,
  className
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.hint || "").toLowerCase().includes(needle)) : options;
  return /* @__PURE__ */ jsxs2(Popover, { open, onOpenChange: (next) => {
    setOpen(next);
    if (!next) setQuery("");
  }, children: [
    /* @__PURE__ */ jsx2(PopoverTrigger, { asChild: true, children: /* @__PURE__ */ jsxs2(
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
    /* @__PURE__ */ jsxs2(PopoverContent, { align: "start", className: className || "w-[16rem] p-1.5", children: [
      /* @__PURE__ */ jsx2(
        Input,
        {
          autoFocus: true,
          value: query,
          placeholder: searchPlaceholder,
          "aria-label": searchPlaceholder,
          onChange: (event) => setQuery(event.target.value)
        }
      ),
      /* @__PURE__ */ jsx2("div", { className: "mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto", children: visible.length === 0 ? /* @__PURE__ */ jsx2("div", { className: "px-1 py-1.5 text-[11px] italic text-(--ui-text-quaternary)", children: emptyLabel }) : visible.map((option) => /* @__PURE__ */ jsxs2(
        "button",
        {
          type: "button",
          onClick: () => {
            onPick(option.id);
            setOpen(false);
            setQuery("");
          },
          className: "flex min-w-0 items-center gap-1.5 rounded border-0 bg-transparent px-1 py-0.5 text-left text-[11px] text-(--ui-text-secondary) cursor-pointer hover:bg-(--ui-row-hover-background)",
          children: [
            option.status ? /* @__PURE__ */ jsx2(StatusDot, { status: option.status }) : null,
            /* @__PURE__ */ jsxs2("span", { className: "flex min-w-0 flex-1 flex-col", children: [
              /* @__PURE__ */ jsx2("span", { className: "truncate", children: option.label }),
              option.hint ? /* @__PURE__ */ jsx2("span", { className: "truncate font-mono text-[9.5px] text-(--ui-text-quaternary)", children: option.hint }) : null
            ] }),
            selectedId === option.id && /* @__PURE__ */ jsx2(Codicon2, { className: "ml-auto shrink-0", name: "check", size: "0.8rem" })
          ]
        },
        option.id
      )) })
    ] })
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
  }, children: /* @__PURE__ */ jsxs2(DialogContent, { className: "w-[min(42rem,94vw)] max-w-none overflow-visible", children: [
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
        /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskProject, children: /* @__PURE__ */ jsx2(
          SearchPicker,
          {
            value: chosenProject ? chosenProject.name : i18n.newTaskNoProject,
            selectedId: projectId,
            onPick: setProjectId,
            ariaLabel: i18n.newTaskProject,
            searchPlaceholder: i18n.newTaskProjectSearch,
            emptyLabel: i18n.newTaskNoMatch,
            options: [
              { id: "", label: i18n.newTaskNoProject },
              ...projects.map((project) => ({
                id: project.id,
                label: project.name,
                hint: project.path || void 0
              }))
            ]
          }
        ) }),
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
      /* @__PURE__ */ jsx2(Field, { label: i18n.newTaskParent, children: /* @__PURE__ */ jsx2(
        SearchPicker,
        {
          value: chosenParent ? /* @__PURE__ */ jsxs2("span", { className: "flex min-w-0 items-center gap-1.5", children: [
            /* @__PURE__ */ jsx2(StatusDot, { status: chosenParent.status }),
            /* @__PURE__ */ jsx2("span", { className: "min-w-0 truncate", children: chosenParent.title })
          ] }) : i18n.newTaskNoParent,
          selectedId: parentId,
          onPick: setParentId,
          ariaLabel: i18n.newTaskParent,
          searchPlaceholder: i18n.newTaskParentSearch,
          emptyLabel: i18n.newTaskNoMatch,
          options: [
            { id: "", label: i18n.newTaskNoParent },
            ...parentOptions.map((task) => ({ id: task.id, label: task.title, status: task.status }))
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

// src/ui/MoveTaskDialog.tsx
import { useEffect as useEffect2, useState as useState2 } from "react";
import {
  Button as Button3,
  Codicon as Codicon3,
  Dialog as Dialog2,
  DialogContent as DialogContent2,
  DialogFooter as DialogFooter2,
  DialogHeader as DialogHeader2,
  DialogTitle as DialogTitle2,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@hermes/plugin-sdk";
import { Fragment, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function MoveTaskDialog({ open, task, boards, currentBoard, i18n, onClose, onMove }) {
  const [target, setTarget] = useState2("");
  const [error, setError] = useState2(null);
  const [busy, setBusy] = useState2(false);
  useEffect2(() => {
    if (open) {
      setTarget("");
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const otherBoards = boards.filter((b) => b.slug !== currentBoard);
  const targetLabel = otherBoards.find((b) => b.slug === target)?.label || target;
  const submit = async () => {
    if (!task || !target || busy) return;
    if (!window.confirm(i18n.confirmMove(task.title, targetLabel))) return;
    if (task.children.length > 0) {
      if (!window.confirm(i18n.confirmMoveChildren(task.children.length))) {
        setError(i18n.moveChildrenBlock);
        return;
      }
    }
    if (task.parents.length > 0) {
      if (!window.confirm(i18n.confirmMoveParentLoss(task.parents.length))) return;
    }
    setBusy(true);
    setError(null);
    try {
      await onMove(target);
      onClose();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsx3(Dialog2, { onOpenChange: (o) => !o && !busy && onClose(), open, children: /* @__PURE__ */ jsx3(DialogContent2, { className: "w-[min(30rem,94vw)] max-w-none", children: /* @__PURE__ */ jsxs3("div", { className: "flex flex-col gap-3", children: [
    /* @__PURE__ */ jsx3(DialogHeader2, { children: /* @__PURE__ */ jsx3(DialogTitle2, { children: i18n.moveToBoard }) }),
    task ? /* @__PURE__ */ jsxs3("div", { className: "flex flex-col gap-1 text-[0.75rem] text-(--ui-text-secondary)", children: [
      /* @__PURE__ */ jsx3("span", { className: "truncate font-medium", children: task.title }),
      /* @__PURE__ */ jsx3("span", { className: "text-[0.6875rem] text-(--ui-text-quaternary)", children: task.children.length > 0 ? i18n.moveWithChildren(task.children.length) : i18n.moveNoChildren })
    ] }) : null,
    /* @__PURE__ */ jsxs3(Select, { onValueChange: setTarget, value: target, children: [
      /* @__PURE__ */ jsx3(SelectTrigger, { "aria-label": i18n.moveToBoard, children: /* @__PURE__ */ jsx3(SelectValue, { placeholder: i18n.movePickBoard }) }),
      /* @__PURE__ */ jsx3(SelectContent, { children: otherBoards.map((b) => /* @__PURE__ */ jsx3(SelectItem, { value: b.slug, children: b.label }, b.slug)) })
    ] }),
    error ? /* @__PURE__ */ jsx3("span", { className: "text-[0.75rem] text-destructive", children: error }) : null,
    /* @__PURE__ */ jsxs3(DialogFooter2, { children: [
      /* @__PURE__ */ jsx3(Button3, { disabled: busy, onClick: onClose, size: "sm", variant: "ghost", children: i18n.cancel }),
      /* @__PURE__ */ jsx3(Button3, { disabled: !target || busy, onClick: () => void submit(), size: "sm", children: busy ? /* @__PURE__ */ jsxs3(Fragment, { children: [
        /* @__PURE__ */ jsx3(Codicon3, { name: "loading", size: "0.75rem", spinning: true }),
        i18n.moving
      ] }) : i18n.moveConfirm })
    ] })
  ] }) }) });
}

// src/ui/TaskRelations.tsx
import { Codicon as Codicon4, cn as cn2 } from "@hermes/plugin-sdk";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function TaskRelations({
  heading,
  tasks,
  emptyLabel,
  onOpen,
  onRemove,
  removeLabel,
  openLabel,
  disabled = false,
  disabledIds,
  reasonOf,
  className
}) {
  if (tasks.length === 0 && !emptyLabel) return null;
  return /* @__PURE__ */ jsxs4("div", { className: cn2("flex flex-col gap-0.5", className), children: [
    heading ? /* @__PURE__ */ jsx4("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: heading }) : null,
    tasks.length === 0 ? /* @__PURE__ */ jsx4("div", { className: "text-[10.5px] italic text-(--ui-text-quaternary)", children: emptyLabel }) : tasks.map((task) => {
      const inert = Boolean(disabledIds && disabledIds.has(task.id));
      const reason = inert && reasonOf ? reasonOf(task.id) : null;
      const clickable = Boolean(onOpen) && !disabled && !inert;
      return /* @__PURE__ */ jsxs4("div", { className: "group flex items-center gap-1 min-w-0", title: reason || void 0, children: [
        /* @__PURE__ */ jsxs4(
          "button",
          {
            type: "button",
            disabled: !clickable,
            onClick: () => onOpen?.(task.id),
            "aria-label": openLabel ? openLabel(task.title) : void 0,
            className: cn2(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors",
              "bg-transparent border-0 text-[11px] text-(--ui-text-secondary)",
              inert && "cursor-default opacity-45 line-through",
              clickable ? "cursor-pointer hover:bg-(--ui-row-hover-background)" : !inert && "cursor-default"
            ),
            children: [
              /* @__PURE__ */ jsx4(
                Codicon4,
                {
                  className: "shrink-0",
                  name: statusIcon(task.status),
                  size: "0.8rem",
                  style: { color: statusTone(task.status) }
                }
              ),
              /* @__PURE__ */ jsx4("span", { className: "min-w-0 flex-1 truncate", children: task.title })
            ]
          }
        ),
        onRemove && !inert && /* @__PURE__ */ jsx4(
          "button",
          {
            type: "button",
            disabled,
            onClick: () => onRemove(task.id),
            "aria-label": removeLabel ? removeLabel(task.title) : void 0,
            className: cn2(
              "shrink-0 inline-flex items-center justify-center rounded border-0 bg-transparent p-0.5",
              "text-(--ui-text-quaternary) opacity-0 transition-opacity",
              disabled ? "cursor-default" : "cursor-pointer hover:text-(--ui-text-primary) group-hover:opacity-100"
            ),
            children: /* @__PURE__ */ jsx4(Codicon4, { name: "close", size: "0.75rem" })
          }
        )
      ] }, task.id);
    })
  ] });
}

// src/ui/ReparentChooser.tsx
import { useState as useState3 } from "react";
import {
  Button as Button4,
  Dialog as Dialog3,
  DialogContent as DialogContent3,
  DialogDescription,
  DialogFooter as DialogFooter3,
  DialogHeader as DialogHeader3,
  DialogTitle as DialogTitle3,
  Input as Input2
} from "@hermes/plugin-sdk";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function ReparentChoiceDialog({
  open,
  targetTitle,
  parents,
  onAdd,
  onReplace,
  onRemoveParent,
  onClose,
  i18n,
  busy = false
}) {
  return /* @__PURE__ */ jsx5(Dialog3, { open, onOpenChange: (next) => {
    if (!next) onClose();
  }, children: /* @__PURE__ */ jsxs5(DialogContent3, { className: "max-w-md", children: [
    /* @__PURE__ */ jsxs5(DialogHeader3, { children: [
      /* @__PURE__ */ jsx5(DialogTitle3, { children: i18n.reparentTitle(parents.length) }),
      /* @__PURE__ */ jsx5(DialogDescription, { children: i18n.reparentTarget(targetTitle) })
    ] }),
    /* @__PURE__ */ jsx5(
      TaskRelations,
      {
        heading: i18n.reparentCurrent,
        tasks: parents,
        onRemove: onRemoveParent,
        removeLabel: i18n.removeParentLink,
        disabled: busy
      }
    ),
    /* @__PURE__ */ jsxs5(DialogFooter3, { className: "gap-2", children: [
      /* @__PURE__ */ jsx5(Button4, { variant: "ghost", onClick: onClose, disabled: busy, children: i18n.cancel }),
      /* @__PURE__ */ jsx5(Button4, { variant: "secondary", onClick: onReplace, disabled: busy, children: i18n.reparentReplace }),
      /* @__PURE__ */ jsx5(Button4, { onClick: onAdd, disabled: busy, children: i18n.reparentAdd })
    ] })
  ] }) });
}
function reasonLabel(reason, i18n) {
  switch (reason) {
    case "self":
      return i18n.errSelf;
    case "descendant":
      return i18n.errCycle;
    case "other-board":
      return i18n.errOtherBoard;
    case "linked":
      return i18n.reasonLinked;
    default:
      return i18n.errReparent;
  }
}
function MoveUnderDialog({
  open,
  draggedTitle,
  candidates,
  onPick,
  onClose,
  i18n,
  busy = false
}) {
  const [query, setQuery] = useState3("");
  if (!open) return null;
  const visible = candidates.filter((c) => matchesSearch(c.task, query));
  const disabledIds = new Set(visible.filter((c) => !c.allowed).map((c) => c.task.id));
  const byId = new Map(candidates.map((c) => [c.task.id, c]));
  return /* @__PURE__ */ jsx5(Dialog3, { open: true, onOpenChange: (next) => {
    if (!next) onClose();
  }, children: /* @__PURE__ */ jsxs5(DialogContent3, { className: "max-w-lg", children: [
    /* @__PURE__ */ jsx5(DialogHeader3, { children: /* @__PURE__ */ jsx5(DialogTitle3, { children: i18n.moveUnderTitle(draggedTitle) }) }),
    /* @__PURE__ */ jsx5(
      Input2,
      {
        autoFocus: true,
        value: query,
        placeholder: i18n.moveUnderSearch,
        onChange: (event) => setQuery(event.target.value)
      }
    ),
    /* @__PURE__ */ jsx5("div", { className: "max-h-72 overflow-y-auto", children: visible.length === 0 ? /* @__PURE__ */ jsx5("div", { className: "px-1 py-2 text-[11px] italic text-(--ui-text-quaternary)", children: i18n.moveUnderEmpty }) : /* @__PURE__ */ jsx5(
      TaskRelations,
      {
        heading: "",
        tasks: visible.map((c) => c.task),
        disabledIds,
        reasonOf: (id) => {
          const c = byId.get(id);
          return c && c.reason ? reasonLabel(c.reason, i18n) : null;
        },
        onOpen: (id) => {
          if (!disabledIds.has(id)) onPick(id);
        },
        openLabel: i18n.openTask,
        disabled: busy
      }
    ) })
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
function humanReparentError(error, i18n) {
  const message = String(error && error.message || error || "");
  if (/cycle/i.test(message)) return i18n.errCycle;
  if (/running/i.test(message)) return i18n.errRunning;
  if (/not on board/i.test(message)) return i18n.errOtherBoard;
  if (/own parent|itself/i.test(message)) return i18n.errSelf;
  return i18n.errReparent;
}
function toast(kind, message) {
  try {
    if (host && typeof host.notify === "function" && message) {
      host.notify({ kind, message });
    }
  } catch {
  }
}
var BOARD_KEY = "board";
function connectionScope() {
  try {
    const id = host && host.state && host.state.connectionId;
    const value = id && typeof id.get === "function" ? id.get() : id;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
function boardStorageKey() {
  const scope = connectionScope();
  return scope ? `${BOARD_KEY}.${scope}` : BOARD_KEY;
}
function readStoredBoard(storage2) {
  if (!storage2) return "";
  const scoped = storage2.get(boardStorageKey(), "");
  if (scoped) return scoped;
  return storage2.get(BOARD_KEY, "") || "";
}
function Ruler({ min, max, pxPerSec }) {
  const unit = tickUnit(max - min);
  const tickValues = ticks(min, max, unit);
  const dayWidth = pxPerSec * DAY;
  const showWeekday = unit === "day" && dayWidth >= 50;
  return jsxs6("div", {
    className: "relative border-b border-(--ui-stroke-secondary) select-none text-[10px]",
    style: { height: showWeekday ? "32px" : "24px" },
    children: tickValues.map((t) => {
      const left = Math.round((t - min) * pxPerSec);
      const d = new Date(t * 1e3);
      const label = unit === "month" ? d.toLocaleDateString(void 0, { month: "short", year: "2-digit" }) : d.toLocaleDateString(void 0, { month: "short", day: "numeric" });
      const weekday = showWeekday ? d.toLocaleDateString(void 0, { weekday: "short" }).replace(/\./g, "").slice(0, 3).toUpperCase() : null;
      return jsxs6("div", {
        className: "absolute top-0 flex flex-col",
        style: { left: `${left}px` },
        children: [
          jsx6("div", { className: "h-1.5 w-px bg-(--ui-stroke-tertiary)" }),
          weekday ? jsx6("div", { className: "pl-0.5 text-[8.5px] font-semibold text-(--ui-text-tertiary) leading-none pt-0.5", children: weekday }) : null,
          jsx6("div", { className: "pl-0.5 text-(--ui-text-tertiary) leading-tight", children: label })
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
    children.push(jsx6("div", {
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
      children.push(jsx6("div", { className: "kg-arc", style: { "--kanban-tone": tone } }));
    }
  }
  const onClick = onOpen ? () => onOpen(task.id) : void 0;
  if (bar.kind === "done" || bar.kind === "done-instant") {
    return jsx6("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick });
  }
  return jsxs6("div", { className: "absolute rounded-sm kg-bar hover:brightness-110 transition-all", style, title, onClick, children });
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
  const elRef = useRef2(null);
  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startPointer: e.clientX, startW: get() };
    if (elRef.current) elRef.current.setAttribute("data-dragging", "true");
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
      if (elRef.current) elRef.current.removeAttribute("data-dragging");
      if (getStorage()) getStorage().set(storageKey, String(get()));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return jsx6("div", {
    onPointerDown,
    onDoubleClick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      set(resetTo);
      if (getStorage()) getStorage().set(storageKey, String(resetTo));
    },
    className: "kg-resize-handle absolute z-40 touch-none cursor-col-resize",
    style: {
      touchAction: "none",
      // Inline positioning: negative Tailwind offsets may be missing from the
      // desktop's compiled CSS, which shifts the drawer handle ~16px inward.
      top: 0,
      bottom: 0,
      ...growDirection === "right" ? { right: -5, width: 10 } : { left: -5, width: 10 }
    },
    role: "separator",
    "aria-orientation": "vertical",
    // The affordance itself: the shell's own resizers draw a 4px rounded pill
    // inside a 10px hit strip, and it must be the SAME vocabulary here — a
    // Tailwind arbitrary class the desktop never compiled (the old
    // `hover:bg-(--ui-accent)/30`) painted nothing, which is why the handle
    // stopped showing any hover feedback. Drawn from the injected stylesheet.
    children: jsxs6("span", { className: "contents", children: [
      jsx6("span", { className: "kg-resize-rest" }),
      jsx6("span", { className: "kg-resize-pill" })
    ] })
  });
}
function TaskRow({ task, depth, isChild, now, pxPerSec, min, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge, dragState, onDragStartTask, onDragEndTask, onDropOn, hasChildren, collapsed, secondary, secondaryOnly, continuation = [], lastSibling, hiddenCount = 0, matched, descendantOfSelected, onToggleFold }) {
  const i18n = useGanttI18n();
  const labelW = useValue2($labelW);
  const bars = taskBars(task, now);
  const label = task.label ? `[${task.label}]` : "";
  const name = cleanTitle(task.title, task.label);
  const marks = treeMarks(depth, continuation, lastSibling);
  const line = "var(--ui-stroke-secondary)";
  const connectors = marks.guides.map((x) => jsx6("span", {
    key: `g${x}`,
    className: "absolute pointer-events-none",
    style: { left: `${x}px`, top: 0, width: "1px", height: "100%", backgroundColor: line, opacity: 0.65 }
  }));
  if (marks.elbowX !== null) {
    connectors.push(jsx6("span", {
      key: "elbow-v",
      className: "absolute pointer-events-none",
      style: {
        left: `${marks.elbowX}px`,
        top: 0,
        width: "1px",
        height: marks.elbowHalf ? "50%" : "100%",
        backgroundColor: line,
        opacity: 0.65
      }
    }));
    connectors.push(jsx6("span", {
      key: "elbow-h",
      className: "absolute pointer-events-none",
      style: {
        left: `${marks.elbowX}px`,
        top: "50%",
        width: `${marks.elbowW}px`,
        height: "1px",
        backgroundColor: line,
        opacity: 0.65
      }
    }));
  }
  const foldSquare = hasChildren ? jsx6("span", {
    role: "button",
    tabIndex: 0,
    "aria-label": collapsed ? hiddenCount ? i18n.expandTaskHidden(name, hiddenCount) : i18n.expandTask(name) : i18n.collapseTask(name),
    "aria-expanded": !collapsed,
    title: collapsed ? hiddenCount ? i18n.expandTaskHidden(name, hiddenCount) : i18n.expandTask(name) : i18n.collapseTask(name),
    className: cn3(
      "shrink-0 inline-flex items-center justify-center cursor-pointer select-none",
      "text-[10px] leading-none font-semibold",
      secondary || secondaryOnly ? "text-(--ui-text-quaternary)" : "text-(--ui-text-tertiary)",
      "hover:text-(--ui-text-primary)"
    ),
    style: {
      width: "13px",
      height: "13px",
      border: "1px solid var(--ui-stroke-secondary)",
      borderRadius: "3px",
      borderStyle: secondary || secondaryOnly ? "dashed" : "solid",
      backgroundColor: secondary || secondaryOnly ? "transparent" : "var(--ui-bg-tertiary, transparent)"
    },
    onClick: (e) => {
      e.stopPropagation();
      onToggleFold(task.id, !collapsed);
    },
    onKeyDown: (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onToggleFold(task.id, !collapsed);
    },
    children: collapsed ? "+" : "−"
  }) : jsx6("span", { className: "shrink-0", style: { width: "13px", height: "13px" }, "aria-hidden": "true" });
  const dotColor = (bars.length > 0 ? bars[bars.length - 1]?.tone : null) || statusTone(task.status);
  const icon = statusIcon(task.status);
  const statusTitle = i18n.col?.[task.status] || task.status;
  return jsxs6("div", {
    className: cn3(
      "group grid items-center border-b border-(--ui-stroke-tertiary)/40 transition-colors cursor-pointer",
      isSelected ? "bg-(--ui-accent)/12 font-semibold" : isChecked ? "bg-(--ui-accent)/6" : descendantOfSelected ? "bg-(--ui-accent)/7" : isEven ? "bg-black/[0.02] dark:bg-white/[0.02]" : "bg-transparent",
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
      jsxs6("div", {
        className: cn3(
          "relative flex items-center gap-1.5 min-w-0 sticky left-0 z-10 self-stretch",
          isSelected ? "font-semibold text-(--ui-accent)" : ""
        ),
        "data-glass-opaque": true,
        style: {
          paddingLeft: `${marks.indent}px`,
          paddingRight: "8px",
          width: `${labelW}px`,
          // Opaque fill spanning the full row height, tinted like the row
          // itself so the selection/check highlight stays visible through it.
          backgroundColor: isSelected ? "color-mix(in srgb, var(--ui-accent) 12%, var(--ui-bg-chrome))" : isChecked ? "color-mix(in srgb, var(--ui-accent) 6%, var(--ui-bg-chrome))" : descendantOfSelected ? "color-mix(in srgb, var(--ui-accent) 7%, var(--ui-bg-chrome))" : isEven ? "color-mix(in srgb, var(--ui-text-primary) 2%, var(--ui-bg-chrome))" : "var(--ui-bg-chrome)"
        },
        children: [
          ...connectors,
          foldSquare,
          jsx6("input", {
            type: "checkbox",
            checked: Boolean(isChecked),
            onChange: (e) => onToggleCheck(task.id, e.target.checked, e.nativeEvent),
            onClick: (e) => e.stopPropagation(),
            className: "shrink-0 rounded cursor-pointer mr-1",
            "aria-label": i18n.selectTask(name)
          }),
          jsx6("span", {
            className: "inline-flex items-center justify-center shrink-0 self-center",
            style: { color: dotColor },
            title: statusTitle,
            "aria-label": statusTitle,
            children: task.status === "running" ? jsxs6("span", {
              className: "relative inline-flex items-center justify-center",
              children: [
                jsx6("div", { className: "kg-arc", style: { "--kanban-tone": dotColor } }),
                jsx6(Codicon5, { name: icon, size: "0.85rem" })
              ]
            }) : jsx6(Codicon5, { name: icon, size: "0.85rem" })
          }),
          showBoardBadge && task.board ? jsx6(Badge, {
            size: "xs",
            variant: "outline",
            className: "shrink-0 font-mono text-[9px] px-1 py-0 h-3.5 max-w-[80px] truncate leading-tight",
            title: `${i18n.board} ${task.board}`,
            children: task.board
          }) : null,
          jsxs6("span", {
            className: cn3(
              "relative inline-flex items-center min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] text-left select-none px-1 py-0.5 rounded",
              task.status === "running" && "font-medium",
              isSelected ? "font-bold text-(--ui-accent)" : "",
              // Drop feedback while another row is being dragged over this one.
              dragState === "ok" && "ring-1 ring-inset ring-(--ui-accent) bg-(--ui-accent)/10",
              dragState === "no" && "ring-1 ring-inset ring-red-500/60 bg-red-500/10"
            ),
            title: `${showBoardBadge && task.board ? `[${task.board}] ` : ""}${name} (${task.id}) — ${i18n.clickForDetail}`,
            // Drag handle = the name cell only: the checkbox, the bars and the
            // width handles keep their own gestures, and a plain click still
            // opens the detail (native DnD needs actual movement to start).
            draggable: true,
            onDragStart: (event) => {
              event.dataTransfer.setData("text/plain", task.id);
              event.dataTransfer.effectAllowed = "move";
              onDragStartTask(task.id);
            },
            onDragEnd: () => onDragEndTask(),
            onDragOver: (event) => {
              if (!onDropOn) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = dragState === "ok" ? "move" : "none";
            },
            onDrop: (event) => {
              if (!onDropOn) return;
              event.preventDefault();
              event.stopPropagation();
              onDropOn(task.id);
            },
            children: [
              task.status === "running" ? jsx6("div", { className: "kg-arc", style: { "--kanban-tone": dotColor } }) : null,
              name
            ]
          })
        ]
      }),
      jsxs6("div", {
        className: "relative overflow-hidden",
        style: { height: `${ROW_H}px` },
        children: bars.length > 0 ? bars.map((b, idx) => jsx6(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, onOpen })) : [jsx6("div", { key: "empty", className: "text-(--ui-text-quaternary) text-[10px]", children: "—" })]
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
  return jsx6("span", {
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
  return jsxs6(DropdownMenu3, {
    children: [
      jsx6(DropdownMenuTrigger3, {
        asChild: true,
        children: jsx6(Button5, {
          size: "icon-xs",
          variant: "ghost",
          className: cn3(active && "bg-(--ui-control-active-background) text-(--ui-accent)"),
          "aria-label": i18n.filters,
          children: jsx6(Codicon5, { name: "filter", size: "0.85rem" })
        })
      }),
      jsxs6(DropdownMenuContent3, {
        align: "start",
        className: "min-w-[12rem] p-1",
        children: [
          jsx6("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.profiles }),
          jsxs6(DropdownMenuItem3, {
            onClick: onClearAssignees,
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx6("span", { className: "flex-1 font-medium", children: i18n.allProfiles }),
              selectedAssignees.size === 0 ? jsx6(Codicon5, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
            ]
          }),
          assignees.map((name) => {
            const isChecked = selectedAssignees.has(name);
            return jsxs6(DropdownMenuItem3, {
              key: name,
              onClick: () => onToggleAssignee(name),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx6(ProfileAvatar, { name, size: "1rem" }),
                jsx6("span", { className: "flex-1", children: name }),
                isChecked ? jsx6(Codicon5, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          jsx6(DropdownMenuSeparator3, {}),
          jsx6("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-(--ui-text-tertiary)", children: i18n.statuses }),
          ALL_STATUS_KEYS.map((s) => {
            const isVisible = !disabledStatuses.has(s);
            const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
            const label = i18n.col?.[s] || meta.label;
            return jsxs6(DropdownMenuItem3, {
              key: s,
              onClick: () => onToggleStatus(s),
              className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
              children: [
                jsx6("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                jsx6("span", { className: cn3("flex-1", !isVisible && "line-through opacity-50"), children: label }),
                isVisible ? jsx6(Codicon5, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
              ]
            });
          }),
          jsx6(DropdownMenuSeparator3, {}),
          jsxs6(DropdownMenuItem3, {
            onClick: () => onToggleArchived(!showArchived),
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx6("span", { className: "flex-1", children: i18n.showArchived }),
              showArchived ? jsx6(Codicon5, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
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
    return jsxs6("button", {
      type: "button",
      onClick: onToggleStatus ? () => onToggleStatus(statusKey) : void 0,
      className: cn3(
        "inline-flex items-center gap-1.5 text-[10px] cursor-pointer bg-transparent border-0 p-0 select-none transition-opacity hover:opacity-100",
        isExcluded ? "opacity-40 line-through text-(--ui-text-quaternary)" : "text-(--ui-text-tertiary)"
      ),
      title: isExcluded ? i18n.legendShow(label) : i18n.legendHide(label),
      children: [
        jsx6("div", {
          className: "h-2 w-3 rounded-xs shrink-0",
          style: { backgroundColor: color, opacity: isExcluded ? 0.3 : 1 }
        }),
        jsx6("span", { children: label })
      ]
    });
  };
  return jsxs6("div", {
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
      bands.push(jsx6("div", {
        className: "absolute top-0 bottom-0 pointer-events-none bg-black/15 dark:bg-black/25",
        style: { left: `${left}px`, width: `${width}px` }
      }, t));
    }
    t += step;
  }
  return jsxs6("div", { className: "absolute inset-0 pointer-events-none z-0", children: bands });
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
  return jsxs6(DropdownMenu3, { children: [
    jsx6(DropdownMenuTrigger3, {
      asChild: true,
      disabled,
      children: jsx6("button", {
        type: "button",
        className: "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer border border-(--ui-stroke-secondary) bg-(--ui-bg-subtle, transparent) hover:bg-(--chrome-action-hover)",
        children: [
          assignee ? jsx6(ProfileAvatar, { name: assignee, size: "0.9rem" }) : jsx6("span", { className: "text-(--ui-text-tertiary)", children: "👤" }),
          jsx6("span", { children: current }),
          jsx6("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs6(DropdownMenuContent3, {
      align: "start",
      className: "min-w-[10rem] p-1",
      children: [
        jsx6(DropdownMenuItem3, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px] text-(--ui-text-tertiary)",
          onClick: () => onAssign(""),
          children: [
            jsx6("span", { className: "flex-1", children: i18n.unassignedEmpty }),
            !assignee ? jsx6("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }),
        assignees.map((name) => {
          const isCur = name === assignee;
          return jsx6(DropdownMenuItem3, {
            key: name,
            className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
            onClick: () => onAssign(name),
            children: [
              jsx6(ProfileAvatar, { name, size: "0.9rem" }),
              jsx6("span", { className: "flex-1", children: name }),
              isCur ? jsx6("span", { className: "opacity-60", children: "✓" }) : null
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
  const [menu, setMenu] = useState4(null);
  const [customAssignee, setCustomAssignee] = useState4("");
  if (selected.size === 0) return null;
  return jsx6("div", {
    className: "pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-150",
    children: jsxs6("div", {
      className: "pointer-events-auto flex items-center gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) py-1.5 pr-1.5 pl-3.5 shadow-xl",
      children: [
        jsx6("span", { className: "mr-1 text-xs tabular-nums font-medium text-(--ui-text-secondary)", children: i18n.nSelected(selected.size) }),
        // Move to dropdown
        jsxs6(DropdownMenu3, {
          open: menu === "move",
          onOpenChange: (open) => setMenu(open ? "move" : null),
          children: [
            jsx6(DropdownMenuTrigger3, {
              asChild: true,
              children: jsxs6(Button5, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx6("span", { children: i18n.moveToShort }),
                  jsx6(Codicon5, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsx6(DropdownMenuContent3, {
              align: "center",
              className: "min-w-[9rem] p-1",
              children: STATUS_ORDER.map((s) => {
                const meta = STATUS_META[s] || { tone: "var(--ui-text-secondary)", label: s };
                const label = i18n.col?.[s] || meta.label;
                return jsxs6(DropdownMenuItem3, {
                  key: s,
                  onClick: () => {
                    setMenu(null);
                    onStatus(s);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx6("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: meta.tone } }),
                    jsx6("span", { className: "flex-1", children: label })
                  ]
                });
              })
            })
          ]
        }),
        // Assign dropdown
        jsxs6(DropdownMenu3, {
          open: menu === "assign",
          onOpenChange: (open) => setMenu(open ? "assign" : null),
          children: [
            jsx6(DropdownMenuTrigger3, {
              asChild: true,
              children: jsxs6(Button5, {
                disabled: busy,
                size: "xs",
                variant: "ghost",
                className: "gap-1 text-xs",
                children: [
                  jsx6("span", { children: i18n.assignLabel.replace(":", "") }),
                  jsx6(Codicon5, { name: "chevron-down", size: "0.7rem" })
                ]
              })
            }),
            jsxs6(DropdownMenuContent3, {
              align: "center",
              className: "min-w-[10rem] p-1",
              children: [
                assignees.map((name) => jsx6(DropdownMenuItem3, {
                  key: name,
                  onClick: () => {
                    setMenu(null);
                    onAssign(name);
                  },
                  className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
                  children: [
                    jsx6(ProfileAvatar, { name, size: "0.85rem" }),
                    jsx6("span", { className: "flex-1", children: name })
                  ]
                })),
                assignees.length > 0 ? jsx6(DropdownMenuSeparator3, {}) : null,
                jsx6(DropdownMenuItem3, {
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
        jsx6(Button5, {
          disabled: busy,
          onClick: onArchive,
          size: "xs",
          variant: "ghost",
          className: "text-xs",
          children: i18n.actions.archive
        }),
        // Delete button
        jsx6(Button5, {
          disabled: busy,
          onClick: onDelete,
          size: "xs",
          variant: "ghost",
          className: "text-destructive text-xs hover:bg-destructive/10",
          children: i18n.delete
        }),
        // Clear button (✕)
        jsx6(Button5, {
          "aria-label": i18n.clearSelection,
          onClick: onClear,
          size: "icon-xs",
          variant: "ghost",
          className: "ml-1 text-(--ui-text-quaternary) hover:text-(--ui-text-primary)",
          children: jsx6(Codicon5, { name: "close", size: "0.8rem" })
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
  return jsxs6(DropdownMenu3, { children: [
    jsx6(DropdownMenuTrigger3, {
      asChild: true,
      disabled,
      children: jsx6("button", {
        type: "button",
        className: "relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer",
        style: { background: `color-mix(in srgb, ${meta.tone} 18%, transparent)`, color: "inherit", border: `1px solid color-mix(in srgb, ${meta.tone} 45%, transparent)` },
        children: [
          isRunning ? jsx6("div", { className: "kg-arc", style: { "--kanban-tone": meta.tone } }) : null,
          jsx6("span", { className: "h-2 w-2 rounded-full", style: { backgroundColor: meta.tone } }),
          jsx6("span", { children: label }),
          jsx6("span", { className: "text-[9px] opacity-60", children: "▾" })
        ]
      })
    }),
    jsxs6(DropdownMenuContent3, {
      align: "start",
      className: "min-w-[9rem] p-1",
      children: STATUS_ORDER.map((s) => {
        const m = STATUS_META[s];
        const current = s === status;
        const l = i18n.col?.[s] || m.label;
        return jsx6(DropdownMenuItem3, {
          className: "flex items-center gap-2 px-2.5 py-1 text-[11px]",
          onClick: () => {
            if (!current) onPick(s);
          },
          disabled: current,
          children: [
            jsx6("span", { className: "h-2 w-2 rounded-full shrink-0", style: { backgroundColor: m.tone } }),
            jsx6("span", { className: "flex-1", children: l }),
            current ? jsx6("span", { className: "opacity-60", children: "✓" }) : null
          ]
        }, s);
      })
    })
  ] });
}
function TaskDrawer({ taskId, board, onClose, assignees = [], tasks = [], docked = false, onToggleDock, boards = [] }) {
  const drawerW = useValue2($drawerW);
  const i18n = useGanttI18n();
  const queryClient = useQueryClient2();
  const scrollContainerRef = useRef2(null);
  const prevTaskIdRef = useRef2(null);
  const [moveBoardOpen, setMoveBoardOpen] = useState4(false);
  const shownBoard = board;
  const moveMutation = useMutation({
    mutationFn: (toBoard) => apiFetch(`/tasks/${encodeURIComponent(shownId)}/move?board=${encodeURIComponent(board || "")}`, {
      method: "POST",
      body: { to_board: toBoard }
    }),
    onSuccess: (result) => {
      setMoveBoardOpen(false);
      toast("success", i18n.movedTo(result?.to || result?.count || ""));
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
      onClose();
    }
  });
  const [descOwner, setDescOwner] = useState4(null);
  const [descDraft, setDescDraft] = useState4("");
  const shownId = descOwner || taskId;
  const switchResolvedRef = useRef2(false);
  const { data, isLoading, isError, refetch } = useQuery2({
    queryKey: ["kanban-gantt", "task", apiBase(), board, shownId],
    queryFn: () => fetchTask(shownId, board),
    enabled: Boolean(shownId)
  });
  useEffect3(() => {
    if (shownId && prevTaskIdRef.current !== shownId) {
      prevTaskIdRef.current = shownId;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [shownId]);
  const [comment, setComment] = useState4("");
  const [runsOpen, setRunsOpen] = useState4(false);
  const [commentsOpen, setCommentsOpen] = useState4(true);
  const [showAllComments, setShowAllComments] = useState4(false);
  const [pendingUnlink, setPendingUnlink] = useState4(null);
  const relations = useMemo2(() => relationsOf(tasks, shownId), [tasks, shownId]);
  const statusMutation = useMutation({
    mutationFn: (payload) => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/status${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: payload }
    ),
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
    },
    onError: (error) => toast("error", String(error?.message || error))
  });
  const commentMutation = useMutation({
    mutationFn: (body) => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/comments${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "POST", body }
    ),
    onSuccess: () => {
      void refetch();
    },
    onError: (error) => toast("error", String(error?.message || error))
  });
  const assignMutation = useMutation({
    mutationFn: (profile) => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/assignee${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: { profile } }
    ),
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
    },
    onError: (error) => toast("error", String(error?.message || error))
  });
  const descriptionMutation = useMutation({
    mutationFn: (body) => apiFetch(
      `/tasks/${encodeURIComponent(shownId)}/description${board ? `?board=${encodeURIComponent(board)}` : ""}`,
      { method: "PATCH", body: { body } }
    ),
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
      setDescOwner(null);
    },
    onError: (error) => toast("error", String(error?.message || error))
  });
  const descDirty = Boolean(descOwner) && descDraft !== (data?.task?.body || "");
  const descSwitchPending = Boolean(descOwner) && descOwner !== taskId && descDirty;
  useEffect3(() => {
    if (!descOwner || descOwner === taskId || descDirty) return;
    setDescOwner(null);
    setDescDraft("");
  }, [taskId, descOwner, descDirty]);
  const unlinkMutation = useMutation({
    mutationFn: (parentId) => removeParent(shownId, parentId, board),
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
    },
    onError: (error) => toast("error", String(error?.message || error))
  });
  const st = data?.task?.status || "todo";
  const matrix = ACTION_MATRIX[st] || { primary: [], more: [] };
  const more = matrix.more || [];
  const actionLabel = (a) => i18n.actions?.[a] || a;
  return jsxs6("div", {
    className: docked ? "relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4" : "absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4",
    "data-glass-opaque": true,
    role: "dialog",
    "aria-label": i18n.taskDetail,
    style: { width: `${drawerW}px` },
    children: [
      jsx6(ResizeHandle, {
        get: () => $drawerW.get(),
        set: (w) => $drawerW.set(w),
        min: DRAWER_W_MIN,
        max: DRAWER_W_MAX,
        resetTo: 416,
        storageKey: "drawerW",
        growDirection: "left"
      }),
      // Pinned top section: header, actions and title with bottom separator
      jsxs6("div", {
        className: "flex flex-col gap-2 pb-3 border-b border-(--ui-stroke-tertiary) shrink-0",
        children: [
          // Top row: status, assignee, task id, [...] menu, close
          jsxs6("div", {
            className: "flex items-center justify-between gap-1.5",
            children: [
              jsxs6("div", { className: "flex flex-wrap items-center gap-1.5 min-w-0", children: [
                jsx6(Button5, { size: "icon-xs", variant: "ghost", onClick: onToggleDock, "aria-label": docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? "»" : "«" }),
                StatusBadge({
                  status: data?.task?.status,
                  disabled: statusMutation.isPending,
                  onPick: (next) => {
                    const action = next === "done" ? "done" : next === "blocked" ? "blocked" : next === "ready" ? "ready" : next === "todo" ? "todo" : next === "review" ? "review" : next === "triage" ? "triage" : null;
                    if (action) statusMutation.mutate({ action });
                  }
                }),
                jsx6(AssigneeBadge, {
                  assignee: data?.task?.assignee,
                  assignees,
                  disabled: assignMutation.isPending,
                  onAssign: (profile) => assignMutation.mutate(profile)
                }),
                jsx6("span", {
                  className: "text-[11px] font-mono text-(--ui-text-quaternary) hover:text-(--ui-text-secondary) cursor-help select-all",
                  title: i18n.copyHint(shownId),
                  children: shortId(shownId)
                })
              ] }),
              jsxs6("div", { className: "flex items-center gap-1 shrink-0", children: [
                jsxs6(DropdownMenu3, { children: [
                  jsx6(DropdownMenuTrigger3, {
                    asChild: true,
                    children: jsx6("button", {
                      type: "button",
                      className: "inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent",
                      "aria-label": i18n.actionsMenu,
                      children: jsx6(Codicon5, { name: "ellipsis", size: "0.9rem" })
                    })
                  }),
                  jsxs6(DropdownMenuContent3, {
                    align: "end",
                    className: "min-w-[11rem] p-1 text-xs",
                    children: [
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => void navigator.clipboard.writeText(shownId),
                        children: i18n.copyTaskId
                      }),
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => {
                          if (data?.task?.title) void navigator.clipboard.writeText(data.task.title);
                        },
                        children: i18n.copyTitle
                      }),
                      jsx6(DropdownMenuSeparator3, {}),
                      // Creation verb reachable from a task: the new task starts
                      // as a child of this one.
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => $newTask.set({ parentId: shownId }),
                        children: jsxs6("span", { className: "flex items-center gap-2", children: [
                          jsx6(Codicon5, { name: "add", size: "0.85rem" }),
                          i18n.createSubtask
                        ] })
                      }),
                      // Keyboard-reachable twin of the drag & drop: opens the
                      // page's task picker for this task.
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => $moveUnderId.set(shownId),
                        children: jsxs6("span", { className: "flex items-center gap-2", children: [
                          jsx6(Codicon5, { name: "move", size: "0.85rem" }),
                          i18n.moveUnder
                        ] })
                      }),
                      // Cross-board move: opens the board-picker dialog (with
                      // its own confirmation chain). Requires another board.
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => {
                          const others = boards.filter((b) => b.slug !== shownBoard);
                          if (others.length === 0) {
                            toast("warning", i18n.moveNoOtherBoards);
                            return;
                          }
                          setMoveBoardOpen(true);
                        },
                        children: jsxs6("span", { className: "flex items-center gap-2", children: [
                          jsx6(Codicon5, { name: "arrow-circle-right", size: "0.85rem" }),
                          i18n.moveToBoard
                        ] })
                      }),
                      more.length ? jsx6(DropdownMenuSeparator3, {}) : null,
                      more.map((a) => jsx6(DropdownMenuItem3, {
                        key: a,
                        className: "flex items-center gap-2 px-3 py-1.5",
                        onClick: () => statusMutation.mutate({ action: a }),
                        children: actionLabel(a)
                      })),
                      jsx6(DropdownMenuSeparator3, {}),
                      jsx6(DropdownMenuItem3, {
                        className: "flex items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-500/10",
                        onClick: () => {
                          if (confirm(i18n.confirmDelete(shownId))) {
                            statusMutation.mutate({ action: "delete" });
                            onClose();
                          }
                        },
                        children: i18n.delete
                      })
                    ]
                  })
                ] }),
                jsx6(Button5, { size: "icon-xs", variant: "ghost", onClick: onClose, "aria-label": i18n.close, children: "✕" })
              ] })
            ]
          }),
          // Primary actions bar placed ABOVE the title
          (matrix.primary || []).length ? jsxs6("div", { className: "flex flex-wrap items-center gap-1.5 py-0.5", children: [
            jsx6("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary) mr-1", children: i18n.action }),
            (matrix.primary || []).map((a) => jsx6(Button5, {
              key: a,
              size: "xs",
              disabled: statusMutation.isPending,
              onClick: () => statusMutation.mutate({ action: a }),
              children: actionLabel(a)
            }))
          ] }) : null,
          // Title kept always visible
          jsx6("div", { className: "text-base font-semibold leading-snug", children: cleanTitle(data?.task?.title, data?.task?.label) })
        ]
      }),
      // Scrollable content underneath the pinned header + title
      isLoading ? jsx6("div", { className: "py-8 flex justify-center", children: jsx6(Loader, {}) }) : isError ? jsx6(ErrorState, { title: i18n.taskUnreadable, description: i18n.taskUnreadableDesc }) : jsxs6("div", { ref: scrollContainerRef, className: "flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pt-1", children: [
        // 0. Relations — parents (removable, behind a confirmation) and
        //    children (read-only for now: removing that link means
        //    re-parenting the child itself). Clicking a name opens that
        //    task's detail, which also selects its row in the gantt.
        jsx6(TaskRelations, {
          heading: i18n.parents,
          tasks: relations.parents,
          emptyLabel: relations.parents.length === 0 ? i18n.noParents : void 0,
          onOpen: (id) => $openTaskId.set(id),
          onRemove: (id) => {
            const parent = relations.parents.find((t) => t.id === id);
            setPendingUnlink({ id, title: parent ? parent.title : id });
          },
          removeLabel: i18n.removeParentLink,
          openLabel: i18n.openTask,
          disabled: unlinkMutation.isPending
        }),
        jsx6(TaskRelations, {
          heading: i18n.children,
          tasks: relations.children,
          emptyLabel: relations.children.length === 0 ? i18n.noChildren : void 0,
          onOpen: (id) => $openTaskId.set(id),
          openLabel: i18n.openTask
        }),
        // 1. Description (no max-h clamp). Always rendered, so a task that has
        // no description yet can be given one; the pencil at the right of the
        // label mirrors the reference kanban drawer's DescriptionSection, and
        // the editor shows the raw markdown with an explicit Save.
        jsxs6("div", { className: "flex flex-col gap-1", children: [
          jsxs6("div", { className: "flex items-center justify-between gap-2", children: [
            jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.description }),
            jsx6(Button5, {
              variant: "ghost",
              size: "icon-xs",
              "aria-label": descOwner ? i18n.cancelEdit : i18n.editDescription,
              title: descOwner ? i18n.cancelEdit : i18n.editDescription,
              onClick: () => {
                if (descOwner) {
                  setDescOwner(null);
                  setDescDraft("");
                } else {
                  setDescOwner(shownId);
                  setDescDraft(data?.task?.body || "");
                }
              },
              children: jsx6(Codicon5, { name: descOwner ? "close" : "edit", size: "0.75rem" })
            })
          ] }),
          descOwner ? jsxs6("div", { className: "flex flex-col gap-1.5", children: [
            jsx6(Textarea, {
              className: "min-h-24 text-[11px]",
              value: descDraft,
              disabled: descriptionMutation.isPending,
              onChange: (event) => setDescDraft(event.target.value)
            }),
            jsx6(Button5, {
              className: "self-end",
              size: "xs",
              variant: "secondary",
              disabled: descriptionMutation.isPending,
              onClick: () => descriptionMutation.mutate(descDraft),
              children: i18n.save
            })
          ] }) : data?.task?.body ? jsx6("div", {
            className: "text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx6(Streamdown, { children: data.task.body })
          }) : jsx6("p", { className: "text-[11px] text-(--ui-text-quaternary)", children: i18n.noDescription })
        ] }),
        // 2. Result (no max-h clamp)
        data?.task?.result ? jsxs6("div", { className: "flex flex-col gap-1", children: [
          jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.result }),
          jsx6("div", {
            className: "text-[11px] prose prose-sm kg-prose max-w-none border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
            children: jsx6(Streamdown, { children: data.task.result })
          })
        ] }) : null,
        // 3. Latest summary (highlighted when blocked or done/completed)
        data?.task?.latest_summary ? jsxs6("div", { className: "flex flex-col gap-1", children: [
          jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.latestSummary }),
          jsx6("div", {
            className: cn3(
              "text-[11px] prose prose-sm kg-prose max-w-none rounded p-2.5 transition-colors",
              data?.task?.status === "blocked" ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : data?.task?.status === "done" || data?.task?.status === "archived" ? "border border-emerald-500/35 bg-emerald-500/10" : "border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)"
            ),
            children: jsx6(Streamdown, { children: data.task.latest_summary })
          })
        ] }) : null,
        // 4. Run history (Collapsible section, collapsed by default, no internal scrollbar)
        (data?.task?.runs || []).length ? jsxs6("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
          jsxs6("button", {
            type: "button",
            className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
            onClick: () => setRunsOpen((o) => !o),
            children: [
              jsxs6("div", { className: "flex items-center gap-1.5", children: [
                jsx6("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: runsOpen ? "▼" : "▶" }),
                jsx6("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.runs(data.task.runs.length) })
              ] }),
              jsx6("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: runsOpen ? i18n.hide : i18n.show })
            ]
          }),
          runsOpen ? jsx6("div", { className: "flex flex-col gap-2 pt-1", children: data.task.runs.map((r, i) => {
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
            return jsxs6("div", {
              key: r.id || i,
              className: "flex flex-col gap-1 text-[11px] border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
              children: [
                jsxs6("div", { className: "flex flex-wrap items-center gap-1.5 text-[10px]", children: [
                  jsx6(Badge, { size: "xs", variant: failed ? "destructive" : r.ended_at ? "muted" : "secondary", children: r.outcome || r.status || "run" }),
                  r.profile ? jsxs6("span", { className: cn3("font-medium", isDiffProfile ? "text-amber-500 font-semibold" : "text-(--ui-text-secondary)"), children: [
                    "👤 ",
                    r.profile,
                    isDiffProfile ? jsx6("span", { className: "text-[9px] text-(--ui-text-quaternary) ml-1", children: i18n.reassigned }) : null
                  ] }) : null,
                  durationStr ? jsx6("span", { className: "text-(--ui-text-tertiary)", children: `⏱ ${durationStr}` }) : null,
                  dateStr ? jsx6("span", { className: "text-(--ui-text-quaternary) ml-auto text-[9.5px]", children: dateStr }) : null
                ] }),
                r.summary ? jsx6("div", { className: "prose prose-sm kg-prose max-w-none text-[11px] mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50", children: jsx6(Streamdown, { children: r.summary }) }) : null
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
          return jsxs6("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
            jsxs6("button", {
              type: "button",
              className: "flex items-center justify-between w-full text-left py-1 px-1 -mx-1 rounded hover:bg-(--chrome-action-hover) cursor-pointer border-0 bg-transparent text-(--ui-text-primary)",
              onClick: () => {
                setCommentsOpen((o) => {
                  if (o) setShowAllComments(false);
                  return !o;
                });
              },
              children: [
                jsxs6("div", { className: "flex items-center gap-1.5", children: [
                  jsx6("span", { className: "text-[10px] text-(--ui-text-tertiary) select-none", children: commentsOpen ? "▼" : "▶" }),
                  jsx6("span", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.comments(totalComments) })
                ] }),
                jsx6("span", { className: "text-[10px] text-(--ui-text-quaternary)", children: commentsOpen ? i18n.hide : i18n.show })
              ]
            }),
            commentsOpen ? jsxs6("div", { className: "flex flex-col gap-1.5 pt-1", children: [
              hiddenCount > 0 ? jsx6("button", {
                type: "button",
                className: "text-[10.5px] text-(--ui-accent) hover:underline cursor-pointer border-0 bg-transparent text-left py-0.5 select-none",
                onClick: () => setShowAllComments(true),
                children: `↑ ${i18n.showPreviousComments(hiddenCount)}`
              }) : null,
              visibleComments.map((c, i) => {
                const dateStr = c.created_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.created_at * 1e3)) : "";
                return jsxs6("div", {
                  key: c.id || i,
                  className: "text-[11px] border border-(--ui-stroke-tertiary)/60 rounded p-1.5 bg-(--ui-bg-subtle, transparent)",
                  children: [
                    jsxs6("div", { className: "flex items-center gap-1.5 text-[10px] text-(--ui-text-tertiary) mb-0.5", children: [
                      jsx6("span", { className: "font-medium text-(--ui-text-secondary)", children: c.author || "?" }),
                      dateStr ? jsx6("span", { className: "ml-auto text-(--ui-text-quaternary)", children: dateStr }) : null
                    ] }),
                    jsx6("div", { className: "prose prose-sm kg-prose max-w-none text-[11px]", children: jsx6(Streamdown, { children: c.body || "" }) })
                  ]
                });
              }),
              jsxs6("div", { className: "flex gap-1.5 mt-1", children: [
                jsx6("input", {
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
                jsx6(Button5, {
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
        (data?.task?.events || []).length ? jsxs6("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1", children: [
          jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.activity(data.task.events.length) }),
          jsx6("div", { className: "flex flex-col gap-0.5 max-h-32 overflow-auto", children: data.task.events.slice(-12).reverse().map((e, i) => jsx6("div", {
            key: i,
            className: "text-[10px] text-(--ui-text-tertiary)",
            children: String(e.kind || "event")
          }, i)) })
        ] }) : null
      ] }),
      // Drops a parent link — behind a confirmation, so a stray click on the
      // row's ✕ never silently rewires the tree.
      jsx6(ConfirmDialog, {
        open: Boolean(pendingUnlink),
        onClose: () => setPendingUnlink(null),
        onConfirm: () => unlinkMutation.mutateAsync(pendingUnlink.id),
        title: i18n.removeParentConfirmTitle(pendingUnlink ? pendingUnlink.title : ""),
        description: i18n.removeParentConfirmDesc,
        confirmLabel: i18n.removeParentLink(pendingUnlink ? pendingUnlink.title : ""),
        cancelLabel: i18n.cancel,
        destructive: true
      }),
      // The description draft guard: the page asked for another task while the
      // draft was unsaved. Three ways out — write it and open the task, drop it
      // and open it, or cancel the switch and stay here with the editor as it is.
      jsx6(ConfirmDialog, {
        open: descSwitchPending,
        onClose: () => {
          const resolved = switchResolvedRef.current;
          switchResolvedRef.current = false;
          if (!resolved && descOwner) $openTaskId.set(descOwner);
        },
        onConfirm: async () => {
          await descriptionMutation.mutateAsync(descDraft);
          switchResolvedRef.current = true;
          setDescOwner(null);
          setDescDraft("");
        },
        title: i18n.unsavedDescTitle,
        description: i18n.unsavedDescBody,
        confirmLabel: i18n.saveAndOpen,
        cancelLabel: i18n.keepEditing,
        secondaryAction: {
          label: i18n.discardChanges,
          onClick: () => {
            setDescOwner(null);
            setDescDraft("");
          }
        }
      }),
      // Cross-board move: board picker + its own confirmation chain (plain
      // move, children-must-travel, parent-loss) and a spinner while moving.
      jsx6(MoveTaskDialog, {
        open: moveBoardOpen,
        task: data?.task ? {
          id: shownId,
          title: data.task.title || shownId,
          children: data.task.children || [],
          parents: data.task.parents || []
        } : null,
        boards,
        currentBoard: board || "",
        i18n,
        onClose: () => setMoveBoardOpen(false),
        onMove: (toBoard) => moveMutation.mutateAsync(toBoard)
      })
    ]
  });
}
function KanbanGanttPage() {
  const i18n = useGanttI18n();
  const queryClient = useQueryClient2();
  const base = useValue2($baseUrl);
  const board = useValue2($boardSlug);
  const scope = useValue2($connectionScope);
  const openTaskId = useValue2($openTaskId);
  const newTask = useValue2($newTask);
  const moveUnderId = useValue2($moveUnderId);
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
  const { data: profilesData } = useQuery2({
    queryKey: ["kanban-gantt", "profiles", apiBase()],
    queryFn: () => fetchProfiles(),
    staleTime: 6e4
  });
  const wsEnabled = useValue2($wsEnabled);
  const [wsState, setWsState] = useState4(WS_STATE.off);
  const socketDoor = getSocket();
  const wsBoard = wsEnabled && !base && canPush(board) ? board : null;
  const { data, isLoading, isError, error } = useQuery2({
    queryKey: ["kanban-gantt", "gantt", apiBase(), board],
    queryFn: () => apiFetch(`/gantt${board ? `?board=${encodeURIComponent(board)}` : ""}`),
    refetchInterval: wsState === WS_STATE.live ? 3e5 : 6e4
  });
  const foldKey = `fold.${board || "current"}`;
  const [fold, setFold] = useState4(() => /* @__PURE__ */ new Map());
  useEffect3(() => {
    let next = /* @__PURE__ */ new Map();
    try {
      const raw = getStorage() ? getStorage().get(foldKey, null) : null;
      const parsed = raw ? JSON.parse(String(raw)) : [];
      if (Array.isArray(parsed)) next = new Map(parsed.filter(Array.isArray));
    } catch (err) {
      next = /* @__PURE__ */ new Map();
    }
    setFold(next);
  }, [foldKey]);
  const writeFold = (next) => {
    setFold(next);
    if (getStorage()) getStorage().set(foldKey, JSON.stringify([...next]));
  };
  const handleToggleFold = (id, collapsed) => {
    const next = new Map(fold);
    next.set(id, collapsed);
    writeFold(next);
  };
  const recordWsState = (state) => {
    setWsState(state);
    if (getStorage()) getStorage().set("wsState", state);
  };
  useEffect3(() => {
    if (!wsBoard) {
      const why = !wsEnabled ? "disabled" : base ? "custom-base" : board && !canPush(board) ? "all-boards" : !socketDoor ? "no-door" : "no-board";
      if (getStorage()) {
        getStorage().set("wsOff", why);
        getStorage().set("wsState", WS_STATE.off);
      }
      setWsState(WS_STATE.off);
      return void 0;
    }
    if (getStorage()) getStorage().set("wsOff", "");
    return subscribeGantt(socketDoor, {
      board: wsBoard,
      onState: recordWsState,
      onSnapshot: (snapshot) => {
        queryClient.setQueryData(["kanban-gantt", "gantt", apiBase(), wsBoard], snapshot);
      },
      onResync: () => {
        void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt", apiBase(), wsBoard] });
      }
    });
  }, [wsBoard, socketDoor, queryClient, scope]);
  const [nowTick, setNowTick] = useState4(0);
  useEffect3(() => {
    if (wsState !== WS_STATE.live) return void 0;
    const id = setInterval(() => setNowTick((t) => t + 1), 3e4);
    return () => clearInterval(id);
  }, [wsState]);
  const [showArchived, setShowArchived] = useState4(false);
  const [dragId, setDragId] = useState4(null);
  const [pendingReparent, setPendingReparent] = useState4(null);
  const allTasks = data?.tasks || [];
  const [selectedAssignees, setSelectedAssignees] = useState4(() => /* @__PURE__ */ new Set());
  const [disabledStatuses, setDisabledStatuses] = useState4(() => {
    const saved = getStorage() ? getStorage().get("disabledStatuses", null) : null;
    return Array.isArray(saved) ? new Set(saved) : /* @__PURE__ */ new Set();
  });
  const [search, setSearch] = useState4("");
  const [selectedIds, setSelectedIds] = useState4(() => /* @__PURE__ */ new Set());
  const [bulkAssignee, setBulkAssignee] = useState4("");
  const lastCheckedIdRef = useRef2(null);
  const [zoom, setZoom] = useState4(() => {
    const saved = getStorage() ? getStorage().get("zoom", null) : null;
    return saved != null && Number.isFinite(Number(saved)) ? Number(saved) : 1;
  });
  const containerRef = useRef2(null);
  const scrollerRef = useRef2(null);
  const [trackW, setTrackW] = useState4(0);
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
    const rows2 = treeRows(visible, {
      fold,
      search,
      selected: openTaskId ? /* @__PURE__ */ new Set([openTaskId]) : /* @__PURE__ */ new Set()
    });
    const domain2 = computeDomain(visible);
    const allAssignees = Array.from(new Set(data.tasks.map((t) => t.assignee).filter(Boolean))).sort();
    return { rows: rows2, domain: domain2, total: visible.length, tasks: visible, allAssignees };
  }, [data, showArchived, disabledStatuses, selectedAssignees, search, fold, openTaskId]);
  const handleToggleAll = () => {
    const parents = (derived?.rows || []).filter((r) => r.hasChildren);
    if (!parents.length) return;
    const anyOpen = parents.some((r) => !r.collapsed);
    const next = new Map(fold);
    for (const r of parents) next.set(r.task.id, anyOpen);
    writeFold(next);
  };
  const anyBranchOpen = (derived?.rows || []).some((r) => r.hasChildren && !r.collapsed);
  const createTaskMutation = useMutation({
    mutationFn: (values) => createTask(values, board),
    onSuccess: (response, values) => {
      $newTask.set(null);
      toast("info", i18n.created(values.title));
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
      $openTaskId.set(response.task_id);
    },
    onError: (error2) => {
      const message = String(error2 && error2.message || error2 || "");
      toast("error", /title is required/i.test(message) ? i18n.errTitleRequired : i18n.errCreate);
    }
  });
  const boardOf = (id) => {
    const task = allTasks.find((t) => t.id === id);
    if (task && task.board) return task.board;
    return board && board !== "all" && board !== "*" ? board : void 0;
  };
  const dropMap = useMemo2(
    () => dragId ? new Map(dropCandidates(allTasks, dragId, boardOf(dragId)).map((c) => [c.task.id, c])) : null,
    [dragId, allTasks, board]
  );
  const reparentMutation = useMutation({
    mutationFn: ({ childId, parentId, mode }) => setParent(childId, parentId, mode, board),
    onSuccess: (response) => {
      setPendingReparent(null);
      const child = allTasks.find((t) => t.id === response.task_id);
      const parent = allTasks.find((t) => t.id === response.parent_id);
      const childName = child ? child.title : response.task_id;
      const parentName = parent ? parent.title : response.parent_id;
      toast("info", response.gated ? i18n.gatedNotice(childName) : i18n.movedUnder(childName, parentName));
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
    },
    onError: (error2) => {
      setPendingReparent(null);
      toast("error", humanReparentError(error2, i18n));
    }
  });
  const unlinkMutation = useMutation({
    mutationFn: ({ childId, parentId }) => removeParent(childId, parentId, board),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
    },
    onError: (error2) => toast("error", humanReparentError(error2, i18n))
  });
  const handleDragStart = (id) => {
    setDragId(id);
  };
  const handleDropOn = (targetId) => {
    const childId = dragId;
    setDragId(null);
    if (!childId || childId === targetId) return;
    const candidate = dropMap ? dropMap.get(targetId) : null;
    if (candidate && !candidate.allowed) {
      toast("error", reasonLabel(candidate.reason, i18n));
      return;
    }
    const child = allTasks.find((t) => t.id === childId);
    const parents = child && child.parents || [];
    if (parents.length > 0) {
      setPendingReparent({ childId, parentId: targetId });
      return;
    }
    reparentMutation.mutate({ childId, parentId: targetId, mode: "add" });
  };
  const handlePickParent = (parentId) => {
    const childId = moveUnderId;
    $moveUnderId.set(null);
    if (!childId || childId === parentId) return;
    const candidate = dropCandidates(allTasks, childId, boardOf(childId)).find((c) => c.task.id === parentId);
    if (candidate && !candidate.allowed) {
      toast("error", reasonLabel(candidate.reason, i18n));
      return;
    }
    const child = allTasks.find((t) => t.id === childId);
    if ((child && child.parents || []).length > 0) {
      setPendingReparent({ childId, parentId });
      return;
    }
    reparentMutation.mutate({ childId, parentId, mode: "add" });
  };
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
  useEffect3(() => {
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
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
    }
  });
  const handleZoomChange = (val) => {
    setZoom(val);
    if (getStorage()) getStorage().set("zoom", val);
  };
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (getStorage()) getStorage().set(boardStorageKey(), slug);
    setSearch("");
    void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
  };
  useEffect3(() => {
    const list = boardsData?.boards;
    if (!list || !list.length) return;
    const known = list.map((b) => typeof b === "string" ? b : b && b.slug).filter(Boolean);
    const resolved = resolveBoardSlug(board, known, boardsData.current);
    if (resolved.fallback) {
      toast("warning", `${i18n.boardGoneTitle(board)} — ${i18n.boardGoneDesc(resolved.suggested)}`);
      setBoard(resolved.suggested);
      return;
    }
    if (resolved.suggested) setBoard(resolved.suggested);
  }, [boardsData, board]);
  useEffect3(() => {
    if (!isError || !board || !isMissingBoardError(error)) return;
    toast("warning", `${i18n.boardGoneTitle(board)} — ${i18n.boardGoneDesc(boardsData?.current || "")}`);
    setBoard(boardsData?.current || "");
  }, [isError, error, board, boardsData]);
  useEffect3(() => {
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
  useEffect3(() => {
    const el = scrollerRef.current;
    if (el && board && hasAutoScrolledBoardRef.current !== board) {
      hasAutoScrolledBoardRef.current = board;
      el.scrollLeft = el.scrollWidth;
    }
  }, [board, derived, trackW]);
  if (isLoading && !data) {
    return jsx6("div", { className: "flex h-full items-center justify-center p-8", children: jsx6(Loader, {}) });
  }
  if (isError) {
    const gone = isMissingBoardError(error);
    return jsx6("div", { className: "p-6", children: jsx6(ErrorState, {
      title: gone ? i18n.boardMissingTitle : i18n.cannotLoadBoard,
      description: gone ? i18n.boardMissingDesc(board || boardLabel(board), boardsData?.current || "") : i18n.cannotLoadBoardDesc(base)
    }) });
  }
  if (!derived || !derived.domain) {
    return jsx6("div", { className: "p-6", children: jsx6(EmptyState, { title: i18n.emptyBoard, description: i18n.emptyBoardDesc(boardLabel(board)) }) });
  }
  void nowTick;
  const now = Date.now() / 1e3;
  const { rows, domain } = derived;
  const visibleWidth = Math.max(trackW - labelW - 24, 300);
  const baseDayWidth = visibleWidth / 7;
  const basePerSec = baseDayWidth / DAY;
  const pxPerSec = basePerSec * zoom;
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec));
  const grid = rows.map((row, idx) => jsx6(TaskRow, {
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
    showBoardBadge: isAllBoards,
    // Drop feedback only for rows that are not the dragged one.
    dragState: !dropMap || row.task.id === dragId ? null : dropMap.get(row.task.id)?.allowed ? "ok" : "no",
    onDragStartTask: handleDragStart,
    onDragEndTask: () => setDragId(null),
    onDropOn: handleDropOn,
    onToggleFold: handleToggleFold
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
  return jsxs6("div", {
    ref: containerRef,
    // No root padding: the desktop shell already insets plugin pages, and the
    // demo adds its own body padding (tests/demo.html).
    className: cn3("relative h-full flex", dockDrawer ? "flex-row gap-3" : "flex-col"),
    children: [
      // Page-header chrome: exists exactly while this page is mounted — the
      // board switcher is projected into the workspace page-header band (the
      // tab row above the page), like the official kanban plugin's switcher
      // (WORKSPACE_PAGE_HEADER_AREA, NOT titleBar.center).
      jsx6(Contribute, { area: WORKSPACE_PAGE_HEADER_AREA, id: "kanban-gantt:board-switcher", children: jsx6(TitlebarBoardSwitcher, {}) }),
      // Main column (header + chart + legend). When the drawer is docked it
      // becomes a flex sibling of this column, so the gantt shrinks to make
      // room instead of being covered. Carries the view padding (the desktop
      // shell already insets contributed pages; the demo adds its own).
      jsxs6("div", {
        className: "flex flex-col flex-1 min-h-0 min-w-0 pl-3 pr-3 py-2",
        children: [
          // Top header row: Left title + task count badge + blocked badge + filter + search, Center board switcher, Right zoom + new task
          jsxs6("div", {
            className: "flex flex-wrap items-center justify-between gap-2 mb-2",
            children: [
              // Left: Title + Task Count Badge + Blocked Badge + Filter + Search Field
              jsxs6("div", {
                className: "inline-flex items-center gap-2 text-sm font-medium",
                children: [
                  jsx6("span", { className: "font-semibold", children: i18n.title }),
                  jsx6("span", {
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
                  blockedCount > 0 ? jsxs6("span", {
                    className: "inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10.5px] font-semibold tracking-tight shadow-xs text-[#f87171] border border-[#f87171]/40 bg-[#f87171]/18 cursor-help",
                    title: i18n.nBlockedWarning(blockedCount),
                    children: [
                      jsx6(Codicon5, { name: "warning", size: "0.8rem" }),
                      jsx6("span", { children: `${blockedCount}` })
                    ]
                  }) : null,
                  jsx6(FilterDropdown, {
                    assignees: derived.allAssignees || [],
                    selectedAssignees,
                    onToggleAssignee: handleToggleAssignee,
                    onClearAssignees: handleClearAssignees,
                    disabledStatuses,
                    onToggleStatus: handleToggleStatus,
                    showArchived,
                    onToggleArchived: setShowArchived
                  }),
                  jsxs6("div", {
                    className: "inline-flex items-center gap-1.5 border-b border-transparent focus-within:border-(--ui-stroke-secondary) px-1 py-0.5 ml-1",
                    children: [
                      jsx6(Codicon5, { name: "search", size: "0.85rem", className: "text-(--ui-text-quaternary)" }),
                      jsx6("input", {
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
              jsxs6("div", {
                className: "inline-flex items-center gap-3",
                children: [
                  jsxs6("span", { className: "inline-flex items-center gap-1.5", children: [
                    jsx6("input", {
                      type: "range",
                      min: String(ZOOM_MIN),
                      max: String(ZOOM_MAX),
                      step: String(ZOOM_STEP),
                      value: String(zoom),
                      onInput: (event) => handleZoomChange(Number(event.target.value)),
                      className: "w-24",
                      "aria-label": i18n.zoomTimeline
                    }),
                    jsx6("span", { className: "text-[10px] tabular-nums text-(--ui-text-tertiary) w-8 text-right shrink-0", children: `${Math.round(zoom * 100)}%` })
                  ] }),
                  // The Refresh button is back, but only when the page is KNOWINGLY on
                  // the 60 s poll: the push is off (KANBAN_GANTT_WS=0 on the gateway, or
                  // this client's `ws` flag) or the socket gave up (it re-arms within
                  // WS_REARM_MS). While the push is live — and during the seconds it
                  // takes to connect, which resolves itself — the timeline follows on
                  // its own, so the button stays out of the way.
                  wsState === WS_STATE.off || wsState === WS_STATE.dead ? jsx6("span", {
                    title: i18n.refreshWhy,
                    children: jsx6(Button5, {
                      size: "xs",
                      onClick: () => void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] }),
                      children: jsxs6("span", { className: "flex items-center gap-1", children: [
                        jsx6(Codicon5, { name: "refresh", size: "0.85rem" }),
                        i18n.refresh
                      ] })
                    })
                  }) : null,
                  // Far right: the board's only creation verb.
                  jsx6(Button5, {
                    size: "xs",
                    variant: "default",
                    onClick: () => $newTask.set({ parentId: "" }),
                    children: jsxs6("span", { className: "flex items-center gap-1", children: [
                      jsx6(Codicon5, { name: "add", size: "0.85rem" }),
                      i18n.newTask
                    ] })
                  })
                ]
              })
            ]
          }),
          rows.length === 0 ? jsx6("div", {
            className: "py-10",
            children: jsx6(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch })
          }) : jsxs6("div", {
            className: "mt-2 border border-(--ui-stroke-tertiary) rounded-md overflow-hidden flex-1 min-h-0 flex flex-col relative",
            children: [
              jsx6(SelectionBar, {
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
              jsxs6("div", {
                ref: scrollerRef,
                className: "overflow-auto flex-1 min-h-0 relative",
                children: [
                  jsxs6("div", {
                    className: "grid w-max sticky top-0 z-20 bg-(--ui-bg-chrome)",
                    "data-glass-opaque": true,
                    style: { gridTemplateColumns: `${labelW}px ${timelineW}px` },
                    children: [
                      jsxs6("div", {
                        className: "sticky left-0 z-30 bg-(--ui-bg-chrome) border-r border-b border-(--ui-stroke-tertiary) flex items-center pr-2 gap-1.5",
                        "data-glass-opaque": true,
                        style: {
                          height: pxPerSec * DAY >= 50 && tickUnit(domain.max - domain.min) === "day" ? "32px" : "24px",
                          paddingLeft: `${TREE_INSET}px`
                        },
                        children: [
                          // The tree's global toggle: at the head of the column and IN
                          // FRONT OF the master checkbox, in the same 13px slot a root's
                          // fold square occupies — so the column reads as one affordance
                          // and the master checkbox lines up with the rows' checkboxes.
                          jsx6("span", {
                            role: "button",
                            tabIndex: 0,
                            "aria-label": anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                            title: anyBranchOpen ? i18n.collapseAll : i18n.expandAll,
                            className: cn3(
                              "shrink-0 inline-flex items-center justify-center cursor-pointer select-none",
                              "text-[10px] leading-none font-semibold",
                              "text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
                            ),
                            style: {
                              width: "13px",
                              height: "13px",
                              border: "1px solid var(--ui-stroke-secondary)",
                              borderRadius: "3px",
                              backgroundColor: "var(--ui-bg-tertiary, transparent)"
                            },
                            onClick: handleToggleAll,
                            children: anyBranchOpen ? "−" : "+"
                          }),
                          jsx6("input", {
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
                          jsx6("span", { className: "text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none", children: i18n.tasksColumn }),
                          jsx6(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: (w) => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: "labelW"
                          })
                        ]
                      }),
                      jsx6(Ruler, { min: domain.min, max: domain.max, pxPerSec })
                    ]
                  }),
                  jsxs6("div", {
                    className: "relative flex flex-col w-max",
                    children: [
                      jsx6("div", {
                        className: "absolute top-0 bottom-0 pointer-events-none z-0",
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: jsx6(WeekendBands, { min: domain.min, max: domain.max, pxPerSec })
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),
          jsx6("div", {
            children: jsx6(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus })
          })
        ]
      }),
      openTaskId ? jsx6(TaskDrawer, {
        taskId: openTaskId,
        board,
        assignees: derived.allAssignees || [],
        // Unfiltered snapshot: a parent hidden by the current filter must
        // still be listed in the drawer's relations.
        tasks: data?.tasks || [],
        // Every known board — the cross-board move dialog filters out the
        // current one itself.
        boards: boardsData?.boards || [],
        onClose: () => $openTaskId.set(null),
        docked: dockDrawer,
        onToggleDock: () => {
          const next = !drawerDocked;
          $drawerDocked.set(next);
          if (getStorage()) getStorage().set("drawerDocked", next ? "1" : "0");
        }
      }) : null,
      // Creation dialog (toolbar button, or "create a sub-task" from a task).
      jsx6(NewTaskDialog, {
        open: Boolean(newTask),
        boardSlug: board && board !== "all" && board !== "*" ? board : void 0,
        assignees: (() => {
          const fromBoard = derived && derived.allAssignees || [];
          const fromProfiles = profilesData && profilesData.profiles || [];
          return Array.from(/* @__PURE__ */ new Set([...fromProfiles, ...fromBoard])).sort();
        })(),
        tasks: data && data.tasks || [],
        projects: projectsData && projectsData.projects || [],
        defaultParentId: newTask ? newTask.parentId : "",
        busy: createTaskMutation.isPending,
        onSubmit: (values) => createTaskMutation.mutate(values),
        onClose: () => $newTask.set(null),
        i18n
      }),
      // Asked only when the dropped task already has parents: add vs replace.
      jsx6(ReparentChoiceDialog, {
        open: Boolean(pendingReparent),
        targetTitle: (() => {
          if (!pendingReparent) return "";
          const target = allTasks.find((t) => t.id === pendingReparent.parentId);
          return target ? target.title : pendingReparent.parentId;
        })(),
        parents: pendingReparent ? relationsOf(allTasks, pendingReparent.childId).parents : [],
        busy: reparentMutation.isPending || unlinkMutation.isPending,
        onAdd: () => reparentMutation.mutate({ ...pendingReparent, mode: "add" }),
        onReplace: () => reparentMutation.mutate({ ...pendingReparent, mode: "replace" }),
        onRemoveParent: (parentId) => unlinkMutation.mutate({ childId: pendingReparent.childId, parentId }),
        onClose: () => setPendingReparent(null),
        i18n
      }),
      // "Move under…" picker (drawer action menu): the whole board, refusals
      // greyed with their reason rather than hidden.
      jsx6(MoveUnderDialog, {
        open: Boolean(moveUnderId),
        draggedTitle: (() => {
          const task = moveUnderId ? allTasks.find((t) => t.id === moveUnderId) : null;
          return task ? task.title : moveUnderId || "";
        })(),
        candidates: moveUnderId ? dropCandidates(allTasks, moveUnderId, boardOf(moveUnderId)) : [],
        busy: reparentMutation.isPending,
        onPick: handlePickParent,
        onClose: () => $moveUnderId.set(null),
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
    setPluginDoors(ctx.rest, ctx.storage, ctx.socket);
    $baseUrl.set((ctx.storage.get("baseUrl", "") || "").replace(/\/+$/, ""));
    $boardSlug.set(readStoredBoard(ctx.storage));
    $connectionScope.set(connectionScope());
    try {
      const conn = host && host.state && host.state.connectionId;
      if (conn && typeof conn.listen === "function" && typeof ctx.onDispose === "function") {
        ctx.onDispose(conn.listen(() => {
          $connectionScope.set(connectionScope());
          $boardSlug.set(readStoredBoard(ctx.storage));
        }));
      }
    } catch {
    }
    const wsFlag = ctx.storage.get("ws", "1");
    $wsEnabled.set(!(wsFlag === "0" || wsFlag === 0 || wsFlag === false || wsFlag === "false"));
    $labelW.set(Number(ctx.storage.get("labelW", LABEL_W)) || LABEL_W);
    $drawerW.set(Number(ctx.storage.get("drawerW", 416)) || 416);
    $drawerDocked.set(ctx.storage.get("drawerDocked", "0") === "1");
    if (ctx.i18n && typeof ctx.i18n.register === "function") {
      ctx.i18n.register(GANTT_LOCALES);
    }
    const tNow = (key) => ctx.i18n && typeof ctx.i18n.t === "function" ? ctx.i18n.t(key) : GANTT_LOCALES.en[key];
    if (!document.getElementById("kg-handle-style")) {
      const handleStyle = document.createElement("style");
      handleStyle.id = "kg-handle-style";
      handleStyle.textContent = `
.kg-resize-handle { display: flex; align-items: stretch; justify-content: center; }
/* Same two layers the shell's own sash draws (measured on the left panel's
   resizer): a 1px line in --ui-stroke-secondary sitting at 10% opacity at rest,
   and a 4px bar in --ui-sash-hover-border — the dedicated sash token, which
   already carries its own alpha — revealed on hover. Both tokens are theme
   values, so the affordance follows the active theme instead of a hard colour. */
.kg-resize-rest, .kg-resize-pill {
  position: absolute; inset-block: 0; left: 50%; transform: translateX(-50%);
  border-radius: 9999px; transition: opacity 120ms ease;
}
.kg-resize-rest { width: 1px; background: var(--ui-stroke-secondary); opacity: 0.1; }
/* Geometry comes from the same variable the shell's own sash reads
   (w-(--vscode-sash-hover-size,0.25rem) on its hover layer), so a style that
   resizes its separators resizes ours too instead of leaving 4px hard-coded. The
   colour chain ends on the app's accent so a renamed token degrades to a visible
   bar rather than to nothing (the plugin has already been bitten once by the
   --ui-background to --ui-base rename). */
.kg-resize-pill {
  width: var(--vscode-sash-hover-size, 0.25rem);
  background: var(--ui-sash-hover-border, var(--ui-accent, var(--accent)));
  opacity: 0;
}
.kg-resize-handle:hover .kg-resize-rest,
.kg-resize-handle:focus-visible .kg-resize-rest,
.kg-resize-handle[data-dragging='true'] .kg-resize-rest { opacity: 1; }
.kg-resize-handle:hover .kg-resize-pill,
.kg-resize-handle:focus-visible .kg-resize-pill,
.kg-resize-handle[data-dragging='true'] .kg-resize-pill { opacity: 1; }
`;
      document.head.appendChild(handleStyle);
    }
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
        render: () => jsx6(KanbanGanttPage, {})
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
