/**
 * CC-Sessions Web UI
 *
 * Generates the SPA HTML that provides a claude.ai-style interface for
 * browsing session memories organised by project.
 *
 * Security: the client-side JavaScript uses only createElement / textContent /
 * appendChild — no innerHTML anywhere — so user-supplied strings from the API
 * are never interpreted as HTML markup.
 */

/**
 * Returns the full SPA HTML document as a string.
 * All dynamic rendering on the client side is done via safe DOM APIs.
 */
export function getUIHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CC Sessions</title>
  <style>
    :root {
      --bg:          #1a1a1a;
      --sidebar-bg:  #1e1e1e;
      --card-bg:     #252525;
      --card-hover:  #2d2d2d;
      --border:      #383838;
      --text:        #e8e8e8;
      --muted:       #888888;
      --dim:         #555555;
      --accent:      #d4956a;
      --green:       #4ade80;
      --yellow:      #fbbf24;
      --red:         #ef4444;
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text);
      display: flex; height: 100vh; overflow: hidden;
      font-size: 14px; line-height: 1.5;
    }

    /* ── Sidebar ──────────────────────────────────────────────────── */
    .sidebar {
      width: 240px; min-width: 240px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
    .brand { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .brand svg { color: var(--accent); flex-shrink: 0; }
    .sidebar-search { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .sidebar-search-input {
      width: 100%; background: #2a2a2a; border: 1px solid var(--border);
      border-radius: 6px; padding: 7px 10px; color: var(--text);
      font-size: 13px; outline: none; transition: border-color .15s;
    }
    .sidebar-search-input:focus { border-color: #555; }
    .sidebar-search-input::placeholder { color: var(--dim); }
    .sidebar-nav { padding: 8px; }
    .nav-item {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 8px; border-radius: 6px; cursor: pointer;
      font-size: 13px; color: var(--muted);
      transition: background .12s, color .12s; user-select: none;
    }
    .nav-item:hover  { background: var(--card-hover); color: var(--text); }
    .nav-item.active { background: var(--card-hover); color: var(--text); }
    .sidebar-recents { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
    .section-label {
      font-size: 11px; font-weight: 600; color: var(--dim);
      text-transform: uppercase; letter-spacing: .06em; padding: 10px 8px 4px;
    }
    .recent-item {
      padding: 5px 8px; border-radius: 5px; cursor: pointer;
      font-size: 12px; color: var(--muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      transition: background .1s, color .1s;
    }
    .recent-item:hover { background: var(--card-hover); color: var(--text); }

    /* ── Main ─────────────────────────────────────────────────────── */
    .main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-width: 0; }
    .view { display: none; flex-direction: column; flex: 1; }
    .view.active { display: flex; }

    /* ── Projects ─────────────────────────────────────────────────── */
    .view-header { padding: 32px 48px 16px; display: flex; align-items: center; justify-content: space-between; }
    .view-title  { font-size: 26px; font-weight: 600; }
    .stats-bar   { display: flex; gap: 32px; padding: 0 48px 20px; }
    .stat        { display: flex; flex-direction: column; gap: 2px; }
    .stat-value  { font-size: 20px; font-weight: 600; }
    .stat-label  { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .05em; }
    .toolbar     { display: flex; align-items: center; gap: 10px; padding: 0 48px 20px; }
    .toolbar-search {
      flex: 1; background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 9px 14px; color: var(--text);
      font-size: 13px; outline: none; transition: border-color .15s;
    }
    .toolbar-search:focus { border-color: #555; }
    .toolbar-search::placeholder { color: var(--dim); }
    .sort-select {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 6px; padding: 8px 12px; color: var(--muted);
      font-size: 12px; outline: none; cursor: pointer;
    }
    .projects-grid {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 14px; padding: 0 48px 48px;
    }
    .project-card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 10px; padding: 20px; cursor: pointer;
      transition: background .12s, border-color .12s;
      display: flex; flex-direction: column; gap: 6px; min-height: 110px;
    }
    .project-card:hover { background: var(--card-hover); border-color: #4a4a4a; }
    .project-card-name { font-size: 14px; font-weight: 600; }
    .project-card-desc {
      font-size: 12px; color: var(--muted); flex: 1;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .project-card-footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 6px; font-size: 11px; color: var(--dim);
    }
    .badge {
      background: #2a2a2a; border: 1px solid var(--border);
      border-radius: 4px; padding: 2px 7px; font-size: 11px; color: var(--muted);
    }

    /* ── Session list ─────────────────────────────────────────────── */
    .back-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 24px 48px 0; padding: 5px 8px; border-radius: 6px; cursor: pointer;
      font-size: 12px; color: var(--muted); transition: color .12s, background .12s; width: fit-content;
    }
    .back-btn:hover { color: var(--text); background: var(--card-hover); }
    .sessions-list { padding: 16px 48px 48px; display: flex; flex-direction: column; gap: 8px; }
    .session-card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 14px 18px; cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .session-card:hover { background: var(--card-hover); border-color: #4a4a4a; }
    .session-card-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; margin-bottom: 4px;
    }
    .session-card-title  { font-size: 13px; font-weight: 500; flex: 1; }
    .session-card-time   { font-size: 11px; color: var(--dim); white-space: nowrap; flex-shrink: 0; }
    .session-card-desc   {
      font-size: 12px; color: var(--muted); margin-bottom: 6px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .session-card-meta   { display: flex; gap: 12px; font-size: 11px; color: var(--dim); }

    /* ── Session detail ───────────────────────────────────────────── */
    .detail-wrap  { padding: 0 48px 64px; }
    .detail-title { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .detail-meta  { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--dim); margin-bottom: 28px; }
    .detail-section       { margin-bottom: 24px; }
    .detail-section-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .06em; color: var(--dim); margin-bottom: 10px;
    }
    .detail-desc { font-size: 13px; color: var(--muted); line-height: 1.65; }
    .task-item   { display: flex; align-items: flex-start; gap: 9px; padding: 5px 0; font-size: 13px; }
    .task-dot {
      width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; margin-top: 1px; border: 1px solid var(--border);
    }
    .task-dot.completed { background: #1a3a2a; border-color: #2a6a4a; color: var(--green); }
    .file-list { display: flex; flex-wrap: wrap; gap: 5px; }
    .file-chip {
      background: #2a2a2a; border: 1px solid var(--border);
      border-radius: 4px; padding: 3px 8px; font-size: 11px;
      font-family: 'SF Mono', 'Fira Code', monospace; color: var(--muted);
    }
    .file-chip.created  { border-color: #2a4a3a; color: var(--green); }
    .file-chip.modified { border-color: #3a3a2a; color: var(--yellow); }
    .detail-id { font-size: 11px; color: var(--dim); padding-top: 16px; border-top: 1px solid var(--border); margin-top: 32px; }

    /* ── Shared ───────────────────────────────────────────────────── */
    .loading { display: flex; align-items: center; justify-content: center; padding: 64px; gap: 10px; color: var(--dim); font-size: 13px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .6s linear infinite; flex-shrink: 0; }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 48px; text-align: center; gap: 10px; }
    .empty-icon  { font-size: 36px; opacity: .35; }
    .empty-title { font-size: 16px; color: var(--muted); }
    .empty-desc  { font-size: 13px; color: var(--dim); }
    .search-note { padding: 0 48px; margin-bottom: 16px; font-size: 12px; color: var(--dim); }
    ::-webkit-scrollbar              { width: 5px; }
    ::-webkit-scrollbar-track        { background: transparent; }
    ::-webkit-scrollbar-thumb        { background: #3a3a3a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover  { background: #4a4a4a; }

    /* ── Project Summary ──────────────────────────────────────────────────────── */
    .proj-summary-stats { display: flex; gap: 24px; flex-wrap: wrap; padding: 0 48px 24px; }
    .proj-summary-stat {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 14px 20px; display: flex; flex-direction: column; gap: 4px; min-width: 110px;
    }
    .proj-summary-stat-value { font-size: 22px; font-weight: 600; color: var(--text); }
    .proj-summary-stat-label { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .05em; }
    .proj-summary-section { padding: 0 48px 24px; }
    .proj-summary-section-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .06em; color: var(--dim); margin-bottom: 12px;
    }
    .proj-summary-recent { display: flex; flex-direction: column; gap: 8px; }
    .proj-summary-browse {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 4px 48px 48px; padding: 9px 18px;
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--muted);
      transition: background .12s, border-color .12s, color .12s; width: fit-content;
    }
    .proj-summary-browse:hover { background: var(--card-hover); border-color: #4a4a4a; color: var(--text); }
    .proj-summary-readme {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 18px 24px; font-size: 13.5px; line-height: 1.7;
      color: var(--muted); word-break: break-word;
    }
    .proj-summary-readme h1,.proj-summary-readme h2,.proj-summary-readme h3 {
      color: var(--text); margin: 16px 0 8px; font-weight: 600;
    }
    .proj-summary-readme h1 { font-size: 20px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    .proj-summary-readme h2 { font-size: 16px; }
    .proj-summary-readme h3 { font-size: 14px; }
    .proj-summary-readme p  { margin: 0 0 10px; }
    .proj-summary-readme ul,.proj-summary-readme ol { padding-left: 22px; margin: 0 0 10px; }
    .proj-summary-readme li { margin-bottom: 4px; }
    .proj-summary-readme code {
      background: #2a2a2a; border-radius: 4px; padding: 1px 5px;
      font-size: 12px; font-family: 'SF Mono', monospace; color: #e0e0e0;
    }
    .proj-summary-readme pre {
      background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px;
      padding: 12px 16px; overflow-x: auto; margin: 0 0 12px;
    }
    .proj-summary-readme pre code { background: none; padding: 0; }
    .proj-summary-readme blockquote {
      border-left: 3px solid #4a4a4a; margin: 0 0 10px; padding: 4px 14px;
      color: var(--dim);
    }
    .proj-summary-readme a { color: #7eb8f7; text-decoration: none; }
    .proj-summary-readme a:hover { text-decoration: underline; }
    .proj-summary-readme hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
    .proj-summary-readme-empty {
      font-style: italic; color: var(--dim);
    }
  </style>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
</head>
<body>

<aside class="sidebar">
  <div class="sidebar-header">
    <div class="brand">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      CC Sessions
    </div>
  </div>
  <div class="sidebar-search">
    <input type="search" class="sidebar-search-input" id="sidebar-search" placeholder="Search sessions\u2026" autocomplete="off">
  </div>
  <div class="sidebar-nav">
    <div class="nav-item active" id="nav-projects" role="button" tabindex="0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      Projects
    </div>
    <div class="nav-item" id="nav-all" role="button" tabindex="0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      All Sessions
    </div>
  </div>
  <div class="sidebar-recents">
    <div class="section-label">Recents</div>
    <div id="recents"></div>
  </div>
</aside>

<main class="main">
  <div class="view active" id="view-projects">
    <div class="view-header"><h1 class="view-title">Projects</h1></div>
    <div class="stats-bar" id="stats-bar"></div>
    <div class="toolbar">
      <input type="search" class="toolbar-search" id="proj-filter" placeholder="Filter projects\u2026" autocomplete="off">
      <select class="sort-select" id="proj-sort">
        <option value="activity">Sort by Activity</option>
        <option value="name">Sort by Name</option>
        <option value="sessions">Sort by Sessions</option>
      </select>
    </div>
    <div class="projects-grid" id="projects-grid"></div>
  </div>

  <div class="view" id="view-all">
    <div class="back-btn" id="all-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      Projects
    </div>
    <div class="view-header"><h1 class="view-title">All Sessions</h1></div>
    <div class="sessions-list" id="all-list"></div>
  </div>

  <div class="view" id="view-proj-sessions">
    <div class="back-btn" id="proj-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      Projects
    </div>
    <div class="view-header"><h1 class="view-title" id="proj-title"></h1></div>
    <div class="sessions-list" id="proj-list"></div>
  </div>

  <div class="view" id="view-detail">
    <div class="back-btn" id="detail-back" role="button" tabindex="0">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      <span id="detail-back-label">Back</span>
    </div>
    <div class="view-header" style="padding-bottom:0">
      <h1 class="view-title" id="detail-heading"></h1>
    </div>
    <div class="detail-wrap" id="detail-body"></div>
  </div>

  <div class="view" id="view-search">
    <div class="back-btn" id="search-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      Back
    </div>
    <div class="view-header"><h1 class="view-title">Search Results</h1></div>
    <div class="search-note" id="search-note"></div>
    <div class="sessions-list" id="search-list"></div>
  </div>

  <div class="view" id="view-proj-summary">
    <div class="back-btn" id="proj-summary-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      Projects
    </div>
    <div class="view-header"><h1 class="view-title" id="proj-summary-title"></h1></div>
    <div class="proj-summary-stats" id="proj-summary-stats"></div>
    <div class="proj-summary-section" id="proj-summary-readme-section">
      <div class="proj-summary-section-title">README</div>
      <div class="proj-summary-readme" id="proj-summary-readme"></div>
    </div>
    <div class="proj-summary-section">
      <div class="proj-summary-section-title">Recent Activity</div>
      <div class="proj-summary-recent" id="proj-summary-recent"></div>
    </div>
    <div class="proj-summary-browse" id="proj-summary-browse-btn">Browse All Sessions \u2192</div>
  </div>
</main>

<script>
(function () {
'use strict';

/* ─── hyperscript helper ─────────────────────────────────────────────────── */
/**
 * Minimal hyperscript — creates DOM elements without any innerHTML.
 * All text content is set via textContent / createTextNode.
 *
 * @param {string} tag
 * @param {Record<string,string|Function|Record<string,string>>|null} props
 * @param {...(Node|string|null|undefined|false|(Node|string)[])} children
 * @returns {HTMLElement}
 */
function h(tag, props) {
  var el = document.createElement(tag);
  if (props) {
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = props[k];
      if (k === 'class')    { el.className = v; }
      else if (k === 'text') { el.textContent = v; }
      else if (k === 'style') { el.style.cssText = v; }
      else if (k === 'id')  { el.id = v; }
      else if (k.startsWith('data-')) { el.setAttribute(k, v); }
      else if (typeof v === 'function') { el.addEventListener(k, v); }
      else { el.setAttribute(k, v); }
    }
  }
  for (var c = 2; c < arguments.length; c++) {
    appendChildren(el, arguments[c]);
  }
  return el;
}

function appendChildren(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach(function(c){ appendChildren(parent, c); }); }
  else if (child instanceof Node)  { parent.appendChild(child); }
  else if (typeof child === 'string' || typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)));
  }
}

function txt(str) { return document.createTextNode(str || ''); }

/* ─── utilities ──────────────────────────────────────────────────────────── */

function relativeTime(value) {
  var date = value instanceof Date ? value : new Date(value);
  var diffMs = Date.now() - date.getTime();
  var mins  = Math.floor(diffMs / 60000);
  var hours = Math.floor(mins  / 60);
  var days  = Math.floor(hours / 24);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return mins  + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days  < 7)  return days  + 'd ago';
  if (days  < 30) return Math.floor(days / 7)  + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

function formatDuration(minutes) {
  if (!minutes || minutes < 1) return '< 1m';
  if (minutes < 60) return minutes + 'm';
  var h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
}

function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000)     return String(n);
  if (n < 1000000)  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function trunc(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 1) + '\u2026';
}

function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function get(path) {
  return fetch(path).then(function(r) { return r.json(); });
}

/* ─── state ──────────────────────────────────────────────────────────────── */
var state = {
  projects:    [],
  currentView: 'projects',
  backView:    'projects',
};

/* ─── view management ────────────────────────────────────────────────────── */
function showView(id) {
  state.currentView = id;
  document.querySelectorAll('.view').forEach(function(el) {
    el.classList.toggle('active', el.id === 'view-' + id);
  });
  document.getElementById('nav-projects').classList.toggle('active', id === 'projects');
  document.getElementById('nav-all').classList.toggle('active', id === 'all');
}

/* ─── loading / empty helpers ────────────────────────────────────────────── */
function loadingNode() {
  return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), txt(' Loading\u2026'));
}

function emptyNode(icon, title, desc) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-icon', text: icon }),
    h('div', { class: 'empty-title', text: title }),
    h('div', { class: 'empty-desc',  text: desc })
  );
}

