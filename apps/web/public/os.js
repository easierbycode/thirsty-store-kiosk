// Thirsty OS — a tiny desktop window manager (no dependencies).
// Folders hold app icons; icons launch draggable, resizable windows that
// embed each app in an iframe. Built to feel like a real desktop while
// keeping the existing Inventory dashboard fully intact at /inventory.

// Escape interpolated text before it goes into an innerHTML template, so a
// future app name/title sourced from config/API can't break out of markup.
const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

/* ---------------------------------------------------------------- icons -- */

// Gradient defs live once in a hidden sprite (injected at boot) — SVG url()
// references are document-scoped, so every icon instance reuses them without
// duplicating element ids across the DOM.
const ICON_GRADIENTS = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <linearGradient id="g-folder-back" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c75408"/><stop offset="1" stop-color="#9c4106"/>
      </linearGradient>
      <linearGradient id="g-folder-front" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6a93f"/><stop offset="1" stop-color="#e8650a"/>
      </linearGradient>
      <linearGradient id="g-inv" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f5832e"/><stop offset="1" stop-color="#d2560a"/>
      </linearGradient>
      <linearGradient id="g-val" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f7c64f"/><stop offset="1" stop-color="#e89b16"/>
      </linearGradient>
      <linearGradient id="g-box" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4fc3a1"/><stop offset="1" stop-color="#239b7e"/>
      </linearGradient>
      <linearGradient id="g-kiosk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7aa6ff"/><stop offset="1" stop-color="#4364cf"/>
      </linearGradient>
    </defs>
  </svg>`;

const ICONS = {
  folder: `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5 17a4 4 0 0 1 4-4h13.2a4 4 0 0 1 2.9 1.25L31 19h24a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" fill="url(#g-folder-back)"/>
      <path d="M7 27a3 3 0 0 1 3-3h44a3 3 0 0 1 3 3v21a4 4 0 0 1-4 4H10a3 3 0 0 1-3-3Z" fill="url(#g-folder-front)"/>
      <path d="M7 27a3 3 0 0 1 3-3h44a3 3 0 0 1 3 3v3H7Z" fill="#fff" opacity=".14"/>
    </svg>`,

  inventory: `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g-inv)"/>
      <rect x="6" y="6" width="52" height="26" rx="14" fill="#fff" opacity=".10"/>
      <rect x="16" y="33" width="7" height="15" rx="2.5" fill="#fff" opacity=".95"/>
      <rect x="28.5" y="25" width="7" height="23" rx="2.5" fill="#fff" opacity=".95"/>
      <rect x="41" y="18" width="7" height="30" rx="2.5" fill="#fff"/>
      <circle cx="44.5" cy="14" r="3" fill="#ffe7c2"/>
    </svg>`,

  valuation: `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g-val)"/>
      <rect x="6" y="6" width="52" height="26" rx="14" fill="#fff" opacity=".12"/>
      <path d="M30.5 16.5h9.7a3 3 0 0 1 2.12.88l6.3 6.3a3 3 0 0 1 .88 2.12v9.7a3 3 0 0 1-.88 2.12L34.8 49.4a3 3 0 0 1-4.24 0L16.6 35.44a3 3 0 0 1 0-4.24L28.38 17.4a3 3 0 0 1 2.12-.9Z" fill="#3a2a05" opacity=".22"/>
      <path d="M29.5 15.5h9.7a3 3 0 0 1 2.12.88l6.3 6.3a3 3 0 0 1 .88 2.12v9.7a3 3 0 0 1-.88 2.12L33.8 48.4a3 3 0 0 1-4.24 0L15.6 34.44a3 3 0 0 1 0-4.24L27.38 16.4a3 3 0 0 1 2.12-.9Z" fill="#fffaf0"/>
      <circle cx="39.2" cy="24.8" r="3.4" fill="#e89b16"/>
      <text x="29.5" y="40" font-family="Space Grotesk, sans-serif" font-size="17" font-weight="700" fill="#c77f0c" text-anchor="middle">$</text>
    </svg>`,

  boxes: `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g-box)"/>
      <rect x="6" y="6" width="52" height="26" rx="14" fill="#fff" opacity=".10"/>
      <rect x="24" y="15.5" width="16" height="15" rx="2.5" fill="#fff"/>
      <rect x="30.5" y="15.5" width="3" height="15" fill="#16715b" opacity=".5"/>
      <rect x="14.5" y="32.5" width="16" height="15" rx="2.5" fill="#fff" opacity=".95"/>
      <rect x="21" y="32.5" width="3" height="15" fill="#16715b" opacity=".45"/>
      <rect x="33.5" y="32.5" width="16" height="15" rx="2.5" fill="#fff" opacity=".95"/>
      <rect x="40" y="32.5" width="3" height="15" fill="#16715b" opacity=".45"/>
    </svg>`,

  kiosk: `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#g-kiosk)"/>
      <rect x="6" y="6" width="52" height="26" rx="14" fill="#fff" opacity=".12"/>
      <rect x="15" y="16" width="34" height="23" rx="3" fill="#fff"/>
      <rect x="19" y="20" width="26" height="4" rx="2" fill="#3f6fd0" opacity=".55"/>
      <rect x="19" y="27" width="17" height="3" rx="1.5" fill="#3f6fd0" opacity=".35"/>
      <rect x="19" y="32" width="22" height="3" rx="1.5" fill="#3f6fd0" opacity=".35"/>
      <rect x="29" y="39" width="6" height="5" fill="#fff" opacity=".9"/>
      <rect x="22" y="44" width="20" height="4" rx="2" fill="#fff"/>
    </svg>`,
};

/* ------------------------------------------------------------ app model -- */

// Per-item `allow` keeps Permissions-Policy minimal (no camera/mic). The
// external demo is marked so it gets a sandbox that blocks top-navigation
// (a kiosk must not be navigated away from the OS shell).
const FOLDERS = [
  {
    id: "apps",
    name: "Apps",
    icon: ICONS.folder,
    items: [
      {
        id: "product-analysis",
        name: "Product Analysis",
        icon: ICONS.inventory,
        url: "/inventory",
        allow: "fullscreen",
        width: 1180,
        height: 780,
      },
      {
        id: "inventory",
        name: "Inventory",
        icon: ICONS.boxes,
        url: "https://admin.thirsty.store",
        allow: "fullscreen",
        external: true,
        width: 1180,
        height: 780,
      },
      {
        id: "kiosk",
        name: "Kiosk",
        icon: ICONS.kiosk,
        url: "https://thirsty.store",
        allow: "fullscreen",
        external: true,
        width: 1180,
        height: 780,
      },
    ],
  },
  {
    id: "demos",
    name: "Demos",
    icon: ICONS.folder,
    items: [
      {
        id: "sample-valuation",
        name: "Sample Valuation",
        icon: ICONS.valuation,
        url:
          "https://easierbycode.com/tok-scrape/extension-creator-demo/samples-modal/",
        allow: "fullscreen",
        external: true,
        width: 1040,
        height: 720,
      },
    ],
  },
];

/* ----------------------------------------------------------- WM globals -- */

const desktop = document.getElementById("desktop");
const dock = document.getElementById("dock");
const activeAppLabel = document.getElementById("active-app");
const statusEl = document.getElementById("menubar-status");

const windows = new Map(); // winId -> window state
let zTop = 100;
let openCount = 0;
let statusTimer = 0;

const zidx = (win) => Number(win.el.style.zIndex) || 0;

function deskRect() {
  return desktop.getBoundingClientRect();
}

// Reserve the dock's footprint (matches --dock-h used by .desktop-icons) so
// maximized windows don't tuck their bottom edge under the floating dock.
function dockClearance() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--dock-h");
  return parseInt(v, 10) || 78;
}

// Smallest a window may be, never larger than the desktop itself (so a
// portrait/kiosk viewport can't force a window wider than the screen).
function minSize(d) {
  return { w: Math.min(340, d.width - 16), h: Math.min(220, d.height - 16) };
}

// Briefly surface a status message in the menubar (app-launch toast).
function flashStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.opacity = "1";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.style.opacity = "0"), 1600);
}

/* ------------------------------------------------------- desktop icons -- */

// Icons are app launchers: a single click/tap opens them (kiosk-friendly,
// and far more reliable on touch than double-tap). As <button>s they also
// activate on Enter/Space for keyboard users.
function makeIcon(label, svg, onOpen) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon";
  btn.innerHTML =
    `<span class="icon-glyph">${svg}</span><span class="icon-label">${esc(label)}</span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onOpen();
  });
  return btn;
}

