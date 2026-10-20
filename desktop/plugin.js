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
  Dialog as Dialog4,
  DialogContent as DialogContent4,
  DialogTitle as DialogTitle4,
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
  MessageTextContent,
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
var $detailModal = atom(false);
var $titlePrefixTags = atom(false);
var $openAttachment = atom(null);
var LABEL_W_MIN = 160;
var LABEL_W_MAX = 640;
var DRAWER_W_MIN = 320;
var DRAWER_W_MAX = 720;
var $openBoards = atom([]);
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
    openInModal: "Open the detail in a modal window",
    dockDetail: "Dock the detail beside the gantt",
    detailMeta: "Information",
    metaStatus: "Status",
    metaPriority: "Priority",
    metaAssignee: "Assignee",
    metaWorkspace: "Workspace",
    metaCreated: "Created",
    metaLastActivity: "Last activity",
    attachments: (n) => `Attachments (${n})`,
    noAttachments: "No attachments",
    downloadAttachment: (name) => `Download ${name}`,
    previewMarkdown: (name) => `Preview ${name}`,
    previewTitle: (name) => `Preview — ${name}`,
    previewFailed: "Could not read this attachment.",
    previousAttachment: "Previous attachment",
    nextAttachment: "Next attachment",
    attachmentPosition: (i, n) => `${i} of ${n}`,
    closeWindow: "Close",
    filterCards: "Filter cards…",
    zoomTimeline: "Zoom timeline",
    zoomWheelHint: (mod) => `${mod}+wheel over the timeline: zoom · Wheel alone: scroll · Double-click the ruler: reset`,
    nowMarker: "Now",
    untitled: "Untitled",
    viewOptions: "View options",
    titlePrefixTags: "Show title prefixes as tags",
    titlePrefixTagsHint: "A leading [EPIC] becomes a chip — the title itself is always shown as written",
    periodLabel: "Period shown",
    periodShow: "Keep the last",
    period6h: "6 h",
    period12h: "12 h",
    period24h: "24 h",
    period3d: "3 d",
    period7d: "7 d",
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
    filterWithAttachments: "Only tasks with attachments",
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
    // The tab labels, WITHOUT the count: the count is a badge beside them, so a reader
    // sees "Comments 3" rather than parsing a number out of a sentence.
    tabComments: "Comments",
    tabActivity: "Activity",
    tabRuns: "Runs",
    action: "Action:",
    copyTaskId: "Copy task id",
    copyTitle: "Copy title",
    cli: "CLI",
    copyCommand: "Copy command",
    copied: "Copied",
    moveToShort: "Move to",
    unassignAction: "Unassign",
    bulkFailed: (n, why) => `${n} task${n > 1 ? "s" : ""} not updated: ${why}`,
    delete: "Delete",
    confirmDelete: (id) => `Permanently delete task ${id}?`,
    taskDetail: "Task detail",
    actionsMenu: "Actions menu",
    close: "Close",
    selectAll: "Select all",
    selectTask: (name) => `Select ${name}`,
    tasksColumn: "Tasks",
    assigneeColumn: "Assignee",
    statusColumn: "Status",
    lastActivityColumn: "Updated",
    viewList: "List",
    viewTimeline: "Timeline",
    // The third view: dependency structure rather than time.
    viewGraph: "Graph",
    graphScopeAll: "All",
    graphScopeOpen: "Open",
    graphScopeRunning: "Running + lineage",
    graphScopeAria: "Which tasks the graph shows",
    graphZoom: "Graph zoom",
    graphHint: "Click to open · double-click to add a child · drag a task NEAR another to re-parent it (the nearest one is picked)",
    graphImplied: (n) => `${n} implied link${n > 1 ? "s" : ""} hidden`,
    graphCyclic: (n) => `${n} task${n > 1 ? "s" : ""} in a dependency loop`,
    graphDangling: (n) => `${n} link${n > 1 ? "s" : ""} to a task outside this view`,
    graphSparkline: (n) => `Activity over the last ${n} h`,
    graphNoActivity: "No activity in this window",
    graphTally: (n) => `${n} task${n === 1 ? "" : "s"}`,
    graphFit: "Fit",
    graphFitOn: "Fit — the view keeps framing itself while the pane resizes",
    cardsTall: "Taller cards, full titles",
    cardsTallHint: "Two lines, wrapped, instead of one cut line",
    openBoard: "Open another board",
    closeBoard: "Close this board tab",
    noOtherBoards: "Every board is already open",
    boardsTabs: "Open boards",
    graphNoActivityWindow: (n) => `No activity in the last ${n} h — the band lights up as soon as there is some`,
    graphHiddenByScope: (n) => `${n} task${n > 1 ? "s" : ""} hidden by this scope`,
    // Suffixes for the list's "updated" cell, concatenated to the number.
    relativeUnits: { now: "now", m: "m", h: "h", d: "d", w: "w", mo: "mo", y: "y" },
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
    openInModal: "Ouvrir le détail dans une fenêtre modale",
    dockDetail: "Ancrer le détail à côté du gantt",
    detailMeta: "Informations",
    metaStatus: "Statut",
    metaPriority: "Priorité",
    metaAssignee: "Assigné à",
    metaWorkspace: "Espace de travail",
    metaCreated: "Créée",
    metaLastActivity: "Dernière activité",
    attachments: (n) => `Pièces jointes (${n})`,
    noAttachments: "Aucune pièce jointe",
    downloadAttachment: (name) => `Télécharger ${name}`,
    previewMarkdown: (name) => `Afficher ${name}`,
    previewTitle: (name) => `Aperçu — ${name}`,
    previewFailed: "Impossible de lire cette pièce jointe.",
    previousAttachment: "Pièce jointe précédente",
    nextAttachment: "Pièce jointe suivante",
    attachmentPosition: (i, n) => `${i} sur ${n}`,
    closeWindow: "Fermer",
    filterCards: "Filtrer les tâches…",
    zoomTimeline: "Zoom timeline",
    zoomWheelHint: (mod) => `${mod}+molette sur la chronologie : zoom · Molette seule : défilement · Double-clic sur la règle : réinitialiser`,
    nowMarker: "Maintenant",
    untitled: "Sans titre",
    viewOptions: "Options d'affichage",
    titlePrefixTags: "Afficher les préfixes des titres sous forme de tag",
    titlePrefixTagsHint: "Un préfixe « [EPIC] » devient une pastille — le titre lui-même reste affiché tel quel",
    periodLabel: "Période affichée",
    periodShow: "Garder les dernières",
    period6h: "6 h",
    period12h: "12 h",
    period24h: "24 h",
    period3d: "3 j",
    period7d: "7 j",
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
    filterWithAttachments: "Seulement les tâches avec pièces jointes",
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
    // Les libellés SANS le compte : le compte est un badge à côté.
    tabComments: "Commentaires",
    tabActivity: "Activité",
    tabRuns: "Exécutions",
    action: "Action :",
    copyTaskId: "Copier l’ID de tâche",
    copyTitle: "Copier le titre",
    cli: "CLI",
    copyCommand: "Copier la commande",
    copied: "Copié",
    moveToShort: "Déplacer",
    unassignAction: "Désassigner",
    bulkFailed: (n, why) => `${n} tâche${n > 1 ? "s" : ""} non mise${n > 1 ? "s" : ""} à jour : ${why}`,
    delete: "Supprimer",
    confirmDelete: (id) => `Supprimer définitivement la tâche ${id} ?`,
    taskDetail: "Détail de la tâche",
    actionsMenu: "Menu actions",
    close: "Fermer",
    selectAll: "Tout sélectionner",
    selectTask: (name) => `Sélectionner ${name}`,
    tasksColumn: "Tâches",
    assigneeColumn: "Assigné à",
    statusColumn: "Statut",
    lastActivityColumn: "Mis à jour",
    viewList: "Liste",
    viewTimeline: "Chronologie",
    viewGraph: "Graphe",
    graphScopeAll: "Tous",
    graphScopeOpen: "Ouverts",
    graphScopeRunning: "En cours + lignée",
    graphScopeAria: "Quelles tâches le graphe montre",
    graphZoom: "Zoom du graphe",
    graphHint: "Clic pour ouvrir · double-clic pour ajouter un enfant · glisser une tâche À PROXIMITÉ d’une autre pour la re-parentaliser (la plus proche est retenue)",
    graphImplied: (n) => `${n} lien${n > 1 ? "s" : ""} implicite${n > 1 ? "s" : ""} masqué${n > 1 ? "s" : ""}`,
    graphCyclic: (n) => `${n} tâche${n > 1 ? "s" : ""} dans une boucle de dépendance`,
    graphDangling: (n) => `${n} lien${n > 1 ? "s" : ""} vers une tâche hors de cette vue`,
    graphSparkline: (n) => `Activité sur les ${n} dernières heures`,
    graphNoActivity: "Aucune activité dans cette fenêtre",
    graphTally: (n) => `${n} tâche${n === 1 ? "" : "s"}`,
    graphFit: "Ajuster",
    graphFitOn: "Ajuster — la vue se recadre toute seule quand le panneau change de taille",
    cardsTall: "Cartes plus hautes, titres entiers",
    cardsTallHint: "Deux lignes avec retour à la ligne, au lieu d’une ligne tronquée",
    openBoard: "Ouvrir un autre board",
    closeBoard: "Fermer cet onglet de board",
    noOtherBoards: "Tous les boards sont déjà ouverts",
    boardsTabs: "Boards ouverts",
    graphNoActivityWindow: (n) => `Aucune activité sur les ${n} dernières heures — la bande s'allume dès qu'il y en a`,
    graphHiddenByScope: (n) => `${n} tâche${n > 1 ? "s" : ""} masquée${n > 1 ? "s" : ""} par ce filtre`,
    // Suffixes concaténés au nombre (« 5min », « 2 j »… l'espace est inclus).
    relativeUnits: { now: "à l'instant", m: "min", h: "h", d: " j", w: " sem", mo: " mois", y: " a" },
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
  },
  zh: {
    title: "看板甘特图",
    nav: "看板甘特图",
    untitled: "无标题",
    viewOptions: "视图选项",
    titlePrefixTags: "将标题前缀显示为标签",
    titlePrefixTagsHint: "开头的 [EPIC] 会显示为标签——标题本身始终按原样显示",
    periodLabel: "显示时段",
    periodShow: "保持最近",
    period6h: "6 小时",
    period12h: "12 小时",
    period24h: "24 小时",
    period3d: "3 天",
    period7d: "7 天",
    openCommand: "看板甘特图：打开时间线视图",
    refresh: "刷新",
    refreshWhy: "此网关或客户端的实时更新已关闭，页面改用 60 秒轮询——可立即刷新，无需等待。",
    backend: "后端：",
    allBoards: "全部看板",
    board: "看板：",
    noBoard: "无看板",
    dockDrawer: "将详情面板固定在甘特图旁",
    undockDrawer: "取消固定详情面板",
    openInModal: "在模态窗口中打开详情",
    dockDetail: "将详情固定在甘特图旁",
    detailMeta: "信息",
    metaStatus: "状态：",
    metaPriority: "优先级：",
    metaAssignee: "负责人",
    metaWorkspace: "工作区",
    metaCreated: "创建时间",
    metaLastActivity: "最近活动",
    attachments: (n) => `附件（${n}）`,
    noAttachments: "无附件",
    downloadAttachment: (name) => `下载 ${name}`,
    previewMarkdown: (name) => `预览 ${name}`,
    previewTitle: (name) => `预览 — ${name}`,
    previewFailed: "无法读取该附件。",
    previousAttachment: "上一个附件",
    nextAttachment: "下一个附件",
    attachmentPosition: (i, n) => `第 ${i} / ${n}`,
    closeWindow: "关闭",
    filterCards: "筛选任务…",
    zoomTimeline: "时间线缩放",
    zoomWheelHint: (mod) => `${mod}+滚轮：缩放 · 单独滚动：滚动 · 双击标尺：重置`,
    nowMarker: "现在",
    nothingToDisplay: "暂无可显示内容",
    noTasksMatch: "没有任务符合搜索或筛选条件。",
    emptyBoard: "无数据",
    emptyBoardDesc: (board) => `看板 ${board} 没有任务。`,
    cannotLoadBoard: "无法加载看板",
    cannotLoadBoardDesc: (base) => `后端 kanban-gantt 无法访问${base ? `（${base}）` : ""} —— 插件已启用？网关已重启？`,
    boardGoneTitle: (slug) => `看板 ${slug} 不在此网关上`,
    boardGoneDesc: (next) => next ? `改为显示 ${next} —— 该看板是另一个网关记住的。` : `改为显示此网关的当前看板。`,
    boardMissingTitle: "该看板不在此网关上",
    boardMissingDesc: (slug, next) => next ? `看板 ${slug} 在此不存在。此网关的当前看板是 ${next}。` : `看板 ${slug} 不在此网关上。`,
    taskUnreadable: "任务信息不可读",
    taskUnreadableDesc: "后端没有响应。",
    nTasksTotal: (n, status) => `共 ${n} 个任务（主要状态：${status}）`,
    nBlockedWarning: (n) => `${n} 个任务被阻塞（需要处理）`,
    nSelected: (n) => `已选 ${n} 项`,
    statusLabel: "状态：",
    assignLabel: "指派：",
    assignPlaceholder: "执行者…",
    clearSelection: "清除选择（Esc）",
    filters: "筛选",
    profiles: "执行者",
    allProfiles: "全部执行者",
    statuses: "状态",
    showArchived: "显示已归档",
    filterWithAttachments: "仅显示有附件的任务",
    unassigned: "未指派",
    unassignedEmpty: "未指派（空）",
    reassigned: "（已改派）",
    dependencies: "依赖：",
    description: "描述",
    editDescription: "编辑描述",
    cancelEdit: "取消编辑",
    save: "保存",
    noDescription: "无描述",
    unsavedDescTitle: "描述未保存",
    unsavedDescBody: "你修改了此描述但尚未保存。是否先保存再打开另一个任务？",
    saveAndOpen: "保存并打开",
    keepEditing: "继续编辑",
    discardChanges: "放弃修改",
    result: "结果",
    latestSummary: "最新摘要",
    runs: (n) => `运行记录（${n}）`,
    show: "展开",
    hide: "收起",
    comments: (n) => `评论（${n}）`,
    showPreviousComments: (n) => `显示前 ${n} 条评论`,
    addCommentPlaceholder: "添加评论…",
    send: "发送",
    activity: (n) => `活动（${n}）`,
    tabComments: "评论",
    tabActivity: "活动",
    tabRuns: "运行记录",
    action: "操作：",
    copyTaskId: "复制任务 ID",
    copyTitle: "复制标题",
    cli: "CLI",
    copyCommand: "复制命令",
    copied: "已复制",
    moveToShort: "移动到",
    unassignAction: "取消指派",
    bulkFailed: (n, why) => `${n} 个任务未更新：${why}`,
    delete: "删除",
    confirmDelete: (id) => `永久删除任务 ${id}？`,
    taskDetail: "任务详情",
    actionsMenu: "操作菜单",
    close: "关闭",
    selectAll: "全选",
    selectTask: (name) => `选择 ${name}`,
    tasksColumn: "任务",
    assigneeColumn: "负责人",
    statusColumn: "状态：",
    lastActivityColumn: "已更新",
    viewList: "列表",
    viewTimeline: "时间线",
    viewGraph: "关系图",
    graphScopeAll: "全部",
    graphScopeOpen: "未完成",
    graphScopeRunning: "进行中 + 血缘",
    graphScopeAria: "关系图显示哪些任务",
    graphZoom: "关系图缩放",
    graphHint: "单击打开 · 双击添加子任务 · 将任务拖到另一个任务附近即可更改父任务（自动选择最近的一个）",
    graphImplied: (n) => `已隐藏 ${n} 条隐含链接`,
    graphCyclic: (n) => `${n} 个任务处于依赖环中`,
    graphDangling: (n) => `${n} 条链接指向此视图外的任务`,
    graphSparkline: (n) => `最近 ${n} 小时的活动`,
    graphNoActivity: "此时间窗口内无活动",
    graphTally: (n) => `${n} 个任务`,
    graphFit: "适应",
    graphFitOn: "适应 —— 面板尺寸变化时自动重新取景",
    cardsTall: "更高的卡片，完整标题",
    cardsTallHint: "两行自动换行，而不是截断的一行",
    openBoard: "打开另一个看板",
    closeBoard: "关闭此看板标签页",
    noOtherBoards: "所有看板均已打开",
    boardsTabs: "已打开的看板",
    graphNoActivityWindow: (n) => `最近 ${n} 小时内无活动 —— 一旦有活动该条带就会亮起`,
    graphHiddenByScope: (n) => `此筛选隐藏了 ${n} 个任务`,
    relativeUnits: { now: "刚刚", m: "分", h: "小时", d: "天", w: "周", mo: "个月", y: "年" },
    clickForDetail: "点击查看详情",
    legendShow: (label) => `点击显示 ${label}`,
    legendHide: (label) => `点击隐藏 ${label}`,
    barDoneReal: (name) => `${name} · 已完成（实际时长）`,
    barDoneUnknown: (name) => `${name} · 已完成（时长未知）`,
    barRunning: (name) => `${name} · 运行中`,
    barBlockedWaiting: (name) => `${name} · 已阻塞 —— 等待处理`,
    barNotStarted: (name) => `${name} · 未开始`,
    copyHint: (id) => `${id} —— 点击 [...] 复制`,
    parents: "父任务",
    children: "子任务",
    noParents: "无父任务",
    noChildren: "无子任务",
    removeParentLink: (title) => `移除与 ${title} 的关联`,
    openTask: (title) => `打开 ${title}`,
    reparentTitle: (n) => `此任务已有 ${n} 个父任务。你想怎么做？`,
    reparentCurrent: "当前父任务",
    reparentTarget: (title) => `新父任务：${title}`,
    moveUnderTitle: (title) => `将 ${title} 移动到…之下`,
    reasonLinked: "已是父任务",
    reparentAdd: "新增一个父任务",
    reparentReplace: "替换为这一个父任务",
    removeParentConfirmTitle: (title) => `移除与 ${title} 的关联？`,
    removeParentConfirmDesc: "只移除这一条父子关系，任务的其他关联保持不变。",
    cancel: "取消",
    moveUnder: "移动到…之下",
    moveUnderSearch: "搜索任务…",
    moveUnderEmpty: "没有匹配的任务",
    movedUnder: (child, parent) => `${child} 已移动到 ${parent} 之下`,
    gatedNotice: (child) => `${child} 已退回待办：它的新父任务尚未完成。`,
    errSelf: "任务不能移动到自身之下。",
    errCycle: "该移动会造成循环。",
    errRunning: "正在运行的任务不能移动到其他任务之下。",
    errOtherBoard: "两个任务必须属于同一个看板。",
    errReparent: "看板拒绝了该移动。",
    expandTask: (name) => `展开 ${name}`,
    collapseTask: (name) => `折叠 ${name}`,
    expandTaskHidden: (name, n) => `展开 ${name}（隐藏 ${n} 项）`,
    collapseAll: "全部折叠",
    expandAll: "全部展开",
    newTask: "新建任务",
    newTaskTitle: "标题",
    newTaskTitlePlaceholder: "需要完成什么？",
    newTaskPriority: "优先级",
    newTaskParent: "父任务",
    newTaskNoParent: "无父任务",
    newTaskTriage: "退回分诊",
    newTaskDescriptionPlaceholder: "描述（可选）…",
    newTaskProject: "项目",
    newTaskNoProject: "无项目",
    newTaskWorkspace: "工作区",
    newTaskWorkspacePath: "工作区路径",
    newTaskWorkspaceInherit: "继承看板/项目目录",
    newTaskWorkspaceInheritHint: "留空则继承看板或项目目录。",
    newTaskSkills: "技能（逗号分隔）",
    newTaskSkillsPlaceholder: "skill-a, skill-b",
    newTaskModel: "模型",
    newTaskModelInherit: "配置默认",
    newTaskModelHint: "指定运行该任务的模型；留空则使用负责人配置的模型。",
    newTaskGoalMode: "目标模式",
    newTaskProjectSearch: "搜索项目…",
    newTaskParentSearch: "搜索任务…",
    newTaskNoMatch: "无匹配",
    create: "创建",
    creating: "创建中…",
    createSubtask: "创建子任务",
    moveToBoard: "移动到其他看板",
    movePickBoard: "选择目标看板…",
    moveNoOtherBoards: "没有其他可用看板——请先创建一个。",
    moving: "移动中…",
    moveConfirm: "移动",
    moveWithChildren: (n) => `此任务有 ${n} 个子任务 —— 它们会一起移动。`,
    moveNoChildren: "无子任务——任务将单独移动。",
    confirmMove: (title, board) => `将「${title}」移动到看板「${board}」？`,
    confirmMoveChildren: (n) => `是否也移动 ${n} 个子任务？它们必须随父任务一起移动。`,
    moveChildrenBlock: "无法在不移动子任务的情况下移动任务——请先把子任务改挂到其他父任务（或删除），然后再移动。",
    confirmMoveParentLoss: (n) => `此任务在当前看板上有 ${n} 个父任务。移动后它将没有父任务。确定吗？`,
    movedTo: (board) => `已移动到看板「${board}」✔`,
    created: (title) => `任务「${title}」已创建`,
    errTitleRequired: "标题为必填项。",
    errCreate: "任务创建失败。",
    col: {
      triage: "待分类",
      todo: "待办",
      scheduled: "已排期",
      ready: "就绪",
      running: "运行中",
      blocked: "已阻塞",
      review: "待评审",
      done: "已完成",
      archived: "已归档"
    },
    actions: {
      done: "完成",
      blocked: "阻塞",
      unblock: "解除阻塞",
      review: "请求评审",
      reopen: "重新打开",
      archive: "归档",
      ready: "标记为就绪",
      todo: "标记为待办",
      triage: "送入待分类",
      delete: "删除",
      restore: "恢复"
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
  blocked: "#e0a13a",
  review: "#f472b6",
  done: "var(--ui-text-tertiary)",
  archived: "var(--ui-text-quaternary)"
};
function statusTone(status) {
  return STATUS_TONE[status] || "var(--ui-text-secondary)";
}
var HARD_FAILURES = ["crashed", "failed", "spawn_failed", "gave_up"];
var FAIL_TONE = "#ef5350";
var RUN_TONE = "#5b8def";
function runTone(outcome, ongoing) {
  if (ongoing) return statusTone("running");
  const o = String(outcome || "").toLowerCase();
  if (HARD_FAILURES.includes(o)) return FAIL_TONE;
  if (o === "blocked") return statusTone("blocked");
  if (o === "completed" || o === "done") return statusTone("done");
  return RUN_TONE;
}
function hourTickPlan(pxPerHour, minLabelPx = 56) {
  if (!(pxPerHour >= 24)) return null;
  const step = [1, 2, 3, 6, 12].find((s) => s * pxPerHour >= minLabelPx) || 12;
  return { step };
}
function maxZoom(basePerSec, maxPxPerHour = 240) {
  const perHour = basePerSec * 3600;
  if (!(perHour > 0)) return 1;
  return Math.max(1, maxPxPerHour / perHour);
}
function clampZoom(zoom, basePerSec, maxPxPerHour = 240) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(maxZoom(basePerSec, maxPxPerHour), Math.max(0.2, zoom));
}
var ZOOM_PCT_MIN = 1;
var ZOOM_PCT_MAX = 100;
function clampZoomPct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return ZOOM_PCT_MIN;
  return Math.min(ZOOM_PCT_MAX, Math.max(ZOOM_PCT_MIN, Math.round(p)));
}
function zoomFactorFromPct(pct, minFactor, maxFactor) {
  const lo = Math.max(1e-9, minFactor);
  const hi = Math.max(lo, maxFactor);
  const span = ZOOM_PCT_MAX - ZOOM_PCT_MIN;
  return lo * Math.pow(hi / lo, (clampZoomPct(pct) - ZOOM_PCT_MIN) / span);
}
function zoomPctFromFactor(factor, minFactor, maxFactor) {
  const lo = Math.max(1e-9, minFactor);
  const hi = Math.max(lo, maxFactor);
  const step = Math.log(hi / lo);
  if (!(step > 0)) return ZOOM_PCT_MIN;
  const read = Math.log(Math.max(1e-9, factor) / lo) / step;
  return clampZoomPct(ZOOM_PCT_MIN + read * (ZOOM_PCT_MAX - ZOOM_PCT_MIN));
}
var PREVIEW_BY_EXTENSION = [
  [["md", "markdown"], "markdown"],
  [[
    "txt",
    "log",
    "json",
    "csv",
    "tsv",
    "yml",
    "yaml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "sh",
    "bash",
    "zsh",
    "py",
    "js",
    "mjs",
    "ts",
    "tsx",
    "rs",
    "go",
    "java",
    "sql",
    "diff",
    "patch"
  ], "text"],
  [["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"], "image"],
  [["svg"], "image"],
  [["pdf"], "pdf"],
  [["html", "htm"], "html"]
];
function hasAttachments(task) {
  return Number(task && task.attachment_count || 0) > 0;
}
function neighbourId(ids, current, step) {
  const list = ids || [];
  const at = list.indexOf(current);
  if (at < 0 || !step) return null;
  const next = at + step;
  if (next < 0 || next >= list.length) return null;
  return list[next];
}
function wheelIntent(event) {
  if (event.ctrlKey || event.metaKey) return "zoom";
  if (event.shiftKey) return "pan";
  return "scroll";
}
function previewKind(filename, contentType) {
  const name = String(filename || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  for (const [extensions, kind] of PREVIEW_BY_EXTENSION) {
    if (extensions.includes(ext)) return kind;
  }
  const mime = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown") return "markdown";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return null;
}
function attachmentMime(filename, contentType) {
  switch (previewKind(filename, contentType)) {
    case "markdown":
      return "text/markdown";
    case "text":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    // Only the sandboxed branch renders this kind, and the frame is what keeps it inert.
    case "html":
      return "text/html";
    case "image": {
      const name = String(filename || "").toLowerCase();
      if (name.endsWith(".svg")) return "image/svg+xml";
      if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
      if (name.endsWith(".gif")) return "image/gif";
      if (name.endsWith(".webp")) return "image/webp";
      return "image/png";
    }
    default:
      return "application/octet-stream";
  }
}
function nowOffset(now, min, max, pxPerSec) {
  if (!(now >= min && now <= max)) return null;
  return Math.round((now - min) * pxPerSec);
}
function wheelZoomFactor(deltaY, deltaMode = 0) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  const factor = Math.exp(-(deltaY * unit) / 400);
  return Math.min(1.4, Math.max(1 / 1.4, factor));
}
var PERIODS = [6 * 3600, 12 * 3600, 24 * 3600, 3 * DAY, 7 * DAY];
var PERIOD_TOLERANCE = 6 * 3600;
function periodPxPerSec(span, clientWidth, labelW) {
  const width = clientWidth - labelW;
  if (!(span > 0) || !(width > 0)) return null;
  return width / span;
}
function periodScrollLeft({ from, to, min, pxPerSec, clientWidth, labelW }) {
  if (!(pxPerSec > 0) || !(clientWidth > 0)) return null;
  return Math.max(0, Math.round(labelW + (to - min) * pxPerSec - clientWidth));
}
function visibleWindow({ min, pxPerSec, scrollLeft, clientWidth, labelW }) {
  if (!(pxPerSec > 0)) return null;
  return {
    from: min + scrollLeft / pxPerSec,
    to: min + (scrollLeft + clientWidth - labelW) / pxPerSec
  };
}
function matchPeriod(visible, now, tolerance = PERIOD_TOLERANCE, periods = PERIODS) {
  if (!visible || !Number.isFinite(visible.from) || !Number.isFinite(visible.to)) return null;
  let best = null;
  let bestGap = Infinity;
  for (const span of periods) {
    const sizeGap = Math.abs(visible.to - visible.from - span);
    const edgeGap = Math.abs(now - visible.to);
    if (sizeGap > tolerance || edgeGap > tolerance) continue;
    const gap = sizeGap + edgeGap;
    if (gap < bestGap) {
      bestGap = gap;
      best = span;
    }
  }
  return best;
}
function nowLineX(now, min, max, pxPerSec, originX = 0) {
  const offset = nowOffset(now, min, max, pxPerSec);
  return offset == null ? null : originX + offset;
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
        tone: runTone(r.outcome || r.status),
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
      const tone = runTone(r.outcome || r.status, isOngoing);
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
  return /database not found|does not exist|no such board|is not this board's own database/i.test(String(message));
}
function shortId(id) {
  return (id || "").replace(/^t_/, "").slice(0, 6);
}
function splitTitlePrefix(title) {
  const text = typeof title === "string" ? title.trim() : "";
  if (!text.startsWith("[")) return { prefix: null, rest: text };
  const end = text.indexOf("]");
  if (end < 2) return { prefix: null, rest: text };
  const prefix = text.slice(1, end).trim();
  if (!prefix) return { prefix: null, rest: text };
  return { prefix, rest: text.slice(end + 1).trim() };
}
function matchesSearch(task, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const label = (task.label || "").toLowerCase();
  const title = (task.title || "").toLowerCase();
  const id = (task.id || "").toLowerCase();
  return label.includes(q) || title.includes(q) || id.includes(q) || q.startsWith("t_") && id.startsWith(q) || id.startsWith(`t_${q}`);
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
  const walk = (id, depth, isChild, secondary, cont, hasFollowing, parent) => {
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
      parentId: parent || null,
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
      walk(c, depth + 1, true, isSecondary, [...cont, hasFollowing], !isLast, id);
    });
  };
  for (const t of tasks) {
    if (hasParent.has(t.id) || shown.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, false, false, [], false, null);
  }
  for (const t of tasks) {
    if (shown.has(t.id) || covered.has(t.id)) continue;
    shown.add(t.id);
    walk(t.id, 0, hasParent.has(t.id), false, [], false, null);
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
function lastActivity(task) {
  const stamps = [task.completed_at, task.run_ended_at, task.run_started_at, task.started_at, task.created_at];
  for (const run of task.runs || []) stamps.push(run.ended_at, run.started_at);
  const valid = stamps.filter((s) => typeof s === "number" && s > 0);
  return valid.length ? Math.max(...valid) : null;
}
function relativeAge(ts, now, units = {}) {
  const u = { now: "now", m: "m", h: "h", d: "d", w: "w", mo: "mo", y: "y", ...units };
  if (ts == null) return "";
  const s = Math.max(0, now - ts);
  if (s < 60) return u.now;
  if (s < 3600) return `${Math.floor(s / 60)}${u.m}`;
  if (s < DAY) return `${Math.floor(s / 3600)}${u.h}`;
  if (s < 14 * DAY) return `${Math.floor(s / DAY)}${u.d}`;
  if (s < 60 * DAY) return `${Math.floor(s / (7 * DAY))}${u.w}`;
  if (s < 365 * DAY) return `${Math.floor(s / (30 * DAY))}${u.mo}`;
  return `${Math.floor(s / (365 * DAY))}${u.y}`;
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

// src/core/graph-core.ts
var NODE_W = 172;
var NODE_H = 62;
var NODE_GAP = 14;
var RANK_GAP = 52;
var idOf = (ref) => ref && typeof ref === "object" ? ref.id : ref;
function graphNodes(tasks) {
  return (tasks || []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? null,
    assignee: t.assignee || "",
    board: t.board || "",
    attachmentCount: t.attachment_count || 0,
    // Kept whole: the sparkline needs them and a second fetch per node is not a thing.
    events: t.events || [],
    runs: t.runs || [],
    // The backend's own bucketed series (`/gantt` computes it in one aggregate pass), when
    // it is there: the desktop then has nothing to derive, and a 500-task board ships 24
    // small integers per touched task instead of every event.
    activity: Array.isArray(t.activity) && t.activity.length ? t.activity : null,
    startedAt: t.started_at || null,
    completedAt: t.completed_at || null,
    createdAt: t.created_at || null
  }));
}
function dedupeEdges(edges, { keepSelf = false } = {}) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const e of edges || []) {
    const from = idOf(e && e.from);
    const to = idOf(e && e.to);
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) continue;
    if (from === to && !keepSelf) continue;
    const key = from + "\0" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}
