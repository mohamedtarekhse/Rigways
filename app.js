/**
 * ================================================================
 *  SAP S/4HANA – Asset & Certificate Management System
 *  app.js  –  Shared Application Core  v1.0
 * ================================================================
 *  Modules:
 *    1. CONFIG          – App-wide constants & role definitions
 *    2. SESSION         – Login, logout, guard, persistence
 *    3. LANGUAGE        – EN/AR switching, RTL, i18n helpers
 *    4. SIDEBAR         – Collapse, active-link, responsive
 *    5. SHELL           – Header avatar, user menu, clock
 *    6. TOAST           – Notification toasts
 *    7. MODAL           – Open/close helpers
 *    8. TABLE UTILS     – Sort, paginate, search helpers
 *    9. FORM UTILS      – Validation, field helpers
 *   10. DATE UTILS      – Expiry calc, format helpers
 *   11. EXPORT UTILS    – CSV builder, print
 *   12. ROLE GUARDS     – UI show/hide per role
 *   13. EVENT BUS       – Simple pub/sub for cross-module comms
 *   14. INIT            – Auto-bootstrap on DOMContentLoaded
 * ================================================================
 */

/* ================================================================
   1. CONFIG
================================================================ */
const SAP_CONFIG = {
  APP_NAME:    'SAP S/4HANA ACM',
  APP_VERSION: '1.0.0',
  SUPPORTED_LANGS: ['en'],
  DEFAULT_LANG:    'en',
  PAGE_SIZE:       15,
  SESSION_KEY:     'sap_session',
  LANG_KEY:        'sap_lang',
  CONFIG_KEY:      'sap_notif_config',
  SIDEBAR_KEY:     'sap_sidebar_collapsed',

  /* Role hierarchy (higher index = more permissions) */
  ROLES: {
    user:       { label:'Regular User',  labelAr:'مستخدم',        level:1, canEdit:false,  canDelete:false, canApprove:false, canUpload:false,  seeClients:false },
    technician: { label:'Technician',    labelAr:'فني',           level:2, canEdit:false,  canDelete:false, canApprove:false, canUpload:true,   seeClients:false },
    manager:    { label:'Manager',       labelAr:'مدير',          level:3, canEdit:true,   canDelete:false, canApprove:true,  canUpload:false,  seeClients:false },
    admin:      { label:'Administrator', labelAr:'مسؤول النظام', level:4, canEdit:true,   canDelete:true,  canApprove:true,  canUpload:true,   seeClients:true  },
  },

  /* Demo users — replace with real API in backend phase */
  /* Client map */
  CLIENTS: {
    C001: { name:'Acme Corp',        nameAr:'شركة أكمي',          color:'#0070f2' },
    C002: { name:'Gulf Holdings',    nameAr:'مجموعة الخليج',      color:'#188918' },
    C003: { name:'Delta Industries', nameAr:'دلتا للصناعات',      color:'#e76500' },
    C004: { name:'Nile Ventures',    nameAr:'مشاريع النيل',       color:'#bb0000' },
  },

  /* Navigation items (ordered) - Technicians and Users can only see Assets and Certificates */
  NAV: [
    { id:'dashboard',     href:'dashboard.html',     iconKey:'grid',   en:'Admin Dashboard',ar:'لوحة المشرف',  roles:['admin'], landing:true },
    { id:'assets',        href:'assets.html',        iconKey:'asset',  en:'Assets',        ar:'الأصول',       roles:['admin','manager','technician','user'], landing:true },
    { id:'certificates',  href:'certificates.html',  iconKey:'cert',   en:'Certificates',  ar:'الشهادات',     roles:['admin','manager','technician','user'] },
    { id:'jobs',          href:'jobs.html',          iconKey:'chart',  en:'Jobs',          ar:'الوظائف',      roles:['admin','manager'] },
    { id:'clients',       href:'clients.html',       iconKey:'users',  en:'Clients',       ar:'العملاء',      roles:['admin'] },
    { id:'inspectors',    href:'inspectors.html',    iconKey:'inspector', en:'Inspectors',    ar:'المفتشين',     roles:['admin','manager'] },
    { id:'locations',     href:'functional-locations.html', iconKey:'loc', en:'Func. Locations', ar:'المواقع', roles:['admin'] },
    { id:'files',         href:'files.html',         iconKey:'asset',  en:'Files',         ar:'الملفات',      roles:['admin'] },
    { id:'notifications', href:'notifications.html', iconKey:'notif',  en:'Notifications', ar:'الإشعارات',    roles:['admin','manager'] },
  ],
};