function renderDesktop() {
  const root = document.getElementById("desktop-icons");
  for (const folder of FOLDERS) {
    root.appendChild(makeIcon(folder.name, folder.icon, () => openFolder(folder)));
  }
}

/* ----------------------------------------------------------- windowing -- */

// Move keyboard focus into a window's chrome (the close button), so a
// keyboard/SR user lands inside the window that just came forward.
function focusChrome(win) {
  const btn = win.el.querySelector(".light.close");
  if (btn) requestAnimationFrame(() => btn.focus());
}

function focusWindow(winId) {
  const win = windows.get(winId);
  if (!win) return;
  // Keep window z-indexes well below the dock/menubar, even after thousands
  // of focus changes in a long-lived kiosk session.
  if (zTop > 4000) normalizeZ();
  win.el.style.zIndex = String(++zTop);
  for (const other of windows.values()) {
    const active = other === win;
    other.el.classList.toggle("active", active);
    if (other.dockEl) other.dockEl.classList.toggle("focused", active);
  }
  activeAppLabel.textContent = win.title;
}

function normalizeZ() {
  const ordered = [...windows.values()].sort((a, b) => zidx(a) - zidx(b));
  zTop = 100;
  for (const w of ordered) w.el.style.zIndex = String(++zTop);
}

function frontWindow(exclude) {
  return [...windows.values()]
    .filter((w) => w !== exclude && !w.minimized)
    .sort((a, b) => zidx(a) - zidx(b))
    .pop();
}

