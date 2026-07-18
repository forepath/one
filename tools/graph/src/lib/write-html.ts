import * as fs from 'fs';
import * as path from 'path';

/**
 * Write a self-contained HTML viewer that loads sibling graph.json.
 */
export function writeGraphHtml(outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const finalPath = path.join(outDir, 'graph.html');
  const tempPath = path.join(outDir, `.graph.html.${process.pid}.tmp`);
  fs.writeFileSync(tempPath, GRAPH_HTML, 'utf8');
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}

const GRAPH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Forepath Knowledge Graph</title>
  <style>
    :root {
      --bg: #0b0f14;
      --panel: #141b24;
      --panel-2: #1a2332;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --accent: #6ea8fe;
      --border: #243044;
      --app: #7dd3fc;
      --lib: #c4b5fd;
      --tool: #5eead4;
      --package: #86efac;
      --patch: #fca5a5;
      --domain: #f87171;
      --context: #a3e635;
      --feature-group: #fcd34d;
      --controller: #67e8f9;
      --gateway: #22d3ee;
      --job: #f97316;
      --service: #a78bfa;
      --repository: #818cf8;
      --entity: #c084fc;
      --dto: #ddd6fe;
      --guard: #fb7185;
      --module: #94a3b8;
      --state: #e879f9;
      --provider: #fbbf24;
      --email: #f9a8d4;
      --webhook-event: #fdba74;
      --doc: #f472b6;
      --readme: #d946ef;
      --openapi: #2dd4bf;
      --asyncapi: #38bdf8;
      --diagram: #fb923c;
      --endpoint: #34d399;
      --concept: #fde68a;
      --scrollbar-thumb: rgba(231, 236, 243, 0.28);
      --scrollbar-thumb-hover: rgba(231, 236, 243, 0.45);
      --scrollbar-thumb-active: rgba(231, 236, 243, 0.55);
      --scrollbar-track: transparent;
    }
    * { box-sizing: border-box; }
    /* Firefox only — Chrome ignores ::-webkit-scrollbar-* when scrollbar-width is set on the same element. */
    @supports not selector(::-webkit-scrollbar) {
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
      }
    }
    *::-webkit-scrollbar {
      width: 0.5rem;
      height: 0.5rem;
      -webkit-appearance: none;
    }
    *::-webkit-scrollbar-button,
    *::-webkit-scrollbar-button:single-button,
    *::-webkit-scrollbar-button:double-button,
    *::-webkit-scrollbar-button:vertical:start:decrement,
    *::-webkit-scrollbar-button:vertical:end:increment,
    *::-webkit-scrollbar-button:horizontal:start:decrement,
    *::-webkit-scrollbar-button:horizontal:end:increment {
      display: none;
      width: 0;
      height: 0;
    }
    *::-webkit-scrollbar-track {
      background: var(--scrollbar-track);
    }
    *::-webkit-scrollbar-thumb {
      background-color: var(--scrollbar-thumb);
      border: 2px solid transparent;
      border-radius: 4px;
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover {
      background-color: var(--scrollbar-thumb-hover);
    }
    *::-webkit-scrollbar-thumb:active {
      background-color: var(--scrollbar-thumb-active);
    }
    *::-webkit-scrollbar-corner {
      background: var(--scrollbar-track);
    }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
    }
    header {
      flex: 0 0 auto;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      align-items: center;
      justify-content: space-between;
    }
    .brand h1 { margin: 0; font-size: 1rem; font-weight: 600; letter-spacing: 0.01em; }
    .meta { color: var(--muted); font-size: 0.8rem; margin-top: 0.15rem; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      align-items: end;
    }
    label.ctrl {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.72rem;
      color: var(--muted);
    }
    input[type="search"], select, input[type="number"] {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      min-width: 9rem;
      font-size: 0.85rem;
    }
    input[type="number"] { min-width: 4.5rem; width: 4.5rem; }
    .btn {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.4rem 0.75rem;
      border-radius: 4px;
      font-size: 0.85rem;
      cursor: pointer;
      align-self: end;
    }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .type-filter {
      position: relative;
      align-self: end;
    }
    .type-filter-btn {
      min-width: 9rem;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .type-filter-btn .caret {
      font-size: 0.65rem;
      opacity: 0.7;
    }
    .type-filter-summary {
      color: var(--muted);
      font-weight: 400;
    }
    .type-filter-panel {
      position: absolute;
      top: calc(100% + 0.35rem);
      right: 0;
      z-index: 40;
      width: min(22rem, calc(100vw - 1.5rem));
      max-height: min(22rem, calc(100vh - 6rem));
      display: none;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.55rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    }
    .type-filter.open .type-filter-panel {
      display: flex;
    }
    .type-filter-panel input[type="search"] {
      flex: 0 0 auto;
      width: 100%;
      min-width: 0;
    }
    .type-filter-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding-right: 0.15rem;
    }
    .type-filter-list label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.28rem 0.35rem;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .type-filter-list label:hover {
      background: var(--panel-2);
      color: var(--text);
    }
    .type-filter-list label.hidden {
      display: none;
    }
    .type-filter-empty {
      display: none;
      padding: 0.5rem 0.35rem;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .type-filter-empty.visible {
      display: block;
    }
    .toggles {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      align-items: center;
      align-self: end;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .toggles label {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      cursor: pointer;
      user-select: none;
    }
    .swatch {
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      display: inline-block;
    }
    .swatch.app { background: var(--app); }
    .swatch.lib { background: var(--lib); }
    .swatch.tool { background: var(--tool); }
    .swatch.package { background: var(--package); }
    .swatch.patch { background: var(--patch); }
    .swatch.domain { background: var(--domain); }
    .swatch.context { background: var(--context); }
    .swatch.feature-group { background: var(--feature-group); }
    .swatch.controller { background: var(--controller); }
    .swatch.gateway { background: var(--gateway); }
    .swatch.job { background: var(--job); }
    .swatch.service { background: var(--service); }
    .swatch.repository { background: var(--repository); }
    .swatch.entity { background: var(--entity); }
    .swatch.dto { background: var(--dto); }
    .swatch.guard { background: var(--guard); }
    .swatch.module { background: var(--module); }
    .swatch.state { background: var(--state); }
    .swatch.provider { background: var(--provider); }
    .swatch.email { background: var(--email); }
    .swatch.webhook-event { background: var(--webhook-event); }
    .swatch.doc { background: var(--doc); }
    .swatch.readme { background: var(--readme); }
    .swatch.openapi { background: var(--openapi); }
    .swatch.asyncapi { background: var(--asyncapi); }
    .swatch.diagram { background: var(--diagram); }
    .swatch.endpoint { background: var(--endpoint); }
    .swatch.concept { background: var(--concept); }
    .layout {
      flex: 1 1 auto;
      display: grid;
      grid-template-columns: 1fr minmax(280px, 340px);
      min-height: 0;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; grid-template-rows: 55vh 1fr; }
    }
    .canvas-wrap {
      position: relative;
      min-height: 0;
      background:
        radial-gradient(ellipse at center, rgba(110, 168, 254, 0.06), transparent 55%),
        var(--bg);
      border-right: 1px solid var(--border);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: grab;
      touch-action: none;
    }
    canvas.dragging { cursor: grabbing; }
    canvas.hovering { cursor: pointer; }
    .hint {
      position: absolute;
      left: 0.75rem;
      bottom: 0.75rem;
      color: var(--muted);
      font-size: 0.72rem;
      pointer-events: none;
      background: rgba(11, 15, 20, 0.7);
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .popover {
      position: absolute;
      z-index: 5;
      min-width: 200px;
      max-width: min(360px, 70%);
      pointer-events: none;
      background: rgba(20, 27, 36, 0.96);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      padding: 0.65rem 0.75rem;
      display: none;
    }
    .popover.visible { display: block; }
    .popover .pop-type {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.25rem;
      font-weight: 600;
    }
    .popover .pop-type.app { color: var(--app); }
    .popover .pop-type.lib { color: var(--lib); }
    .popover .pop-type.domain { color: var(--domain); }
    .popover .pop-type.context { color: var(--context); }
    .popover .pop-type.feature-group { color: var(--feature-group); }
    .popover .pop-type.controller { color: var(--controller); }
    .popover .pop-type.doc { color: var(--doc); }
    .popover .pop-type.readme { color: var(--readme); }
    .popover .pop-type.openapi { color: var(--openapi); }
    .popover .pop-type.asyncapi { color: var(--asyncapi); }
    .popover .pop-type.diagram { color: var(--diagram); }
    .popover .pop-type.endpoint { color: var(--endpoint); }
    .popover .pop-type.concept { color: var(--concept); }
    .popover .pop-id {
      font-size: 0.82rem;
      font-weight: 600;
      word-break: break-all;
      margin-bottom: 0.45rem;
      color: var(--text);
    }
    .popover dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.2rem 0.65rem;
      font-size: 0.75rem;
    }
    .popover dt { color: var(--muted); }
    .popover dd { margin: 0; color: var(--text); word-break: break-word; }
    aside {
      min-height: 0;
      overflow: hidden;
      background: var(--panel);
      padding: 0.9rem 1rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .side-panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .side-panel > h2 {
      margin: 0 0 0.55rem;
      font-size: 0.8rem;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    .side-panel-body {
      min-height: 0;
      overflow: auto;
    }
    .side-detail {
      flex: 0 1 auto;
      max-height: 55%;
    }
    .side-detail .side-panel-body {
      flex: 1 1 auto;
      overflow: auto;
    }
    .side-detail .detail-subhead {
      margin: 0.85rem 0 0.4rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      color: var(--accent);
    }
    .side-matches {
      flex: 1 1 0;
      min-height: 8rem;
    }
    .side-matches .side-panel-body {
      flex: 1 1 auto;
      overflow: auto;
    }
    .empty { color: var(--muted); font-size: 0.85rem; }
    .detail-card {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .detail-type {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }
    .detail-type.app { color: var(--app); }
    .detail-type.lib { color: var(--lib); }
    .detail-type.tool { color: var(--tool); }
    .detail-type.package { color: var(--package); }
    .detail-type.patch { color: var(--patch); }
    .detail-type.domain { color: var(--domain); }
    .detail-type.context { color: var(--context); }
    .detail-type.feature-group { color: var(--feature-group); }
    .detail-type.controller { color: var(--controller); }
    .detail-type.gateway { color: var(--gateway); }
    .detail-type.job { color: var(--job); }
    .detail-type.service { color: var(--service); }
    .detail-type.repository { color: var(--repository); }
    .detail-type.entity { color: var(--entity); }
    .detail-type.dto { color: var(--dto); }
    .detail-type.guard { color: var(--guard); }
    .detail-type.module { color: var(--module); }
    .detail-type.state { color: var(--state); }
    .detail-type.provider { color: var(--provider); }
    .detail-type.email { color: var(--email); }
    .detail-type.webhook-event { color: var(--webhook-event); }
    .detail-type.doc { color: var(--doc); }
    .detail-type.readme { color: var(--readme); }
    .detail-type.openapi { color: var(--openapi); }
    .detail-type.asyncapi { color: var(--asyncapi); }
    .detail-type.diagram { color: var(--diagram); }
    .detail-type.endpoint { color: var(--endpoint); }
    .detail-type.concept { color: var(--concept); }
    .detail-id {
      font-size: 0.9rem;
      font-weight: 600;
      word-break: break-word;
      line-height: 1.35;
    }
    .detail-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .detail-chip {
      display: inline-block;
      font-size: 0.7rem;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .detail-fields {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.35rem 0.65rem;
      font-size: 0.78rem;
    }
    .detail-fields dt {
      color: var(--muted);
      font-weight: 500;
    }
    .detail-fields dd {
      margin: 0;
      color: var(--text);
      word-break: break-word;
    }
    .edge { font-size: 0.8rem; margin: 0.25rem 0; color: var(--muted); }
    .edge button {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      padding: 0;
      font: inherit;
      text-decoration: underline;
    }
    ul#nodeList { list-style: none; margin: 0; padding: 0; }
    ul#nodeList li {
      padding: 0.35rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.78rem;
      border: 1px solid transparent;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    ul#nodeList li:hover { background: var(--panel-2); }
    ul#nodeList li.active { border-color: var(--accent); background: var(--panel-2); }
    .type-tag { font-size: 0.7rem; margin-right: 0.35rem; opacity: 0.9; }
    .type-tag.app { color: var(--app); }
    .type-tag.lib { color: var(--lib); }
    .type-tag.tool { color: var(--tool); }
    .type-tag.package { color: var(--package); }
    .type-tag.patch { color: var(--patch); }
    .type-tag.domain { color: var(--domain); }
    .type-tag.context { color: var(--context); }
    .type-tag.feature-group { color: var(--feature-group); }
    .type-tag.controller { color: var(--controller); }
    .type-tag.gateway { color: var(--gateway); }
    .type-tag.job { color: var(--job); }
    .type-tag.service { color: var(--service); }
    .type-tag.repository { color: var(--repository); }
    .type-tag.entity { color: var(--entity); }
    .type-tag.dto { color: var(--dto); }
    .type-tag.guard { color: var(--guard); }
    .type-tag.module { color: var(--module); }
    .type-tag.state { color: var(--state); }
    .type-tag.provider { color: var(--provider); }
    .type-tag.email { color: var(--email); }
    .type-tag.webhook-event { color: var(--webhook-event); }
    .type-tag.doc { color: var(--doc); }
    .type-tag.readme { color: var(--readme); }
    .type-tag.openapi { color: var(--openapi); }
    .type-tag.asyncapi { color: var(--asyncapi); }
    .type-tag.diagram { color: var(--diagram); }
    .type-tag.endpoint { color: var(--endpoint); }
    .type-tag.concept { color: var(--concept); }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>Forepath Knowledge Graph</h1>
      <div class="meta" id="meta">Loading graph.json…</div>
    </div>
    <div class="controls">
      <label class="ctrl">Search
        <input id="search" type="search" placeholder="project:decabill-…" autocomplete="off" />
      </label>
      <label class="ctrl">Local hops
        <input id="hops" type="number" min="1" max="4" value="2" title="Neighborhood depth when a node is selected" />
      </label>
      <button type="button" id="fitBtn" class="btn">Fit</button>
      <div class="type-filter" id="typeFilter">
        <button type="button" class="btn type-filter-btn" id="typeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="typeFilterPanel">
          <span>Types <span class="type-filter-summary" id="typeFilterSummary">all</span></span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="type-filter-panel" id="typeFilterPanel" role="listbox" aria-label="Node types">
          <input id="typeFilterSearch" type="search" placeholder="Search types…" autocomplete="off" />
          <div class="type-filter-list" id="typeToggles">
            <label><input type="checkbox" data-type="app" checked /><span class="swatch app"></span>app</label>
            <label><input type="checkbox" data-type="lib" checked /><span class="swatch lib"></span>lib</label>
            <label><input type="checkbox" data-type="tool" checked /><span class="swatch tool"></span>tool</label>
            <label><input type="checkbox" data-type="package" checked /><span class="swatch package"></span>package</label>
            <label><input type="checkbox" data-type="patch" checked /><span class="swatch patch"></span>patch</label>
            <label><input type="checkbox" data-type="domain" checked /><span class="swatch domain"></span>domain</label>
            <label><input type="checkbox" data-type="context" checked /><span class="swatch context"></span>context</label>
            <label><input type="checkbox" data-type="feature-group" checked /><span class="swatch feature-group"></span>feature-group</label>
            <label><input type="checkbox" data-type="controller" checked /><span class="swatch controller"></span>controller</label>
            <label><input type="checkbox" data-type="gateway" checked /><span class="swatch gateway"></span>gateway</label>
            <label><input type="checkbox" data-type="job" checked /><span class="swatch job"></span>job</label>
            <label><input type="checkbox" data-type="service" checked /><span class="swatch service"></span>service</label>
            <label><input type="checkbox" data-type="repository" checked /><span class="swatch repository"></span>repository</label>
            <label><input type="checkbox" data-type="entity" checked /><span class="swatch entity"></span>entity</label>
            <label><input type="checkbox" data-type="dto" checked /><span class="swatch dto"></span>dto</label>
            <label><input type="checkbox" data-type="guard" checked /><span class="swatch guard"></span>guard</label>
            <label><input type="checkbox" data-type="module" checked /><span class="swatch module"></span>module</label>
            <label><input type="checkbox" data-type="state" checked /><span class="swatch state"></span>state</label>
            <label><input type="checkbox" data-type="provider" checked /><span class="swatch provider"></span>provider</label>
            <label><input type="checkbox" data-type="email" checked /><span class="swatch email"></span>email</label>
            <label><input type="checkbox" data-type="webhook-event" checked /><span class="swatch webhook-event"></span>webhook-event</label>
            <label><input type="checkbox" data-type="doc" checked /><span class="swatch doc"></span>doc</label>
            <label><input type="checkbox" data-type="readme" checked /><span class="swatch readme"></span>readme</label>
            <label><input type="checkbox" data-type="openapi" checked /><span class="swatch openapi"></span>openapi</label>
            <label><input type="checkbox" data-type="asyncapi" checked /><span class="swatch asyncapi"></span>asyncapi</label>
            <label><input type="checkbox" data-type="diagram" checked /><span class="swatch diagram"></span>diagram</label>
            <label><input type="checkbox" data-type="endpoint" checked /><span class="swatch endpoint"></span>endpoint</label>
            <label><input type="checkbox" data-type="concept" checked /><span class="swatch concept"></span>concept</label>
          </div>
          <div class="type-filter-empty" id="typeFilterEmpty">No types match.</div>
        </div>
      </div>
      <div class="toggles">
        <label><input type="checkbox" id="showLabels" />labels</label>
      </div>
    </div>
  </header>
  <div class="layout">
    <div class="canvas-wrap">
      <canvas id="graphCanvas" aria-label="Knowledge graph visualization"></canvas>
      <div id="nodePopover" class="popover" role="tooltip"></div>
      <div class="hint">Nothing selected = full graph fitted · select a node = center it and fit local hops · then pan/zoom freely</div>
    </div>
    <aside>
      <section id="detailPanel" class="side-panel side-detail">
        <h2>Details</h2>
        <div id="detail" class="side-panel-body empty">Select a node in the graph or list.</div>
      </section>
      <section class="side-panel side-matches">
        <h2>Matching nodes</h2>
        <div class="side-panel-body">
          <ul id="nodeList"></ul>
        </div>
      </section>
    </aside>
  </div>
  <script>
(function () {
  var COLORS = {
    app: '#7dd3fc',
    lib: '#c4b5fd',
    tool: '#5eead4',
    package: '#86efac',
    patch: '#fca5a5',
    domain: '#f87171',
    context: '#a3e635',
    'feature-group': '#fcd34d',
    controller: '#67e8f9',
    gateway: '#22d3ee',
    job: '#f97316',
    service: '#a78bfa',
    repository: '#818cf8',
    entity: '#c084fc',
    dto: '#ddd6fe',
    guard: '#fb7185',
    module: '#94a3b8',
    state: '#e879f9',
    provider: '#fbbf24',
    email: '#f9a8d4',
    'webhook-event': '#fdba74',
    doc: '#f472b6',
    readme: '#d946ef',
    openapi: '#2dd4bf',
    asyncapi: '#38bdf8',
    diagram: '#fb923c',
    endpoint: '#34d399',
    concept: '#fde68a'
  };
  var RADIUS = {
    app: 7.5,
    lib: 6.5,
    tool: 6.5,
    package: 4,
    patch: 4,
    domain: 10,
    context: 8,
    'feature-group': 7.5,
    controller: 5,
    gateway: 5,
    job: 4.5,
    service: 4.5,
    repository: 4.5,
    entity: 4.5,
    dto: 4,
    guard: 4.5,
    module: 4.5,
    state: 5.5,
    provider: 5,
    email: 4.5,
    'webhook-event': 4.5,
    doc: 4.5,
    readme: 4.5,
    openapi: 5.5,
    asyncapi: 5.5,
    diagram: 5,
    endpoint: 5,
    concept: 4
  };

  var graph = { nodes: [], edges: [] };
  var selectedId = null;
  var simNodes = [];
  var simLinks = [];
  var nodeById = new Map();
  var adj = new Map();

  var canvas = document.getElementById('graphCanvas');
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentElement;
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var transform = { x: 0, y: 0, k: 1 };
  var draggingNode = null;
  var panning = false;
  var lastPointer = { x: 0, y: 0 };
  var animId = 0;
  var layoutCache = new Map();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function enabledTypes() {
    var set = new Set();
    document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
      if (el.checked) set.add(el.getAttribute('data-type'));
    });
    return set;
  }

  function buildAdjacency() {
    adj = new Map();
    (graph.nodes || []).forEach(function (n) { adj.set(n.id, new Set()); });
    (graph.edges || []).forEach(function (e) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from);
    });
  }

  function neighborhood(seedIds, hops) {
    var keep = new Set(seedIds);
    var frontier = Array.from(seedIds);
    for (var h = 0; h < hops; h++) {
      var next = [];
      frontier.forEach(function (id) {
        var neighbors = adj.get(id);
        if (!neighbors) return;
        neighbors.forEach(function (nid) {
          if (!keep.has(nid)) {
            keep.add(nid);
            next.push(nid);
          }
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }
    return keep;
  }

  function hopsValue() {
    var hops = Number(document.getElementById('hops').value);
    if (!Number.isFinite(hops) || hops < 1) return 2;
    return Math.min(4, Math.floor(hops));
  }

  /**
   * Nothing selected → entire graph (enabled types).
   * Selection → only the selected node's local-hops neighborhood.
   */
  function visibleNodeIds() {
    var types = enabledTypes();
    var base = (graph.nodes || []).filter(function (n) { return types.has(n.type); });
    if (!selectedId) {
      return new Set(base.map(function (n) { return n.id; }));
    }
    var local = neighborhood(new Set([selectedId]), hopsValue());
    var out = new Set();
    base.forEach(function (n) {
      if (local.has(n.id)) out.add(n.id);
    });
    // Always keep the selection even if its type was unchecked
    if (local.has(selectedId)) out.add(selectedId);
    return out;
  }

  function rebuildSimulation(opts) {
    opts = opts || {};
    var keep = visibleNodeIds();
    var w = wrap.clientWidth || 800;
    var h = wrap.clientHeight || 600;

    simNodes = [];
    nodeById = new Map();
    (graph.nodes || []).forEach(function (n) {
      if (!keep.has(n.id)) return;
      var cached = layoutCache.get(n.id);
      var sn = {
        id: n.id,
        type: n.type,
        attrs: n.attrs,
        x: cached ? cached.x : (Math.random() - 0.5) * w * 0.6,
        y: cached ? cached.y : (Math.random() - 0.5) * h * 0.6,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null
      };
      simNodes.push(sn);
      nodeById.set(n.id, sn);
    });

    simLinks = [];
    (graph.edges || []).forEach(function (e) {
      if (!nodeById.has(e.from) || !nodeById.has(e.to)) return;
      simLinks.push({
        source: nodeById.get(e.from),
        target: nodeById.get(e.to),
        type: e.type
      });
    });

    if (simLinks.length > 8000) {
      simLinks = simLinks.slice(0, 8000);
    }

    // Always compute a community/star layout for the current visible set
    layoutCommunitiesAsStars();
    simNodes.forEach(function (n) {
      layoutCache.set(n.id, { x: n.x, y: n.y });
    });

    renderList();
    applyViewForSelection();
    requestDraw();
  }

  /** Full graph fitted, or selected node centered with local hops fitted around it. */
  function applyViewForSelection() {
    if (selectedId && nodeById.has(selectedId)) {
      fitAroundNode(selectedId);
    } else {
      fitToView();
    }
  }

  function fitToView() {
    if (!simNodes.length) {
      transform.x = (wrap.clientWidth || 800) / 2;
      transform.y = (wrap.clientHeight || 600) / 2;
      transform.k = 1;
      return;
    }
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < simNodes.length; i++) {
      var n = simNodes[i];
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    var pad = 56;
    var w = Math.max(1, wrap.clientWidth - pad * 2);
    var h = Math.max(1, wrap.clientHeight - pad * 2);
    var bw = Math.max(40, maxX - minX);
    var bh = Math.max(40, maxY - minY);
    var k = Math.min(w / bw, h / bh) * 0.92;
    if (!Number.isFinite(k) || k <= 0) k = 1;
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    transform.k = k;
    transform.x = (wrap.clientWidth || w) / 2 - cx * k;
    transform.y = (wrap.clientHeight || h) / 2 - cy * k;
  }

  function fitAroundNode(centerId) {
    var center = nodeById.get(centerId);
    if (!center) {
      fitToView();
      return;
    }
    var maxDist = 40;
    for (var i = 0; i < simNodes.length; i++) {
      var n = simNodes[i];
      var dx = n.x - center.x;
      var dy = n.y - center.y;
      var dist = Math.sqrt(dx * dx + dy * dy) + (RADIUS[n.type] || 4);
      if (dist > maxDist) maxDist = dist;
    }
    var pad = 56;
    var w = Math.max(1, wrap.clientWidth - pad * 2);
    var h = Math.max(1, wrap.clientHeight - pad * 2);
    var k = Math.min(w / (2 * maxDist), h / (2 * maxDist)) * 0.9;
    if (!Number.isFinite(k) || k <= 0) k = 1;
    transform.k = k;
    transform.x = (wrap.clientWidth || w) / 2 - center.x * k;
    transform.y = (wrap.clientHeight || h) / 2 - center.y * k;
  }

  function undirectedNeighbors() {
    var map = new Map();
    simNodes.forEach(function (n) { map.set(n.id, []); });
    simLinks.forEach(function (link) {
      map.get(link.source.id).push(link.target.id);
      map.get(link.target.id).push(link.source.id);
    });
    return map;
  }

  function placeOnRings(hub, members, cx, cy) {
    hub.x = cx;
    hub.y = cy;
    hub.vx = 0;
    hub.vy = 0;

    var byType = {
      app: [],
      lib: [],
      tool: [],
      package: [],
      patch: [],
      domain: [],
      context: [],
      'feature-group': [],
      controller: [],
      gateway: [],
      job: [],
      service: [],
      repository: [],
      entity: [],
      dto: [],
      guard: [],
      module: [],
      state: [],
      provider: [],
      email: [],
      'webhook-event': [],
      doc: [],
      readme: [],
      openapi: [],
      asyncapi: [],
      diagram: [],
      endpoint: [],
      concept: [],
      other: []
    };
    members.forEach(function (n) {
      if (n.id === hub.id) return;
      if (byType[n.type]) byType[n.type].push(n);
      else byType.other.push(n);
    });

    var sourceRing = byType.controller
      .concat(byType.gateway)
      .concat(byType.job)
      .concat(byType.service)
      .concat(byType.repository)
      .concat(byType.entity)
      .concat(byType.dto)
      .concat(byType.guard)
      .concat(byType.module)
      .concat(byType.provider);
    var rings = [
      { nodes: byType.state, radius: 75 },
      { nodes: sourceRing, radius: 105 },
      { nodes: byType.email, radius: 125 },
      { nodes: byType['webhook-event'], radius: 145 },
      { nodes: byType.diagram, radius: 165 },
      { nodes: byType.openapi.concat(byType.asyncapi), radius: 185 },
      { nodes: byType.endpoint, radius: 215 },
      { nodes: byType.doc.concat(byType.readme), radius: 250 },
      { nodes: byType.lib, radius: 285 },
      { nodes: byType.tool, radius: 300 },
      { nodes: byType.package, radius: 320 },
      { nodes: byType.patch, radius: 335 },
      { nodes: byType.app, radius: 350 },
      { nodes: byType.context.concat(byType['feature-group']), radius: 380 },
      { nodes: byType.domain, radius: 410 },
      { nodes: byType.concept, radius: 440 },
      { nodes: byType.other, radius: 475 }
    ];

    rings.forEach(function (ring) {
      var nodes = ring.nodes;
      if (!nodes.length) return;
      // Multiple concentric rings if crowded
      var perRing = Math.max(8, Math.ceil(Math.sqrt(nodes.length) * 3));
      var ringIndex = 0;
      for (var start = 0; start < nodes.length; start += perRing) {
        var slice = nodes.slice(start, start + perRing);
        var r = ring.radius + ringIndex * 55;
        for (var i = 0; i < slice.length; i++) {
          var angle = (-Math.PI / 2) + (2 * Math.PI * i) / slice.length;
          slice[i].x = cx + Math.cos(angle) * r;
          slice[i].y = cy + Math.sin(angle) * r;
          slice[i].vx = 0;
          slice[i].vy = 0;
        }
        ringIndex++;
      }
    });
  }

  /**
   * Layout as community stars: hubs (projects / high-degree) on a circle,
   * members in type rings around each hub. Selection focus = one star.
   */
  function layoutCommunitiesAsStars() {
    if (!simNodes.length) return;

    // Focused local view: one star around the selection
    if (selectedId && nodeById.has(selectedId)) {
      placeOnRings(nodeById.get(selectedId), simNodes, 0, 0);
      return;
    }

    var neighbors = undirectedNeighbors();
    var degree = new Map();
    simNodes.forEach(function (n) {
      degree.set(n.id, (neighbors.get(n.id) || []).length);
    });

    // Hubs: prefer domain nodes for domain maps; else apps/libs
    var hubs = [];
    var hubSet = new Set();
    simNodes.forEach(function (n) {
      if (n.type === 'domain') {
        hubs.push(n);
        hubSet.add(n.id);
      }
    });
    if (!hubs.length) {
      simNodes.forEach(function (n) {
        if (n.type === 'app' || n.type === 'lib' || n.type === 'tool') {
          hubs.push(n);
          hubSet.add(n.id);
        }
      });
    }
    hubs.sort(function (a, b) {
      return String(a.id).localeCompare(String(b.id));
    });

    // Assign members to nearest hub (BFS). Prefer belongs_to → domain, then file.projectName.
    var community = new Map(); // hubId -> nodes[]
    hubs.forEach(function (h) { community.set(h.id, [h]); });

    var assigned = new Set(hubSet);

    // Direct belongs_to from projects/docs/concepts to domain hubs
    simLinks.forEach(function (link) {
      if (link.type !== 'belongs_to') return;
      var from = link.source;
      var to = link.target;
      if (hubSet.has(to.id) && !assigned.has(from.id)) {
        community.get(to.id).push(from);
        assigned.add(from.id);
      }
    });

    simNodes.forEach(function (n) {
      if (assigned.has(n.id)) return;
      var attrs = n.attrs || {};
      if (attrs.domain && hubSet.has('domain:' + attrs.domain)) {
        var did = 'domain:' + attrs.domain;
        community.get(did).push(n);
        assigned.add(n.id);
        return;
      }
      if (attrs.projectName && hubSet.has('project:' + attrs.projectName)) {
        var pid = 'project:' + attrs.projectName;
        if (community.has(pid)) {
          community.get(pid).push(n);
          assigned.add(n.id);
        }
      }
    });

    // BFS ownership for remaining nodes
    var owner = new Map();
    hubs.forEach(function (h) { owner.set(h.id, h.id); });
    var queue = hubs.map(function (h) { return h.id; });
    while (queue.length) {
      var id = queue.shift();
      var own = owner.get(id);
      (neighbors.get(id) || []).forEach(function (nid) {
        if (owner.has(nid)) return;
        owner.set(nid, own);
        queue.push(nid);
      });
    }

    simNodes.forEach(function (n) {
      if (assigned.has(n.id)) return;
      var own = owner.get(n.id);
      if (own && community.has(own)) {
        community.get(own).push(n);
        assigned.add(n.id);
      }
    });

    // Orphan high-degree nodes become their own hubs
    var orphans = simNodes.filter(function (n) { return !assigned.has(n.id); });
    orphans.sort(function (a, b) { return (degree.get(b.id) || 0) - (degree.get(a.id) || 0); });
    orphans.forEach(function (n, idx) {
      if (assigned.has(n.id)) return;
      if ((degree.get(n.id) || 0) >= 2 || n.type === 'concept' || idx < 12) {
        hubs.push(n);
        hubSet.add(n.id);
        community.set(n.id, [n]);
        assigned.add(n.id);
      }
    });

    // Attach any still-unassigned to nearest existing hub by one-hop, else first hub
    simNodes.forEach(function (n) {
      if (assigned.has(n.id)) return;
      var attached = false;
      (neighbors.get(n.id) || []).forEach(function (nid) {
        if (attached) return;
        var own = owner.get(nid) || (hubSet.has(nid) ? nid : null);
        if (own && community.has(own)) {
          community.get(own).push(n);
          assigned.add(n.id);
          attached = true;
        }
      });
      if (!attached && hubs.length) {
        community.get(hubs[0].id).push(n);
        assigned.add(n.id);
      }
    });

    // Place hubs on a circle (larger radius for more communities)
    var hubCount = hubs.length || 1;
    var communitySpacing = 420;
    var orbit = Math.max(280, (hubCount * communitySpacing) / (2 * Math.PI));

    hubs.forEach(function (hub, i) {
      var angle = (-Math.PI / 2) + (2 * Math.PI * i) / hubCount;
      var cx = Math.cos(angle) * orbit;
      var cy = Math.sin(angle) * orbit;
      var members = community.get(hub.id) || [hub];
      placeOnRings(hub, members, cx, cy);
    });
  }

  function resize() {
    var w = wrap.clientWidth;
    var h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - transform.x) / transform.k,
      y: (sy - transform.y) / transform.k
    };
  }

  function screenRadius(node, extra) {
    var base = (RADIUS[node.type] || 4) + (extra || 0);
    // Keep nodes readable when zoomed out, but cap so they don't become giant hit/draw blobs
    var minWorld = 2.5 / Math.max(transform.k, 0.0001);
    var maxWorld = 10 / Math.max(transform.k, 0.0001);
    return Math.min(maxWorld, Math.max(base, minWorld));
  }

  function findNodeAt(sx, sy) {
    // Hit-test in screen pixels — never use inflated world radii (those cover the whole canvas when zoomed out)
    var hit = null;
    var best = Infinity;
    for (var i = 0; i < simNodes.length; i++) {
      var n = simNodes[i];
      var px = n.x * transform.k + transform.x;
      var py = n.y * transform.k + transform.y;
      var dx = px - sx;
      var dy = py - sy;
      var d2 = dx * dx + dy * dy;
      var rPx = Math.min(14, Math.max(8, screenRadius(n) * transform.k));
      if (d2 <= rPx * rPx && d2 < best) {
        best = d2;
        hit = n;
      }
    }
    return hit;
  }

  function draw() {
    var w = wrap.clientWidth;
    var h = wrap.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Edges
    for (var i = 0; i < simLinks.length; i++) {
      var link = simLinks[i];
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      var opacity = link.type === 'depends_on' ? 0.35 : 0.18;
      ctx.strokeStyle = 'rgba(139, 155, 180,' + opacity + ')';
      ctx.lineWidth = Math.max(
        (link.type === 'depends_on' ? 1.2 : 0.7) / transform.k,
        1 / transform.k
      );
      ctx.stroke();
    }

    var showLabels = document.getElementById('showLabels').checked;
    var q = document.getElementById('search').value.trim().toLowerCase();

    // Nodes (screen-space minimum size so fit-to-view stays readable)
    for (var j = 0; j < simNodes.length; j++) {
      var node = simNodes[j];
      var isSel = node.id === selectedId;
      var isMatch = q && node.id.toLowerCase().indexOf(q) !== -1;
      var r = screenRadius(node, (isSel ? 2 : 0) + (isMatch ? 1 : 0));

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[node.type] || '#fff';
      ctx.fill();
      if (isSel || isMatch) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5 / transform.k, 1 / transform.k);
        ctx.stroke();
      }

      if (showLabels && (isSel || transform.k > 0.35 || simNodes.length < 80)) {
        var label = node.id;
        if (label.length > 36) label = label.slice(0, 34) + '…';
        ctx.font = Math.max(11 / transform.k, 10 / transform.k) + 'px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(231,236,243,0.9)';
        ctx.fillText(label, node.x + r + 4 / transform.k, node.y + 3 / transform.k);
      }
    }

    ctx.restore();
  }

  function requestDraw() {
    if (animId) return;
    animId = requestAnimationFrame(function () {
      animId = 0;
      draw();
    });
  }

  function filteredListNodes() {
    var types = enabledTypes();
    var q = document.getElementById('search').value.trim().toLowerCase();
    return (graph.nodes || []).filter(function (n) {
      if (!types.has(n.type)) return false;
      if (q && String(n.id).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).slice(0, 200);
  }

  function renderList() {
    var ul = document.getElementById('nodeList');
    var nodes = filteredListNodes();
    if (!nodes.length) {
      ul.innerHTML = '<li class="empty">No matching nodes.</li>';
      return;
    }
    ul.innerHTML = nodes.map(function (n) {
      var active = n.id === selectedId ? ' active' : '';
      return '<li class="' + active + '" data-id="' + encodeURIComponent(n.id) + '">' +
        '<span class="type-tag ' + n.type + '">' + n.type + '</span>' +
        escapeHtml(n.id) + '</li>';
    }).join('');
  }

  function setDetailSelectionState(hasSelection) {
    var panel = document.getElementById('detailPanel');
    var detail = document.getElementById('detail');
    if (hasSelection) {
      panel.classList.add('has-selection');
      detail.classList.remove('empty');
    } else {
      panel.classList.remove('has-selection');
      detail.classList.add('empty');
    }
  }

  function clearSelection() {
    selectedId = null;
    setDetailSelectionState(false);
    document.getElementById('detail').innerHTML =
      '<p class="empty">Select a node to focus local hops. Click empty canvas to show the full graph.</p>';
    rebuildSimulation();
  }

  function nodeInfoParts(node) {
    var attrs = node.attrs || {};
    var rows = [];
    var tags = [];
    if (node.type === 'app' || node.type === 'lib' || node.type === 'tool') {
      if (attrs.root) rows.push(['root', attrs.root]);
      if (attrs.type) rows.push(['kind', attrs.type]);
      if (attrs.domain) rows.push(['domain', attrs.domain]);
      if (attrs.context) rows.push(['context', attrs.context]);
      if (attrs.featureGroup) rows.push(['feature group', attrs.featureGroup]);
      if (Array.isArray(attrs.tags)) tags = attrs.tags.slice();
      if (Array.isArray(attrs.targets) && attrs.targets.length) {
        rows.push(['targets', attrs.targets.slice(0, 8).join(', ')]);
      }
    } else if (node.type === 'package') {
      if (attrs.name) rows.push(['name', attrs.name]);
      if (attrs.version) rows.push(['version', attrs.version]);
    } else if (node.type === 'patch') {
      if (attrs.path) rows.push(['path', attrs.path]);
      if (attrs.packageName) rows.push(['package', attrs.packageName]);
      if (attrs.packageVersion) rows.push(['patched version', attrs.packageVersion]);
    } else if (node.type === 'domain' || node.type === 'context' || node.type === 'feature-group') {
      if (attrs.name) rows.push(['name', attrs.name]);
      if (attrs.label) rows.push(['label', attrs.label]);
      if (attrs.kind) rows.push(['kind', attrs.kind]);
      if (attrs.source) rows.push(['source', attrs.source]);
    } else if (
      node.type === 'controller' ||
      node.type === 'gateway' ||
      node.type === 'job' ||
      node.type === 'service' ||
      node.type === 'repository' ||
      node.type === 'entity' ||
      node.type === 'dto' ||
      node.type === 'guard' ||
      node.type === 'module' ||
      node.type === 'state' ||
      node.type === 'provider' ||
      node.type === 'email' ||
      node.type === 'doc' ||
      node.type === 'readme' ||
      node.type === 'openapi' ||
      node.type === 'asyncapi' ||
      node.type === 'diagram'
    ) {
      if (attrs.path) rows.push(['path', attrs.path]);
      if (attrs.languageOrKind) rows.push(['kind', attrs.languageOrKind]);
      if (attrs.projectName) rows.push(['project', attrs.projectName]);
      if (attrs.sliceName) rows.push(['slice', attrs.sliceName]);
      if (attrs.templateName) rows.push(['template', attrs.templateName]);
      if (Array.isArray(attrs.memberFiles) && attrs.memberFiles.length) {
        rows.push(['members', attrs.memberFiles.join(', ')]);
      }
    } else if (node.type === 'webhook-event') {
      if (attrs.eventName) rows.push(['event', attrs.eventName]);
      if (attrs.projectName) rows.push(['project', attrs.projectName]);
      if (attrs.catalogPath) rows.push(['catalog', attrs.catalogPath]);
    } else if (node.type === 'endpoint') {
      if (attrs.specKind) rows.push(['spec', attrs.specKind]);
      if (attrs.method) rows.push(['method', attrs.method]);
      if (attrs.pathOrChannel) rows.push(['path', attrs.pathOrChannel]);
      if (attrs.operationId) rows.push(['operationId', attrs.operationId]);
      if (attrs.summary) rows.push(['summary', attrs.summary]);
    } else if (node.type === 'concept') {
      if (attrs.title) rows.push(['title', attrs.title]);
      if (attrs.domain) rows.push(['domain', attrs.domain]);
      if (attrs.docPath) rows.push(['doc', attrs.docPath]);
      if (attrs.sectionAnchor) rows.push(['anchor', attrs.sectionAnchor]);
    }
    return { rows: rows, tags: tags };
  }

  function renderNodeSummaryHtml(node, includeLinkCount) {
    var parts = nodeInfoParts(node);
    var html = '<div class="detail-card">';
    html += '<div class="detail-type ' + node.type + '">' + escapeHtml(node.type) + '</div>';
    html += '<div class="detail-id">' + escapeHtml(node.id) + '</div>';
    if (parts.tags.length) {
      html += '<div class="detail-tags">';
      parts.tags.forEach(function (tag) {
        html += '<span class="detail-chip">' + escapeHtml(String(tag)) + '</span>';
      });
      html += '</div>';
    }
    var rows = parts.rows.slice();
    if (includeLinkCount) {
      rows.push(['links', String(degreeOf(node.id))]);
    }
    if (rows.length) {
      html += '<dl class="detail-fields">';
      rows.forEach(function (row) {
        html += '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      });
      html += '</dl>';
    }
    html += '</div>';
    return html;
  }

  function selectNode(id, opts) {
    opts = opts || {};
    if (!id) {
      clearSelection();
      return;
    }
    selectedId = id;

    var node = (graph.nodes || []).find(function (n) { return n.id === id; });
    var outbound = (graph.edges || []).filter(function (e) { return e.from === id; });
    var inbound = (graph.edges || []).filter(function (e) { return e.to === id; });
    var detail = document.getElementById('detail');
    setDetailSelectionState(true);
    if (!node) {
      detail.innerHTML = '<p class="empty">Node not found.</p>';
      return;
    }
    var html = renderNodeSummaryHtml(node, true);
    html += '<div class="detail-subhead">Outbound (' + outbound.length + ')</div>';
    html += outbound.length
      ? outbound.slice(0, 80).map(function (e) {
          return '<div class="edge">' + escapeHtml(e.type) + ' → ' +
            '<button type="button" data-nav="' + encodeURIComponent(e.to) + '">' +
            escapeHtml(e.to) + '</button></div>';
        }).join('') + (outbound.length > 80 ? '<p class="empty">…and more</p>' : '')
      : '<p class="empty">None</p>';
    html += '<div class="detail-subhead">Inbound (' + inbound.length + ')</div>';
    html += inbound.length
      ? inbound.slice(0, 80).map(function (e) {
          return '<div class="edge"><button type="button" data-nav="' +
            encodeURIComponent(e.from) + '">' + escapeHtml(e.from) +
            '</button> → ' + escapeHtml(e.type) + '</div>';
        }).join('') + (inbound.length > 80 ? '<p class="empty">…and more</p>' : '')
      : '<p class="empty">None</p>';
    detail.innerHTML = html;

    // Rebuild to local-hops subgraph and fit with selection centered
    if (opts.skipRebuild) {
      renderList();
      applyViewForSelection();
      requestDraw();
    } else {
      rebuildSimulation();
    }
  }

  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  var pointerDownHit = null;
  var pointerMoved = false;
  var downPos = { x: 0, y: 0 };
  var hoverId = null;
  var popoverEl = document.getElementById('nodePopover');

  function degreeOf(id) {
    var n = 0;
    for (var i = 0; i < simLinks.length; i++) {
      var link = simLinks[i];
      if (link.source.id === id || link.target.id === id) n++;
    }
    return n;
  }

  function popoverRows(node) {
    var parts = nodeInfoParts(node);
    var rows = parts.rows.slice();
    if (parts.tags.length) {
      rows.unshift(['tags', parts.tags.slice(0, 8).join(', ')]);
    }
    rows.push(['links', String(degreeOf(node.id))]);
    return rows;
  }

  function hidePopover() {
    hoverId = null;
    popoverEl.classList.remove('visible');
    popoverEl.innerHTML = '';
    canvas.classList.remove('hovering');
  }

  function showPopover(node, sx, sy) {
    hoverId = node.id;
    var rows = popoverRows(node);
    var html = '<div class="pop-type ' + node.type + '">' + escapeHtml(node.type) + '</div>';
    html += '<div class="pop-id">' + escapeHtml(node.id) + '</div>';
    if (rows.length) {
      html += '<dl>';
      rows.forEach(function (row) {
        html += '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      });
      html += '</dl>';
    }
    popoverEl.innerHTML = html;
    popoverEl.classList.add('visible');
    canvas.classList.add('hovering');

    var pad = 12;
    var wrapW = wrap.clientWidth;
    var wrapH = wrap.clientHeight;
    // Measure after content is set
    var pw = popoverEl.offsetWidth || 220;
    var ph = popoverEl.offsetHeight || 80;
    var left = sx + 14;
    var top = sy + 14;
    if (left + pw + pad > wrapW) left = sx - pw - 14;
    if (top + ph + pad > wrapH) top = sy - ph - 14;
    left = Math.max(pad, Math.min(left, wrapW - pw - pad));
    top = Math.max(pad, Math.min(top, wrapH - ph - pad));
    popoverEl.style.left = left + 'px';
    popoverEl.style.top = top + 'px';
  }

  function updateHover(p) {
    if (draggingNode || panning) {
      hidePopover();
      return;
    }
    var hit = findNodeAt(p.x, p.y);
    if (!hit) {
      hidePopover();
      return;
    }
    showPopover(hit, p.x, p.y);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    hidePopover();
    canvas.setPointerCapture(ev.pointerId);
    var p = pointerPos(ev);
    lastPointer = p;
    downPos = p;
    pointerMoved = false;
    pointerDownHit = findNodeAt(p.x, p.y);
    if (pointerDownHit) {
      draggingNode = nodeById.get(pointerDownHit.id) || pointerDownHit;
    } else {
      panning = true;
      canvas.classList.add('dragging');
    }
  });

  canvas.addEventListener('pointermove', function (ev) {
    var p = pointerPos(ev);
    var moved =
      Math.abs(p.x - downPos.x) > 4 || Math.abs(p.y - downPos.y) > 4;
    if (moved) pointerMoved = true;

    if (draggingNode) {
      hidePopover();
      var world = screenToWorld(p.x, p.y);
      draggingNode.x = world.x;
      draggingNode.y = world.y;
      draggingNode.vx = 0;
      draggingNode.vy = 0;
      requestDraw();
    } else if (panning) {
      hidePopover();
      transform.x += p.x - lastPointer.x;
      transform.y += p.y - lastPointer.y;
      lastPointer = p;
      requestDraw();
    } else {
      updateHover(p);
    }
  });

  canvas.addEventListener('pointerleave', function () {
    if (!draggingNode && !panning) hidePopover();
  });

  function endDrag(ev) {
    if (draggingNode) {
      layoutCache.set(draggingNode.id, { x: draggingNode.x, y: draggingNode.y });
    }

    // Click (no drag): select node or clear selection on empty canvas
    if (!pointerMoved) {
      if (pointerDownHit) {
        if (pointerDownHit.id !== selectedId) {
          selectNode(pointerDownHit.id);
        }
      } else if (selectedId) {
        clearSelection();
      }
    }

    draggingNode = null;
    panning = false;
    pointerDownHit = null;
    canvas.classList.remove('dragging');
    requestDraw();
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
  });

  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var p = pointerPos(ev);
    var worldBefore = screenToWorld(p.x, p.y);
    var factor = ev.deltaY < 0 ? 1.15 : 0.75;
    var next = transform.k * factor;
    if (Number.isFinite(next) && next > 0) {
      transform.k = next;
    }
    transform.x = p.x - worldBefore.x * transform.k;
    transform.y = p.y - worldBefore.y * transform.k;
    requestDraw();
  }, { passive: false });

  document.getElementById('nodeList').addEventListener('click', function (ev) {
    var li = ev.target.closest('li[data-id]');
    if (!li) return;
    var id = decodeURIComponent(li.getAttribute('data-id'));
    if (selectedId === id) {
      clearSelection();
    } else {
      selectNode(id);
    }
  });
  document.getElementById('detail').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-nav]');
    if (!btn) return;
    selectNode(decodeURIComponent(btn.getAttribute('data-nav')));
  });

  function onFilterChange() {
    updateTypeFilterSummary();
    rebuildSimulation();
  }

  function updateTypeFilterSummary() {
    var inputs = document.querySelectorAll('#typeToggles input[data-type]');
    var checked = 0;
    inputs.forEach(function (el) { if (el.checked) checked += 1; });
    var summary = document.getElementById('typeFilterSummary');
    if (!summary) return;
    if (checked === 0) summary.textContent = 'none';
    else if (checked === inputs.length) summary.textContent = 'all';
    else summary.textContent = checked + '/' + inputs.length;
  }

  function setTypeFilterOpen(open) {
    var root = document.getElementById('typeFilter');
    var btn = document.getElementById('typeFilterBtn');
    if (!root || !btn) return;
    root.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var search = document.getElementById('typeFilterSearch');
      if (search) {
        search.focus();
        search.select();
      }
    }
  }

  function filterTypeOptions() {
    var q = (document.getElementById('typeFilterSearch').value || '').trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll('#typeToggles label').forEach(function (label) {
      var input = label.querySelector('input[data-type]');
      var type = input ? input.getAttribute('data-type') || '' : '';
      var match = !q || type.toLowerCase().indexOf(q) !== -1;
      label.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    document.getElementById('typeFilterEmpty').classList.toggle('visible', visible === 0);
  }

  document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
    el.addEventListener('change', onFilterChange);
  });
  updateTypeFilterSummary();

  document.getElementById('typeFilterBtn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    var root = document.getElementById('typeFilter');
    setTypeFilterOpen(!root.classList.contains('open'));
  });
  document.getElementById('typeFilterPanel').addEventListener('click', function (ev) {
    ev.stopPropagation();
  });
  document.getElementById('typeFilterSearch').addEventListener('input', filterTypeOptions);
  document.addEventListener('click', function () {
    setTypeFilterOpen(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') setTypeFilterOpen(false);
  });

  document.getElementById('showLabels').addEventListener('change', function () {
    requestDraw();
  });
  document.getElementById('search').addEventListener('input', function () {
    renderList();
    requestDraw();
  });
  document.getElementById('fitBtn').addEventListener('click', function () {
    applyViewForSelection();
    requestDraw();
  });
  document.getElementById('hops').addEventListener('change', function () {
    if (selectedId) rebuildSimulation();
  });

  window.addEventListener('resize', function () {
    resize();
    applyViewForSelection();
    requestDraw();
  });

  async function load() {
    var res = await fetch('./graph.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load graph.json');
    graph = await res.json();
    document.getElementById('meta').textContent =
      'version ' + (graph.version || '?') +
      ' · generated ' + (graph.generatedAt || '?') +
      ' · ' + (graph.nodes || []).length + ' nodes · ' +
      (graph.edges || []).length + ' edges';
    buildAdjacency();
    resize();
    selectedId = null;
    setDetailSelectionState(false);
    document.getElementById('hops').value = '2';
    document.getElementById('detail').innerHTML =
      '<p class="empty">Select a node to focus local hops. Click empty canvas to show the full graph.</p>';
    rebuildSimulation({ forceSettle: true });
  }

  load().catch(function (err) {
    document.getElementById('meta').textContent = String(err);
  });
})();
  </script>
</body>
</html>
`;