/* ================================================================
   API FETCH HELPER
   Auto-attaches Bearer token to every request.
   Use on all pages: apiFetch('/api/assets').then(r => r.json())
================================================================ */
function apiFetch(path, options = {}) {
  let token = '';
  try {
    const s = sessionStorage.getItem('sap_session');
    if (s) token = JSON.parse(s).token || '';
  } catch(e) {}
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    },
  });
}



const SapClients = (() => {
  const CACHE_KEY = 'sap_clients_name_map';
  let memo = null;

  function _readCache() {
    if (memo) return memo;
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      memo = raw ? JSON.parse(raw) : {};
    } catch (e) {
      memo = {};
    }
    return memo;
  }

  function _writeCache(map) {
    memo = map || {};
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(memo)); } catch (e) {}
  }

  async function warm() {
    const current = _readCache();
    if (Object.keys(current).length) return current;
    try {
      const res = await apiFetch('/api/clients?limit=1000');
      const raw = await res.json();
      const list = raw?.data?.clients || raw?.data || raw?.clients || [];
      const map = {};
      (Array.isArray(list) ? list : []).forEach(c => {
        const id = String(c.client_id || c.id || '').trim();
        const name = String(c.name || c.client_name || '').trim();
        if (id && name) map[id.toUpperCase()] = name;
      });
      if (Object.keys(map).length) _writeCache(map);
      return _readCache();
    } catch (e) {
      return current;
    }
  }

  function display(id) {
    const key = String(id || '').trim().toUpperCase();
    return _readCache()[key] || String(id || '').trim();
  }

  function hydrateUi(root = document) {
    const map = _readCache();
    if (!Object.keys(map).length) return;

    const headerIndexes = new WeakMap();
    root.querySelectorAll('table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim().toLowerCase());
      const idx = headers.map((h,i)=> /client/.test(h) ? i : -1).filter(i => i >= 0);
      if (idx.length) headerIndexes.set(table, new Set(idx));
    });

    root.querySelectorAll('tbody tr').forEach(tr => {
      const table = tr.closest('table');
      const idxSet = table ? headerIndexes.get(table) : null;
      if (!idxSet) return;
      [...tr.children].forEach((td, i) => {
        if (!idxSet.has(i)) return;
        const raw = (td.textContent || '').trim();
        const key = raw.toUpperCase();
        if (map[key] && !td.querySelector('*')) td.textContent = map[key];
      });
    });

    root.querySelectorAll('option').forEach(opt => {
      const v = String(opt.value || '').trim().toUpperCase();
      if (!map[v]) return;
      const text = (opt.textContent || '').trim();
      if (text === opt.value || text === v) opt.textContent = map[v];
    });
  }

  return { warm, display, hydrateUi };
})();
if (typeof window !== 'undefined') window.SapClients = SapClients;

/* ================================================================
   DRAFT STORAGE (sessionStorage)
================================================================ */
const SapDraft = (() => {
  const PREFIX = 'sap_draft:';
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  function _fullKey(key) { return PREFIX + key; }

  function save(key, payload) {
    try {
      sessionStorage.setItem(_fullKey(key), JSON.stringify({
        ts: Date.now(),
        payload: payload || {},
      }));
    } catch (e) {}
  }

  function load(key, ttlMs = DEFAULT_TTL_MS) {
    try {
      const raw = sessionStorage.getItem(_fullKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts || (Date.now() - parsed.ts) > ttlMs) {
        clear(key);
        return null;
      }
      return parsed.payload || null;
    } catch (e) {
      clear(key);
      return null;
    }
  }

  function clear(key) {
    try { sessionStorage.removeItem(_fullKey(key)); } catch (e) {}
  }

  return { save, load, clear, DEFAULT_TTL_MS };
})();
if (typeof window !== 'undefined') window.SapDraft = SapDraft;