function clampIntoView(win) {
  const d = deskRect();
  const w = win.el.offsetWidth;
  let x = win.el.offsetLeft;
  let y = win.el.offsetTop;
  x = Math.min(d.width - 60, Math.max(60 - w, x));
  y = Math.min(d.height - 44, Math.max(0, y));
  win.el.style.left = x + "px";
  win.el.style.top = y + "px";
}

function createWindow({ id, title, icon, bodyHTML, width, height, launcher }) {
  const d = deskRect();
  const min = minSize(d);
  const w = Math.max(min.w, Math.min(width, d.width - 24));
  const h = Math.max(min.h, Math.min(height, d.height - 24));

  // Cascade so stacked windows stay individually reachable.
  const step = (openCount++ % 6) * 30;
  const left = Math.max(12, Math.min((d.width - w) / 2 + step - 80, d.width - w - 12));
  const top = Math.max(12, Math.min(28 + step, d.height - h - 12));

  const el = document.createElement("section");
  el.className = "window";
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.left = Math.round(left) + "px";
  el.style.top = Math.round(top) + "px";
  el.style.zIndex = String(++zTop);
  // Non-modal labelled group (multiple windows coexist over a live desktop);
  // focusable so keyboard move/resize and focus-restore work.
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", title);
  el.setAttribute("tabindex", "-1");

  el.innerHTML = `
    <div class="titlebar">
      <div class="traffic">
        <button class="light close" type="button" aria-label="Close ${esc(title)}"><span class="glyph">×</span></button>
        <button class="light min" type="button" aria-label="Minimize ${esc(title)}"><span class="glyph">−</span></button>
        <button class="light zoom" type="button" aria-label="Zoom ${esc(title)}"><span class="glyph">+</span></button>
      </div>
      <div class="titlebar-title"><span class="ttl-glyph">${icon}</span><span class="ttl-text"></span></div>
      <div class="titlebar-spacer"></div>
    </div>
    <div class="window-body">${bodyHTML}</div>
    <div class="resize-handle" aria-hidden="true"></div>`;

  el.querySelector(".ttl-text").textContent = title;
  desktop.appendChild(el);

  const win = {
    id,
    el,
    title,
    icon,
    minimized: false,
    maximized: false,
    prevRect: null,
    dockEl: null,
    launcher: launcher || null,
    loaderTimer: 0,
    _endGesture: null,
  };
  windows.set(id, win);

  // Window chrome wiring.
  const titlebar = el.querySelector(".titlebar");
  el.querySelector(".light.close").addEventListener("click", () => closeWindow(win));
  el.querySelector(".light.min").addEventListener("click", () => setMinimized(win, true));
  el.querySelector(".light.zoom").addEventListener("click", () => toggleMax(win));
  titlebar.addEventListener("dblclick", (e) => {
    if (!e.target.closest(".light")) toggleMax(win);
  });

  el.addEventListener("pointerdown", () => focusWindow(id), true);
  el.addEventListener("keydown", (e) => keyMoveResize(win, e));
  enableDrag(win, titlebar);
  enableResize(win, el.querySelector(".resize-handle"));
  addDockItem(win);

  // Animate in, raise, and hand keyboard focus to the new window.
  requestAnimationFrame(() => el.classList.add("open"));
  focusWindow(id);
  focusChrome(win);
  return win;
}

