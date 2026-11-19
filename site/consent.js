// Analytics: Cloudflare Web Analytics (cookie-free) is ON by default, with an opt-out in the footer.
// It is never loaded when the visitor opted out, or when the browser sends Do Not Track / Global Privacy Control.
// The opt-out choice is kept in localStorage.
const KEY = "taoc-analytics"; // "off" means opted out
const token = document.body.dataset.cfToken;
const enabled = /^[a-f0-9]{32}$/i.test(token || "");

const panel = document.getElementById("consent");
const link = document.getElementById("privacy-link");
const statusEl = document.getElementById("consent-status");
const toggle = document.getElementById("consent-toggle");

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* not persisted */ } };
const browserSignal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";
const isOn = () => !browserSignal && read() !== "off";

let loaded = false;
function loadAnalytics() {
  if (loaded || !enabled || !isOn()) return;
  loaded = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(s);
}

function renderPanel() {
  statusEl.textContent = browserSignal ? "off (your browser asks not to be tracked)" : isOn() ? "on" : "off";
  toggle.hidden = browserSignal;
  toggle.textContent = isOn() ? "Turn off" : "Turn on";
}

if (enabled) {
  document.getElementById("privacy-wrap").hidden = false;
  link.addEventListener("click", () => { renderPanel(); panel.hidden = false; });
  document.getElementById("consent-close").addEventListener("click", () => { panel.hidden = true; });
  toggle.addEventListener("click", () => {
    if (isOn()) {
      write("off");
      // A running beacon can't be unloaded, so reload to stop it.
      if (loaded) return location.reload();
    } else {
      write(null);
      loadAnalytics();
    }
    renderPanel();
  });
  loadAnalytics();
}