/* ─── stats bar ──────────────────────────────────────────────────────────── */
function statNode(value, label) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-value', text: String(value) }),
    h('span', { class: 'stat-label', text: label })
  );
}

/* ─── project cards ──────────────────────────────────────────────────────── */
function buildProjectCard(p) {
  var footer = h('div', { class: 'project-card-footer' },
    h('span', { text: 'Updated ' + relativeTime(p.lastSessionAt) }),
    h('span', { class: 'badge', text: p.sessionCount + ' session' + (p.sessionCount !== 1 ? 's' : '') })
  );

  var card = h('div', { class: 'project-card',
                         click: function() { openProjectSummary(p.projectPath, p.projectName); } },
    h('div', { class: 'project-card-name', text: p.projectName })
  );

  if (p.lastSummary) {
    card.appendChild(h('div', { class: 'project-card-desc', text: trunc(p.lastSummary, 100) }));
  }

  card.appendChild(footer);
  return card;
}

function renderProjects(projects) {
  var grid = document.getElementById('projects-grid');
  clearEl(grid);

  if (!projects || projects.length === 0) {
    grid.appendChild(emptyNode('\uD83D\uDCC2', 'No projects yet',
      'Sessions will appear here once you start working with Claude Code'));
    return;
  }

  projects.forEach(function(p) { grid.appendChild(buildProjectCard(p)); });
}