/* ================================================================
   2. SESSION MANAGER
================================================================ */
const SapSession = (() => {
  let _session = null;

  function get() {
    if (_session) return _session;
    try {
      const raw = sessionStorage.getItem(SAP_CONFIG.SESSION_KEY);
      _session = raw ? JSON.parse(raw) : null;
    } catch(e) { _session = null; }
    return _session;
  }

  function set(data) {
    _session = data;
    sessionStorage.setItem(SAP_CONFIG.SESSION_KEY, JSON.stringify(data));
  }

  function clear() {
    _session = null;
    sessionStorage.removeItem(SAP_CONFIG.SESSION_KEY);
  }

  /**
   * Guard: if no session, redirect to login.
   * @param {string[]} [allowedRoles] - if provided, also check role
   * @returns {object|null} session or null
   */
  function guard(allowedRoles) {
    const s = get();
    if (!s) {
      window.location.href = '/';
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(s.role)) {
      SapToast.show('error',
        SapLang.t('Access Denied', 'غير مصرح'),
        SapLang.t('You do not have permission to view this page.', 'ليس لديك صلاحية للوصول إلى هذه الصفحة.'));
      const home = SapNavigation.getLandingPage(s.role);
      setTimeout(() => { window.location.href = home; }, 1500);
      return null;
    }
    return s;
  }


  function logout() {
    const s = get();
    SapEventBus.emit('session:logout', s);
    try {
      const token = s?.token || '';
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      }).catch(() => {});
    } catch(e) {}
    clear();
    window.location.href = '/';
  }

  function role()       { const s = get(); return s?.role || 'user'; }
  function isAdmin()    { return role() === 'admin'; }
  function isManager()  { return role() === 'manager'; }
  function isTech()     { return role() === 'technician'; }
  function isUser()     { return role() === 'user'; }
  function canDo(perm)  { return SAP_CONFIG.ROLES[role()]?.[perm] || false; }
  function customerId() { return get()?.customerId || null; }
  function functionalLocation() { return get()?.functional_location || null; }

  return { get, set, guard, logout, role, isAdmin, isManager, isTech, isUser, canDo, customerId, functionalLocation };
})();

/* ================================================================
   3. LANGUAGE MANAGER
================================================================ */
const SapLang = (() => {
  let _lang = SAP_CONFIG.DEFAULT_LANG;

  function current() { return _lang; }
  function isAr()    { return false; }

  /**
   * Apply language: update DOM attributes, dir, font, placeholders.
   */
  function apply(lang, skipRender) {
    _lang = SAP_CONFIG.DEFAULT_LANG;
    localStorage.setItem(SAP_CONFIG.LANG_KEY, SAP_CONFIG.DEFAULT_LANG);

    const html = document.documentElement;
    html.lang  = SAP_CONFIG.DEFAULT_LANG;
    html.dir   = 'ltr';
    document.body.classList.remove('lang-ar');

    /* Text nodes */
    document.querySelectorAll('[data-en]').forEach(el => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      const val = el.getAttribute('data-en');
      if (val !== null) el.textContent = val;
    });

    /* Placeholders */
    document.querySelectorAll('[data-ph-en]').forEach(el => {
      el.placeholder = el.getAttribute('data-ph-en');
    });

    /* Select options */
    document.querySelectorAll('option[data-en]').forEach(opt => {
      opt.textContent = opt.getAttribute('data-en');
    });

    /* Lang button */
    const btn = document.getElementById('langBtn');
    if (btn) btn.style.display = 'none';

    if (!skipRender) SapEventBus.emit('lang:changed', SAP_CONFIG.DEFAULT_LANG);
  }

  function toggle() { apply(SAP_CONFIG.DEFAULT_LANG); }

  /**
   * Quick translation helper: English only (Arabic removed)
   */
  function t(en, ar) { return en; }

  /**
   * Pluralize helper
   */
  function plural(n, en, ar) { return `${n} ${en}`; }

  return { current, isAr, apply, toggle, t, plural };
})();

/* ================================================================
   4. SIDEBAR MANAGER
================================================================ */
const SapSidebar = (() => {
  let _collapsed = localStorage.getItem(SAP_CONFIG.SIDEBAR_KEY) === '1';

  function init() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (_collapsed) _applyCollapsed(true);
    _markActive();
  }

  function toggle() {
    _collapsed = !_collapsed;
    localStorage.setItem(SAP_CONFIG.SIDEBAR_KEY, _collapsed ? '1' : '0');
    _applyCollapsed(_collapsed);
  }

  function _applyCollapsed(state) {
    const sidebar   = document.getElementById('sidebar');
    const body      = document.body;
    const icon      = document.getElementById('collapseIcon');
    if (!sidebar) return;

    sidebar.classList.toggle('collapsed', state);
    body.classList.toggle('sidebar-collapsed', state);

    if (icon) {
      icon.innerHTML = state
        ? '<polyline points="9 18 15 12 9 6"/>'
        : '<polyline points="15 18 9 12 15 6"/>';
    }
  }

  /**
   * Build the sidebar nav dynamically for the current role.
   */
  function buildNav(role) {
    SapNavigation.sync();
  }

  return { init, toggle, buildNav };
})();

