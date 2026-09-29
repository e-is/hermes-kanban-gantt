#!/usr/bin/env bash
# install.sh — installer du plugin desktop `kanban-gantt` (vue Gantt du board kanban sumaris).
#
# Dépose la moitié desktop (plugin.js) dans <hermes_home>/desktop-plugins/kanban-gantt/
# et la moitié backend (plugin.yaml + dashboard/) dans <hermes_home>/plugins/kanban-gantt/.
#
# Détection de l'emplacement Hermes, par ordre de priorité :
#   1. $HERMES_HOME (env)             — priorité haute
#   2. ~/.hermes                      — emplacement standalone par défaut
#   3. une racine de *profiles* Hermes (HERMES_PROFILES_DIR, sinon emplacements communs)
#
# Idempotent : reinstallable sans effet de bord (n'écrit que les fichiers du plugin,
# ne modifie JAMAIS GIT_USER_NAME / GIT_USER_EMAIL).
#
# Usage :
#   ./install.sh                  install dans l'home détecté
#   HERMES_HOME=/chemin ./install.sh   install dans un home explicite
#   ./install.sh --dry-run        affiche les actions sans rien écrire
#   ./install.sh --print-home     affiche l'home détecté et sort
set -euo pipefail

DRY_RUN=0
PRINT_HOME=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --print-home) PRINT_HOME=1 ;;
    *) echo "install.sh: option inconnue: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- résolution de l'emplacement Hermes -------------------------------------
detect_home() {
  if [[ -n "${HERMES_HOME:-}" ]]; then printf '%s' "$HERMES_HOME"; return; fi
  if [[ -d "$HOME/.hermes" ]]; then printf '%s' "$HOME/.hermes"; return; fi
  if [[ -n "${HERMES_PROFILES_DIR:-}" && -d "$HERMES_PROFILES_DIR" ]]; then
    printf '%s' "$HERMES_PROFILES_DIR"; return
  fi
  for root in /opt/data/profiles "$HOME/profiles" /data/profiles; do
    if [[ -d "$root" ]]; then printf '%s' "$root"; return; fi
  done
  printf '%s' "$HOME/.hermes"   # repli par défaut
}

HERMES_HOME="$(detect_home)"

if [[ "$PRINT_HOME" == 1 ]]; then
  echo "$HERMES_HOME"; exit 0
fi

echo "Hermes home détecté : $HERMES_HOME"

# ---- copie (idempotente) ----------------------------------------------------
install_file() {
  local src="$1" dst="$2"
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "  (dry-run) copierait : $dst"
  else
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
    echo "  installé : $dst"
  fi
}

# moitié desktop
install_file "$SCRIPT_DIR/desktop/plugin.js"                 "$HERMES_HOME/desktop-plugins/kanban-gantt/plugin.js"

# moitié backend (plugin.yaml + dashboard/)
install_file "$SCRIPT_DIR/plugin.yaml"               "$HERMES_HOME/plugins/kanban-gantt/plugin.yaml"
install_file "$SCRIPT_DIR/dashboard/manifest.json"   "$HERMES_HOME/plugins/kanban-gantt/dashboard/manifest.json"
install_file "$SCRIPT_DIR/dashboard/plugin_api.py"   "$HERMES_HOME/plugins/kanban-gantt/dashboard/plugin_api.py"
# The push route lives in its own module; without it the gateway logs
# "websocket prototype unavailable (No module named 'plugin_ws')" and silently
# serves polling only, so the page has to keep its Refresh button forever.
install_file "$SCRIPT_DIR/dashboard/plugin_ws.py"    "$HERMES_HOME/plugins/kanban-gantt/dashboard/plugin_ws.py"

echo "Fait. Dans Hermes Desktop : Ctrl+K (⌘K sur macOS) → Reload desktop plugins, puis Ctrl+K → « Kanban Gantt »"
echo "Puis activer le backend : hermes plugins enable kanban-gantt"
echo "(redémarrer le gateway pour qu'il importe le backend au démarrage)."