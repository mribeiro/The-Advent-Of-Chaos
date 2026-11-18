# The Advent of Chaos 🎄💥

An advent calendar for security nerds. Each box from Dec 1 to Dec 24 reveals a real breach, hack or attack from that day. Once a box is filled it is **frozen forever**. If a day stays quiet, the box shows a nerd joke instead.

See [SPEC.md](SPEC.md) for the product decisions.

## How it works

```
GitHub Actions (cron, every 2h in December)
  └─ scripts/update.mjs
       ├─ fetch 11 security RSS feeds
       ├─ for each open day without a file:
       │    Claude picks the most notable real incident and writes the summary
       │    → data/<year>/<DD>.json   (written once, with the 'wx' flag: never overwritten)
       └─ after the cutoff (D+1 12:00 UTC) with no incident → Claude writes a joke
  └─ scripts/check-frozen.mjs   (fails if any existing day file was changed or deleted)
  └─ commit → scripts/build.mjs → GitHub Pages
```

| When (UTC) | Phase | What happens to day D |
|---|---|---|
| before D 00:00 | locked | The box can't be opened. |
| D 00:00 → D+1 00:00 | live | News is frozen only if Claude rates it notability ≥ 7. Otherwise "scanning…". |
| D+1 00:00 → D+1 12:00 | grace | The best real incident from D is frozen (notability ≥ 3). |
| after D+1 12:00 | closed | A joke is frozen. If the API failed, it retries for up to 24h first. |

The browser only decides which boxes are locked or "scanning". The content comes from `data/`, so a box can't show anything before it has been frozen.

## Setup (one-time)

1. **Create the repo.** Make it public (Actions and Pages are free for public repos), then push to `main`.
2. **Turn on Pages.** Go to Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. **Add the API key.** Go to Settings → Secrets and variables → Actions → New repository secret, and save `ANTHROPIC_API_KEY`.
4. **Connect the domain** (Cloudflare):
   - In Cloudflare DNS, add `CNAME @ → <github-user>.github.io` and `CNAME www → <github-user>.github.io`. Set both to **DNS only** (grey cloud) so GitHub can issue the HTTPS certificate.
   - In the repo, go to Settings → Pages → Custom domain, enter `theadventofchaos.com`, then tick **Enforce HTTPS** once it's available.
   - Recommended: verify the domain under your GitHub account's Settings → Pages, which protects it against takeover.
5. **Run it once.** Go to Actions → "Advent of Chaos" → Run workflow. Outside December this only deploys the site with the countdown.

## Local development

```bash
npm ci
npm test                       # pipeline simulation (mock AI) + parser tests
npm run dev                    # build + serve on http://localhost:4173
# Preview any instant in the browser:   http://localhost:4173/?now=2026-12-07T10:00:00Z

# Dry-run the real updater for a simulated instant, without writing anything:
ANTHROPIC_API_KEY=... node scripts/update.mjs --now 2026-12-03T15:00:00Z --dry-run
# See what Claude would have picked for a real past day (uses today's live feeds):
ANTHROPIC_API_KEY=... node scripts/try-day.mjs 2026-11-17
# Offline simulation into a scratch folder:
node scripts/update.mjs --now 2026-12-03T15:00:00Z --data-dir /tmp/taoc --mock-ai
```

`TAOC_MODEL` overrides the model (default `claude-haiku-5-5`, which costs well under $1 for the whole month).

## Rules

- Never edit or delete a file in `data/`. CI refuses the push and doesn't deploy.
- To fix a broken entry anyway, you have to change `check-frozen.mjs` on purpose. That's intentional.

## License

[CC BY-NC 4.0](LICENSE) © Miguel Ribeiro. You're free to use, share and modify this project for **non-commercial** purposes. If you share it or a modified version, credit *"The Advent of Chaos by Miguel Ribeiro"*, link back to this repo and say what you changed. You may not sell it, or anything built from it.
