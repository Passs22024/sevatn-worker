export function getControlCenterHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEVATN Worker Control Center</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --border-color: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #3b82f6;
      --accent-blue-hover: #2563eb;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #ef4444;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }

    body {
      font-family: var(--font-family);
      background-color: var(--bg-primary);
      color: var(--text-primary);
      display: flex;
      height: 100vh;
      overflow: hidden;
      font-size: 13px;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 230px;
      background-color: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 18px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-badge {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      color: white;
      font-size: 16px;
      box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35);
    }

    .sidebar-title h1 {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--text-primary);
    }

    .sidebar-title p {
      font-size: 10px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .nav-list {
      list-style: none;
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .nav-item {
      padding: 9px 12px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-secondary);
      font-weight: 600;
      font-size: 12.5px;
      transition: all 0.15s ease;
    }

    .nav-item:hover {
      background-color: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .nav-item.active {
      background-color: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .nav-item svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
    }

    .sidebar-footer {
      padding: 12px 14px;
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Main Container */
    .main-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: radial-gradient(circle at 80% 20%, rgba(30, 58, 138, 0.15), transparent 60%);
    }

    /* Top Bar */
    .topbar {
      height: 54px;
      background-color: rgba(30, 41, 59, 0.6);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      flex-shrink: 0;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .pill-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .pill-green {
      background-color: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .pill-amber {
      background-color: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .pill-red {
      background-color: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      text-decoration: none;
    }

    .btn-secondary {
      background-color: var(--bg-tertiary);
      color: var(--text-primary);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .btn-secondary:hover {
      background-color: #475569;
    }

    .btn-primary {
      background-color: var(--accent-blue);
      color: white;
    }

    .btn-primary:hover {
      background-color: var(--accent-blue-hover);
    }

    .btn-success {
      background-color: #059669;
      color: white;
    }

    .btn-success:hover {
      background-color: #10b981;
    }

    .btn-danger {
      background-color: #dc2626;
      color: white;
    }

    .btn-danger:hover {
      background-color: #ef4444;
    }

    /* Content Area */
    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    .tab-pane {
      display: none;
      animation: fadeIn 0.2s ease-in-out;
    }

    .tab-pane.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Cards & Grids */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }

    .card {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .card-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .card-value {
      font-size: 22px;
      font-weight: 800;
      color: var(--text-primary);
      margin-bottom: 4px;
      font-family: var(--font-mono);
    }

    .card-meta {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Terminal Console */
    .terminal-container {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 120px);
      background-color: #0b0f19;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    }

    .terminal-header {
      background-color: #161e2e;
      padding: 8px 12px;
      border-bottom: 1px solid #283548;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
    }

    .terminal-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .terminal-search {
      background-color: #0b0f19;
      border: 1px solid #334155;
      color: #f8fafc;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      width: 180px;
      outline: none;
    }

    .terminal-search:focus {
      border-color: var(--accent-blue);
    }

    .filter-btn-group {
      display: flex;
      background-color: #0b0f19;
      border-radius: 4px;
      padding: 2px;
      border: 1px solid #334155;
    }

    .filter-chip {
      padding: 2px 8px;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-secondary);
      border-radius: 3px;
      cursor: pointer;
    }

    .filter-chip.active {
      background-color: var(--accent-blue);
      color: white;
    }

    .terminal-screen {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      color: #cbd5e1;
      user-select: text;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .log-line {
      display: flex;
      gap: 8px;
      padding: 1.5px 0;
      border-radius: 2px;
    }

    .log-line:hover {
      background-color: rgba(255, 255, 255, 0.03);
    }

    .log-ts {
      color: #64748b;
      flex-shrink: 0;
    }

    .log-tag {
      font-weight: 700;
      flex-shrink: 0;
      padding: 0 4px;
      border-radius: 2px;
    }

    .log-tag-INFO { color: #38bdf8; }
    .log-tag-WARN { color: #fbbf24; }
    .log-tag-ERROR { color: #f87171; background: rgba(239, 68, 68, 0.15); }
    .log-tag-DEBUG { color: #a78bfa; }

    .log-msg {
      flex: 1;
      user-select: text;
    }

    /* Forms */
    .form-group {
      margin-bottom: 16px;
    }

    .form-label {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .form-input {
      width: 100%;
      background-color: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 9px 12px;
      color: var(--text-primary);
      font-size: 12.5px;
      font-family: var(--font-mono);
      outline: none;
      transition: border-color 0.15s;
    }

    .form-input:focus {
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .form-help {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Pairing Big Box */
    .pairing-box {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9));
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      max-width: 600px;
      margin: 0 auto 20px auto;
    }

    .pairing-code-display {
      font-family: var(--font-mono);
      font-size: 36px;
      font-weight: 900;
      letter-spacing: 6px;
      color: #60a5fa;
      background: rgba(15, 23, 42, 0.8);
      padding: 16px 24px;
      border-radius: 8px;
      border: 1px dashed rgba(96, 165, 250, 0.4);
      margin: 16px 0;
      display: inline-block;
      user-select: text;
    }

    .copy-btn-inline {
      margin-left: 8px;
      cursor: pointer;
      color: var(--accent-blue);
      font-size: 12px;
      font-weight: 600;
      text-decoration: underline;
    }

    .instruction-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      text-align: left;
    }

    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--accent-blue);
      color: white;
      font-weight: bold;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Notification banner */
    #notification-banner {
      display: none;
      padding: 10px 16px;
      border-radius: 6px;
      margin-bottom: 14px;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo-badge">⚡</div>
      <div class="sidebar-title">
        <h1>SEVATN WORKER</h1>
        <p>Control Center v1.0.0</p>
      </div>
    </div>

    <ul class="nav-list">
      <li class="nav-item active" onclick="switchTab('dashboard')">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>Dashboard</span>
      </li>
      <li class="nav-item" onclick="switchTab('terminal')">
        <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
        <span>Live Terminal</span>
      </li>
      <li class="nav-item" onclick="switchTab('pairing')">
        <svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
        <span>Pairing &amp; Key</span>
      </li>
      <li class="nav-item" onclick="switchTab('settings')">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        <span>Server Settings</span>
      </li>
      <li class="nav-item" onclick="switchTab('controls')">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Controls &amp; Service</span>
      </li>
    </ul>

    <div class="sidebar-footer">
      <span>Node: <strong id="lbl-machine-code">---</strong></span>
      <span id="lbl-status-dot" class="pulse-dot" style="color: #64748b;"></span>
    </div>
  </aside>

  <!-- Main Container -->
  <div class="main-container">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-left">
        <div id="badge-runtime" class="pill-badge pill-green">
          <span class="pulse-dot"></span>
          <span id="txt-runtime-status">CONNECTING...</span>
        </div>
        <div id="badge-backend" class="pill-badge pill-green">
          <span id="txt-backend-status">Backend: Probing...</span>
        </div>
      </div>

      <div class="topbar-right">
        <button class="btn btn-secondary" onclick="openFolder('logs')">
          <svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          Logs Folder
        </button>
        <button class="btn btn-primary" onclick="refreshStatus()">
          <svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Refresh
        </button>
      </div>
    </header>

    <!-- Content Area -->
    <main class="content-area">
      <div id="notification-banner"></div>

      <!-- Tab 1: Dashboard -->
      <section id="tab-dashboard" class="tab-pane active">
        <div class="metrics-grid">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Machine Code</span>
              <span style="font-size:16px;">💻</span>
            </div>
            <div class="card-value" id="card-machine-code">---</div>
            <div class="card-meta" id="card-machine-name">Loading identity...</div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Worker Runtime</span>
              <span style="font-size:16px;">⚙️</span>
            </div>
            <div class="card-value" id="card-desired-state">---</div>
            <div class="card-meta" id="card-activity-details">Active execution loop</div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Active Jobs</span>
              <span style="font-size:16px;">📋</span>
            </div>
            <div class="card-value" id="card-active-jobs">0 / 3</div>
            <div class="card-meta" id="card-active-ids">Queue polling active</div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">System Resources</span>
              <span style="font-size:16px;">📊</span>
            </div>
            <div class="card-value" id="card-resources">--% CPU</div>
            <div class="card-meta" id="card-ram">--% RAM utilization</div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header">
            <span class="card-title">Server Connection &amp; Telemetry</span>
            <span id="dash-backend-ping" class="pill-badge pill-green">Latency: -- ms</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px;">
            <div>
              <p style="color:var(--text-secondary); font-size:11px;">Configured Endpoint:</p>
              <p style="font-family:var(--font-mono); font-size:12.5px; margin-top:3px;" id="dash-backend-url">http://localhost:4000</p>
            </div>
            <div>
              <p style="color:var(--text-secondary); font-size:11px;">Pairing &amp; Token Status:</p>
              <p style="font-size:12.5px; margin-top:3px; font-weight:600;" id="dash-pairing-status">Checking...</p>
            </div>
          </div>
        </div>

        <!-- Quick Action Row -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Quick Operations</span>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
            <button class="btn btn-secondary" onclick="controlWorker('pause')">⏸️ Pause Job Claims</button>
            <button class="btn btn-success" onclick="controlWorker('resume')">▶️ Resume Job Claims</button>
            <button class="btn btn-secondary" onclick="controlWorker('restart')">🔄 Restart Worker</button>
            <button class="btn btn-danger" onclick="controlWorker('stop')">⏹️ Stop Worker</button>
          </div>
        </div>
      </section>

      <!-- Tab 2: Live Terminal -->
      <section id="tab-terminal" class="tab-pane">
        <div class="terminal-container">
          <div class="terminal-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:13px; font-weight:700; color:#f8fafc; font-family:var(--font-mono);">CONSOLE</span>
              <span id="log-count" style="font-size:10px; color:#64748b; font-family:var(--font-mono);">0 events</span>
            </div>

            <div class="terminal-controls">
              <input type="text" id="terminal-search" class="terminal-search" placeholder="Search logs (filter)..." oninput="renderLogs()">

              <div class="filter-btn-group">
                <span class="filter-chip active" onclick="setLogFilter('ALL', this)">ALL</span>
                <span class="filter-chip" onclick="setLogFilter('INFO', this)">INFO</span>
                <span class="filter-chip" onclick="setLogFilter('WARN', this)">WARN</span>
                <span class="filter-chip" onclick="setLogFilter('ERROR', this)">ERROR</span>
              </div>

              <label style="display:flex; align-items:center; gap:4px; font-size:11px; color:#94a3b8; cursor:pointer;">
                <input type="checkbox" id="chk-autoscroll" checked> Auto-Scroll
              </label>

              <button class="btn btn-secondary" style="padding:3px 8px; font-size:11px;" onclick="copyAllLogs()">Copy</button>
              <button class="btn btn-secondary" style="padding:3px 8px; font-size:11px;" onclick="clearTerminal()">Clear</button>
            </div>
          </div>

          <div id="terminal-screen" class="terminal-screen"></div>
        </div>
      </section>

      <!-- Tab 3: Pairing & Key -->
      <section id="tab-pairing" class="tab-pane">
        <div class="pairing-box">
          <h2 style="font-size:18px; font-weight:800; margin-bottom:8px;">Worker Machine Pairing</h2>
          <p style="color:var(--text-secondary); font-size:12px; margin-bottom:20px;">
            Authenticate this local machine node with your SEVATN / ServiceTN platform.
          </p>

          <div style="background:rgba(0,0,0,0.3); border-radius:8px; padding:12px; margin-bottom:16px;">
            <p style="font-size:11px; color:var(--text-secondary);">Your Unique Machine Code:</p>
            <p style="font-size:18px; font-weight:800; font-family:var(--font-mono); color:#38bdf8;" id="pair-machine-code">---</p>
          </div>

          <div id="pairing-code-container" style="display:none;">
            <p style="font-size:11px; color:var(--text-secondary);">15-Minute One-Time Pairing Key:</p>
            <div class="pairing-code-display" id="display-pairing-code">------</div>
            <p style="font-size:11px; color:#fbbf24;" id="pairing-countdown">Awaiting Super Admin registration on /admin/fleet...</p>
          </div>

          <div id="pairing-approved-container" style="display:none; padding:20px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px; margin-bottom:16px;">
            <div style="font-size:32px; margin-bottom:8px;">✅</div>
            <h3 style="font-size:14px; font-weight:700; color:#34d399;">Machine Is Verified &amp; Paired</h3>
            <p style="font-size:11px; color:var(--text-secondary); margin-top:4px;">Cryptographic machine authentication token is safely stored on this device.</p>
          </div>

          <button id="btn-generate-pair" class="btn btn-primary" style="padding:10px 20px; font-size:13px;" onclick="initiatePairing()">
            Generate Fresh Pairing Key
          </button>

          <div style="margin-top:30px; border-top:1px solid var(--border-color); padding-top:20px;">
            <h4 style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:12px; text-align:left;">Steps for Super Admin:</h4>
            <div class="instruction-step">
              <span class="step-num">1</span>
              <p>Navigate to the Administrator portal at <strong id="pair-portal-link" style="color:#60a5fa;">http://localhost:3000/admin/fleet</strong></p>
            </div>
            <div class="instruction-step">
              <span class="step-num">2</span>
              <p>Click <strong>"Add / Pair Worker"</strong> and choose <strong>"Approve Terminal Code"</strong>.</p>
            </div>
            <div class="instruction-step">
              <span class="step-num">3</span>
              <p>Enter the <strong>Machine Code</strong> and <strong>Pairing Key</strong> above, assign a display name, and click <strong>Approve</strong>.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 4: Server Settings -->
      <section id="tab-settings" class="tab-pane">
        <div class="card" style="max-width:650px; margin:0 auto;">
          <div class="card-header">
            <span class="card-title">Backend Server Settings</span>
          </div>

          <div class="form-group" style="margin-top:14px;">
            <label class="form-label">SEVATN / TicketAssist API Base URL</label>
            <input type="text" id="setting-backend-url" class="form-input" placeholder="http://localhost:4000">
            <p class="form-help">Must start with http:// or https://. For Devtunnels or remote cloud: e.g. https://l19zlb3p-4000.inc1.devtunnels.ms</p>
          </div>

          <div style="display:flex; gap:10px; margin-bottom:20px;">
            <button class="btn btn-secondary" onclick="testConnection()">🧪 Test Connection</button>
            <button class="btn btn-primary" onclick="saveSettings()">💾 Save &amp; Apply Settings</button>
          </div>

          <div id="test-result-box" style="display:none; padding:12px; border-radius:6px; font-size:12px; font-family:var(--font-mono); margin-bottom:16px;"></div>

          <div style="border-top:1px solid var(--border-color); padding-top:16px;">
            <h4 style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:8px;">Identity Safety Notice</h4>
            <p style="font-size:11.5px; color:var(--text-muted); line-height:1.5;">
              Changing server endpoints preserves your Machine Code and cryptographically stored token. Credentials are bound locally in <code>%PROGRAMDATA%\\SEVATN\\Worker\\.worker-credentials.json</code>.
            </p>
          </div>
        </div>
      </section>

      <!-- Tab 5: Controls & Service -->
      <section id="tab-controls" class="tab-pane">
        <div class="card" style="max-width:650px; margin:0 auto 20px auto;">
          <div class="card-header">
            <span class="card-title">Worker Process Lifecycle</span>
          </div>

          <p style="color:var(--text-secondary); font-size:12px; margin-top:8px; margin-bottom:16px;">
            Control the local node process execution without losing assigned queues or session locks.
          </p>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--bg-tertiary); border-radius:6px;">
              <div>
                <p style="font-weight:700;">Worker Execution Engine</p>
                <p style="font-size:11px; color:var(--text-muted);">Toggles whether new booking jobs are claimed from the cloud queue.</p>
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-secondary" onclick="controlWorker('pause')">Pause</button>
                <button class="btn btn-success" onclick="controlWorker('resume')">Resume</button>
              </div>
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--bg-tertiary); border-radius:6px;">
              <div>
                <p style="font-weight:700;">Process Restart</p>
                <p style="font-size:11px; color:var(--text-muted);">Restarts worker engine loop, closing any lingering Chromium instances.</p>
              </div>
              <button class="btn btn-secondary" onclick="controlWorker('restart')">Restart Process</button>
            </div>
          </div>
        </div>

        <div class="card" style="max-width:650px; margin:0 auto;">
          <div class="card-header">
            <span class="card-title">System Paths &amp; Diagnostics</span>
          </div>

          <div style="display:flex; gap:10px; margin-top:14px;">
            <button class="btn btn-secondary" onclick="openFolder('logs')">📂 Open Logs Directory</button>
            <button class="btn btn-secondary" onclick="openFolder('install')">📁 Open Installation Folder</button>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script>
    let activeTab = 'dashboard';
    let logsArray = [];
    let logFilter = 'ALL';
    let isPaired = false;
    let pairingPollInterval = null;
    let eventSource = null;

    function switchTab(tabId) {
      activeTab = tabId;
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

      const targetPane = document.getElementById('tab-' + tabId);
      if (targetPane) targetPane.classList.add('active');

      const navItems = document.querySelectorAll('.nav-item');
      if (tabId === 'dashboard') navItems[0].classList.add('active');
      if (tabId === 'terminal') navItems[1].classList.add('active');
      if (tabId === 'pairing') navItems[2].classList.add('active');
      if (tabId === 'settings') navItems[3].classList.add('active');
      if (tabId === 'controls') navItems[4].classList.add('active');

      if (tabId === 'terminal') {
        renderLogs();
      }
    }

    function showBanner(msg, isError = false) {
      const banner = document.getElementById('notification-banner');
      banner.style.display = 'block';
      banner.style.backgroundColor = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
      banner.style.color = isError ? '#f87171' : '#34d399';
      banner.style.border = isError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)';
      banner.innerText = msg;
      setTimeout(() => { banner.style.display = 'none'; }, 4000);
    }

    async function refreshStatus() {
      try {
        const res = await fetch('/api/worker-status');
        const data = await res.json();

        // Machine code
        document.getElementById('lbl-machine-code').innerText = data.machineCode || 'PC-???';
        document.getElementById('card-machine-code').innerText = data.machineCode || 'PC-???';
        document.getElementById('card-machine-name').innerText = data.machineName || 'Worker Node';
        document.getElementById('pair-machine-code').innerText = data.machineCode || 'PC-???';

        // Runtime status badge
        const badgeRuntime = document.getElementById('badge-runtime');
        const txtRuntime = document.getElementById('txt-runtime-status');
        const desiredState = data.desiredState || 'STOPPED';

        document.getElementById('card-desired-state').innerText = desiredState;
        document.getElementById('card-activity-details').innerText = data.activityDetails || data.currentActivity || 'Active execution loop';

        if (desiredState === 'RUNNING') {
          badgeRuntime.className = 'pill-badge pill-green';
          txtRuntime.innerText = 'ONLINE (RUNNING)';
          document.getElementById('lbl-status-dot').style.color = '#10b981';
        } else if (desiredState === 'PAUSED') {
          badgeRuntime.className = 'pill-badge pill-amber';
          txtRuntime.innerText = 'PAUSED';
          document.getElementById('lbl-status-dot').style.color = '#f59e0b';
        } else {
          badgeRuntime.className = 'pill-badge pill-red';
          txtRuntime.innerText = desiredState || 'STOPPED';
          document.getElementById('lbl-status-dot').style.color = '#ef4444';
        }

        // Active jobs
        const activeCount = data.activeJobCount || 0;
        document.getElementById('card-active-jobs').innerText = activeCount + ' / 3';
        document.getElementById('card-active-ids').innerText = activeCount > 0 ? ('Jobs: ' + (data.activeJobIds || []).join(', ')) : 'Idle, waiting for queue jobs';

        // Resources
        document.getElementById('card-resources').innerText = (data.cpuUsage || 0) + '% CPU';
        document.getElementById('card-ram').innerText = (data.memoryUsage || 0) + '% RAM utilization';

        // Backend
        document.getElementById('dash-backend-url').innerText = data.backendUrl || 'http://localhost:4000';
        document.getElementById('setting-backend-url').value = data.backendUrl || 'http://localhost:4000';

        // Pairing state
        isPaired = data.paired || data.hasToken;
        const pairingStatusEl = document.getElementById('dash-pairing-status');
        const approvedContainer = document.getElementById('pairing-approved-container');
        const codeContainer = document.getElementById('pairing-code-container');
        const btnGen = document.getElementById('btn-generate-pair');

        if (isPaired) {
          pairingStatusEl.innerText = 'Verified & Paired (Token Active)';
          pairingStatusEl.style.color = '#34d399';
          approvedContainer.style.display = 'block';
          codeContainer.style.display = 'none';
          btnGen.style.display = 'none';
          if (pairingPollInterval) {
            clearInterval(pairingPollInterval);
            pairingPollInterval = null;
          }
        } else {
          pairingStatusEl.innerText = 'Unpaired / Awaiting Registration';
          pairingStatusEl.style.color = '#fbbf24';
          approvedContainer.style.display = 'none';
          btnGen.style.display = 'inline-block';
        }

      } catch (err) {
        document.getElementById('badge-runtime').className = 'pill-badge pill-red';
        document.getElementById('txt-runtime-status').innerText = 'WORKER STOPPED';
        document.getElementById('lbl-status-dot').style.color = '#ef4444';
      }
    }

    async function controlWorker(action) {
      try {
        const res = await fetch('/api/worker-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (data.ok) {
          showBanner(data.message || ('Action ' + action + ' succeeded.'));
          setTimeout(refreshStatus, 600);
        } else {
          showBanner(data.error || 'Operation failed', true);
        }
      } catch (err) {
        showBanner('Control request error: ' + err.message, true);
      }
    }

    async function testConnection() {
      const url = document.getElementById('setting-backend-url').value;
      const box = document.getElementById('test-result-box');
      box.style.display = 'block';
      box.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
      box.style.color = '#60a5fa';
      box.innerText = 'Probing backend ' + url + ' ...';

      try {
        const res = await fetch('/api/test-backend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backendUrl: url }),
        });
        const data = await res.json();

        if (data.ok) {
          box.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
          box.style.color = '#34d399';
          box.innerText = '✅ ' + data.message + ' [Latency: ' + data.latencyMs + 'ms]';
          document.getElementById('dash-backend-ping').innerText = 'Latency: ' + data.latencyMs + ' ms';
          document.getElementById('badge-backend').className = 'pill-badge pill-green';
          document.getElementById('txt-backend-status').innerText = 'Backend: Connected (' + data.latencyMs + 'ms)';
        } else {
          box.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
          box.style.color = '#f87171';
          box.innerText = '❌ ' + data.message;
          document.getElementById('badge-backend').className = 'pill-badge pill-red';
          document.getElementById('txt-backend-status').innerText = 'Backend: Unreachable';
        }
      } catch (err) {
        box.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        box.style.color = '#f87171';
        box.innerText = '❌ Request failed: ' + err.message;
      }
    }

    async function saveSettings() {
      const url = document.getElementById('setting-backend-url').value;
      try {
        const res = await fetch('/api/save-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backendUrl: url }),
        });
        const data = await res.json();
        if (data.ok) {
          showBanner('Server settings saved successfully.');
          refreshStatus();
        } else {
          showBanner(data.error || 'Failed to save settings', true);
        }
      } catch (err) {
        showBanner('Error saving settings: ' + err.message, true);
      }
    }

    async function initiatePairing() {
      const btn = document.getElementById('btn-generate-pair');
      btn.disabled = true;
      btn.innerText = 'Registering with backend...';

      try {
        const res = await fetch('/api/initiate-pairing', { method: 'POST' });
        const data = await res.json();

        if (data.ok && data.pairingCode) {
          document.getElementById('pairing-code-container').style.display = 'block';
          document.getElementById('display-pairing-code').innerText = data.pairingCode;
          btn.style.display = 'none';

          showBanner('Pairing key generated! Approve code on /admin/fleet.');

          // Start polling approval status
          if (pairingPollInterval) clearInterval(pairingPollInterval);
          pairingPollInterval = setInterval(pollPairingApproval, 3000);
        } else {
          showBanner(data.message || 'Pairing generation failed.', true);
          btn.disabled = false;
          btn.innerText = 'Generate Fresh Pairing Key';
        }
      } catch (err) {
        showBanner('Pairing request error: ' + err.message, true);
        btn.disabled = false;
        btn.innerText = 'Generate Fresh Pairing Key';
      }
    }

    async function pollPairingApproval() {
      try {
        const res = await fetch('/api/poll-pairing');
        const data = await res.json();
        if (data.paired) {
          clearInterval(pairingPollInterval);
          pairingPollInterval = null;
          showBanner('✅ Worker Approved & Paired! Initializing execution loop...');
          refreshStatus();
        }
      } catch {}
    }

    async function openFolder(target) {
      try {
        await fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
      } catch {}
    }

    // Terminal log streaming
    function setupLogStream() {
      if (eventSource) eventSource.close();
      eventSource = new EventSource('/api/logs/stream');

      eventSource.onmessage = function(event) {
        try {
          const log = JSON.parse(event.data);
          logsArray.push(log);
          if (logsArray.length > 1500) logsArray.shift();

          document.getElementById('log-count').innerText = logsArray.length + ' events';

          if (activeTab === 'terminal') {
            appendLogLine(log);
          }
        } catch {}
      };

      eventSource.onerror = function() {
        // SSE reconnect handles automatically
      };
    }

    function setLogFilter(level, btn) {
      logFilter = level;
      document.querySelectorAll('.filter-chip').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      renderLogs();
    }

    function renderLogs() {
      const screen = document.getElementById('terminal-screen');
      screen.innerHTML = '';
      const query = (document.getElementById('terminal-search').value || '').toLowerCase();

      const filtered = logsArray.filter(l => {
        if (logFilter !== 'ALL' && l.level !== logFilter) return false;
        if (query && !l.message.toLowerCase().includes(query)) return false;
        return true;
      });

      for (const log of filtered) {
        appendLogLine(log, false);
      }

      if (document.getElementById('chk-autoscroll').checked) {
        screen.scrollTop = screen.scrollHeight;
      }
    }

    function appendLogLine(log, checkFilter = true) {
      const screen = document.getElementById('terminal-screen');
      const query = (document.getElementById('terminal-search').value || '').toLowerCase();

      if (checkFilter) {
        if (logFilter !== 'ALL' && log.level !== logFilter) return;
        if (query && !log.message.toLowerCase().includes(query)) return;
      }

      const row = document.createElement('div');
      row.className = 'log-line';

      const timeStr = (log.timestamp || '').split('T')[1]?.replace('Z', '') || log.timestamp;
      const contextStr = log.context ? (' ' + JSON.stringify(log.context)) : '';

      row.innerHTML = '<span class="log-ts">' + timeStr + '</span>' +
                      '<span class="log-tag log-tag-' + log.level + '">[' + log.level + ']</span>' +
                      '<span class="log-msg">' + escapeHtml(log.message) + escapeHtml(contextStr) + '</span>';

      screen.appendChild(row);

      if (document.getElementById('chk-autoscroll').checked) {
        screen.scrollTop = screen.scrollHeight;
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function clearTerminal() {
      logsArray = [];
      document.getElementById('terminal-screen').innerHTML = '';
      document.getElementById('log-count').innerText = '0 events';
    }

    function copyAllLogs() {
      const text = logsArray.map(l => '[' + l.timestamp + '] [' + l.level + '] ' + l.message).join('\\n');
      navigator.clipboard.writeText(text);
      showBanner('Logs copied to clipboard.');
    }

    // Startup initialization
    window.addEventListener('DOMContentLoaded', () => {
      refreshStatus();
      setupLogStream();
      setInterval(refreshStatus, 4000);
    });
  </script>
</body>
</html>`;
}