/* ================================================================
   4b. NAVIGATION SYNC
================================================================ */
const SapNavigation = (() => {
  function getLandingPage(role) {
    // Admin goes to dashboard, others to assets
    const landing = SAP_CONFIG.NAV.find(n => n.landing && n.roles.includes(role));
    if (role === 'admin') {
       const dash = SAP_CONFIG.NAV.find(n => n.id === 'dashboard');
       if (dash) return dash.href;
    }
    return landing ? landing.href : 'assets.html';
  }

  function sync() {
    const s = SapSession.get();
    if (!s) return;
    const role = s.role;
    
    // Support both ID-based and class-based nav containers
    const containers = [
      document.getElementById('sidebarNav'),
      document.getElementById('navbar'),
      document.querySelector('.sap-navbar__inner')
    ].filter(Boolean);

    if (containers.length === 0) return;

    const ICONS = {
      grid:  '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
      asset: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
      cert:  '<path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>',
      notif: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
      chart: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
      users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
      inspector: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M9 12l2 2 4-4"/>',
      loc: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>'
    };

    const curPage = window.location.pathname.split('/').pop() || 'index.html';
    
    const html = SAP_CONFIG.NAV
      .filter(item => item.roles.includes(role))
      .map(item => {
        const active = item.href === curPage;
        const icon = ICONS[item.iconKey] || ICONS.grid;
        return `<a href="${item.href}" class="sap-nav-item${active?' active':''}" id="nav_${item.id}">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${icon}</svg>
          <span>${item.en}</span>
        </a>`;
      }).join('');

    containers.forEach(c => {
      c.innerHTML = html;
    });
  }

  return { getLandingPage, sync };
})();

  return { init, toggle, buildNav };
})();

/* ================================================================
   5. SHELL MANAGER
================================================================ */
const SapShell = (() => {
  let _clockInterval = null;

  function init(session) {
    if (!session) return;
    _ensureMobileMenuButton();
    _setAvatar(session);
    _setUserMenu(session);
    _bindUserMenu();
  }

  function _ensureMobileMenuButton() {
    const actions = document.querySelector('.sap-shell__actions');
    if (!actions || document.getElementById('mobileMenuBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'mobileMenuBtn';
    btn.className = 'sap-shell__btn sap-mobile-menu-btn';
    btn.setAttribute('aria-label', 'Open user menu');
    btn.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    btn.onclick = () => {
      if (typeof window.toggleUserMenu === 'function') window.toggleUserMenu();
      else toggleUserMenu();
    };
    actions.appendChild(btn);
  }

  function _setAvatar(session) {
    const el = document.getElementById('shellAvatar');
    if (!el) return;
    const initials = session.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    el.textContent = initials;
  }

  function _setUserMenu(session) {
    const nameEl = document.getElementById('menuUserName');
    const roleEl = document.getElementById('menuUserRole');
    if (nameEl) nameEl.textContent = SapLang.isAr() ? session.nameAr : session.name;
    if (roleEl) roleEl.textContent = SAP_CONFIG.ROLES[session.role]?.label || session.role;
  }

  function _bindUserMenu() {
    document.addEventListener('click', e => {
      if (!e.target.closest('#shellAvatar') && !e.target.closest('#mobileMenuBtn') && !e.target.closest('#userMenu')) {
        const menu = document.getElementById('userMenu');
        if (menu) menu.classList.remove('open');
      }
    });
  }

  function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    if (menu) menu.classList.toggle('open');
  }

  /** Live clock for dashboard/banner */
  function startClock(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const tick = () => {
      const now = new Date();
      const hh  = String(now.getHours()).padStart(2,'0');
      const mm  = String(now.getMinutes()).padStart(2,'0');
      const ss  = String(now.getSeconds()).padStart(2,'0');
      el.textContent = `${hh}:${mm}:${ss}`;
    };
    tick();
    _clockInterval = setInterval(tick, 1000);
  }

  function stopClock() {
    if (_clockInterval) clearInterval(_clockInterval);
  }

  /**
   * Set notification badge visibility
   */
  function setNotifBadge(show) {
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = show ? 'block' : 'none';
  }

  return { init, toggleUserMenu, startClock, stopClock, setNotifBadge };
})();

/* ================================================================
   6. TOAST MANAGER
================================================================ */
const SapToast = (() => {
  const ICONS = {
    success: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  };

  function show(type, title, message, duration = 4500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'sap-toast-container';
      container.id = 'toastContainer';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `sap-toast sap-toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `
      <div class="sap-toast__icon">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${ICONS[type] || ICONS.info}</svg>
      </div>
      <div class="sap-toast__body">
        <div class="sap-toast__title">${_esc(title)}</div>
        <div class="sap-toast__msg">${_esc(message)}</div>
      </div>
      <button class="sap-toast__close" aria-label="Dismiss notification" onclick="this.parentElement.remove()">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;

    container.appendChild(toast);
    if (duration > 0) setTimeout(() => { if (toast.parentElement) toast.remove(); }, duration);
    return toast;
  }

  function _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function success(title, msg, d) { return show('success', title, msg, d); }
  function error(title, msg, d)   { return show('error',   title, msg, d); }
  function warning(title, msg, d) { return show('warning', title, msg, d); }
  function info(title, msg, d)    { return show('info',    title, msg, d); }

  return { show, success, error, warning, info };
})();

/* ================================================================
   6.1 UNDO MANAGER (deferred actions)
================================================================ */
const SapUndo = (() => {
  const DEFAULT_MS = 10000;

  function schedule(opts = {}) {
    const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : DEFAULT_MS;
    const title = opts.title || 'Delete scheduled';
    const message = opts.message || `Item will be deleted in ${Math.round(windowMs / 1000)} seconds.`;
    const undoLabel = opts.undoLabel || 'Undo';
    const onCommit = typeof opts.onCommit === 'function' ? opts.onCommit : async () => {};
    const onUndo = typeof opts.onUndo === 'function' ? opts.onUndo : () => {};
    const onError = typeof opts.onError === 'function' ? opts.onError : (err) => {
      SapToast.error('Delete Failed', err?.message || 'Could not complete delete.');
    };

    const toast = SapToast.show('warning', title, message, 0);
    const body = toast.querySelector('.sap-toast__body');
    if (body) {
      const actions = document.createElement('div');
      actions.className = 'sap-toast__actions';
      const btn = document.createElement('button');
      btn.className = 'sap-toast__action';
      btn.type = 'button';
      btn.textContent = undoLabel;
      btn.setAttribute('aria-label', `${undoLabel} delete action`);
      actions.appendChild(btn);
      body.appendChild(actions);

      let finalized = false;
      const timer = setTimeout(async () => {
        if (finalized) return;
        finalized = true;
        if (toast.parentElement) toast.remove();
        try {
          await onCommit();
        } catch (err) {
          onError(err);
        }
      }, windowMs);

      btn.addEventListener('click', () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timer);
        if (toast.parentElement) toast.remove();
        try { onUndo(); } catch (e) {}
      });
    }

    return toast;
  }

  return { schedule, DEFAULT_MS };
})();

