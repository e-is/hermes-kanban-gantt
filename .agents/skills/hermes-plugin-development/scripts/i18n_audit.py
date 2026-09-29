#!/usr/bin/env python3
"""Find user-facing strings still hardcoded in a plugin's renderer sources.

Catches what an apostrophe-only grep silently misses: template literals
(backticks) and multi-line strings — the shape gantt/kanban copy tends to take
(bar tooltips, `Activite (${n})` section headers, "click for X" hints).

Usage:
    python3 scripts/i18n_audit.py [src_dir] [bundle_file]

    src_dir      source tree to sweep (default: ./src)
    bundle_file  the locale bundle to skip (default: i18n.ts) — it IS the
                 translated copy, so it would match everything

Exit status: 0 when clean, 1 when anything is still hardcoded, so it doubles as
the completion check for an i18n sweep. Run it with NO arguments from the
plugin repo root.
"""
import re
import sys
from pathlib import Path

FRENCH_MARKERS = re.compile(
    # An accent is the reliable tell…
    r'[àâäéèêëîïôöùûüçÀÂÉÈÊÎÔÙÛÇ]|'
    # …then only words that are unambiguously French. Do NOT add English
    # homographs here ('detail', 'description', 'cours'): they show up in
    # English UI copy and turn the run into false positives.
    r'\b(cliquer|t[âa]ches?|[eé]tat|ex[ée]cutions?|d[ée]pendances?|bloqu[ée]es?|'
    r'aucun|afficher|masquer|fermer|ajouter|supprimer|activit[ée]|s[ée]lectionner|'
    r'd[ée]marr[ée]e?|en attente|pr[ée]c[ée]dents?|assigner|r[ée]sultats?)\b',
    re.IGNORECASE,
)

# Strings that are not UI copy: class names, css values, urls, comments.
ALLOW = re.compile(
    r'^(\s*|.*(text-|font-|flex|grid|gap-|px-|py-|ml-|mr-|mt-|mb-|w-|h-|border|rounded|'
    r'bg-|items-|justify-|shrink|truncate|uppercase|tabular|select-none|cursor|hover:|'
    r'transition|absolute|relative|inline|block|hidden|opacity|overflow|whitespace|'
    r'self-|min-|max-|z-|leading|space-|divide|group|var\(|k-|@|https?:|/\*|\*).*)$'
)


def strip_comments(src: str) -> str:
    """Blank out comments WITHOUT changing line numbers (so hits match the file)."""
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    return re.sub(r'^\s*//.*$', '', src, flags=re.M)


def literals(src: str):
    """(line_no, text) for every quoted string / template literal."""
    out = []
    for m in re.finditer(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`", src, flags=re.S):
        line = src[:m.start()].count('\n') + 1
        out.append((line, m.group(0)))
    return out


def main(argv: list) -> int:
    root = Path(argv[1] if len(argv) > 1 else 'src')
    bundle = argv[2] if len(argv) > 2 else 'i18n.ts'
    if not root.is_dir():
        print(f'no such source tree: {root}', file=sys.stderr)
        return 2

    findings = []
    for path in sorted(root.rglob('*.ts*')):
        if path.name == bundle:
            continue
        src = strip_comments(path.read_text(encoding='utf-8'))
        for line, lit in literals(src):
            body = lit[1:-1]
            # Only a template's STATIC text is copy; ${...} is code.
            static = re.sub(r'\$\{[^}]*\}', '', body)
            if not FRENCH_MARKERS.search(static):
                continue
            if ALLOW.match(static) or ALLOW.match(body):
                continue
            findings.append((path, line, static.strip()[:70]))

    for path, line, text in findings:
        print(f'{path}:{line}: {text}')
    print(f'\n{len(findings)} hardcoded user-facing string(s) left')
    # Reminder for the SECOND half of the sweep, which this script cannot do:
    # diff the key sets of both locale bundles — they must match exactly, and a
    # key missing from one silently falls back to the default bundle.
    print('also diff the locale key sets (en vs fr) — they must be identical')
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