function sortProjects() {
  var by = document.getElementById('proj-sort').value;
  var sorted = state.projects.slice();
  if (by === 'name') {
    sorted.sort(function(a, b) { return a.projectName.localeCompare(b.projectName); });
  } else if (by === 'sessions') {
    sorted.sort(function(a, b) { return b.sessionCount - a.sessionCount; });
  } else {
    sorted.sort(function(a, b) { return new Date(b.lastSessionAt) - new Date(a.lastSessionAt); });
  }
  renderProjects(sorted);
}

/* ─── session cards ──────────────────────────────────────────────────────── */
function buildSessionCard(s, backView) {
  var header = h('div', { class: 'session-card-header' },
    h('div', { class: 'session-card-title', text: trunc(s.summary || 'Untitled session', 90) }),
    h('div', { class: 'session-card-time',  text: relativeTime(s.startedAt) })
  );

  var meta = h('div', { class: 'session-card-meta' },
    h('span', { text: formatDuration(s.duration) }),
    h('span', { text: formatTokens(s.tokensUsed) + ' tokens' })
  );
  if (s.messagesCount) {
    meta.appendChild(h('span', { text: s.messagesCount + ' messages' }));
  }
  if (s.tasksCompleted > 0) {
    meta.appendChild(h('span', { text: s.tasksCompleted + ' task' + (s.tasksCompleted !== 1 ? 's' : '') + ' done' }));
  }
  if (s.tasksPending > 0) {
    meta.appendChild(h('span', { style: 'color:var(--yellow)', text: s.tasksPending + ' pending' }));
  }

  var card = h('div', { class: 'session-card',
                         click: function() { openDetail(s.id, backView); } },
    header
  );

  if (s.description) {
    card.appendChild(h('div', { class: 'session-card-desc', text: trunc(s.description, 130) }));
  }
  card.appendChild(meta);
  return card;
}