/* ================================================================
   7. MODAL MANAGER
================================================================ */
const SapModal = (() => {
  const _focusMemory = new Map();

  function _focusFirstInModal(el) {
    if (!el) return;
    const target = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (target && typeof target.focus === 'function') target.focus();
  }

  function open(id) {
    const el = document.getElementById(id);
    if (el) {
      _focusMemory.set(id, document.activeElement || null);
      el.classList.add('open');
      _focusFirstInModal(el);
    }
    document.body.style.overflow = 'hidden';
  }

  function close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    const prev = _focusMemory.get(id);
    if (prev && typeof prev.focus === 'function') prev.focus();
    _focusMemory.delete(id);
    document.body.style.overflow = '';
  }

  function closeAll() {
    document.querySelectorAll('.sap-modal-overlay.open').forEach(m => {
      m.classList.remove('open');
    });
    document.body.style.overflow = '';
  }

  /* Close modal on overlay click */
  function enableOverlayClose(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      if (e.target === el) close(id);
    });
  }

  return { open, close, closeAll, enableOverlayClose };
})();

/* ================================================================
   8. TABLE UTILITIES
================================================================ */
const SapTable = (() => {

  /**
   * Sort an array of objects by a given key.
   * @param {object[]} data
   * @param {string}   key
   * @param {1|-1}     dir  1=asc, -1=desc
   */
  function sort(data, key, dir = 1) {
    return [...data].sort((a, b) => {
      const av = (a[key] ?? '').toString().toLowerCase();
      const bv = (b[key] ?? '').toString().toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  /**
   * Paginate an array.
   * @param {object[]} data
   * @param {number}   page   1-indexed
   * @param {number}   size
   * @returns {{ page: object[], total: number, totalPages: number, start: number, end: number }}
   */
  function paginate(data, page = 1, size = SAP_CONFIG.PAGE_SIZE) {
    const total      = data.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const safePage   = Math.min(Math.max(1, page), totalPages);
    const start      = (safePage - 1) * size;
    const end        = Math.min(start + size, total);
    return { page: data.slice(start, end), total, totalPages, start, end, safePage };
  }

  /**
   * Build pagination HTML and inject it into a container.
   * @param {string}   containerId
   * @param {number}   currentPage
   * @param {number}   totalPages
   * @param {Function} onPageChange  (page: number) => void
   */
  function renderPagination(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = `<button class="sap-page-btn" onclick="(${onPageChange.toString()})(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;

    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > 7 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
        if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px;color:var(--sap-text-secondary);">…</span>`;
        continue;
      }
      html += `<button class="sap-page-btn${i === currentPage ? ' active' : ''}" onclick="(${onPageChange.toString()})(${i})">${i}</button>`;
    }
    html += `<button class="sap-page-btn" onclick="(${onPageChange.toString()})(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>`;
    container.innerHTML = html;
  }

  /**
   * Filter data with a plain-text search across multiple keys.
   */
  function search(data, query, keys) {
    if (!query) return data;
    const q = query.toLowerCase().trim();
    return data.filter(row =>
      keys.some(k => (row[k] ?? '').toString().toLowerCase().includes(q))
    );
  }

  /**
   * Render a table empty-state block.
   */
  function showEmpty(tbodyId, colSpan = 8, msg) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const text = msg || SapLang.t('No records found.', 'لا توجد سجلات.');
    tbody.innerHTML = `<tr><td colspan="${colSpan}">
      <div class="sap-table__empty" style="padding:40px;">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
        <p>${text}</p>
      </div>
    </td></tr>`;
  }

  return { sort, paginate, renderPagination, search, showEmpty };
})();