function closeWindow(win) {
  if (win._endGesture) win._endGesture(); // self-heal an in-flight drag/resize
  if (win.loaderTimer) clearTimeout(win.loaderTimer);
  win.el.classList.remove("open");
  if (win.dockEl) win.dockEl.remove();
  windows.delete(win.id);
  setTimeout(() => win.el.remove(), 170);

  // Hand focus to the next window, or back to the icon that launched this one.
  const next = frontWindow(win);
  if (next) {
    focusWindow(next.id);
    focusChrome(next);
  } else {
    activeAppLabel.textContent = "Finder";
    if (win.launcher && document.contains(win.launcher) && win.launcher.focus) {
      win.launcher.focus();
    }
  }
}

function setMinimized(win, min) {
  if (min) {
    win.minimized = true;
    win.el.classList.add("minimizing");
    if (win.dockEl) win.dockEl.classList.add("minimized");
    win.el.addEventListener("transitionend", function hide() {
      if (win.minimized) win.el.style.display = "none";
      win.el.removeEventListener("transitionend", hide);
    });
    const next = frontWindow(win);
    if (next) {
      focusWindow(next.id);
      focusChrome(next);
    } else {
      activeAppLabel.textContent = "Finder";
      if (win.dockEl) win.dockEl.focus(); // keep focus on the now-docked app
    }
  } else {
    win.minimized = false;
    win.el.style.display = "";
    if (win.dockEl) win.dockEl.classList.remove("minimized");
    void win.el.offsetWidth; // reflow so the transition replays
    win.el.classList.remove("minimizing");
    focusWindow(win.id);
    focusChrome(win);
  }
}