function renderSessionList(sessions, container, backView) {
  clearEl(container);
  if (!sessions || sessions.length === 0) {
    container.appendChild(emptyNode('\uD83D\uDD50', 'No sessions found',
      'Sessions will appear here once saved by the cc-sessions hook'));
    return;
  }
  sessions.forEach(function(s) { container.appendChild(buildSessionCard(s, backView)); });
}

/* ─── loaders ────────────────────────────────────────────────────────────── */
function loadRecents() {
  return get('/api/sessions?limit=12').then(function(res) {
    var list = document.getElementById('recents');
    clearEl(list);
    var sessions = Array.isArray(res.data) ? res.data : [];
    if (sessions.length === 0) {
      var empty = h('div', { class: 'recent-item', style: 'opacity:.4;cursor:default' });
      empty.textContent = 'No sessions yet';
      list.appendChild(empty);
      return;
    }
    sessions.forEach(function(s) {
      var item = h('div', { class: 'recent-item',
                             title: s.summary || '',
                             click: function() { openDetail(s.id, 'projects'); } },
        txt(trunc(s.summary || 'Untitled', 34))
      );
      list.appendChild(item);
    });
  });
}

function loadProjects() {
  return get('/api/projects').then(function(res) {
    state.projects = Array.isArray(res.data) ? res.data : [];
    renderProjects(state.projects);
  });
}