function graphEdges(tasks) {
  const edges = [];
  for (const t of tasks || []) {
    for (const p of t.parents || []) {
      const pid = idOf(p);
      if (pid) edges.push({ from: pid, to: t.id });
    }
    for (const c of t.children || []) {
      const cid = idOf(c);
      if (cid) edges.push({ from: t.id, to: cid });
    }
  }
  return dedupeEdges(edges);
}
function edgesWithin(nodes, edges) {
  const known = new Set((nodes || []).map((n) => typeof n === "string" ? n : n.id));
  const kept = [];
  let dangling = 0;
  for (const e of dedupeEdges(edges)) {
    if (known.has(e.from) && known.has(e.to)) kept.push(e);
    else dangling++;
  }
  return { edges: kept, dangling };
}
function ranks(nodes, edges, { depthCap = 4096 } = {}) {
  const ids = (nodes || []).map((n) => typeof n === "string" ? n : n.id);
  const out = new Map(ids.map((id) => [id, 0]));
  const { edges: es } = edgesWithin(ids, edges);
  const children = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const e of es) {
    children.get(e.from).push(e.to);
    indegree.set(e.to, indegree.get(e.to) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
  const settled = new Set(queue);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const child of children.get(id)) {
      if (out.get(id) + 1 > out.get(child)) out.set(child, out.get(id) + 1);
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0 && !settled.has(child)) {
        settled.add(child);
        queue.push(child);
      }
    }
  }
  const leftover = ids.filter((id) => !settled.has(id));
  const cyclic = [];
  let truncated = false;
  if (leftover.length) {
    const inLeftover = new Set(leftover);
    const onLoop = /* @__PURE__ */ new Set();
    for (const id of leftover) {
      const seen = /* @__PURE__ */ new Set();
      const stack = (children.get(id) || []).filter((c) => inLeftover.has(c));
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) {
          onLoop.add(id);
          break;
        }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of children.get(cur) || []) if (inLeftover.has(next)) stack.push(next);
      }
    }
    const band = Math.max(0, ...[...settled].map((id) => out.get(id))) + 1;
    for (const id of onLoop) out.set(id, Math.min(band, depthCap));
    cyclic.push(...[...onLoop].sort());
    const rest2 = leftover.filter((id) => !onLoop.has(id));
    const restSet = new Set(rest2);
    const rounds = Math.min(rest2.length + 1, depthCap);
    for (let round = 0; round < rounds && rest2.length; round++) {
      let changed = false;
      for (const e of es) {
        if (!restSet.has(e.to) || !inLeftover.has(e.from)) continue;
        const candidate = Math.min(out.get(e.from) + 1, depthCap);
        if (candidate > out.get(e.to)) {
          out.set(e.to, candidate);
          changed = true;
        }
      }
      if (!changed) break;
      if (round === rounds - 1) truncated = true;
    }
  }
  return { ranks: out, cyclic, truncated };
}
var STATUS_ORDER = ["triage", "todo", "scheduled", "ready", "running", "review", "blocked", "done", "archived"];
var priorityValue = (p) => typeof p === "number" ? p : Number(p) || 0;
function rankComparator(by) {
  const title = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), void 0, { numeric: true });
  return (a, b) => {
    let d = 0;
    if (by === "status") {
      const sa = STATUS_ORDER.indexOf(a.status), sb = STATUS_ORDER.indexOf(b.status);
      d = (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
    } else if (by === "assignee") {
      d = String(a.assignee || "￿").localeCompare(String(b.assignee || "￿"));
    } else if (by === "priority") {
      d = priorityValue(a.priority) - priorityValue(b.priority);
    } else if (by === "updated") {
      d = (b.startedAt || 0) - (a.startedAt || 0);
    }
    if (d !== 0) return d;
    return title(a, b) || String(a.id).localeCompare(String(b.id));
  };
}
function orderRanks(nodes, rankMap, by = "status") {
  const cmp = rankComparator(by);
  const rows = [];
  for (const n of nodes || []) {
    const r = rankMap.get(n.id) ?? 0;
    (rows[r] = rows[r] || []).push(n);
  }
  return rows.filter(Boolean).map((row) => row.sort(cmp));
}
function reduceEdges(nodes, edges) {
  const { edges: es } = edgesWithin(nodes, edges);
  const children = /* @__PURE__ */ new Map();
  for (const e of es) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from).push(e.to);
  }
  const kept = [];
  let implied = 0;
  for (const e of es) {
    const seen = /* @__PURE__ */ new Set();
    const stack = (children.get(e.from) || []).filter((c) => c !== e.to);
    let bypass = false;
    while (stack.length) {
      const cur = stack.pop();
      if (cur === e.to) {
        bypass = true;
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of children.get(cur) || []) stack.push(next);
    }
    if (bypass) implied++;
    else kept.push(e);
  }
  return { edges: kept, implied };
}
function lineage(nodes, edges, id) {
  const { edges: es } = edgesWithin(nodes, edges);
  const up = /* @__PURE__ */ new Map();
  const down = /* @__PURE__ */ new Map();
  for (const e of es) {
    if (!up.has(e.to)) up.set(e.to, []);
    up.get(e.to).push(e.from);
    if (!down.has(e.from)) down.set(e.from, []);
    down.get(e.from).push(e.to);
  }
  const walk = (start, adjacency) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [...adjacency.get(start) || []];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur) || cur === start) continue;
      seen.add(cur);
      for (const next of adjacency.get(cur) || []) stack.push(next);
    }
    return seen;
  };
  return { upstream: walk(id, up), downstream: walk(id, down) };
}
function nearestInHalo(rects, x, y, radius, { exclude = null, allowed = null } = {}) {
  let best = null;
  let bestD = Infinity;
  for (const [id, r] of rects) {
    if (id === exclude) continue;
    if (allowed && !allowed(id)) continue;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return bestD <= radius ? best : null;
}
function layoutGraph(nodes, edges, {
  arrangement = "down",
  sortBy = "status",
  // Grouping is what makes an all-boards graph readable: layout each group on its own and
  // stack the blocks, so a board is a CONTIGUOUS, framed region instead of its members being
  // interleaved with another board's and each card needing a badge to say where it belongs.
  groupBy = null,
  groupGap = 22,
  groupHead = 52,
  groupPad = 12,
  // `nodeH` exists so the reader can ask for taller cards (two lines of title) without the
  // layout lying about it: the height is a CONSTANT the equations use, not a CSS accident, and
  // it has to travel through the rank spacing as well as the boxes.
  nodeH = NODE_H,
  // Same reasoning as `nodeH` for the width: a caller that wants three lines of title needs a
  // wider card, and the equations (rank centring, gaps) have to know it.
  nodeW = NODE_W
} = {}) {
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, title: n } : n);
  const keys = groupBy ? [...new Set(list.map((n) => groupBy(n)))].filter((k) => k != null && k !== "") : [];
  if (keys.length <= 1) {
    return { ...layoutOne(list, edges, arrangement, sortBy, nodeH, nodeW), groups: [] };
  }
  const blocks = keys.map((key) => ({
    key,
    block: layoutOne(list.filter((n) => groupBy(n) === key), edges, arrangement, sortBy, nodeH, nodeW)
  }));
  const inner = Math.max(...blocks.map((b) => b.block.width));
  const width = inner + groupPad * 2;
  const groups = [];
  const out = [];
  const drawnEdges = [];
  let cursor = 0;
  for (const { key, block } of blocks) {
    const h = block.height + groupHead + groupPad;
    const dx = groupPad + (inner - block.width) / 2;
    const dy = cursor + groupHead;
    for (const b of block.nodes) out.push({ ...b, x: b.x + dx, y: b.y + dy });
    groups.push({ key, x: 0, y: cursor, w: width, h });
    for (const e of block.edges) {
      drawnEdges.push({ ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy });
    }
    cursor += h + groupGap;
  }
  const height = cursor - groupGap;
  return {
    nodes: out,
    edges: drawnEdges,
    groups,
    width,
    height,
    ranks: Math.max(...blocks.map((b) => b.block.ranks)),
    implied: blocks.reduce((n, b) => n + b.block.implied, 0),
    dangling: blocks.reduce((n, b) => n + b.block.dangling, 0),
    cyclic: blocks.some((b) => b.block.cyclic),
    truncated: blocks.some((b) => b.block.truncated)
  };
}
function layoutOne(list, edges, arrangement, sortBy, nodeH = NODE_H, nodeW = NODE_W) {
  const { edges: es, dangling } = edgesWithin(list, edges);
  const { ranks: rankMap, cyclic, truncated } = ranks(list, es);
  const reduced = reduceEdges(list, es);
  const rows = orderRanks(list, rankMap, sortBy);
  const vertical = arrangement !== "flow";
  const boxes = /* @__PURE__ */ new Map();
  const placed = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const extent = row.length * (vertical ? nodeW + NODE_GAP : nodeH + NODE_GAP) - NODE_GAP;
    let offset = -extent / 2;
    for (const node of row) {
      const box = vertical ? { id: node.id, x: offset, y: r * (nodeH + RANK_GAP), w: nodeW, h: nodeH, rank: r } : { id: node.id, x: r * (nodeW + RANK_GAP), y: offset, w: nodeW, h: nodeH, rank: r };
      offset += vertical ? nodeW + NODE_GAP : nodeH + NODE_GAP;
      boxes.set(node.id, box);
      placed.push(box);
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of placed) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!placed.length) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  for (const b of placed) {
    b.x -= minX;
    b.y -= minY;
  }
  const drawn = [];
  for (const e of reduced.edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b) continue;
    drawn.push(vertical ? { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y } : { from: e.from, to: e.to, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 });
  }
  return {
    nodes: placed,
    edges: drawn,
    width: maxX - minX,
    height: maxY - minY,
    ranks: rows.length,
    implied: reduced.implied,
    dangling,
    cyclic,
    truncated
  };
}
function scopeIds(nodes, edges, scope) {
  const list = (nodes || []).map((n) => typeof n === "string" ? { id: n, status: void 0 } : n);
  if (scope === "open") {
    return new Set(list.filter((n) => n.status !== "done" && n.status !== "archived").map((n) => n.id));
  }
  if (scope !== "running-lineage") return new Set(list.map((n) => n.id));
  const running = list.filter((n) => n.status === "running").map((n) => n.id);
  const keep = new Set(running);
  for (const id of running) {
    const { upstream, downstream } = lineage(list, edges, id);
    for (const u of upstream) keep.add(u);
    for (const d of downstream) keep.add(d);
  }
  return keep;
}

