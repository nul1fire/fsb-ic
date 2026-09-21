const STOP = new Set(["ну","типа","там","че","что","как","по","и","в","на","с","без","за","от","или"]);
const ENDINGS = ["иями","ями","иях","ях","ами","ой","ей","ый","ий","ья","ия","ов","ев","ам","ям","ах","ух","ю","у","ы","и","о","е","а","я","ь"];
const SYN = [
  ["тачк","машин","авто","транспорт","угон","завладен"],
  ["бил","удар","повред","разбил","помял"],
  ["гос","государствен","служебн"],
  ["убийств","убил","киллер","замоч"],
  ["наркот","дурь","веществ","меф","ганжа"],
  ["взятк","подкуп","откат"],
  ["оруж","ствол","пушк","пух"],
  ["маск","балаклав","скрыл лиц"],
  ["заложн","плен"],
  ["террор","взрыв","минир"],
  ["измен","шпионаж","предатель","слив"],
  ["избил","побои","насиль","врезал"],
  ["украл","краж","воров","хищен","обокрал"],
  ["задерж","арест","наручник","кпз"],
  ["адвокат","защитник"],
  ["обыск","досмотр"],
  ["раци","связ","эфир","тен","код"],
  ["форм","одежд","дресс"],
  ["субординац","дисциплин","устав"],
  ["прокурор","надзор"],
  ["халатн","небрежн"],
  ["закрыт","охраняем","территор"],
  ["режим","кто","чп","военн"],
  ["удостоверен","жетон","представ"],
  ["основан","задерж"],
];
const SEV_CLASS = {"особо тяжкое":"sev-особо","тяжкое":"sev-тяжкое","средней тяжести":"sev-средней","небольшой тяжести":"sev-небольшой"};
const PAGE = 30;
const HIST_MAX = 6;

let DB = {}, FAV = new Set(), HISTORY = [], category = "Все", query = "", shown = 0;
let closedFolders = new Set(), openCards = new Set();
let lastStatus = "", dbStamp = null;
let jurFilter = "Все";
let shownOverride = null;
let SERVER_MODE = true;
let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
const feed = () => document.getElementById("feed");

document.addEventListener("mousemove", e => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });

function injectBuiltins(db) {
  for (const k in BUILTIN) db[k] = BUILTIN[k];
  return db;
}

function hideLoader() {
  const l = document.getElementById("loader");
  if (!l) return;
  l.classList.add("out");
  setTimeout(() => l.remove(), 500);
}
function setLoaderStatus(s) {
  const el = document.getElementById("loader-status");
  if (el) el.textContent = s;
}

function applyTheme(t) {
  document.body.classList.toggle("theme-day", t === "day");
  try { localStorage.setItem("fsb_theme", t); } catch (e) {}
  const b = document.getElementById("btn-theme");
  if (b) b.textContent = t === "day" ? "☾" : "☀";
}
function currentTheme() {
  try { return localStorage.getItem("fsb_theme") || "night"; } catch (e) { return "night"; }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem("fsb_history");
    if (raw) HISTORY = JSON.parse(raw);
    if (!Array.isArray(HISTORY)) HISTORY = [];
  } catch (e) { HISTORY = []; }
}
function saveHistory() {
  try { localStorage.setItem("fsb_history", JSON.stringify(HISTORY)); } catch (e) {}
}
function clearHistory() {
  HISTORY = [];
  saveHistory();
  renderSidebar();
}
function pushHistory(id, title, cat) {
  HISTORY = HISTORY.filter(h => h.id !== id);
  HISTORY.unshift({ id, title, cat });
  if (HISTORY.length > HIST_MAX) HISTORY = HISTORY.slice(0, HIST_MAX);
  saveHistory();
  renderSidebar();
}
function historyLabel(h) {
  const cat = DISPLAY[h.cat] || h.cat || "";
  const s = (cat ? cat + " · " : "") + h.title;
  return s.length > 42 ? s.slice(0, 40) + "…" : s;
}

