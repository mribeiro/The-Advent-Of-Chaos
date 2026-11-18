// Analytics consent. Cloudflare Web Analytics is loaded ONLY after an explicit "Accept".
// No choice yet, or "No thanks", means no analytics script is ever requested.
// The choice itself is kept in localStorage (strictly necessary to remember it).
const KEY = "taoc-analytics-consent"; // "granted" | "denied"
const token = document.body.dataset.cfToken;
const enabled = /^[a-f0-9]{32}$/i.test(token || "");

const banner = document.getElementById("consent");
const link = document.getElementById("privacy-link");

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* not persisted */ } };

let loaded = false;
function loadAnalytics() {
  if (loaded || !enabled) return;
  loaded = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(s);
}

function show() { banner.hidden = false; }
function hide() { banner.hidden = true; }

if (enabled) {
  link.hidden = false;
  link.addEventListener("click", show);
  document.getElementById("consent-accept").addEventListener("click", () => {
    write("granted");
    hide();
    loadAnalytics();
  });
  document.getElementById("consent-decline").addEventListener("click", () => {
    const wasGranted = read() === "granted";
    write("denied");
    hide();
    // The beacon can't be unloaded from a running page, so reload to stop it.
    if (wasGranted && loaded) location.reload();
  });

  const choice = read();
  if (choice === "granted") loadAnalytics();
  else if (choice !== "denied") show();
}