function loadStats() {
  return get('/api/stats').then(function(res) {
    if (!res.data) return;
    var bar = document.getElementById('stats-bar');
    clearEl(bar);
    bar.appendChild(statNode(res.data.totalSessions, 'Sessions'));
    bar.appendChild(statNode(state.projects.length,  'Projects'));
    bar.appendChild(statNode(formatTokens(res.data.totalSessions * 8000), 'Tokens (est.)'));
  });
}

/* ─── project sessions ───────────────────────────────────────────────────── */
function openProject(projectPath, projectName) {
  document.getElementById('proj-title').textContent = projectName;
  showView('proj-sessions');

  var list = document.getElementById('proj-list');
  clearEl(list);
  list.appendChild(loadingNode());

  get('/api/sessions?project=' + encodeURIComponent(projectPath) + '&limit=50')
    .then(function(res) {
      renderSessionList(Array.isArray(res.data) ? res.data : [], list, 'proj-sessions');
    });
}

function openProjectSummary(projectPath, projectName) {
  document.getElementById('proj-summary-title').textContent = projectName;
  document.getElementById('proj-summary-browse-btn').setAttribute('data-path', projectPath);
  showView('proj-summary');

  var statsEl  = document.getElementById('proj-summary-stats');
  var recentEl = document.getElementById('proj-summary-recent');
  clearEl(statsEl); clearEl(recentEl);
  statsEl.appendChild(loadingNode());

  get('/api/projects/' + encodeURIComponent(projectPath)).then(function(res) {
    clearEl(statsEl); clearEl(recentEl);
    if (res.error || !res.data) { statsEl.appendChild(emptyNode('', 'Not found', '')); return; }
    var d = res.data;
    statsEl.appendChild(projSummaryStat(String(d.sessionCount), 'Sessions'));
    statsEl.appendChild(projSummaryStat(formatTokens(d.totalTokens), 'Tokens'));
    statsEl.appendChild(projSummaryStat(formatDuration(d.totalDuration), 'Duration'));
    statsEl.appendChild(projSummaryStat(String(d.totalTasksCompleted), 'Tasks Done'));

    // README — rendered via marked + DOMPurify
    var readmeEl = document.getElementById('proj-summary-readme');
    if (d.readmeContent && d.readmeContent.trim()) {
      var rawHtml = window.marked ? window.marked.parse(d.readmeContent) : d.readmeContent.replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; });
      readmeEl.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(rawHtml) : rawHtml;
      readmeEl.classList.remove('proj-summary-readme-empty');
    } else {
      readmeEl.textContent = 'No README found for this project.';
      readmeEl.classList.add('proj-summary-readme-empty');
    }

    var sessions = d.recentSessions || [];
    if (!sessions.length) { recentEl.appendChild(emptyNode('\uD83D\uDD50', 'No sessions yet', '')); }
    else sessions.forEach(function(s) { recentEl.appendChild(buildSessionCard(s, 'proj-summary')); });
  });
}

