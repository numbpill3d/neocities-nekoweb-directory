// retro site directory — client-side filter/search over data/sites.json
const DATA_URL = "./data/sites.json";

const state = { sites: [], category: "all", query: "", tag: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function norm(s) { return String(s || "").toLowerCase(); }

function matches(site) {
  if (state.category !== "all" && site.category !== state.category) return false;
  if (state.tag && !(site.tags || []).includes(state.tag)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [site.name, site.description, site.url, (site.tags || []).join(" "), site.category].map(norm).join(" ");
  return hay.includes(q);
}

function renderCategories() {
  const cats = new Map();
  cats.set("all", state.sites.length);
  for (const s of state.sites) cats.set(s.category || "other", (cats.get(s.category || "other") || 0) + 1);
  const ul = $("#cat-list");
  ul.innerHTML = "";
  for (const [cat, n] of cats) {
    const li = document.createElement("li");
    li.className = state.category === cat ? "active" : "";
    li.innerHTML = `<span>${cat}</span><span class="count">${n}</span>`;
    li.addEventListener("click", () => { state.category = cat; state.tag = null; render(); });
    ul.appendChild(li);
  }
}

function renderTags() {
  const tagCounts = new Map();
  for (const s of state.sites) for (const t of (s.tags || [])) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const top = [...tagCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 24);
  const box = $("#tag-cloud");
  box.innerHTML = top.map(([t,n]) => `<span class="tag" data-tag="${escapeAttr(t)}">${escapeHtml(t)} <small>${n}</small></span>`).join(" ");
  box.querySelectorAll(".tag").forEach(el => {
    el.addEventListener("click", () => {
      const t = el.dataset.tag;
      state.tag = state.tag === t ? null : t;
      render();
    });
  });
}

function card(site, i) {
  const tags = (site.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const updated = site.last_updated ? new Date(site.last_updated).toISOString().slice(0,10) : "unknown";
  return `
  <article class="entry">
    <div class="head">
      <span class="num">#${String(i+1).padStart(3,"0")}</span>
      <span class="name">${escapeHtml(site.name || "untitled")}</span>
      <span class="cat-badge">${escapeHtml(site.category || "other")}</span>
      <a class="url" href="${escapeAttr(site.url)}" target="_blank" rel="noopener">${escapeHtml(site.url)}</a>
    </div>
    <div class="body">
      <p class="desc">${escapeHtml(site.description || "")}</p>
      ${site.button ? `<div class="site-button"><a href="${escapeAttr(site.url)}" target="_blank" rel="noopener"><img src="${escapeAttr(site.button)}" alt="${escapeAttr(site.name)} 88x32 button" width="88" height="32" loading="lazy"></a></div>` : ""}
      <div class="meta">${tags}</div>
    </div>
    <div class="foot">
      <span>source: ${escapeHtml(site.source || "unknown")}</span>
      <span>last seen: ${updated}</span>
    </div>
  </article>`;
}

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

function renderButtonWall() {
  const wall = document.getElementById("button-wall");
  if (!wall) return;
  const btns = state.sites.filter(s => s.button);
  if (!btns.length) { wall.innerHTML = '<div class="empty">no buttons yet.</div>'; return; }
  wall.innerHTML = btns.map(s => `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" title="${escapeAttr(s.name)}"><img src="${escapeAttr(s.button)}" alt="${escapeAttr(s.name)}" width="88" height="32" loading="lazy"></a>`).join("");
}

function render() {
  const filtered = state.sites.filter(matches);
  $("#entries").innerHTML = filtered.length
    ? filtered.map((s,i)=>card(s,i)).join("")
    : `<div class="empty">no sites match. try clearing filters or submitting one.</div>`;
  $("#count").textContent = filtered.length;
  $("#total").textContent = state.sites.length;
  $("#shown-label").textContent = state.query || state.category !== "all" || state.tag ? "filtered" : "all";
  const c2=document.getElementById("count2"), t2=document.getElementById("total2"), g2=document.getElementById("generated2"), l2=document.getElementById("shown-label2");
  if(c2) c2.textContent=filtered.length;
  if(t2) t2.textContent=state.sites.length;
  if(g2) g2.textContent=$("#generated").textContent;
  if(l2) l2.textContent=$("#shown-label").textContent;
  renderCategories();
  renderTags();
  renderButtonWall();
  // highlight active tag
  $$("#tag-cloud .tag").forEach(el => {
    if (el.dataset.tag === state.tag) el.style.borderColor = "var(--amber)";
    else el.style.borderColor = "";
  });
}

async function load() {
  $("#entries").innerHTML = `<div class="loading">loading directory…</div>`;
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    const data = await res.json();
    state.sites = Array.isArray(data.sites) ? data.sites : [];
    $("#generated").textContent = data.generated_at || "unknown";
  } catch (e) {
    state.sites = [];
    $("#entries").innerHTML = `<div class="empty">could not load data/sites.json (${e.message}).</div>`;
  }
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  $("#clear").addEventListener("click", () => { state.query = ""; state.category = "all"; state.tag = null; $("#search").value = ""; render(); });
  load();
});
