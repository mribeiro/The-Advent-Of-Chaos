# The Advent of Chaos — Spec

A static advent calendar (Dec 1–24) in which each box shows a real security incident
from that day. If no incident is found for a day, the box shows a nerdy IT joke.
The theme is Christmas mixed with chaos. The site is in English.

## Decisions

| Topic | Decision |
|---|---|
| Content | A live news incident reported on that date of the current year. If there is none, a nerdy IT joke. |
| Curation | The Claude API (Haiku) picks the incident and writes a short, funny summary. Expected cost is cents per month. |
| Jokes | Claude writes one when a day closes without news. A built-in pool is the fallback. |
| Infra | A scheduled GitHub Actions workflow fetches feeds, commits frozen JSON and deploys a static build. |
| Hosting | GitHub Pages (free), with the domain (theadventofchaos.com) registered at Cloudflare and its DNS pointing to GitHub. |
| Days | 1–24 |
| Timezone | UTC for unlocking and for deciding whether something is "news of day D". |
| Cutoff | Day D keeps searching until D+1 at 12:00 UTC. After that it freezes as a joke if nothing was found. |
| Lifecycle | One edition per year with an archive (`/2026`, `/2027`, …). Outside December the site shows the latest edition fully opened, plus a countdown. |

## Box states

1. **Locked**: day D is in the future (UTC). It can't be opened.
2. **Searching**: D has started and nothing is frozen yet. The box shows "elves are scanning the logs…".
3. **News**: an incident has been frozen.
4. **Joke**: the cutoff passed with no incident, so a joke was frozen.

## Immutability

- Each day lives in `data/<year>/<DD>.json`. It's written exactly once.
- The updater script never overwrites an existing file.
- A CI check fails if a committed day file is modified or deleted.
- Incidents are deduplicated across days, so the same story is never picked twice.

## Daily routine (GitHub Actions)

- Runs every 2–3 hours from Dec 1 to Dec 25 12:00 UTC.
- For each unfrozen day D whose window is open:
  - fetch the security RSS feeds (BleepingComputer, The Hacker News, Krebs, The Record,
    SecurityWeek, CISA advisories, …)
  - keep the items published on D (UTC)
  - Claude decides whether one of them is a real breach or attack (not a product
    announcement), picks the most notable one, and writes the title, a summary, a Christmas-chaos
    twist, a severity "naughty level" and source links
  - if an incident is picked, freeze D as news
  - if no incident is picked and the cutoff has passed, freeze D as a joke
- Commit, rebuild and deploy.

## Notes

- Box locking happens in the browser, so it can be bypassed. That's acceptable, because
  future content doesn't exist yet.
- Summaries are original text that links to the sources. Articles are never copied.
- Before Dec 1, a `--simulate-date` mode is used to test the full pipeline.