function projSummaryStat(value, label) {
  return h('div', { class: 'proj-summary-stat' },
    h('span', { class: 'proj-summary-stat-value', text: value }),
    h('span', { class: 'proj-summary-stat-label', text: label })
  );
}

function openAll() {
  showView('all');
  var list = document.getElementById('all-list');
  clearEl(list);
  list.appendChild(loadingNode());

  get('/api/sessions?limit=100').then(function(res) {
    renderSessionList(Array.isArray(res.data) ? res.data : [], list, 'all');
  });
}

/* ─── session detail ─────────────────────────────────────────────────────── */
function openDetail(sessionId, backView) {
  state.backView = backView || 'projects';

  var labels = {
    'projects':      'Projects',
    'all':           'All Sessions',
    'proj-sessions': document.getElementById('proj-title').textContent || 'Sessions',
    'proj-summary':  document.getElementById('proj-summary-title').textContent || 'Project',
    'search':        'Search Results',
  };
  document.getElementById('detail-back-label').textContent = labels[state.backView] || 'Back';
  document.getElementById('detail-heading').textContent = '';

  showView('detail');

  var body = document.getElementById('detail-body');
  clearEl(body);
  body.appendChild(loadingNode());

  get('/api/sessions/' + encodeURIComponent(sessionId)).then(function(res) {
    clearEl(body);

    if (res.error || !res.data) {
      body.appendChild(emptyNode('', 'Session not found', 'The session may have been deleted'));
      return;
    }

    var s = res.data;
    document.getElementById('detail-heading').textContent = trunc(s.summary || 'Untitled Session', 80);

    // Meta row
    var meta = h('div', { class: 'detail-meta' },
      h('span', { text: '\uD83D\uDCC5 ' + new Date(s.startedAt).toLocaleString() }),
      h('span', { text: '\u23F1 ' + formatDuration(s.duration) }),
      h('span', { text: '\uD83D\uDD24 ' + formatTokens(s.tokensUsed) + ' tokens' })
    );
    if (s.messagesCount) meta.appendChild(h('span', { text: '\uD83D\uDCAC ' + s.messagesCount + ' messages' }));
    body.appendChild(meta);

    // Description
    if (s.description) {
      body.appendChild(detailSection('Summary',
        h('div', { class: 'detail-desc', text: s.description })
      ));
    }

    // Tasks
    var completed = (s.tasks || []).filter(function(t) { return t.status === 'completed'; });
    var pending   = (s.tasks || []).filter(function(t) { return t.status !== 'completed'; });

    if (completed.length > 0) {
      body.appendChild(detailSection('Completed Tasks',
        completed.map(function(t) { return taskRow('completed', t.description); })
      ));
    }
    if (pending.length > 0) {
      body.appendChild(detailSection('Pending Tasks',
        pending.map(function(t) { return taskRow('', t.description); })
      ));
    }

    // Files
    var created  = s.filesCreated  || [];
    var modified = s.filesModified || [];
    if (created.length > 0 || modified.length > 0) {
      var fileList = h('div', { class: 'file-list' });
      created.forEach(function(f) { fileList.appendChild(h('span', { class: 'file-chip created', text: f })); });
      modified.forEach(function(f){ fileList.appendChild(h('span', { class: 'file-chip modified', text: f })); });
      body.appendChild(detailSection('Files', fileList));
    }

    // Key decisions
    if ((s.keyDecisions || []).length > 0) {
      body.appendChild(detailSection('Key Decisions',
        s.keyDecisions.map(function(d) { return arrowRow(d); })
      ));
    }

    // Next steps
    if ((s.nextSteps || []).length > 0) {
      body.appendChild(detailSection('Next Steps',
        s.nextSteps.map(function(step, i) { return numberedRow(i + 1, step); })
      ));
    }

    // Blockers
    if ((s.blockers || []).length > 0) {
      body.appendChild(detailSection('Blockers',
        s.blockers.map(function(b) { return warningRow(b); }),
        'var(--red)'
      ));
    }

    // Footer
    var footer = h('div', { class: 'detail-id' });
    footer.textContent = 'Session ID: ' + s.id;
    body.appendChild(footer);
  });
}