function toggleMax(win) {
  const d = deskRect();
  if (win.maximized) {
    const r = win.prevRect;
    Object.assign(win.el.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    win.el.classList.remove("maximized");
    win.maximized = false;
    clampIntoView(win); // a stale prevRect can't strand the window off-screen
  } else {
    win.prevRect = {
      left: win.el.offsetLeft,
      top: win.el.offsetTop,
      width: win.el.offsetWidth,
      height: win.el.offsetHeight,
    };
    Object.assign(win.el.style, {
      left: "0px",
      top: "0px",
      width: d.width + "px",
      height: d.height - dockClearance() + "px",
    });
    win.el.classList.add("maximized");
    win.maximized = true;
  }
  focusWindow(win.id);
}

// Keyboard move (Arrow) / resize (Shift+Arrow) for the focused window.
function keyMoveResize(win, e) {
  if (win.maximized || !e.key.startsWith("Arrow")) return;
  e.preventDefault();
  const d = deskRect();
  const STEP = 24;
  const dx = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
  const dy = e.key === "ArrowUp" ? -STEP : e.key === "ArrowDown" ? STEP : 0;
  if (e.shiftKey) {
    const min = minSize(d);
    const maxW = d.width - win.el.offsetLeft - 6;
    const maxH = d.height - win.el.offsetTop - 6;
    win.el.style.width = Math.min(maxW, Math.max(min.w, win.el.offsetWidth + dx)) + "px";
    win.el.style.height = Math.min(maxH, Math.max(min.h, win.el.offsetHeight + dy)) + "px";
  } else {
    const w = win.el.offsetWidth;
    let x = win.el.offsetLeft + dx;
    let y = win.el.offsetTop + dy;
    x = Math.min(d.width - 60, Math.max(60 - w, x));
    y = Math.min(d.height - 44, Math.max(0, y));
    win.el.style.left = x + "px";
    win.el.style.top = y + "px";
  }
}

/* --------------------------------------------------------- drag/resize -- */

// Pointer capture can throw if the pointer is already gone (or the id is
// synthetic); never let that abort a gesture.
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch { /* ignore */ }
}
function release(el, pointerId) {
  try {
    el.releasePointerCapture(pointerId);
  } catch { /* ignore */ }
}

function enableDrag(win, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".light") || e.button !== 0) return;
    if (win.maximized) toggleMax(win); // un-maximize and grab
    focusWindow(win.id);

    const r = win.el.getBoundingClientRect();
    const offX = e.clientX - r.left;
    const offY = e.clientY - r.top;
    capture(handle, e.pointerId);
    handle.classList.add("grabbing");
    document.body.classList.add("wm-busy");

    const move = (ev) => {
      const d = deskRect();
      let x = ev.clientX - d.left - offX;
      let y = ev.clientY - d.top - offY;
      const w = win.el.offsetWidth;
      x = Math.min(d.width - 60, Math.max(60 - w, x));
      y = Math.min(d.height - 44, Math.max(0, y));
      win.el.style.left = x + "px";
      win.el.style.top = y + "px";
    };
    // Listeners live on globalThis (not `handle`) so a window closed mid-drag
    // still gets its teardown — no leaked listeners, no stuck wm-busy cursor.
    const end = (ev) => {
      release(handle, ev ? ev.pointerId : e.pointerId);
      handle.classList.remove("grabbing");
      document.body.classList.remove("wm-busy");
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", end);
      globalThis.removeEventListener("pointercancel", end);
      win._endGesture = null;
    };
    win._endGesture = end;
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", end);
    globalThis.addEventListener("pointercancel", end);
  });
}

function enableResize(win, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (win.maximized) return;
    focusWindow(win.id);

    const startW = win.el.offsetWidth;
    const startH = win.el.offsetHeight;
    const startX = e.clientX;
    const startY = e.clientY;
    capture(handle, e.pointerId);
    document.body.classList.add("wm-busy");

    const move = (ev) => {
      const d = deskRect();
      const min = minSize(d);
      const maxW = d.width - win.el.offsetLeft - 6;
      const maxH = d.height - win.el.offsetTop - 6;
      win.el.style.width = Math.min(maxW, Math.max(min.w, startW + (ev.clientX - startX))) + "px";
      win.el.style.height = Math.min(maxH, Math.max(min.h, startH + (ev.clientY - startY))) + "px";
    };
    const end = (ev) => {
      release(handle, ev ? ev.pointerId : e.pointerId);
      document.body.classList.remove("wm-busy");
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", end);
      globalThis.removeEventListener("pointercancel", end);
      win._endGesture = null;
    };
    win._endGesture = end;
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", end);
    globalThis.addEventListener("pointercancel", end);
  });
}

/* --------------------------------------------------------------- dock -- */

function addDockItem(win) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "dock-item running";
  item.innerHTML =
    `${win.icon}<span class="dock-dot"></span><span class="dock-tip">${esc(win.title)}</span>`;
  item.setAttribute("aria-label", win.title);
  item.addEventListener("click", () => {
    if (win.minimized) {
      setMinimized(win, false);
    } else if (zidx(win) === zTop) {
      setMinimized(win, true); // already front → minimize
    } else {
      focusWindow(win.id);
      focusChrome(win);
    }
  });
  dock.appendChild(item);
  win.dockEl = item;
}