/* ================================================================
   8.1 DENSITY MANAGER
================================================================ */
const SapDensity = (() => {
  const KEY = 'sap_density';
  const DEFAULT = 'compact';

  function apply(mode) {
    const next = mode === 'comfortable' ? 'comfortable' : 'compact';
    document.body.classList.remove('density-compact', 'density-ultra');
    if (next === 'compact') document.body.classList.add('density-compact');
    localStorage.setItem(KEY, next);
    _syncButtons(next);
  }

  function current() {
    return localStorage.getItem(KEY) || DEFAULT;
  }

  function init() {
    apply(current());
    _mountToggle();
  }

  function _syncButtons(mode) {
    document.querySelectorAll('.density-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function _mountToggle() {
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) return;
    if (document.getElementById('densityToggle')) return;
    const host = document.createElement('div');
    host.id = 'densityToggle';
    host.className = 'density-toggle';
    host.setAttribute('data-label', 'Density');
    host.innerHTML = `
      <button type="button" class="density-btn" data-mode="comfortable" title="Comfortable">C</button>
      <button type="button" class="density-btn" data-mode="compact" title="Compact">K</button>`;
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('.density-btn');
      if (!btn) return;
      apply(btn.dataset.mode);
    });
    const toolbar = document.querySelector('.sap-toolbar');
    if (toolbar) toolbar.appendChild(host);
    else {
      host.style.position = 'fixed';
      host.style.right = '16px';
      host.style.bottom = '16px';
      host.style.zIndex = '1000';
      document.body.appendChild(host);
    }
    _syncButtons(current());
  }

  return { init, apply, current };
})();

/* ================================================================
   9. FORM UTILITIES
================================================================ */
const SapForm = (() => {

  /**
   * Validate required fields in a form.
   * @param {HTMLFormElement|string} form  – element or ID
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validate(form) {
    const el = typeof form === 'string' ? document.getElementById(form) : form;
    if (!el) return { valid:false, errors:['Form not found'] };

    const errors = [];
    el.querySelectorAll('[required]').forEach(field => {
      const val = field.value.trim();
      if (!val) {
        field.classList.add('error');
        const label = el.querySelector(`label[for="${field.id}"]`);
        errors.push(label ? label.textContent.replace('*','').trim() : field.id);
      } else {
        field.classList.remove('error');
      }
    });
    return { valid: errors.length === 0, errors };
  }

  /** Clear all error states in a form */
  function clearErrors(form) {
    const el = typeof form === 'string' ? document.getElementById(form) : form;
    if (!el) return;
    el.querySelectorAll('.error').forEach(f => f.classList.remove('error'));
  }

  /** Serialize a form to a plain object */
  function serialize(form) {
    const el = typeof form === 'string' ? document.getElementById(form) : form;
    if (!el) return {};
    const data = {};
    new FormData(el).forEach((val, key) => { data[key] = val; });
    return data;
  }

  /** Fill a form from an object */
  function fill(form, data) {
    const el = typeof form === 'string' ? document.getElementById(form) : form;
    if (!el) return;
    Object.entries(data).forEach(([key, val]) => {
      const field = el.querySelector(`#${key}, [name="${key}"]`);
      if (field) field.value = val ?? '';
    });
  }

  return { validate, clearErrors, serialize, fill };
})();