function detailSection(title, content, titleColor) {
  var sec = h('div', { class: 'detail-section' });
  var heading = h('div', { class: 'detail-section-title', text: title });
  if (titleColor) heading.style.color = titleColor;
  sec.appendChild(heading);
  if (Array.isArray(content)) { content.forEach(function(c) { sec.appendChild(c); }); }
  else { sec.appendChild(content); }
  return sec;
}

function taskRow(status, description) {
  var dot = h('div', { class: 'task-dot' + (status === 'completed' ? ' completed' : '') });
  if (status === 'completed') dot.textContent = '\u2713';
  return h('div', { class: 'task-item' }, dot, h('span', { text: description }));
}

function arrowRow(text) {
  var dot = h('span', { class: 'task-dot', style: 'font-size:11px', text: '\u2192' });
  return h('div', { class: 'task-item' }, dot, h('span', { text: text }));
}

function numberedRow(n, text) {
  var dot = h('span', { class: 'task-dot', style: 'color:var(--accent);font-size:10px', text: String(n) });
  return h('div', { class: 'task-item' }, dot, h('span', { text: text }));
}

function warningRow(text) {
  var icon = h('span', { style: 'color:var(--red)', text: '\u26A0' });
  return h('div', { class: 'task-item' }, icon, h('span', { text: text }));
}

