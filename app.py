#!/usr/bin/env python3
import argparse
import hashlib
import hmac
import json
import os
import secrets
import shutil
import signal
import sqlite3
import ssl
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


APP_NAME = "Debian Website Monitor"
DB_PATH = os.environ.get("MONITOR_DB", os.path.join(os.path.dirname(__file__), "monitor.db"))
DEFAULT_HOST = os.environ.get("MONITOR_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("MONITOR_PORT", "8080"))
ADMIN_PASSWORD = os.environ.get("MONITOR_ADMIN_PASSWORD", "admin123")
SESSION_SECRET = os.environ.get("MONITOR_SESSION_SECRET", secrets.token_hex(32))
CHECK_TIMEOUT = int(os.environ.get("MONITOR_CHECK_TIMEOUT", "10"))
MAX_BODY = 256 * 1024

_stop_event = threading.Event()
_db_lock = threading.RLock()
_cpu_prev = None


INDEX_HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>网站监控面板</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #667085;
      --line: #d9e0ec;
      --ok: #16803c;
      --bad: #c72c41;
      --warn: #a15c00;
      --accent: #2563eb;
      --accent-dark: #1748b5;
      --shadow: 0 10px 28px rgba(24, 38, 71, .08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-width: 320px;
    }

    header {
      background: #14213d;
      color: #fff;
      padding: 18px 22px;
      border-bottom: 4px solid #f2b705;
    }

    header .wrap, main {
      width: min(1180px, calc(100% - 28px));
      margin: 0 auto;
    }

    header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0;
    }

    header p {
      margin: 6px 0 0;
      color: #cbd5e1;
      font-size: 13px;
    }

    main { padding: 18px 0 36px; }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .tabs {
      display: inline-flex;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }

    .tab {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 10px 16px;
      font-size: 14px;
      cursor: pointer;
    }

    .tab.active {
      color: #fff;
      background: var(--accent);
    }

    .button, button {
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 9px 12px;
      font-size: 14px;
      cursor: pointer;
      min-height: 38px;
    }

    .button:hover, button:hover { background: var(--accent-dark); }
    button.secondary {
      background: #fff;
      color: var(--accent);
      border-color: var(--line);
    }
    button.secondary:hover { background: #eef4ff; }
    button.danger {
      background: #fff;
      color: var(--bad);
      border-color: #f1b8c2;
    }
    button.danger:hover { background: #fff0f3; }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }

    .span-4 { grid-column: span 4; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }

    h2 {
      margin: 0 0 12px;
      font-size: 17px;
      line-height: 1.35;
    }

    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    .metric {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #edf1f7;
    }
    .metric:last-child { border-bottom: 0; }
    .metric strong { font-size: 20px; }

    .bar {
      height: 8px;
      background: #e7edf6;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 7px;
    }
    .bar > i {
      display: block;
      height: 100%;
      width: 0;
      background: var(--accent);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid #edf1f7;
      text-align: left;
      vertical-align: middle;
      overflow-wrap: anywhere;
      font-size: 14px;
    }
    th { color: var(--muted); font-weight: 600; font-size: 12px; }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 74px;
      font-weight: 700;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      background: var(--warn);
    }
    .ok .dot { background: var(--ok); }
    .bad .dot { background: var(--bad); }
    .ok { color: var(--ok); }
    .bad { color: var(--bad); }
    .warn { color: var(--warn); }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 2fr 120px 120px auto;
      gap: 10px;
      align-items: end;
      margin-bottom: 14px;
    }
    label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      min-height: 38px;
      padding: 8px 10px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
    }

    input[type="checkbox"] {
      width: 18px;
      min-height: 18px;
      height: 18px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .notice {
      min-height: 22px;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 10px;
    }

    .hidden { display: none !important; }

    @media (max-width: 820px) {
      .span-4, .span-8 { grid-column: span 12; }
      .form-row { grid-template-columns: 1fr; }
      th:nth-child(4), td:nth-child(4),
      th:nth-child(5), td:nth-child(5) { display: none; }
      header .wrap, main { width: min(100% - 18px, 1180px); }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>网站监控面板</h1>
      <p id="subtitle">等待数据刷新</p>
    </div>
  </header>

  <main>
    <div class="toolbar">
      <div class="tabs">
        <button class="tab active" data-tab="dashboard">监控</button>
        <button class="tab" data-tab="admin">后台配置</button>
      </div>
      <div class="actions">
        <button class="secondary" id="refreshBtn">刷新</button>
        <button id="checkAllBtn">立即检测</button>
      </div>
    </div>

    <section id="dashboard" class="grid">
      <div class="panel span-8">
        <h2>网站状态</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 22%">名称</th>
              <th>地址</th>
              <th style="width: 95px">状态</th>
              <th style="width: 92px">HTTP</th>
              <th style="width: 110px">耗时</th>
              <th style="width: 150px">上次检测</th>
            </tr>
          </thead>
          <tbody id="siteRows"></tbody>
        </table>
      </div>

      <div class="panel span-4">
        <h2>服务器状态</h2>
        <div id="systemMetrics"></div>
      </div>

      <div class="panel span-12">
        <h2>最近错误</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 180px">时间</th>
              <th style="width: 180px">网站</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody id="errorRows"></tbody>
        </table>
      </div>
    </section>

    <section id="admin" class="hidden">
      <div class="panel">
        <h2>后台配置</h2>
        <div id="adminNotice" class="notice"></div>
        <div id="loginBox" class="form-row">
          <div>
            <label>管理员密码</label>
            <input id="passwordInput" type="password" autocomplete="current-password" placeholder="默认 admin123">
          </div>
          <div></div>
          <div></div>
          <div></div>
          <button id="loginBtn">登录</button>
        </div>

        <div id="configBox" class="hidden">
          <div class="form-row">
            <div>
              <label>名称</label>
              <input id="nameInput" placeholder="例如：官网">
            </div>
            <div>
              <label>网址</label>
              <input id="urlInput" placeholder="https://example.com">
            </div>
            <div>
              <label>间隔秒</label>
              <input id="intervalInput" type="number" min="10" value="60">
            </div>
            <div>
              <label>期望状态码</label>
              <input id="expectedInput" placeholder="200 或留空">
            </div>
            <button id="addBtn">添加</button>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 70px">启用</th>
                <th style="width: 18%">名称</th>
                <th>地址</th>
                <th style="width: 100px">间隔</th>
                <th style="width: 110px">状态码</th>
                <th style="width: 145px">操作</th>
              </tr>
            </thead>
            <tbody id="configRows"></tbody>
          </table>
        </div>
      </div>
    </section>
  </main>

  <script>
    const state = { authenticated: false, sites: [], system: {}, errors: [] };
    const $ = (id) => document.getElementById(id);

    function fmtTime(value) {
      if (!value) return "-";
      return new Date(value * 1000).toLocaleString();
    }

    function fmtMs(value) {
      if (value === null || value === undefined) return "-";
      return `${value} ms`;
    }

    function pct(value) {
      if (value === null || value === undefined || Number.isNaN(value)) return "-";
      return `${Number(value).toFixed(1)}%`;
    }

    async function api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `请求失败：${res.status}`);
      return data;
    }

    function renderSites() {
      const rows = state.sites.map((site) => {
        const cls = site.last_ok === 1 ? "ok" : (site.last_ok === 0 ? "bad" : "warn");
        const text = site.last_ok === 1 ? "正常" : (site.last_ok === 0 ? "异常" : "等待");
        return `<tr>
          <td><strong>${escapeHtml(site.name)}</strong></td>
          <td><a href="${escapeAttr(site.url)}" target="_blank" rel="noreferrer">${escapeHtml(site.url)}</a></td>
          <td><span class="status ${cls}"><i class="dot"></i>${text}</span></td>
          <td>${site.last_status_code || "-"}</td>
          <td>${fmtMs(site.last_latency_ms)}</td>
          <td>${fmtTime(site.last_checked_at)}</td>
        </tr>`;
      }).join("");
      $("siteRows").innerHTML = rows || `<tr><td colspan="6" class="muted">还没有配置网站，请到后台配置里添加。</td></tr>`;

      const ok = state.sites.filter(s => s.last_ok === 1).length;
      const bad = state.sites.filter(s => s.last_ok === 0).length;
      $("subtitle").textContent = `共 ${state.sites.length} 个站点，正常 ${ok} 个，异常 ${bad} 个`;
    }

    function renderSystem() {
      const s = state.system || {};
      const load = Array.isArray(s.loadavg) ? s.loadavg.map(x => Number(x).toFixed(2)).join(" / ") : "-";
      const metrics = [
        ["CPU", pct(s.cpu_percent), s.cpu_percent],
        ["内存", `${pct(s.memory_percent)} · ${s.memory_used_mb || "-"} / ${s.memory_total_mb || "-"} MB`, s.memory_percent],
        ["磁盘", `${pct(s.disk_percent)} · ${s.disk_used_gb || "-"} / ${s.disk_total_gb || "-"} GB`, s.disk_percent],
        ["负载", load, null],
        ["运行时间", s.uptime || "-", null],
      ];
      $("systemMetrics").innerHTML = metrics.map(([name, value, bar]) => `
        <div class="metric">
          <div style="width:100%">
            <div class="small muted">${name}</div>
            <strong>${value}</strong>
            ${bar === null || bar === undefined ? "" : `<div class="bar"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>`}
          </div>
        </div>
      `).join("");
    }

    function renderErrors() {
      const rows = state.errors.map((item) => `
        <tr>
          <td>${fmtTime(item.checked_at)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.error || "未知错误")}</td>
        </tr>
      `).join("");
      $("errorRows").innerHTML = rows || `<tr><td colspan="3" class="muted">暂无错误记录。</td></tr>`;
    }

    function renderConfig() {
      const rows = state.sites.map((site) => `
        <tr>
          <td><input id="cfg-enabled-${site.id}" type="checkbox" ${site.enabled ? "checked" : ""}></td>
          <td><input id="cfg-name-${site.id}" value="${escapeAttr(site.name)}"></td>
          <td><input id="cfg-url-${site.id}" value="${escapeAttr(site.url)}"></td>
          <td><input id="cfg-interval-${site.id}" type="number" min="10" value="${site.interval_seconds}"></td>
          <td><input id="cfg-expected-${site.id}" value="${site.expected_status || ""}" placeholder="2xx/3xx"></td>
          <td>
            <div class="actions">
              <button class="secondary" onclick="saveSite(${site.id})">保存</button>
              <button class="danger" onclick="deleteSite(${site.id})">删除</button>
            </div>
          </td>
        </tr>
      `).join("");
      $("configRows").innerHTML = rows || `<tr><td colspan="6" class="muted">暂无站点。</td></tr>`;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (m) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[m]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#096;");
    }

    async function refresh() {
      const data = await api("/api/status");
      state.sites = data.sites || [];
      state.system = data.system || {};
      state.errors = data.errors || [];
      renderSites();
      renderSystem();
      renderErrors();
      renderConfig();
    }

    async function login() {
      try {
        await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ password: $("passwordInput").value })
        });
        state.authenticated = true;
        $("loginBox").classList.add("hidden");
        $("configBox").classList.remove("hidden");
        $("adminNotice").textContent = "已登录，可以修改监控配置。";
        $("passwordInput").value = "";
        await refresh();
      } catch (err) {
        $("adminNotice").textContent = err.message;
      }
    }

    async function addSite() {
      const payload = {
        name: $("nameInput").value.trim(),
        url: $("urlInput").value.trim(),
        interval_seconds: Number($("intervalInput").value || 60),
        expected_status: $("expectedInput").value.trim() || null,
      };
      try {
        await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
        $("nameInput").value = "";
        $("urlInput").value = "";
        $("expectedInput").value = "";
        $("adminNotice").textContent = "已添加，后台会自动开始检测。";
        await refresh();
      } catch (err) {
        $("adminNotice").textContent = err.message;
      }
    }

    async function deleteSite(id) {
      if (!confirm("确定删除这个站点吗？")) return;
      await api(`/api/sites/${id}`, { method: "DELETE" });
      await refresh();
    }

    async function saveSite(id) {
      const payload = {
        enabled: $(`cfg-enabled-${id}`).checked ? 1 : 0,
        name: $(`cfg-name-${id}`).value.trim(),
        url: $(`cfg-url-${id}`).value.trim(),
        interval_seconds: Number($(`cfg-interval-${id}`).value || 60),
        expected_status: $(`cfg-expected-${id}`).value.trim() || null,
      };
      try {
        await api(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        $("adminNotice").textContent = "已保存。";
        await refresh();
      } catch (err) {
        $("adminNotice").textContent = err.message;
      }
    }

    async function checkAll() {
      await api("/api/check-now", { method: "POST", body: "{}" });
      await refresh();
    }

    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        ["dashboard", "admin"].forEach(id => $(id).classList.toggle("hidden", id !== btn.dataset.tab));
      });
    });

    $("refreshBtn").addEventListener("click", () => refresh().catch(alert));
    $("checkAllBtn").addEventListener("click", () => checkAll().catch(alert));
    $("loginBtn").addEventListener("click", login);
    $("addBtn").addEventListener("click", addSite);
    $("passwordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

    refresh().catch((err) => {
      $("siteRows").innerHTML = `<tr><td colspan="6" class="bad">${escapeHtml(err.message)}</td></tr>`;
    });
    setInterval(() => refresh().catch(() => {}), 10000);
  </script>
</body>
</html>
"""


def now_ts():
    return int(time.time())


def json_bytes(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def connect_db():
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _db_lock:
        conn = connect_db()
        try:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    interval_seconds INTEGER NOT NULL DEFAULT 60,
                    expected_status INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_checked_at INTEGER,
                    last_ok INTEGER,
                    last_status_code INTEGER,
                    last_latency_ms INTEGER,
                    last_error TEXT,
                    next_check_at INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS checks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    site_id INTEGER NOT NULL,
                    checked_at INTEGER NOT NULL,
                    ok INTEGER NOT NULL,
                    status_code INTEGER,
                    latency_ms INTEGER,
                    error TEXT,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
                );
                """
            )
            conn.commit()
        finally:
            conn.close()


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def get_sites(include_disabled=True):
    sql = "SELECT * FROM sites"
    params = ()
    if not include_disabled:
      sql += " WHERE enabled = 1"
    sql += " ORDER BY id ASC"
    with _db_lock:
        conn = connect_db()
        try:
            return rows_to_dicts(conn.execute(sql, params).fetchall())
        finally:
            conn.close()


