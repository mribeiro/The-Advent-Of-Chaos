import { XMLParser } from "fast-xml-parser";

export const FEEDS = [
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/" },
  { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { name: "The Record", url: "https://therecord.media/feed" },
  { name: "SecurityWeek", url: "https://www.securityweek.com/feed/" },
  { name: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
  { name: "DataBreaches.net", url: "https://databreaches.net/feed/" },
  { name: "The Register", url: "https://www.theregister.com/security/headlines.atom" },
  { name: "Help Net Security", url: "https://www.helpnetsecurity.com/feed/" },
  { name: "Graham Cluley", url: "https://grahamcluley.com/feed/" },
  { name: "Infosecurity Magazine", url: "https://www.infosecurity-magazine.com/rss/news/" },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? v.__cdata ?? "");
  return "";
};

const stripHtml = (s) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const atomLink = (link) => {
  const links = Array.isArray(link) ? link : [link];
  const alt = links.find((l) => l && (l["@rel"] ?? "alternate") === "alternate") ?? links[0];
  return typeof alt === "string" ? alt : alt?.["@href"] ?? "";
};

/** Parses RSS 2.0 or Atom XML into normalized items. */
export function parseFeed(xml, sourceName) {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item;
  const atomEntries = doc?.feed?.entry;
  const raw = rssItems ?? atomEntries ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((it) => {
      const isAtom = !rssItems;
      const published = new Date(
        text(isAtom ? it.published ?? it.updated : it.pubDate ?? it["dc:date"]),
      );
      return {
        source: sourceName,
        title: stripHtml(text(it.title)),
        url: (isAtom ? atomLink(it.link) : text(it.link)).trim(),
        published,
        excerpt: stripHtml(text(isAtom ? it.summary ?? it.content : it.description)).slice(0, 400),
      };
    })
    .filter((it) => it.title && /^https?:\/\//.test(it.url) && !isNaN(it.published));
}

async function fetchOne(feed) {
  const res = await fetch(feed.url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AdventOfChaosBot/1.0)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed.name);
}

/** Fetches every feed. A feed that fails is logged and skipped. */
export async function fetchAllFeeds(feeds = FEEDS) {
  const results = await Promise.allSettled(feeds.map(fetchOne));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else console.warn(`feed failed: ${feeds[i].name}: ${r.reason?.message ?? r.reason}`);
  });
  // Deduplicate by URL.
  const seen = new Set();
  return items.filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)));
}