/* ================================================================
   10. DATE UTILITIES
================================================================ */
const SapDate = (() => {

  /** Days between today and a date string */
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today  = new Date(); today.setHours(0,0,0,0);
    const target = new Date(dateStr); target.setHours(0,0,0,0);
    return Math.ceil((target - today) / 86400000);
  }

  /** Cert expiry status string */
  function expiryStatus(dateStr, approvalStatus) {
    if (approvalStatus === 'pending')  return 'pending';
    if (approvalStatus === 'rejected') return 'rejected';
    const days = daysUntil(dateStr);
    if (days === null) return 'unknown';
    if (days < 0)   return 'expired';
    if (days <= 30) return 'expiring';
    return 'valid';
  }

  /** Priority string based on days left */
  function expiryPriority(days) {
    if (days === null)  return 'info';
    if (days < 0)       return 'critical';
    if (days <= 7)      return 'critical';
    if (days <= 14)     return 'high';
    if (days <= 30)     return 'medium';
    return 'info';
  }

  /** Format a date string for display */
  function format(dateStr, lang) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString(
        lang === 'ar' ? 'ar-SA' : 'en-GB',
        { year:'numeric', month:'short', day:'numeric' }
      );
    } catch(e) { return dateStr; }
  }

  /** Today as YYYY-MM-DD */
  function today() { return new Date().toISOString().split('T')[0]; }

  /** N days from now as YYYY-MM-DD */
  function fromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  /** Hours since a date string (for technician 24h edit window) */
  function hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (new Date() - new Date(dateStr)) / 3600000;
  }

  return { daysUntil, expiryStatus, expiryPriority, format, today, fromNow, hoursSince };
})();

/* ================================================================
   11. EXPORT UTILITIES
================================================================ */
const SapExport = (() => {

  /** Quote a CSV cell value */
  function _q(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

  /**
   * Export an array of objects as CSV download.
   * @param {string[]}  headers  – column headers
   * @param {string[][]}rows     – data rows (already formatted as strings)
   * @param {string}    filename – without extension
   */
  function toCSV(headers, rows, filename) {
    const csv  = [headers.map(_q).join(','), ...rows.map(r => r.map(_q).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${filename}_${SapDate.today()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Trigger browser print dialog */
  function print() { window.print(); }

  /**
   * Convert a table element to CSV and download.
   * @param {string} tableId
   * @param {string} filename
   */
  function tableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const rows    = [...table.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent.trim())
    );
    toCSV(headers, rows, filename);
  }

  return { toCSV, print, tableToCSV };
})();

/* ================================================================
   12. ROLE GUARD HELPERS
================================================================ */
const SapRoles = (() => {

  /**
   * Show/hide elements based on current role.
   * Usage:  data-roles="admin,manager"   → only visible for those roles
   *         data-hide-roles="user"       → hidden for those roles
   */
  function applyVisibility(role) {
    document.querySelectorAll('[data-roles]').forEach(el => {
      const allowed = el.getAttribute('data-roles').split(',').map(r => r.trim());
      el.style.display = allowed.includes(role) ? '' : 'none';
    });
    document.querySelectorAll('[data-hide-roles]').forEach(el => {
      const hidden = el.getAttribute('data-hide-roles').split(',').map(r => r.trim());
      if (hidden.includes(role)) el.style.display = 'none';
    });
  }

  /**
   * Make elements read-only for roles that cannot edit.
   */
  function applyReadOnly(role) {
    const canEdit = SAP_CONFIG.ROLES[role]?.canEdit;
    if (!canEdit) {
      document.querySelectorAll('[data-editable]').forEach(el => {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
          el.disabled = true;
        } else {
          el.style.pointerEvents = 'none';
          el.style.opacity = '.55';
        }
      });
    }
  }

  return { applyVisibility, applyReadOnly };
})();

/* ================================================================
   13. EVENT BUS (simple pub/sub)
================================================================ */
const SapEventBus = (() => {
  const _listeners = {};

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  function off(event, fn) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(f => f !== fn);
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.warn('SapEventBus error:', e); } });
  }

  function once(event, fn) {
    const wrapper = data => { fn(data); off(event, wrapper); };
    on(event, wrapper);
  }

  return { on, off, emit, once };
})();

/* ================================================================
   14. AUTO-INIT
================================================================ */


function applyPageBodyClass() {
  const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
  const slug = page.replace(/\.html$/, '').replace(/[^a-z0-9-]/g, '');
  if (slug) document.body.classList.add(`page-${slug}`);
}