def get_due_sites():
    with _db_lock:
        conn = connect_db()
        try:
            rows = conn.execute(
                """
                SELECT * FROM sites
                WHERE enabled = 1 AND next_check_at <= ?
                ORDER BY next_check_at ASC, id ASC
                LIMIT 20
                """,
                (now_ts(),),
            ).fetchall()
            return rows_to_dicts(rows)
        finally:
            conn.close()


def add_site(data):
    name = str(data.get("name") or "").strip()
    url = str(data.get("url") or "").strip()
    interval_seconds = int(data.get("interval_seconds") or 60)
    expected_status_raw = data.get("expected_status")
    expected_status = int(expected_status_raw) if expected_status_raw not in (None, "") else None

    if not name:
        raise ValueError("名称不能为空")
    if not valid_url(url):
        raise ValueError("网址必须以 http:// 或 https:// 开头")
    if interval_seconds < 10:
        raise ValueError("检测间隔不能小于 10 秒")
    if expected_status is not None and not 100 <= expected_status <= 599:
        raise ValueError("期望状态码必须在 100 到 599 之间")

    with _db_lock:
        conn = connect_db()
        try:
            cur = conn.execute(
                """
                INSERT INTO sites
                (name, url, interval_seconds, expected_status, enabled, next_check_at, created_at)
                VALUES (?, ?, ?, ?, 1, 0, ?)
                """,
                (name, url, interval_seconds, expected_status, now_ts()),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def update_site(site_id, data):
    fields = []
    params = []
    allowed = {"name", "url", "interval_seconds", "expected_status", "enabled"}
    for key in allowed:
        if key not in data:
            continue
        value = data[key]
        if key == "name":
            value = str(value).strip()
            if not value:
                raise ValueError("名称不能为空")
        elif key == "url":
            value = str(value).strip()
            if not valid_url(value):
                raise ValueError("网址必须以 http:// 或 https:// 开头")
        elif key == "interval_seconds":
            value = int(value)
            if value < 10:
                raise ValueError("检测间隔不能小于 10 秒")
        elif key == "expected_status":
            value = int(value) if value not in (None, "") else None
            if value is not None and not 100 <= value <= 599:
                raise ValueError("期望状态码必须在 100 到 599 之间")
        elif key == "enabled":
            value = 1 if value else 0
        fields.append(f"{key} = ?")
        params.append(value)

    if not fields:
        return
    params.append(int(site_id))

    with _db_lock:
        conn = connect_db()
        try:
            conn.execute(f"UPDATE sites SET {', '.join(fields)} WHERE id = ?", params)
            conn.commit()
        finally:
            conn.close()


def delete_site(site_id):
    with _db_lock:
        conn = connect_db()
        try:
            conn.execute("DELETE FROM checks WHERE site_id = ?", (int(site_id),))
            conn.execute("DELETE FROM sites WHERE id = ?", (int(site_id),))
            conn.commit()
        finally:
            conn.close()


def recent_errors(limit=20):
    with _db_lock:
        conn = connect_db()
        try:
            rows = conn.execute(
                """
                SELECT c.checked_at, s.name, c.error
                FROM checks c
                JOIN sites s ON s.id = c.site_id
                WHERE c.ok = 0
                ORDER BY c.checked_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return rows_to_dicts(rows)
        finally:
            conn.close()


def valid_url(url):
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def check_site(site):
    start = time.time()
    status_code = None
    error = None
    ok = False
    request = urllib.request.Request(
        site["url"],
        headers={
            "User-Agent": "DebianWebsiteMonitor/1.0",
            "Accept": "*/*",
        },
        method="GET",
    )
    context = ssl.create_default_context()

    try:
        with urllib.request.urlopen(request, timeout=CHECK_TIMEOUT, context=context) as response:
            status_code = response.getcode()
            response.read(1024)
        expected = site.get("expected_status")
        ok = status_code == expected if expected else 200 <= status_code < 400
    except urllib.error.HTTPError as exc:
        status_code = exc.code
        expected = site.get("expected_status")
        ok = status_code == expected if expected else False
        error = f"HTTP {exc.code}"
    except Exception as exc:
        error = str(exc) or exc.__class__.__name__

    latency_ms = int((time.time() - start) * 1000)
    checked_at = now_ts()
    interval = max(10, int(site.get("interval_seconds") or 60))
    next_check_at = checked_at + interval

    with _db_lock:
        conn = connect_db()
        try:
            conn.execute(
                """
                INSERT INTO checks (site_id, checked_at, ok, status_code, latency_ms, error)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (site["id"], checked_at, 1 if ok else 0, status_code, latency_ms, error),
            )
            conn.execute(
                """
                UPDATE sites
                SET last_checked_at = ?,
                    last_ok = ?,
                    last_status_code = ?,
                    last_latency_ms = ?,
                    last_error = ?,
                    next_check_at = ?
                WHERE id = ?
                """,
                (checked_at, 1 if ok else 0, status_code, latency_ms, error, next_check_at, site["id"]),
            )
            conn.execute(
                """
                DELETE FROM checks
                WHERE id NOT IN (
                    SELECT id FROM checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 100
                ) AND site_id = ?
                """,
                (site["id"], site["id"]),
            )
            conn.commit()
        finally:
            conn.close()


def scheduler_loop():
    while not _stop_event.is_set():
        try:
            due_sites = get_due_sites()
            for site in due_sites:
                if _stop_event.is_set():
                    break
                check_site(site)
        except Exception:
            traceback.print_exc()
        _stop_event.wait(2)


def force_check_all():
    sites = get_sites(include_disabled=False)
    for site in sites:
        check_site(site)


def read_first_line(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.readline().strip()
    except OSError:
        return None


def parse_meminfo():
    values = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 2:
                    values[parts[0].rstrip(":")] = int(parts[1])
    except OSError:
        return {}
    total = values.get("MemTotal")
    available = values.get("MemAvailable", values.get("MemFree"))
    if not total or available is None:
        return {}
    used = total - available
    return {
        "memory_total_mb": round(total / 1024),
        "memory_used_mb": round(used / 1024),
        "memory_percent": round(used * 100 / total, 1),
    }


def read_cpu_times():
    line = read_first_line("/proc/stat")
    if not line or not line.startswith("cpu "):
        return None
    parts = [int(x) for x in line.split()[1:]]
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    total = sum(parts)
    return total, idle


def cpu_percent():
    global _cpu_prev
    current = read_cpu_times()
    if current is None:
        return None
    if _cpu_prev is None:
        _cpu_prev = current
        return 0.0
    total_delta = current[0] - _cpu_prev[0]
    idle_delta = current[1] - _cpu_prev[1]
    _cpu_prev = current
    if total_delta <= 0:
        return 0.0
    return round((1 - idle_delta / total_delta) * 100, 1)


def disk_usage(path="/"):
    try:
        stats = shutil.disk_usage(path)
    except OSError:
        return {}
    total = stats.total
    used = stats.used
    if total <= 0:
        return {}
    return {
        "disk_total_gb": round(total / 1024 / 1024 / 1024, 1),
        "disk_used_gb": round(used / 1024 / 1024 / 1024, 1),
        "disk_percent": round(used * 100 / total, 1),
    }


def uptime_text():
    raw = read_first_line("/proc/uptime")
    if not raw:
        return None
    seconds = int(float(raw.split()[0]))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    if days:
        return f"{days}天 {hours}小时 {minutes}分"
    if hours:
        return f"{hours}小时 {minutes}分"
    return f"{minutes}分"


def loadavg():
    raw = read_first_line("/proc/loadavg")
    if not raw:
        return None
    return [float(x) for x in raw.split()[:3]]


def system_status():
    data = {
        "cpu_percent": cpu_percent(),
        "loadavg": loadavg(),
        "uptime": uptime_text(),
        "timestamp": now_ts(),
    }
    data.update(parse_meminfo())
    data.update(disk_usage("/"))
    return data


def make_session_token():
    ts = str(now_ts())
    signature = hmac.new(SESSION_SECRET.encode("utf-8"), ts.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{ts}.{signature}"


def verify_session_token(token):
    if not token or "." not in token:
        return False
    ts, signature = token.split(".", 1)
    if not ts.isdigit():
        return False
    if now_ts() - int(ts) > 86400:
        return False
    expected = hmac.new(SESSION_SECRET.encode("utf-8"), ts.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def parse_cookie(header):
    result = {}
    if not header:
        return result
    for item in header.split(";"):
        if "=" in item:
            key, value = item.strip().split("=", 1)
            result[key] = value
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "DebianWebsiteMonitor/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self.send_html(INDEX_HTML)
        elif parsed.path == "/api/status":
            self.send_json({
                "sites": get_sites(),
                "system": system_status(),
                "errors": recent_errors(),
            })
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/login":
            data = self.read_json()
            if hmac.compare_digest(str(data.get("password") or ""), ADMIN_PASSWORD):
                token = make_session_token()
                self.send_json({"ok": True}, headers=[("Set-Cookie", f"monitor_session={token}; HttpOnly; SameSite=Lax; Path=/")])
            else:
                self.send_json({"error": "密码错误"}, HTTPStatus.UNAUTHORIZED)
        elif parsed.path == "/api/sites":
            self.require_auth()
            site_id = add_site(self.read_json())
            self.send_json({"ok": True, "id": site_id}, HTTPStatus.CREATED)
        elif parsed.path == "/api/check-now":
            self.require_auth()
            threading.Thread(target=force_check_all, daemon=True).start()
            self.send_json({"ok": True})
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/sites/"):
            self.require_auth()
            site_id = parsed.path.rsplit("/", 1)[-1]
            update_site(site_id, self.read_json())
            self.send_json({"ok": True})
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/sites/"):
            self.require_auth()
            site_id = parsed.path.rsplit("/", 1)[-1]
            delete_site(site_id)
            self.send_json({"ok": True})
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("请求内容过大")
        body = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise ValueError("JSON 格式错误")

    def authenticated(self):
        cookies = parse_cookie(self.headers.get("Cookie"))
        return verify_session_token(cookies.get("monitor_session"))

    def require_auth(self, optional=False):
        if optional or self.authenticated():
            return
        self.send_json({"error": "请先登录后台"}, HTTPStatus.UNAUTHORIZED)
        raise StopRequest()

    def send_html(self, html, status=HTTPStatus.OK):
        payload = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, data, status=HTTPStatus.OK, headers=None):
        payload = json_bytes(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except StopRequest:
            return
        except ValueError as exc:
            try:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception:
                pass
        except Exception:
            traceback.print_exc()
            try:
                self.send_json({"error": "服务器内部错误"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            except Exception:
                pass


class StopRequest(Exception):
    pass


def main():
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--host", default=DEFAULT_HOST, help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口，默认 8080")
    args = parser.parse_args()

    init_db()
    scheduler = threading.Thread(target=scheduler_loop, daemon=True)
    scheduler.start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)

    def shutdown(signum, frame):
        _stop_event.set()
        httpd.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print(f"{APP_NAME} running at http://{args.host}:{args.port}")
    print(f"Database: {DB_PATH}")
    try:
        httpd.serve_forever()
    finally:
        _stop_event.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
