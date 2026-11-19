import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { phase, yearEdition, EXTRA_EDITIONS, boxDate } from "../scripts/lib/editions.mjs";
import { parseFeed } from "../scripts/lib/feeds.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taoc-"));
const dataDir = path.join(tmp, "data");
const fixture = path.join(tmp, "items.json");
fs.writeFileSync(
  fixture,
  JSON.stringify([
    { source: "Test", title: "MegaCorp hit by ransomware attack", url: "https://ex.com/1", published: "2026-12-01T03:00:00Z", excerpt: "x" },
    { source: "Test", title: "Vendor launches shiny new firewall", url: "https://ex.com/2", published: "2026-12-02T09:00:00Z", excerpt: "x" },
    { source: "Test", title: "Webinar: zero trust for dummies", url: "https://ex.com/3", published: "2026-12-02T15:00:00Z", excerpt: "x" },
    { source: "Test", title: "Another breach at MegaCorp", url: "https://ex.com/4", published: "2026-12-01T20:00:00Z", excerpt: "x" },
  ]),
);

const run = (now, only = "2026") =>
  execFileSync(
    process.execPath,
    ["scripts/update.mjs", "--now", now, "--data-dir", dataDir, "--fixture", fixture, "--mock-ai", "--only", only],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } },
  );
const file = (d) => path.join(dataDir, "2026", `${String(d).padStart(2, "0")}.json`);
const read = (d) => JSON.parse(fs.readFileSync(file(d), "utf8"));

const y2026 = yearEdition(2026);
test("phases", () => {
  assert.equal(phase(y2026, 5, new Date("2026-12-04T23:59:59Z")), "locked");
  assert.equal(phase(y2026, 5, new Date("2026-12-05T00:00:00Z")), "live");
  assert.equal(phase(y2026, 5, new Date("2026-12-06T11:59:59Z")), "grace");
  assert.equal(phase(y2026, 5, new Date("2026-12-06T12:00:00Z")), "closed");
  assert.equal(phase(y2026, 24, new Date("2026-12-25T12:00:00Z")), "closed");
});

test("trial edition covers 18-30 Nov", () => {
  const trial = EXTRA_EDITIONS.find((e) => e.id === "trial");
  assert.equal(boxDate(trial, 1), "2026-11-18");
  assert.equal(boxDate(trial, trial.boxes), "2026-11-30");
  assert.equal(phase(trial, 13, new Date("2026-12-01T11:59:00Z")), "grace");
});

test("before December nothing is frozen", () => {
  run("2026-11-30T23:00:00Z");
  assert.equal(fs.existsSync(path.join(dataDir, "2026")), false);
});

test("day 1 freezes news as soon as it's found", () => {
  run("2026-12-01T04:00:00Z");
  const e = read(1);
  assert.equal(e.type, "news");
  assert.equal(e.news.sources[0].url, "https://ex.com/1");
  assert.equal(fs.existsSync(file(2)), false, "day 2 is still locked");
});

test("a frozen day never changes on later runs", () => {
  const before = fs.readFileSync(file(1), "utf8");
  run("2026-12-01T22:00:00Z");
  run("2026-12-05T00:00:00Z");
  assert.equal(fs.readFileSync(file(1), "utf8"), before);
});

test("a quiet day keeps searching until the cutoff, then becomes a joke", () => {
  // These runs happen in a fresh dir so the order is clean.
  fs.rmSync(dataDir, { recursive: true, force: true });
  run("2026-12-02T18:00:00Z"); // live, no incident
  assert.equal(fs.existsSync(file(2)), false);
  run("2026-12-03T11:00:00Z"); // grace, still nothing
  assert.equal(fs.existsSync(file(2)), false);
  run("2026-12-03T12:30:00Z"); // closed, so it's a joke
  const e = read(2);
  assert.equal(e.type, "joke");
  assert.ok(e.joke.setup && e.joke.punchline);
});

test("an incident is never reused on another day", () => {
  // Day 1 got frozen (closed phase) in the previous test's runs, from one of the MegaCorp items.
  const d1 = read(1);
  const urls = new Set(d1.news.sources.map((s) => s.url));
  for (let d = 2; d <= 3; d++) {
    if (!fs.existsSync(file(d))) continue;
    const e = read(d);
    if (e.type === "news") e.news.sources.forEach((s) => assert.ok(!urls.has(s.url)));
  }
});