// src/main.ts
var ID2 = "kanban-gantt";
var ROW_H = 28;
var BAR_H = 14;
var MIN_BAR_SEC = 2 * 3600;
var ZOOM_MIN_FACTOR = 0.2;
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
function openBoardsKey() {
  const scope = connectionScope();
  return scope ? `openBoards.${scope}` : "openBoards";
}
function readStoredBoard(storage2) {
  if (!storage2) return "";
  const scoped = storage2.get(boardStorageKey(), "");
  if (scoped) return scoped;
  return storage2.get(BOARD_KEY, "") || "";
}
var PERIOD_CHOICES = [
  { span: 6 * 3600, key: "period6h" },
  { span: 12 * 3600, key: "period12h" },
  { span: 24 * 3600, key: "period24h" },
  { span: 3 * DAY, key: "period3d" },
  { span: 7 * DAY, key: "period7d" }
];
function PeriodSelector({ value, onChange, disabled }) {
  const i18n = useGanttI18n();
  return jsx6("div", {
    role: "group",
    "aria-label": i18n.periodLabel,
    className: "inline-flex items-stretch overflow-hidden rounded-md",
    style: { border: "1px solid var(--ui-stroke-tertiary)", opacity: disabled ? 0.45 : 1 },
    children: PERIOD_CHOICES.map(({ span, key }, index) => {
      const active = value === span;
      return jsx6("button", {
        type: "button",
        disabled: Boolean(disabled),
        "aria-pressed": active,
        title: `${i18n.periodShow} ${i18n[key]}`,
        onClick: () => onChange(span),
        className: cn3(
          "h-5 px-1.5 text-[10px] leading-none tabular-nums border-0 cursor-pointer",
          active ? "font-semibold" : "font-normal"
        ),
        style: {
          backgroundColor: active ? "var(--ui-accent)" : "transparent",
          color: active ? "var(--ui-bg-chrome)" : "var(--ui-text-secondary)",
          borderLeft: index ? "1px solid var(--ui-stroke-tertiary)" : "none"
        },
        children: i18n[key]
      }, span);
    })
  });
}
function HourLines({ min, max, pxPerSec }) {
  const plan = hourTickPlan(pxPerSec * 3600);
  if (!plan) return null;
  const lines = [];
  const first = Math.ceil(min / 3600) * 3600;
  for (let t = first; t <= max; t += 3600) {
    const hour = new Date(t * 1e3).getHours();
    const major = hour % plan.step === 0;
    lines.push(jsxs6("div", {
      className: "absolute top-0 bottom-0 border-l",
      style: {
        left: `${Math.round((t - min) * pxPerSec)}px`,
        borderColor: major ? "var(--ui-stroke-tertiary)" : "var(--ui-stroke-quaternary)"
      },
      children: major ? jsx6("span", {
        className: "absolute top-0.5 left-0.5 text-[9px] tabular-nums text-(--ui-text-tertiary)",
        children: `${String(hour).padStart(2, "0")}:00`
      }) : null
    }, "h" + t));
  }
  return jsx6("div", { className: "absolute inset-0 pointer-events-none z-0", children: lines });
}
function NowLine({ now, min, max, pxPerSec, originX = 0 }) {
  const i18n = useGanttI18n();
  const left = nowLineX(now, min, max, pxPerSec, originX);
  if (left == null) return null;
  const label = new Date(Math.round(now) * 1e3).toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
  return jsxs6("div", {
    className: "absolute top-0 bottom-0 z-10 pointer-events-none",
    style: { left: `${left}px` },
    children: [
      jsx6("div", {
        style: {
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "1px",
          backgroundColor: "var(--ui-accent, #d946ef)"
        }
      }),
      jsx6("span", {
        title: `${i18n.nowMarker} — ${label}`,
        className: "absolute top-0.5 left-1 whitespace-nowrap rounded px-1 text-[9px] font-semibold tabular-nums",
        style: {
          backgroundColor: "var(--ui-bg-chrome)",
          color: "var(--ui-accent, #d946ef)"
        },
        children: label
      })
    ]
  });
}
function Ruler({ min, max, pxPerSec, onReset }) {
  const unit = tickUnit(max - min);
  const tickValues = ticks(min, max, unit);
  const dayWidth = pxPerSec * DAY;
  const showWeekday = unit === "day" && dayWidth >= 50;
  return jsxs6("div", {
    className: "relative border-b border-(--ui-stroke-secondary) select-none text-[10px]",
    style: { height: showWeekday ? "32px" : "24px" },
    onDoubleClick: onReset ? () => onReset() : void 0,
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
function titleText(title) {
  return typeof title === "string" ? title.trim() : "";
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
function TaskRow({ task, depth, isChild, now, pxPerSec, min, timelineW, onOpen, isSelected, isChecked, onToggleCheck, isEven, showBoardBadge, dragState, onDragStartTask, onDragEndTask, onDropOn, hasChildren, collapsed, secondary, secondaryOnly, continuation = [], lastSibling, hiddenCount = 0, matched, descendantOfSelected, onToggleFold, listMode }) {
  const i18n = useGanttI18n();
  const labelW = useValue2($labelW);
  const bars = taskBars(task, now);
  const label = task.label ? `[${task.label}]` : "";
  const showPrefixTags = useValue2($titlePrefixTags);
  const { prefix, rest: rest2 } = splitTitlePrefix(task.title);
  const name = rest2 || titleText(task.title) || i18n.untitled;
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
    // Addressable and focusable: the row is what the keyboard moves through when the detail
    // is docked, and `focus()` needs both a handle and a `tabIndex`.
    "data-row-id": task.id,
    tabIndex: -1,
    style: { gridTemplateColumns: listMode ? LIST_COLUMNS : `${labelW}px ${timelineW}px`, height: `${ROW_H}px` },
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
          width: listMode ? void 0 : `${labelW}px`,
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
              showPrefixTags && prefix ? jsx6("span", {
                className: "shrink-0 mr-1 rounded-sm font-semibold",
                style: {
                  padding: "0 3px",
                  fontSize: "9px",
                  lineHeight: "1.35",
                  color: "var(--ui-text-secondary)",
                  backgroundColor: "var(--ui-bg-tertiary)",
                  border: "1px solid var(--ui-stroke-tertiary)"
                },
                children: prefix
              }) : null,
              name
            ]
          }),
          // The paperclip sits with the assignee, in the row's right-hand group: inside the
          // truncated label cell, after a long title, it was pushed out of sight. In list view
          // it has its own column instead, hence the guard.
          listMode ? null : jsx6(AttachmentMenu, {
            taskId: task.id,
            board: task.board,
            count: task.attachment_count,
            i18n,
            onPreview: (att, siblings) => $openAttachment.set(
              attachmentPreviewState(task.id, task.board, att, siblings)
            )
          }),
          // Assignee at a glance: avatar when assigned, a faint dashed ring when not.
          // (The list view has its own assignee column.)
          listMode ? null : task.assignee ? jsx6("span", {
            className: "shrink-0 inline-flex",
            title: `${i18n.assignLabel} ${task.assignee}`,
            children: jsx6(ProfileAvatar, { name: task.assignee, size: "0.95rem" })
          }) : jsx6("span", {
            className: "shrink-0 rounded-full border border-dashed border-(--ui-text-quaternary) opacity-60",
            style: { width: "0.95rem", height: "0.95rem" },
            title: i18n.unassigned,
            "aria-label": i18n.unassigned
          })
        ]
      }),
      listMode ? jsx6(ListCells, { task, now, statusTitle, dotColor }) : jsxs6("div", {
        className: "relative overflow-hidden",
        style: { height: `${ROW_H}px` },
        children: bars.length > 0 ? bars.map((b, idx) => jsx6(Bar, { key: b.runId || idx, task, bar: b, pxPerSec, min, onOpen })) : [jsx6("div", { key: "empty", className: "text-(--ui-text-quaternary) text-[10px]", children: "—" })]
      })
    ]
  });
}
var LIST_COLUMNS = "minmax(0, 1fr) 150px 96px 64px 40px";
function ListCells({ task, now, statusTitle, dotColor }) {
  const i18n = useGanttI18n();
  const last = lastActivity(task);
  return [
    jsx6("div", {
      key: "assignee",
      className: "flex items-center gap-1.5 min-w-0 px-2 text-[11px]",
      children: task.assignee ? [
        jsx6(ProfileAvatar, { key: "a", name: task.assignee, size: "0.95rem" }),
        jsx6("span", { key: "n", className: "truncate", children: task.assignee })
      ] : jsx6("span", { className: "text-(--ui-text-quaternary) italic", children: i18n.unassigned })
    }),
    jsx6("div", {
      key: "status",
      className: "px-2 text-[11px] truncate",
      style: { color: dotColor },
      children: statusTitle
    }),
    jsx6("div", {
      key: "age",
      className: "px-2 text-[10px] tabular-nums text-right text-(--ui-text-tertiary)",
      title: last ? new Date(last * 1e3).toLocaleString() : "",
      children: relativeAge(last, now, i18n.relativeUnits)
    }),
    jsx6("div", {
      key: "attachments",
      // The dedicated end column asked for: as narrow as the paperclip it can hold, and it
      // has to be the LAST cell, because LIST_COLUMNS ends with its 40 px.
      className: "flex items-center justify-end pr-2",
      children: jsx6(AttachmentMenu, {
        taskId: task.id,
        board: task.board,
        count: task.attachment_count,
        i18n,
        onPreview: (att, siblings) => $openAttachment.set(
          attachmentPreviewState(task.id, task.board, att, siblings)
        )
      })
    })
  ];
}
function ProfileAvatar({ name, size = "1rem" }) {
  const color = profileColor(name);
  const initials = (() => {
    const parts = (name || "?").split(/[\s_\-./]+/).filter(Boolean);
    return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
  })();
  return jsx6("span", {
    className: "grid shrink-0 place-items-center rounded-full font-semibold select-none",
    style: {
      backgroundColor: color ? profileColorSoft(color, 22) : "var(--ui-bg-quaternary, rgba(150,150,150,0.15))",
      color: color ?? "var(--ui-text-secondary)",
      height: size,
      width: size,
      // The circle inherits the shell's 11px/16.5px text defaults, and a 16.5px line
      // box cannot be centred inside a 15px circle. The previous `text-[8px]` did
      // nothing either — an arbitrary Tailwind value is absent from the desktop's
      // PRECOMPILED stylesheet, so the class was never emitted. Hence an explicit size,
      // relative to the circle so a caller can pass any size.
      fontSize: `calc(${size} * 0.5)`
    },
    title: name,
    children: jsx6("span", {
      // The initials get their own block, and that is not decoration: as a direct child
      // of the grid the text lands in an ANONYMOUS grid item, where `text-box-trim`
      // does not apply (setting it on the circle changed nothing — measured). A block
      // of its own owns its line box, so the trim takes effect.
      style: {
        display: "block",
        lineHeight: 1,
        // Centring the line box is not centring the ink. With `line-height: 1` the box
        // is 7.6px while the glyph's natural line height is ~10px, so the baseline was
        // painted 5.7px BELOW the circle's centre (measured: box centre -0.02px,
        // baseline +5.69px) and the letters sat in the lower half. Trimming the inline
        // box to the cap height makes the centred box the caps themselves, exactly, for
        // any font and any size (measured after: +0.37px). Both properties are needed —
        // `text-box` only sets the EDGE, `text-box-trim` is what removes the leading.
        // Chromium 133+; elsewhere the declarations are ignored and the previous
        // behaviour stands rather than a broken one.
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic"
      },
      children: initials
    })
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
  onToggleArchived,
  onlyAttachments,
  onToggleOnlyAttachments
}) {
  const i18n = useGanttI18n();
  const active = selectedAssignees.size > 0 || disabledStatuses.size > 0 || showArchived || onlyAttachments;
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
          }),
          jsxs6(DropdownMenuItem3, {
            // Off by default, like every other filter here: checking it narrows the board.
            onClick: () => onToggleOnlyAttachments(!onlyAttachments),
            className: "flex items-center gap-2 cursor-pointer text-xs py-1.5",
            children: [
              jsx6(Codicon5, { name: "attach", size: "0.8rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
              jsx6("span", { className: "flex-1", children: i18n.filterWithAttachments }),
              onlyAttachments ? jsx6(Codicon5, { name: "check", size: "0.8rem", className: "ml-auto" }) : null
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
  blocked: { tone: statusTone("blocked"), label: "Blocked" },
  review: { tone: statusTone("review"), label: "Review" },
  done: { tone: "var(--ui-text-tertiary)", label: "Done" },
  archived: { tone: "var(--ui-text-quaternary)", label: "Archived" }
};
var STATUS_ORDER2 = ["triage", "todo", "ready", "blocked", "running", "review", "done"];
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
function FeedTab({ label, count, ariaLabel, active, onClick }) {
  return jsx6("button", {
    type: "button",
    role: "tab",
    "aria-selected": active ? "true" : "false",
    "aria-label": ariaLabel,
    onClick,
    className: cn3(
      "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded cursor-pointer border-0",
      active ? "bg-(--ui-accent)/15 text-(--ui-accent) font-medium" : "bg-transparent text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)"
    ),
    children: [
      jsx6("span", { className: "whitespace-nowrap", children: label }),
      jsx6("span", {
        className: cn3(
          "inline-flex min-w-[1.05rem] items-center justify-center rounded-full px-1 text-[9.5px] font-semibold leading-[1.35] tabular-nums",
          active ? "bg-(--ui-accent)/22 text-(--ui-accent)" : "bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)"
        ),
        children: String(count)
      })
    ]
  });
}
function ViewToggle({ value, onChange }) {
  const i18n = useGanttI18n();
  const item = (mode, icon, label) => jsx6("button", {
    type: "button",
    onClick: () => onChange(mode),
    title: label,
    "aria-label": label,
    "aria-pressed": value === mode,
    className: cn3(
      "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded cursor-pointer",
      value === mode ? "bg-(--ui-accent)/15 text-(--ui-accent) font-medium" : "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)"
    ),
    children: [jsx6(Codicon5, { key: "i", name: icon, size: "0.8rem" }), jsx6("span", { key: "l", children: label })]
  }, mode);
  return jsxs6("span", {
    className: "inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5",
    role: "group",
    children: [
      item("list", "list-flat", i18n.viewList),
      item("timeline", "graph-line", i18n.viewTimeline),
      // Third value, same persistence and same chrome as the other two. The icon is the
      // hierarchy glyph because the view answers "what hangs off what", not "when".
      item("graph", "type-hierarchy", i18n.viewGraph)
    ]
  });
}
var GRAPH_ZOOM_MIN = 0.35;
var GRAPH_ZOOM_MAX = 2.5;
var GRAPH_MARGIN = 28;
function GraphView({
  tasks = [],
  i18n,
  now,
  zoom = 1,
  onZoom,
  scope = "all",
  onScopeChange,
  selectedId = null,
  showBoardBadge = false,
  /** board slug -> its label, for the group frames (only used when grouping) */
  groupLabel = (slug) => slug,
  board = "",
  dragId = null,
  dropMap = null,
  onOpen,
  onDragStart,
  onDragEnd,
  onDropOn,
  onNewChild,
  /** Called on a click that did NOT drag and did not land on a card: the empty canvas. */
  onClearSelection,
  /** Taller cards: the title wraps onto a second line instead of being cut. */
  tallCards = false,
  sortBy = "status"
}) {
  const [pan, setPan] = useState4({ x: 0, y: 0 });
  const [dragging, setDragging] = useState4(null);
  const NEAR_PX = 64;
  const [nearTarget, setNearTarget] = useState4(null);
  const dragRects = useRef2(/* @__PURE__ */ new Map());
  const pressedAt = useRef2(null);
  const canvasRef = useRef2(null);
  const nodes = useMemo2(() => graphNodes(tasks), [tasks]);
  const edges = useMemo2(() => graphEdges(tasks), [tasks]);
  const shown = useMemo2(() => {
    const keep = scopeIds(nodes, edges, scope);
    return nodes.filter((n) => keep.has(n.id));
  }, [nodes, edges, scope]);
  const grouping = showBoardBadge;
  const nodeH = tallCards ? NODE_H + 34 : NODE_H;
  const nodeW = tallCards ? NODE_W + 48 : NODE_W;
  const layout = useMemo2(
    () => layoutGraph(shown, edges, { sortBy, nodeH, nodeW, groupBy: grouping ? (n) => n.board || "" : null }),
    [shown, edges, sortBy, grouping, nodeH, nodeW]
  );
  const lin = useMemo2(() => {
    if (!selectedId || !shown.some((n) => n.id === selectedId)) return null;
    const { upstream, downstream } = lineage(shown, edges, selectedId);
    return { up: upstream, down: downstream };
  }, [shown, edges, selectedId]);
  const hiddenByScope = nodes.length - shown.length;
  const groupTally = useMemo2(() => {
    const out = /* @__PURE__ */ new Map();
    const ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"];
    for (const n of shown) {
      const key = n.board || "";
      if (!out.has(key)) out.set(key, { total: 0, counts: /* @__PURE__ */ new Map() });
      const entry = out.get(key);
      entry.total++;
      const st = n.status || "todo";
      entry.counts.set(st, (entry.counts.get(st) || 0) + 1);
    }
    return new Map([...out].map(([key, e]) => [key, {
      total: e.total,
      parts: ORDER.filter((st) => e.counts.has(st)).map((st) => `${e.counts.get(st)} ${(i18n.col && i18n.col[st] || st).toLowerCase()}`)
    }]));
  }, [shown, i18n]);
  const selectedBoard = useMemo2(() => {
    if (!selectedId) return null;
    const n = shown.find((x) => x.id === selectedId);
    return n ? n.board || "" : null;
  }, [shown, selectedId]);
  const zoomRef = useRef2(zoom);
  zoomRef.current = zoom;
  const [autoFit, setAutoFit] = useState4(true);
  const autoFitRef = useRef2(true);
  autoFitRef.current = autoFit;
  const fitPctRef = useRef2(null);
  const fittedSize = useRef2("");
  const fitView = (mark = true) => {
    const el = canvasRef.current;
    if (!el || !layout.width || !layout.height) return;
    const rect = el.getBoundingClientRect();
    const fit = Math.min(
      1,
      (rect.width - GRAPH_MARGIN * 2) / layout.width,
      (rect.height - GRAPH_MARGIN * 2) / layout.height
    );
    const pct = Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, fit));
    fitPctRef.current = pct;
    if (mark) {
      setAutoFit(true);
      autoFitRef.current = true;
    }
    if (onZoom) onZoom(pct);
    const w = (layout.width + GRAPH_MARGIN * 2) * pct;
    const h = (layout.height + GRAPH_MARGIN * 2) * pct;
    setPan({
      x: Math.max(GRAPH_MARGIN / 2, (rect.width - w) / 2),
      y: Math.max(GRAPH_MARGIN / 2, (rect.height - h) / 2)
    });
  };
  useEffect3(() => {
    if (fitPctRef.current == null) return;
    if (Math.abs(zoom - fitPctRef.current) > 5e-3) setAutoFit(false);
  }, [zoom]);
  useEffect3(() => {
    if (!layout.width || !layout.height) return;
    const size = `${Math.round(layout.width / 24)}x${Math.round(layout.height / 24)}`;
    if (fittedSize.current === size) return;
    fittedSize.current = size;
    fitView();
  }, [layout.width, layout.height, onZoom]);
  useEffect3(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return void 0;
    const ro = new ResizeObserver(() => {
      if (autoFitRef.current) fitView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width, layout.height, onZoom]);
  const boxes = useMemo2(() => new Map(layout.nodes.map((b) => [b.id, b])), [layout]);
  useEffect3(() => {
    const el = canvasRef.current;
    if (!el) return void 0;
    const onWheel = (event) => {
      const intent = wheelIntent(event);
      event.preventDefault();
      if (intent === "zoom") {
        const rect = el.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const next = Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, zoom * wheelZoomFactor(event.deltaY, event.deltaMode)));
        if (next === zoom) return;
        setPan((p) => ({ x: cx - (cx - p.x) * (next / zoom), y: cy - (cy - p.y) * (next / zoom) }));
        if (onZoom) onZoom(next);
        return;
      }
      if (intent === "pan") setPan((p) => ({ x: p.x - event.deltaY, y: p.y }));
      else setPan((p) => ({ x: p.x - (event.deltaX || 0), y: p.y - event.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, onZoom]);
  const onCanvasPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target && target.closest && target.closest("[data-graph-node],button,a,input,select,textarea,[role=button]")) return;
    event.preventDefault();
    pressedAt.current = { x: event.clientX, y: event.clientY };
    setAutoFit(false);
    const start = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    setDragging(start);
  };
  useEffect3(() => {
    if (!dragging) return void 0;
    const onMove = (event) => setPan({ x: event.clientX - dragging.x, y: event.clientY - dragging.y });
    const onUp = (event) => {
      const from = pressedAt.current;
      pressedAt.current = null;
      if (from && event && Math.hypot(event.clientX - from.x, event.clientY - from.y) < 5 && onClearSelection) {
        onClearSelection();
      }
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);
  const order = useMemo2(() => [...layout.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => b.id), [layout]);
  const onKeyDown = (event) => {
    if (!order.length) return;
    const at = order.indexOf(selectedId);
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      event.preventDefault();
      const next = at < 0 ? step > 0 ? 0 : order.length - 1 : Math.min(order.length - 1, Math.max(0, at + step));
      if (onOpen) onOpen(order[next]);
      return;
    }
    if (event.key === "Enter" && at >= 0 && onOpen) {
      event.preventDefault();
      onOpen(order[at]);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fitView();
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      const next = zoom * (event.key === "-" ? 0.8 : 1.25);
      if (onZoom) onZoom(Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, next)));
    }
  };
  if (!shown.length) {
    return jsx6("div", {
      className: "py-10 flex flex-col items-center gap-3",
      children: jsx6(EmptyState, {
        title: i18n.nothingToDisplay,
        description: hiddenByScope > 0 ? i18n.graphHiddenByScope(hiddenByScope) : i18n.noTasksMatch
      })
    });
  }
  const edgePath = (e) => {
    const mid = (e.y1 + e.y2) / 2;
    return `M ${e.x1} ${e.y1} C ${e.x1} ${mid}, ${e.x2} ${mid}, ${e.x2} ${e.y2}`;
  };
  const edgeTone = (from, to) => {
    if (!lin) return "var(--ui-stroke-secondary)";
    if (lin.down.has(from) && (lin.down.has(to) || to === selectedId)) return statusTone("running");
    if (lin.up.has(to) && (lin.up.has(from) || from === selectedId)) return statusTone("scheduled");
    return "var(--ui-stroke-secondary)";
  };
  return jsxs6("div", {
    className: "mt-2 border border-(--ui-stroke-tertiary) rounded-md flex-1 min-h-0 relative overflow-hidden",
    children: [
      jsx6("div", {
        ref: canvasRef,
        className: cn3("absolute inset-0 overflow-hidden", dragging ? "cursor-grabbing" : "cursor-grab"),
        tabIndex: 0,
        role: "application",
        "aria-label": i18n.viewGraph,
        title: i18n.graphHint,
        onKeyDown,
        onPointerDown: onCanvasPointerDown,
        // Proximity drop lives on the CANVAS, not on the cards: a release that misses a card by
        // 20 px used to be a release into the void, which read as the feature being broken.
        onDragOver: (event) => {
          if (!onDropOn || !dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const pick = nearestInHalo(dragRects.current, event.clientX, event.clientY, NEAR_PX, {
            exclude: dragId,
            allowed: (id) => !dropMap || (dropMap.get(id) ? dropMap.get(id).allowed : true)
          });
          if (pick !== nearTarget) setNearTarget(pick);
        },
        onDragLeave: (event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setNearTarget(null);
        },
        onDrop: (event) => {
          if (!onDropOn) return;
          event.preventDefault();
          const target = nearTarget;
          setNearTarget(null);
          dragRects.current = /* @__PURE__ */ new Map();
          if (target) onDropOn(target);
        },
        style: { cursor: dragging ? "grabbing" : "grab" },
        children: jsxs6("div", {
          className: "absolute origin-top-left",
          style: {
            // `left/top: 0` is not decoration: an absolutely positioned box with no offsets
            // sits at its STATIC position, which depends on what else is in flow. Without it
            // the whole surface drifted right by whatever that position happened to be, and
            // every pan/fit number was off by the same amount.
            left: "0px",
            top: "0px",
            // Inline, not a class: the host's stylesheet does not compile `origin-top-left`
            // for us, and without it the scale grows the surface from its CENTRE — the pan
            // then means something else than what it says, and the fit hangs off the edge.
            transformOrigin: "top left",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: `${layout.width + GRAPH_MARGIN * 2}px`,
            height: `${layout.height + GRAPH_MARGIN * 2}px`
          },
          children: [
            // One frame per board, behind everything: dashed and rounded, with the name in the
            // top-left corner, so the boundary of a board is visible without a badge on
            // every card. Pointer-events off — a frame is scenery, not a target.
            ...(layout.groups || []).map((g) => jsxs6("div", {
              key: `frame-${g.key}`,
              className: "absolute rounded-lg border border-dashed pointer-events-none",
              style: {
                left: `${g.x + GRAPH_MARGIN}px`,
                top: `${g.y + GRAPH_MARGIN}px`,
                width: `${g.w}px`,
                height: `${g.h}px`,
                borderColor: g.key === selectedBoard ? "var(--ui-accent)" : "var(--ui-stroke-tertiary)",
                backgroundColor: g.key === selectedBoard ? "color-mix(in srgb, var(--ui-accent) 7%, transparent)" : "color-mix(in srgb, var(--ui-bg-elevated) 40%, transparent)"
              },
              children: [
                jsxs6("div", {
                  className: "absolute flex flex-col gap-1 min-w-0",
                  style: { left: "12px", right: "12px", top: "10px" },
                  children: [
                    jsx6("span", {
                      className: cn3(
                        "truncate text-[12px] font-semibold leading-tight",
                        g.key === selectedBoard ? "text-(--ui-accent)" : "text-(--ui-text-primary)"
                      ),
                      // The label as the board is NAMED — no case transform, ever.
                      children: groupLabel(g.key)
                    }),
                    jsx6("span", {
                      className: "truncate text-[10px] leading-tight text-(--ui-text-tertiary)",
                      children: [g.key, i18n.graphTally(groupTally.get(g.key)?.total || 0)].concat(groupTally.get(g.key)?.parts || []).join(" · ")
                    })
                  ]
                })
              ]
            })),
            jsx6("svg", {
              className: "absolute inset-0 pointer-events-none",
              width: layout.width + GRAPH_MARGIN * 2,
              height: layout.height + GRAPH_MARGIN * 2,
              "aria-hidden": "true",
              children: [
                jsx6("defs", {
                  children: jsx6("marker", {
                    id: "kg-arrow",
                    viewBox: "0 0 8 8",
                    refX: "7",
                    refY: "4",
                    markerWidth: "6",
                    markerHeight: "6",
                    orient: "auto-start-reverse",
                    children: jsx6("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: "currentColor" })
                  })
                }),
                // The link the release would create, drawn from the source card to the card
                // the pointer is near: the gesture says what it is about to do before it does it.
                nearTarget && dragId && boxes.get(dragId) && boxes.get(nearTarget) ? jsx6("path", {
                  d: (() => {
                    const a = boxes.get(dragId), b = boxes.get(nearTarget);
                    const m = GRAPH_MARGIN;
                    return `M ${a.x + a.w / 2 + m} ${a.y + a.h / 2 + m} C ${a.x + a.w / 2 + m} ${a.y + a.h + 30 + m}, ${b.x + b.w / 2 + m} ${b.y - 30 + m}, ${b.x + b.w / 2 + m} ${b.y + m}`;
                  })(),
                  fill: "none",
                  stroke: "var(--ui-accent)",
                  strokeWidth: 1.6,
                  strokeDasharray: "4 3",
                  markerEnd: "url(#kg-arrow)",
                  style: { color: "var(--ui-accent)" }
                }) : null,
                ...layout.edges.map((e) => jsx6("path", {
                  key: `${e.from}>${e.to}`,
                  d: edgePath({ ...e, x1: e.x1 + GRAPH_MARGIN, y1: e.y1 + GRAPH_MARGIN, x2: e.x2 + GRAPH_MARGIN, y2: e.y2 + GRAPH_MARGIN }),
                  fill: "none",
                  stroke: edgeTone(e.from, e.to),
                  strokeWidth: 1.2,
                  markerEnd: "url(#kg-arrow)",
                  style: { color: edgeTone(e.from, e.to) }
                }))
              ]
            }),
            ...shown.map((node) => {
              const b = boxes.get(node.id);
              if (!b) return null;
              const tone = statusTone(node.status);
              const failed = (node.runs || []).some((r) => ["crashed", "failed", "spawn_failed", "gave_up"].includes(r.outcome || r.status));
              const isSelected = node.id === selectedId;
              const inLineage = lin ? lin.up.has(node.id) || lin.down.has(node.id) : false;
              const faded = Boolean(lin) && !isSelected && !inLineage;
              const prefix = splitTitlePrefix(node.title).prefix;
              const drop = dropMap && node.id !== dragId ? dropMap.get(node.id) : null;
              return jsxs6("div", {
                key: node.id,
                className: cn3(
                  "absolute flex flex-col rounded-md border bg-(--ui-bg-elevated) overflow-hidden select-none cursor-pointer",
                  isSelected ? "border-(--ui-accent)" : "border-(--ui-stroke-secondary)",
                  drop && drop.allowed ? "ring-1 ring-(--ui-accent)" : "",
                  drop && !drop.allowed ? "ring-1 ring-red-500/60" : "",
                  node.id === nearTarget ? "ring-2 ring-(--ui-accent)" : ""
                ),
                "data-graph-node": node.id,
                style: {
                  left: `${b.x + GRAPH_MARGIN}px`,
                  top: `${b.y + GRAPH_MARGIN}px`,
                  width: `${b.w}px`,
                  height: `${b.h}px`,
                  opacity: faded ? 0.45 : 1,
                  borderColor: isSelected ? "var(--ui-accent)" : void 0,
                  boxShadow: isSelected ? "0 0 0 1px var(--ui-accent)" : void 0,
                  // A left edge in the status tone: the stripe kanban-graph has, and the
                  // cheapest way to read a board of 60 nodes at a glance. 5 px, because at 3 it
                  // read as a rendering artefact rather than as a colour code.
                  borderLeft: `5px solid ${tone}`
                },
                draggable: Boolean(onDragStart),
                title: `${node.title} (${node.id})${node.assignee ? ` — ${node.assignee}` : ""}`,
                onClick: () => onOpen && onOpen(node.id),
                onDoubleClick: (event) => {
                  event.preventDefault();
                  if (onNewChild) onNewChild(node.id);
                },
                onDragStart: (event) => {
                  event.dataTransfer.setData("text/plain", node.id);
                  event.dataTransfer.effectAllowed = "move";
                  const rects = /* @__PURE__ */ new Map();
                  const el = canvasRef.current;
                  if (el) {
                    for (const n of el.querySelectorAll("[data-graph-node]")) {
                      rects.set(n.getAttribute("data-graph-node"), n.getBoundingClientRect());
                    }
                  }
                  dragRects.current = rects;
                  if (onDragStart) onDragStart(node.id);
                },
                onDragEnd: () => {
                  setNearTarget(null);
                  dragRects.current = /* @__PURE__ */ new Map();
                  if (onDragEnd) onDragEnd();
                },
                onDragOver: (event) => {
                  if (!onDropOn) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = drop && drop.allowed ? "move" : "none";
                },
                onDrop: (event) => {
                  if (!onDropOn) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onDropOn(node.id);
                },
                children: [
                  jsxs6("div", {
                    className: "flex items-start gap-1 px-1.5 pt-1 min-w-0",
                    children: [
                      jsx6("span", {
                        className: "shrink-0 inline-flex items-center justify-center mt-[1px]",
                        style: { color: tone },
                        title: node.status,
                        children: node.status === "running" ? jsxs6("span", { className: "relative inline-flex items-center justify-center", children: [
                          jsx6("span", { className: "kg-arc", style: { "--kanban-tone": tone } }),
                          jsx6(Codicon5, { name: statusIcon(node.status), size: "0.8rem" })
                        ] }) : jsx6(Codicon5, { name: statusIcon(node.status), size: "0.8rem" })
                      }),
                      jsxs6("span", {
                        className: cn3(
                          "min-w-0 flex-1 leading-tight text-(--ui-text-primary)",
                          tallCards ? "text-[13px]" : "text-[12.5px] truncate"
                        ),
                        // Weight and size inline: this is the only text in the card that
                        // matters, and a class the host bundle does not compile would leave it
                        // exactly as small as it was.
                        style: { fontWeight: 600 },
                        // Wrapping as inline styles: the host bundle does not ship Tailwind's
                        // line-clamp plugin, and a class that silently does nothing would let
                        // the text overflow the card instead of being cut at three lines.
                        style: tallCards ? {
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                          display: "-webkit-box",
                          WebkitLineClamp: "3",
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden"
                        } : void 0,
                        children: [
                          prefix ? jsx6("span", {
                            className: "mr-1 rounded-sm px-0.5 text-[8.5px] font-semibold text-(--ui-text-secondary)",
                            style: { backgroundColor: "var(--ui-bg-tertiary)", border: "1px solid var(--ui-stroke-tertiary)" },
                            children: prefix
                          }) : null,
                          node.title || node.id
                        ]
                      }),
                      failed ? jsx6(Codicon5, { name: "warning", size: "0.75rem", className: "shrink-0 text-[#f87171]", title: i18n.runs((node.runs || []).length) }) : node.status === "blocked" ? jsx6(Codicon5, { name: "warning", size: "0.75rem", className: "shrink-0", style: { color: statusTone("blocked") }, title: node.status }) : null
                    ]
                  }),
                  jsxs6("div", {
                    className: "mt-auto flex items-center gap-1 px-1.5 pb-0.5 text-[9px] text-(--ui-text-quaternary) min-w-0",
                    children: [
                      node.priority != null ? jsx6("span", { className: "shrink-0 tabular-nums", children: `P${node.priority}` }) : null,
                      jsx6("span", { className: "flex-1" }),
                      node.attachmentCount ? jsx6(AttachmentMenu, {
                        taskId: node.id,
                        board: node.board || board,
                        count: node.attachmentCount,
                        i18n,
                        onPreview: (att, siblings) => $openAttachment.set(
                          attachmentPreviewState(node.id, node.board || board, att, siblings)
                        )
                      }) : null,
                      node.assignee ? jsx6("span", { className: "shrink-0 inline-flex", title: node.assignee, children: jsx6(ProfileAvatar, { name: node.assignee, size: "0.85rem" }) }) : jsx6("span", { className: "shrink-0 rounded-full border border-dashed border-(--ui-text-quaternary) opacity-60", style: { width: "0.7rem", height: "0.7rem" } })
                    ]
                  })
                ]
              });
            })
          ]
        })
      }),
      // What the layout had to decide, said out loud instead of left to be noticed:
      // implied edges hidden by the reduction, loops the ranks had to band, links that
      // leave the view (a filtered-out parent), and what the scope is holding back.
      jsxs6("div", {
        className: "pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 px-2 py-1 text-[9.5px] text-(--ui-text-quaternary) bg-gradient-to-t from-(--ui-bg-elevated) to-transparent",
        children: [
          layout.implied ? jsx6("span", { children: i18n.graphImplied(layout.implied) }) : null,
          layout.cyclic.length ? jsx6("span", { className: "text-[#f87171]", children: i18n.graphCyclic(layout.cyclic.length) }) : null,
          layout.dangling ? jsx6("span", { children: i18n.graphDangling(layout.dangling) }) : null,
          hiddenByScope ? jsx6("span", { children: i18n.graphHiddenByScope(hiddenByScope) }) : null,
          jsx6("span", { className: "ml-auto tabular-nums", children: `${shown.length}/${nodes.length}` }),
          // The camera, where the counts are: Fit is the one camera action a clipped first
          // view makes necessary, and it is kanban-graph's `0`.
          jsx6("button", {
            type: "button",
            onClick: (event) => {
              event.stopPropagation();
              fitView();
            },
            title: autoFit ? i18n.graphFitOn : i18n.graphFit,
            "aria-label": i18n.graphFit,
            "aria-pressed": autoFit ? "true" : "false",
            className: cn3(
              "pointer-events-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9.5px] cursor-pointer border-0",
              autoFit ? "bg-(--ui-accent)/15 text-(--ui-accent) ring-1 ring-(--ui-accent)/40" : "text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) bg-transparent"
            ),
            children: [jsx6(Codicon5, { key: "i", name: "screen-full", size: "0.7rem" }), jsx6("span", { key: "l", children: i18n.graphFit })]
          })
        ]
      })
    ]
  });
}
function GraphScopeToggle({ value, onChange }) {
  const i18n = useGanttI18n();
  const item = (id, label) => jsx6("button", {
    type: "button",
    onClick: () => onChange(id),
    "aria-pressed": value === id,
    title: label,
    className: cn3(
      "px-2 py-0.5 text-[11px] rounded cursor-pointer border-0 whitespace-nowrap",
      value === id ? "bg-(--ui-accent)/15 text-(--ui-accent) font-medium" : "bg-transparent text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)"
    ),
    children: label
  }, id);
  return jsxs6("span", {
    className: "inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5",
    role: "group",
    "aria-label": i18n.graphScopeAria,
    children: [
      // Same order as kanban-graph's MODES, so the control reads identically in both
      // plugins; the DEFAULT stays `all` (see SCOPES in graph-core).
      item("running-lineage", i18n.graphScopeRunning),
      item("open", i18n.graphScopeOpen),
      item("all", i18n.graphScopeAll)
    ]
  });
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
              children: STATUS_ORDER2.map((s) => {
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
      children: STATUS_ORDER2.map((s) => {
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
async function fetchAttachment(taskId, board, attachmentId) {
  return apiFetch(`/tasks/${encodeURIComponent(taskId)}/attachments/${attachmentId}/content?board=${encodeURIComponent(board || "")}`);
}
function AttachmentBody({ att, data, i18n }) {
  const kind = previewKind(att.filename, data?.content_type || att.content_type);
  const url = useMemo2(() => {
    if (!data || kind === "markdown" || kind === "text") return null;
    const bytes = data.encoding === "base64" ? Uint8Array.from(atob(data.text || ""), (c) => c.charCodeAt(0)) : new TextEncoder().encode(data.text || "");
    return URL.createObjectURL(new Blob([bytes], {
      type: attachmentMime(att.filename, data.content_type || att.content_type)
    }));
  }, [data, att.filename, att.content_type, kind]);
  useEffect3(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (kind === "markdown") return jsx6(MessageTextContent, { media: false, text: data?.text || "" });
  if (kind === "text") {
    return jsx6("pre", {
      className: "m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed",
      children: data?.text || ""
    });
  }
  if (!url) return jsx6("p", { className: "text-[11px] text-(--ui-text-quaternary)", children: i18n.previewFailed });
  if (kind === "image") {
    return jsx6("img", {
      src: url,
      alt: att.filename,
      // Centred and fitted: a large screenshot should be readable whole, not cropped.
      className: "mx-auto block max-h-full max-w-full rounded object-contain"
    });
  }
  if (kind === "pdf") {
    return jsx6("iframe", { src: url, title: att.filename, className: "h-[75vh] w-full border-0 rounded" });
  }
  if (kind === "html") {
    return jsx6("iframe", { src: url, title: att.filename, sandbox: "", className: "h-[75vh] w-full border-0 rounded" });
  }
  return jsx6("p", { className: "text-[11px] text-(--ui-text-quaternary)", children: i18n.previewFailed });
}
async function fetchAttachments(taskId, board) {
  const payload = await apiFetch(
    `/tasks/${taskId}/attachments?board=${encodeURIComponent(board || "")}`
  );
  return payload && payload.attachments || [];
}
async function downloadAttachment(taskId, board, att, i18n) {
  try {
    const data = await fetchAttachment(taskId, board, att.id);
    const bytes = data.encoding === "base64" ? Uint8Array.from(atob(data.text || ""), (c) => c.charCodeAt(0)) : new TextEncoder().encode(data.text || "");
    const url = URL.createObjectURL(new Blob([bytes], {
      type: data.content_type || "application/octet-stream"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = data.filename || att.filename || "attachment";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  } catch (error) {
    host.notify({ kind: "error", message: `${i18n.previewFailed} — ${att.filename}` });
  }
}
function priorityDisplay(priority) {
  const value = Number(priority);
  if (!Number.isFinite(value) || value <= 0) {
    return jsx6("span", { className: "text-(--ui-text-quaternary)", children: "—" });
  }
  return jsxs6("span", {
    className: "inline-flex items-center gap-0.5 font-medium",
    style: { color: "#e0a13a" },
    children: [jsx6(Codicon5, { name: "arrow-up", size: "0.65rem" }), String(value)]
  });
}
function attachmentIconName(kind) {
  if (kind === "markdown") return "markdown";
  if (kind === "image") return "file-media";
  return "file";
}
function attachmentPreviewState(taskId, board, att, siblings) {
  const list = siblings && siblings.length ? siblings : [att];
  return { taskId, board, att, siblings: list };
}
function AttachmentActions({ taskId, board, att, i18n, onPreview, iconSize }) {
  const size = iconSize || "0.7rem";
  return jsxs6("div", { className: "flex shrink-0 items-center gap-0.5", children: [
    previewKind(att.filename, att.content_type) ? jsx6(Button5, {
      size: "icon-xs",
      variant: "ghost",
      "aria-label": i18n.previewMarkdown(att.filename),
      title: i18n.previewMarkdown(att.filename),
      onClick: () => onPreview(att),
      children: jsx6(Codicon5, { name: "eye", size })
    }) : null,
    jsx6(Button5, {
      size: "icon-xs",
      variant: "ghost",
      "aria-label": i18n.downloadAttachment(att.filename),
      title: i18n.downloadAttachment(att.filename),
      onClick: () => void downloadAttachment(taskId, board, att, i18n),
      children: jsx6(Codicon5, { name: "cloud-download", size })
    })
  ] });
}
function AttachmentLine({ taskId, board, att, i18n, onPreview, iconSize, hoverable }) {
  return jsxs6("li", {
    className: cn3(
      "flex min-w-0 items-center gap-1.5 text-[11px] text-(--ui-text-secondary)",
      hoverable && "rounded px-2 py-1 hover:bg-(--chrome-action-hover)"
    ),
    children: [
      // The name IS the gesture: clicked, it opens the preview — when the webview can show the
      // type. Otherwise it stays plain text rather than pretending to be a link.
      previewKind(att.filename, att.content_type) ? jsx6("button", {
        type: "button",
        className: cn3(
          "min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left cursor-pointer",
          "text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:underline"
        ),
        title: i18n.previewMarkdown(att.filename),
        "aria-label": i18n.previewMarkdown(att.filename),
        onClick: () => onPreview(att),
        children: att.filename
      }) : jsx6("button", {
        // Not previewable: the name is still a gesture, and the only useful one is the
        // download. The tooltip says so instead of promising a preview that cannot happen.
        type: "button",
        className: cn3(
          "min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left cursor-pointer",
          "text-(--ui-text-secondary) hover:text-(--ui-text-primary) hover:underline"
        ),
        title: i18n.downloadAttachment(att.filename),
        "aria-label": i18n.downloadAttachment(att.filename),
        onClick: () => void downloadAttachment(taskId, board, att, i18n),
        children: att.filename
      }),
      jsx6(AttachmentActions, { taskId, board, att, i18n, onPreview, iconSize })
    ]
  }, att.id);
}
function AttachmentMenu({ taskId, board, count, i18n, onPreview, className }) {
  const [wanted, setWanted] = useState4(false);
  const query = useQuery2({
    queryKey: ["kanban-gantt", "attachments", taskId, board],
    queryFn: () => fetchAttachments(taskId, board),
    enabled: wanted
  });
  if (!(Number(count) > 0)) return null;
  const attachments = query.data || [];
  const countLabel = i18n.attachments(count);
  const triggerBody = jsx6(Codicon5, { name: "attach", size: "0.8rem" });
  return jsxs6(DropdownMenu3, { children: [
    jsx6(DropdownMenuTrigger3, {
      asChild: true,
      children: jsx6("button", {
        type: "button",
        className: cn3(
          "shrink-0 inline-flex items-center justify-center rounded p-0.5 border-0 bg-transparent cursor-pointer",
          "text-(--ui-text-tertiary) hover:text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)",
          className
        ),
        title: countLabel,
        "aria-label": countLabel,
        // The name cell is a drag handle and opens the detail on click: the paperclip must
        // not do either.
        onClick: (event) => {
          event.stopPropagation();
          setWanted(true);
        },
        onPointerDown: (event) => event.stopPropagation(),
        onPointerEnter: () => setWanted(true),
        children: triggerBody
      })
    }),
    jsxs6(DropdownMenuContent3, {
      align: "end",
      className: "min-w-[17rem] p-1 text-xs",
      children: [
        jsx6("div", {
          className: "px-2 py-1 text-[10px] uppercase font-semibold text-(--ui-text-tertiary)",
          children: countLabel
        }),
        // The list arrives on demand: say so rather than showing an empty menu.
        query.isLoading ? jsx6("div", { className: "grid h-10 place-items-center", children: jsx6(Loader, {}) }) : query.isError ? jsx6("p", {
          className: "px-2 py-1 text-[11px] text-(--ui-text-quaternary)",
          children: i18n.previewFailed
        }) : jsx6("ul", {
          className: "flex flex-col gap-0.5",
          children: attachments.map(
            (att) => jsx6(AttachmentLine, {
              taskId,
              board,
              att,
              i18n,
              hoverable: true,
              onPreview: (item) => onPreview(item, attachments)
            })
          )
        })
      ]
    })
  ] });
}
function AttachmentPreview({ taskId, board, att, siblings, i18n, onClose, onNavigate }) {
  const query = useQuery2({
    queryKey: ["kanban-gantt", "attachment", taskId, att.id],
    queryFn: () => fetchAttachment(taskId, board, att.id)
  });
  const list = siblings && siblings.length ? siblings : [att];
  const index = Math.max(0, list.findIndex((item) => item.id === att.id));
  useEffect3(() => {
    if (list.length < 2) return void 0;
    const onKey = (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const tag = event.target && event.target.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target && event.target.isContentEditable) return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      onNavigate(list[(index + step + list.length) % list.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, index, onNavigate]);
  const kind = previewKind(att.filename, att.content_type);
  const titleIcon = attachmentIconName(kind);
  return jsx6(Dialog4, {
    open: true,
    onOpenChange: (next) => {
      if (!next) onClose();
    },
    children: jsxs6(DialogContent4, {
      // Room to read in: a wide document, a large image. The old box was a keyhole for both,
      // and a fixed height rather than a viewport one.
      className: "flex h-[92vh] w-[min(92rem,96vw)] max-w-none flex-col overflow-hidden p-0",
      children: [
        // Header: the file's icon and name, and NOTHING else. Keeping the navigation out of
        // this row is what stops it from colliding with the dialog's own close button.
        jsxs6("div", {
          className: "flex shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-4 py-2.5 pr-12",
          children: [
            jsx6(Codicon5, { name: titleIcon, size: "0.85rem", className: "shrink-0 text-(--ui-text-tertiary)" }),
            jsx6(DialogTitle4, {
              className: "min-w-0 flex-1 truncate text-[12px] font-medium",
              children: i18n.previewTitle(att.filename)
            })
          ]
        }),
        jsx6("div", {
          className: "min-h-0 flex-1 overflow-auto px-4 py-3",
          children: query.isLoading ? jsx6("div", { className: "grid h-24 place-items-center", children: jsx6(Loader, {}) }) : query.isError || !query.data ? jsx6("p", { className: "text-[11px] text-(--ui-text-quaternary)", children: i18n.previewFailed }) : jsx6(AttachmentBody, { att, data: query.data, i18n })
        }),
        // The toolbar: navigation on the left, the file's own action on the right. A real bar
        // of its own — the arrows used to float over the header and crowd the close button.
        jsxs6("div", {
          className: "flex shrink-0 items-center gap-1 border-t border-(--ui-stroke-tertiary) px-3 py-1.5",
          children: [
            // Nothing at all when the task has a single file: no empty strip, no dead arrows.
            list.length > 1 ? jsxs6("div", { className: "flex items-center gap-0.5", children: [
              jsx6(Button5, {
                size: "icon-xs",
                variant: "ghost",
                "aria-label": i18n.previousAttachment,
                title: i18n.previousAttachment,
                disabled: index === 0,
                onClick: () => onNavigate(list[(index - 1 + list.length) % list.length]),
                children: jsx6(Codicon5, { name: "chevron-left", size: "0.85rem" })
              }),
              jsx6("span", {
                className: "px-1 text-[10px] tabular-nums text-(--ui-text-tertiary)",
                children: i18n.attachmentPosition(index + 1, list.length)
              }),
              jsx6(Button5, {
                size: "icon-xs",
                variant: "ghost",
                "aria-label": i18n.nextAttachment,
                title: i18n.nextAttachment,
                disabled: index === list.length - 1,
                onClick: () => onNavigate(list[(index + 1) % list.length]),
                children: jsx6(Codicon5, { name: "chevron-right", size: "0.85rem" })
              })
            ] }) : null,
            jsx6("div", {
              className: "ml-auto flex items-center gap-0.5",
              children: jsx6(Button5, {
                size: "icon-xs",
                variant: "ghost",
                "aria-label": i18n.downloadAttachment(att.filename),
                title: i18n.downloadAttachment(att.filename),
                onClick: () => void downloadAttachment(taskId, board, att, i18n),
                children: jsx6(Codicon5, { name: "cloud-download", size: "0.8rem" })
              })
            })
          ]
        })
      ]
    })
  });
}
function AttachmentsSection({ taskId, board, attachments, i18n, onPreview }) {
  if (!attachments || !attachments.length) return null;
  return jsxs6("div", { className: "flex flex-col gap-1", children: [
    jsx6("div", {
      className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)",
      children: i18n.attachments(attachments.length)
    }),
    jsx6("ul", { className: "flex flex-col gap-0.5", children: attachments.map(
      (att) => jsx6(AttachmentLine, {
        taskId,
        board,
        att,
        i18n,
        onPreview,
        iconSize: "0.75rem"
      })
    ) }, "attachments")
  ] });
}
function TaskDrawer({ taskId, board, onClose, assignees = [], tasks = [], docked = false, onToggleDock, boards = [] }) {
  const drawerW = useValue2($drawerW);
  const detailModal = useValue2($detailModal);
  const i18n = useGanttI18n();
  const queryClient = useQueryClient2();
  const scrollContainerRef = useRef2(null);
  const prevTaskIdRef = useRef2(null);
  const [moveBoardOpen, setMoveBoardOpen] = useState4(false);
  const [previewAtt, setPreviewAtt] = useState4(null);
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
  const [showAllComments, setShowAllComments] = useState4(false);
  const [feedTab, setFeedTab] = useState4("comments");
  const [cliCopied, setCliCopied] = useState4(false);
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
  const drawerTitle = splitTitlePrefix(data?.task?.title);
  const drawerName = drawerTitle.rest || titleText(data?.task?.title) || i18n.untitled;
  const showPrefixTags = useValue2($titlePrefixTags);
  const cliBoard = data?.task?.board || board || "";
  const cliCommand = cliBoard ? `hermes kanban --board ${cliBoard} show ${shownId}` : `hermes kanban show ${shownId}`;
  const inner = [
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
              // Docking the panel beside the gantt only means something for the
              // panel: in the modal there is nothing to dock or undock.
              detailModal ? null : jsx6(Button5, { size: "icon-xs", variant: "ghost", onClick: onToggleDock, "aria-label": docked ? i18n.undockDrawer : i18n.dockDrawer, title: docked ? i18n.undockDrawer : i18n.dockDrawer, children: docked ? "»" : "«" }),
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
              // Same detail, two presentations: the panel beside the gantt or a
              // centred modal. The switch sits next to the close button — where a
              // window-level control belongs — and its icon shows which way it goes.
              jsx6(Button5, {
                size: "icon-xs",
                variant: "ghost",
                onClick: () => $detailModal.set(!detailModal),
                "aria-label": detailModal ? i18n.dockDetail : i18n.openInModal,
                title: detailModal ? i18n.dockDetail : i18n.openInModal,
                children: jsx6(Codicon5, { name: detailModal ? "screen-normal" : "screen-full", size: "0.75rem" })
              }),
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
        // Title kept always visible — verbatim, with the prefix as a tag only when
        // the reader asked for tags.
        jsxs6("div", {
          className: "flex flex-wrap items-start gap-1.5 text-base font-semibold leading-snug",
          children: [
            showPrefixTags && drawerTitle.prefix ? jsx6("span", {
              className: "shrink-0 rounded-sm font-semibold",
              style: {
                padding: "0 4px",
                fontSize: "10px",
                lineHeight: "1.5",
                color: "var(--ui-text-secondary)",
                backgroundColor: "var(--ui-bg-tertiary)",
                border: "1px solid var(--ui-stroke-tertiary)"
              },
              children: drawerTitle.prefix
            }) : null,
            jsx6("span", { className: "min-w-0", children: drawerName })
          ]
        })
      ]
    }),
    // Scrollable content underneath the pinned header + title
    isLoading ? jsx6("div", { className: "py-8 flex justify-center", children: jsx6(Loader, {}) }) : isError ? jsx6(ErrorState, { title: i18n.taskUnreadable, description: i18n.taskUnreadableDesc }) : jsxs6("div", { ref: scrollContainerRef, className: "flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pt-1", children: [
      // 0. Relations — parents (removable, behind a confirmation) and
      //    children (read-only for now: removing that link means
      //    re-parenting the child itself). Clicking a name opens that
      //    task's detail, which also selects its row in the gantt.
      //    In the modal both belong to the right-hand column, like the priority and the
      //    attachments, so this block yields to it rather than repeating them.
      // Parents only when there are some, like the children below: an empty relation block
      // is noise in every mode.
      detailModal || relations.parents.length === 0 ? null : jsx6(TaskRelations, {
        heading: i18n.parents,
        tasks: relations.parents,
        onOpen: (id) => $openTaskId.set(id),
        onRemove: (id) => {
          const parent = relations.parents.find((t) => t.id === id);
          setPendingUnlink({ id, title: parent ? parent.title : id });
        },
        removeLabel: i18n.removeParentLink,
        openLabel: i18n.openTask,
        disabled: unlinkMutation.isPending
      }),
      // Children only when there are some: "no children" on every leaf task is noise, and
      // most tasks are leaves. Parents keep their empty state, which is informative.
      detailModal || relations.children.length === 0 ? null : jsx6(TaskRelations, {
        heading: i18n.children,
        tasks: relations.children,
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
          className: "border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
          children: jsx6(MessageTextContent, { media: false, text: data.task.body })
        }) : jsx6("p", { className: "text-[11px] text-(--ui-text-quaternary)", children: i18n.noDescription })
      ] }),
      // 1b. Attachments and the priority line, for the DOCKED detail and its panel: in the
      // modal both belong to the right-hand column instead, so this block yields to it
      // rather than duplicating them in the body.
      detailModal ? null : jsx6(AttachmentsSection, {
        taskId: shownId,
        board,
        i18n,
        attachments: data?.task?.attachments || [],
        onPreview: (att) => setPreviewAtt(att)
      }),
      detailModal ? null : jsxs6("div", {
        className: "flex flex-col gap-0.5",
        children: [
          jsx6("div", {
            className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)",
            children: i18n.metaPriority
          }),
          priorityDisplay(data?.task?.priority)
        ]
      }),
      previewAtt ? jsx6(AttachmentPreview, {
        taskId: shownId,
        board,
        i18n,
        att: previewAtt,
        // Same task, same list: the arrows walk the task's other attachments.
        siblings: data?.task?.attachments || [previewAtt],
        onNavigate: (att) => setPreviewAtt(att),
        onClose: () => setPreviewAtt(null)
      }) : null,
      // 2. Result (no max-h clamp)
      data?.task?.result ? jsxs6("div", { className: "flex flex-col gap-1", children: [
        jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.result }),
        jsx6("div", {
          className: "border border-(--ui-stroke-tertiary) rounded p-2 bg-(--ui-bg-subtle, transparent)",
          children: jsx6(MessageTextContent, { media: false, text: data.task.result })
        })
      ] }) : null,
      // 3. Latest summary (highlighted when blocked or done/completed)
      data?.task?.latest_summary ? jsxs6("div", { className: "flex flex-col gap-1", children: [
        jsx6("div", { className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)", children: i18n.latestSummary }),
        jsx6("div", {
          className: cn3(
            "rounded p-2.5 transition-colors",
            data?.task?.status === "blocked" ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : data?.task?.status === "done" || data?.task?.status === "archived" ? "border border-emerald-500/35 bg-emerald-500/10" : "border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent)"
          ),
          children: jsx6(MessageTextContent, { media: false, text: data.task.latest_summary })
        })
      ] }) : null,
      // 4. Les exécutions ont leur propre onglet dans le flux (plus bas) : le bloc repliable
      //    qui vivait ici faisait doublon avec lui.
      // 5. Commentaires (Collapsible section, open by default, 3 latest by default with button to show previous, no internal scrollbar)
      (() => {
        const commentsList = data?.task?.comments || [];
        const totalComments = commentsList.length;
        const visibleComments = showAllComments ? commentsList : commentsList.slice(-3);
        const hiddenCount = totalComments - visibleComments.length;
        const eventsList = data?.task?.events || [];
        const runsList = data?.task?.runs || [];
        const activeTab = feedTab === "activity" && eventsList.length === 0 ? "comments" : feedTab === "runs" && runsList.length === 0 ? "comments" : feedTab;
        return jsxs6("div", { className: "border-t border-(--ui-stroke-tertiary) pt-2 flex flex-col gap-1.5", children: [
          // The feed strip: same segmented idiom as the view toggle, and each label carries
          // its count, so the reader knows there is something to see before clicking.
          jsxs6("span", {
            role: "group",
            className: "inline-flex items-center gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-0.5 self-start",
            children: [
              jsx6(FeedTab, { label: i18n.tabComments, count: totalComments, ariaLabel: i18n.comments(totalComments), active: activeTab === "comments", onClick: () => setFeedTab("comments") }),
              eventsList.length ? jsx6(FeedTab, { label: i18n.tabActivity, count: eventsList.length, ariaLabel: i18n.activity(eventsList.length), active: activeTab === "activity", onClick: () => setFeedTab("activity") }) : null,
              runsList.length ? jsx6(FeedTab, { label: i18n.tabRuns, count: runsList.length, ariaLabel: i18n.runs(runsList.length), active: activeTab === "runs", onClick: () => setFeedTab("runs") }) : null
            ]
          }),
          activeTab === "comments" ? jsxs6("div", { className: "flex flex-col gap-1.5 pt-1", children: [
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
                  jsx6("div", { className: "min-w-0", children: jsx6(MessageTextContent, { media: false, text: c.body || "" }) })
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
          ] }) : null,
          // Les deux autres panneaux du flux : les événements et les runs que la route de
          // détail renvoie déjà. Chacun n'est monté que si son onglet est actif, et l'onglet
          // n'est offert que s'il y a de quoi lire.
          activeTab === "activity" ? jsx6("div", { className: "flex flex-col gap-0.5 max-h-40 overflow-auto", children: eventsList.slice(-12).reverse().map((e, i) => {
            const when2 = e.created_at ? new Intl.DateTimeFormat(void 0, { dateStyle: "short", timeStyle: "short" }).format(new Date(e.created_at * 1e3)) : "";
            return jsxs6("div", { key: e.id || i, className: "flex items-baseline gap-1.5 text-[10px] text-(--ui-text-tertiary)", children: [
              jsx6("span", { className: "text-(--ui-text-secondary)", children: String(e.kind || "event") }),
              e.actor ? jsx6("span", { children: e.actor }) : null,
              when2 ? jsx6("span", { className: "ml-auto text-(--ui-text-quaternary)", children: when2 }) : null
            ] });
          }) }) : null,
          activeTab === "runs" ? jsx6("div", { className: "flex flex-col gap-2", children: runsList.map((r, i) => {
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
                r.summary ? jsx6("div", { className: "mt-1 pt-1 border-t border-(--ui-stroke-tertiary)/50", children: jsx6(MessageTextContent, { media: false, text: r.summary }) }) : null
              ]
            });
          }) }) : null
        ] });
      })()
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
    }),
    // No CLI block in the docked panel: a command has to stay readable, and that panel
    // is narrow by design. The drawer (overlay) and the modal both have the room.
    docked ? null : jsxs6("div", { className: "flex flex-col gap-1", children: [
      jsx6("div", {
        className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)",
        children: i18n.cli
      }),
      jsx6("div", { className: "flex items-start gap-1.5", children: [
        // `select-all` because a command is read by selecting it: the copy button is a
        // convenience, not the only way, and a partial selection here is never what
        // anyone wanted.
        jsx6("code", {
          className: "flex-1 min-w-0 select-all break-all rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-subtle, transparent) px-1.5 py-1 font-mono text-[10.5px] text-(--ui-text-secondary)",
          children: cliCommand
        }),
        jsx6("button", {
          type: "button",
          className: "shrink-0 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 py-1 text-[10.5px] text-(--ui-text-secondary) cursor-pointer hover:bg-(--chrome-action-hover)",
          title: i18n.copyCommand,
          "aria-label": i18n.copyCommand,
          onClick: () => {
            void navigator.clipboard.writeText(cliCommand);
            setCliCopied(true);
            window.setTimeout(() => setCliCopied(false), 2e3);
          },
          children: cliCopied ? i18n.copied : "⧉"
        })
      ] })
    ] })
  ];
  if (!detailModal) {
    return jsxs6("div", {
      className: docked ? "relative flex flex-col h-full min-h-0 border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) pt-3.5 px-4" : "absolute inset-y-0 right-0 z-50 max-w-full border-l border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) shadow-xl flex flex-col pt-3.5 px-4",
      "data-glass-opaque": true,
      role: "dialog",
      "aria-label": i18n.taskDetail,
      style: { width: `${drawerW}px` },
      children: inner
    });
  }
  const task = data?.task;
  const when = (ts) => ts ? new Date(Number(ts) * 1e3).toLocaleString() : "—";
  const metaRow = (label, value) => jsxs6("div", { className: "flex flex-col gap-0.5", children: [
    jsx6("div", {
      className: "text-[10px] uppercase font-semibold text-(--ui-text-quaternary)",
      children: label
    }),
    jsx6("div", { className: "break-words text-[11px] text-(--ui-text-secondary)", children: value })
  ] });
  return jsx6(Dialog4, {
    open: true,
    onOpenChange: (next) => {
      if (!next) onClose();
    },
    children: jsx6(DialogContent4, {
      className: "flex max-h-[min(84vh,54rem)] w-[min(62rem,94vw)] max-w-none flex-col overflow-hidden",
      children: jsxs6("div", { className: "flex min-h-0 flex-1 gap-4", children: [
        jsx6("div", { className: "min-w-0 flex-1 overflow-y-auto pr-1", children: inner }),
        jsxs6("aside", {
          className: "flex w-56 shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-(--ui-stroke-tertiary) pl-3",
          children: [
            jsx6("div", {
              className: "text-[10px] uppercase font-semibold text-(--ui-text-tertiary)",
              children: i18n.detailMeta
            }),
            metaRow(i18n.metaStatus, task?.status || "—"),
            metaRow(i18n.metaAssignee, task?.assignee || "—"),
            metaRow(i18n.metaPriority, priorityDisplay(task?.priority)),
            task?.workspace_path ? metaRow(i18n.metaWorkspace, task.workspace_path) : null,
            metaRow(i18n.metaCreated, when(task?.created_at)),
            metaRow(
              i18n.metaLastActivity,
              when(task?.completed_at || task?.started_at || task?.created_at)
            ),
            // The files as a real section, with their eye and their download, rather than a
            // comma-joined list of names: the modal's right column is where the official plugin
            // puts them, and it is the only place here that has the room for the actions.
            task?.attachments?.length ? jsx6(AttachmentsSection, {
              taskId: shownId,
              board,
              i18n,
              attachments: task.attachments,
              onPreview: (att) => setPreviewAtt(att)
            }) : null,
            // Relations follow the priority and the files: this column is where the modal keeps
            // the facts about a task, and the body below it is for reading material.
            relations.parents.length === 0 ? null : jsx6(TaskRelations, {
              heading: i18n.parents,
              tasks: relations.parents,
              onOpen: (id) => $openTaskId.set(id),
              onRemove: (id) => {
                const parent = relations.parents.find((t) => t.id === id);
                setPendingUnlink({ id, title: parent ? parent.title : id });
              },
              removeLabel: i18n.removeParentLink,
              openLabel: i18n.openTask,
              disabled: unlinkMutation.isPending
            }),
            relations.children.length === 0 ? null : jsx6(TaskRelations, {
              heading: i18n.children,
              tasks: relations.children,
              onOpen: (id) => $openTaskId.set(id),
              openLabel: i18n.openTask
            })
          ]
        })
      ] })
    })
  });
}
function modifierKeyLabel() {
  const platform = typeof navigator === "undefined" ? "" : String(navigator.platform || navigator.userAgent || "");
  return /mac/i.test(platform) ? "⌘" : "Ctrl";
}
function KanbanGanttRoute() {
  const board = useValue2($boardSlug);
  return jsx6(KanbanGanttPage, { key: board || "none" });
}
function KanbanGanttPage() {
  const i18n = useGanttI18n();
  const queryClient = useQueryClient2();
  const base = useValue2($baseUrl);
  const board = useValue2($boardSlug);
  const scope = useValue2($connectionScope);
  const openTaskId = useValue2($openTaskId);
  const openAttachment = useValue2($openAttachment);
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
  const prefKey = (k) => board ? `${k}@${board}` : k;
  const readPref = (k, fallback = null) => {
    const s = getStorage();
    if (!s) return fallback;
    const scoped = s.get(prefKey(k), null);
    return scoped == null ? s.get(k, fallback) : scoped;
  };
  const writePref = (k, v) => {
    const s = getStorage();
    if (s) s.set(prefKey(k), v);
  };
  const [viewMode, setViewMode] = useState4(() => {
    const saved = readPref("viewMode");
    return saved === "list" || saved === "graph" ? saved : "timeline";
  });
  const graphMode = viewMode === "graph";
  const [graphZoomPct, setGraphZoomPct] = useState4(() => {
    const s = getStorage();
    const saved = Number(readPref("graphZoomPct"));
    const lo = Math.round(GRAPH_ZOOM_MIN * 100);
    const hi = Math.round(GRAPH_ZOOM_MAX * 100);
    return Number.isFinite(saved) && saved >= lo && saved <= hi ? saved : 100;
  });
  const handleGraphZoomPct = (next) => {
    const lo = Math.round(GRAPH_ZOOM_MIN * 100);
    const hi = Math.round(GRAPH_ZOOM_MAX * 100);
    const clamped = Math.min(hi, Math.max(lo, Math.round(next)));
    setGraphZoomPct(clamped);
    writePref("graphZoomPct", String(clamped));
  };
  const [cardsTall, setCardsTall] = useState4(() => readPref("cardsTall") !== "0");
  const handleCardsTall = (next) => {
    setCardsTall(next);
    writePref("cardsTall", next ? "1" : "0");
  };
  const [graphScope, setGraphScope] = useState4(() => {
    const s = readPref("graphScope");
    return ["all", "open", "running-lineage"].includes(s) ? s : "all";
  });
  const handleGraphScope = (next) => {
    setGraphScope(next);
    writePref("graphScope", next);
  };
  const [period, setPeriod] = useState4(() => {
    const span = Number(readPref("period"));
    if (!(span > 0)) return null;
    const zoom = Number(readPref("zoomPct"));
    const calibrated = Number(readPref("periodZoomPct"));
    if (!(zoom > 0) || !(calibrated > 0)) return null;
    return Math.abs(zoom - calibrated) / calibrated <= 0.25 ? span : null;
  });
  const listMode = viewMode === "list";
  const handleViewMode = (mode) => {
    setViewMode(mode);
    writePref("viewMode", mode);
  };
  const [zoomPct, setZoomPct] = useState4(() => {
    const s = getStorage();
    if (!s) return ZOOM_PCT_MIN;
    const pct = readPref("zoomPct");
    if (pct != null) return clampZoomPct(pct);
    const legacy = Number(s.get("zoom", null));
    if (!Number.isFinite(legacy) || legacy <= 0) return ZOOM_PCT_MIN;
    return zoomPctFromFactor(legacy, ZOOM_MIN_FACTOR, 28);
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
  const [onlyAttachments, setOnlyAttachments] = useState4(() => {
    const saved = getStorage() ? getStorage().get("onlyAttachments", null) : null;
    return saved === "1" || saved === true;
  });
  const toggleOnlyAttachments = (next) => {
    setOnlyAttachments(Boolean(next));
    if (getStorage()) getStorage().set("onlyAttachments", next ? "1" : "0");
  };
  const derived = useMemo2(() => {
    if (!data || !data.tasks) return null;
    let visible = data.tasks;
    if (!showArchived) visible = visible.filter((t) => !t.archived);
    if (onlyAttachments) visible = visible.filter(hasAttachments);
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
  }, [data, showArchived, onlyAttachments, disabledStatuses, selectedAssignees, search, fold, openTaskId]);
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
        $openTaskId.set(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, derived]);
  const bulkMutation = useMutation({
    // `assignee` must travel: the backend switches to mass-assign on its
    // presence ('' = unassign). Dropping it sent a bare action 'assign', which
    // the backend refused as unknown, so a batch assign never stored anything.
    mutationFn: ({ action, ids, assignee }) => apiFetch(`/tasks/bulk${board ? `?board=${encodeURIComponent(board)}` : ""}`, {
      method: "POST",
      body: assignee !== void 0 ? { ids, assignee } : { ids, action }
    }),
    onSuccess: (response) => {
      const failed = (response?.results || []).filter((r) => !r.ok);
      if (failed.length > 0) {
        toast("error", i18n.bulkFailed(failed.length, failed[0]?.error || failed[0]?.id));
      }
      setSelectedIds(/* @__PURE__ */ new Set());
      setBulkAssignee("");
      void queryClient.invalidateQueries({ queryKey: ["kanban-gantt"] });
    },
    onError: (error2) => toast("error", String(error2?.message || error2))
  });
  const assigneeChoices = useMemo2(() => {
    const fromBoard = derived && derived.allAssignees || [];
    const fromProfiles = profilesData && profilesData.profiles || [];
    return Array.from(/* @__PURE__ */ new Set([...fromProfiles, ...fromBoard])).sort();
  }, [derived, profilesData]);
  const handleZoomPct = (val) => {
    const next = clampZoomPct(val);
    setZoomPct(next);
    writePref("zoomPct", next);
    if (zoomWatch.current && !calibrating.current) zoomWatch.current(next);
  };
  const titlePrefixTags = useValue2($titlePrefixTags);
  const handleTitlePrefixTags = (next) => {
    $titlePrefixTags.set(next);
    if (getStorage()) getStorage().set("titlePrefixTags", next);
  };
  useEffect3(() => {
    const s = getStorage();
    if (!s) return;
    const saved = s.get("titlePrefixTags", null);
    if (saved != null) $titlePrefixTags.set(saved === true || saved === "1");
  }, []);
  const openTabs = useValue2($openBoards);
  const persistTabs = (list) => {
    $openBoards.set(list);
    const s = getStorage();
    if (s) s.set(openBoardsKey(), JSON.stringify(list));
  };
  const openBoardInTabs = (slug) => {
    const list = $openBoards.get();
    if (!slug || list.includes(slug)) return;
    persistTabs([...list, slug]);
  };
  const closeBoardTab = (slug) => {
    const list = $openBoards.get();
    const next = list.filter((b) => b !== slug);
    if (!next.length) return;
    persistTabs(next);
    if (slug === board) setBoard(next[next.length - 1]);
  };
  useEffect3(() => {
    const s = getStorage();
    let list = [];
    if (s) {
      const raw = s.get(openBoardsKey(), null);
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) list = parsed.filter((x) => typeof x === "string" && x);
      } catch {
        list = [];
      }
    }
    if (board && !list.includes(board)) list = [...list, board];
    if (list.join("|") !== $openBoards.get().join("|")) $openBoards.set(list);
  }, []);
  const setBoard = (slug) => {
    $boardSlug.set(slug);
    if (getStorage()) getStorage().set(boardStorageKey(), slug);
    setSearch("");
    void queryClient.invalidateQueries({ queryKey: ["kanban-gantt", "gantt"] });
    if (slug) openBoardInTabs(slug);
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
  void nowTick;
  const now = Date.now() / 1e3;
  const rows = derived?.rows || [];
  const domain = derived?.domain || { min: now - 7 * DAY, max: now };
  const visibleWidth = Math.max(trackW - labelW - 24, 300);
  const baseDayWidth = visibleWidth / 7;
  const basePerSec = baseDayWidth / DAY;
  const zoomCeiling = visibleWidth / 6;
  const zoomMax = maxZoom(basePerSec, zoomCeiling);
  const zoomUsed = zoomFactorFromPct(zoomPct, ZOOM_MIN_FACTOR, zoomMax);
  const pxPerSec = basePerSec * zoomUsed;
  const timelineW = Math.max(1, Math.ceil((domain.max - domain.min) * pxPerSec));
  const zoomAnchor = useRef2(null);
  useEffect3(() => {
    const host2 = containerRef.current;
    if (!host2) return void 0;
    const onWheel = (event) => {
      const pan = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (!pan) return;
      const intent = wheelIntent(event);
      if (intent === "scroll") return;
      const el = scrollerRef.current;
      event.preventDefault();
      event.stopPropagation();
      if (intent === "pan") {
        if (el) el.scrollLeft += pan;
        return;
      }
      if (!el || !el.contains(event.target)) return;
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
      const rect = el.getBoundingClientRect();
      const cursorPx = event.clientX - rect.left - labelW;
      const at = domain.min + (el.scrollLeft + cursorPx) / pxPerSec;
      const next = clampZoomPct(zoomPctFromFactor(zoomUsed * factor, ZOOM_MIN_FACTOR, zoomMax));
      if (next === zoomPct) return;
      zoomAnchor.current = { at, cursorPx };
      handleZoomPct(next);
    };
    host2.addEventListener("wheel", onWheel, { passive: false });
    return () => host2.removeEventListener("wheel", onWheel);
  }, [domain.min, pxPerSec, labelW, zoomPct, zoomUsed, zoomMax, handleZoomPct]);
  useEffect3(() => {
    if (!openTaskId || !drawerDocked) return void 0;
    const onArrow = (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const tag = event.target && event.target.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target && event.target.isContentEditable) return;
      const order = (derived?.rows || []).map((row) => row.task.id);
      const next = neighbourId(order, openTaskId, event.key === "ArrowDown" ? 1 : -1);
      if (!next) return;
      event.preventDefault();
      $openTaskId.set(next);
      requestAnimationFrame(() => {
        const element = document.querySelector(`[data-row-id="${next}"]`);
        if (!element) return;
        element.focus();
        element.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", onArrow);
    return () => window.removeEventListener("keydown", onArrow);
  }, [openTaskId, drawerDocked, derived]);
  const resetView = () => {
    handleZoomPct(ZOOM_PCT_MIN);
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0;
  };
  useEffect3(() => {
    const el = scrollerRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, (anchor.at - domain.min) * pxPerSec - anchor.cursorPx);
  }, [zoomPct, pxPerSec, domain.min]);
  const periodRef = useRef2(null);
  periodRef.current = period;
  const lastScrollSave = useRef2(0);
  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const visible = visibleWindow({
      min: domain.min,
      pxPerSec,
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      labelW
    });
    const matched = matchPeriod(visible, now, PERIOD_TOLERANCE);
    if (matched !== periodRef.current) setPeriod(matched);
  };
  const zoomWatch = useRef2(null);
  const calibrating = useRef2(false);
  const placingUntil = useRef2(0);
  const restoreDone = useRef2(false);
  useEffect3(() => {
    if (period == null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const target = periodPxPerSec(period, el.clientWidth, labelW);
    if (target == null) return;
    const next = clampZoomPct(zoomPctFromFactor(
      clampZoom(target / basePerSec, basePerSec, zoomCeiling),
      ZOOM_MIN_FACTOR,
      zoomMax
    ));
    placingUntil.current = performance.now() + 300;
    if (next !== zoomPct) {
      calibrating.current = true;
      handleZoomPct(next);
      calibrating.current = false;
    }
    writePref("periodZoomPct", next);
  }, [period, labelW, trackW, basePerSec, zoomPct, zoomMax, zoomCeiling]);
  const evaluateZoom = (nextPct) => {
    const el = scrollerRef.current;
    if (!el || periodRef.current == null) return;
    const visible = visibleWindow({
      min: domain.min,
      pxPerSec: basePerSec * zoomFactorFromPct(nextPct, ZOOM_MIN_FACTOR, zoomMax),
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      labelW
    });
    const matched = matchPeriod(visible, Date.now() / 1e3, PERIOD_TOLERANCE);
    if (matched !== periodRef.current) setPeriod(matched);
  };
  zoomWatch.current = evaluateZoom;
  useEffect3(() => {
    if (period == null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const target = periodScrollLeft({
      from: now - period,
      to: now,
      min: domain.min,
      pxPerSec,
      clientWidth: el.clientWidth,
      labelW
    });
    if (target == null) return;
    placingUntil.current = performance.now() + 300;
    if (el.scrollLeft !== target) el.scrollLeft = target;
  }, [period, pxPerSec, labelW, trackW, nowTick, domain.min]);
  const scrollRestored = useRef2(false);
  useEffect3(() => {
    if (scrollRestored.current || period != null) return;
    const el = scrollerRef.current;
    if (!el || el.clientWidth <= 0) return;
    scrollRestored.current = true;
    const s = getStorage();
    const scroll = s ? Number(s.get("scroll", null)) : null;
    if (Number.isFinite(scroll) && scroll > 0) el.scrollLeft = scroll;
  }, [trackW, labelW, period]);
  const handlePeriod = (span) => {
    const next = period === span ? null : span;
    setPeriod(next);
    if (next != null) writePref("period", next);
  };
  const grid = rows.map((row, idx) => jsx6(TaskRow, {
    ...row,
    now,
    pxPerSec,
    min: domain.min,
    timelineW,
    listMode,
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
    // The key must identify the POSITION, not the task: on a multi-parent board a
    // task legitimately holds several rows (its primary position plus one per later
    // parent that reaches it), and keying those by task id alone hands React
    // duplicates. It then reuses and abandons nodes, so folded-away rows survive in
    // the DOM and pile up on every toggle. The primary position keys on the task
    // (stable while re-parenting within the tree); a secondary one adds the parent
    // it hangs under, which is what makes that row unique.
  }, row.secondary ? `${row.task.id}@${row.parentId}` : row.task.id));
  const STATUS_PRIORITY = ["blocked", "running", "review", "ready", "scheduled", "todo", "triage", "done", "archived"];
  const blockedCount = (derived?.tasks || []).filter((t) => t.status === "blocked").length;
  const dominantStatus = (() => {
    const present = new Set((derived?.tasks || []).map((t) => t.status));
    for (const s of STATUS_PRIORITY) {
      if (present.has(s)) return s;
    }
    return "todo";
  })();
  const dominantTone = statusTone(dominantStatus);
  const dockDrawer = Boolean(openTaskId && drawerDocked);
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
                    title: i18n.nTasksTotal(derived?.total || 0, dominantStatus),
                    style: {
                      backgroundColor: `color-mix(in srgb, ${dominantTone} 18%, transparent)`,
                      borderColor: `color-mix(in srgb, ${dominantTone} 40%, transparent)`,
                      borderWidth: "1px",
                      color: dominantTone
                    },
                    children: `${derived?.total || 0}`
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
                    assignees: derived?.allAssignees || [],
                    selectedAssignees,
                    onToggleAssignee: handleToggleAssignee,
                    onClearAssignees: handleClearAssignees,
                    disabledStatuses,
                    onToggleStatus: handleToggleStatus,
                    showArchived,
                    onToggleArchived: setShowArchived,
                    onlyAttachments,
                    onToggleOnlyAttachments: toggleOnlyAttachments
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
                  jsx6(ViewToggle, { value: viewMode, onChange: handleViewMode }),
                  // In graph mode the period selector has nothing to say (there is no time
                  // axis), so its slot carries the scopes instead — same width, same place.
                  // Scopes in graph mode, the period selector in the timeline: a graph has no time
                  // axis to slice, and since the activity band is gone there is nothing left for a
                  // window to tune.
                  graphMode ? jsx6(GraphScopeToggle, { value: graphScope, onChange: handleGraphScope }) : listMode ? null : jsx6(PeriodSelector, {
                    value: period,
                    onChange: handlePeriod,
                    disabled: false
                  }),
                  listMode ? null : jsxs6("span", { className: "inline-flex items-center gap-1.5", children: [
                    jsx6("input", {
                      type: "range",
                      min: String(graphMode ? Math.round(GRAPH_ZOOM_MIN * 100) : ZOOM_PCT_MIN),
                      max: String(graphMode ? Math.round(GRAPH_ZOOM_MAX * 100) : ZOOM_PCT_MAX),
                      step: "1",
                      value: String(graphMode ? graphZoomPct : zoomPct),
                      onInput: (event) => (graphMode ? handleGraphZoomPct : handleZoomPct)(Number(event.target.value)),
                      className: "w-24",
                      title: i18n.zoomWheelHint(modifierKeyLabel()),
                      "aria-label": graphMode ? i18n.graphZoom : i18n.zoomTimeline
                    }),
                    jsx6("span", { className: "text-[10px] tabular-nums text-(--ui-text-tertiary) w-8 text-right shrink-0", children: `${graphMode ? graphZoomPct : zoomPct}%` })
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
                  }),
                  // The view's own menu, rightmost next to the creation verb.
                  jsxs6(DropdownMenu3, { children: [
                    jsx6(DropdownMenuTrigger3, {
                      asChild: true,
                      children: jsx6("button", {
                        type: "button",
                        className: "inline-flex items-center justify-center rounded-md p-1 hover:bg-(--chrome-action-hover) cursor-pointer text-(--ui-text-secondary) border-0 bg-transparent",
                        "aria-label": i18n.viewOptions,
                        title: i18n.viewOptions,
                        children: jsx6(Codicon5, { name: "kebab-vertical", size: "0.9rem" })
                      })
                    }),
                    jsxs6(DropdownMenuContent3, {
                      align: "end",
                      className: "min-w-[17rem] p-1 text-xs",
                      children: [
                        jsxs6(DropdownMenuItem3, {
                          className: "flex items-start gap-2 px-3 py-1.5",
                          onClick: () => handleTitlePrefixTags(!titlePrefixTags),
                          children: [
                            jsx6(Codicon5, {
                              name: titlePrefixTags ? "check" : "blank",
                              size: "0.85rem",
                              className: "mt-0.5 shrink-0"
                            }),
                            jsxs6("span", { className: "flex flex-col gap-0.5 min-w-0", children: [
                              jsx6("span", { children: i18n.titlePrefixTags }),
                              jsx6("span", {
                                className: "text-[10px] text-(--ui-text-tertiary)",
                                children: i18n.titlePrefixTagsHint
                              })
                            ] })
                          ]
                        }),
                        // Only meaningful in the graph, where a card is a fixed box.
                        graphMode ? jsxs6(DropdownMenuItem3, {
                          className: "flex items-start gap-2 px-3 py-1.5",
                          onClick: () => handleCardsTall(!cardsTall),
                          children: [
                            jsx6(Codicon5, {
                              name: cardsTall ? "check" : "blank",
                              size: "0.85rem",
                              className: "mt-0.5 shrink-0"
                            }),
                            jsxs6("span", { className: "flex flex-col gap-0.5 min-w-0", children: [
                              jsx6("span", { children: i18n.cardsTall }),
                              jsx6("span", {
                                className: "text-[10px] text-(--ui-text-tertiary)",
                                children: i18n.cardsTallHint
                              })
                            ] })
                          ]
                        }) : null
                      ]
                    })
                  ] })
                ]
              })
            ]
          }),
          // Board tabs: one per open board, plus the "+" that opens another. Each tab is a full
          // page instance of its own (the route remounts on board change), so a reader can keep
          // board A in graph mode and board B in timeline, at their own zooms — the preferences
          // are stored per board. The strip is always there: with one board it is where the "+"
          // lives, and it names what you are looking at.
          jsxs6("div", {
            className: "mb-2 flex items-center gap-1 overflow-x-auto min-w-0",
            role: "tablist",
            "aria-label": i18n.boardsTabs,
            children: [
              ...openTabs.map((slug) => jsxs6("span", {
                key: slug,
                role: "tab",
                "aria-selected": slug === board ? "true" : "false",
                className: cn3(
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] whitespace-nowrap",
                  slug === board ? "border-(--ui-accent) bg-(--ui-accent)/12 text-(--ui-accent) font-medium" : "border-(--ui-stroke-secondary) text-(--ui-text-tertiary)"
                ),
                children: [
                  jsx6("button", {
                    type: "button",
                    onClick: () => setBoard(slug),
                    className: "cursor-pointer border-0 bg-transparent p-0 text-inherit",
                    title: boardLabel(slug),
                    children: boardLabel(slug)
                  }),
                  openTabs.length > 1 ? jsx6("button", {
                    type: "button",
                    onClick: (event) => {
                      event.stopPropagation();
                      closeBoardTab(slug);
                    },
                    title: i18n.closeBoard,
                    "aria-label": `${i18n.closeBoard} — ${boardLabel(slug)}`,
                    className: "inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100",
                    children: jsx6(Codicon5, { name: "close", size: "0.7rem" })
                  }) : null
                ]
              })),
              jsxs6(DropdownMenu3, {
                children: [
                  jsx6(DropdownMenuTrigger3, {
                    asChild: true,
                    children: jsx6("button", {
                      type: "button",
                      title: i18n.openBoard,
                      "aria-label": i18n.openBoard,
                      className: "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-(--ui-stroke-secondary) p-0.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)",
                      children: jsx6(Codicon5, { name: "add", size: "0.75rem" })
                    })
                  }),
                  jsxs6(DropdownMenuContent3, {
                    align: "start",
                    className: "max-h-72 overflow-auto p-1 text-xs",
                    children: [
                      ...boards.filter((b) => !openTabs.includes(b.slug)).map((b) => jsx6(DropdownMenuItem3, {
                        key: b.slug,
                        className: "px-3 py-1.5",
                        onClick: () => setBoard(b.slug),
                        children: b.label || b.slug
                      })),
                      boards.every((b) => openTabs.includes(b.slug)) || boards.length === 0 ? jsx6(DropdownMenuItem3, { disabled: true, className: "px-3 py-1.5 text-(--ui-text-quaternary)", children: i18n.noOtherBoards }) : null
                    ]
                  })
                ]
              })
            ]
          }),
          !derived ? jsx6("div", { className: "py-10 grid place-items-center", children: jsx6(Loader, {}) }) : graphMode ? jsx6(GraphView, {
            tasks: derived.tasks || [],
            i18n,
            now,
            zoom: graphZoomPct / 100,
            onZoom: (factor) => handleGraphZoomPct(factor * 100),
            scope: graphScope,
            onScopeChange: handleGraphScope,
            selectedId: openTaskId,
            // The board name earns its place only when several boards share the view, the
            // same rule the rows follow: with one board selected it is already on the
            // switcher, and repeating it on every node is noise.
            showBoardBadge: isAllBoards,
            groupLabel: boardLabel,
            board,
            dragId,
            dropMap,
            onOpen: (id) => $openTaskId.set(id),
            onDragStart: handleDragStart,
            onDragEnd: () => setDragId(null),
            onDropOn: handleDropOn,
            // New task FROM a node: the node is the parent, and the existing dialog does
            // the rest (it is the same creation verb, reached from the graph).
            onNewChild: (id) => $newTask.set({ parentId: id }),
            onClearSelection: () => $openTaskId.set(null),
            tallCards: cardsTall,
            sortBy: "status"
          }) : rows.length === 0 ? jsxs6("div", {
            className: "py-10 flex flex-col items-center gap-3",
            children: [
              jsx6(EmptyState, { title: i18n.nothingToDisplay, description: i18n.noTasksMatch }),
              // Onboarding: the first creation is the hardest step, so offer it right here
              // rather than leaving the reader to find the header button.
              jsx6(Button5, {
                size: "sm",
                variant: "default",
                onClick: () => $newTask.set({ parentId: "" }),
                children: jsxs6("span", { className: "flex items-center gap-1", children: [
                  jsx6(Codicon5, { name: "add", size: "0.85rem" }),
                  i18n.newTask
                ] })
              })
            ]
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
                assignees: assigneeChoices,
                busy: bulkMutation.isPending
              }),
              jsxs6("div", {
                ref: scrollerRef,
                className: "overflow-auto flex-1 min-h-0 relative",
                // The wheel is handled by a native listener on the page (see above): React's
                // own wheel listeners are passive, and a passive listener cannot stop the
                // desktop from zooming.
                onScroll: handleScroll,
                children: [
                  jsxs6("div", {
                    className: cn3("grid sticky top-0 z-20 bg-(--ui-bg-chrome)", listMode ? "w-full" : "w-max"),
                    "data-glass-opaque": true,
                    style: { gridTemplateColumns: listMode ? LIST_COLUMNS : `${labelW}px ${timelineW}px` },
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
                            checked: Boolean((derived?.rows?.length || 0) > 0 && selectedIds.size === derived.rows.length),
                            ref: (el) => {
                              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < (derived?.rows?.length || 0);
                            },
                            onChange: (e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set((derived?.rows || []).map((r) => r.task.id)));
                              } else {
                                setSelectedIds(/* @__PURE__ */ new Set());
                              }
                            },
                            className: "rounded cursor-pointer",
                            "aria-label": i18n.selectAll
                          }),
                          jsx6("span", { className: "text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none", children: i18n.tasksColumn }),
                          listMode ? null : jsx6(ResizeHandle, {
                            get: () => $labelW.get(),
                            set: (w) => $labelW.set(w),
                            min: LABEL_W_MIN,
                            max: LABEL_W_MAX,
                            resetTo: LABEL_W,
                            storageKey: "labelW"
                          })
                        ]
                      }),
                      ...listMode ? [
                        ...[i18n.assigneeColumn, i18n.statusColumn, i18n.lastActivityColumn].map((h, i) => jsx6("div", {
                          key: h,
                          className: cn3("flex items-center px-2 border-b border-(--ui-stroke-tertiary) text-[10px] text-(--ui-text-tertiary) uppercase font-medium select-none", i === 2 && "justify-end"),
                          style: { height: "24px" },
                          children: h
                        })),
                        // The attachment column is as narrow as a paperclip, so its header
                        // is the icon rather than a word that would never fit.
                        jsx6("div", {
                          key: "attachments-header",
                          className: "flex items-center justify-end border-b border-(--ui-stroke-tertiary) pr-2 text-(--ui-text-tertiary)",
                          style: { height: "24px" },
                          // The column is as narrow as a paperclip, so its header is the
                          // icon rather than a word that would never fit.
                          children: jsx6(Codicon5, { name: "attach", size: "0.7rem" })
                        })
                      ] : [jsx6(Ruler, { key: "ruler", min: domain.min, max: domain.max, pxPerSec, onReset: resetView })]
                    ]
                  }),
                  jsxs6("div", {
                    className: cn3("relative flex flex-col", listMode ? "w-full" : "w-max"),
                    children: [
                      listMode ? null : jsx6("div", {
                        className: "absolute top-0 bottom-0 pointer-events-none z-0",
                        style: { left: `${labelW}px`, width: `${timelineW}px` },
                        children: [
                          jsx6(WeekendBands, { min: domain.min, max: domain.max, pxPerSec }),
                          jsx6(HourLines, { min: domain.min, max: domain.max, pxPerSec })
                        ]
                      }),
                      listMode ? null : jsx6(NowLine, {
                        now,
                        min: domain.min,
                        max: domain.max,
                        pxPerSec,
                        originX: labelW
                      }),
                      grid
                    ]
                  })
                ]
              })
            ]
          }),
          // The legend describes BAR TONES, so it has nothing to say about a board with no
          // rows — and an empty state reads better with only its message and the creation verb.
          derived && rows.length > 0 ? jsx6("div", {
            children: jsx6(Legend, { disabledStatuses, onToggleStatus: handleToggleStatus })
          }) : null
        ]
      }),
      // An attachment opened from a row's paperclip: its own dialog, like the detail's.
      openAttachment ? jsx6(AttachmentPreview, {
        taskId: openAttachment.taskId,
        board: openAttachment.board,
        att: openAttachment.att,
        siblings: openAttachment.siblings || [openAttachment.att],
        onNavigate: (att) => $openAttachment.set({ ...openAttachment, att }),
        i18n,
        onClose: () => $openAttachment.set(null)
      }) : null,
      openTaskId ? jsx6(TaskDrawer, {
        taskId: openTaskId,
        board,
        assignees: assigneeChoices,
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
        assignees: assigneeChoices,
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
   Markdown is rendered by the SDK's MessageTextContent — the same renderer chat and
   the official kanban plugin use — so descriptions, run summaries and comments inherit
   the app's own markdown typography instead of a hand-written one. The kg-prose colour
   mapping that used to live here went with it: it existed only to make Tailwind
   Typography readable on the app's surfaces, and the SMALL typography variant
   (prose-sm) is not in the desktop's precompiled stylesheet at all — measured, 0
   occurrences — so the base variant's heading ratios applied and titles rendered far
   too large for an 11px body. */
`;
      document.head.appendChild(style);
    }
    ctx.registerMany([
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/kanban-gantt" },
        render: () => jsx6(KanbanGanttRoute, {})
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
  $detailModal,
  $openTaskId,
  GraphView,
  KanbanGanttPage,
  KanbanGanttRoute,
  main_default as default,
  modifierKeyLabel
};