/* ─── search ─────────────────────────────────────────────────────────────── */
var searchTimer = null;

document.getElementById('sidebar-search').addEventListener('input', function(e) {
  clearTimeout(searchTimer);
  var q = e.target.value.trim();
  if (!q) { if (state.currentView === 'search') showView('projects'); return; }
  searchTimer = setTimeout(function() { performSearch(q); }, 320);
});

function performSearch(query) {
  showView('search');
  document.getElementById('search-note').textContent = 'Showing results for: "' + query + '"';

  var list = document.getElementById('search-list');
  clearEl(list);
  list.appendChild(loadingNode());

  get('/api/search?q=' + encodeURIComponent(query) + '&limit=20').then(function(res) {
    var sessions = Array.isArray(res.data) ? res.data.map(function(r) { return r.session; }) : [];
    renderSessionList(sessions, list, 'search');
  });
}

/* ─── event wiring ───────────────────────────────────────────────────────── */
document.getElementById('nav-projects').addEventListener('click', function() { showView('projects'); });
document.getElementById('nav-all').addEventListener('click', openAll);

document.getElementById('all-back').addEventListener('click',    function() { showView('projects'); });
document.getElementById('proj-back').addEventListener('click',   function() { showView('projects'); });
document.getElementById('search-back').addEventListener('click', function() { showView('projects'); });
document.getElementById('detail-back').addEventListener('click', function() { showView(state.backView); });

document.getElementById('proj-summary-back').addEventListener('click', function() {
  showView('projects');
});
document.getElementById('proj-summary-browse-btn').addEventListener('click', function() {
  var btn   = document.getElementById('proj-summary-browse-btn');
  var path  = btn.getAttribute('data-path');
  var title = document.getElementById('proj-summary-title').textContent;
  if (path) openProject(path, title);
});

document.getElementById('proj-filter').addEventListener('input', function(e) {
  var q = e.target.value.trim().toLowerCase();
  if (!q) { renderProjects(state.projects); return; }
  renderProjects(state.projects.filter(function(p) {
    return p.projectName.toLowerCase().includes(q) ||
           (p.lastSummary || '').toLowerCase().includes(q);
  }));
});

document.getElementById('proj-sort').addEventListener('change', sortProjects);

/* ─── init ───────────────────────────────────────────────────────────────── */
Promise.all([loadRecents(), loadProjects()]).then(loadStats).catch(function(err) {
  console.error('CC Sessions UI error:', err);
});

})();
</script>
</body>
</html>`;
}