test("parses RSS and Atom", () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Big <b>hack</b>]]></title><link>https://a.com/x</link><pubDate>Tue, 01 Dec 2026 10:00:00 +0000</pubDate><description>&lt;p&gt;Hello &amp; bye&lt;/p&gt;</description></item></channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Leak</title><link rel="alternate" href="https://b.com/y"/><published>2026-12-01T10:00:00Z</published><summary>sum</summary></entry></feed>`;
  const [r] = parseFeed(rss, "R");
  assert.equal(r.title, "Big hack");
  assert.equal(r.url, "https://a.com/x");
  assert.equal(r.excerpt, "Hello & bye");
  const [a] = parseFeed(atom, "A");
  assert.equal(a.url, "https://b.com/y");
  assert.equal(a.published.toISOString(), "2026-12-01T10:00:00.000Z");
});

test("jokes: fallback pool respects the limits and duplicates are rejected", async () => {
  const { JOKE_POOL } = await import("../scripts/lib/joke-pool.mjs");
  const { rejectJoke } = await import("../scripts/lib/curate.mjs");
  for (const j of JOKE_POOL) assert.equal(rejectJoke(j, []), null, j.punchline);
  const prev = [{ setup: "Why did X?", punchline: "Because Y!" }];
  assert.match(rejectJoke({ setup: "why did x", punchline: "new" }, prev), /repeats/);
  assert.match(rejectJoke({ setup: "Fresh?", punchline: "because y" }, prev), /repeats/);
  assert.match(rejectJoke({ setup: "Q?", punchline: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen" }, []), /words/);
});

test("jokes are never reused across editions; an exhausted pool keeps searching instead of repeating", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taoc-jokes-"));
  const items = path.join(dir, "none.json");
  fs.writeFileSync(items, "[]");
  const go = (now) =>
    execFileSync(process.execPath, ["scripts/update.mjs", "--now", now, "--data-dir", dir, "--fixture", items, "--mock-ai", "--only", now.slice(0, 4)], {
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
      stdio: "pipe",
    });
  go("2025-12-13T13:00:00Z"); // 12 quiet days in 2025
  go("2026-12-13T13:00:00Z"); // 12 quiet days in 2026
  const setups = (y) =>
    fs.existsSync(path.join(dir, String(y)))
      ? fs.readdirSync(path.join(dir, String(y))).map((f) => JSON.parse(fs.readFileSync(path.join(dir, String(y), f), "utf8")).joke.setup)
      : [];
  const all = [...setups(2025), ...setups(2026)];
  assert.equal(all.length, 24);
  assert.equal(new Set(all).size, 24, "every joke unique across years");

  // 30 pool jokes: only 6 left for 2027, so the other quiet days wait (exit code 1) rather than repeat.
  assert.throws(() => go("2027-12-25T13:00:00Z"));
  assert.equal(setups(2027).length, 6);
  assert.equal(new Set([...all, ...setups(2027)]).size, 30);
});

test("trial edition freezes into its own folder, separately from the yearly edition", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taoc-trial-"));
  const items = path.join(dir, "items.json");
  fs.writeFileSync(items, JSON.stringify([
    { source: "T", title: "Hospital chain breach exposes patients", url: "https://ex.com/t1", published: "2026-11-18T09:00:00Z", excerpt: "x" },
  ]));
  execFileSync(process.execPath, ["scripts/update.mjs", "--now", "2026-11-20T13:00:00Z", "--data-dir", dir, "--fixture", items, "--mock-ai"], {
    env: { ...process.env, ANTHROPIC_API_KEY: "" },
  });
  const files = fs.readdirSync(path.join(dir, "trial")).sort();
  assert.deepEqual(files, ["01.json", "02.json"]); // Nov 18 news, Nov 19 joke; Nov 20 still live
  const b1 = JSON.parse(fs.readFileSync(path.join(dir, "trial", "01.json"), "utf8"));
  assert.equal(b1.type, "news");
  assert.equal(b1.date, "2026-11-18");
  assert.equal(fs.existsSync(path.join(dir, "2026")), false, "December edition untouched");
});