/* ------------------------------------------------------- open windows -- */

function openApp(item) {
  const id = "app:" + item.id;
  const existing = windows.get(id);
  if (existing) {
    if (existing.minimized) setMinimized(existing, false);
    else {
      focusWindow(id);
      focusChrome(existing);
    }
    return;
  }
  const launcher = document.activeElement;
  const win = createWindow({
    id,
    title: item.name,
    icon: item.icon,
    bodyHTML: `<div class="window-loader"><div class="spinner"></div><span></span></div>`,
    width: item.width || 1024,
    height: item.height || 720,
    launcher,
  });
  win.el.querySelector(".window-loader span").textContent = `Opening ${item.name}…`;

  // Build the iframe with the DOM API (setAttribute never parses HTML) and an
  // https/same-origin URL allowlist, so a stray javascript:/data: url can't slip in.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", item.name);
  iframe.setAttribute("allow", item.allow || "fullscreen");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  if (item.external) {
    // Let the third-party demo run + keep its own origin, but block it from
    // navigating the top-level kiosk away from the OS shell.
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  }
  if (/^https:\/\//i.test(item.url) || item.url.startsWith("/")) {
    iframe.setAttribute("src", item.url);
  }

  const loader = win.el.querySelector(".window-loader");
  const hide = () => loader && loader.classList.add("hidden");
  iframe.addEventListener("load", hide);
  win.loaderTimer = setTimeout(hide, 8000); // safety net for cross-origin loads
  win.el.querySelector(".window-body").appendChild(iframe);

  flashStatus(`Opening ${item.name}`);
}

function openFolder(folder) {
  const id = "folder:" + folder.id;
  const existing = windows.get(id);
  if (existing) {
    if (existing.minimized) setMinimized(existing, false);
    else {
      focusWindow(id);
      focusChrome(existing);
    }
    return;
  }
  const launcher = document.activeElement;
  const bodyHTML = `<div class="folder-grid">${
    folder.items.length ? "" : `<p class="folder-empty">This folder is empty.</p>`
  }</div>`;

  const win = createWindow({
    id,
    title: folder.name,
    icon: folder.icon,
    bodyHTML,
    width: 520,
    height: 360,
    launcher,
  });

  const grid = win.el.querySelector(".folder-grid");
  for (const item of folder.items) {
    grid.appendChild(makeIcon(item.name, item.icon, () => openApp(item)));
  }
  flashStatus(folder.name);
}

/* ------------------------------------------------------- chrome / boot -- */

function tickClock() {
  const clock = document.getElementById("clock");
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  clock.textContent = `${date}   ${time}`;
}

// Keep maximized windows fitted and stray windows fully in view (position AND
// size) when the viewport changes — a window can never end up bigger than,
// or pushed off, a shrunken desktop.
let resizeRAF = 0;
globalThis.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    const d = deskRect();
    const min = minSize(d);
    const dockH = dockClearance();
    for (const win of windows.values()) {
      if (win.maximized) {
        win.el.style.width = d.width + "px";
        win.el.style.height = d.height - dockH + "px";
      } else if (!win.minimized) {
        win.el.style.width = Math.max(min.w, Math.min(win.el.offsetWidth, d.width - 16)) + "px";
        win.el.style.height = Math.max(min.h, Math.min(win.el.offsetHeight, d.height - 16)) + "px";
        clampIntoView(win);
      }
    }
  });
});

// Esc minimizes the focused window (state-preserving) — only when focus is
// actually inside that window, so it never fires from the dock/desktop or
// destroys in-progress iframe state.
globalThis.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const front = frontWindow(null);
  if (front && front.el.contains(document.activeElement)) setMinimized(front, true);
});

document.body.insertAdjacentHTML("afterbegin", ICON_GRADIENTS);
renderDesktop();
tickClock();
setInterval(tickClock, 15000);
