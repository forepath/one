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
      --channel: #6ee7b7;
      --concept: #fde68a;
      --edge-depends_on: #7dd3fc;
      --edge-contains: #94a3b8;
      --edge-implements: #34d399;
      --edge-injects: #a78bfa;
      --edge-provides: #fbbf24;
      --edge-calls: #22d3ee;
      --edge-documents: #f472b6;
      --edge-belongs_to: #f87171;
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
    html, body { height: 100%; margin: 0; overflow: hidden; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      min-width: 0;
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
    input[type="search"], select, input[type="number"], input#hops, .detail-slice-search {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      min-width: 9rem;
      font-size: 0.85rem;
    }
    input[type="number"] { min-width: 4.5rem; width: 4.5rem; }
    input[type="search"]:disabled,
    select:disabled,
    input[type="number"]:disabled:not(#hops),
    input[type="text"]:disabled:not(#hops) {
      opacity: 0.45;
      cursor: default;
      color: var(--muted);
    }
    input#hops {
      min-width: 4.5rem;
      width: 4.5rem;
      text-align: left;
    }
    input#hops:disabled {
      cursor: default;
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
      -webkit-text-fill-color: var(--text);
      opacity: 0.45;
    }
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
    .btn:disabled {
      opacity: 0.45;
      cursor: default;
      border-color: var(--border);
      color: var(--muted);
    }
    .btn:disabled:hover {
      border-color: var(--border);
      color: var(--muted);
    }
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
      min-height: calc(0.85rem + 0.8rem + 2px);
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
    .swatch.channel { background: var(--channel); }
    .swatch.concept { background: var(--concept); }
    .swatch.edge-depends_on { background: var(--edge-depends_on); }
    .swatch.edge-contains { background: var(--edge-contains); }
    .swatch.edge-implements { background: var(--edge-implements); }
    .swatch.edge-injects { background: var(--edge-injects); }
    .swatch.edge-provides { background: var(--edge-provides); }
    .swatch.edge-calls { background: var(--edge-calls); }
    .swatch.edge-documents { background: var(--edge-documents); }
    .swatch.edge-belongs_to { background: var(--edge-belongs_to); }
    .layout {
      flex: 1 1 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 340px);
      min-width: 0;
      min-height: 0;
      width: 100%;
      overflow: hidden;
    }
    .layout.has-selection {
      grid-template-columns: minmax(0, 1fr) minmax(240px, 340px) minmax(240px, 340px);
    }
    @media (max-width: 1100px) {
      .layout.has-selection {
        grid-template-columns: minmax(0, 1fr) minmax(220px, 300px) minmax(220px, 300px);
      }
    }
    @media (max-width: 900px) {
      .layout,
      .layout.has-selection {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: 55vh minmax(0, 1fr) minmax(0, 1fr);
      }
    }
    .canvas-wrap {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(ellipse at center, rgba(110, 168, 254, 0.06), transparent 55%),
        var(--bg);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
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
    .popover .pop-type.channel { color: var(--channel); }
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
    aside.side-panel {
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      background: var(--panel);
      padding: 0.9rem 1rem 1rem;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--border);
    }
    aside.side-panel > h2,
    .detail-slice > h2,
    .detail-slice-head {
      margin: 0 0 0.55rem;
      font-size: 0.8rem;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    .detail-slice-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-width: 0;
    }
    .detail-slice-head > span:first-child {
      flex: 0 0 auto;
    }
    .detail-slice-head .detail-type {
      margin: 0;
      flex: 0 0 auto;
      text-align: right;
    }
    .detail-slice-head .detail-type:empty {
      display: none;
    }
    .side-panel-body {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
    }
    .side-detail {
      gap: 0.75rem;
    }
    .side-detail[hidden] {
      display: none !important;
    }
    .detail-slice {
      flex: 1 1 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .detail-slice-search {
      flex: 0 0 auto;
      width: 100%;
      min-width: 0;
      margin: 0;
      box-sizing: border-box;
      padding: 0.28rem 0.4rem;
      font-size: 0.78rem;
    }
    .relation-filters {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      flex: 0 0 auto;
      margin: 0 0 0.45rem;
      min-width: 0;
    }
    .relation-filter-actions {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      min-width: 0;
    }
    .relation-type-filter {
      position: relative;
      align-self: stretch;
      flex: 1 1 0;
      min-width: 0;
    }
    .relation-filter-btn {
      width: 100%;
      min-width: 0;
      padding: 0.28rem 0.4rem;
      font-size: 0.72rem;
      align-self: stretch;
      gap: 0.25rem;
      justify-content: space-between;
    }
    .relation-filter-btn .type-filter-summary {
      font-size: 0.68rem;
    }
    .relation-reset-btn {
      padding: 0.28rem 0.45rem;
      font-size: 0.72rem;
      align-self: stretch;
      flex: 1 1 0;
      min-width: 0;
    }
    .relation-type-filter .type-filter-panel {
      left: 0;
      right: auto;
      width: min(18rem, calc(100vw - 2rem));
      max-height: min(16rem, calc(100vh - 6rem));
    }
    .detail-slice + .detail-slice {
      border-top: 1px solid var(--border);
      padding-top: 0.75rem;
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
    .detail-type.channel { color: var(--channel); }
    .detail-type.concept { color: var(--concept); }
    .detail-id {
      flex: 0 0 auto;
      font-size: 0.78rem;
      font-weight: 600;
      word-break: break-word;
      line-height: 1.35;
      margin: 0 0 0.45rem;
    }
    .detail-id:empty {
      display: none;
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
    .edge-list {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .edge-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      width: 100%;
      padding: 0.35rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid transparent;
      background: none;
      color: var(--text);
      text-align: left;
      font-family: inherit;
      font-size: 0.78rem;
      line-height: inherit;
      box-sizing: border-box;
    }
    .edge-row:hover { background: var(--panel-2); }
    .edge-row .row-id,
    ul#nodeList li .row-id {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.78rem;
    }
    ul#nodeList { list-style: none; margin: 0; padding: 0; }
    ul#nodeList li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.78rem;
      border: 1px solid transparent;
    }
    ul#nodeList li:hover { background: var(--panel-2); }
    ul#nodeList li.active { border-color: var(--accent); background: var(--panel-2); }
    .type-tag {
      flex: 0 0 auto;
      font-size: 0.7rem;
      opacity: 0.9;
      white-space: nowrap;
    }
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
    .type-tag.channel { color: var(--channel); }
    .type-tag.concept { color: var(--concept); }
    .type-tag.edge-depends_on { color: var(--edge-depends_on); }
    .type-tag.edge-contains { color: var(--edge-contains); }
    .type-tag.edge-implements { color: var(--edge-implements); }
    .type-tag.edge-injects { color: var(--edge-injects); }
    .type-tag.edge-provides { color: var(--edge-provides); }
    .type-tag.edge-calls { color: var(--edge-calls); }
    .type-tag.edge-documents { color: var(--edge-documents); }
    .type-tag.edge-belongs_to { color: var(--edge-belongs_to); }
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
        <input id="search" type="search" placeholder="Filter nodes…" autocomplete="off" />
      </label>
      <label class="ctrl">Distance
        <input id="hops" type="text" value="All" disabled title="Neighborhood distance when a node is selected" />
      </label>
      <div class="type-filter" id="typeFilter">
        <button type="button" class="btn type-filter-btn" id="typeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="typeFilterPanel">
          <span>Nodes <span class="type-filter-summary" id="typeFilterSummary">all</span></span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="type-filter-panel" id="typeFilterPanel" role="listbox" aria-label="Node types">
          <input id="typeFilterSearch" type="search" placeholder="Search nodes…" autocomplete="off" />
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
            <label><input type="checkbox" data-type="channel" checked /><span class="swatch channel"></span>channel</label>
            <label><input type="checkbox" data-type="concept" checked /><span class="swatch concept"></span>concept</label>
          </div>
          <div class="type-filter-empty" id="typeFilterEmpty">No nodes match.</div>
        </div>
      </div>
      <div class="type-filter" id="edgeFilter">
        <button type="button" class="btn type-filter-btn" id="edgeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="edgeFilterPanel">
          <span>Edges <span class="type-filter-summary" id="edgeFilterSummary">all</span></span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <div class="type-filter-panel" id="edgeFilterPanel" role="listbox" aria-label="Edge types">
          <input id="edgeFilterSearch" type="search" placeholder="Search edges…" autocomplete="off" />
          <div class="type-filter-list" id="edgeToggles">
            <label><input type="checkbox" data-edge="depends_on" checked /><span class="swatch edge-depends_on"></span>depends_on</label>
            <label><input type="checkbox" data-edge="contains" checked /><span class="swatch edge-contains"></span>contains</label>
            <label><input type="checkbox" data-edge="implements" checked /><span class="swatch edge-implements"></span>implements</label>
            <label><input type="checkbox" data-edge="injects" checked /><span class="swatch edge-injects"></span>injects</label>
            <label><input type="checkbox" data-edge="provides" checked /><span class="swatch edge-provides"></span>provides</label>
            <label><input type="checkbox" data-edge="calls" checked /><span class="swatch edge-calls"></span>calls</label>
            <label><input type="checkbox" data-edge="documents" checked /><span class="swatch edge-documents"></span>documents</label>
            <label><input type="checkbox" data-edge="belongs_to" checked /><span class="swatch edge-belongs_to"></span>belongs_to</label>
          </div>
          <div class="type-filter-empty" id="edgeFilterEmpty">No edges match.</div>
        </div>
      </div>
      <div class="toggles">
        <label><input type="checkbox" id="showLabels" />Labels</label>
      </div>
      <button type="button" id="fitBtn" class="btn">Fit</button>
      <button type="button" id="resetBtn" class="btn" disabled>Reset</button>
    </div>
  </header>
  <div class="layout">
    <div class="canvas-wrap">
      <canvas id="graphCanvas" aria-label="Knowledge graph visualization"></canvas>
      <div id="nodePopover" class="popover" role="tooltip"></div>
      <div class="hint">Nothing selected = full graph fitted · select a node = center it and fit local hops · then pan/zoom freely</div>
    </div>
    <aside id="detailPanel" class="side-panel side-detail" hidden aria-hidden="true">
      <section class="detail-slice">
        <h2 class="detail-slice-head">
          <span>Details</span>
          <span id="detailTypeBadge" class="detail-type"></span>
        </h2>
        <div id="detailId" class="detail-id"></div>
        <div id="detailSummary" class="side-panel-body"></div>
      </section>
      <section class="detail-slice">
        <h2 id="outboundHeading">Outbound</h2>
        <div class="relation-filters">
          <input id="outboundSearch" class="detail-slice-search" type="search" placeholder="Filter outbound…" autocomplete="off" />
          <div class="relation-filter-actions">
          <div class="type-filter relation-type-filter" id="outboundNodeFilter">
            <button type="button" class="btn type-filter-btn relation-filter-btn" id="outboundNodeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="outboundNodeFilterPanel">
              <span>Nodes <span class="type-filter-summary" id="outboundNodeSummary">all</span></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="type-filter-panel" id="outboundNodeFilterPanel" role="listbox" aria-label="Outbound node types">
              <input id="outboundNodeFilterSearch" type="search" placeholder="Search nodes…" autocomplete="off" />
              <div class="type-filter-list" id="outboundNodeToggles"></div>
              <div class="type-filter-empty" id="outboundNodeFilterEmpty">No nodes match.</div>
            </div>
          </div>
          <div class="type-filter relation-type-filter" id="outboundEdgeFilter">
            <button type="button" class="btn type-filter-btn relation-filter-btn" id="outboundEdgeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="outboundEdgeFilterPanel">
              <span>Edges <span class="type-filter-summary" id="outboundEdgeSummary">all</span></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="type-filter-panel" id="outboundEdgeFilterPanel" role="listbox" aria-label="Outbound edge types">
              <input id="outboundEdgeFilterSearch" type="search" placeholder="Search edges…" autocomplete="off" />
              <div class="type-filter-list" id="outboundEdgeToggles"></div>
              <div class="type-filter-empty" id="outboundEdgeFilterEmpty">No edges match.</div>
            </div>
          </div>
          <button type="button" id="outboundFilterReset" class="btn relation-reset-btn" disabled>Reset</button>
          </div>
        </div>
        <div id="detailOutbound" class="side-panel-body"></div>
      </section>
      <section class="detail-slice">
        <h2 id="inboundHeading">Inbound</h2>
        <div class="relation-filters">
          <input id="inboundSearch" class="detail-slice-search" type="search" placeholder="Filter inbound…" autocomplete="off" />
          <div class="relation-filter-actions">
          <div class="type-filter relation-type-filter" id="inboundNodeFilter">
            <button type="button" class="btn type-filter-btn relation-filter-btn" id="inboundNodeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="inboundNodeFilterPanel">
              <span>Nodes <span class="type-filter-summary" id="inboundNodeSummary">all</span></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="type-filter-panel" id="inboundNodeFilterPanel" role="listbox" aria-label="Inbound node types">
              <input id="inboundNodeFilterSearch" type="search" placeholder="Search nodes…" autocomplete="off" />
              <div class="type-filter-list" id="inboundNodeToggles"></div>
              <div class="type-filter-empty" id="inboundNodeFilterEmpty">No nodes match.</div>
            </div>
          </div>
          <div class="type-filter relation-type-filter" id="inboundEdgeFilter">
            <button type="button" class="btn type-filter-btn relation-filter-btn" id="inboundEdgeFilterBtn" aria-expanded="false" aria-haspopup="listbox" aria-controls="inboundEdgeFilterPanel">
              <span>Edges <span class="type-filter-summary" id="inboundEdgeSummary">all</span></span>
              <span class="caret" aria-hidden="true">▾</span>
            </button>
            <div class="type-filter-panel" id="inboundEdgeFilterPanel" role="listbox" aria-label="Inbound edge types">
              <input id="inboundEdgeFilterSearch" type="search" placeholder="Search edges…" autocomplete="off" />
              <div class="type-filter-list" id="inboundEdgeToggles"></div>
              <div class="type-filter-empty" id="inboundEdgeFilterEmpty">No edges match.</div>
            </div>
          </div>
          <button type="button" id="inboundFilterReset" class="btn relation-reset-btn" disabled>Reset</button>
          </div>
        </div>
        <div id="detailInbound" class="side-panel-body"></div>
      </section>
    </aside>
    <aside class="side-panel side-matches">
      <h2>Matching nodes</h2>
      <div class="side-panel-body">
        <ul id="nodeList"></ul>
      </div>
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
    'channel': '#6ee7b7',
    concept: '#fde68a'
  };
  var EDGE_COLORS = {
    depends_on: '#7dd3fc',
    contains: '#94a3b8',
    implements: '#34d399',
    injects: '#a78bfa',
    provides: '#fbbf24',
    calls: '#22d3ee',
    documents: '#f472b6',
    belongs_to: '#f87171'
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
    'channel': 5,
    concept: 4
  };

  var graph = { nodes: [], edges: [] };
  var selectedId = null;
  var savedHops = 2;
  var currentOutbound = [];
  var currentInbound = [];
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

  function hexToRgba(hex, alpha) {
    var raw = String(hex || '').replace('#', '');
    if (raw.length === 3) {
      raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
    }
    if (raw.length !== 6) {
      return 'rgba(139, 155, 180,' + alpha + ')';
    }
    var r = parseInt(raw.slice(0, 2), 16);
    var g = parseInt(raw.slice(2, 4), 16);
    var b = parseInt(raw.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function enabledTypes() {
    var set = new Set();
    document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
      if (el.checked) set.add(el.getAttribute('data-type'));
    });
    return set;
  }

  function enabledEdgeTypes() {
    var set = new Set();
    document.querySelectorAll('#edgeToggles input[data-edge]').forEach(function (el) {
      if (el.checked) set.add(el.getAttribute('data-edge'));
    });
    return set;
  }

  function buildAdjacency() {
    var edgeTypes = enabledEdgeTypes();
    adj = new Map();
    (graph.nodes || []).forEach(function (n) { adj.set(n.id, new Set()); });
    (graph.edges || []).forEach(function (e) {
      if (edgeTypes.size > 0 && !edgeTypes.has(e.type)) return;
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
    var raw = document.getElementById('hops').value;
    var hops = Number(raw);
    if (!Number.isFinite(hops) || hops < 1) hops = savedHops;
    hops = Math.min(4, Math.max(1, Math.floor(hops)));
    savedHops = hops;
    return hops;
  }

  function syncHopsInput(hasSelection) {
    var hops = document.getElementById('hops');
    if (!hops) return;
    if (hasSelection) {
      hops.disabled = false;
      hops.type = 'number';
      hops.min = '1';
      hops.max = '4';
      hops.value = String(savedHops);
    } else {
      hops.blur();
      hops.type = 'text';
      hops.removeAttribute('min');
      hops.removeAttribute('max');
      hops.value = 'All';
      hops.disabled = true;
    }
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
    buildAdjacency();
    var keep = visibleNodeIds();
    var w = wrap.clientWidth || 800;
    var h = wrap.clientHeight || 600;
    var edgeTypes = enabledEdgeTypes();

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
      if (edgeTypes.size > 0 && !edgeTypes.has(e.type)) return;
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

    // Seed structured communities, then settle forces synchronously (no animation).
    layoutCommunitiesAsStars();
    runForceLayout({
      iterations: selectedId
        ? 48
        : (simNodes.length > 900 ? 24 : simNodes.length > 400 ? 32 : 40),
      finalize: true,
    });
    prepareLinkDrawOffsets();
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
      'channel': [],
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
      { nodes: byType.state, radius: 120 },
      { nodes: sourceRing, radius: 175 },
      { nodes: byType.email, radius: 210 },
      { nodes: byType['webhook-event'], radius: 245 },
      { nodes: byType.diagram, radius: 280 },
      { nodes: byType.openapi.concat(byType.asyncapi), radius: 320 },
      { nodes: byType.endpoint.concat(byType['channel']), radius: 370 },
      { nodes: byType.doc.concat(byType.readme), radius: 430 },
      { nodes: byType.lib, radius: 490 },
      { nodes: byType.tool, radius: 520 },
      { nodes: byType.package, radius: 555 },
      { nodes: byType.patch, radius: 585 },
      { nodes: byType.app, radius: 620 },
      { nodes: byType.context.concat(byType['feature-group']), radius: 670 },
      { nodes: byType.domain, radius: 720 },
      { nodes: byType.concept, radius: 780 },
      { nodes: byType.other, radius: 840 }
    ];

    rings.forEach(function (ring) {
      var nodes = ring.nodes;
      if (!nodes.length) return;
      // Multiple concentric rings if crowded — keep circumferential spacing comfortable
      var perRing = Math.max(10, Math.ceil(Math.sqrt(nodes.length) * 2.4));
      var ringIndex = 0;
      for (var start = 0; start < nodes.length; start += perRing) {
        var slice = nodes.slice(start, start + perRing);
        var r = ring.radius + ringIndex * 85;
        var angleJitter = (Math.PI * 2) / Math.max(slice.length * 4, 16);
        for (var i = 0; i < slice.length; i++) {
          var angle =
            (-Math.PI / 2) +
            (2 * Math.PI * i) / slice.length +
            (Math.random() - 0.5) * angleJitter;
          var radialJitter = (Math.random() - 0.5) * 28;
          slice[i].x = cx + Math.cos(angle) * (r + radialJitter);
          slice[i].y = cy + Math.sin(angle) * (r + radialJitter);
          slice[i].vx = 0;
          slice[i].vy = 0;
        }
        ringIndex++;
      }
    });
  }

  /**
   * Force-directed settle: linked nodes attract, all nodes repel, with collision.
   * Seeded by community stars so related clusters stay coherent.
   */
  function runForceLayout(opts) {
    opts = opts || {};
    var n = simNodes.length;
    if (n < 2) return;

    var iterations = opts.iterations || 100;
    var finalize = opts.finalize !== false;
    var springs = [];
    var seenPair = new Set();
    for (var li = 0; li < simLinks.length; li++) {
      var link = simLinks[li];
      var aId = link.source.id;
      var bId = link.target.id;
      if (aId === bId) continue;
      var key = aId < bId ? aId + '\0' + bId : bId + '\0' + aId;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      springs.push({ a: link.source, b: link.target });
    }

    var linkDistance = selectedId ? 96 : 120;
    var linkStrength = selectedId ? 0.07 : 0.045;
    var chargeStrength = selectedId ? -320 : -220;
    var collisionPadding = selectedId ? 28 : 22;
    var centerPull = selectedId ? 0.002 : 0.0004;
    var damp = 0.86;
    var useGrid = n > 350;
    var cellSize = Math.max(56, Math.sqrt(Math.abs(chargeStrength)) * 2.8);

    // Full-graph: pin community hubs so clusters stay separated while members settle.
    if (!selectedId) {
      for (var pi = 0; pi < n; pi++) {
        var pn = simNodes[pi];
        if (pn.type === 'domain' || pn.type === 'app' || pn.type === 'lib' || pn.type === 'tool') {
          if (pn.fx == null) {
            pn.fx = pn.x;
            pn.fy = pn.y;
          }
        }
      }
    }

    function applyRepulsionExact(alpha) {
      for (var i = 0; i < n; i++) {
        var ni = simNodes[i];
        for (var j = i + 1; j < n; j++) {
          var nj = simNodes[j];
          var dx = nj.x - ni.x;
          var dy = nj.y - ni.y;
          var dist2 = dx * dx + dy * dy;
          if (dist2 < 0.01) {
            dx = (Math.random() - 0.5) * 0.5;
            dy = (Math.random() - 0.5) * 0.5;
            dist2 = dx * dx + dy * dy;
          }
          var dist = Math.sqrt(dist2);
          var minDist = (RADIUS[ni.type] || 4) + (RADIUS[nj.type] || 4) + collisionPadding;
          var force = (chargeStrength * alpha) / dist2;
          if (dist < minDist) {
            force -= ((minDist - dist) / minDist) * 2.4 * alpha;
          }
          var fx = (dx / dist) * force;
          var fy = (dy / dist) * force;
          ni.vx += fx;
          ni.vy += fy;
          nj.vx -= fx;
          nj.vy -= fy;
        }
      }
    }

    function applyRepulsionGrid(alpha) {
      var cells = new Map();
      for (var i = 0; i < n; i++) {
        var node = simNodes[i];
        var cx = Math.floor(node.x / cellSize);
        var cy = Math.floor(node.y / cellSize);
        var ckey = cx + ':' + cy;
        var bucket = cells.get(ckey);
        if (!bucket) {
          bucket = [];
          cells.set(ckey, bucket);
        }
        bucket.push(node);
      }

      cells.forEach(function (bucket, ckey) {
        var parts = ckey.split(':');
        var bx = Number(parts[0]);
        var by = Number(parts[1]);
        for (var ox = -1; ox <= 1; ox++) {
          for (var oy = -1; oy <= 1; oy++) {
            var other = cells.get((bx + ox) + ':' + (by + oy));
            if (!other) continue;
            for (var i = 0; i < bucket.length; i++) {
              var ni = bucket[i];
              for (var j = 0; j < other.length; j++) {
                var nj = other[j];
                if (ni.id >= nj.id) continue;
                var dx = nj.x - ni.x;
                var dy = nj.y - ni.y;
                var dist2 = dx * dx + dy * dy;
                if (dist2 < 0.01) {
                  dx = (Math.random() - 0.5) * 0.5;
                  dy = (Math.random() - 0.5) * 0.5;
                  dist2 = dx * dx + dy * dy;
                }
                if (dist2 > cellSize * cellSize * 4.5) continue;
                var dist = Math.sqrt(dist2);
                var minDist = (RADIUS[ni.type] || 4) + (RADIUS[nj.type] || 4) + collisionPadding;
                var force = (chargeStrength * alpha) / dist2;
                if (dist < minDist) {
                  force -= ((minDist - dist) / minDist) * 2.4 * alpha;
                }
                var fx = (dx / dist) * force;
                var fy = (dy / dist) * force;
                ni.vx += fx;
                ni.vy += fy;
                nj.vx -= fx;
                nj.vy -= fy;
              }
            }
          }
        }
      });
    }

    for (var iter = 0; iter < iterations; iter++) {
      var alpha = 1 - iter / iterations;
      alpha = 0.12 + alpha * alpha * 0.88;

      for (var zi = 0; zi < n; zi++) {
        simNodes[zi].vx = 0;
        simNodes[zi].vy = 0;
      }

      if (useGrid) applyRepulsionGrid(alpha);
      else applyRepulsionExact(alpha);

      for (var s = 0; s < springs.length; s++) {
        var spring = springs[s];
        var sa = spring.a;
        var sb = spring.b;
        var sdx = sb.x - sa.x;
        var sdy = sb.y - sa.y;
        var sdist = Math.sqrt(sdx * sdx + sdy * sdy) || 0.01;
        var displace = (sdist - linkDistance) * linkStrength * alpha;
        var sfx = (sdx / sdist) * displace;
        var sfy = (sdy / sdist) * displace;
        sa.vx += sfx;
        sa.vy += sfy;
        sb.vx -= sfx;
        sb.vy -= sfy;
      }

      for (var k = 0; k < n; k++) {
        var node = simNodes[k];
        if (node.fx != null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        // Mild pull toward origin keeps the layout bounded without collapsing clusters
        node.vx -= node.x * centerPull * alpha;
        node.vy -= node.y * centerPull * alpha;
        node.vx *= damp;
        node.vy *= damp;
        var speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        var maxStep = selectedId ? 22 : 16;
        if (speed > maxStep) {
          node.vx = (node.vx / speed) * maxStep;
          node.vy = (node.vy / speed) * maxStep;
        }
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    for (var ci = 0; ci < n; ci++) {
      simNodes[ci].vx = 0;
      simNodes[ci].vy = 0;
      if (finalize) {
        simNodes[ci].fx = null;
        simNodes[ci].fy = null;
      }
    }
  }

  /**
   * Assign perpendicular draw offsets so multiple edges between the same node pair
   * do not render as a single overlaid stroke.
   */
  function prepareLinkDrawOffsets() {
    var groups = new Map();
    for (var i = 0; i < simLinks.length; i++) {
      var link = simLinks[i];
      var a = link.source.id;
      var b = link.target.id;
      var key = a < b ? a + '\0' + b : b + '\0' + a;
      var list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(link);
    }
    groups.forEach(function (list) {
      var count = list.length;
      for (var i = 0; i < count; i++) {
        list[i].drawOffset = count === 1 ? 0 : (i - (count - 1) / 2) * 10;
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
    var communitySpacing = 780;
    var orbit = Math.max(520, (hubCount * communitySpacing) / (2 * Math.PI));

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
    canvas.style.width = '100%';
    canvas.style.height = '100%';
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

    // Edges (offset multi-edges between the same pair so strokes do not 1:1 overlay)
    for (var i = 0; i < simLinks.length; i++) {
      var link = simLinks[i];
      var x1 = link.source.x;
      var y1 = link.source.y;
      var x2 = link.target.x;
      var y2 = link.target.y;
      var offset = link.drawOffset || 0;
      if (offset) {
        var edx = x2 - x1;
        var edy = y2 - y1;
        var elen = Math.sqrt(edx * edx + edy * edy) || 1;
        var px = (-edy / elen) * offset;
        var py = (edx / elen) * offset;
        x1 += px;
        y1 += py;
        x2 += px;
        y2 += py;
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      var edgeColor = EDGE_COLORS[link.type] || '#8b9bb4';
      var opacity = link.type === 'depends_on' ? 0.55 : 0.32;
      ctx.strokeStyle = hexToRgba(edgeColor, opacity);
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
      return '<li class="' + active + '" data-id="' + encodeURIComponent(n.id) + '" title="' + escapeHtml(n.id) + '">' +
        '<span class="type-tag ' + escapeHtml(n.type) + '">' + escapeHtml(n.type) + '</span>' +
        '<span class="row-id">' + escapeHtml(n.id) + '</span></li>';
    }).join('');
  }

  function relatedNodeType(nodeId) {
    var sim = nodeById.get(nodeId);
    if (sim && sim.type) return sim.type;
    var nodes = graph.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === nodeId) return nodes[i].type || null;
    }
    return null;
  }

  function renderRelationRowHtml(edgeType, relatedId) {
    var relatedType = relatedNodeType(relatedId);
    var html = '<button type="button" class="edge-row" data-nav="' + encodeURIComponent(relatedId) +
      '" title="' + escapeHtml(relatedId) + '">';
    html += '<span class="type-tag edge-' + escapeHtml(edgeType) + '">' + escapeHtml(edgeType) + '</span>';
    if (relatedType) {
      html += '<span class="type-tag ' + escapeHtml(relatedType) + '">' + escapeHtml(relatedType) + '</span>';
    }
    html += '<span class="row-id">' + escapeHtml(relatedId) + '</span></button>';
    return html;
  }

  function relationTextQuery(side) {
    return ((document.getElementById(side + 'Search') || {}).value || '').trim().toLowerCase();
  }

  function relationMatchesQuery(edge, relatedId, q) {
    if (!q) return true;
    if (String(relatedId).toLowerCase().indexOf(q) !== -1) return true;
    if (String(edge.type || '').toLowerCase().indexOf(q) !== -1) return true;
    var relatedType = relatedNodeType(relatedId);
    if (relatedType && String(relatedType).toLowerCase().indexOf(q) !== -1) return true;
    return false;
  }

  function enabledCheckboxTypes(listId, attr) {
    var inputs = document.querySelectorAll('#' + listId + ' input[' + attr + ']');
    var selected = new Set();
    var total = 0;
    inputs.forEach(function (el) {
      total += 1;
      if (el.checked) selected.add(el.getAttribute(attr));
    });
    return { selected: selected, total: total, checked: selected.size };
  }

  function updateFilterSummary(listId, attr, summaryId) {
    var info = enabledCheckboxTypes(listId, attr);
    var summary = document.getElementById(summaryId);
    if (!summary) return;
    if (info.checked === 0) summary.textContent = 'none';
    else if (info.checked === info.total) summary.textContent = 'all';
    else summary.textContent = info.checked + '/' + info.total;
  }

  function relationPassesFilters(edge, relatedId, side) {
    var q = relationTextQuery(side);
    if (!relationMatchesQuery(edge, relatedId, q)) return false;
    var nodeInfo = enabledCheckboxTypes(side + 'NodeToggles', 'data-type');
    var edgeInfo = enabledCheckboxTypes(side + 'EdgeToggles', 'data-edge');
    if (nodeInfo.total > 0) {
      var relatedType = relatedNodeType(relatedId);
      if (relatedType) {
        if (!nodeInfo.selected.has(relatedType)) return false;
      } else if (nodeInfo.checked !== nodeInfo.total) {
        return false;
      }
    }
    if (edgeInfo.total > 0 && !edgeInfo.selected.has(edge.type)) return false;
    return true;
  }

  function filteredRelations(edges, relatedKey, side) {
    return (edges || []).filter(function (e) {
      return relationPassesFilters(e, e[relatedKey], side);
    });
  }

  function relationFiltersAreDefault(side) {
    var search = document.getElementById(side + 'Search');
    if (search && search.value.trim()) return false;
    var nodeInfo = enabledCheckboxTypes(side + 'NodeToggles', 'data-type');
    var edgeInfo = enabledCheckboxTypes(side + 'EdgeToggles', 'data-edge');
    if (nodeInfo.total && nodeInfo.checked !== nodeInfo.total) return false;
    if (edgeInfo.total && edgeInfo.checked !== edgeInfo.total) return false;
    return true;
  }

  function updateRelationFilterReset(side) {
    var btn = document.getElementById(side + 'FilterReset');
    if (!btn) return;
    btn.disabled = relationFiltersAreDefault(side);
  }

  function renderRelationList(targetId, edges, relatedKey, side, emptyLabel) {
    var target = document.getElementById(targetId);
    var filtered = filteredRelations(edges, relatedKey, side);
    if (!(edges || []).length) {
      target.innerHTML = '<p class="empty">' + emptyLabel + '</p>';
      return;
    }
    if (!filtered.length) {
      target.innerHTML = '<p class="empty">No matching relations.</p>';
      return;
    }
    target.innerHTML = '<div class="edge-list">' + filtered.map(function (e) {
      return renderRelationRowHtml(e.type, e[relatedKey]);
    }).join('') + '</div>';
  }

  function renderOutboundList() {
    renderRelationList('detailOutbound', currentOutbound, 'to', 'outbound', 'None');
  }

  function renderInboundList() {
    renderRelationList('detailInbound', currentInbound, 'from', 'inbound', 'None');
  }

  function updateRelationHeadings() {
    var outTotal = currentOutbound.length;
    var inTotal = currentInbound.length;
    var outVisible = filteredRelations(currentOutbound, 'to', 'outbound').length;
    var inVisible = filteredRelations(currentInbound, 'from', 'inbound').length;
    var outFiltered = !relationFiltersAreDefault('outbound');
    var inFiltered = !relationFiltersAreDefault('inbound');
    document.getElementById('outboundHeading').textContent = !selectedId
      ? 'Outbound'
      : outFiltered
        ? 'Outbound (' + outVisible + '/' + outTotal + ')'
        : 'Outbound (' + outTotal + ')';
    document.getElementById('inboundHeading').textContent = !selectedId
      ? 'Inbound'
      : inFiltered
        ? 'Inbound (' + inVisible + '/' + inTotal + ')'
        : 'Inbound (' + inTotal + ')';
  }

  function refreshRelationSide(side) {
    updateFilterSummary(side + 'NodeToggles', 'data-type', side + 'NodeSummary');
    updateFilterSummary(side + 'EdgeToggles', 'data-edge', side + 'EdgeSummary');
    updateRelationFilterReset(side);
    updateRelationHeadings();
    if (side === 'outbound') renderOutboundList();
    else renderInboundList();
  }

  function resetRelationFilters(side) {
    var search = document.getElementById(side + 'Search');
    if (search) search.value = '';
    document.querySelectorAll('#' + side + 'NodeToggles input[data-type]').forEach(function (el) {
      el.checked = true;
    });
    document.querySelectorAll('#' + side + 'EdgeToggles input[data-edge]').forEach(function (el) {
      el.checked = true;
    });
    var nodeSearch = document.getElementById(side + 'NodeFilterSearch');
    var edgeSearch = document.getElementById(side + 'EdgeFilterSearch');
    if (nodeSearch) nodeSearch.value = '';
    if (edgeSearch) edgeSearch.value = '';
    filterRelationOptions(side, 'Node');
    filterRelationOptions(side, 'Edge');
    setRelationFilterOpen(side, 'Node', false);
    setRelationFilterOpen(side, 'Edge', false);
    refreshRelationSide(side);
  }

  function setRelationFilterOpen(side, kind, open) {
    var root = document.getElementById(side + kind + 'Filter');
    var btn = document.getElementById(side + kind + 'FilterBtn');
    if (!root || !btn) return;
    root.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var otherKind = kind === 'Node' ? 'Edge' : 'Node';
      setRelationFilterOpen(side, otherKind, false);
      var otherSide = side === 'outbound' ? 'inbound' : 'outbound';
      setRelationFilterOpen(otherSide, 'Node', false);
      setRelationFilterOpen(otherSide, 'Edge', false);
      setTypeFilterOpen(false);
      setEdgeFilterOpen(false);
      var search = document.getElementById(side + kind + 'FilterSearch');
      if (search) {
        search.focus();
        search.select();
      }
    }
  }

  function filterRelationOptions(side, kind) {
    var attr = kind === 'Node' ? 'data-type' : 'data-edge';
    var q = ((document.getElementById(side + kind + 'FilterSearch') || {}).value || '').trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll('#' + side + kind + 'Toggles label').forEach(function (label) {
      var input = label.querySelector('input[' + attr + ']');
      var value = input ? input.getAttribute(attr) || '' : '';
      var match = !q || value.toLowerCase().indexOf(q) !== -1;
      label.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    var empty = document.getElementById(side + kind + 'FilterEmpty');
    if (empty) empty.classList.toggle('visible', visible === 0);
  }

  function cloneToggleList(sourceId, targetId) {
    var source = document.getElementById(sourceId);
    var target = document.getElementById(targetId);
    if (!source || !target) return;
    target.innerHTML = source.innerHTML;
  }

  function initRelationFilters() {
    ['outbound', 'inbound'].forEach(function (side) {
      cloneToggleList('typeToggles', side + 'NodeToggles');
      cloneToggleList('edgeToggles', side + 'EdgeToggles');
      document.querySelectorAll('#' + side + 'NodeToggles input[data-type]').forEach(function (el) {
        el.addEventListener('change', function () { refreshRelationSide(side); });
      });
      document.querySelectorAll('#' + side + 'EdgeToggles input[data-edge]').forEach(function (el) {
        el.addEventListener('change', function () { refreshRelationSide(side); });
      });
      document.getElementById(side + 'NodeFilterBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var root = document.getElementById(side + 'NodeFilter');
        setRelationFilterOpen(side, 'Node', !root.classList.contains('open'));
      });
      document.getElementById(side + 'EdgeFilterBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var root = document.getElementById(side + 'EdgeFilter');
        setRelationFilterOpen(side, 'Edge', !root.classList.contains('open'));
      });
      document.getElementById(side + 'NodeFilterPanel').addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
      document.getElementById(side + 'EdgeFilterPanel').addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
      document.getElementById(side + 'NodeFilterSearch').addEventListener('input', function () {
        filterRelationOptions(side, 'Node');
      });
      document.getElementById(side + 'EdgeFilterSearch').addEventListener('input', function () {
        filterRelationOptions(side, 'Edge');
      });
      document.getElementById(side + 'Search').addEventListener('input', function () {
        refreshRelationSide(side);
      });
      document.getElementById(side + 'FilterReset').addEventListener('click', function () {
        resetRelationFilters(side);
      });
      updateFilterSummary(side + 'NodeToggles', 'data-type', side + 'NodeSummary');
      updateFilterSummary(side + 'EdgeToggles', 'data-edge', side + 'EdgeSummary');
      updateRelationFilterReset(side);
    });
  }

  function clearDetailSlices() {
    currentOutbound = [];
    currentInbound = [];
    document.getElementById('detailSummary').innerHTML = '';
    document.getElementById('detailOutbound').innerHTML = '';
    document.getElementById('detailInbound').innerHTML = '';
    resetRelationFilters('outbound');
    resetRelationFilters('inbound');
    var detailId = document.getElementById('detailId');
    if (detailId) detailId.textContent = '';
    var typeBadge = document.getElementById('detailTypeBadge');
    if (typeBadge) {
      typeBadge.className = 'detail-type';
      typeBadge.textContent = '';
    }
  }

  function setDetailTypeBadge(type) {
    var typeBadge = document.getElementById('detailTypeBadge');
    if (!typeBadge) return;
    typeBadge.className = 'detail-type' + (type ? ' ' + type : '');
    typeBadge.textContent = type || '';
  }

  function setDetailSelectionState(hasSelection) {
    var panel = document.getElementById('detailPanel');
    var layout = document.querySelector('.layout');
    if (hasSelection) {
      panel.classList.add('has-selection');
      panel.removeAttribute('hidden');
      panel.setAttribute('aria-hidden', 'false');
    } else {
      panel.classList.remove('has-selection');
      panel.setAttribute('hidden', '');
      panel.setAttribute('aria-hidden', 'true');
      clearDetailSlices();
    }
    if (layout) layout.classList.toggle('has-selection', hasSelection);
    syncHopsInput(hasSelection);
    resize();
    applyViewForSelection();
    requestDraw();
  }

  function clearSelection() {
    selectedId = null;
    setDetailSelectionState(false);
    rebuildSimulation();
    updateResetBtn();
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
    } else if (node.type === 'endpoint' || node.type === 'channel') {
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
    var rows = parts.rows.slice();
    if (parts.tags.length) {
      rows.push(['tags', parts.tags.join(', ')]);
    }
    if (includeLinkCount) {
      rows.push(['links', String(degreeOf(node.id))]);
    }
    if (!rows.length) return '';
    var html = '<div class="detail-card"><dl class="detail-fields">';
    rows.forEach(function (row) {
      html += '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
    });
    html += '</dl></div>';
    return html;
  }

  function fillDetailHeader(node) {
    document.getElementById('detailId').textContent = node.id || '';
  }

  function selectNode(id, opts) {
    opts = opts || {};
    if (!id) {
      clearSelection();
      return;
    }
    selectedId = id;

    var node = (graph.nodes || []).find(function (n) { return n.id === id; });
    var edgeTypes = enabledEdgeTypes();
    var outbound = (graph.edges || []).filter(function (e) {
      return e.from === id && (edgeTypes.size === 0 || edgeTypes.has(e.type));
    });
    var inbound = (graph.edges || []).filter(function (e) {
      return e.to === id && (edgeTypes.size === 0 || edgeTypes.has(e.type));
    });
    setDetailSelectionState(true);
    if (!node) {
      currentOutbound = [];
      currentInbound = [];
      setDetailTypeBadge('');
      document.getElementById('detailId').textContent = '';
      document.getElementById('detailSummary').innerHTML = '<p class="empty">Node not found.</p>';
      resetRelationFilters('outbound');
      resetRelationFilters('inbound');
      document.getElementById('detailOutbound').innerHTML = '';
      document.getElementById('detailInbound').innerHTML = '';
      document.getElementById('outboundHeading').textContent = 'Outbound';
      document.getElementById('inboundHeading').textContent = 'Inbound';
      updateResetBtn();
      return;
    }
    currentOutbound = outbound;
    currentInbound = inbound;
    setDetailTypeBadge(node.type);
    fillDetailHeader(node);
    document.getElementById('detailSummary').innerHTML = renderNodeSummaryHtml(node, true);
    resetRelationFilters('outbound');
    resetRelationFilters('inbound');

    // Rebuild to local-hops subgraph and fit with selection centered
    if (opts.skipRebuild) {
      renderList();
      applyViewForSelection();
      requestDraw();
    } else {
      rebuildSimulation();
    }
    updateResetBtn();
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
  document.getElementById('detailPanel').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-nav]');
    if (!btn) return;
    selectNode(decodeURIComponent(btn.getAttribute('data-nav')));
  });

  function onFilterChange() {
    updateTypeFilterSummary();
    updateEdgeFilterSummary();
    rebuildSimulation();
    if (selectedId) {
      selectNode(selectedId, { skipRebuild: true });
    }
    updateResetBtn();
  }

  function filtersAreDefault() {
    var allTypes = true;
    document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
      if (!el.checked) allTypes = false;
    });
    var allEdges = true;
    document.querySelectorAll('#edgeToggles input[data-edge]').forEach(function (el) {
      if (!el.checked) allEdges = false;
    });
    return allTypes && allEdges;
  }

  function canReset() {
    if (selectedId) return true;
    if (document.getElementById('showLabels').checked) return true;
    if (savedHops !== 2) return true;
    return !filtersAreDefault();
  }

  function updateResetBtn() {
    var btn = document.getElementById('resetBtn');
    if (!btn) return;
    btn.disabled = !canReset();
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

  function updateEdgeFilterSummary() {
    var inputs = document.querySelectorAll('#edgeToggles input[data-edge]');
    var checked = 0;
    inputs.forEach(function (el) { if (el.checked) checked += 1; });
    var summary = document.getElementById('edgeFilterSummary');
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
      setEdgeFilterOpen(false);
      setRelationFilterOpen('outbound', 'Node', false);
      setRelationFilterOpen('outbound', 'Edge', false);
      setRelationFilterOpen('inbound', 'Node', false);
      setRelationFilterOpen('inbound', 'Edge', false);
      var search = document.getElementById('typeFilterSearch');
      if (search) {
        search.focus();
        search.select();
      }
    }
  }

  function setEdgeFilterOpen(open) {
    var root = document.getElementById('edgeFilter');
    var btn = document.getElementById('edgeFilterBtn');
    if (!root || !btn) return;
    root.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setTypeFilterOpen(false);
      setRelationFilterOpen('outbound', 'Node', false);
      setRelationFilterOpen('outbound', 'Edge', false);
      setRelationFilterOpen('inbound', 'Node', false);
      setRelationFilterOpen('inbound', 'Edge', false);
      var search = document.getElementById('edgeFilterSearch');
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

  function filterEdgeOptions() {
    var q = (document.getElementById('edgeFilterSearch').value || '').trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll('#edgeToggles label').forEach(function (label) {
      var input = label.querySelector('input[data-edge]');
      var type = input ? input.getAttribute('data-edge') || '' : '';
      var match = !q || type.toLowerCase().indexOf(q) !== -1;
      label.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    document.getElementById('edgeFilterEmpty').classList.toggle('visible', visible === 0);
  }

  document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
    el.addEventListener('change', onFilterChange);
  });
  document.querySelectorAll('#edgeToggles input[data-edge]').forEach(function (el) {
    el.addEventListener('change', onFilterChange);
  });
  updateTypeFilterSummary();
  updateEdgeFilterSummary();

  document.getElementById('typeFilterBtn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    var root = document.getElementById('typeFilter');
    setTypeFilterOpen(!root.classList.contains('open'));
  });
  document.getElementById('edgeFilterBtn').addEventListener('click', function (ev) {
    ev.stopPropagation();
    var root = document.getElementById('edgeFilter');
    setEdgeFilterOpen(!root.classList.contains('open'));
  });
  document.getElementById('typeFilterPanel').addEventListener('click', function (ev) {
    ev.stopPropagation();
  });
  document.getElementById('edgeFilterPanel').addEventListener('click', function (ev) {
    ev.stopPropagation();
  });
  document.getElementById('typeFilterSearch').addEventListener('input', filterTypeOptions);
  document.getElementById('edgeFilterSearch').addEventListener('input', filterEdgeOptions);
  document.addEventListener('click', function () {
    setTypeFilterOpen(false);
    setEdgeFilterOpen(false);
    setRelationFilterOpen('outbound', 'Node', false);
    setRelationFilterOpen('outbound', 'Edge', false);
    setRelationFilterOpen('inbound', 'Node', false);
    setRelationFilterOpen('inbound', 'Edge', false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      setTypeFilterOpen(false);
      setEdgeFilterOpen(false);
      setRelationFilterOpen('outbound', 'Node', false);
      setRelationFilterOpen('outbound', 'Edge', false);
      setRelationFilterOpen('inbound', 'Node', false);
      setRelationFilterOpen('inbound', 'Edge', false);
    }
  });
  initRelationFilters();

  document.getElementById('showLabels').addEventListener('change', function () {
    updateResetBtn();
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
  document.getElementById('resetBtn').addEventListener('click', function () {
    document.querySelectorAll('#typeToggles input[data-type]').forEach(function (el) {
      el.checked = true;
    });
    document.querySelectorAll('#edgeToggles input[data-edge]').forEach(function (el) {
      el.checked = true;
    });
    document.getElementById('showLabels').checked = false;
    var typeSearch = document.getElementById('typeFilterSearch');
    var edgeSearch = document.getElementById('edgeFilterSearch');
    if (typeSearch) typeSearch.value = '';
    if (edgeSearch) edgeSearch.value = '';
    filterTypeOptions();
    filterEdgeOptions();
    setTypeFilterOpen(false);
    setEdgeFilterOpen(false);
    updateTypeFilterSummary();
    updateEdgeFilterSummary();
    savedHops = 2;
    clearSelection();
  });
  document.getElementById('hops').addEventListener('change', function () {
    if (!selectedId) return;
    hopsValue();
    updateResetBtn();
    rebuildSimulation();
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
    savedHops = 2;
    setDetailSelectionState(false);
    clearDetailSlices();
    updateResetBtn();
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