function applyPlanBMobileLayout() {
  const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
  const targets = new Set(['assets.html','certificates.html','inspectors.html','clients.html','functional-locations.html','jobs.html']);
  if (!targets.has(page)) return;

  document.body.classList.add('mobile-plan-b');

  document.querySelectorAll('.sap-table').forEach(table => {
    const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim());
    if (!headers.length) return;
    table.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.children].forEach((td, idx) => {
        if (td.tagName !== 'TD') return;
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', headers[idx] || `Column ${idx + 1}`);
      });
      const actionCell = tr.querySelector('td:last-child');
      if (actionCell && actionCell.querySelector('button, .btn, [role="button"], a.btn')) {
        actionCell.classList.add('sap-mobile-actions-cell');
      }
    });
  });
}

(function autoInit() {
  document.addEventListener('DOMContentLoaded', () => {

    /* ── Restore language ── */
    const lang = localStorage.getItem(SAP_CONFIG.LANG_KEY) || SAP_CONFIG.DEFAULT_LANG;
    SapLang.apply(lang, true);   /* silent – no event emit yet */

    /* ── Check if this is the login page ── */
    const isLoginPage = window.location.pathname.endsWith('index.html') ||
                        window.location.pathname === '/' ||
                        window.location.pathname.endsWith('/');

    if (isLoginPage) {
      /* On login page: wire language toggle only */
      const langBtn = document.getElementById('langBtn');
      if (langBtn) langBtn.style.display = 'none';

      /* Auto-redirect if already logged in */
      if (SapSession.get()) {
        window.location.href = 'assets.html';
      }
      return;
    }

    /* ── Guard all other pages ── */
    const session = SapSession.guard();
    if (!session) return;

    /* ── Apply language from session ── */
    const sessionLang = session.lang || lang;
    SapLang.apply(sessionLang, true);

    /* ── Shell ── */
    SapShell.init(session);

    /* ── Sidebar ── */
    SapSidebar.init();
    SapNavigation.sync();

    /* ── Role visibility ── */
    SapRoles.applyVisibility(session.role);
    SapRoles.applyReadOnly(session.role);

    applyPageBodyClass();
    applyPlanBMobileLayout();
    SapDensity.init();

    SapClients.warm().then(() => SapClients.hydrateUi()).catch(() => {});

    /* ── Wire global buttons ── */
    const langBtn = document.getElementById('langBtn');
    if (langBtn) langBtn.style.display = 'none';

    const shellAvatar = document.getElementById('shellAvatar');
    if (shellAvatar) shellAvatar.onclick = () => SapShell.toggleUserMenu();

    const collapseBtn = document.getElementById('collapseBtn');
    if (collapseBtn) collapseBtn.onclick = () => SapSidebar.toggle();

    /* Also wire sidebar collapse button found in existing pages */
    document.querySelectorAll('.sap-sidebar__collapse-btn').forEach(btn => {
      btn.onclick = () => SapSidebar.toggle();
    });

    /* ── Wire logout buttons ── */
    document.querySelectorAll('[data-action="logout"]').forEach(btn => {
      btn.onclick = () => SapSession.logout();
    });

    /* ── Close modals on overlay click ── */
    document.querySelectorAll('.sap-modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) SapModal.close(overlay.id);
      });
    });

    /* ── Close drawers on overlay click ── */
    document.querySelectorAll('.sap-drawer-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    /* ── ESC key → close modals/drawers ── */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        SapModal.closeAll();
        document.querySelectorAll('.sap-drawer-overlay.open').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.sap-user-menu.open').forEach(m => m.classList.remove('open'));
      }
    });

    /* ── Notification badge ── */
    SapShell.setNotifBadge(session.role !== 'user');

    /* ── Admin-only sections ── */
    const adminSections = document.querySelectorAll('#adminSection, [data-admin-only]');
    adminSections.forEach(el => {
      if (session.role !== 'admin') el.style.display = 'none';
    });

    /* ── Emit ready event ── */
    SapEventBus.emit('app:ready', { session, lang: sessionLang });

    const obs = new MutationObserver(() => { SapClients.hydrateUi(); });
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();

/* ================================================================
   GLOBAL CONVENIENCE ALIASES
   (used directly in inline HTML onclick="" attributes)
================================================================ */
function toggleLang()      { SapLang.toggle(); }
function toggleSidebar()   { SapSidebar.toggle(); }
function toggleUserMenu()  { SapShell.toggleUserMenu(); }
function logout()          { SapSession.logout(); }

/* ================================================================
   EXPORTS (for module environments / bundlers)
   In plain HTML pages everything is already on window.
================================================================ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAP_CONFIG,
    SapSession,
    SapLang,
    SapSidebar,
    SapShell,
    SapToast,
    SapModal,
    SapTable,
    SapForm,
    SapDate,
    SapExport,
    SapRoles,
    SapEventBus,
  };
}

/* ================================================================
   END OF app.js
================================================================ */