function normalizeText(t) {
  const lines = (t || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { out.push(""); continue; }
    const isMarker = /^(\d+(\.\d+)*\.?|[a-zа-яё]\))$/i.test(l) && l.length <= 6;
    if (isMarker && i + 1 < lines.length) { lines[i + 1] = l + " " + lines[i + 1].trim(); continue; }
    out.push(l);
  }
  const res = [];
  for (const l of out) if (l !== "" || (res.length && res[res.length - 1] !== "")) res.push(l);
  while (res.length && res[0] === "") res.shift();
  while (res.length && res[res.length - 1] === "") res.pop();
  return res.join("\n");
}

function stem(w) {
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}
function expand(tok) {
  const out = new Set([tok]);
  for (const g of SYN) if (tok.length > 2 && g.some(m => tok.startsWith(m) || m.startsWith(tok))) g.forEach(m => out.add(m));
  return [...out];
}
function tokens() {
  return query.split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
}
function hlWords() {
  const out = new Set();
  for (const w of query.split(/\s+/)) if (w.length > 2 && !STOP.has(w)) { out.add(w); expand(stem(w)).forEach(v => { if (v.length > 2) out.add(v); }); }
  return [...out];
}
function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }
function mark(s) {
  let out = esc(s);
  for (const w of hlWords()) {
    if (!w) continue;
    const re = new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[a-zа-яё]*)", "gi");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}
function snippet(t) {
  const flat = t.split("\n").map(s => s.trim()).filter(Boolean).join(" ");
  return flat.length > 170 ? flat.slice(0, 170) + "..." : flat;
}

async function loadDb() {
  try {
    const r = await fetch("/api/db");
    if (r.ok) { DB = injectBuiltins(await r.json()); SERVER_MODE = true; return true; }
  } catch (e) {}
  try {
    const r = await fetch("data.json?" + Date.now());
    if (r.ok) { DB = injectBuiltins(await r.json()); SERVER_MODE = false; return true; }
  } catch (e) {}
  DB = injectBuiltins({});
  SERVER_MODE = false;
  return false;
}
async function loadFavs() {
  if (SERVER_MODE) {
    try { FAV = new Set(await (await fetch("/api/fav")).json()); return; } catch (e) {}
  }
  try { FAV = new Set(JSON.parse(localStorage.getItem("fsb_favs") || "[]")); } catch (e) { FAV = new Set(); }
}
function saveFavs() {
  if (SERVER_MODE) { fetch("/api/fav", { method: "POST", body: JSON.stringify([...FAV]) }).catch(() => {}); return; }
  try { localStorage.setItem("fsb_favs", JSON.stringify([...FAV])); } catch (e) {}
}

function findInCategory(cat, num) {
  const list = DB[cat];
  if (!list) return null;
  const slugFull = num.replace(/\./g, "_").replace(/-/g, "_");
  const base = num.split(/[.\-]/)[0];
  const slugBase = base.replace(/\./g, "_");
  return list.find(x =>
    x.id.endsWith("_" + slugFull) ||
    x.id.endsWith("_" + slugBase) ||
    x.title.startsWith("Ст. " + num + ".") ||
    x.title.startsWith("Ст. " + num + " ") ||
    x.title.startsWith("Ст. " + base + ".") ||
    x.title === "Ст. " + base
  ) || null;
}
function resolveRef(ref) {
  const parts = ref.trim().split(/\s+/);
  const num = parts.length > 1 ? parts.pop() : null;
  const prefix = parts.join(" ");
  const cat = REF_CAT[prefix] || REF_CAT[prefix.toUpperCase()] || null;
  if (!cat || !num) { flashStatus("ссылка не распознана: " + ref); return; }
  let a = findInCategory(cat, num);
  let foundCat = cat;
  if (!a) {
    for (const c in DB) {
      const hit = findInCategory(c, num);
      if (hit && (DISPLAY[c] || c).toLowerCase().includes(prefix.toLowerCase())) { a = hit; foundCat = c; break; }
    }
  }
  if (!a) { flashStatus("статья не найдена в базе: " + ref); return; }
  revealArticle(foundCat, a.id);
}
function revealArticle(cat, id) {
  category = cat;
  jurFilter = "Все";
  openCards.add(id);
  const list = DB[cat] || [];
  const idx = list.findIndex(a => a.id === id);
  shownOverride = idx >= 0 ? Math.max(PAGE, idx + 1) : PAGE;
  renderSidebar();
  renderFeed(false);
  shownOverride = null;
  setTimeout(() => {
    const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 240);
  const a = findArticle(id);
  if (a) pushHistory(id, a.title, cat);
}

function pool() {
  if (category === "Подследственность") return [];
  let arr = [];
  if (category === "Все") for (const c in DB) DB[c].forEach(a => arr.push([c, a]));
  else if (category === "★ Избранное") for (const c in DB) DB[c].forEach(a => { if (FAV.has(a.id)) arr.push([c, a]); });
  else (DB[category] || []).forEach(a => arr.push([category, a]));
  const tk = tokens();
  if (!tk.length) return arr;
  const scored = [];
  for (const [c, a] of arr) {
    const title = a.title.toLowerCase().replace("ё","е");
    const text = a.text.toLowerCase().replace("ё","е");
    const tags = (a.tags || []).join(" ").toLowerCase();
    const hay = c + " " + title + " " + text + " " + tags;
    let score = 0, ok = true;
    for (const t of tk) {
      const vars = expand(t);
      const dT = title.includes(t), dX = text.includes(t) || tags.includes(t);
      const syn = vars.some(v => hay.includes(v));
      if (!(dT || dX || syn)) { ok = false; break; }
      if (dT) score += 6;
      if (dX) score += 4;
      if (syn && !dT && !dX) score += 1;
    }
    if (ok) scored.push([score, c, a]);
  }
  scored.sort((x, y) => y[0] - x[0]);
  return scored.map(s => [s[1], s[2]]);
}
function sim(a, b) {
  const bg = s => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
  const A = bg(a), B = bg(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; A.forEach(x => { if (B.has(x)) hit++; });
  return 2 * hit / (A.size + B.size);
}
function suggestions() {
  const q = query.toLowerCase();
  const all = [];
  for (const c in DB) DB[c].forEach(a => all.push(a.title));
  return all.map(t => [sim(q, t.toLowerCase()), t]).filter(x => x[0] > 0.3)
    .sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
}

function renderSidebar() {
  const sb = document.getElementById("sidebar");
  const count = name => {
    if (name === "Все") return Object.values(DB).reduce((s, a) => s + a.length, 0);
    if (name === "★ Избранное") return FAV.size;
    if (name === "Подследственность") return JURISDICTION.reduce((s, g) => s + g.articles.length, 0);
    return (DB[name] || []).length;
  };
  let html = '';
  if (HISTORY.length) {
    html += `<div class="side-head hist-head">НЕДАВНО ОТКРЫТО<button class="hist-clear" data-histclear title="очистить историю">x</button></div>`;
    for (const h of HISTORY) {
      html += `<button class="side-btn hist-btn" data-hist="${esc(h.id)}" title="${esc(h.title)}">${esc(historyLabel(h))}</button>`;
    }
  }
  html += '<div class="side-head" style="margin-top:12px">РАЗДЕЛЫ</div>';
  for (const [key, label] of [["Все","Все"], ["★ Избранное","В закладках"]]) {
    html += `<button class="side-btn ${category === key ? "active" : ""}" data-cat="${esc(key)}">${esc(label)}<span class="cnt">${count(key)}</span></button>`;
  }
  const cats = new Set(); GROUPS.forEach(g => g[1].forEach(c => cats.add(c)));
  const extra = Object.keys(DB).filter(k => !cats.has(k));
  for (const [folder, list] of GROUPS) {
    let items = list.filter(c => c === "Подследственность" || DB[c]);
    if (folder === "Общее законодательство") items = items.concat(extra);
    if (!items.length) continue;
    const closed = closedFolders.has(folder);
    html += `<div class="folder ${closed ? "closed" : ""}">
      <button class="folder-head" data-folder="${esc(folder)}"><span class="arr">▾</span>${esc(folder)}</button>
      <div class="folder-body">${items.map(name =>
        `<button class="side-btn ${category === name ? "active" : ""}" data-cat="${esc(name)}">${esc(DISPLAY[name] || name)}<span class="cnt">${count(name)}</span></button>`).join("")}
      </div></div>`;
  }
  sb.innerHTML = html;
  sb.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => pick(b.dataset.cat));
  sb.querySelectorAll("[data-folder]").forEach(b => b.onclick = () => {
    const f = b.dataset.folder;
    closedFolders.has(f) ? closedFolders.delete(f) : closedFolders.add(f);
    renderSidebar();
  });
  sb.querySelectorAll("[data-hist]").forEach(b => b.onclick = () => jumpToHistory(b.dataset.hist));
  const clr = sb.querySelector("[data-histclear]");
  if (clr) clr.onclick = e => { e.stopPropagation(); clearHistory(); };
}

function jumpToHistory(id) {
  for (const c in DB) {
    const a = DB[c].find(x => x.id === id);
    if (a) { revealArticle(c, id); return; }
  }
}

function cardHTML(cat, a) {
  const open = openCards.has(a.id);
  const sev = a.severity || "";
  const sn = snippet(a.text);
  const expandable = a.text.trim() !== sn.trim();
  const favView = category === "★ Избранное" ? " fav-view" : "";
  const refs = (a.refs || []).map(r => `<button class="ref-chip" data-ref="${esc(r)}">${esc(r)}</button>`).join("");
  const tags = (a.tags || []).length ? `<span class="tags-inline">${a.tags.map(t => "#" + esc(t)).join(" ")}</span>` : "";
  return `<article class="card ${SEV_CLASS[sev] || ""}${favView} ${open ? "open" : ""}" data-id="${esc(a.id)}">
    <div class="bar"></div>
    <div class="card-head">
      <h3 class="card-title" data-act="toggle">${mark(a.title)}</h3>
      <button class="icon-btn fav ${FAV.has(a.id) ? "on" : ""}" data-act="fav" title="закладка">${FAV.has(a.id) ? "★" : "☆"}</button>
      ${expandable ? '<button class="icon-btn exp" data-act="toggle" title="раскрыть">+</button>' : ""}
    </div>
    ${category === "Все" || category === "★ Избранное" ? `<div class="card-meta"><span class="cat">${esc(DISPLAY[cat] || cat)}</span>${sev ? `<span class="sev">${esc(sev)}</span>` : ""}</div>` : sev ? `<div class="card-meta"><span class="sev">${esc(sev)}</span></div>` : ""}
    <p class="snippet" data-act="toggle">${mark(sn)}</p>
    <div class="fold"><div class="fold-in">
      <div class="full">${mark(a.text)}</div>
    </div></div>
    <div class="card-foot">
      <div class="foot-left">${refs}${tags}</div>
      <button class="copy-btn" data-act="copy">Копировать</button>
    </div>
  </article>`;
}

function emptyHTML() {
  if (category !== "Все" && query) {
    const saved = category; category = "Все";
    const n = pool().length; category = saved;
    if (n) return `<div class="empty">В этом разделе совпадений нет.</div>
      <button class="sugg-btn" data-act="goto-all">В других разделах найдено: ${n}. Показать</button>`;
  }
  if (!query) return `<div class="empty">База не загружена. Локально запусти update_db.py, на хостинге обнови data.json.</div>`;
  const s = suggestions();
  if (!s.length) return `<div class="empty">Совпадений нет.</div>`;
  return `<div class="sugg-head">Возможно, вы имели в виду:</div>` +
    s.map(t => `<button class="sugg-btn" data-sugg="${esc(t)}">${esc(t)}</button>`).join("");
}
function moreHTML(total) {
  return `<button class="more-btn" data-act="more">Показать ещё  (осталось: ${total - shown})</button>`;
}

function renderJurisdiction() {
  const tabs = ["Все", ...JURISDICTION.map(g => g.agency)];
  let html = '<div class="jur-tabs">';
  for (const t of tabs) html += `<button class="jur-tab ${jurFilter === t ? "on" : ""}" data-filter="${esc(t)}">${esc(t)}</button>`;
  html += '</div>';
  const groups = jurFilter === "Все" ? JURISDICTION : JURISDICTION.filter(g => g.agency === jurFilter);
  for (const g of groups) {
    html += `<div class="jur-group">
      <div class="jur-group-head">
        <span class="jur-dot" style="background:${g.color}"></span>
        <span class="jur-agency">${esc(g.agency)}</span>
        <span class="jur-count">${g.articles.length} статей</span>
      </div>
      <div class="jur-list">${g.articles.map(([num, title]) =>
        `<div class="jur-row">
          <span class="jur-num" style="color:${g.color}">Ст. ${esc(num)} УК</span>
          <span class="jur-title">${mark(title)}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }
  html += `<div class="jur-note">Примечание: при сомнениях в подследственности немедленно докладывай в Управление «М» или дежурному Управления. Дела в отношении сотрудников ФСБ по обращениям в прокуратуру ведут только органы СК (ФСБ 34).</div>`;
  return html;
}

function renderFeed(animate) {
  const isJur = category === "Подследственность";
  const items = pool();
  const draw = () => {
    if (isJur) {
      shown = JURISDICTION.reduce((s, g) => s + g.articles.length, 0);
      feed().innerHTML = renderJurisdiction();
      bindJurisdiction();
      document.getElementById("counter").textContent = `статей в таблице: ${shown}`;
      lastStatus = `подследственность, фильтр: ${jurFilter}`;
      document.getElementById("status").textContent = lastStatus;
      feed().classList.remove("switching");
      return;
    }
    shown = Math.min(shownOverride || PAGE, items.length);
    let html = items.slice(0, shown).map(([c, a]) => cardHTML(c, a)).join("");
    if (!items.length) html = emptyHTML();
    else if (items.length > shown) html += moreHTML(items.length);
    feed().innerHTML = html;
    bindFeed();
    document.getElementById("counter").textContent = `найдено: ${items.length}, показано: ${shown}`;
    lastStatus = `база: ${Object.values(DB).reduce((s, a) => s + a.length, 0)} статей, закладок: ${FAV.size}, раздел: ${category}`;
    document.getElementById("status").textContent = lastStatus;
    feed().classList.remove("switching");
  };
  if (animate) { feed().classList.add("switching"); setTimeout(draw, 150); }
  else draw();
}

function bindJurisdiction() {
  feed().querySelectorAll("[data-filter]").forEach(b => b.onclick = () => {
    jurFilter = b.dataset.filter;
    renderFeed(false);
  });
}

function flashStatus(msg) {
  document.getElementById("status").textContent = msg;
  setTimeout(() => { document.getElementById("status").textContent = lastStatus; }, 2500);
}

function copyPayload(a, btn) {
  const payload = a.title + "\n" + a.text;
  const done = () => { btn.textContent = "Скопировано"; btn.classList.add("done");
    setTimeout(() => { btn.textContent = "Копировать"; btn.classList.remove("done"); }, 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(payload).then(done).catch(done);
  else { const t = document.createElement("textarea"); t.value = payload; document.body.appendChild(t);
    t.select(); document.execCommand("copy"); t.remove(); done(); }
}

function bindFeed() {
  feed().querySelectorAll("[data-act]").forEach(el => {
    el.onclick = e => {
      const card = el.closest(".card");
      const id = card ? card.dataset.id : null;
      const act = el.dataset.act;
      if (act === "toggle" && card) {
        const wasOpen = openCards.has(id);
        wasOpen ? openCards.delete(id) : openCards.add(id);
        card.classList.toggle("open");
        if (!wasOpen) {
          const a = findArticle(id);
          if (a) pushHistory(id, a.title, category);
        }
      } else if (act === "fav" && card) {
        toggleFav(id, el);
      } else if (act === "copy" && card) {
        const a = findArticle(id);
        if (a) copyPayload(a, el);
      } else if (act === "more") {
        loadMore();
      } else if (act === "goto-all") {
        pick("Все");
      }
      e.stopPropagation();
    };
  });
  feed().querySelectorAll("[data-ref]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    resolveRef(b.dataset.ref);
  });
  feed().querySelectorAll("[data-sugg]").forEach(b => b.onclick = () => {
    const inp = document.getElementById("search");
    inp.value = b.dataset.sugg; query = inp.value.trim().toLowerCase();
    renderFeed(true);
  });
}

function findArticle(id) {
  for (const c in DB) { const a = DB[c].find(x => x.id === id); if (a) return a; }
  return null;
}
function toggleFav(id, btn) {
  FAV.has(id) ? FAV.delete(id) : FAV.add(id);
  saveFavs();
  btn.classList.toggle("on", FAV.has(id));
  btn.textContent = FAV.has(id) ? "★" : "☆";
  renderSidebar();
}
function loadMore() {
  const items = pool();
  const next = items.slice(shown, shown + PAGE);
  const btn = feed().querySelector(".more-btn");
  if (btn) btn.remove();
  const wrap = document.createElement("div");
  wrap.innerHTML = next.map(([c, a]) => cardHTML(c, a)).join("");
  while (wrap.firstElementChild) feed().appendChild(wrap.firstElementChild);
  shown += next.length;
  if (items.length > shown) feed().insertAdjacentHTML("beforeend", moreHTML(items.length));
  bindFeed();
  document.getElementById("counter").textContent = `найдено: ${items.length}, показано: ${shown}`;
}
function pick(cat) {
  category = cat;
  openCards.clear();
  jurFilter = "Все";
  renderSidebar();
  renderFeed(true);
}

let searchJob = null;
function onSearch() {
  clearTimeout(searchJob);
  searchJob = setTimeout(() => {
    query = document.getElementById("search").value.trim().toLowerCase().replace(/ё/g, "е");
    renderFeed(true);
  }, 180);
}

let wheelTarget = null, wheelRaf = null;
function installSmoothScroll() {
  const f = feed();
  f.addEventListener("wheel", e => {
    e.preventDefault();
    if (wheelTarget == null) wheelTarget = f.scrollTop;
    wheelTarget = Math.max(0, Math.min(f.scrollHeight - f.clientHeight, wheelTarget + e.deltaY));
    if (!wheelRaf) wheelRaf = requestAnimationFrame(stepWheel);
  }, { passive: false });
  function stepWheel() {
    const f2 = feed();
    const diff = wheelTarget - f2.scrollTop;
    if (Math.abs(diff) < 1) { f2.scrollTop = wheelTarget; wheelTarget = null; wheelRaf = null; return; }
    f2.scrollTop += diff * 0.35;
    wheelRaf = requestAnimationFrame(stepWheel);
  }
}

function installTitlebar() {
  const buttons = document.querySelector(".tb-buttons");
  const themeBtn = document.createElement("button");
  themeBtn.className = "tb-btn"; themeBtn.id = "btn-theme"; themeBtn.title = "переключить тему";
  themeBtn.onclick = () => applyTheme(currentTheme() === "day" ? "night" : "day");
  buttons.appendChild(themeBtn);
  const infoBtn = document.createElement("button");
  infoBtn.className = "tb-btn tb-info"; infoBtn.textContent = "i"; infoBtn.title = "информация и горячие клавиши";
  infoBtn.onclick = () => document.getElementById("info-modal").classList.add("show");
  buttons.appendChild(infoBtn);
  const minBtn = document.createElement("button");
  minBtn.className = "tb-btn"; minBtn.id = "btn-min"; minBtn.textContent = "-";
  buttons.appendChild(minBtn);
  const closeBtn = document.createElement("button");
  closeBtn.className = "tb-btn tb-close"; closeBtn.id = "btn-close"; closeBtn.textContent = "X";
  buttons.appendChild(closeBtn);
  applyTheme(currentTheme());
  if (!window.pywebview) { minBtn.style.display = "none"; closeBtn.style.display = "none"; return; }
  minBtn.onclick = () => pywebview.api.minimize();
  closeBtn.onclick = () => pywebview.api.close();
}

function findCardAtPointer() {
  const cards = document.querySelectorAll(".card");
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (mouseX >= r.left && mouseX <= r.right && mouseY >= r.top && mouseY <= r.bottom) return c;
  }
  return null;
}
function toggleFocusedCard() {
  if (category === "Подследственность") return;
  const card = findCardAtPointer();
  if (!card) { flashStatus("наведи курсор на карточку"); return; }
  const id = card.dataset.id;
  if (!openCards.has(id)) {
    openCards.add(id);
    card.classList.add("open");
    const a = findArticle(id);
    if (a) pushHistory(id, a.title, category);
  } else {
    openCards.delete(id);
    card.classList.remove("open");
  }
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function copyFocusedCard() {
  if (category === "Подследственность") return;
  const card = findCardAtPointer();
  if (!card) { flashStatus("наведи курсор на карточку"); return; }
  const btn = card.querySelector('[data-act="copy"]');
  if (btn) btn.click();
}

function installHotkeys() {
  const sidebarCats = () => {
    const cats = ["Все", "★ Избранное"];
    const known = new Set(); GROUPS.forEach(g => g[1].forEach(c => known.add(c)));
    for (const [folder, list] of GROUPS) {
      let items = list.filter(c => c === "Подследственность" || DB[c]);
      if (folder === "Общее законодательство") items = items.concat(Object.keys(DB).filter(k => !known.has(k)));
      for (const name of items) if (!cats.includes(name)) cats.push(name);
    }
    return cats;
  };
  document.addEventListener("keydown", e => {
    const inp = document.getElementById("search");
    const inInput = document.activeElement === inp;
    if (e.ctrlKey && (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А")) {
      e.preventDefault(); inp.focus(); inp.select(); return;
    }
    if (e.key === "Escape") {
      if (inInput) { inp.value = ""; query = ""; inp.blur(); renderFeed(true); }
      const modal = document.getElementById("info-modal");
      if (modal && modal.classList.contains("show")) modal.classList.remove("show");
      return;
    }
    if (inInput) return;
    if (e.key === "F1") { e.preventDefault(); toggleFocusedCard(); return; }
    if (e.key === "F2") { e.preventDefault(); copyFocusedCard(); return; }
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const cats = sidebarCats();
      const idx = parseInt(e.key) - 1;
      if (idx < cats.length) pick(cats[idx]);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      const cats = sidebarCats();
      if (cats.length >= 10) pick(cats[9]);
    }
  });
}

function installInfo() {
  const modal = document.createElement("div");
  modal.id = "info-modal";
  modal.innerHTML = `<div class="info-box">
    <div class="info-title">ИНФОРМАЦИОННЫЙ ЦЕНТР ФСБ</div>
    <p>Сделано для ФСБ Кутузовского округа Валерием Коленваловым.</p>
    <p>Поблагодарить можно на счёт карты:<br><span class="info-card">7473759453664592</span></p>
    <p>Для связи: Discord <span class="info-card">nulifire</span></p>
    <div class="info-keys">
      <div class="info-keys-title">Горячие клавиши</div>
      <div><span class="k-name">Поиск</span><kbd>Ctrl+F</kbd></div>
      <div><span class="k-name">Раскрыть карточку под курсором</span><kbd>F1</kbd></div>
      <div><span class="k-name">Копировать карточку под курсором</span><kbd>F2</kbd></div>
      <div><span class="k-name">Переключить раздел</span><kbd>1-9</kbd></div>
      <div><span class="k-name">Сбросить / закрыть</span><kbd>Esc</kbd></div>
    </div>
    <button class="copy-btn" id="info-close">Закрыть</button>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("show"); });
  modal.querySelector("#info-close").onclick = () => modal.classList.remove("show");
}

async function pollDb() {
  if (!SERVER_MODE) return;
  try {
    const v = await (await fetch("/api/version")).json();
    if (dbStamp === null) { dbStamp = v.stamp; return; }
    if (v.stamp !== dbStamp) {
      dbStamp = v.stamp;
      DB = injectBuiltins(await (await fetch("/api/db")).json());
      for (const c in DB) DB[c] = DB[c].map(a => Object.assign({}, a, { text: normalizeText(a.text) }));
      renderSidebar();
      renderFeed(true);
      flashStatus("база обновлена автоматически");
    }
  } catch (e) {}
}

async function init() {
  setLoaderStatus("загрузка базы");
  await loadDb();
  for (const c in DB) DB[c] = DB[c].map(a => Object.assign({}, a, { text: normalizeText(a.text) }));
  setLoaderStatus("загрузка закладок");
  await loadFavs();
  loadHistory();

  document.getElementById("search").addEventListener("input", onSearch);
  document.getElementById("search").addEventListener("keydown", e => {
    if (e.key === "Escape") { e.target.value = ""; query = ""; renderFeed(true); e.target.blur(); }
  });

  renderSidebar();
  setLoaderStatus("отрисовка");
  renderFeed(false);

  const total = Object.values(DB).reduce((s, a) => s + a.length, 0);
  if (total < 20) document.getElementById("status").textContent =
    "база пуста: локально запусти update_db.py, на хостинге обнови data.json";

  installSmoothScroll();
  installTitlebar();
  installHotkeys();
  installInfo();
  if (SERVER_MODE) { pollDb(); setInterval(pollDb, 4000); }

  setTimeout(hideLoader, 400);
}
init();