# Benchmark / language data sources

What can be auto-refreshed for a model-dashboard plugin versus what must stay curated,
with the probe that re-verifies each claim. Providers change: RE-RUN a probe before
trusting a row, instead of redoing the whole investigation.

| Data | Source | Probe | Status |
|:---|:---|:---|:---|
| Prices, context, modalities, modality flags | OpenRouter `GET https://openrouter.ai/api/v1/models` | `curl -sS <url> \| jq '.data[0].architecture'` | no key needed; already the plugin's primary feed |
| AA indices (intelligence / coding / agentic) + OpenRouter's own runs | OpenRouter `GET https://openrouter.ai/api/v1/benchmarks?source=artificial-analysis\|design-arena\|openrouter` | `curl -sS -H "Authorization: Bearer $OPENROUTER_API_KEY" '<url>' \| jq '.meta, (.data\|length)'` | key required (present in `~/.hermes/.env` as `OPENROUTER_API_KEY`); ~154 models; `meta.citation` must be surfaced; `max_results` caps the page |
| Same, direct from the vendor | Artificial Analysis `GET https://artificialanalysis.ai/api/v2/language/models`, header `x-api-key` | `curl -sS -H "x-api-key: $KEY" https://artificialanalysis.ai/api/v2/language/models/free \| jq .tier` | free tier = 100 req/24 h, public fields only (headline indices, median perf, pricing); Pro = 500/day + full evaluation set. Attribution required, **redistribution not granted** — never commit fetched values |
| SWE-bench Verified | no API | `curl -sS "https://api.github.com/repos/SWE-bench/experiments/git/trees/main?recursive=1" \| jq -r '.tree[].path' \| grep '^evaluation/verified/' \| head` | raw runs only (`evaluation/verified/<run>/{metadata.yaml,results/}`, thousands of files); the headline figure depends on the scaffold/agent chosen, i.e. an editorial decision → keep curated |
| Aider polyglot | `raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml` | `curl -sS <url> \| head -20` | no key, ~45 KB; entries `model`, `pass_rate_1/2`, `edit_format`, `test_cases`. Measured stale for current models: 1 correct match across 19 tracked models, and fuzzy matching paired a v3.2 model with the older "V3 (0324)" row and a 4.6 with "grok-4". Only wire it with exact-slug matching plus an explicit alias table |
| LiveCodeBench | HF space / project site | — | no documented machine-readable feed; treat as curated |
| LMArena (per-language human preference) | lmarena.ai now redirects to arena.ai | `curl -sS -o /dev/null -w '%{http_code}\n' https://arena.ai/api/leaderboard/text` | every `/api/*` path probed answered `403 {"error":"Route not allowed"}`; the per-language board data exists only inside the `/leaderboard` page's RSC payload (`self.__next_f.push`, ~5 MB HTML: `rank` ×3255, `French` ×281). Parsing that payload is possible but undocumented — re-probe before investing |
| Per-model language coverage | OpenRouter model payload | `curl -sS https://openrouter.ai/api/v1/models \| jq '.data[0] \| keys'` | NO language field exists (only `architecture.{input,output}_modalities`, `tokenizer`, `supported_parameters`) |
| Per-model language coverage (fallback) | HF `cardData.language` | `curl -sS https://huggingface.co/api/models/<hf_id> \| jq '.cardData.language'` | `null` on current cards (2026-era DeepSeek / Qwen / poolside models all returned nothing) — the resolver in the code is best-effort only, so a curated language list stays the working source |
| Measured multilingual ability (if a real source is wanted) | Global-MMLU (42 languages) / MMLU-ProX (lm-eval-harness task) | — | per-model scores exist in papers/leaderboards, not as an API; switching the criterion changes its meaning from *declared coverage* to *score in the target languages* (which pairs with a target-language list), and needs a curated model→score table |

Design consequences, in priority order:

1. Cache fetched benchmark data at runtime only (`_*_cache.json`, gitignored) with source + fetch timestamp per source; ship a curated seed in the repo. Licence terms on the vendor APIs forbid redistribution of fetched values.
2. TTL by volatility, not by symmetry with prices: leaderboards move weekly, so ~24 h — a 10-minute cadence wastes requests and still shows the same numbers.
3. Normalize vendor slugs before matching (strip a trailing `-YYYYMMDD`, drop parenthetical effort/variant suffixes) and prefer the plain or "Default Fallback" variant: picking the highest index across variants silently onboards the most aggressive ("Max Effort") configuration as if it were the base model.
4. Surface `source` + date next to any curated column so staleness is visible instead of guessed.

## When curl cannot answer: the site renders server-side

Some sources expose no JSON feed at all — the numbers are streamed into the HTML
(Next.js `self.__next_f.push`), so every guessed `/api/*` path answers 403 while the
page itself is several MB of embedded data. The signature is observable in-page:
`performance.getEntriesByType('resource')` contains no `fetch`/`xmlhttprequest`
entries, and interacting with the page's own filters fires zero XHR. Read a 403 with
a JSON body (`{"error":"Route not allowed"}`) as "namespace served, route gated",
never as "no API exists".

Before writing the source off, drive a headless Chromium yourself — no cloud-browser
key required:

```bash
/usr/bin/chromium --headless=new --no-sandbox --disable-gpu \
  --remote-debugging-port=9333 --user-data-dir=/tmp/cdp-prof about:blank &
# ready: curl -s http://127.0.0.1:9333/json  → attach to the page target's webSocketDebuggerUrl
```

- Collect `Network.responseReceived` over websockets while navigating, keeping
  `{url, type, mimeType, status}`: a live `/rpc/…` namespace that appears in no JS
  bundle surfaces only here. Filter out analytics hosts and `text/x-component` RSC
  frames to get at the data layer.
- DOM extraction is then the reliable route and yields clean rows:
  `[...document.querySelectorAll('table tr')].map(tr => [...tr.querySelectorAll('td,th')].map(td => td.innerText.replace(/\s+/g,' ').trim()))`.
- Treat such a source as scrape-only: undocumented format, breaks on any redesign, so
  either gate it behind a structure test or leave the column curated. Per-language
  boards in particular may no longer exist publicly even when the overall board does —
  check the available filters before promising a language dimension from it.
- Tear down with `pkill -f remote-debugging-port=9333`; an abandoned debug browser holds
  the profile directory and the next launch then silently fails to bind the port.
