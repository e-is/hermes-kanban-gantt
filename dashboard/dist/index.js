/**
 * Hermes Kanban Gantt — dashboard page.
 *
 * The plugin's interface is the DESKTOP page (`desktop/plugin.js`, registered through the desktop
 * plugin SDK). The web dashboard has no way to render it, and a `dashboard/manifest.json` always
 * implies a page: without a bundle the dashboard injects a script that does not exist, and the tab
 * opens on "Could not load this plugin's script". This file is that missing page — a plain IIFE, no
 * build step (same shape as the bundled kanban plugin's), which says plainly where the timeline
 * lives instead of failing.
 *
 * The plugin's dashboard DATA surface stays what it always was: the HTTP routes in
 * `dashboard/plugin_api.py`, which the desktop page consumes. Nothing here talks to Hermes.
 */
(function () {
  "use strict";

  var sdk = window.__HERMES_PLUGIN_SDK__;
  if (!sdk || !window.__HERMES_PLUGINS__) {
    // No dashboard runtime: nothing sensible to render, and throwing would take the SPA's boundary.
    console.warn("[kanban-gantt] dashboard SDK unavailable; page not registered");
    return;
  }

  var React = sdk.React;
  var ui = sdk.components;
  var cn = sdk.utils.cn;

  var LOCALE_KEY = "hermes-locale";

  var MESSAGES = {
    en: {
      title: "Kanban Gantt",
      badge: "desktop page",
      lead: "This timeline is drawn in the Hermes desktop app, not in the web dashboard.",
      how: "Open the Kanban Gantt page from the desktop sidebar, or press Ctrl+K and search for it.",
      api: "The web dashboard exposes this plugin's data routes only — board, timeline, tasks and attachments — which the desktop page reads.",
      routes: "Routes served here"
    },
    fr: {
      title: "Kanban Gantt",
      badge: "page desktop",
      lead: "Cette timeline est dessinée dans l'application desktop Hermes, pas dans le dashboard web.",
      how: "Ouvrez la page Kanban Gantt depuis la barre latérale du desktop, ou faites Ctrl+K et cherchez-la.",
      api: "Le dashboard web n'expose que les routes de données du plugin — board, timeline, tâches et pièces jointes — que la page desktop consomme.",
      routes: "Routes servies ici"
    },
    zh: {
      title: "Kanban Gantt",
      badge: "桌面页面",
      lead: "此时间线在 Hermes 桌面应用中绘制，而非在网页仪表板中。",
      how: "请从桌面侧边栏打开 Kanban Gantt 页面，或按 Ctrl+K 搜索它。",
      api: "网页仪表板仅提供此插件的数据路由——看板、时间线、任务与附件——供桌面页面使用。",
      routes: "此处提供的路由"
    }
  };

  var ROUTES = ["GET /boards", "GET /gantt", "GET /tasks/{task_id}", "GET /tasks/{task_id}/attachments"];

  function pickLocale(active) {
    // The dashboard's own active locale (SDK useI18n) wins: it follows the language the user picked
    // in the dashboard, live. The browser preference and the shared storage key are only fallbacks
    // for a runtime where the hook is missing.
    if (MESSAGES[active]) return active;
    var short = String(active || "").toLowerCase().split("-")[0];
    if (MESSAGES[short]) return short;
    try {
      var stored = localStorage.getItem(LOCALE_KEY);
      if (stored && MESSAGES[stored]) return stored;
    } catch (_err) {
      /* private mode: fall through */
    }
    var lang = (navigator.language || "en").toLowerCase();
    if (MESSAGES[lang]) return lang;
    short = lang.split("-")[0];
    return MESSAGES[short] ? short : "en";
  }

  function KanbanGanttPage() {
    var i18n = typeof sdk.useI18n === "function" ? sdk.useI18n() : null;
    var t = MESSAGES[pickLocale(i18n && i18n.locale)];

    return React.createElement(
      "div",
      { className: cn("mx-auto flex max-w-2xl flex-col gap-4 p-6") },
      React.createElement(
        ui.Card,
        null,
        React.createElement(
          ui.CardHeader,
          null,
          React.createElement(
            "div",
            { className: cn("flex items-center gap-2") },
            React.createElement(ui.CardTitle, null, t.title),
            React.createElement(ui.Badge, { variant: "secondary" }, t.badge)
          )
        ),
        React.createElement(
          ui.CardContent,
          { className: cn("flex flex-col gap-3 text-sm text-text-secondary") },
          React.createElement("p", null, t.lead),
          React.createElement("p", null, t.how),
          React.createElement("p", null, t.api),
          React.createElement(
            "div",
            { className: cn("flex flex-col gap-1") },
            React.createElement("span", { className: cn("text-xs uppercase tracking-wide text-text-tertiary") }, t.routes),
            React.createElement(
              "ul",
              { className: cn("flex flex-col gap-0.5 font-mono text-xs") },
              ROUTES.map(function (route) {
                return React.createElement("li", { key: route }, route);
              })
            )
          )
        )
      )
    );
  }

  window.__HERMES_PLUGINS__.register("kanban-gantt", KanbanGanttPage);
})();
