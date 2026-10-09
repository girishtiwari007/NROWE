// ── POPUP ELEMENT
let _pp = null;
let _ppTimer = null;
const PORTAL_THEMES = Object.freeze({
  default: '',
  'gov-command': 'assets/css/theme-gov-command.css',
  'digital-india': 'assets/css/theme-digital-india.css',
  'cpgrams-gov': 'assets/css/theme-cpgrams-gov.css',
  'control-room': 'assets/css/theme-control-room.css',
  'executive-light': 'assets/css/theme-executive-light.css'
});
const ASSET_VERSION = '20261009-fr1';

// Browser-side deterrence only. Sensitive code/data delivered to a browser can
// still be inspected by a determined user; real confidentiality needs server-side access control.
const PORTAL_SECURITY = Object.freeze({
  idleLockMs: 15 * 60 * 1000,
  warningMs: 60 * 1000,
  blockContextMenu: true,
  blockCopyShortcuts: true
});
let _securityIdleTimer = null;
let _securityWarnTimer = null;
let _portalLocked = false;
let _exportConfirmedUntil = 0;
let _pendingExportLabel = '';
const EXPORT_USER_DIGEST = '605e2a9a5b09a900b3a780e3f1d9a11a4ca08cb06a149afc231cefd815be1abf';
const EXPORT_USER_SESSION_KEY = 'nrzone_export_user_access';
const HUMAN_CHECK_MAX_ATTEMPTS = 5;
const HUMAN_CHECK_LOCK_MS = 60 * 1000;
const _humanChecks = Object.create(null);
const _loginAttempts = { admin: 0, export: 0 };
const _loginLockedUntil = { admin: 0, export: 0 };

const HUMAN_GLYPHS = Object.freeze([
  ['◆','◇'], ['●','○'], ['▲','△'], ['■','□'], ['★','☆'], ['⬢','⬡']
]);

function humanCheckId(kind) {
  return kind === 'admin' ? 'adminHumanCheck' : 'exportHumanCheck';
}

function makeHumanChallenge(kind) {
  const el = document.getElementById(humanCheckId(kind));
  if (!el) return;
  const pair = HUMAN_GLYPHS[crypto.getRandomValues(new Uint32Array(1))[0] % HUMAN_GLYPHS.length];
  const answerIndex = crypto.getRandomValues(new Uint32Array(1))[0] % 4;
  const cells = Array.from({length: 4}, (_, i) => i === answerIndex ? pair[1] : pair[0]);
  _humanChecks[kind] = { answerIndex, verified: false };
  el.classList.remove('locked');
  el.innerHTML = `<div class="human-check-head"><span class="human-check-title">Neural Shield</span><span class="human-check-state">Human check</span></div>
    <div class="human-check-prompt">Select the symbol that is different from the other three.</div>
    <div class="human-check-grid">${cells.map((glyph, i) => `<button type="button" data-human-choice="${i}" aria-label="Challenge symbol ${i + 1}">${glyph}</button>`).join('')}</div>
    <button class="human-check-refresh" type="button">New challenge</button>`;
  el.querySelectorAll('[data-human-choice]').forEach(button => button.addEventListener('click', () => {
    const state = _humanChecks[kind];
    if (!state || state.verified) return;
    const choice = Number(button.dataset.humanChoice);
    if (choice === state.answerIndex) {
      state.verified = true;
      button.classList.add('selected');
      el.querySelector('.human-check-state').textContent = 'Verified';
      el.querySelector('.human-check-state').classList.add('ok');
      el.querySelectorAll('[data-human-choice]').forEach(item => item.disabled = true);
    } else {
      el.querySelector('.human-check-state').textContent = 'Try again';
      setTimeout(() => makeHumanChallenge(kind), 450);
    }
  }));
  el.querySelector('.human-check-refresh').addEventListener('click', () => makeHumanChallenge(kind));
}

function humanCheckVerified(kind) {
  return !!(_humanChecks[kind] && _humanChecks[kind].verified);
}

function loginThrottleMessage(kind) {
  const remaining = _loginLockedUntil[kind] - Date.now();
  return remaining > 0 ? `Too many attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.` : '';
}

function recordFailedLogin(kind) {
  _loginAttempts[kind] += 1;
  if (_loginAttempts[kind] >= HUMAN_CHECK_MAX_ATTEMPTS) {
    _loginAttempts[kind] = 0;
    _loginLockedUntil[kind] = Date.now() + HUMAN_CHECK_LOCK_MS;
  }
  makeHumanChallenge(kind);
}

function clearLoginThrottle(kind) {
  _loginAttempts[kind] = 0;
  _loginLockedUntil[kind] = 0;
}

function securitySessionId() {
  let id = sessionStorage.getItem('nrzone_security_session');
  if (!id) {
    id = `${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0')}`;
    sessionStorage.setItem('nrzone_security_session', id);
  }
  return id;
}

function showSecurityNotice(message) {
  let el = document.getElementById('securityNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'securityNotice';
    el.className = 'security-notice';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function installSecurityUI() {
  document.documentElement.classList.add('portal-copy-guard');
  if (!document.getElementById('securityLockOverlay')) {
    const lock = document.createElement('div');
    lock.id = 'securityLockOverlay';
    lock.className = 'security-lock-overlay';
    lock.innerHTML = `<div class="security-lock-card">
      <div class="security-lock-mark">NR</div>
      <h2>Portal Session Locked</h2>
      <p>Locked after inactivity to reduce unattended access.</p>
      <small>Session ${securitySessionId()}</small>
      <button type="button" id="securityResumeBtn">Resume Session</button>
      <div class="security-caveat">Browser controls deter casual copying. They do not replace authenticated server-side protection.</div>
    </div>`;
    document.body.appendChild(lock);
    document.getElementById('securityResumeBtn').addEventListener('click', unlockPortalSession);
  }
}

function lockPortalSession() {
  if (_portalLocked) return;
  _portalLocked = true;
  document.body.classList.add('portal-session-locked');
  const overlay = document.getElementById('securityLockOverlay');
  if (overlay) overlay.classList.add('show');
}

function unlockPortalSession() {
  _portalLocked = false;
  document.body.classList.remove('portal-session-locked');
  const overlay = document.getElementById('securityLockOverlay');
  if (overlay) overlay.classList.remove('show');
  resetSecurityIdleTimer();
}

function resetSecurityIdleTimer() {
  if (_portalLocked) return;
  clearTimeout(_securityIdleTimer);
  clearTimeout(_securityWarnTimer);
  _securityWarnTimer = setTimeout(() => showSecurityNotice('Portal will lock in 1 minute due to inactivity.'), PORTAL_SECURITY.idleLockMs - PORTAL_SECURITY.warningMs);
  _securityIdleTimer = setTimeout(lockPortalSession, PORTAL_SECURITY.idleLockMs);
}

function isEditableSecurityTarget(target) {
  return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isExportUserUnlocked() {
  return sessionStorage.getItem(EXPORT_USER_SESSION_KEY) === '1' || (typeof isUploadAdminUnlocked === 'function' && isUploadAdminUnlocked());
}

function requestExportLogin(label) {
  _pendingExportLabel = label || '';
  const overlay = document.getElementById('exportLoginOverlay');
  const pwd = document.getElementById('exportLoginPwd');
  const err = document.getElementById('exportLoginErr');
  if (pwd) pwd.value = '';
  if (err) err.textContent = '';
  if (overlay) overlay.classList.remove('hidden');
  makeHumanChallenge('export');
  setTimeout(() => pwd && pwd.focus(), 30);
}

function closeExportLogin() {
  const overlay = document.getElementById('exportLoginOverlay');
  if (overlay) overlay.classList.add('hidden');
  _pendingExportLabel = '';
}

async function doExportLogin() {
  const pwd = document.getElementById('exportLoginPwd');
  const err = document.getElementById('exportLoginErr');
  const locked = loginThrottleMessage('export');
  if (locked) { if (err) err.textContent = locked; return; }
  if (!humanCheckVerified('export')) { if (err) err.textContent = 'Complete Neural Shield verification first.'; return; }
  const digest = await sha256Hex(`EXPORT:${pwd ? pwd.value : ''}`);
  if (digest !== EXPORT_USER_DIGEST) {
    if (err) err.textContent = 'Incorrect EXPORT password.';
    if (pwd) pwd.value = '';
    recordFailedLogin('export');
    return;
  }
  clearLoginThrottle('export');
  sessionStorage.setItem(EXPORT_USER_SESSION_KEY, '1');
  const pending = _pendingExportLabel;
  const overlay = document.getElementById('exportLoginOverlay');
  if (overlay) overlay.classList.add('hidden');
  _pendingExportLabel = '';
  showSecurityNotice('EXPORT user unlocked for this browser session.');
  setTimeout(() => {
    if (pending.startsWith('Display ')) {
      const saved = window.__pendingDisplayExport;
      window.__pendingDisplayExport = null;
      if (saved && saved.format && saved.which) DisplayExport.run(saved.format, saved.which, saved.options || {});
      else { const parts=pending.split(' '); DisplayExport.run(parts[1],parts[2],{tableOnly:parts[3]==='TableOnly'}); }
    }
    else if (pending.startsWith('SMH matrix')) downloadSMHMatrixPDF(pending.includes('dual')?'dual':pending.includes('crore')?'crore':'thousand');
    else if (pending.includes('Excel')) downloadExcel();
    else if (pending.includes('PDF')) downloadPDFReport();
    else if (pending.includes('PowerPoint')) downloadPowerPoint();
  }, 50);
}

function confirmProtectedExport(label) {
  if (!isExportUserUnlocked()) {
    requestExportLogin(label);
    return false;
  }
  const now = Date.now();
  if (now < _exportConfirmedUntil) return true;
  const ok = window.confirm(`${label} contains official financial data.\n\nSession: ${securitySessionId()}\nThe export will be traceable by this session reference. Continue?`);
  if (ok) _exportConfirmedUntil = now + 60 * 1000;
  return ok;
}

function isNavigationCopyTarget(target,includeSelection=false){
 const nav='.report-menu-actions,.legacy-tabs,.fr-page-tabs';
 if(target?.closest?.(nav))return true;
 if(!includeSelection)return false;
 const selection=window.getSelection();if(!selection||selection.isCollapsed)return false;
 const element=node=>node?.nodeType===1?node:node?.parentElement;
 return !!element(selection.anchorNode)?.closest(nav)&&!!element(selection.focusNode)?.closest(nav);
}
function initBrowserProtection() {
  installSecurityUI();
  if (PORTAL_SECURITY.blockContextMenu) {
    document.addEventListener('contextmenu', event => {
      if (isEditableSecurityTarget(event.target)||isNavigationCopyTarget(event.target)) return;
      event.preventDefault();
      showSecurityNotice('Right-click is disabled for this official-use portal.');
    });
  }
  document.addEventListener('keydown', event => {
    if (isEditableSecurityTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    if((event.ctrlKey||event.metaKey)&&key==='c'&&isNavigationCopyTarget(event.target,true))return;
    const blocked = key === 'f12' || ((event.ctrlKey || event.metaKey) && ['u','s','p','c','x','a'].includes(key)) || (event.ctrlKey && event.shiftKey && ['i','j','c'].includes(key));
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      showSecurityNotice('This browser action is restricted for official-use data.');
    }
  }, true);
  if (PORTAL_SECURITY.blockCopyShortcuts) {
    ['copy','cut','dragstart'].forEach(type => document.addEventListener(type, event => {
      if (isEditableSecurityTarget(event.target)||isNavigationCopyTarget(event.target,true)) return;
      event.preventDefault();
      showSecurityNotice('Copying portal content is restricted. Use authorized exports.');
    }));
  }
  ['pointerdown','keydown','scroll','touchstart'].forEach(type => document.addEventListener(type, resetSecurityIdleTimer, {passive:true}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resetSecurityIdleTimer(); });
  resetSecurityIdleTimer();
}

function setPortalTheme(themeName) {
  const theme = PORTAL_THEMES[themeName] !== undefined ? themeName : 'default';
  const link = document.getElementById('themeStylesheet');
  if (link) {
    const href = PORTAL_THEMES[theme];
    link.setAttribute('href', href ? `${href}?v=${ASSET_VERSION}` : '');
  }
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('nrzone_theme', theme);
  const sel = document.getElementById('themeSelect');
  if (sel && sel.value !== theme) sel.value = theme;
}

function initPortalTheme() {
  let requested = '';
  try { requested = new URLSearchParams(location.search).get('theme') || ''; } catch(e) {}
  setPortalTheme(PORTAL_THEMES[requested] !== undefined ? requested : 'digital-india');
}

function setBlockStyle(styleName) {
  const style = styleName === 'raised' ? 'raised' : 'flat';
  document.documentElement.setAttribute('data-block-style', style);
  localStorage.setItem('nrzone_block_style', style);
  const sel = document.getElementById('blockStyleSelect');
  if (sel && sel.value !== style) sel.value = style;
}

function initBlockStyle() {
  setBlockStyle('raised');
}

function initPopup() {
  if (_pp) return; // already initialised
  _pp = document.createElement('div');
  _pp.id='puPopup';
  _pp.style.cssText='position:fixed;z-index:9999;pointer-events:none;background:#fff;border:1px solid #C0D4F0;border-radius:8px;padding:0;box-shadow:0 8px 32px rgba(10,22,40,.20),0 2px 8px rgba(10,22,40,.10);min-width:270px;max-width:320px;max-height:calc(100vh - 24px);opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s;font-size:11px;color:#0A1628;overflow-x:hidden;overflow-y:auto';
  document.body.appendChild(_pp);
  _pp.addEventListener('mouseenter', function(){ clearTimeout(_ppTimer); });
  _pp.addEventListener('mouseleave', hidePUPopup);
}

// ── LOGIN SYSTEM ─────────────────────────────────────────────
const AUTH_DIGESTS = Object.freeze({
  ADMIN: 'bc2bc320b6b63f5852d72b647b2c546d4173cc04936749652b6e975f1b607ac9'
});
let _pendingUploadAfterLogin = false;
let _pendingAdminTab = null;

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

async function doLogin() {
  const user = 'ADMIN';
  const pwd  = document.getElementById('loginPwd').value;
  const err  = document.getElementById('loginErr');
  const locked = loginThrottleMessage('admin');
  if (locked) { err.textContent = locked; return; }
  if (!humanCheckVerified('admin')) { err.textContent = 'Complete Neural Shield verification first.'; return; }
  const digest = await sha256Hex(`${user}:${pwd}`);
  if (AUTH_DIGESTS[user] !== digest) {
    err.textContent = 'Incorrect ADMIN password. Upload access not allowed.';
    document.getElementById('loginPwd').value = '';
    recordFailedLogin('admin');
    setTimeout(()=>err.textContent='', 3000);
    return;
  }
  clearLoginThrottle('admin');
  sessionStorage.setItem('nrzone_upload_admin', '1');
  const targetTab = _pendingAdminTab || (_pendingUploadAfterLogin ? 'upload' : null);
  _pendingUploadAfterLogin = false;
  _pendingAdminTab = null;
  closeUploadLogin();
  if (targetTab) {
    switchTab(targetTab);
  }
}

function restoreLoginSession() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('hidden');
  const uploadTab = document.getElementById('uploadTab');
  if (uploadTab) uploadTab.style.display = '';
  const uploadMenuBtn = document.getElementById('uploadMenuBtn');
  if (uploadMenuBtn) uploadMenuBtn.style.display = '';
  const backupTab = document.getElementById('backupTab');
  if (backupTab) backupTab.style.display = '';
  const backupMenuBtn = document.getElementById('backupMenuBtn');
  if (backupMenuBtn) backupMenuBtn.style.display = '';
  const adminTab = document.getElementById('adminTab');
  if (adminTab) { adminTab.hidden = true; adminTab.style.display = 'none'; }
  const adminMenuBtn = document.getElementById('adminMenuBtn');
  if (adminMenuBtn) { adminMenuBtn.hidden = true; adminMenuBtn.style.display = 'none'; }
}

function isUploadAdminUnlocked() {
  return sessionStorage.getItem('nrzone_upload_admin') === '1';
}

function requestUploadAdmin(targetTab='upload') {
  _pendingUploadAfterLogin = targetTab === 'upload';
  _pendingAdminTab = targetTab;
  const overlay = document.getElementById('loginOverlay');
  const title = document.getElementById('loginTitle');
  const sub = document.getElementById('loginSub');
  const pwd = document.getElementById('loginPwd');
  const err = document.getElementById('loginErr');
  if (title) title.textContent = targetTab === 'backup' ? 'BACKUP ADMIN ACCESS' : targetTab === 'admin' ? 'PORTAL ADMIN ACCESS' : targetTab === 'remarks' ? 'REMARKS ADMIN ACCESS' : 'UPLOAD ADMIN ACCESS';
  if (sub) sub.innerHTML = targetTab === 'backup'
    ? 'Portal backup is admin protected.<br>Enter ADMIN password to open backup download.'
    : targetTab === 'admin'
      ? 'Portal design settings are admin protected.<br>Enter ADMIN password to edit headings and menu names.'
      : targetTab === 'remarks'
        ? 'Remarks and source rules are now inside Portal Admin.<br>Enter ADMIN password to open.'
      : 'Portal is open for viewing.<br>Enter ADMIN password only for data upload.';
  if (err) err.textContent = '';
  if (pwd) pwd.value = '';
  if (overlay) overlay.classList.remove('hidden');
  makeHumanChallenge('admin');
  setTimeout(() => { if (pwd) pwd.focus(); }, 60);
}

function closeUploadLogin() {
  _pendingUploadAfterLogin = false;
  _pendingAdminTab = null;
  const overlay = document.getElementById('loginOverlay');
  const pwd = document.getElementById('loginPwd');
  const err = document.getElementById('loginErr');
  if (overlay) overlay.classList.add('hidden');
  if (pwd) pwd.value = '';
  if (err) err.textContent = '';
}

function showPortalNotice(message, state='ok') {
  const box = document.createElement('div');
  box.className = 'portal-notice ' + state;
  box.textContent = message;
  document.body.appendChild(box);
  setTimeout(() => box.classList.add('show'), 20);
  setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => box.remove(), 260);
  }, state === 'err' ? 5200 : 3600);
}

// ═══════════════════════════════════════════════════════
// MASTER DATA - from uploaded files (figures in Rs '000s)
// ═══════════════════════════════════════════════════════

const PU_META = [
  {code:'01',desc:'Sal/Wag',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'02',desc:'DA',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'03',desc:'PLB',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'04',desc:'HRA',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'07',desc:'Transport Allowance /TPT',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'08',desc:'NPS Contribution',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'09',desc:'WCL',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'10',desc:'Kilometrage Allowance (KMA)',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'11',desc:'OT',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'12',desc:'NDA',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'13',desc:'Other Allowance',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'14',desc:'FEES & HON.',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'15',desc:'Travalling Allowance/TA',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'16',desc:'Travelling expenses. /CTG',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'17',desc:'Air Travel Expense sanctioned in lieu of privilege passes.',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'18',desc:'Office Expenses',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'19',desc:'Phone',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'20',desc:'Leave Salary',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'21',desc:'Advertising Expenses',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'22',desc:'Util(excl. elec.)',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'23',desc:'Rental Office Equip',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'24',desc:'Printing and Stnry',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'25',desc:'Children Edu. Allow',puType:'Staff PU',liab:'Committed',isNeg:false},
  {code:'26',desc:'Medical Expenses',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'27',desc:'Materials from stock',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'28',desc:'Materials-Dir. purchase',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'29',desc:'Remu. Re-engaged Staff',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'30',desc:'Cost Of Elec. Energy/Traction Energy Procurement',puType:'Non Staff PU',liab:'Committed',isNeg:false},
  {code:'31',desc:'Direct Purchase of Fuel',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'32',desc:'Contractual payments',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'33',desc:'Transfer of debits/credits from other units',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'34',desc:'Intra-railway adjustment of wages on POH and other repairs',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'35',desc:'Material POH',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'36',desc:'Excise Duty',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'37',desc:'Customs Duty',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'38',desc:'Sales Tax',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'39',desc:'ATD',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'40',desc:'ATF',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'41',desc:'VAT',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'42',desc:'ARR SALARY',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'43',desc:'ARR DA',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'44',desc:'ARR OTH ALW',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'45',desc:'Pmt Of Service Tax',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'46',desc:'Counter-vailing duty',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'47',desc:'Addl custom duty',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'48',desc:'Custom Duty paid',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'49',desc:'O/S OF MAN POWER FOR TRACK MNT',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'51',desc:'COMPCONSUM',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'52',desc:'Laptop',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'53',desc:'All India LTC',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'54',desc:'Int on delayed NPS',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'60',desc:'Fuel from Stock-Home',puType:'Non Staff PU',liab:'Committed',isNeg:false},
  {code:'61',desc:'Trf Dr/Cr of loco performance',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'63',desc:'Adj of labour cost on POH/WMS',puType:'Staff PU',liab:'Planned',isNeg:false},
  {code:'64',desc:'Int Rly Adj debits materials',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'72',desc:'Central GST (CGST)',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'73',desc:'State GST (SGST)',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'74',desc:'Union Territory GST (UTGST)',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'75',desc:'Integrated GST (IGST)',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  {code:'99',desc:'Other Expenses/Misc',puType:'Non Staff PU',liab:'Planned',isNeg:false},
  // PU-98: Recoveries - kept in data for Recovery tab reference only
  {code:'98',desc:'Credit or Recoveries',puType:'Staff PU',liab:'Recovery',isNeg:true},
];

const SKIPPED_DISPLAY_PUS = new Set(['72','73','74','75']);
const IMPORTANT_PUS = new Set(['27','28','30','32','60']);
function normPUCode(code) {
  return String(code == null ? '' : code).trim().padStart(2, '0');
}
function isSkippedDisplayPU(code) {
  return SKIPPED_DISPLAY_PUS.has(normPUCode(code));
}
function isImportantPU(code) {
  return IMPORTANT_PUS.has(normPUCode(code));
}
function puFocusMode() {
  return (document.getElementById('puFocusFilter') || {}).value || 'all';
}
function passesPUFocus(code) {
  return puFocusMode() !== 'important' || isImportantPU(code);
}
function isActiveDisplayPU(pu) {
  return !!pu && !pu.isNeg && !isSkippedDisplayPU(pu.code);
}
function activePUMeta() {
  return PU_META.filter(isActiveDisplayPU);
}

const SOURCE_REGISTER = {
  budgetCY: {label:'Current Year PU-wise Budget Available', fy:'2026-2027', source:'PU-BUDGET.xls', used:'OWE, Month-wise Actuals, PU Master, Trend, BP Analysis', remarks:'Repository source refreshed from PORTAL DATA on 06-Oct-2026; actual till date aligned to APR-OCT month-wise file.'},
  monthCY: {label:'Current Year PU-wise Month-wise Actuals', fy:'2026-2027', source:'PU-MONTH-ACTUAL.xls', used:'OWE, Month-wise Actuals, Trend, AI Trend, BP Analysis', remarks:'Repository source refreshed from PORTAL DATA on 06-Oct-2026; latest loaded month OCT 2026.'},
  budgetPY: {label:'Previous Year PU-wise Budget Available', fy:'2025-2026', source:'Pre-loaded Budget Available file (PY static portal data)', used:'Trend comparison and AI Trend comparison'},
  monthPY: {label:'Previous Year PU-wise Month-wise Actuals', fy:'2025-2026', source:'Pre-loaded Month-wise Actuals file (PY static portal data)', used:'Trend comparison and AI Trend comparison'},
  smhBudgetCY: {label:'Department wise Budget Available', fy:'2026-2027', source:'PU-DEPT-DEMAND-SMH-BUDGET.xls', used:'Department wise', remarks:'Repository source refreshed from PORTAL DATA on 06-Oct-2026.'},
  smhMonthCY: {label:'Department wise Month-wise Actuals', fy:'2026-2027', source:'PU-DEPT-DEMAND-SMH-ACTUAL.xls', used:'Department wise', remarks:'Repository source refreshed from PORTAL DATA on 06-Oct-2026; latest loaded month OCT 2026.'},
  demandSmhCY: {label:'Demand / SMH Grant Summary', fy:'2026-2027', source:'DEMAND-SMH-BUGDET.xls + DEMAND-SMH-ACTUAL.xls', used:'Demand / SMH Summary', remarks:'Repository source refreshed from PORTAL DATA on 06-Oct-2026. Completed through SEP 2026; OCT 2026 is current running month; latest uploaded actual month detected as OCT 2026. Demand 12N/10N Suspense Heads is shown separately.'}
};

// Budget data from BudgetReport (BG_ISL col, RG col) - Rs'000s
let BUDGET = window.NR_ZONE_DATA?.scopes["03"]?.budget || {};

// Month-wise actuals from MONTH WISE report - Rs'000s
let MONTH = window.NR_ZONE_DATA?.scopes["03"]?.month || {};
// Spreadsheet grand-total rows can contain rounding or allocation drift.
// Rebuild the month total from PU rows so cards and exports share one source of truth.
MONTH.TOTAL = Object.fromEntries(['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'].map(month => [
  month,
  Object.entries(MONTH).reduce((sum, [code, values]) =>
    code === 'TOTAL' ? sum : sum + (Number(values[month]) || 0), 0)
]));

let BUDGET_PY = {};
let MONTH_PY = {};
let _pendingBudgetPY = null;
let _pendingMonthPY  = null;

// ═══════════════════════════════════════════════
// CURRENT MONTH DETECTION (auto from date)
// ═══════════════════════════════════════════════
let _uploadedMonthIdx = null; // latest completed month detected from uploaded CY month-wise file
let _reportingCurrentMonthIdx = 6; // GUI-selected or auto-detected reporting month
let _latestActualMonthIdx = 6;
const FY_MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
const FY_MONTH_LABELS = ['APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR'];
const DEFAULT_DATA_AS_ON_DATE = new Date('2026-10-06T10:23:36+05:30');
let _dataAsOnDate = new Date(DEFAULT_DATA_AS_ON_DATE);
const RLP_BUILD_ID = 'nrzone-20261009-au1';
const RLP_UPLOAD_STATE_KEY = 'nrzone_cy_upload_state_' + RLP_BUILD_ID;
const RLP_PY_UPLOAD_STATE_KEY = 'nrzone_py_upload_state_2025_2026';
const RLP_UPLOAD_CONFIRM_KEY = 'nrzone_upload_confirm_history_' + RLP_BUILD_ID;
let _uploadConfirmHistory = [];
let _pyUploadMeta = null;
let _pyUploadMode = false;
function bpModeUsesTillDate() {
  return false;
}

function getBPModeStatus() {
  const status = getMonthStatus();
  const completedThroughIdx = status.actualMonths.length ? FY_MONTHS.indexOf(status.actualMonths[status.actualMonths.length - 1]) : -1;
  const latestIdx = status.latestActual ? status.latestActual.idx : completedThroughIdx;
  const activeIdx = completedThroughIdx;
  const bpMonths = activeIdx >= 0 ? FY_MONTHS.slice(0, activeIdx + 1) : [];
  const bpThrough = activeIdx >= 0 ? {idx:activeIdx, key:FY_MONTHS[activeIdx], label:FY_MONTH_LABELS[activeIdx], year:activeIdx<=8?2026:2027} : null;
  const latestData = latestIdx >= 0 ? {idx:latestIdx, key:FY_MONTHS[latestIdx], label:FY_MONTH_LABELS[latestIdx], year:latestIdx<=8?2026:2027} : null;
  return {
    ...status,
    bpMonths,
    bpMonthCount:bpMonths.length,
    bpThrough,
    latestData,
    mode:'completed',
    modeLabel:'Completed actual month',
    formulaLabel:bpThrough ? `${bpMonths.length} month(s) through ${bpThrough.label} ${bpThrough.year}` : 'No actual month'
  };
}

function actualForBPMode(code) {
  const md = MONTH[code] || {};
  const mode = getBPModeStatus();
  const hasMonthData = mode.bpMonths.some(m => Object.prototype.hasOwnProperty.call(md, m));
  const actual = BUDGET[code] ? Number(BUDGET[code].actuals_till) : NaN;
  if (hasMonthData) return mode.bpMonths.reduce((sum, m) => sum + (Number(md[m]) || 0), 0);
  if (Number.isFinite(actual)) return actual;
  return compute(code).totalCommitted;
}

function setBPModeTillDate(checked) {
  syncBPModeControls();
  if (typeof renderBPAnalysis === 'function') renderBPAnalysis();
  if (typeof renderBudgetControl === 'function') renderBudgetControl();
  if (typeof renderDemandSMHSummary === 'function') renderDemandSMHSummary();
  if (typeof refreshBIViewSoon === 'function') refreshBIViewSoon();
}

function syncBPModeControls() {
  const mode = getBPModeStatus();
  document.querySelectorAll('[data-bp-mode-label]').forEach(el => { el.textContent = `${mode.modeLabel}: ${mode.formulaLabel}`; });
}

function formatAsOnDate(d) {
  const dt = d instanceof Date && !isNaN(d) ? d : DEFAULT_DATA_AS_ON_DATE;
  const datePart = dt.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}).replace(/ /g,'-');
  const timePart = dt.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', hour12:false});
  return `${datePart} ${timePart}`;
}

function uploadFileTimestamp(file) {
  const ts = file && file.lastModified ? new Date(file.lastModified) : new Date();
  return ts instanceof Date && !isNaN(ts) ? ts : new Date();
}

function latestUploadTimestamp(...items) {
  return items
    .filter(Boolean)
    .map(item => item.at instanceof Date ? item.at : new Date(item.at))
    .filter(dt => dt instanceof Date && !isNaN(dt))
    .sort((a,b) => b - a)[0] || DEFAULT_DATA_AS_ON_DATE;
}

function saveCYUploadState() {
  try {
    clearStoredUploadState();
    sessionStorage.setItem(RLP_UPLOAD_STATE_KEY, JSON.stringify({
      budget:BUDGET,
      month:MONTH,
      detail:window.DETAIL_SMH_DATA || null,
      demandSmh:window.DEMAND_SMH_SUMMARY_DATA || null,
      uploadedMonthIdx:_uploadedMonthIdx,
      latestActualMonthIdx:_latestActualMonthIdx,
      dataAsOn:_dataAsOnDate instanceof Date ? _dataAsOnDate.toISOString() : new Date().toISOString(),
      savedAt:new Date().toISOString()
    }));
  } catch (err) {
    console.warn('Could not clear upload state', err);
  }
}

function clearStoredUploadState() {
  try {
    [localStorage, sessionStorage].forEach(store => {
      Object.keys(store).forEach(k => {
        if (k === 'nrzone_cy_upload_state' || (k.startsWith('nrzone_cy_upload_state_') && k !== RLP_UPLOAD_STATE_KEY)) {
          store.removeItem(k);
        }
      });
    });
    Object.keys(localStorage).forEach(k => {
      if (k === 'nrzone_cy_upload_state' || k.startsWith('nrzone_cy_upload_state_')) {
        localStorage.removeItem(k);
      }
    });
  } catch (err) {
    console.warn('Could not remove saved upload state', err);
  }
}

function loadCYUploadState() {
  if(window.NR_ZONE_DATA) return;
  try {
    clearStoredUploadState();
    const saved = JSON.parse(sessionStorage.getItem(RLP_UPLOAD_STATE_KEY) || 'null');
    if (!saved) return;
    if (saved.budget && typeof saved.budget === 'object') BUDGET = saved.budget;
    if (saved.month && typeof saved.month === 'object') MONTH = saved.month;
    if (saved.detail && Array.isArray(saved.detail.rows)) window.DETAIL_SMH_DATA = saved.detail;
    if (saved.demandSmh && Array.isArray(saved.demandSmh.rows)) window.DEMAND_SMH_SUMMARY_DATA = saved.demandSmh;
    _uploadedMonthIdx = saved.uploadedMonthIdx ?? null;
    _latestActualMonthIdx = saved.latestActualMonthIdx ?? null;
    if (saved.dataAsOn) _dataAsOnDate = new Date(saved.dataAsOn);
  } catch (err) {
    console.warn('Could not clear saved upload state', err);
  }
}

function indianDateTime(value) {
  const dt = value instanceof Date ? value : new Date(value || Date.now());
  if (!(dt instanceof Date) || isNaN(dt)) return '';
  return dt.toLocaleString('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}

function loadUploadConfirmHistory() {
  try {
    _uploadConfirmHistory = JSON.parse(localStorage.getItem(RLP_UPLOAD_CONFIRM_KEY) || '[]').slice(0, 2);
  } catch (err) {
    _uploadConfirmHistory = [];
  }
}

function saveUploadConfirmHistory() {
  try {
    localStorage.setItem(RLP_UPLOAD_CONFIRM_KEY, JSON.stringify(_uploadConfirmHistory.slice(0, 2)));
  } catch (err) {
    console.warn('Could not save upload confirmation history', err);
  }
}

function addUploadConfirmation(entry) {
  _uploadConfirmHistory.unshift({
    at: new Date().toISOString(),
    label: entry.label || 'Upload confirmed',
    detail: entry.detail || '',
    files: entry.files || ''
  });
  _uploadConfirmHistory = _uploadConfirmHistory.slice(0, 2);
  saveUploadConfirmHistory();
  renderUploadConfirmHistory();
}

function savePYUploadState(meta) {
  try {
    _pyUploadMeta = {...meta, confirmedAt: new Date().toISOString()};
    localStorage.setItem(RLP_PY_UPLOAD_STATE_KEY, JSON.stringify({
      meta:_pyUploadMeta,
      budget:BUDGET_PY,
      month:MONTH_PY
    }));
  } catch (err) {
    console.warn('Could not save previous year upload state', err);
  }
}

function loadPYUploadState() {
  if(window.NR_ZONE_DATA) return;
  try {
    const saved = JSON.parse(localStorage.getItem(RLP_PY_UPLOAD_STATE_KEY) || 'null');
    if (!saved) return;
    if (saved.budget && typeof saved.budget === 'object') BUDGET_PY = saved.budget;
    if (saved.month && typeof saved.month === 'object') MONTH_PY = saved.month;
    _pyUploadMeta = saved.meta || null;
    if (_pyUploadMeta) {
      SOURCE_REGISTER.budgetPY.source = _pyUploadMeta.budgetFile || SOURCE_REGISTER.budgetPY.source;
      SOURCE_REGISTER.monthPY.source = _pyUploadMeta.monthFile || SOURCE_REGISTER.monthPY.source;
      SOURCE_REGISTER.budgetPY.remarks = `Previous year data restored from browser storage; confirmed ${indianDateTime(_pyUploadMeta.confirmedAt)}.`;
      SOURCE_REGISTER.monthPY.remarks = SOURCE_REGISTER.budgetPY.remarks;
    }
  } catch (err) {
    console.warn('Could not load previous year upload state', err);
  }
}

function setPYUpdateMode(enabled) {
  _pyUploadMode = !!enabled;
  const panel = document.getElementById('pyUploadPanel');
  const yes = document.getElementById('pyYesBtn');
  const no = document.getElementById('pyNoBtn');
  if (panel) panel.style.display = _pyUploadMode ? 'grid' : 'none';
  if (yes) yes.classList.toggle('active', _pyUploadMode);
  if (no) no.classList.toggle('active', !_pyUploadMode);
}

function renderUploadConfirmHistory() {
  const wrap = document.getElementById('uploadConfirmHistory');
  if (wrap) {
    wrap.innerHTML = _uploadConfirmHistory.length
      ? _uploadConfirmHistory.map(item => `<div class="upload-confirm-item">
          <strong>${htmlSafe(item.label)} - ${htmlSafe(indianDateTime(item.at))}</strong>
          <span>${htmlSafe(item.detail || '')}</span>
          ${item.files ? `<span>${htmlSafe(item.files)}</span>` : ''}
        </div>`).join('')
      : '<div class="upload-confirm-empty">No upload confirmed in this browser yet.</div>';
  }
  const pyStatus = document.getElementById('pyUploadStatus');
  if (pyStatus) {
    pyStatus.textContent = _pyUploadMeta
      ? `Stored PY data confirmed ${indianDateTime(_pyUploadMeta.confirmedAt)}`
      : 'OK Pre-loaded from static file';
  }
}

function loadUploadAdminState() {
  loadPYUploadState();
  loadUploadConfirmHistory();
}

function getCurrentFYMonth() {
  const d = new Date();
  const m = d.getMonth(); // 0-Jan..11-Dec
  // FY: APR(3)=0, MAY(4)=1, ..., MAR(2)=11
  const systemFyIdx = m >= 3 ? m - 3 : m + 9;
  // The latest populated uploaded actual is the reporting/current month.
  // System date is only a fallback, so month-end rollover cannot close
  // provisional data before the next uploaded workbook says it is complete.
  const fyIdx = Number.isInteger(_reportingCurrentMonthIdx) && _reportingCurrentMonthIdx >= 0
    ? _reportingCurrentMonthIdx
    : systemFyIdx;
  return {idx: fyIdx, key: FY_MONTHS[fyIdx], label: FY_MONTH_LABELS[fyIdx], year: fyIdx <= 8 ? 2026 : 2027};
}

// Months COMPLETED before current month (actuals known)
// Months from current month onward = remaining (current = partial committed)
function getMonthStatus() {
  const cur = getCurrentFYMonth();
  const latestActualIdx = _latestActualMonthIdx !== null ? _latestActualMonthIdx : (cur.idx > 0 ? cur.idx - 1 : -1);
  const completedThroughIdx = Math.min(latestActualIdx, cur.idx - 1);
  const pastMonths   = FY_MONTHS.slice(0, cur.idx);
  const actualMonths  = completedThroughIdx >= 0 ? FY_MONTHS.slice(0, completedThroughIdx + 1) : [];
  const curMonthKey  = cur.key;
  const futureMonths = FY_MONTHS.slice(cur.idx + 1);  // jul..mar = 9 months
  const latestActual = latestActualIdx >= 0
    ? {idx:latestActualIdx, key:FY_MONTHS[latestActualIdx], label:FY_MONTH_LABELS[latestActualIdx], year:latestActualIdx<=8?2026:2027}
    : null;
  return {cur, pastMonths, actualMonths, latestActual, curMonthKey, futureMonths};
}

// ═══════════════════════════════════════════════
// COMPUTE LIABILITY PER PU
// ═══════════════════════════════════════════════
function isRGActive() {
  return Object.keys(BUDGET).some(code => code !== 'TOTAL' && (BUDGET[code].rg_available === true || Number(BUDGET[code].rg)));
}

function getBudget(code) {
  if (code === 'TOTAL') return Object.keys(BUDGET).reduce((sum, key) => key === 'TOTAL' ? sum : sum + getBudget(key), 0);
  const b = BUDGET[code];
  if (!b) return 0;
  // Per-PU selection, effective immediately in any reporting month.
  // Zero-filled source placeholders need explicit availability to mean a zero grant.
  const rg = Number(b.rg);
  return Number.isFinite(rg) && (b.rg_available === true || rg !== 0)
    ? rg : (Number(b.bg_isl) || 0);
}

function compute(code) {
  const {pastMonths, curMonthKey, futureMonths} = getMonthStatus();
  const md     = MONTH[code] || {};
  const budget = getBudget(code);
  const isNeg  = (PU_META.find(p=>p.code===code)||{}).isNeg || false;

  // Past months actuals (completed months before current)
  const pastActuals  = pastMonths.reduce((s,m) => s + (md[m]||0), 0);

  // Current month till-date value. If the active month column is blank,
  // derive it from actuals_till minus completed actual months.
  const curColumnVal = Object.prototype.hasOwnProperty.call(md, curMonthKey)
    ? (Number(md[curMonthKey]) || 0)
    : 0;
  const actualsTill = BUDGET[code] ? (Number(BUDGET[code].actuals_till) || 0) : 0;
  const residualTillDate = actualsTill - pastActuals;
  const curCommitted = Object.prototype.hasOwnProperty.call(md, curMonthKey)
    ? curColumnVal : residualTillDate;

  // Reserve an equal share for the running month, but never forecast less
  // than spending already booked. Reallocate the balance over future months.
  const totalRemainingMonths = 1 + futureMonths.length;
  const currentAllocation = Math.max(0, (budget - pastActuals) / totalRemainingMonths);
  const curRemaining = budget < 0 ? 0 : Math.max(0, currentAllocation - curCommitted);
  const curMonthTotal = curCommitted + curRemaining;
  const projPerMonth = budget >= 0 && futureMonths.length > 0
    ? Math.max(0, budget - pastActuals - curMonthTotal) / futureMonths.length
    : 0;
  const curDonePct = curMonthTotal > 0 ? (curCommitted / curMonthTotal) * 100 : 0;

  // Balance shown = budget - all committed spend (past + current month)
  const totalCommitted = pastActuals + curCommitted;
  const balanceBudget  = budget - totalCommitted;

  // % utilised = committed so far vs total budget
  let utilisedPct, utilisedFlag;
  if (budget === 0) {
    utilisedPct  = 0;
    utilisedFlag = totalCommitted === 0 ? 'none' : 'no-budget';
  } else if (budget < 0) {
    utilisedPct  = (totalCommitted / budget) * 100;
    utilisedFlag = 'normal';
  } else {
    utilisedPct  = (totalCommitted / budget) * 100;
    utilisedFlag = utilisedPct > 100 ? 'over' : 'normal';
  }

  return {budget, pastActuals, curCommitted, curRemaining, curMonthTotal,
          curDonePct, totalCommitted, balanceBudget, projPerMonth,
          utilisedPct, utilisedFlag, remMonthCount: futureMonths.length};
}

// ═══════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════
function fmtT(n) { // Rs'000s display with commas
  if (n===null||n===undefined||isNaN(n)||n===0) return '<span style="color:#aaa">-</span>';
  const abs = Math.abs(Math.round(n));
  const s = abs.toLocaleString('en-IN');
  return n < 0 ? `<span class="neg-val">(${s})</span>` : s;
}
function fmtCr(n) { // Convert Rs'000s to Crore
  if (!n || n===0) return '<span style="color:#aaa">-</span>';
  const cr = (n * 1000 / 10000000);
  const s = Math.abs(cr).toFixed(2);
  return n < 0 ? `<span class="neg-val">(${s} Cr)</span>` : `${s} Cr`;
}
function pct(a, b) { return b ? Math.abs(Math.round((a/Math.abs(b))*1000)/10) : 0; }
function miniProg(val, color) {
  const v = Math.min(100, Math.max(0, val));
  return `<div class="mp"><div class="mb"><div class="mf" style="width:${v}%;background:${color}"></div></div><span class="mpct ${val>90?'over':''}" style="color:${color}">${val.toFixed(1)}%</span></div>`;
}
function utilColor(p) { if(p===null||p===undefined||isNaN(p)) return '#CC0000'; p=Math.abs(p); return p < 30 ? '#1A7A4A' : p < 60 ? '#C07000' : p < 85 ? '#E85D04' : '#CC0000'; }
function isBudgetNoExpense(code) {
  const meta = PU_META.find(p => p.code === code);
  if (!isActiveDisplayPU(meta)) return false;
  const c = compute(code);
  return c.budget > 0 && Math.abs(c.totalCommitted || 0) === 0;
}
function getRowClass(pu) {
  const focusClass = isImportantPU(pu.code) ? ' important-pu-row' : '';
  if (pu.isNeg) return 'neg-row' + focusClass;
  if (isBudgetNoExpense(pu.code)) return 'no-exp-row' + focusClass;
  if (pu.puType==='Staff PU' && pu.liab==='Committed') return 'cs-row' + focusClass;
  if (pu.liab==='Committed') return 'co-row' + focusClass;
  return 'pl-row' + focusClass;
}
function puBadge(t) {
  if (t.includes('Staff PU') && !t.includes('Non')) return `<span class="badge b-staff">Staff PU</span>`;
  if (t.includes('Contractual')) return `<span class="badge b-ctr">Contractual</span>`;
  return `<span class="badge b-ns">Non Staff PU</span>`;
}
function liabBadge(l) {
  if (l==='Recovery') return `<span class="badge b-neg">Recovery</span>`;
  if (l==='Committed') return `<span class="badge b-cg">Committed</span>`;
  return `<span class="badge b-pl">Planned</span>`;
}

// ═══════════════════════════════════════════════
// FILTER HELPERS
// ═══════════════════════════════════════════════
function getFiltered() {
  const tf = document.getElementById('typeFilter').value;
  const lf = document.getElementById('liabFilter').value;
  const af = document.getElementById('activityFilter') ? document.getElementById('activityFilter').value : 'all';
  const uc = document.getElementById('utilCompare') ? document.getElementById('utilCompare').value : 'all';
  const uvRaw = document.getElementById('utilPctFilter') ? document.getElementById('utilPctFilter').value : '';
  const uv = uvRaw === '' ? null : Number(uvRaw);
  return activePUMeta().filter(pu => {
    if (!passesPUFocus(pu.code)) return false;
    if (tf !== 'all') {
      if (tf === 'Staff'     && pu.puType !== 'Staff PU')     return false;
      if (tf === 'Non Staff' && pu.puType !== 'Non Staff PU') return false;
    }
    if (lf !== 'all' && pu.liab !== lf) return false;
    if (af === 'budget-no-exp' && !isBudgetNoExpense(pu.code)) return false;
    if (uc !== 'all' && uv !== null && !isNaN(uv)) {
      const c = compute(pu.code);
      const util = c.utilisedPct != null ? Math.abs(c.utilisedPct) : 0;
      if (uc === 'above' && util < uv) return false;
      if (uc === 'below' && util > uv) return false;
    }
    return true;
  });
}

// ═══════════════════════════════════════════════
// SUMMARY CARDS
// ═══════════════════════════════════════════════
function renderCards() {
  const pus = activePUMeta();
  let totB=0, totC=0, totBal=0;
  pus.forEach(pu => {
    const c = compute(pu.code);
    totB += c.budget; totC += c.totalCommitted; totBal += c.balanceBudget;
  });
  const {cur, futureMonths} = getMonthStatus();
  const netBudget = totB; // Net = Gross (PU-98 excluded from main)
  const util = pct(totC, totB);
  document.getElementById('summaryCards').innerHTML = `
    <div class="card g"><div class="cl">Gross Effective Budget</div>
      <div class="cv">${fmtCr(totB)}</div><div class="cs2">${Math.round(totB).toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="card gold"><div class="cl">Net Budget (excl. Recoveries)</div>
      <div class="cv">${fmtCr(netBudget)}</div><div class="cs2">${Math.round(netBudget).toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="card a"><div class="cl">Total Committed (Till ${cur.label})</div>
      <div class="cv">${fmtCr(totC)}</div><div class="cs2">${util}% of gross budget</div></div>
    <div class="card"><div class="cl">Balance Available</div>
      <div class="cv">${fmtCr(totBal)}</div><div class="cs2">Includes ${cur.label} remaining + ${futureMonths.length} future months</div></div>
    <div class="card"><div class="cl">${isRGActive()?'RG where allotted; otherwise BG_ISL':'Budget Mode'}</div>
      <div class="cv" style="font-size:14px">${isRGActive()?'RG':'BG_ISL'}</div>
      <div class="cs2">${isRGActive()?'Selected separately for each PU':'BG until RG is allotted'}</div></div>
  `;
  document.getElementById('rgNote').textContent = isRGActive() ? 'RG where allotted; otherwise BG_ISL' : 'RG not active - using BG_ISL';
}

// ═══════════════════════════════════════════════
// JUNE (CURRENT MONTH) PROGRESS BARS
// ═══════════════════════════════════════════════
function renderLiabilityHeader() {
  const {cur, actualMonths, futureMonths} = getMonthStatus();
  const topPast = actualMonths.map(m => {
    const idx = FY_MONTHS.indexOf(m), lbl = FY_MONTH_LABELS[idx], yr = idx <= 8 ? 2026 : 2027;
    return `<th class="sub" colspan="1">${lbl} ${yr}</th>`;
  }).join('');
  const subPast = actualMonths.map(m => {
    const idx = FY_MONTHS.indexOf(m), lbl = FY_MONTH_LABELS[idx];
    return `<th class="sub" style="min-width:90px">${lbl} Actual<br>(Rs'000s)</th>`;
  }).join('');
  const firstFuture = futureMonths.length ? FY_MONTH_LABELS[FY_MONTHS.indexOf(futureMonths[0])] : cur.label;
  document.getElementById('liab-thead').innerHTML = `
    <tr>
      <th class="la" rowspan="2">PU</th>
      <th class="la" rowspan="2" style="min-width:160px">Description</th>
      <th class="la" rowspan="2">PU Type</th>
      <th class="la" rowspan="2">Liability</th>
      <th rowspan="2">Budget<br>(Rs'000s)</th>
      ${topPast}
      <th class="sub" colspan="4" id="curMonHdr" style="background:rgba(244,169,50,.15)">${cur.label} ${cur.year} - Till Date Exp + Remaining</th>
      <th rowspan="2">Total Committed<br>(Rs'000s)</th>
      <th rowspan="2">Balance Budget<br>(Rs'000s)</th>
      <th rowspan="2">Proj./Month<br>${futureMonths.length ? firstFuture + '-MAR' : 'Completed'} (Rs'000s)</th>
      <th rowspan="2">% Utilised</th>
      <th rowspan="2">Status</th>
    </tr>
    <tr>
      ${subPast}
      <th class="sub" style="min-width:100px">${cur.label} till date exp<br>(Rs'000s)</th>
      <th class="sub" style="min-width:90px">${cur.label}<br>Remaining</th>
      <th class="sub" style="min-width:90px">${cur.label} Total<br>(Rs'000s)</th>
      <th class="sub">% Done</th>
    </tr>`;
}

function renderJuneBars() {
  const {cur, actualMonths, futureMonths} = getMonthStatus();
  document.getElementById('curMonLabel').textContent = `${cur.label} ${cur.year}`;
  const badge = document.getElementById('curMonBadge');
  if (badge) badge.textContent = `${cur.label} ${cur.year}`;
  const asOn = document.getElementById('asOnLabel');
  if (asOn) asOn.textContent = `As on: ${formatAsOnDate(_dataAsOnDate)}`;
  const noteFormula = document.getElementById('noteFormulaText');
  if (noteFormula) {
    const actualText = actualMonths.map(m => `${FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]} Actual`).join(' + ') || 'No completed-month actual';
    const nextText = futureMonths.length
      ? `Balance after ${cur.label} Total / ${futureMonths.length} remaining months (${FY_MONTH_LABELS[FY_MONTHS.indexOf(futureMonths[0])]}-MAR) = Projected per month`
      : `FY completed after ${cur.label}`;
    noteFormula.textContent = `${actualText} + ${cur.label} ${cur.year} Till-Date Exp + ${cur.label} ${cur.year} Remaining = ${cur.label} ${cur.year} Total Liability | ${nextText}.`;
  }
  const el = document.getElementById('curMonHdr');
  if (el) el.textContent = `${cur.label} ${cur.year} - till date exp`;

  let html = '';
  const showPUs = activePUMeta()
    .map(p => ({p, c:compute(p.code)}))
    .filter(({c}) => c.budget !== 0 || c.totalCommitted !== 0)
    .sort((a,b) => {
      const au = a.c.utilisedFlag === 'no-budget' && a.c.totalCommitted !== 0 ? 9999 : Math.abs(a.c.utilisedPct || 0);
      const bu = b.c.utilisedFlag === 'no-budget' && b.c.totalCommitted !== 0 ? 9999 : Math.abs(b.c.utilisedPct || 0);
      return bu - au || Math.abs(b.c.totalCommitted) - Math.abs(a.c.totalCommitted);
    })
    .slice(0, 14);

  showPUs.forEach(({p: pu, c}) => {
    const pctVal = c.utilisedPct !== null ? Math.abs(c.utilisedPct) : 0;
    const col    = c.utilisedFlag==='over'||c.utilisedFlag==='no-budget' ? '#CC0000'
                 : pctVal>85 ? '#E85D04' : pctVal>60 ? '#C07000' : '#1A7A4A';
    const flag   = '';
    const lbl    = c.utilisedFlag==='no-budget' ? 'No Budget' : pctVal.toFixed(1)+'%';
    html += `<div class="prog-item" data-pu="${pu.code}" style="cursor:pointer">
      <div class="prog-lbl">PU-${pu.code}: ${pu.desc.substring(0,22)}${flag}</div>
      <div class="prog-wrap"><div class="prog-fill" style="width:${Math.min(100,pctVal)}%;background:${col}"></div></div>
      <div class="prog-pct" style="color:${col}">${lbl}</div></div>`;
  });
  document.getElementById('juneBars').innerHTML = html;
}

function renderSummaryPage() {
  const cardSrc = document.getElementById('summaryCards');
  const cardDest = document.getElementById('summaryPageCards');
  if (cardSrc && cardDest) cardDest.innerHTML = cardSrc.innerHTML;

  const barSrc = document.getElementById('juneBars');
  const barDest = document.getElementById('summaryPageBars');
  if (barSrc && barDest) barDest.innerHTML = barSrc.innerHTML || '<div class="summary-empty">No utilisation progress data available.</div>';

  const {cur, actualMonths, futureMonths} = getMonthStatus();
  const curLbl = document.getElementById('summaryCurMonLabel');
  if (curLbl) curLbl.textContent = `${cur.label} ${cur.year}`;
  const meta = document.getElementById('summaryMeta');
  if (meta) {
    const months = actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).join(', ') || 'No completed month';
    meta.textContent = `As on ${cur.label} ${cur.year}; completed actual months: ${months}. Future projection covers ${futureMonths.length} month(s).`;
  }

  const rows = reportRowsForActivePUs();
  const highRisk = rows.filter(r => r.high).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const noExpense = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget);
  const overBudget = rows.filter(r => r.over).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const bcRows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  const askTotal = bcRows.reduce((s,r) => s + (r.askAmount || 0), 0);
  const surrenderTotal = bcRows.reduce((s,r) => s + (r.surrenderAmount || 0), 0);
  const topAsk = bcRows.filter(r => r.askAmount > 0).sort((a,b) => b.askAmount - a.askAmount)[0];
  const topSurrender = bcRows.filter(r => r.surrenderAmount > 0).sort((a,b) => b.surrenderAmount - a.surrenderAmount)[0];
  const topUtil = rows.slice().sort((a,b) => b.utilPct - a.utilPct)[0];
  const points = [
    ['High / Watch PUs', String(highRisk.length), highRisk[0] ? `Top: PU-${highRisk[0].pu.code} ${highRisk[0].pu.desc}` : 'No high-risk PU at present', 'risk'],
    ['Over Budget', String(overBudget.length), overBudget[0] ? `PU-${overBudget[0].pu.code}: ${textCr(Math.abs(overBudget[0].balance))} over` : 'No over-budget PU shown', 'danger'],
    ['Budget, No Expense', String(noExpense.length), noExpense[0] ? `Largest: PU-${noExpense[0].pu.code} ${textCr(noExpense[0].budget)}` : 'No budget-without-expense item', 'warn'],
    ['Amount to Ask', textCr(askTotal), topAsk ? `Top ask: PU-${topAsk.pu.code} ${textCr(topAsk.askAmount)}` : 'No additional grant projected', 'danger'],
    ['Possible Surrender', textCr(surrenderTotal), topSurrender ? `Top saving: PU-${topSurrender.pu.code} ${textCr(topSurrender.surrenderAmount)}` : 'No surrender signal projected', 'good'],
    ['Top Utilisation', topUtil ? `${topUtil.utilPct.toFixed(1)}%` : '0.0%', topUtil ? `PU-${topUtil.pu.code} ${topUtil.pu.desc}` : 'No utilisation data', 'risk']
  ];
  const pointBox = document.getElementById('summaryMainPoints');
  if (pointBox) {
    pointBox.innerHTML = points.map(([label,value,note,cls]) => `
      <div class="summary-point ${cls}">
        <div class="summary-point-label">${htmlSafe(label)}</div>
        <div class="summary-point-value">${htmlSafe(value)}</div>
        <div class="summary-point-note">${htmlSafe(note)}</div>
      </div>`).join('');
  }

  const note = document.getElementById('summaryPageNote');
  const formula = (document.getElementById('noteFormulaText') || {}).textContent || '';
  if (note) {
    note.innerHTML = `
      <strong>Figures:</strong> Stored in Rs '000s. <strong>Budget:</strong> ${isRGActive() ? 'RG where allotted; otherwise BG_ISL' : 'BG_ISL active until RG is available'}.
      <strong>Liability Formula:</strong> ${htmlSafe(formula)}
      <strong>Excluded:</strong> PU-72, PU-73, PU-74, PU-75 GST heads and PU-98 recoveries are excluded from normal operational display.`;
  }
}

function handleAIDashboardJump(tab) {
  if (!tab) return;
  const sel = document.getElementById('aiDashClassicSelect');
  if (sel) sel.value = '';
  switchTab(tab);
}

function renderAIDashboard() {
  const kpis = document.getElementById('aiDashKpis');
  if (!kpis) return;
  const rows = reportRowsForActivePUs();
  const bcRows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget;
    t.actual += r.actual;
    t.balance += r.balance;
    return t;
  }, {budget:0, actual:0, balance:0});
  const util = totals.budget ? (totals.actual / totals.budget) * 100 : 0;
  const highWatch = rows.filter(r => r.high).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const over = rows.filter(r => r.over).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const noExpense = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget);
  const topUtil = rows.slice().sort((a,b) => b.utilPct - a.utilPct)[0];
  const askTotal = bcRows.reduce((s,r) => s + (r.askAmount || 0), 0);
  const surrenderTotal = bcRows.reduce((s,r) => s + (r.surrenderAmount || 0), 0);
  const topAsk = bcRows.filter(r => r.askAmount > 0).sort((a,b) => b.askAmount - a.askAmount)[0];
  const topSurrender = bcRows.filter(r => r.surrenderAmount > 0).sort((a,b) => b.surrenderAmount - a.surrenderAmount)[0];
  const {cur, actualMonths} = getMonthStatus();
  const meta = document.getElementById('aiDashMeta');
  if (meta) meta.textContent = `Current control view as on ${cur.label} ${cur.year}; ${actualMonths.length} completed month(s) used for trend signals. Classic tables remain available from the selector.`;

  kpis.innerHTML = [
    ['Gross Budget', textCr(totals.budget), 'Operational active PUs', 'good'],
    ['Actual Till Date', textCr(totals.actual), `${util.toFixed(1)}% utilised`, util >= 85 ? 'risk' : 'good'],
    ['High / Watch PUs', String(highWatch.length), highWatch[0] ? `Top: PU-${highWatch[0].pu.code}` : 'No watch signal', 'risk'],
    ['Amount to Ask', textCr(askTotal), topAsk ? `PU-${topAsk.pu.code} is highest` : 'No ask projected', 'danger'],
    ['Possible Surrender', textCr(surrenderTotal), topSurrender ? `PU-${topSurrender.pu.code} is highest` : 'No surrender signal', 'good'],
    ['No Expense Budget', String(noExpense.length), noExpense[0] ? `Largest PU-${noExpense[0].pu.code}` : 'No item', 'warn']
  ].map(([label,value,note,cls]) => `<div class="ai-dash-kpi ${cls}"><span>${htmlSafe(label)}</span><strong>${htmlSafe(value)}</strong><small>${htmlSafe(note)}</small></div>`).join('');

  const priority = document.getElementById('aiDashPriority');
  if (priority) {
    const priorityRows = highWatch.slice(0, 8);
    priority.innerHTML = priorityRows.length ? priorityRows.map(r => {
      const cls = r.over ? 'danger' : r.utilPct >= 85 ? 'risk' : r.noExpense ? 'warn' : 'normal';
      const remark = r.over ? `Over by ${textCr(Math.abs(r.balance))}`
        : r.noExpense ? `Budget ${textCr(r.budget)} but no expense`
        : `Utilisation ${r.utilPct.toFixed(1)}%`;
      return `<button type="button" class="ai-priority-row ${cls}" onclick="openPUDetail('${r.pu.code}')">
        <span>PU-${htmlSafe(r.pu.code)}</span><strong>${htmlSafe(r.pu.desc)}</strong><em>${htmlSafe(remark)}</em>
      </button>`;
    }).join('') : '<div class="ai-empty">No priority watch signal available.</div>';
  }

  const actions = document.getElementById('aiDashActions');
  if (actions) {
    const actionLines = [
      over.length ? `Control booking in ${over.length} over-budget PU(s), starting with PU-${over[0].pu.code}.` : 'No over-budget PU is visible in current operational view.',
      noExpense.length ? `Review ${noExpense.length} budget-with-no-expense PU(s) for pending liability or surrender.` : 'No major budget-without-expense signal at present.',
      askTotal > 0 ? `Examine ${textCr(askTotal)} as possible amount to ask through budget review process.` : 'No net additional grant ask is projected by current control rule.',
      surrenderTotal > 0 ? `Confirm pending bills before treating ${textCr(surrenderTotal)} as possible surrender.` : 'No surrender signal is projected by current control rule.',
      topUtil ? `Top utilisation is PU-${topUtil.pu.code} at ${topUtil.utilPct.toFixed(1)}%; use click-through for PU detail.` : 'No utilisation signal available.'
    ];
    actions.innerHTML = `<ul class="ai-action-list">${actionLines.map(x => `<li>${htmlSafe(x)}</li>`).join('')}</ul>`;
  }

  const askBox = document.getElementById('aiDashAskSurrender');
  if (askBox) {
    const max = Math.max(askTotal, surrenderTotal, 1);
    askBox.innerHTML = `
      <div class="ai-balance-row"><span>Amount to Ask</span><strong>${textCr(askTotal)}</strong><div><i style="width:${Math.min(100,(askTotal/max)*100)}%"></i></div><small>${topAsk ? `Top ask: PU-${topAsk.pu.code} ${textCr(topAsk.askAmount)}` : 'No additional grant projected'}</small></div>
      <div class="ai-balance-row surrender"><span>Possible Surrender</span><strong>${textCr(surrenderTotal)}</strong><div><i style="width:${Math.min(100,(surrenderTotal/max)*100)}%"></i></div><small>${topSurrender ? `Top saving: PU-${topSurrender.pu.code} ${textCr(topSurrender.surrenderAmount)}` : 'No surrender signal projected'}</small></div>`;
  }

  const utilBox = document.getElementById('aiDashUtilisation');
  if (utilBox) {
    const utilRows = rows.slice().sort((a,b) => b.utilPct - a.utilPct).slice(0, 10);
    utilBox.innerHTML = utilRows.map(r => {
      const col = r.utilPct >= 100 ? '#B00020' : r.utilPct >= 85 ? '#E85D04' : r.utilPct >= 60 ? '#C07000' : '#1A7A4A';
      return `<div class="ai-util-row" onclick="openPUDetail('${r.pu.code}')">
        <div><strong>PU-${htmlSafe(r.pu.code)} ${htmlSafe(r.pu.desc)}</strong><span>${htmlSafe(r.pu.puType)} | ${htmlSafe(r.pu.liab)}</span></div>
        <div class="ai-util-bar"><i style="width:${Math.min(100, Math.max(0, r.utilPct))}%;background:${col}"></i></div>
        <b style="color:${col}">${r.utilPct.toFixed(1)}%</b>
      </div>`;
    }).join('');
  }
}

const REPORT_VIEW_MODE_KEY = 'nrzone_report_view_mode';
let reportViewMode = 'classic';
const BI_ALLOWED_TABS = new Set(['trend', 'aitrend']);

function isBIViewAllowed(tab = activeTabName()) {
  return BI_ALLOWED_TABS.has(tab);
}

function currentReportTitle(tab) {
  if(tab==='zonalfr')return {title:document.getElementById('frReviewHeading')?.textContent||'ZONAL FR Review',sub:'Financial review through 30 September 2026'};
  const label = REPORT_LABELS[tab] || ['Current Report', 'Report view'];
  return {title: label[0], sub: label[1]};
}

function biKpi(label, value, note, cls) {
  return `<div class="bi-kpi ${cls || ''}"><span>${htmlSafe(label)}</span><strong>${htmlSafe(value)}</strong><small>${htmlSafe(note || '')}</small></div>`;
}

function biBars(rows, valueKey, labelFn, noteFn, clsFn) {
  const max = Math.max(1, ...rows.map(r => Math.abs(Number(r._barValue ?? r[valueKey]) || 0)));
  return rows.map(r => {
    const val = Math.abs(Number(r._barValue ?? r[valueKey]) || 0);
    const width = Math.min(100, (val / max) * 100);
    const cls = clsFn ? clsFn(r) : '';
    return `<button type="button" class="bi-bar-row ${cls}" onclick="${r.pu ? `openPUDetail('${r.pu.code}')` : ''}">
      <div><strong>${htmlSafe(labelFn(r))}</strong><span>${htmlSafe(noteFn ? noteFn(r) : '')}</span></div>
      <div class="bi-bar-track"><i style="width:${width}%"></i></div>
      <b>${htmlSafe(r._displayValue || textCr(val))}</b>
    </button>`;
  }).join('') || '<div class="bi-empty">No rows available for this view.</div>';
}

function biMonthlyPattern() {
  const active = activePUMeta();
  const {cur} = getMonthStatus();
  const values = FY_MONTHS.map(m => active.reduce((s, pu) => s + (((MONTH[pu.code] || {})[m]) || 0), 0));
  const max = Math.max(1, ...values);
  return FY_MONTHS.map((m, idx) => {
    const val = values[idx] || 0;
    const pct = Math.max(3, Math.min(100, (val / max) * 100));
    const isCur = idx === cur.idx;
    const isFuture = idx > cur.idx;
    return `<span class="${isCur ? 'current' : isFuture ? 'future' : ''}" style="height:${pct}%"><em>${FY_MONTH_LABELS[idx].slice(0,3)}</em></span>`;
  }).join('');
}

function biVisualWidgets(tab, data) {
  const rows = reportRowsForActivePUs();
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget;
    t.actual += r.actual;
    t.staff += r.pu.puType === 'Staff PU' ? r.actual : 0;
    t.nonStaff += r.pu.puType === 'Non Staff PU' ? r.actual : 0;
    return t;
  }, {budget:0, actual:0, staff:0, nonStaff:0});
  const util = totals.budget ? (totals.actual / totals.budget) * 100 : 0;
  const utilClamp = Math.max(0, Math.min(100, util));
  const over = rows.filter(r => r.over).length;
  const noExp = rows.filter(r => r.noExpense).length;
  const controlRows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  const ask = controlRows.reduce((s, r) => s + (r.askAmount || 0), 0);
  const surrender = controlRows.reduce((s, r) => s + (r.surrenderAmount || 0), 0);
  const totalMix = Math.max(1, ask + surrender);
  const staffShare = totals.actual ? (totals.staff / totals.actual) * 100 : 0;
  const nonStaffShare = Math.max(0, 100 - staffShare);
  return `
    <div class="bi-visual-strip">
      <div class="bi-widget gauge">
        <div class="bi-widget-label">Utilisation Gauge</div>
        <div class="bi-donut" style="--p:${utilClamp.toFixed(1)}"><strong>${util.toFixed(1)}%</strong><span>Budget used</span></div>
      </div>
      <div class="bi-widget pattern">
        <div class="bi-widget-label">Monthly Actual Pattern</div>
        <div class="bi-month-bars">${biMonthlyPattern()}</div>
      </div>
      <div class="bi-widget mix">
        <div class="bi-widget-label">Control Mix</div>
        <div class="bi-mix-row"><span>Ask</span><div><i class="ask" style="width:${Math.min(100,(ask/totalMix)*100)}%"></i></div><b>${textCr(ask)}</b></div>
        <div class="bi-mix-row"><span>Surrender</span><div><i class="surrender" style="width:${Math.min(100,(surrender/totalMix)*100)}%"></i></div><b>${textCr(surrender)}</b></div>
        <div class="bi-alert-line">${over} over-budget PU(s), ${noExp} no-expense PU(s)</div>
      </div>
      <div class="bi-widget mix">
        <div class="bi-widget-label">Staff vs Non-Staff Actual</div>
        <div class="bi-mix-row"><span>Staff</span><div><i class="staff" style="width:${staffShare.toFixed(1)}%"></i></div><b>${staffShare.toFixed(1)}%</b></div>
        <div class="bi-mix-row"><span>Non-Staff</span><div><i class="nonstaff" style="width:${nonStaffShare.toFixed(1)}%"></i></div><b>${nonStaffShare.toFixed(1)}%</b></div>
        <div class="bi-alert-line">${htmlSafe((currentReportTitle(tab) || {}).title || 'Report')} visual reading</div>
      </div>
    </div>`;
}

function trendDecisionRows() {
  return reportRowsForActivePUs().filter(r => r.pu && passesPUFocus(r.pu.code));
}

function trendControlRows() {
  const rows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  return rows.filter(r => r.pu && passesPUFocus(r.pu.code));
}

function filteredSMHRowsForBI() {
  const data = window.DETAIL_SMH_DATA;
  if (!data || !Array.isArray(data.rows)) return [];
  const dept = (document.getElementById('smhDeptFilter') || {}).value || 'all';
  const smh = (document.getElementById('smhCodeFilter') || {}).value || 'all';
  const selectedPUs = smhSelectedCodes();
  const activityFilter = (document.getElementById('activityFilter') || {}).value || 'all';
  return data.rows.filter(r =>
    !isSkippedDisplayPU(r.puCode) &&
    passesPUFocus(r.puCode) &&
    (dept === 'all' || r.deptCode === dept) &&
    (smh === 'all' || r.smh === smh) &&
    (selectedPUs.includes('all') || selectedPUs.includes(r.puCode)) &&
    (activityFilter !== 'budget-no-exp' || isSMHBudgetNoExpense(r))
  );
}

function biDataForCurrentReport(tab) {
  const rows = reportRowsForActivePUs();
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget;
    t.actual += r.actual;
    t.balance += r.balance;
    return t;
  }, {budget:0, actual:0, balance:0});
  totals.util = totals.budget ? (totals.actual / totals.budget) * 100 : 0;
  const over = rows.filter(r => r.over).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const noExpense = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget);
  const topUtil = rows.filter(r => r.budget > 0).sort((a,b) => b.utilPct - a.utilPct);
  const bcRows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  const askTotal = bcRows.reduce((s,r) => s + (r.askAmount || 0), 0);
  const surrenderTotal = bcRows.reduce((s,r) => s + (r.surrenderAmount || 0), 0);
  const base = {
    kpis: [
      ['Gross Budget', textCr(totals.budget), 'Current operational budget', 'good'],
      ['Actual Till Date', textCr(totals.actual), `${totals.util.toFixed(1)}% utilised`, totals.util >= 85 ? 'risk' : 'good'],
      ['Balance', textCr(totals.balance), totals.balance < 0 ? 'Over spent' : 'Available budget', totals.balance < 0 ? 'danger' : 'good'],
      ['Watch Items', String(over.length + noExpense.length), 'Over budget + no-expense signals', 'warn']
    ],
    bars: topUtil.slice(0, 8).map(r => Object.assign({_displayValue: r.utilPct.toFixed(1) + '%'}, r)),
    barsTitle: 'Top Utilisation',
    actions: [
      over[0] ? `First control point: PU-${over[0].pu.code} is over by ${textCr(Math.abs(over[0].balance))}.` : 'No over-budget PU in the current visible dataset.',
      noExpense[0] ? `Review PU-${noExpense[0].pu.code}: budget ${textCr(noExpense[0].budget)} but no expense booked.` : 'No budget-without-expense signal in the current view.',
      askTotal ? `Budget Control projects ${textCr(askTotal)} as amount to ask, subject to verification.` : 'No net additional grant ask is projected from current budget control rule.',
      surrenderTotal ? `Possible surrender signal is ${textCr(surrenderTotal)} after pending liability verification.` : 'No surrender signal is projected from current budget control rule.'
    ],
    focusRows: over.concat(noExpense).slice(0, 6)
  };

  if (tab === 'pumaster') {
    const meta = activePUMeta();
    const staff = meta.filter(p => p.puType === 'Staff PU').length;
    const nonStaff = meta.filter(p => p.puType === 'Non Staff PU').length;
    const committed = meta.filter(p => p.liab === 'Committed').length;
    const planned = meta.filter(p => p.liab === 'Planned').length;
    return Object.assign(base, {
      kpis: [
        ['Active PUs', String(meta.length), 'After exclusions applied', 'good'],
        ['Staff / Non-Staff', `${staff} / ${nonStaff}`, 'Classification in PU master', ''],
        ['Committed', String(committed), 'Committed liability PUs', 'risk'],
        ['Planned', String(planned), 'Planned / controllable PUs', 'warn']
      ],
      barsTitle: 'Highest Budget PUs',
      bars: rows.slice().sort((a,b) => b.budget - a.budget).slice(0, 8),
      actions: [
        'PU Master BI view checks classification strength before using report filters.',
        'Staff committed PUs are generally less flexible; planned non-staff PUs are better for control review.',
        'GST heads PU-72 to PU-75 and PU-98 recoveries remain excluded from operational display.',
        'Click a PU row below to open the existing detailed PU drill-down.'
      ],
      focusRows: rows.slice().sort((a,b) => b.budget - a.budget).slice(0, 6)
    });
  }

  if (tab === 'smhdetail') {
    const smhRows = filteredSMHRowsForBI();
    const smhTotals = makeDetailTotal(smhRows);
    const balance = smhTotals.budget - smhTotals.actualTill;
    const util = smhTotals.budget ? (smhTotals.actualTill / smhTotals.budget) * 100 : 0;
    const deptGroups = aggregateDetailRows(smhRows, 'dept').sort((a,b) => b.actualTill - a.actualTill);
    const noExp = smhRows.filter(r => isSMHBudgetNoExpense(r)).sort((a,b) => b.budget - a.budget);
    const overRows = smhRows.filter(r => (Number(r.actualTill)||0) > (Number(r.budget)||0)).sort((a,b) => (b.actualTill-b.budget) - (a.actualTill-a.budget));
    return Object.assign(base, {
      kpis: [
        ['Department wise Budget', detailCr(smhTotals.budget), `${smhRows.length} detail rows`, 'good'],
        ['Actual Till Date', detailCr(smhTotals.actualTill), `${util.toFixed(1)}% utilised`, util >= 85 ? 'risk' : 'good'],
        ['Balance', detailCr(balance), balance < 0 ? 'Over spent' : 'Budget minus actual', balance < 0 ? 'danger' : 'good'],
        ['No Expense Lines', String(noExp.length), 'Budget available, no expense', 'warn']
      ],
      barsTitle: 'Department Actual Share',
      bars: deptGroups.slice(0, 8).map(r => ({_displayValue: detailCr(r.actualTill), dept:r.deptName, code:r.deptCode, actualTill:r.actualTill, budget:r.budget})),
      actions: [
        overRows[0] ? `Highest SMH overrun: ${overRows[0].deptCode} ${overRows[0].deptName}, PU-${overRows[0].puCode}.` : 'No SMH line has crossed budget in the selected view.',
        noExp[0] ? `Largest budget-with-no-expense line: ${noExp[0].deptCode} ${noExp[0].deptName}, PU-${noExp[0].puCode}.` : 'No budget-with-no-expense SMH line in selected filters.',
        'Use Classic Table when DEPT > Demand > PU line-by-line checking is required.',
        'BI-AI view is for officer-level signal reading; it follows the same current filters.'
      ],
      focusRows: overRows.slice(0, 6).map(r => ({label:`${r.deptCode} ${r.deptName}`, desc:`${r.smh} | PU-${r.puCode} ${r.puName}`, value:detailCr((r.actualTill||0)-(r.budget||0)), cls:'danger'}))
    });
  }

  if (tab === 'demandsmh') {
    const dRows = demandSMHOperationalRows();
    const dTotals = demandSMHTotals();
    const dSuspense = demandSMHSuspenseRows()[0];
    const excess = dRows.filter(r => (Number(r.variation) || 0) > 0).sort((a,b) => b.variation - a.variation);
    const saving = dRows.filter(r => (Number(r.variation) || 0) < 0).sort((a,b) => Math.abs(b.variation) - Math.abs(a.variation));
    const highUtil = dRows.slice().sort((a,b) => (Number(b.bpPct) || 0) - (Number(a.bpPct) || 0));
    return Object.assign(base, {
      kpis: [
        ['Effective OBA', detailCr(dTotals.oba), 'Current year effective budget allocation', 'good'],
        ['BP Value', detailCr(dTotals.bp), 'BG / 12 x completed months', ''],
        [`AE up to ${bpMode.bpThrough ? bpMode.bpThrough.label : 'completed month'}`, detailCr(dTotals.ae), `${dTotals.bpPct}% of BP`, dTotals.bpPct >= 100 ? 'risk' : 'good'],
        ['Budget Remaining', detailCr(dTotals.budgetRemaining), `${dTotals.obaUtil}% OBA utilised`, dTotals.budgetRemaining < 0 ? 'danger' : 'good']
      ],
      barsTitle: 'Demand / SMH BP Utilisation',
      bars: highUtil.slice(0, 8).map(r => ({label:demandSMHLabel(r), dept:r.dept, utilPct:Number(r.bpPct)||0, _displayValue:`${detailNum(r.bpPct)}%`, _barValue:Math.abs(Number(r.bpPct)||0)})),
      actions: [
        excess[0] ? `Highest excess against BP: ${demandSMHLabel(excess[0])} by ${detailCr(excess[0].variation)}.` : 'No excess against BP in Demand / SMH summary.',
        saving[0] ? `Largest saving against BP: ${demandSMHLabel(saving[0])} by ${detailCr(Math.abs(saving[0].variation))}.` : 'No saving against BP in Demand / SMH summary.',
        'OBA uses RG on each source row when available, otherwise BG_ISL.',
        `AE uses completed actual months up to ${bpMode.bpThrough ? `${bpMode.bpThrough.label} ${bpMode.bpThrough.year}` : 'the latest closed month'}; ${getMonthStatus().cur.label} ${getMonthStatus().cur.year} is treated as the running month.`,
        dSuspense ? `${demandSMHLabel(dSuspense)} Suspense Heads is separately calculated: AE ${detailCr(dSuspense.ae)}.` : 'Suspense Heads row is kept outside main Demand / SMH total.'
      ],
      focusRows: excess.concat(saving).slice(0, 6).map(r => ({
        label:demandSMHLabel(r),
        desc:r.dept,
        value:signedCr(r.variation),
        cls:(Number(r.variation)||0) > 0 ? 'danger' : ''
      }))
    });
  }

  if (tab === 'bpanalysis') {
    const bpRows = typeof getFilteredBPRows === 'function' ? getFilteredBPRows() : [];
    const excess = bpRows.filter(r => r.variance > 0).sort((a,b) => b.variance - a.variance);
    const saving = bpRows.filter(r => r.variance < 0).sort((a,b) => Math.abs(b.variance) - Math.abs(a.variance));
    const bpTotals = bpRows.reduce((t,r) => { t.budget += r.budget; t.bp += r.bp; t.actual += r.actualTill; t.var += r.variance; return t; }, {budget:0,bp:0,actual:0,var:0});
    return Object.assign(base, {
      kpis: [
        ['Budget Grant', textCr(bpTotals.budget), 'Selected PU set', 'good'],
        ['BP Value', textCr(bpTotals.bp), 'BG / 12 x completed months', ''],
        ['Actual Till Date', textCr(bpTotals.actual), 'Against BP', bpTotals.actual > bpTotals.bp ? 'risk' : 'good'],
        ['Excess / Saving', signedCr(bpTotals.var), bpTotals.var > 0 ? 'Excess vs BP' : 'Saving vs BP', bpTotals.var > 0 ? 'danger' : 'good']
      ],
      barsTitle: 'BP Excess / Saving Signals',
      bars: excess.concat(saving).slice(0, 8).map(r => Object.assign({_displayValue:signedCr(r.variance)}, r)),
      actions: [
        excess[0] ? `Top BP excess: PU-${excess[0].pu.code} by ${textCr(excess[0].variance)}.` : 'No BP excess in selected view.',
        saving[0] ? `Top BP saving: PU-${saving[0].pu.code} by ${textCr(Math.abs(saving[0].variance))}.` : 'No BP saving signal in selected view.',
        'BP view treats only completed months as proportionate base.',
        'Use this to decide early saving/excess review before AR/REA stage.'
      ],
      focusRows: excess.concat(saving).slice(0, 6)
    });
  }

  if (tab === 'budgetcontrol') {
    const control = typeof getFilteredBudgetControlRows === 'function' ? getFilteredBudgetControlRows() : bcRows;
    const ask = control.filter(r => r.askAmount > 0).sort((a,b) => b.askAmount - a.askAmount);
    const surrender = control.filter(r => r.surrenderAmount > 0).sort((a,b) => b.surrenderAmount - a.surrenderAmount);
    const ct = control.reduce((t,r) => { t.ceiling += r.ceiling; t.actual += r.actualTill; t.projected += r.projectedRequirement; t.ask += r.askAmount; t.surrender += r.surrenderAmount; return t; }, {ceiling:0,actual:0,projected:0,ask:0,surrender:0});
    return Object.assign(base, {
      kpis: [
        ['Projected Need', textCr(ct.projected), 'Till-date projection', ct.projected > ct.ceiling ? 'risk' : 'good'],
        ['Amount to Ask', textCr(ct.ask), 'Excess above ceiling', ct.ask ? 'danger' : 'good'],
        ['Possible Surrender', textCr(ct.surrender), 'Verify pending bills', 'warn'],
        ['Action Cases', String(ask.length + surrender.length), 'Ask + surrender items', 'good']
      ],
      barsTitle: 'Ask / Surrender Action Board',
      bars: ask.concat(surrender).slice(0, 8).map(r => Object.assign({_displayValue:r.askAmount ? textCr(r.askAmount) : textCr(r.surrenderAmount), _barValue: r.askAmount || r.surrenderAmount}, r)),
      actions: [
        ask[0] ? `Top ask case: PU-${ask[0].pu.code} ${ask[0].pu.desc} needs ${textCr(ask[0].askAmount)}.` : 'No additional grant case in selected control filters.',
        surrender[0] ? `Top surrender candidate: PU-${surrender[0].pu.code} ${surrender[0].pu.desc} ${textCr(surrender[0].surrenderAmount)}.` : 'No surrender candidate in selected control filters.',
        'Budget Control BI view follows the active Indian Railways review stage and focuses on ask/surrender action.',
        'Final ask/surrender should be vetted against pending bills and committed liabilities.'
      ],
      focusRows: ask.concat(surrender).slice(0, 6)
    });
  }

  if (tab === 'aitrend') {
    const aiRows = buildAITrendItems();
    const high = aiRows.filter(x => x.risk === 'high');
    const watch = aiRows.filter(x => x.risk === 'watch');
    const overAI = aiRows.filter(x => x.overSpent).sort((a,b)=>Math.abs(b.cv.balanceBudget)-Math.abs(a.cv.balanceBudget));
    const noExpAI = aiRows.filter(x => x.budgetNoExpense).sort((a,b)=>b.budget-a.budget);
    const control = trendControlRows();
    const ask = control.filter(r => r.askAmount > 0).sort((a,b)=>b.askAmount-a.askAmount);
    const surrender = control.filter(r => r.surrenderAmount > 0).sort((a,b)=>b.surrenderAmount-a.surrenderAmount);
    const move = aiRows.slice().sort((a,b)=>Math.abs((b.cyCur-b.cyPrev)||0)-Math.abs((a.cyCur-a.cyPrev)||0));
    return Object.assign(base, {
      kpis: [
        ['High / Watch PUs', String(high.length + watch.length), `High ${high.length}, Watch ${watch.length}`, high.length ? 'risk' : 'good'],
        ['Over Budget', String(overAI.length), overAI[0] ? `PU-${overAI[0].pu.code}: ${textCr(Math.abs(overAI[0].cv.balanceBudget))}` : 'No overspend', overAI.length ? 'danger' : 'good'],
        ['Budget, No Expense', String(noExpAI.length), noExpAI[0] ? `Largest PU-${noExpAI[0].pu.code} ${textCr(noExpAI[0].budget)}` : 'No such PU', noExpAI.length ? 'warn' : 'good'],
        ['Amount to Ask', textCr(ask.reduce((s,r)=>s+(r.askAmount||0),0)), ask[0] ? `Top PU-${ask[0].pu.code}` : 'No ask signal', ask.length ? 'danger' : 'good']
      ],
      barsTitle: 'AI Risk Priority',
      bars: aiRows.slice(0, 8).map(item => ({
        pu:item.pu,
        utilPct:item.utilPct,
        _barValue: Math.max(Math.abs(item.utilPct), Math.abs(item.cv.balanceBudget || 0) / 10000),
        _displayValue:item.utilPct.toFixed(1) + '%',
        remark:item.risk === 'high' ? 'High Risk' : item.risk === 'watch' ? 'Watch' : 'Normal',
        over:item.overSpent,
        noExpense:item.budgetNoExpense
      })),
      actions: [
        move[0] ? `Largest latest month movement is PU-${move[0].pu.code}: ${signedCr(move[0].cyCur - move[0].cyPrev)} from ${move[0].prevLabel} to ${move[0].curLabel}.` : 'No latest month movement signal available.',
        overAI[0] ? `Immediate control point: PU-${overAI[0].pu.code} is over by ${textCr(Math.abs(overAI[0].cv.balanceBudget))}.` : 'No over-budget AI priority item.',
        noExpAI[0] ? `Budget without expenditure needs confirmation: PU-${noExpAI[0].pu.code}, budget ${textCr(noExpAI[0].budget)}.` : 'No budget-without-expense AI priority item.',
        surrender[0] ? `Possible surrender signal led by PU-${surrender[0].pu.code}: ${textCr(surrender[0].surrenderAmount)}.` : 'No surrender signal under current rule.'
      ],
      focusRows: aiRows.slice(0, 6).map(item => ({pu:item.pu, utilPct:item.utilPct, over:item.overSpent, noExpense:item.budgetNoExpense, balance:item.cv.balanceBudget, remark:item.risk === 'high' ? 'High Risk' : item.risk === 'watch' ? 'Watch' : 'Normal'}))
    });
  }

  if (tab === 'trend' || tab === 'monthwise') {
    const {cur, actualMonths} = getMonthStatus();
    return Object.assign(base, {
      kpis: [
        ['Current Month', `${cur.label} ${cur.year}`, 'Running month detected', ''],
        ['Completed Months', String(actualMonths.length), 'Used for trend/BP reading', 'good'],
        ['Actual Till Date', textCr(totals.actual), `${totals.util.toFixed(1)}% utilisation`, totals.util >= 85 ? 'risk' : 'good'],
        ['Top Util PU', topUtil[0] ? `PU-${topUtil[0].pu.code}` : 'NA', topUtil[0] ? `${topUtil[0].utilPct.toFixed(1)}%` : 'No data', 'risk']
      ],
      barsTitle: 'Current Trend Watch',
      actions: [
        'BI-AI view gives the officer reading; use Graphs tab Classic View for detailed chart inspection.',
        topUtil[0] ? `Highest utilisation is PU-${topUtil[0].pu.code} at ${topUtil[0].utilPct.toFixed(1)}%.` : 'No utilisation signal available.',
        over[0] ? `Overspend trend exists in PU-${over[0].pu.code}; compare CY vs PY before proposal.` : 'No over-budget trend signal in current view.',
        'Trend notes use current portal totals and uploaded month-wise data.'
      ]
    });
  }

  if (tab === 'remarks') {
    return Object.assign(base, {
      kpis: [
        ['Data Year', 'FY 2026-27', 'Current year basis', 'good'],
        ['Previous Year', 'FY 2025-26', 'Trend comparison basis', ''],
        ['Excluded GST PUs', '72-75', 'Operational display skip', 'warn'],
        ['Recovery PU', '98', 'Excluded from expense view', 'warn']
      ],
      barsTitle: 'Source Rule Highlights',
      actions: [
        'Budget Available and Month-wise Actuals feed the main financial tables.',
        'Department wise files feed the Department > Demand > PU report.',
        'Department 00, PU-98 recoveries and GST PU-72 to PU-75 are excluded from normal operational view.',
        'Use Remarks Classic Table for exact source-file naming and rule register.'
      ]
    });
  }
  return base;
}

function renderBIView() {
  const panel = document.getElementById('biViewPanel');
  if (!panel) return;
  const tab = activeTabName();
  const allowed = isBIViewAllowed(tab);
  const showBI = reportViewMode === 'bi' && allowed;
  document.body.classList.toggle('bi-view-active', showBI);
  panel.hidden = !showBI;
  const toggle = document.getElementById('reportViewToggle');
  if (toggle) {
    toggle.classList.toggle('bi-unavailable', !allowed);
    toggle.title = allowed ? 'Switch between classic and BI-AI view' : 'BI-AI view is available only for Graphs and AI Summary';
  }
  document.querySelectorAll('[data-report-view-mode]').forEach(btn => {
    const active = showBI ? btn.dataset.reportViewMode === 'bi' : btn.dataset.reportViewMode === 'classic';
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (!showBI) return;
  const {title, sub} = currentReportTitle(tab);
  const data = biDataForCurrentReport(tab);
  const focus = (data.focusRows || []).map(r => {
    if (r.label) return `<div class="bi-focus ${r.cls || ''}"><strong>${htmlSafe(r.label)}</strong><span>${htmlSafe(r.desc || '')}</span><b>${htmlSafe(r.value || '')}</b></div>`;
    const value = r.over ? `Over ${textCr(Math.abs(r.balance))}` : r.noExpense ? `No expense ${textCr(r.budget)}` : r.askAmount ? `Ask ${textCr(r.askAmount)}` : r.surrenderAmount ? `Surrender ${textCr(r.surrenderAmount)}` : r.variance !== undefined ? signedCr(r.variance) : `${(r.utilPct || 0).toFixed(1)}%`;
    return `<button type="button" class="bi-focus ${r.over || r.askAmount || (r.variance > 0) ? 'danger' : r.noExpense ? 'warn' : ''}" onclick="${r.pu ? `openPUDetail('${r.pu.code}')` : ''}">
      <strong>${r.pu ? `PU-${htmlSafe(r.pu.code)} ${htmlSafe(r.pu.desc)}` : htmlSafe(r.status || r.label || 'Signal')}</strong>
      <span>${htmlSafe(r.remark || r.label || r.status || 'Current report signal')}</span>
      <b>${htmlSafe(value)}</b>
    </button>`;
  }).join('') || '<div class="bi-empty">No priority focus item for the selected filters.</div>';
  panel.innerHTML = `
    <div class="bi-head">
      <div>
        <div class="bi-eyebrow">BI-AI Report View</div>
        <div class="bi-title">${htmlSafe(title)}</div>
        <div class="bi-sub">${htmlSafe(sub)} - visual reading of the same active report and filters.</div>
      </div>
      <button type="button" class="bi-classic-btn" onclick="setReportViewMode('classic')">Back to Classic Table</button>
    </div>
    <div class="bi-kpi-grid">${data.kpis.map(k => biKpi(k[0], k[1], k[2], k[3])).join('')}</div>
    ${biVisualWidgets(tab, data)}
    <div class="bi-layout">
      <div class="bi-card bi-wide">
        <div class="bi-card-title">${htmlSafe(data.barsTitle || 'Report Signals')}</div>
        <div class="bi-bar-list">${biBars(data.bars || [], data.bars && data.bars[0] && data.bars[0].actualTill !== undefined ? 'actualTill' : data.bars && data.bars[0] && data.bars[0].variance !== undefined ? 'variance' : data.bars && data.bars[0] && data.bars[0].askAmount !== undefined ? (data.bars[0].askAmount ? 'askAmount' : 'surrenderAmount') : 'utilPct', r => r.dept ? `${r.code} ${r.dept}` : r.pu ? `PU-${r.pu.code} ${r.pu.desc}` : r.label || 'Signal', r => r.pu ? `${r.pu.puType || ''} ${r.pu.liab || ''}` : r.budget !== undefined ? `Budget ${detailCr ? detailCr(r.budget) : textCr(r.budget)}` : '', r => (r.over || r.askAmount || r.variance > 0) ? 'danger' : r.noExpense ? 'warn' : '')}</div>
      </div>
      <div class="bi-card">
        <div class="bi-card-title">AI-Style Officer Notes</div>
        <ul class="bi-note-list">${(data.actions || []).map(x => `<li>${htmlSafe(x)}</li>`).join('')}</ul>
      </div>
      <div class="bi-card bi-wide">
        <div class="bi-card-title">Priority Focus</div>
        <div class="bi-focus-grid">${focus}</div>
      </div>
    </div>`;
  window.NR_YEAR_COMPARE?.display(tab,panel);
}

function setReportViewMode(mode) {
  const requestedBI = mode === 'bi';
  if (requestedBI && !isBIViewAllowed()) {
    reportViewMode = 'classic';
    showPortalNotice('BI-AI View is available only for Graphs and AI Summary.', 'warn');
  } else {
    reportViewMode = requestedBI ? 'bi' : 'classic';
  }
  try { sessionStorage.setItem(REPORT_VIEW_MODE_KEY, reportViewMode); } catch(e) {}
  document.querySelectorAll('[data-report-view-mode]').forEach(btn => {
    const active = btn.dataset.reportViewMode === reportViewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderBIView();
}

function refreshBIViewSoon() {
  if (reportViewMode === 'bi') setTimeout(renderBIView, 80);
}

function initReportViewMode() {
  try { reportViewMode = sessionStorage.getItem(REPORT_VIEW_MODE_KEY) || 'classic'; } catch(e) { reportViewMode = 'classic'; }
  document.querySelectorAll('[data-report-view-mode]').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => setReportViewMode(btn.dataset.reportViewMode));
  });
  setReportViewMode(reportViewMode);
}

// ═══════════════════════════════════════════════
// LIABILITY TABLE
// ═══════════════════════════════════════════════
function renderLiability() {
  const pus = getFiltered();
  const {cur, actualMonths} = getMonthStatus();
  renderLiabilityHeader();
  let rows='', tB=0,tC=0,tBal=0,tPast={},tJunC=0,tJunR=0,tJunT=0;
  actualMonths.forEach(m => tPast[m]=0);
  pus.forEach(pu => {
    const c = compute(pu.code);
    const md = MONTH[pu.code]||{};
    const pastCells = actualMonths.map(m => {
      const v = md[m] || 0;
      tPast[m] += v;
      return `<td class="n">${fmtT(v)}</td>`;
    }).join('');
    const col = utilColor(c.utilisedPct||0);
    const balCls = c.balanceBudget < 0 ? 'neg' : c.balanceBudget < c.budget*0.1 ? 'low' : 'ok';
    let statusHtml = '';
    const _pct = c.utilisedPct || 0;
    if (isBudgetNoExpense(pu.code)) statusHtml='<span style="color:#8A5A00;font-weight:800">Budget Available, No Expenses</span>';
    else if (c.utilisedFlag==='no-budget') statusHtml='<span style="color:#CC0000;font-weight:700">No Budget</span>';
    else if (c.utilisedFlag==='over') statusHtml=`<span style="color:#CC0000;font-weight:700">Over ${Math.abs(_pct).toFixed(0)}%</span>`;
    else if (c.utilisedFlag==='none') statusHtml='<span style="color:#aaa">Nil</span>';
    else if (_pct > 85) statusHtml = '<span style="color:#CC0000;font-weight:700">Near Limit</span>';
    else if (_pct > 60) statusHtml = '<span style="color:#C07000">Watch</span>';
    else if (pu.liab==='Committed'||pu.liab==='Committed Liability') statusHtml = '<span style="color:var(--green)">On Track</span>';
    else statusHtml = '<span style="color:var(--muted)">Planned</span>';

    rows += `<tr class="${getRowClass(pu)}" data-pu="${pu.code}" style="cursor:pointer">
      <td class="puc puc-link" title="Open Full Details: PU-${pu.code}" onclick="event.stopPropagation();openPUDetail('${pu.code}')">${pu.code}</td>
      <td class="desc" title="${pu.desc}">${pu.desc}</td>
      <td>${puBadge(pu.puType)}</td>
      <td>${liabBadge(pu.liab)}</td>
      <td class="n">${fmtT(c.budget)}</td>
      ${pastCells}
      <td class="n">${fmtT(c.curCommitted)}</td>
      <td class="n" style="color:var(--muted)">${fmtT(c.curRemaining)}</td>
      <td class="n" style="font-weight:600">${fmtT(c.curMonthTotal)}</td>
      <td>${miniProg(c.curDonePct, col)}</td>
      <td class="n" style="font-weight:700">${fmtT(c.totalCommitted)}</td>
      <td class="n rem ${balCls}">${fmtT(c.balanceBudget)}</td>
      <td class="n" style="color:var(--steel)">${fmtT(c.projPerMonth)}</td>
      <td>${miniProg(c.utilisedPct, col)}</td>
      <td>${statusHtml}</td>
    </tr>`;
    tB+=c.budget;tC+=c.totalCommitted;tBal+=c.balanceBudget;
    tJunC+=c.curCommitted;tJunR+=c.curRemaining;tJunT+=c.curMonthTotal;
  });
  const tUtil = pct(tC,tB); const tc2 = utilColor(tUtil);
  const totalPastCells = actualMonths.map(m => `<td class="n">${fmtT(tPast[m]||0)}</td>`).join('');
  rows += `<tr class="tot">
    <td colspan="4" style="text-align:left">GRAND TOTAL (excl. Recoveries)</td>
    <td class="n">${fmtT(tB)}</td>
    ${totalPastCells}
    <td class="n">${fmtT(tJunC)}</td><td class="n">${fmtT(tJunR)}</td>
    <td class="n">${fmtT(tJunT)}</td><td>-</td>
    <td class="n">${fmtT(tC)}</td><td class="n rem ${tBal<0?'neg':'ok'}">${fmtT(tBal)}</td>
    <td class="n">-</td><td>${miniProg(tUtil,tc2)}</td><td>-</td>
  </tr>`;
  document.getElementById('liab-tbody').innerHTML = rows;
}

// ═══════════════════════════════════════════════
// MONTH WISE TABLE
// ═══════════════════════════════════════════════
function renderMonthwise() {
  const pus = getFiltered();
  const {pastMonths, curMonthKey, futureMonths, cur} = getMonthStatus();
  let rows='', tots={apr:0,may:0,junC:0,junR:0,junT:0,tB:0,tC:0,tBal:0};
  futureMonths.forEach(m => tots[m]=0);

  pus.forEach(pu => {
    const md = MONTH[pu.code]||{};
    const c = compute(pu.code);
    const apr = md.apr||0, may = md.may||0;
    const junC = c.curCommitted, junR = c.curRemaining, junT = c.curMonthTotal;
    const proj = c.projPerMonth;

    tots.apr+=apr; tots.may+=may; tots.junC+=junC; tots.junR+=junR; tots.junT+=junT;
    tots.tB+=c.budget; tots.tC+=c.totalCommitted; tots.tBal+=c.balanceBudget;
    futureMonths.forEach(m => tots[m]+=(proj||0));

    const util = c.utilisedPct;
    const col = utilColor(util);

    let futureCells = futureMonths.map(() => `<td class="n" style="color:#1A4A8A;background:#F0F6FF">${fmtT(proj)}</td>`).join('');
    if (futureMonths.length < 9) futureCells += '<td class="n" style="color:#aaa">-</td>'.repeat(9 - futureMonths.length);

    const balCls = c.balanceBudget<0?'neg':c.balanceBudget<c.budget*0.1?'low':'ok';
    rows += `<tr class="${getRowClass(pu)}" data-pu="${pu.code}" style="cursor:pointer">
      <td class="puc puc-link" title="Open Full Details: PU-${pu.code}" onclick="event.stopPropagation();openPUDetail('${pu.code}')">${pu.code}</td>
      <td class="desc" title="${pu.desc}" style="font-weight:700">${pu.desc}</td>
      <td class="n">${fmtT(apr)}</td>
      <td class="n">${fmtT(may)}</td>
      <td class="n" style="background:#FFF9E0;font-weight:600">${fmtT(junC)}</td>
      <td class="n" style="background:#FFF9E0;color:var(--muted)">${fmtT(junR)}</td>
      <td class="n" style="background:#FFF9E0;font-weight:700">${fmtT(junT)}</td>
      ${futureCells}
      <td class="n">${fmtT(c.budget)}</td>
      <td class="n" style="font-weight:700">${fmtT(c.totalCommitted)}</td>
      <td class="n rem ${balCls}">${fmtT(c.balanceBudget)}</td>
      <td>${miniProg(util, col)}</td>
    </tr>`;
  });

  // Total row
  const futTotCells = futureMonths.map(m =>
    `<td class="n" style="color:#1A4A8A;background:#E8F0FF;font-weight:700">${fmtT(tots[m]||0)}</td>`).join('');
  const padNeeded2 = 9 - futureMonths.length;
  let ftPad = futTotCells;
  for(let i=0;i<padNeeded2;i++) ftPad += '<td class="n" style="color:#aaa">-</td>';
  const tUtil = pct(tots.tC, tots.tB);
  rows += `<tr class="tot">
    <td colspan="2" style="text-align:left">GRAND TOTAL</td>
    <td class="n">${fmtT(tots.apr)}</td><td class="n">${fmtT(tots.may)}</td>
    <td class="n" style="background:#FFF0C0">${fmtT(tots.junC)}</td>
    <td class="n" style="background:#FFF0C0">${fmtT(tots.junR)}</td>
    <td class="n" style="background:#FFF0C0">${fmtT(tots.junT)}</td>
    ${ftPad}
    <td class="n">${fmtT(tots.tB)}</td>
    <td class="n">${fmtT(tots.tC)}</td>
    <td class="n rem ${tots.tBal<0?'neg':'ok'}">${fmtT(tots.tBal)}</td>
    <td>${miniProg(tUtil, utilColor(tUtil))}</td>
  </tr>`;
  document.getElementById('mw-tbody').innerHTML = rows;
}

// ═══════════════════════════════════════════════
// RECOVERY PAGE
// ═══════════════════════════════════════════════
function renderRecovery() {
  const pu = PU_META.find(p=>p.code==='98');
  const c = compute('98');
  const md = MONTH['98']||{};
  const {cur, futureMonths} = getMonthStatus();
  const apr = md.apr||0, may = md.may||0;

  // Cards
  document.getElementById('rec-cards').innerHTML = `
    <div class="rec-card"><div class="cl">Recovery Effective Budget</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(c.budget)}</div>
      <div class="cs2">${Math.round(c.budget).toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="rec-card"><div class="cl">APR Recoveries</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(apr)}</div>
      <div class="cs2">${apr.toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="rec-card"><div class="cl">MAY Recoveries</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(may)}</div>
      <div class="cs2">${may.toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="rec-card"><div class="cl">${cur.label} Committed</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(c.curCommitted)}</div>
      <div class="cs2">${c.curCommitted.toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="rec-card"><div class="cl">Total Committed</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(c.totalCommitted)}</div>
      <div class="cs2">${c.utilisedPct.toFixed(1)}% of recovery budget</div></div>
    <div class="rec-card"><div class="cl">Proj./Month (${futureMonths.length} months)</div>
      <div class="cv" style="color:#CC0000;font-size:16px">${fmtCr(c.projPerMonth)}</div>
      <div class="cs2">${Math.round(c.projPerMonth).toLocaleString('en-IN')} Rs'000s</div></div>
  `;

  // Main liability row
  const balCls = c.balanceBudget>0?'ok':c.balanceBudget<0?'neg':'';
  document.getElementById('rec-tbody').innerHTML = `
    <tr class="neg-row" data-pu="98" style="cursor:pointer">
      <td class="puc">98</td>
      <td class="desc">Credit or Recoveries</td>
      <td class="n neg-val">${fmtT(c.budget)}</td>
      <td class="n neg-val">${fmtCr(c.budget)}</td>
      <td class="n neg-val">${fmtT(apr)}</td>
      <td class="n neg-val">${fmtT(may)}</td>
      <td class="n neg-val">${fmtT(c.curCommitted)}</td>
      <td class="n" style="color:var(--muted)">${fmtT(c.curRemaining)}</td>
      <td class="n neg-val font-weight:700">${fmtT(c.totalCommitted)}</td>
      <td class="n rem ${balCls}">${fmtT(c.balanceBudget)}</td>
      <td class="n neg-val">${fmtT(c.projPerMonth)}</td>
      <td>${miniProg(c.utilisedPct,'#CC0000')}</td>
    </tr>`;

  // Month wise for PU-98
  const allMonths = FY_MONTHS;
  let cells = allMonths.map(m => `<td class="n neg-val">${md[m]?fmtT(md[m]):'<span style="color:#aaa">-</span>'}</td>`).join('');
  const total = allMonths.reduce((s,m)=>s+(md[m]||0),0);
  document.getElementById('rec-mw-tbody').innerHTML = `
    <tr class="neg-row" data-pu="98" style="cursor:pointer">
      <td class="puc">98</td>
      <td class="desc">Credit or Recoveries</td>
      ${cells}
      <td class="n neg-val" style="font-weight:700">${fmtT(total)}</td>
    </tr>`;
}

// ═══════════════════════════════════════════════
// PU MASTER TABLE
// ═══════════════════════════════════════════════
let _puMasterView = 'card';

function puDual(value) {
  return `<span class="pu-dual"><span>${fmtT(value)}</span><small>${fmtCr(value)}</small></span>`;
}

function puStatusInfo(pu, c) {
  const budget = Number(c.budget) || 0;
  const actual = Number(c.totalCommitted) || 0;
  const util = budget ? (Math.abs(actual) / Math.abs(budget) * 100) : (actual ? 999 : 0);
  if (pu.isNeg) return {label:'Recovery/Credit', cls:'neutral', util};
  if (!budget && actual) return {label:'No Budget, Actual Booked', cls:'danger', util};
  if (budget && c.balanceBudget < 0) return {label:'Over Budget', cls:'danger', util};
  if (budget && !actual) return {label:'Budget Available, No Actual', cls:'warn', util};
  if (util >= 85) return {label:'High Utilisation', cls:'warn', util};
  return {label:'Normal', cls:'good', util};
}

function setPUMasterView(view) {
  _puMasterView = view === 'table' ? 'table' : 'card';
  try { localStorage.setItem('owePUMasterView', _puMasterView); } catch(e) {}
  renderPUMaster();
}
window.setPUMasterView = setPUMasterView;

function initPUMasterViewPreference() {
  try {
    const saved = localStorage.getItem('owePUMasterView');
    if (saved === 'table' || saved === 'card') _puMasterView = saved;
  } catch(e) {}
}

function initPUMasterFilterOptions(pus) {
  const fill = (id, values, first) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.ready === '1') return;
    el.innerHTML = `<option value="all">${first}</option>` + values.map(v => `<option value="${htmlSafe(v)}">${htmlSafe(v)}</option>`).join('');
    el.dataset.ready = '1';
  };
  fill('puMasterTypeFilter', [...new Set(pus.map(p => p.puType))].sort(), 'All PU Types');
  fill('puMasterLiabFilter', [...new Set(pus.map(p => p.liab))].sort(), 'All Liability Types');
}

function renderPUMaster() {
  initPUMasterViewPreference();
  let pus = getFiltered();
  initPUMasterFilterOptions(activePUMeta());
  const typeFilter = document.getElementById('puMasterTypeFilter')?.value || 'all';
  const liabFilter = document.getElementById('puMasterLiabFilter')?.value || 'all';
  const budgetFilter = document.getElementById('puMasterBudgetFilter')?.value || 'all';
  const actualFilter = document.getElementById('puMasterActualFilter')?.value || 'all';
  const utilFilter = document.getElementById('puMasterUtilFilter')?.value || 'all';
  pus = pus.filter(pu => {
    const c = compute(pu.code);
    const budget = Number(c.budget) || 0;
    const actual = Number(c.totalCommitted) || 0;
    const util = budget ? (Math.abs(actual) / Math.abs(budget) * 100) : (actual ? 999 : 0);
    if (typeFilter !== 'all' && pu.puType !== typeFilter) return false;
    if (liabFilter !== 'all' && pu.liab !== liabFilter) return false;
    if (budgetFilter === 'budget' && !budget) return false;
    if (budgetFilter === 'nobudget' && budget) return false;
    if (actualFilter === 'actual' && !actual) return false;
    if (actualFilter === 'noactual' && actual) return false;
    if (utilFilter === 'low' && !(util < 60)) return false;
    if (utilFilter === 'normal' && !(util >= 60 && util < 85)) return false;
    if (utilFilter === 'high' && !(util >= 85 && util <= 100)) return false;
    if (utilFilter === 'over' && !(util > 100)) return false;
    return true;
  });
  const all = activePUMeta();
  const metric = all.reduce((t, pu) => {
    const c = compute(pu.code);
    const budget = Number(c.budget) || 0;
    const actual = Number(c.totalCommitted) || 0;
    if (pu.puType === 'Staff PU') t.staff++; else t.nonStaff++;
    if (pu.liab === 'Committed') t.committed++; else t.planned++;
    if (pu.isNeg || ['72','73','74','75'].includes(pu.code)) t.recoveryGst++;
    if (budget) t.budgetAvailable++;
    if (actual) t.actualBooked++;
    return t;
  }, {staff:0, nonStaff:0, committed:0, planned:0, recoveryGst:0, budgetAvailable:0, actualBooked:0});
  const kpis = document.getElementById('puMasterKpis');
  if (kpis) kpis.innerHTML = [
    ['Staff PU', metric.staff], ['Non-Staff PU', metric.nonStaff], ['Committed', metric.committed],
    ['Planned', metric.planned], ['Recovery/GST', metric.recoveryGst], ['Budget Available', metric.budgetAvailable], ['Actual Booked', metric.actualBooked]
  ].map(([label,value]) => `<div class="pu-master-kpi"><span>${htmlSafe(label)}</span><strong>${value}</strong></div>`).join('');
  document.getElementById('puCardViewBtn')?.classList.toggle('active', _puMasterView === 'card');
  document.getElementById('puTableViewBtn')?.classList.toggle('active', _puMasterView === 'table');
  const cardBox = document.getElementById('puMasterCards');
  const tableWrap = document.getElementById('puMasterTableWrap');
  if (cardBox) {
    cardBox.hidden = _puMasterView !== 'card';
    cardBox.style.display = _puMasterView === 'card' ? '' : 'none';
  }
  if (tableWrap) {
    tableWrap.hidden = false;
    tableWrap.style.display = _puMasterView === 'table' ? 'block' : 'none';
  }
  if (cardBox) {
    cardBox.innerHTML = pus.map(pu => {
      const c = compute(pu.code);
      const status = puStatusInfo(pu, c);
      return `<article class="pu-card ${status.cls}">
        <div class="pu-card-head"><div><strong>PU-${pu.code}</strong><span>${htmlSafe(pu.desc)}</span></div><em class="pu-status ${status.cls}">${htmlSafe(status.label)}</em></div>
        <div class="pu-badges">${puBadge(pu.puType)}${liabBadge(pu.liab)}</div>
        <div class="pu-card-values">
          <div><label>Budget</label>${puDual(c.budget)}</div>
          <div><label>Actual</label>${puDual(c.totalCommitted)}</div>
          <div><label>Balance</label>${puDual(c.balanceBudget)}</div>
          <div><label>Utilisation</label><strong>${status.util.toFixed(1)}%</strong></div>
        </div>
        <div class="pu-actions">
          <button onclick="openPUDetail('${pu.code}')">Month-wise</button>
          <button onclick="switchTab('smhdetail')">Department wise</button>
          <button onclick="document.getElementById('trendPUSelect').value='${pu.code}';switchTab('trend')">Graphs</button>
          ${HQ_EXCESS_SHORTFALL_PUS.includes(pu.code) ? `<button onclick="switchTab('excessshortfall')">AE vs BP</button>` : ''}
        </div>
      </article>`;
    }).join('') || '<div class="pu-empty">No PU matches selected filters.</div>';
  }
  let rows = '';
  pus.forEach(pu => {
    const c = compute(pu.code);
    const status = puStatusInfo(pu, c);
    rows += `<tr class="${getRowClass(pu)}" data-pu="${pu.code}" style="cursor:pointer">
      <td class="puc puc-link" title="Open Full Details: PU-${pu.code}" onclick="event.stopPropagation();openPUDetail('${pu.code}')">${pu.code}</td>
      <td class="desc pu-desc" title="${pu.desc}">${pu.desc}</td>
      <td>${puBadge(pu.puType)}</td>
      <td>${liabBadge(pu.liab)}</td>
      <td class="n">${puDual(c.budget)}</td>
      <td class="n">${puDual(c.totalCommitted)}</td>
      <td class="n ${c.balanceBudget < 0 ? 'neg-val' : ''}">${puDual(c.balanceBudget)}</td>
      <td class="n">${status.util.toFixed(1)}%</td>
      <td><span class="pu-status ${status.cls}">${htmlSafe(status.label)}</span></td>
      <td class="pu-table-actions"><button onclick="openPUDetail('${pu.code}')">Open</button><button onclick="switchTab('trend')">Graph</button></td>
    </tr>`;
  });
  const tbody = document.getElementById('pu-tbody');
  if (tbody) tbody.innerHTML = rows || '<tr><td colspan="10" style="text-align:center;padding:18px">No PU matches selected filters.</td></tr>';
  makeReportTablesSortable();
  applyMobileTableLabels();
}

function initBPFilter() {
  const list = document.getElementById('bpPUFilter');
  if (!list || list.dataset.ready === '1') return;
  list.innerHTML = activePUMeta()
    .map(p => `<label class="bp-check-item">
      <input type="checkbox" class="bp-pu-check" value="${p.code}" onchange="onBPPUChange()">
      <span><strong>PU-${p.code}</strong> ${htmlSafe(p.desc)}</span>
    </label>`)
    .join('');
  list.dataset.ready = '1';
  updateBPSelectionCount();
  initPUDrawerBehavior('bpPUDrawer');
}

function filterPUChecklist(listId, term) {
  const list = document.getElementById(listId);
  if (!list) return;
  const q = String(term || '').trim().toLowerCase();
  list.querySelectorAll('.bp-check-item').forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

function closePUDrawer(id) {
  const drawer = document.getElementById(id);
  if (drawer) drawer.open = false;
}

function initPUDrawerBehavior(id) {
  const drawer = document.getElementById(id);
  if (!drawer || drawer.dataset.closeBound === '1') return;
  drawer.dataset.closeBound = '1';
  let timer = null;
  drawer.addEventListener('mouseenter', () => {
    if (timer) clearTimeout(timer);
  });
  drawer.addEventListener('mouseleave', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { drawer.open = false; }, 700);
  });
  document.addEventListener('click', event => {
    if (drawer.open && !drawer.contains(event.target)) drawer.open = false;
  });
}

function updateBPSelectionCount() {
  const all = document.getElementById('bpPUAll');
  const count = document.getElementById('bpPUCount');
  const checks = Array.from(document.querySelectorAll('#bpPUFilter .bp-pu-check'));
  if (!count) return;
  if (all && all.checked) {
    count.textContent = 'All selected';
    return;
  }
  const selectedCount = checks.filter(ch => ch.checked).length;
  count.textContent = selectedCount ? `${selectedCount} selected` : 'No PU selected';
}

function onBPAllToggle(checked) {
  document.querySelectorAll('#bpPUFilter .bp-pu-check').forEach(ch => {
    ch.checked = !!checked;
  });
  updateBPSelectionCount();
  renderBPAnalysis();
}

function onBPPUChange() {
  const all = document.getElementById('bpPUAll');
  if (all) all.checked = false;
  updateBPSelectionCount();
  renderBPAnalysis();
}

function setBPSelection(mode) {
  const all = document.getElementById('bpPUAll');
  const checks = Array.from(document.querySelectorAll('#bpPUFilter .bp-pu-check'));
  const search = document.getElementById('bpPUSearch');
  if (search) {
    search.value = '';
    filterPUChecklist('bpPUFilter', '');
  }
  if (all) all.checked = mode === 'all';
  checks.forEach(ch => {
    ch.checked = mode === 'all';
  });
  updateBPSelectionCount();
  renderBPAnalysis();
}

function bpSelectedCodes() {
  const all = document.getElementById('bpPUAll');
  if (!all) return ['all'];
  if (all.checked) return ['all'];
  return Array.from(document.querySelectorAll('#bpPUFilter .bp-pu-check:checked')).map(o => o.value);
}

function buildBPRows() {
  const bpMode = getBPModeStatus();
  const actualMonths = bpMode.bpMonths;
  const actualMonthCount = bpMode.bpMonthCount;
  return activePUMeta().map(pu => {
    const budget = getBudget(pu.code);
    const actualTill = actualForBPMode(pu.code);
    const bp = (budget / 12) * actualMonthCount;
    const variance = actualTill - bp;
    const utilPct = budget ? (actualTill / budget) * 100 : (actualTill ? 999 : 0);
    const overFullBudget = budget > 0 && actualTill > budget;
    const noExpense = budget > 0 && Math.abs(actualTill) === 0;
    const status = overFullBudget ? 'Over Full Budget'
      : noExpense ? 'Budget, No Expense'
      : variance > 0 ? 'Excess vs BP'
      : variance < 0 ? 'Saving vs BP'
      : 'On BP';
    const remark = overFullBudget ? 'Actual has crossed full year budget. Budget support or booking control required.'
      : noExpense ? 'Budget is available but no actual expense is booked.'
      : variance > 0 ? 'Actual spending is ahead of proportionate budget. Review pace and justification.'
      : variance < 0 ? 'Actual spending is below proportionate budget. Indicates saving or pending booking.'
      : 'Actual is aligned with proportionate budget.';
    return {pu, budget, actualTill, bp, variance, utilPct, actualMonthCount, status, remark, overFullBudget, noExpense};
  });
}
function getFilteredBPRows() {
  const selected = bpSelectedCodes();
  const statusFilter = (document.getElementById('bpStatusFilter') || {}).value || 'all';
  const typeFilter = (document.getElementById('bpTypeFilter') || {}).value || 'all';
  const liabilityFilter = (document.getElementById('bpLiabilityFilter') || {}).value || 'all';
  return buildBPRows().filter(row => {
    if (!passesPUFocus(row.pu.code)) return false;
    if (!selected.includes('all') && selected.length === 0) return false;
    if (!selected.includes('all') && !selected.includes(row.pu.code)) return false;
    if (typeFilter !== 'all' && row.pu.puType !== typeFilter) return false;
    if (liabilityFilter !== 'all' && row.pu.liab !== liabilityFilter) return false;
    if (statusFilter === 'excess' && !(row.variance > 0)) return false;
    if (statusFilter === 'saving' && !(row.variance < 0)) return false;
    if (statusFilter === 'overbudget' && !row.overFullBudget) return false;
    if (statusFilter === 'noexpense' && !row.noExpense) return false;
    return true;
  });
}

function renderBPAnalysis() {
  syncBPModeControls();
  initBPFilter();
  const body = document.getElementById('bpTableBody');
  if (!body) return;
  const rows = getFilteredBPRows();
  const bpMode = getBPModeStatus();
  const actualMonths = bpMode.bpMonths;
  const cur = bpMode.bpThrough || bpMode.cur;
  const monthLabels = actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).join(', ') || 'No actual month selected';
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget;
    t.bp += r.bp;
    t.actual += r.actualTill;
    t.variance += r.variance;
    if (r.variance > 0) t.excessCount++;
    if (r.variance < 0) t.savingCount++;
    if (r.overFullBudget) t.overCount++;
    return t;
  }, {budget:0, bp:0, actual:0, variance:0, excessCount:0, savingCount:0, overCount:0});
  const kpis = document.getElementById('bpKpis');
  if (kpis) {
    kpis.innerHTML = [
      ['Total Budget Grant', textCr(totals.budget), 'Selected PU budget'],
      ['Budget Proportionate', textCr(totals.bp), `${bpMode.modeLabel}: ${monthLabels}`],
      ['Actual Used', textCr(totals.actual), `AE up to ${bpMode.bpThrough ? bpMode.bpThrough.label + ' ' + bpMode.bpThrough.year : 'completed month'}`],
      [totals.variance >= 0 ? 'Net Excess vs BP' : 'Net Saving vs BP', signedCr(totals.variance), `${totals.excessCount} excess / ${totals.savingCount} saving PUs`],
      ['Over Full Budget', String(totals.overCount), 'PU count already above full BG']
    ].map(([l,v,s]) => `<div class="bp-kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }
  const meta = document.getElementById('bpMeta');
  if (meta) {
    const latest = bpMode.latestData ? `${bpMode.latestData.label} ${bpMode.latestData.year}` : 'no latest actual month';
    meta.textContent = `BP = BG / 12 x ${actualMonths.length}. Completed months counted: ${monthLabels}. AE is also kept up to completed month only. Latest data available: ${latest}. Imported BP is ignored.`;
  }
  const title = document.getElementById('bpTableTitle');
  if (title) title.textContent = `PU-wise Budget Proportionate Position - ${rows.length} PU(s) shown`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#607080;padding:16px">No PU found for selected filters.</td></tr>';
    refreshBIViewSoon();
    return;
  }
  const rowHtml = rows
    .sort((a,b) => Math.abs(b.variance) - Math.abs(a.variance))
    .map(r => {
      const cls = r.overFullBudget ? 'bp-over' : r.noExpense ? 'bp-noexp' : r.variance > 0 ? 'bp-excess' : r.variance < 0 ? 'bp-saving' : '';
      return `<tr class="${cls}${isImportantPU(r.pu.code) ? ' important-pu-row' : ''}">
        <td class="puc puc-link" onclick="openPUDetail('${r.pu.code}')">${r.pu.code}</td>
        <td class="desc">${htmlSafe(r.pu.desc)}</td>
        <td>${htmlSafe(r.pu.puType)}</td>
        <td>${htmlSafe(r.pu.liab)}</td>
        <td class="n">${textCr(r.budget)}</td>
        <td class="n">${r.actualMonthCount}</td>
        <td class="n">${textCr(r.bp)}</td>
        <td class="n">${textCr(r.actualTill)}</td>
        <td class="n ${r.variance >= 0 ? 'bp-var-excess' : 'bp-var-saving'}">${signedCr(r.variance)}</td>
        <td class="n">${r.budget ? r.utilPct.toFixed(1) + '%' : (r.actualTill ? 'No Budget' : '0.0%')}</td>
        <td><span class="bp-status ${cls}">${htmlSafe(r.status)}</span></td>
        <td class="bp-remark">${htmlSafe(r.remark)}</td>
      </tr>`;
    }).join('');
  const totalClass = totals.variance >= 0 ? 'bp-excess' : 'bp-saving';
  body.innerHTML = rowHtml + `<tr class="tot ${totalClass}">
    <td colspan="4" style="text-align:left">TOTAL SELECTED PUs</td>
    <td class="n">${textCr(totals.budget)}</td>
    <td class="n">${actualMonths.length}</td>
    <td class="n">${textCr(totals.bp)}</td>
    <td class="n">${textCr(totals.actual)}</td>
    <td class="n">${signedCr(totals.variance)}</td>
    <td class="n">${totals.budget ? ((totals.actual / totals.budget) * 100).toFixed(1) + '%' : '0.0%'}</td>
    <td>${totals.variance >= 0 ? 'Net Excess' : 'Net Saving'}</td>
    <td class="bp-remark">Calculated on selected filters only.</td>
  </tr>`;
  refreshBIViewSoon();
}

// HQ PU order supplied by "Analysis of Excess-Shortfall AE over BP up to Aug 2026 MB.xlsx".
// Other PUs remain available and follow the HQ list in master-code order.
const HQ_EXCESS_SHORTFALL_PUS = ['01','02','10','11','12','16','25','27','30','31','32','38','44','60','72','73','75'];

function buildExcessShortfallRows() {
  const mode = getBPModeStatus();
  const currentMonths = mode.bpMonths.length ? mode.bpMonths : FY_MONTHS.slice(0, 1);
  const previousMonths = currentMonths.slice(0, Math.max(0, currentMonths.length - 1));
  const sumMonths = (source, code, months) => months.reduce((sum, key) => sum + (Number((source[code] || {})[key]) || 0), 0);
  return PU_META.map(pu => {
    const budget = getBudget(pu.code);
    const pyAnnual = Number((BUDGET_PY[pu.code] || {}).actuals_till) || 0;
    const bpPrevious = budget / 12 * previousMonths.length;
    const bpCurrent = budget / 12 * currentMonths.length;
    const pyPrevious = sumMonths(MONTH_PY, pu.code, previousMonths);
    const actualPrevious = sumMonths(MONTH, pu.code, previousMonths);
    const pyCurrent = sumMonths(MONTH_PY, pu.code, currentMonths);
    const actualCurrent = sumMonths(MONTH, pu.code, currentMonths);
    const budgetVsPY = budget - pyAnnual;
    const variancePrevious = actualPrevious - bpPrevious;
    const varianceCurrent = actualCurrent - bpCurrent;
    const latestMovement = varianceCurrent - variancePrevious;
    const hqIndex = HQ_EXCESS_SHORTFALL_PUS.indexOf(pu.code);
    const remark = varianceCurrent > 0
      ? `AE exceeds proportionate budget by ${textCr(varianceCurrent)}.`
      : varianceCurrent < 0
        ? `AE is below proportionate budget by ${textCr(Math.abs(varianceCurrent))}.`
        : 'AE is aligned with proportionate budget.';
    return {pu, budget, pyAnnual, bpPrevious, bpCurrent, pyPrevious, actualPrevious, pyCurrent, actualCurrent,
      budgetVsPY, variancePrevious, varianceCurrent, latestMovement, remark, hqIndex};
  });
}

function getExcessShortfallRows() {
  const scope = (document.getElementById('xsScope') || {}).value || 'all';
  const sort = (document.getElementById('xsSort') || {}).value || 'hq';
  let rows = buildExcessShortfallRows();
  if (scope === 'hq') rows = rows.filter(row => row.hqIndex >= 0);
  const codeSort = (a,b) => a.pu.code.localeCompare(b.pu.code, undefined, {numeric:true});
  if (sort === 'excess') rows.sort((a,b) => b.varianceCurrent - a.varianceCurrent || codeSort(a,b));
  else if (sort === 'actual') rows.sort((a,b) => b.actualCurrent - a.actualCurrent || codeSort(a,b));
  else if (sort === 'budget') rows.sort((a,b) => b.budget - a.budget || codeSort(a,b));
  else if (sort === 'code') rows.sort(codeSort);
  else rows.sort((a,b) => {
    const ai = a.hqIndex < 0 ? 999 : a.hqIndex;
    const bi = b.hqIndex < 0 ? 999 : b.hqIndex;
    return ai - bi || codeSort(a,b);
  });
  return rows;
}

function renderExcessShortfall() {
  const body = document.getElementById('xsTableBody');
  if (!body) return;
  const mode = getBPModeStatus();
  const current = mode.bpThrough || mode.cur;
  const currentCount = Math.max(1, mode.bpMonthCount || 1);
  const previousCount = Math.max(0, currentCount - 1);
  const previousIdx = Math.max(0, (current ? current.idx : currentCount - 1) - 1);
  const currentLabel = current ? `${current.label} ${current.year}` : 'Current period';
  const previousLabel = `${FY_MONTH_LABELS[previousIdx]} ${previousIdx <= 8 ? 2026 : 2027}`;
  const rows = getExcessShortfallRows();
  const cr = value => `${((Number(value) || 0) / 10000).toFixed(2)}`;
  const signed = value => `${value > 0 ? '+' : ''}${cr(value)}`;
  const thousand = value => `${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
  const dual = (value, useSign = false) => `<span class="xs-cr">${useSign && value > 0 ? '+' : ''}${cr(value)} Cr</span><small class="xs-th">${useSign && value > 0 ? '+' : ''}${thousand(value)} Rs '000</small>`;
  const pageTitle = document.getElementById('xsTitle');
  if (pageTitle) pageTitle.textContent = `Primary Unit Wise Statement of Excess Expenditure over Budget Proportionate up to ${currentLabel} (Fig. Rs. in crores / Rs '000)`;
  const head = document.getElementById('xsTableHead');
  if (head) head.innerHTML = `<tr>
    <th>A<br>AU</th><th>B<br>PU Code and Description</th><th>C<br>AE 2025-26</th><th>D<br>BG 2026-27</th>
    <th>E<br>BP up to ${previousLabel}</th><th>F<br>BP up to ${currentLabel}</th>
    <th>G<br>COPPY up to ${previousLabel.replace('2026','2025').replace('2027','2026')}</th><th>H<br>AE up to ${previousLabel}</th>
    <th>I<br>COPPY up to ${currentLabel.replace('2026','2025').replace('2027','2026')}</th><th>J<br>AE up to ${currentLabel}</th>
    <th>K<br>BG - PY AE<br><small>D - C</small></th><th>L<br>AE - BP ${previousLabel}<br><small>H - E</small></th><th>M<br>AE - BP ${currentLabel}<br><small>J - F</small></th><th>N<br>Current movement<br><small>M - L</small></th><th>O<br>Calculation remark</th>
  </tr>`;
  const meta = document.getElementById('xsMeta');
  if (meta) meta.textContent = `Live portal values through ${currentLabel}. Every amount shows crore and its underlying Rs '000 value; calculations use Rs '000 without rounding.`;
  const totals = rows.reduce((t,r) => {
    ['budget','pyAnnual','bpPrevious','bpCurrent','pyPrevious','actualPrevious','pyCurrent','actualCurrent','budgetVsPY','variancePrevious','varianceCurrent','latestMovement'].forEach(k => t[k] += r[k]);
    if (r.varianceCurrent > 0) t.excess++;
    if (r.varianceCurrent < 0) t.shortfall++;
    return t;
  }, {budget:0,pyAnnual:0,bpPrevious:0,bpCurrent:0,pyPrevious:0,actualPrevious:0,pyCurrent:0,actualCurrent:0,budgetVsPY:0,variancePrevious:0,varianceCurrent:0,latestMovement:0,excess:0,shortfall:0});
  const kpis = document.getElementById('xsKpis');
  if (kpis) kpis.innerHTML = [
    ['PUs shown', rows.length, `${totals.excess} excess / ${totals.shortfall} below BP`],
    [`AE up to ${currentLabel}`, `${cr(totals.actualCurrent)} Cr`, 'Actual value'],
    [`BP up to ${currentLabel}`, `${cr(totals.bpCurrent)} Cr`, `${currentCount} completed months`],
    [totals.varianceCurrent >= 0 ? 'Net excess over BP' : 'Net shortfall against BP', `${signed(totals.varianceCurrent)} Cr`, 'AE minus BP']
  ].map(([label,value,note]) => `<div><span>${htmlSafe(String(label))}</span><strong>${htmlSafe(String(value))}</strong><small>${htmlSafe(String(note))}</small></div>`).join('');
  const rowCells = r => [
    'MB', `PU-${r.pu.code} - ${r.pu.desc}`, r.pyAnnual, r.budget, r.bpPrevious, r.bpCurrent,
    r.pyPrevious, r.actualPrevious, r.pyCurrent, r.actualCurrent, r.budgetVsPY,
    r.variancePrevious, r.varianceCurrent, r.latestMovement, r.remark
  ];
  body.innerHTML = rows.map(r => `<tr class="${r.varianceCurrent > 0 ? 'xs-excess' : r.varianceCurrent < 0 ? 'xs-shortfall' : ''}${r.hqIndex >= 0 ? ' xs-hq-row' : ''}">
    ${rowCells(r).map((value,i) => `<td${i === 0 ? ' class="xs-au"' : i === 1 ? ' class="xs-pu-name"' : i > 1 && i < 14 ? ' class="n"' : ''}>${i === 1 ? `<span role="button" tabindex="0" onclick="openPUDetail('${r.pu.code}')" onkeydown="if(event.key==='Enter')openPUDetail('${r.pu.code}')">${htmlSafe(value)}</span>` : i > 1 && i < 14 ? dual(value, i >= 10) : htmlSafe(value)}</td>`).join('')}
  </tr>`).join('') + `<tr class="tot"><td></td><td>TOTAL - ${rows.length} PU(s)</td>${[
    totals.pyAnnual,totals.budget,totals.bpPrevious,totals.bpCurrent,totals.pyPrevious,totals.actualPrevious,
    totals.pyCurrent,totals.actualCurrent,totals.budgetVsPY,totals.variancePrevious,totals.varianceCurrent,totals.latestMovement
  ].map((v,i) => `<td class="n">${dual(v, i >= 8)}</td>`).join('')}<td>Calculated from selected scope.</td></tr>`;
  applyMobileTableLabels();
}

function budgetControlStage() {
  const d = new Date();
  const month = d.getMonth();
  if (month >= 3 && month <= 6) {
    return {code:'BG', label:'BG / BE', askLabel:'AR Proposal', note:'Current ceiling is BG/BE; prepare August Review from current projection.'};
  }
  if (month === 7 || month === 8) {
    return {code:'AR', label:'August Review', askLabel:'AR Requirement', note:'Use AR to identify likely saving or additional requirement early.'};
  }
  if (month >= 9 && month <= 11) {
    return {code:'REA', label:isRGActive() ? 'RG Approved' : 'Review Proposal', askLabel:isRGActive() ? 'RG Control' : 'Budget Review', note:isRGActive() ? 'RG is the revised spending ceiling.' : 'Use review proposal for saving/excess action before Board approval.'};
  }
  if (month === 0 || month === 1) {
    return {code:'FME', label:'FME / FM', askLabel:'FME Asked', note:'January FM should show realistic expenditure expected up to 31 March.'};
  }
  return {code:'FG', label:'FG / Final Grant', askLabel:'FG Control', note:'FG is final authority before year-end Appropriation Accounts.'};
}

function fyElapsedFactor() {
  const cur = getCurrentFYMonth();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayPart = Math.min(1, Math.max(0.05, now.getDate() / daysInMonth));
  return Math.max(0.25, cur.idx + dayPart);
}

function budgetControlStatus(row) {
  if (row.noExpense) {
    return {
      key:'noexpense',
      label:'Budget, No Expense',
      cls:'bc-noexpense',
      remark:`Budget exists but no booking is visible. Keep under ${row.stage.askLabel}; confirm whether this can be surrendered or retained for firm liability.`
    };
  }
  if (row.askAmount > 0 || row.noBudgetSpend) {
    return {
      key:'ask',
      label:'Ask / Additional Grant',
      cls:'bc-ask',
      remark:`Projected requirement is above current ceiling. Ask ${textCr(row.askAmount)} through ${row.stage.askLabel} / re-appropriation support and control further booking.`
    };
  }
  if (row.surrenderAmount > 0 && row.utilPct < 70) {
    return {
      key:'surrender',
      label:'Surrender Review',
      cls:'bc-surrender',
      remark:`Possible surrender is ${textCr(row.surrenderAmount)} based on till-date projection. Confirm pending bills, contracts and staff liability before surrender.`
    };
  }
  if (row.utilPct >= 85 || row.projectionGapRatio > 0.9) {
    return {
      key:'watch',
      label:'Watch List',
      cls:'bc-watch',
      remark:'Projection is close to ceiling or utilisation is high. Watch booking pace before next budget review stage.'
    };
  }
  return {
    key:'normal',
    label:'Normal Control',
    cls:'bc-normal',
    remark:'Projection is within current ceiling. Continue monthly control against the next budget review stage.'
  };
}

function buildBudgetControlRows() {
  const bpMode = getBPModeStatus();
  const actualMonths = bpMode.bpMonths;
  const elapsedFactor = Math.max(0.25, bpMode.bpMonthCount || fyElapsedFactor());
  const stage = budgetControlStage();
  return activePUMeta().map(pu => {
    const ceiling = getBudget(pu.code);
    const actualTill = actualForBPMode(pu.code);
    const projectedRequirement = Math.max(actualTill, elapsedFactor > 0 ? (actualTill / elapsedFactor) * 12 : actualTill);
    const varianceVsCeiling = projectedRequirement - ceiling;
    const askAmount = Math.max(0, varianceVsCeiling);
    const surrenderAmount = Math.max(0, ceiling - projectedRequirement);
    const utilPct = ceiling ? (actualTill / ceiling) * 100 : (actualTill ? 999 : 0);
    const noExpense = ceiling > 0 && Math.abs(actualTill) === 0;
    const noBudgetSpend = ceiling <= 0 && Math.abs(actualTill) > 0;
    const projectionGapRatio = ceiling ? projectedRequirement / Math.abs(ceiling) : 999;
    const row = {
      pu, stage, ceiling, actualTill, projectedRequirement, varianceVsCeiling,
      askAmount, surrenderAmount, utilPct, noExpense, noBudgetSpend,
      projectionGapRatio, elapsedFactor, actualMonthCount: actualMonths.length
    };
    return Object.assign(row, budgetControlStatus(row));
  }).sort((a,b) => {
    const rank = {ask:5, watch:4, noexpense:3, surrender:2, normal:1};
    return (rank[b.key] - rank[a.key]) ||
      (Math.max(b.askAmount, b.surrenderAmount) - Math.max(a.askAmount, a.surrenderAmount));
  });
}
function getFilteredBudgetControlRows() {
  const action = (document.getElementById('bcActionFilter') || {}).value || 'all';
  const type = (document.getElementById('bcTypeFilter') || {}).value || 'all';
  const liability = (document.getElementById('bcLiabilityFilter') || {}).value || 'all';
  const impact = (document.getElementById('bcImpactFilter') || {}).value || 'all';
  const minImpact = impact === 'all' ? 0 : Number(impact) * 100;
  return buildBudgetControlRows().filter(row => {
    if (!passesPUFocus(row.pu.code)) return false;
    if (action !== 'all' && row.key !== action) return false;
    if (type !== 'all' && row.pu.puType !== type) return false;
    if (liability !== 'all' && row.pu.liab !== liability) return false;
    if (minImpact && Math.max(row.askAmount, row.surrenderAmount) < minImpact) return false;
    return true;
  });
}

function renderBudgetControl() {
  syncBPModeControls();
  const body = document.getElementById('bcTableBody');
  if (!body) return;
  const rows = getFilteredBudgetControlRows();
  const allRows = buildBudgetControlRows();
  const bpMode = getBPModeStatus();
  const actualMonths = bpMode.bpMonths;
  const cur = bpMode.bpThrough || bpMode.cur;
  const stage = budgetControlStage();
  const elapsedFactor = Math.max(0.25, bpMode.bpMonthCount || fyElapsedFactor());
  const monthLabels = actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).join(', ') || 'No actual month selected';
  const totals = allRows.reduce((t, r) => {
    t.ceiling += r.ceiling;
    t.actual += r.actualTill;
    t.projected += r.projectedRequirement;
    t.ask += r.askAmount;
    t.surrender += r.surrenderAmount;
    t[r.key] = (t[r.key] || 0) + 1;
    return t;
  }, {ceiling:0, actual:0, projected:0, ask:0, surrender:0});
  const filteredTotals = rows.reduce((t, r) => {
    t.ceiling += r.ceiling;
    t.actual += r.actualTill;
    t.projected += r.projectedRequirement;
    t.ask += r.askAmount;
    t.surrender += r.surrenderAmount;
    return t;
  }, {ceiling:0, actual:0, projected:0, ask:0, surrender:0});

  const meta = document.getElementById('bcMeta');
  if (meta) meta.textContent = `As on ${cur.label} ${cur.year}; BP and AE basis use completed months: ${monthLabels}. Projection uses booked expenditure over ${elapsedFactor.toFixed(2)} FY month(s). ${stage.note}`;
  const basis = document.getElementById('bcBasis');
  if (basis) basis.textContent = `${stage.label} | ${isRGActive() ? 'RG where allotted; otherwise BG_ISL' : 'BG/BE Ceiling'}`;

  const kpis = document.getElementById('bcKpis');
  if (kpis) {
    kpis.innerHTML = [
      ['Projected Requirement', textCr(totals.projected), `Till-date projection to 31 March`],
      ['Amount to Ask', textCr(totals.ask), `${totals.ask || 0 ? 'Requirement above ceiling' : 'No net excess projected'}`],
      ['Possible Surrender', textCr(totals.surrender), 'Subject to pending liabilities'],
      ['Current Stage', stage.label, stage.askLabel],
      ['Watch List', String(totals.watch || 0), 'High utilisation or near ceiling'],
      ['Budget, No Expense', String(totals.noexpense || 0), 'Provision exists, no booking']
    ].map(([l,v,s]) => `<div class="bc-kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }

  const actionGrid = document.getElementById('bcActionGrid');
  if (actionGrid) {
    const actionCards = [
      ['ask','Ask From Board', totals.ask, totals.ask ? 'Requirement above current ceiling' : 'No excess projected'],
      ['surrender','Can Surrender', totals.surrender, 'Verify committed liability first'],
      ['noexpense','No Expense', totals.noexpense || 0, 'Budget exists, no actual'],
      ['watch','Watch List', totals.watch || 0, 'Close to ceiling'],
      ['normal','Normal', totals.normal || 0, 'Within control']
    ];
    actionGrid.innerHTML = actionCards.map(([cls,label,value,note]) => {
      const display = typeof value === 'number' && (cls === 'ask' || cls === 'surrender') ? textCr(value) : value;
      return `<button type="button" class="bc-action-card ${cls}" onclick="setBudgetControlAction('${cls}')"><strong>${display}</strong><span>${label}</span><em>${htmlSafe(note)}</em></button>`;
    }).join('');
  }

  const title = document.getElementById('bcTableTitle');
  if (title) title.textContent = `PU-wise Ask / Surrender Control Register - ${rows.length} PU(s) shown`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#607080;padding:16px">No PU found for selected Budget Control filters.</td></tr>';
    refreshBIViewSoon();
    return;
  }
  const rowHtml = rows.map(r => `<tr class="${r.cls}${isImportantPU(r.pu.code) ? ' important-pu-row' : ''}">
    <td class="puc puc-link" onclick="openPUDetail('${r.pu.code}')">${htmlSafe(r.pu.code)}</td>
    <td class="desc">${htmlSafe(r.pu.desc)}</td>
    <td class="n">${textCr(r.projectedRequirement)}</td>
    <td class="n bp-var-excess">${r.askAmount ? textCr(r.askAmount) : '-'}</td>
    <td class="n bp-var-saving">${r.surrenderAmount ? textCr(r.surrenderAmount) : '-'}</td>
    <td>${htmlSafe(r.stage.askLabel)}</td>
    <td class="n">${r.ceiling ? r.utilPct.toFixed(1) + '%' : (r.actualTill ? 'No Budget' : '0.0%')}</td>
    <td><span class="bc-status ${r.cls}">${htmlSafe(r.label)}</span></td>
    <td class="bc-remark">${htmlSafe(r.remark)}</td>
  </tr>`).join('');
  body.innerHTML = rowHtml + `<tr class="tot ${filteredTotals.ask > filteredTotals.surrender ? 'bc-ask' : 'bc-surrender'}">
    <td colspan="2" style="text-align:left">TOTAL SHOWN PUs</td>
    <td class="n">${textCr(filteredTotals.projected)}</td>
    <td class="n">${textCr(filteredTotals.ask)}</td>
    <td class="n">${textCr(filteredTotals.surrender)}</td>
    <td>${htmlSafe(stage.askLabel)}</td>
    <td class="n">${filteredTotals.ceiling ? ((filteredTotals.actual / filteredTotals.ceiling) * 100).toFixed(1) + '%' : '0.0%'}</td>
    <td>Filtered Total</td>
    <td class="bc-remark">Ask and surrender are based on current till-date projection. Final proposal should be vetted against committed liabilities and pending bills.</td>
  </tr>`;
  setTimeout(applyMobileTableLabels, 50);
  refreshBIViewSoon();
}

function setBudgetControlAction(action) {
  const filter = document.getElementById('bcActionFilter');
  if (!filter) return;
  filter.value = action || 'all';
  renderBudgetControl();
}

function activeTabName() {
  const active = document.querySelector('.tab-content.active');
  return active ? active.id.replace('tab-', '') : 'liability';
}

function exportCurrentView(format) {
  const tab = activeTabName();
  if (['dataexport','admin','backup','upload','remarks','additionalremarks'].includes(tab)) {
    showPortalNotice('Current-view export is available on analysis and report pages. Use Download Full Dataset / Full Report for master exports.', 'warn');
    return;
  }
  if (!window.DisplayExport || typeof DisplayExport.run !== 'function') {
    showPortalNotice('Displayed export tools are still loading. Please try again.', 'warn');
    return;
  }
  DisplayExport.run(format, tab, {currentView:true});
}

function exportCurrentTabFull(format) {
  const tab = activeTabName();
  if (['admin','backup','upload','remarks','additionalremarks'].includes(tab)) {
    showPortalNotice('Full page export is available on report pages. Use Data Export for combined portal exports.', 'warn');
    return;
  }
  if (tab === 'dataexport') {
    showPortalNotice('Use Page-wise reports or All visible portal pages from the Data Export tab.', 'warn');
    return;
  }
  if (!window.DisplayExport || typeof DisplayExport.run !== 'function') {
    showPortalNotice('Displayed export tools are still loading. Please try again.', 'warn');
    return;
  }
  DisplayExport.run(format, tab, {tableOnly:true, fullPage:true});
}

function handleReportExportSelection(select) {
  const value = select && select.value;
  if (!value) return;
  select.value = '';
  const [scope, format] = value.split(':');
  if (scope === 'view') exportCurrentView(format);
  else if (scope === 'full') exportCurrentTabFull(format);
}

function updateReportExportMenu(tab=activeTabName()) {
  const menu = document.getElementById('reportExportMenu');
  if (!menu) return;
  const excluded = new Set(['dataexport','admin','backup','upload','remarks','additionalremarks']);
  const report = currentReportTitle(tab);
  if (report.title === 'Current Report' && window.DisplayExport?.pages) {
    const page = DisplayExport.pages.find(item => item[0] === tab);
    if (page) report.title = page[1];
  }
  const canExportView = !excluded.has(tab) && !!document.getElementById('tab-' + tab);
  menu.hidden = excluded.has(tab);
  menu.classList.toggle('no-current-view', !canExportView);
  menu.title = canExportView ? `Export ${report.title}` : 'Full portal downloads';
  const group = document.getElementById('currentViewExportOptions');
  if (group) group.disabled = !canExportView;
  const select = document.getElementById('reportExportSelect');
  if (select) select.value = '';
}

function initReportExportMenu() {
  updateReportExportMenu();
}

function showFilterAlert(message) {
  let box = document.getElementById('filterAlert');
  if (!box) {
    box = document.createElement('div');
    box.id = 'filterAlert';
    box.className = 'filter-alert';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(showFilterAlert._timer);
  showFilterAlert._timer = setTimeout(() => box.classList.remove('show'), 3200);
}

function resetTopFilters() {
  const keepPUFocus = (document.getElementById('puFocusFilter') || {}).value || 'all';
  const defaults = {
    typeFilter: 'all',
    liabFilter: 'all',
    activityFilter: 'all',
    puFocusFilter: keepPUFocus,
    utilCompare: 'all',
    utilPctFilter: ''
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

function resetTrendFilters() {
  const pu = document.getElementById('trendPUSelect');
  const chart = document.getElementById('trendChartType');
  const top = document.getElementById('trendTopN');
  const py = document.getElementById('trendShowPY');
  const useBP = document.getElementById('trendUseBPPU');
  if (pu) pu.value = 'ALL';
  if (chart) chart.value = 'monthly';
  if (top) top.value = '10';
  if (py) py.checked = true;
  if (useBP) useBP.checked = false;
}

function resetAITrendFilters() {
  const scope = document.getElementById('aiTrendScope');
  if (scope) scope.value = 'priority';
}

function resetSMHFilters() {
  ['smhDeptFilter','smhCodeFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'all';
  });
  setSMHPUSelection('all', true);
  const mode = document.getElementById('smhViewMode');
  if (mode) mode.value = 'report';
}

function resetBPFilters() {
  const all = document.getElementById('bpPUAll');
  if (all) all.checked = true;
  document.querySelectorAll('#bpPUFilter .bp-pu-check').forEach(ch => { ch.checked = false; });
  ['bpStatusFilter','bpTypeFilter','bpLiabilityFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'all';
  });
  updateBPSelectionCount();
}

function resetBudgetControlFilters() {
  ['bcActionFilter','bcTypeFilter','bcLiabilityFilter','bcImpactFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'all';
  });
}

function resetFiltersForNavigation() {
  resetTopFilters();
  resetTrendFilters();
  resetAITrendFilters();
  resetSMHFilters();
  resetBPFilters();
  resetBudgetControlFilters();
}

function handleTopFilterChange(sourceLabel) {
  const tab = activeTabName();
  const supported = ['liability','monthwise','pumaster','smhdetail','bpanalysis','budgetcontrol','trend','aitrend','summary'];
  if (!supported.includes(tab)) {
    resetTopFilters();
    showFilterAlert(`${sourceLabel || 'This filter'} is not used on the current tab. Please use this page's own filters.`);
    return;
  }
  renderAll();
  if (tab === 'smhdetail' && typeof renderSMHDetail === 'function') renderSMHDetail();
  if (tab === 'bpanalysis' && typeof renderBPAnalysis === 'function') renderBPAnalysis();
  if (tab === 'budgetcontrol' && typeof renderBudgetControl === 'function') renderBudgetControl();
  if (tab === 'trend' && typeof renderTrend === 'function') renderTrend();
  if (tab === 'aitrend' && typeof renderAITrendSummary === 'function') renderAITrendSummary();
  refreshBIViewSoon();
}

// Tabs and report menu
const TAB_IDS = ['summary','liability','smhdetail','demandsmh','pumaster','monthwise','bpanalysis','budgetcontrol','excessshortfall','trend','aitrend','dataexport','historycompare','additionalremarks','admin','remarks','backup','zonalfr'];

function syncReportNavigation(name) {
  document.querySelectorAll('[data-report-tab]').forEach(btn => {
    const active = btn.dataset.reportTab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function jumpReport(name) {
  switchTab(name);
}

function initReportMenuButtons() {
  document.querySelectorAll('[data-report-tab]').forEach(btn => {
    if (btn.dataset.menuBound === '1') return;
    btn.dataset.menuBound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      if(isNavigationCopyTarget(null,true))return;
      const target = btn.dataset.reportTab;
      if (target) jumpReport(target);
    });
  });
  syncReportNavigation(activeTabName());
}

const ADMIN_CONFIG_KEY = 'nrzone_admin_design_config_v2';
const ADMIN_MENU_DEFAULTS = {
  zonalfr:'ZONAL FR Review',
  dataexport:'Data Export',
  summary:'Summary',
  liability:'Main Report',
  smhdetail:'Department wise',
  demandsmh:'Demand wise',
  pumaster:'PU Master',
  monthwise:'Month-wise',
  bpanalysis:'BP Analysis',
  budgetcontrol:'Budget Control',
  excessshortfall:'AE vs BP',
  trend:'Graphs',
  aitrend:'AI Summary',
  historycompare:'History Compare',
  additionalremarks:'Additional Remarks',
  remarks:'Remarks',
  backup:'Backup',
  admin:'Portal Admin'
};
const ADMIN_TAB_DEFAULTS = {
  summary:'Executive Summary',
  liability:'OWE Statement',
  smhdetail:'Department wise',
  demandsmh:'Demand wise',
  pumaster:'PU Master',
  monthwise:'Month-wise Actuals',
  bpanalysis:'BP Analysis',
  budgetcontrol:'Budget Control',
  excessshortfall:'AE vs BP',
  trend:'Trend Graphs',
  aitrend:'AI Trend Summary',
  historycompare:'History Compare',
  additionalremarks:'Additional Remarks',
  remarks:'Remarks',
  backup:'Portal Backup',
  admin:'Portal Admin'
};
const ADMIN_DEFAULT_CONFIG = {
  headerTitle:'ORDINARY WORKING EXPENSES (OWE) PORTAL - NR ZONE',
  headerSub:"Northern Railway | Financial Authority Dashboard | All figures in Rs Thousands ('000s) - multiply by 1,000 for actual rupees",
  footerText:'Ordinary Working Expenses (OWE) PORTAL - NR Zone / Northern Railway - FY 2026-27 - For Official Use Only',
  fontFamily:'Segoe UI, Arial, sans-serif',
  baseFont:12,
  menuFont:10,
  tableFont:10,
  filters:{type:true, liability:true, activity:true, focus:true, util:true},
  menu:Object.fromEntries(TAB_IDS.map(id => [id, {label:ADMIN_MENU_DEFAULTS[id] || id, visible:!['remarks','backup'].includes(id)}]))
};
let _adminConfig = null;

function cloneAdminDefaults() {
  return JSON.parse(JSON.stringify(ADMIN_DEFAULT_CONFIG));
}

function mergeAdminConfig(input) {
  const cfg = cloneAdminDefaults();
  const src = input && typeof input === 'object' ? input : {};
  const hasMenuConfig = !!(src.menu && typeof src.menu === 'object');
  ['headerTitle','headerSub','footerText','fontFamily'].forEach(k => {
    if (typeof src[k] === 'string') cfg[k] = src[k];
  });
  ['baseFont','menuFont','tableFont'].forEach(k => {
    const value = Number(src[k]);
    if (Number.isFinite(value)) cfg[k] = value;
  });
  cfg.filters = {...cfg.filters, ...(src.filters || {})};
  cfg.menu = {...cfg.menu};
  Object.entries(src.menu || {}).forEach(([id, val]) => {
    if (!cfg.menu[id]) cfg.menu[id] = {label:id, visible:true};
    if (typeof val === 'string') cfg.menu[id].label = val;
    else if (val && typeof val === 'object') {
      if (typeof val.label === 'string') cfg.menu[id].label = val.label;
      if (typeof val.visible === 'boolean') cfg.menu[id].visible = val.visible;
    }
  });
  ['remarks','upload','backup'].forEach(id => {
    if (!hasMenuConfig && cfg.menu[id]) cfg.menu[id].visible = false;
  });
  return cfg;
}

function loadAdminConfig() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(ADMIN_CONFIG_KEY) || 'null'); } catch(e) {}
  _adminConfig = mergeAdminConfig(stored || window.PORTAL_ADMIN_CONFIG || {});
  return _adminConfig;
}

function applyAdminConfig(config) {
  const cfg = mergeAdminConfig(config || _adminConfig || {});
  _adminConfig = cfg;
  const root = document.documentElement;
  root.style.setProperty('--admin-ui-font', cfg.fontFamily);
  root.style.setProperty('--admin-base-font', `${cfg.baseFont}px`);
  root.style.setProperty('--admin-menu-font', `${cfg.menuFont}px`);
  root.style.setProperty('--admin-table-font', `${cfg.tableFont}px`);
  const title = document.querySelector('.ht h1');
  const sub = document.querySelector('.ht p');
  const footer = document.getElementById('portalFooter');
  if (title) title.textContent = cfg.headerTitle;
  if (sub) sub.textContent = cfg.headerSub;
  if (footer) footer.textContent = cfg.footerText;
  TAB_IDS.forEach((id, idx) => {
    const menuCfg = cfg.menu[id] || {label:ADMIN_MENU_DEFAULTS[id] || id, visible:true};
    document.querySelectorAll(`[data-report-tab="${id}"]`).forEach(btn => {
      const label = btn.querySelector('span');
      if (label) label.textContent = menuCfg.label;
      btn.classList.toggle('admin-hidden-filter', menuCfg.visible === false);
    });
    const tab = document.querySelectorAll('.tabs .tab')[idx];
    if (tab) {
      tab.textContent = menuCfg.label || ADMIN_TAB_DEFAULTS[id] || id;
      tab.classList.toggle('admin-hidden-filter', menuCfg.visible === false);
    }
    if (REPORT_LABELS[id]) REPORT_LABELS[id][0] = menuCfg.label || REPORT_LABELS[id][0];
  });
  toggleAdminFilter('typeFilter', cfg.filters.type, 'all');
  toggleAdminFilter('liabFilter', cfg.filters.liability, 'all');
  toggleAdminFilter('activityFilter', cfg.filters.activity, 'all');
  toggleAdminFilter('puFocusFilter', cfg.filters.focus, 'all');
  const utilWrap = document.querySelector('.util-filter');
  if (utilWrap) utilWrap.classList.toggle('admin-hidden-filter', !cfg.filters.util);
  if (!cfg.filters.util) {
    const cmp = document.getElementById('utilCompare');
    const pct = document.getElementById('utilPctFilter');
    if (cmp) cmp.value = 'all';
    if (pct) pct.value = '';
  }
}

function toggleAdminFilter(id, visible, resetValue) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('admin-hidden-filter', !visible);
  if (!visible && resetValue !== undefined) el.value = resetValue;
}

function renderAdminDesign() {
  if (!isUploadAdminUnlocked()) return;
  const cfg = _adminConfig || loadAdminConfig();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setVal('adminHeaderTitle', cfg.headerTitle);
  setVal('adminHeaderSub', cfg.headerSub);
  setVal('adminFooterText', cfg.footerText);
  setVal('adminFontFamily', cfg.fontFamily);
  setVal('adminBaseFont', cfg.baseFont);
  setVal('adminMenuFont', cfg.menuFont);
  setVal('adminTableFont', cfg.tableFont);
  setChk('adminShowTypeFilter', cfg.filters.type);
  setChk('adminShowLiabilityFilter', cfg.filters.liability);
  setChk('adminShowActivityFilter', cfg.filters.activity);
  setChk('adminShowFocusFilter', cfg.filters.focus);
  setChk('adminShowUtilFilter', cfg.filters.util);
  const editor = document.getElementById('adminMenuEditor');
  if (editor) {
    editor.innerHTML = TAB_IDS.map(id => {
      const item = cfg.menu[id] || {label:ADMIN_MENU_DEFAULTS[id] || id, visible:true};
      return `<div class="admin-menu-row" data-admin-menu="${htmlSafe(id)}">
        <label>${htmlSafe(id)} <input type="text" value="${htmlSafe(item.label)}" data-admin-menu-label="${htmlSafe(id)}"></label>
        <label class="admin-visible"><input type="checkbox" ${item.visible !== false ? 'checked' : ''} data-admin-menu-visible="${htmlSafe(id)}"> Show</label>
      </div>`;
    }).join('');
  }
  bindAdminInputs();
  updateAdminPreview();
  renderDivisionSetupPreview();
}

function bindAdminInputs() {
  document.querySelectorAll('#tab-admin input,#tab-admin select').forEach(el => {
    if (el.dataset.adminBound === '1') return;
    el.dataset.adminBound = '1';
    el.addEventListener('input', () => {
      const cfg = readAdminForm();
      applyAdminConfig(cfg);
      updateAdminPreview(cfg);
      renderDivisionSetupPreview();
    });
    el.addEventListener('change', () => {
      const cfg = readAdminForm();
      applyAdminConfig(cfg);
      updateAdminPreview(cfg);
      renderDivisionSetupPreview();
    });
  });
}

function readAdminForm() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const chk = id => !!((document.getElementById(id) || {}).checked);
  const cfg = mergeAdminConfig(_adminConfig || {});
  cfg.headerTitle = val('adminHeaderTitle') || ADMIN_DEFAULT_CONFIG.headerTitle;
  cfg.headerSub = val('adminHeaderSub') || ADMIN_DEFAULT_CONFIG.headerSub;
  cfg.footerText = val('adminFooterText') || ADMIN_DEFAULT_CONFIG.footerText;
  cfg.fontFamily = val('adminFontFamily') || ADMIN_DEFAULT_CONFIG.fontFamily;
  cfg.baseFont = Number(val('adminBaseFont')) || ADMIN_DEFAULT_CONFIG.baseFont;
  cfg.menuFont = Number(val('adminMenuFont')) || ADMIN_DEFAULT_CONFIG.menuFont;
  cfg.tableFont = Number(val('adminTableFont')) || ADMIN_DEFAULT_CONFIG.tableFont;
  cfg.filters = {
    type:chk('adminShowTypeFilter'),
    liability:chk('adminShowLiabilityFilter'),
    activity:chk('adminShowActivityFilter'),
    focus:chk('adminShowFocusFilter'),
    util:chk('adminShowUtilFilter')
  };
  TAB_IDS.forEach(id => {
    const label = document.querySelector(`[data-admin-menu-label="${id}"]`);
    const visible = document.querySelector(`[data-admin-menu-visible="${id}"]`);
    cfg.menu[id] = {
      label: label ? label.value : (cfg.menu[id] || {}).label || id,
      visible: visible ? visible.checked : true
    };
  });
  return cfg;
}

function updateAdminPreview(config) {
  const cfg = config || readAdminForm();
  const preview = document.getElementById('adminPreview');
  if (!preview) return;
  preview.style.fontFamily = cfg.fontFamily;
  preview.style.fontSize = `${cfg.baseFont}px`;
  const head = preview.querySelector('.admin-preview-head');
  if (head) head.textContent = cfg.headerTitle;
  preview.querySelectorAll('.admin-preview-menu button').forEach(btn => {
    btn.style.fontSize = `${cfg.menuFont}px`;
  });
  const tbl = preview.querySelector('table');
  if (tbl) tbl.style.fontSize = `${cfg.tableFont}px`;
}

function saveAdminDesign() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  const cfg = readAdminForm();
  localStorage.setItem(ADMIN_CONFIG_KEY, JSON.stringify(cfg));
  applyAdminConfig(cfg);
  const status = document.getElementById('adminSaveStatus');
  if (status) status.textContent = 'Saved locally and applied';
}

function resetAdminDesign() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  localStorage.removeItem(ADMIN_CONFIG_KEY);
  _adminConfig = cloneAdminDefaults();
  applyAdminConfig(_adminConfig);
  renderAdminDesign();
  const status = document.getElementById('adminSaveStatus');
  if (status) status.textContent = 'Reset to defaults';
}

function exportAdminConfig() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  const cfg = readAdminForm();
  const content = `window.PORTAL_ADMIN_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
  saveBlob(new Blob([content], {type:'application/javascript'}), 'admin-config.js');
  const status = document.getElementById('adminSaveStatus');
  if (status) status.textContent = 'Downloaded admin-config.js for GitHub commit';
}

const DIVISION_SETUP_FILES = [
  ['pu-budget', 'PU Wise Budget Available', 'Current year BG_ISL/RG/Actuals Till Date per PU', 'Data Upload > Budget Available - CY'],
  ['pu-month', 'PU Wise Month-wise Actual', 'Current year APR-MAR actuals per PU', 'Data Upload > Month-wise Actuals - CY'],
  ['dept-budget', 'Department / SMH PU-wise Budget', 'Department, Demand/SMH and PU-wise budget rows', 'Data Upload > Department SMH Budget - CY'],
  ['dept-actual', 'Department / SMH PU-wise Actual', 'Department, Demand/SMH and PU-wise month actuals', 'Data Upload > Department SMH Month-wise Actuals - CY'],
  ['demand-budget', 'Demand / SMH Budget Summary', 'Demand/SMH level OBA/BG_ISL summary', 'Data Upload > Demand / SMH Budget Summary - CY'],
  ['demand-actual', 'Demand / SMH Actual Summary', 'Demand/SMH level month-wise actual summary', 'Data Upload > Demand / SMH Actual Summary - CY'],
  ['py-budget', 'Previous Year PU Budget', 'Previous year budget for comparison', 'Data Upload > Previous Year Budget'],
  ['py-month', 'Previous Year PU Month-wise Actual', 'Previous year APR-MAR actuals for comparison', 'Data Upload > Previous Year Month-wise']
];

function readDivisionSetupForm() {
  const val = id => ((document.getElementById(id) || {}).value || '').trim();
  const division = val('setupDivision') || 'NR Zone';
  const railway = val('setupRailway') || 'Northern Railway';
  const fy = val('setupFY') || '2026-27';
  const repoCode = val('setupRepoCode') || division.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  const selectedFiles = DIVISION_SETUP_FILES
    .filter(([key]) => {
      const el = document.querySelector(`[data-setup-file="${key}"]`);
      return !el || el.checked;
    })
    .map(([key, label, purpose, uploadSlot]) => ({key, label, purpose, uploadSlot}));
  return {division, railway, fy, repoCode, selectedFiles};
}

function divisionSetupConfig(setup) {
  const cfg = readAdminForm();
  cfg.headerTitle = `ORDINARY WORKING EXPENSES (OWE) PORTAL - ${setup.division.toUpperCase()}`;
  cfg.headerSub = `${setup.railway} | Financial Authority Dashboard | All figures in Rs Thousands ('000s) - multiply by 1,000 for actual rupees`;
  cfg.footerText = `Ordinary Working Expenses (OWE) PORTAL - ${setup.division} / ${setup.railway} - FY ${setup.fy} - For Official Use Only`;
  return cfg;
}

function divisionSetupMarkdown(setup) {
  const lines = [
    `# Ordinary Working Expenses (OWE) Portal Setup - ${setup.division}`,
    '',
    `Railway: ${setup.railway}`,
    `Financial Year: ${setup.fy}`,
    `Repository / Portal Code: ${setup.repoCode}`,
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    '',
    '## Step Process For New Division',
    '1. Create or copy a fresh GitHub Pages repository for the division portal.',
    '2. Open Portal Admin and apply division branding using the generated admin-config.js.',
    '3. Go to Data Upload and upload the checked source files in the matching upload slots.',
    '4. Click Validate Calculations in the MB-BUDGET Synced Data panel.',
    '5. Review OWE Statement, Department wise, Demand / SMH Summary, BP Analysis, Budget Control and AI Summary.',
    '6. Download Excel and PDF reports and confirm formatting before sharing.',
    '7. Use Portal Backup to download the GitHub-ready ZIP after verification.',
    '',
    '## Required Source Files',
    '| File | Purpose | Upload Slot |',
    '| --- | --- | --- |',
    ...setup.selectedFiles.map(file => `| ${file.label} | ${file.purpose} | ${file.uploadSlot} |`),
    '',
    '## Standard Portal Rules',
    '- Department 00 is skipped.',
    '- PU-98 Credit or Recoveries is skipped from normal expenditure display.',
    '- PU-72, PU-73, PU-74 and PU-75 remain display-excluded unless rule is changed in code.',
    '- Demand 12N/10N Suspense Heads is shown separately and not netted from main Demand/SMH total.',
    '- BP is recalculated inside portal as OBA or BG / 12 x completed actual months.',
    '',
    '## Recommended Acceptance Check',
    '- Current year gross budget matches IPAS source file.',
    '- Actual month detection is correct.',
    '- Demand / SMH Summary total excludes Suspense from main total.',
    '- PDF and Excel exports open and preserve formatting.',
    '- GitHub Pages opens without internet dependency for export libraries.'
  ];
  return lines.join('\n');
}

function renderDivisionSetupPreview() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  const setup = readDivisionSetupForm();
  const output = document.getElementById('divisionSetupOutput');
  if (!output) return;
  output.innerHTML = `
    <strong>${htmlSafe(setup.division)} / ${htmlSafe(setup.railway)} / FY ${htmlSafe(setup.fy)}</strong>
    <span>${setup.selectedFiles.length} source file type(s) selected. Process: set identity, upload division files, validate, export, backup, publish.</span>
    <ol>
      <li>Apply division branding.</li>
      <li>Upload or sync selected division source files.</li>
      <li>Validate calculations and review exception pages.</li>
      <li>Download GitHub-ready backup after verification.</li>
    </ol>`;
}

function applyDivisionSetup() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  const setup = readDivisionSetupForm();
  const cfg = divisionSetupConfig(setup);
  _adminConfig = cfg;
  applyAdminConfig(cfg);
  renderAdminDesign();
  renderDivisionSetupPreview();
  const status = document.getElementById('adminSaveStatus');
  if (status) status.textContent = `Applied ${setup.division} branding locally`;
  showPortalNotice(`${setup.division} branding applied. Export GitHub Config to make it permanent.`, 'ok');
}

function downloadDivisionSetupPack() {
  if (!isUploadAdminUnlocked()) { requestUploadAdmin('admin'); return; }
  const setup = readDivisionSetupForm();
  const cfg = divisionSetupConfig(setup);
  const setupJson = JSON.stringify({
    portal:'Ordinary Working Expenses (OWE) Portal',
    generatedAt:new Date().toISOString(),
    division:setup.division,
    railway:setup.railway,
    financialYear:setup.fy,
    repoCode:setup.repoCode,
    requiredFiles:setup.selectedFiles,
    adminConfig:cfg
  }, null, 2);
  const adminConfigJs = `window.PORTAL_ADMIN_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
  const checklist = divisionSetupMarkdown(setup);
  const safeName = setup.repoCode.replace(/[^A-Za-z0-9_-]+/g, '-');
  const entries = [
    {name:'division-setup.json', bytes:new TextEncoder().encode(setupJson)},
    {name:'admin-config.js', bytes:new TextEncoder().encode(adminConfigJs)},
    {name:'DIVISION_SETUP_CHECKLIST.md', bytes:new TextEncoder().encode(checklist)}
  ];
  saveBlob(createZipBlob(entries), `OWE_${safeName}_Setup_Pack.zip`);
  const status = document.getElementById('adminSaveStatus');
  if (status) status.textContent = `Downloaded setup pack for ${setup.division}`;
  renderDivisionSetupPreview();
}

function setDashboardPinned(pinned) {
  const panel = document.getElementById('dashboardPanel');
  const pin = document.getElementById('dockPin');
  const toggle = document.getElementById('dockToggle');
  const state = document.getElementById('dockState');
  if (!panel || !pin || !toggle || !state) return;
  panel.classList.toggle('collapsed', !pinned);
  panel.classList.toggle('auto-hide', !pinned);
  document.body.classList.toggle('summary-auto', !pinned);
  pin.textContent = pinned ? 'PIN' : 'AUTO';
  pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  toggle.setAttribute('aria-expanded', pinned ? 'true' : 'false');
  state.textContent = pinned ? 'PINNED' : 'AUTO-HIDE';
  try { sessionStorage.setItem('nrzone_summary_pinned', pinned ? '1' : '0'); } catch(e) {}
}

function initDashboardDock() {
  const panel = document.getElementById('dashboardPanel');
  const pin = document.getElementById('dockPin');
  const toggle = document.getElementById('dockToggle');
  if (!panel || !pin || !toggle || pin.dataset.bound === '1') return;
  pin.dataset.bound = '1';
  let saved = '1';
  try { saved = sessionStorage.getItem('nrzone_summary_pinned') || '1'; } catch(e) {}
  setDashboardPinned(saved !== '0');
  pin.addEventListener('click', () => {
    setDashboardPinned(pin.getAttribute('aria-pressed') !== 'true');
  });
  toggle.addEventListener('click', () => {
    setDashboardPinned(toggle.getAttribute('aria-expanded') !== 'true');
  });
  const dock = document.getElementById('dashboardDock');
  if (dock) {
    dock.addEventListener('dblclick', () => {
      setDashboardPinned(pin.getAttribute('aria-pressed') !== 'true');
    });
  }
}

const REPORT_LABELS = {
  summary:['Summary','Main points'],
  liability:['Main Report','OWE statement'],
  smhdetail:['Department wise','Department > Demand details'],
  demandsmh:['Demand wise','Demand grant summary'],
  pumaster:['PU Master','Code reference'],
  monthwise:['Month-wise','Actuals and projection'],
  bpanalysis:['BP Analysis','Budget Proportionate'],
  budgetcontrol:['Budget Control','Saving/excess action'],
  excessshortfall:['AE vs BP','Actual expenditure vs budget proportionate'],
  trend:['Graphs','Trend Analysis Graphs'],
  aitrend:['AI Summary','PU risk remarks'],
  remarks:['Remarks','Sources and rules'],
  backup:['Backup','Admin zip export'],
  admin:['Portal Admin','Names and layout']
};

function smartSearchItems() {
  const reportItems = Object.entries(REPORT_LABELS)
    .filter(([key]) => isUploadAdminUnlocked() || !['remarks','backup'].includes(key))
    .map(([key, val]) => ({type:'report', key, title:val[0], sub:val[1]}));
  const puItems = activePUMeta().map(pu => ({
    type:'pu',
    key:pu.code,
    title:`PU-${pu.code} ${pu.desc}`,
    sub:`${pu.puType} | ${pu.liab}`
  }));
  return reportItems.concat(puItems);
}

function renderQuickResults(term) {
  const box = document.getElementById('quickResults');
  if (!box) return;
  const q = String(term || '').trim().toLowerCase();
  if (!q) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  const results = smartSearchItems()
    .filter(item => (`${item.title} ${item.sub} ${item.key}`).toLowerCase().includes(q))
    .slice(0, 8);
  if (!results.length) {
    box.innerHTML = '<button class="quick-result" type="button"><strong>No match found</strong><small>Try PU code, report name or description</small></button>';
    box.classList.add('show');
    return;
  }
  box.innerHTML = results.map((item, idx) => `
    <button class="quick-result" type="button" data-search-index="${idx}">
      <strong>${htmlSafe(item.title)}</strong>
      <small>${htmlSafe(item.sub)}</small>
    </button>`).join('');
  box.classList.add('show');
  box.querySelectorAll('[data-search-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = results[Number(btn.dataset.searchIndex)];
      if (!item) return;
      box.classList.remove('show');
      const input = document.getElementById('quickSearch');
      if (input) input.value = '';
      if (item.type === 'report') jumpReport(item.key);
      if (item.type === 'pu') openPUDetail(item.key);
    });
  });
}

function buildRiskSpotlightItems() {
  const rows = reportRowsForActivePUs();
  const over = rows.filter(r => r.over).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance))[0];
  const noExp = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget)[0];
  const highUtil = rows.filter(r => r.budget > 0).sort((a,b) => b.utilPct - a.utilPct)[0];
  const bigBalance = rows.filter(r => r.balance > 0).sort((a,b) => b.balance - a.balance)[0];
  const items = [];
  if (over) items.push({cls:'high', label:'Over Budget', pu:over.pu, value:textCr(Math.abs(over.balance)), sub:'Needs control/support'});
  if (noExp) items.push({cls:'warn', label:'No Expense', pu:noExp.pu, value:textCr(noExp.budget), sub:'Budget available'});
  if (highUtil) items.push({cls:highUtil.utilPct >= 100 ? 'high' : 'warn', label:'Top Util', pu:highUtil.pu, value:highUtil.utilPct.toFixed(1) + '%', sub:textCr(highUtil.actual)});
  if (bigBalance) items.push({cls:'good', label:'Largest Balance', pu:bigBalance.pu, value:textCr(bigBalance.balance), sub:'Available'});
  return items;
}

function renderRiskSpotlight() {
  const wrap = document.getElementById('riskItems');
  if (!wrap) return;
  const items = buildRiskSpotlightItems();
  wrap.innerHTML = items.map(item => `
    <button type="button" class="risk-chip ${item.cls}" data-risk-pu="${htmlSafe(item.pu.code)}">
      <span>${htmlSafe(item.label)}</span>
      <strong>PU-${htmlSafe(item.pu.code)} ${htmlSafe(item.value)}</strong>
      <small>${htmlSafe(item.sub)} | ${htmlSafe(item.pu.desc)}</small>
    </button>`).join('');
  wrap.querySelectorAll('[data-risk-pu]').forEach(btn => {
    btn.addEventListener('click', () => openPUDetail(btn.dataset.riskPu));
  });
}

function currentViewSnapshot() {
  return {
    tab: activeTabName(),
    mode: reportViewMode,
    top:{
      type:(document.getElementById('typeFilter') || {}).value || 'all',
      liab:(document.getElementById('liabFilter') || {}).value || 'all',
      activity:(document.getElementById('activityFilter') || {}).value || 'all',
      puFocus:(document.getElementById('puFocusFilter') || {}).value || 'all',
      utilCompare:(document.getElementById('utilCompare') || {}).value || 'all',
      utilPct:(document.getElementById('utilPctFilter') || {}).value || ''
    },
    smh:{
      dept:(document.getElementById('smhDeptFilter') || {}).value || 'all',
      demand:(document.getElementById('smhCodeFilter') || {}).value || 'all',
      pu:smhSelectedCodes(),
      mode:(document.getElementById('smhViewMode') || {}).value || 'report'
    },
    bp:{
      status:(document.getElementById('bpStatusFilter') || {}).value || 'all',
      type:(document.getElementById('bpTypeFilter') || {}).value || 'all',
      liability:(document.getElementById('bpLiabilityFilter') || {}).value || 'all'
    }
  };
}

function applyViewSnapshot(view) {
  if (!view) return;
  if (view.top) {
    const map = {typeFilter:view.top.type || 'all', liabFilter:view.top.liab || 'all', activityFilter:view.top.activity || 'all', puFocusFilter:view.top.puFocus || 'all', utilCompare:view.top.utilCompare || 'all', utilPctFilter:view.top.utilPct || ''};
    Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
  }
  if (view.smh) {
    const map = {smhDeptFilter:view.smh.dept, smhCodeFilter:view.smh.demand, smhViewMode:view.smh.mode};
    Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
    initSMHDetailFilters();
    applySMHPUSelection(view.smh.pu || view.smh.puCodes || ['all']);
  }
  if (view.bp) {
    const map = {bpStatusFilter:view.bp.status, bpTypeFilter:view.bp.type, bpLiabilityFilter:view.bp.liability};
    Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
  }
  if (view.mode) setReportViewMode(view.mode);
  switchTab(view.tab || 'liability');
  setTimeout(() => {
    renderAll();
    if (view.tab === 'smhdetail') renderSMHDetail();
    if (view.tab === 'bpanalysis') renderBPAnalysis();
  }, 80);
}

function sessionViews() {
  try { return JSON.parse(sessionStorage.getItem('nrzone_session_views') || '[]'); } catch(e) { return []; }
}

function saveSessionViews(views) {
  try { sessionStorage.setItem('nrzone_session_views', JSON.stringify(views.slice(-12))); } catch(e) {}
}

function refreshSavedViews() {
  const sel = document.getElementById('savedViewSelect');
  if (!sel) return;
  const current = sel.value;
  const views = sessionViews();
  sel.innerHTML = '<option value="">Session Views</option>' + views.map((v, i) => `<option value="${i}">${htmlSafe(v.name)}</option>`).join('');
  sel.value = current;
}

function saveCurrentSessionView() {
  const tab = activeTabName();
  const label = (REPORT_LABELS[tab] || ['Current View'])[0];
  const now = new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
  const views = sessionViews();
  views.push({name:`${label} - ${now}`, view:currentViewSnapshot()});
  saveSessionViews(views);
  refreshSavedViews();
  showFilterAlert('View saved for this browser session.');
}

const TOUR_STEPS = [
  ['Report Menu', 'Use these report boxes to jump directly to any major report without searching through filters.'],
  ['Quick Search', 'Type a PU code, PU name or report name. Select a result to open it immediately.'],
  ['Risk Spotlight', 'These cards surface urgent items like over-budget, no-expense and high-utilisation PUs.'],
  ['Summary Panel', 'Use PIN/AUTO to keep KPI cards open or auto-hide them for more table space.'],
  ['Officer Brief', 'Open a short higher-authority summary before downloading the full PDF report.']
];
let tourIndex = 0;

function showTourStep() {
  const bubble = document.getElementById('tourBubble');
  if (!bubble) return;
  const step = TOUR_STEPS[tourIndex] || TOUR_STEPS[0];
  const title = document.getElementById('tourTitle');
  const text = document.getElementById('tourText');
  if (title) title.textContent = `${tourIndex + 1}/${TOUR_STEPS.length} - ${step[0]}`;
  if (text) text.textContent = step[1];
  bubble.classList.add('show');
}

function closeTour() {
  const bubble = document.getElementById('tourBubble');
  if (bubble) bubble.classList.remove('show');
}

function startTour() {
  tourIndex = 0;
  showTourStep();
}

function openTopUtilisationBrief() {
  const rows = reportRowsForActivePUs()
    .filter(r => r.budget > 0 || r.actual !== 0)
    .sort((a,b) => b.utilPct - a.utilPct)
    .slice(0, 15);
  const top = rows[0];
  const bars = rows.map(r => {
    const pctVal = Math.max(0, Math.min(200, r.utilPct || 0));
    const col = r.utilPct >= 100 ? '#B00020' : r.utilPct >= 85 ? '#E85D04' : r.utilPct >= 60 ? '#C07000' : '#1A7A4A';
    const remark = r.over ? 'Over budget - control booking / seek support'
      : r.utilPct >= 85 ? 'High utilisation - watch before next booking'
      : r.noExpense ? 'Budget available but no expense'
      : 'Within current watch range';
    return `<div class="tu-row">
      <div class="tu-code">PU-${htmlSafe(r.pu.code)}</div>
      <div class="tu-main">
        <div class="tu-title">${htmlSafe(r.pu.desc)}</div>
        <div class="tu-bar"><span style="width:${Math.min(100,pctVal)}%;background:${col}"></span></div>
        <div class="tu-note">${htmlSafe(remark)}</div>
      </div>
      <div class="tu-val" style="color:${col}">${r.utilPct.toFixed(1)}%</div>
      <div class="tu-bal">${textCr(r.balance)}</div>
    </div>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Top Utilisation Brief | Ordinary Working Expenses (OWE) Portal</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Tahoma,"Segoe UI",Arial,sans-serif;background:#F3F7FB;color:#0A1628;padding:18px}
    .brief-page{max-width:1120px;margin:0 auto;background:#fff;border:1px solid #D8E5F2;border-top:5px solid #C9A84C;border-radius:10px;box-shadow:0 10px 28px rgba(10,22,40,.12);overflow:hidden}
    .tu-head{background:#0A1628;color:#DDEEFF;padding:18px 22px;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    .tu-head h1{font-size:20px;color:#C9A84C;margin-bottom:4px}
    .tu-head p{font-size:11px;color:#A8C0D8}
    .tu-kpi{background:#FFF4C2;color:#071324;border-radius:8px;padding:10px 14px;text-align:center;min-width:150px}
    .tu-kpi span{display:block;font-size:9px;font-weight:900;text-transform:uppercase;color:#5A3E00}
    .tu-kpi strong{display:block;font-size:20px;margin-top:3px}
    .tu-body{padding:14px 18px}
    .tu-row{display:grid;grid-template-columns:70px minmax(0,1fr) 80px 110px;gap:12px;align-items:center;border:1px solid #E3ECF6;border-left:4px solid #1A4E9A;border-radius:8px;padding:10px;margin-bottom:8px;background:#F8FBFF}
    .tu-code{font-size:12px;font-weight:900;color:#123A63}
    .tu-title{font-size:12px;font-weight:900;color:#0A1628}
    .tu-bar{height:10px;background:#E8EFF8;border-radius:8px;overflow:hidden;margin:6px 0}
    .tu-bar span{display:block;height:100%;border-radius:8px}
    .tu-note{font-size:10px;color:#607080}
    .tu-val{font-size:14px;font-weight:900;text-align:right}
    .tu-bal{font-size:11px;font-weight:800;color:#33485F;text-align:right}
    .tu-footer{padding:10px 18px;border-top:1px solid #E3ECF6;font-size:10px;color:#607080;text-align:center}
    @page{size:A4 landscape;margin:10mm}
    @media print{
      body{background:#fff;padding:0;font-size:10pt}
      .brief-page{max-width:none;border-radius:0;box-shadow:none}
      .tu-kpi span,.tu-note,.tu-footer{font-size:10pt}
      .tu-row{break-inside:avoid;padding:7px;margin-bottom:5px}
    }
    @media(max-width:700px){.tu-row{grid-template-columns:1fr}.tu-val,.tu-bal{text-align:left}.tu-head{display:block}.tu-kpi{margin-top:10px}}
  </style></head><body><div class="brief-page">
    <div class="tu-head">
      <div><h1>Top Utilisation Brief</h1><p>PU-wise high utilisation position for higher authority review. Figures are based on current portal data.</p></div>
      <div class="tu-kpi"><span>Highest Utilisation</span><strong>${top ? top.utilPct.toFixed(1) + '%' : '0.0%'}</strong><small>${top ? 'PU-' + htmlSafe(top.pu.code) + ' ' + htmlSafe(top.pu.desc) : 'No data'}</small></div>
    </div>
    <div class="tu-body">${bars || '<div class="tu-row">No utilisation data available.</div>'}</div>
    <div class="tu-footer">Ordinary Working Expenses (OWE) Portal - NR Zone / Northern Railway - Generated ${new Date().toLocaleString('en-IN')}</div>
  </div></body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
  } else {
    showFilterAlert('Popup blocked. Please allow popup to open Top Utilisation Brief.');
  }
}

function buildOfficerBriefData() {
  const rows = reportRowsForActivePUs();
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget; t.actual += r.actual; t.balance += r.balance;
    return t;
  }, {budget:0, actual:0, balance:0});
  totals.util = totals.budget ? totals.actual / totals.budget * 100 : 0;
  const highWatchAll = rows.filter(r => r.high).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const overAll = rows.filter(r => r.over).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const noExpAll = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget);
  const high = rows.filter(r => r.budget > 0).sort((a,b) => b.utilPct - a.utilPct).slice(0, 5);
  const over = overAll.slice(0, 5);
  const noExp = noExpAll.slice(0, 5);
  const bcRows = typeof buildBudgetControlRows === 'function' ? buildBudgetControlRows() : [];
  const askTotal = bcRows.reduce((s,r) => s + (r.askAmount || 0), 0);
  const surrenderTotal = bcRows.reduce((s,r) => s + (r.surrenderAmount || 0), 0);
  const topAsk = bcRows.filter(r => r.askAmount > 0).sort((a,b) => b.askAmount - a.askAmount)[0];
  const topSurrender = bcRows.filter(r => r.surrenderAmount > 0).sort((a,b) => b.surrenderAmount - a.surrenderAmount)[0];
  const topUtil = high[0];
  return {rows, totals, highWatchAll, overAll, noExpAll, high, over, noExp, askTotal, surrenderTotal, topAsk, topSurrender, topUtil};
}

function openOfficerBriefPDF() {
  const d = buildOfficerBriefData();
  const {cur, actualMonths} = getMonthStatus();
  const generated = new Date().toLocaleString('en-IN');
  const explainRows = [
    ['High / Watch PUs', `${d.highWatchAll.length}`, d.highWatchAll[0] ? `Top: PU-${d.highWatchAll[0].pu.code} ${d.highWatchAll[0].pu.desc}` : 'No high/watch PU', 'PUs requiring close monitoring due to over-budget position, high utilisation, no-budget spend or other risk signals. These should be reviewed before next booking cycle.'],
    ['Over Budget', `${d.overAll.length}`, d.overAll[0] ? `PU-${d.overAll[0].pu.code}: ${textCr(Math.abs(d.overAll[0].balance))} over` : 'No over-budget PU', 'Items where committed expenditure has crossed the available budget ceiling. Booking control or additional budget support may be needed.'],
    ['Budget, No Expense', `${d.noExpAll.length}`, d.noExpAll[0] ? `Largest: PU-${d.noExpAll[0].pu.code} ${textCr(d.noExpAll[0].budget)}` : 'No no-expense item', 'Budget provision exists but no actual expenditure is visible. Confirm whether liability is pending or saving can be proposed.'],
    ['Amount to Ask', textCr(d.askTotal), d.topAsk ? `Top ask: PU-${d.topAsk.pu.code} ${textCr(d.topAsk.askAmount)}` : 'No additional grant projected', 'Projection indicates requirement above current budget ceiling. This is the amount to examine for AR/REA/RG/FME support.'],
    ['Possible Surrender', textCr(d.surrenderTotal), d.topSurrender ? `Top saving: PU-${d.topSurrender.pu.code} ${textCr(d.topSurrender.surrenderAmount)}` : 'No surrender signal projected', 'Projected saving against current ceiling. Confirm pending bills and committed liability before surrender proposal.'],
    ['Top Utilisation', d.topUtil ? d.topUtil.utilPct.toFixed(1) + '%' : '0.0%', d.topUtil ? `PU-${d.topUtil.pu.code} ${d.topUtil.pu.desc}` : 'No utilisation data', 'Highest utilisation head by current portal data. This needs special monitoring if it is near or above budget ceiling.']
  ];
  const cards = explainRows.map(([title,value,note]) => `<div class="ob-card"><span>${htmlSafe(title)}</span><strong>${htmlSafe(value)}</strong><small>${htmlSafe(note)}</small></div>`).join('');
  const explanations = explainRows.map(([title,value,note,explain]) => `<tr><td>${htmlSafe(title)}</td><td>${htmlSafe(value)}</td><td>${htmlSafe(note)}</td><td>${htmlSafe(explain)}</td></tr>`).join('');
  const watchList = (d.over.length ? d.over : d.high).map(r => `<tr><td>PU-${htmlSafe(r.pu.code)}</td><td>${htmlSafe(r.pu.desc)}</td><td>${textCr(r.balance)}</td><td>${r.utilPct.toFixed(1)}%</td><td>${r.over ? 'Over budget / support required' : 'High utilisation watch'}</td></tr>`).join('');
  const noExpRows = d.noExp.map(r => `<tr><td>PU-${htmlSafe(r.pu.code)}</td><td>${htmlSafe(r.pu.desc)}</td><td>${textCr(r.budget)}</td><td>Budget available but no actual expense booked</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Officer Brief PDF | Ordinary Working Expenses (OWE) Portal</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Tahoma,"Segoe UI",Arial,sans-serif;background:#F3F7FB;color:#0A1628;padding:16px}
    .page{max-width:1160px;margin:0 auto;background:#fff;border:1px solid #D8E5F2;border-top:5px solid #C9A84C;border-radius:10px;overflow:hidden;box-shadow:0 12px 30px rgba(10,22,40,.12)}
    .head{background:#0A1628;color:#DDEEFF;padding:18px 22px;display:flex;justify-content:space-between;gap:16px}
    h1{font-size:20px;color:#C9A84C;margin-bottom:4px}
    .head p{font-size:11px;color:#A8C0D8;line-height:1.45}
    .print{border:1px solid #C9A84C;background:#FFF4C2;color:#071324;border-radius:7px;padding:8px 12px;font-size:11px;font-weight:900;cursor:pointer;height:34px}
    .body{padding:16px 18px}
    .kpis,.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
    .cards{grid-template-columns:repeat(3,1fr)}
    .kpi,.ob-card{border:1px solid #D8E5F2;border-left:4px solid #1A4E9A;border-radius:8px;background:#F8FBFF;padding:10px}
    .ob-card:nth-child(2),.ob-card:nth-child(4){border-left-color:#B00020}.ob-card:nth-child(3){border-left-color:#B88700}.ob-card:nth-child(5){border-left-color:#1A7A4A}.ob-card:nth-child(6){border-left-color:#E85D04}
    span{display:block;font-size:10px;font-weight:900;color:#607080;text-transform:uppercase}
    strong{display:block;font-size:17px;color:#0A1628;margin:4px 0;font-weight:900}
    small{display:block;font-size:10px;color:#496276;line-height:1.35}
    .sec{margin-top:12px;border:1px solid #D8E5F2;border-radius:8px;overflow:hidden}
    .sec h2{background:#1A3A6A;color:#DDEEFF;font-size:12px;padding:8px 10px}
    table{width:100%;border-collapse:collapse;font-size:10px;font-family:"Times New Roman",Times,serif}
    table th,table td{font-family:"Times New Roman",Times,serif}
    th{background:#2474B8;color:#fff;text-align:left;padding:7px;border:1px solid #B8D0E8}
    td{padding:7px;border:1px solid #D2E0EF;vertical-align:top;line-height:1.35}
    .foot{text-align:center;font-size:10px;color:#607080;padding:10px;border-top:1px solid #D8E5F2}
    @page{size:A4 landscape;margin:10mm}
    @media print{body{background:#fff;padding:0;font-size:10pt}.page{max-width:none;box-shadow:none;border-radius:0}.print{display:none}.body{padding:10px}.sec{break-inside:auto}.kpis,.cards{gap:6px}.kpi,.ob-card{padding:8px}span,small,.foot{font-size:10pt}strong{font-size:14pt}table{table-layout:fixed;width:100%}td,th{font-size:10pt;padding:5px;overflow-wrap:anywhere}thead{display:table-header-group}}
  </style></head><body><div class="page">
    <div class="head"><div><h1>Officer Brief</h1><p>Ordinary Working Expenses (OWE) Portal - NR Zone / Northern Railway<br>FY 2026-27 | Current month: ${cur.label} ${cur.year} | Completed months: ${actualMonths.length} | Generated: ${generated}</p></div><button class="print" onclick="window.print()">Print / Save PDF</button></div>
    <div class="body">
      <div class="kpis">
        <div class="kpi"><span>Gross Budget</span><strong>${textCr(d.totals.budget)}</strong><small>Active operational PU budget</small></div>
        <div class="kpi"><span>Actual Till Date</span><strong>${textCr(d.totals.actual)}</strong><small>Committed / actual visible in portal</small></div>
        <div class="kpi"><span>Balance</span><strong>${textCr(d.totals.balance)}</strong><small>Budget less committed</small></div>
        <div class="kpi"><span>Utilisation</span><strong>${d.totals.util.toFixed(1)}%</strong><small>Actual against budget</small></div>
      </div>
      <div class="cards">${cards}</div>
      <div class="sec"><h2>Brief Explanation of Each Point</h2><table><thead><tr><th>Point</th><th>Value</th><th>Current Signal</th><th>Brief Meaning / Action</th></tr></thead><tbody>${explanations}</tbody></table></div>
      <div class="sec"><h2>Top Over Budget / Watch PUs</h2><table><thead><tr><th>PU</th><th>Description</th><th>Balance</th><th>Utilisation</th><th>Action Remark</th></tr></thead><tbody>${watchList || '<tr><td colspan="5">No major watch item found.</td></tr>'}</tbody></table></div>
      <div class="sec"><h2>Budget Available But No Expense</h2><table><thead><tr><th>PU</th><th>Description</th><th>Budget</th><th>Remark</th></tr></thead><tbody>${noExpRows || '<tr><td colspan="4">No major no-expense item found.</td></tr>'}</tbody></table></div>
    </div>
    <div class="foot">For Official Use Only - Ordinary Working Expenses (OWE) Portal</div>
  </div></body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch(e) {} }, 250);
  } else {
    showFilterAlert('Popup blocked. Please allow popup to open Officer Brief PDF.');
  }
}

function renderOfficerBrief() {
  const body = document.getElementById('officerBriefBody');
  if (!body) return;
  const d = buildOfficerBriefData();
  const {totals, highWatchAll, overAll, noExpAll, high, over, noExp, askTotal, surrenderTotal, topAsk, topSurrender, topUtil} = d;
  body.innerHTML = `
    <div class="brief-kpis">
      <div class="brief-kpi"><span>Gross Budget</span><strong>${textCr(totals.budget)}</strong></div>
      <div class="brief-kpi"><span>Actual Till Date</span><strong>${textCr(totals.actual)}</strong></div>
      <div class="brief-kpi"><span>Balance</span><strong>${textCr(totals.balance)}</strong></div>
      <div class="brief-kpi"><span>Utilisation</span><strong>${totals.util.toFixed(1)}%</strong></div>
    </div>
    <div class="brief-exec-grid">
      <div class="brief-exec-card risk"><span>High / Watch PUs</span><strong>${highWatchAll.length}</strong><small>${highWatchAll[0] ? `Top: PU-${htmlSafe(highWatchAll[0].pu.code)} ${htmlSafe(highWatchAll[0].pu.desc)}` : 'No high/watch PU'}</small></div>
      <div class="brief-exec-card danger"><span>Over Budget</span><strong>${overAll.length}</strong><small>${overAll[0] ? `PU-${htmlSafe(overAll[0].pu.code)}: ${textCr(Math.abs(overAll[0].balance))} over` : 'No over-budget PU'}</small></div>
      <div class="brief-exec-card warn"><span>Budget, No Expense</span><strong>${noExpAll.length}</strong><small>${noExpAll[0] ? `Largest: PU-${htmlSafe(noExpAll[0].pu.code)} ${textCr(noExpAll[0].budget)}` : 'No no-expense item'}</small></div>
      <div class="brief-exec-card danger"><span>Amount to Ask</span><strong>${textCr(askTotal)}</strong><small>${topAsk ? `Top ask: PU-${htmlSafe(topAsk.pu.code)} ${textCr(topAsk.askAmount)}` : 'No additional grant projected'}</small></div>
      <div class="brief-exec-card good"><span>Possible Surrender</span><strong>${textCr(surrenderTotal)}</strong><small>${topSurrender ? `Top saving: PU-${htmlSafe(topSurrender.pu.code)} ${textCr(topSurrender.surrenderAmount)}` : 'No surrender signal projected'}</small></div>
      <button type="button" class="brief-exec-card clickable risk" onclick="openTopUtilisationBrief()"><span>Top Utilisation</span><strong>${topUtil ? topUtil.utilPct.toFixed(1) + '%' : '0.0%'}</strong><small>${topUtil ? `PU-${htmlSafe(topUtil.pu.code)} ${htmlSafe(topUtil.pu.desc)} - click for brief` : 'Click for brief page'}</small></button>
    </div>
    <div class="brief-list"><h4>Priority Observations</h4><ul>
      <li>${over.length} PU(s) are over budget or require close control.</li>
      <li>${noExp.length} major PU(s) have budget available but no expense booked.</li>
      <li>Highest utilisation PU: ${high[0] ? `PU-${high[0].pu.code} at ${high[0].utilPct.toFixed(1)}%` : 'not available'}.</li>
      <li>Use the full PDF Report for detailed annexures and source notes.</li>
    </ul></div>
    <div class="brief-list"><h4>Top Over Budget / Watch PUs</h4><ul>
      ${(over.length ? over : high).map(r => `<li>PU-${htmlSafe(r.pu.code)} ${htmlSafe(r.pu.desc)} - balance ${textCr(r.balance)}, utilisation ${r.utilPct.toFixed(1)}%</li>`).join('')}
    </ul></div>
    <div class="brief-list"><h4>Budget Available But No Expense</h4><ul>
      ${noExp.length ? noExp.map(r => `<li>PU-${htmlSafe(r.pu.code)} ${htmlSafe(r.pu.desc)} - budget ${textCr(r.budget)}</li>`).join('') : '<li>No major no-expense item found in current view.</li>'}
    </ul></div>`;
}

function openOfficerBrief() {
  renderOfficerBrief();
  const modal = document.getElementById('officerBriefModal');
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeOfficerBrief() {
  const modal = document.getElementById('officerBriefModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function applyPreviewStyleOption(option) {
  const selected = ['a', 'b', 'c'].includes(option) ? option : 'a';
  document.body.classList.add('professional-preview');
  document.body.classList.toggle('preview-option-b', selected === 'b');
  document.body.classList.toggle('preview-option-c', selected === 'c');
  try { localStorage.setItem('owePreviewStyleOption', selected); } catch (e) {}
  const sel = document.getElementById('previewStyleSelect');
  if (sel && sel.value !== selected) sel.value = selected;
}

function initSmartTools() {
  const previewSel = document.getElementById('previewStyleSelect');
  if (previewSel && previewSel.dataset.bound !== '1') {
    previewSel.dataset.bound = '1';
    let savedOption = 'a';
    try { savedOption = localStorage.getItem('owePreviewStyleOption') || 'a'; } catch (e) {}
    previewSel.value = ['a', 'b', 'c'].includes(savedOption) ? savedOption : 'a';
    applyPreviewStyleOption(previewSel.value);
    previewSel.addEventListener('change', () => applyPreviewStyleOption(previewSel.value));
  }
  const quick = document.getElementById('quickSearch');
  if (quick && quick.dataset.bound !== '1') {
    quick.dataset.bound = '1';
    quick.addEventListener('input', () => renderQuickResults(quick.value));
    quick.addEventListener('keydown', e => {
      if (e.key === 'Escape') renderQuickResults('');
    });
  }
  const saveBtn = document.getElementById('saveViewBtn');
  if (saveBtn && saveBtn.dataset.bound !== '1') {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', saveCurrentSessionView);
  }
  const savedSel = document.getElementById('savedViewSelect');
  if (savedSel && savedSel.dataset.bound !== '1') {
    savedSel.dataset.bound = '1';
    savedSel.addEventListener('change', () => {
      const idx = Number(savedSel.value);
      const item = sessionViews()[idx];
      if (item) applyViewSnapshot(item.view);
    });
  }
  const tourBtn = document.getElementById('startTourBtn');
  if (tourBtn && tourBtn.dataset.bound !== '1') {
    tourBtn.dataset.bound = '1';
    tourBtn.addEventListener('click', startTour);
  }
  const tourNext = document.getElementById('tourNextBtn');
  if (tourNext && tourNext.dataset.bound !== '1') {
    tourNext.dataset.bound = '1';
    tourNext.addEventListener('click', () => {
      tourIndex = (tourIndex + 1) % TOUR_STEPS.length;
      showTourStep();
    });
  }
  const tourClose = document.getElementById('tourCloseBtn');
  if (tourClose && tourClose.dataset.bound !== '1') {
    tourClose.dataset.bound = '1';
    tourClose.addEventListener('click', closeTour);
  }
  const briefBtn = document.getElementById('officerBriefBtn');
  if (briefBtn && briefBtn.dataset.bound !== '1') {
    briefBtn.dataset.bound = '1';
    briefBtn.addEventListener('click', openOfficerBrief);
  }
  const briefPdfBtn = document.getElementById('briefPdfBtn');
  if (briefPdfBtn && briefPdfBtn.dataset.bound !== '1') {
    briefPdfBtn.dataset.bound = '1';
    briefPdfBtn.addEventListener('click', openOfficerBriefPDF);
  }
  const briefClose = document.getElementById('briefCloseBtn');
  if (briefClose && briefClose.dataset.bound !== '1') {
    briefClose.dataset.bound = '1';
    briefClose.addEventListener('click', closeOfficerBrief);
  }
  refreshSavedViews();
  renderRiskSpotlight();
}

const HISTORY_INDEX_URL = 'data/mb-budget-sync/history/history-index.json';
let _historyIndex = null;
let _historyCache = {};
let _historyCompareRows = [];
let _historySort = {idx:0, dir:1};

async function fetchJsonFresh(url) {
  const sep = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${sep}v=${encodeURIComponent(ASSET_VERSION || Date.now())}`, {cache:'no-store'});
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

function historyMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-IN', {minimumFractionDigits:0, maximumFractionDigits:0});
}

function historyCrText(value) {
  const n = Number(value) || 0;
  return textCr(n).replace(/^0\.00 Cr$/, '0.00 Cr');
}

function historyMoneyDualText(value) {
  const n = Number(value) || 0;
  return `${historyMoney(n)}\n${historyCrText(n)}`;
}

function historySignedCrText(value) {
  return signedCr(value);
}

function historySignedDualText(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${historyMoney(Math.abs(n))}\n${historySignedCrText(n)}`;
}

function historyMoneyDualHtml(value, signed=false) {
  const n = Number(value) || 0;
  const top = signed ? `${n > 0 ? '+' : n < 0 ? '-' : ''}${historyMoney(Math.abs(n))}` : historyMoney(n);
  const cr = signed ? historySignedCrText(n) : historyCrText(n);
  return `<span class="dual-money"><span>${htmlSafe(top)}</span><small>${htmlSafe(cr)}</small></span>`;
}

function historyPct(value) {
  const n = Number(value) || 0;
  return `${n.toFixed(2)}%`;
}

function historySigned(value, pct=false) {
  const n = Number(value) || 0;
  const text = pct ? `${Math.abs(n).toFixed(2)}%` : historyMoney(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${text}`;
}

function historySignedDual(value) {
  return historySignedDualText(value);
}

function historySnapshotOption(item) {
  return item.label || `${item.generatedAt || ''} | ${item.sourceRevision || item.id}`;
}

function historySelects() {
  return [
    document.getElementById('historyFromSync'),
    document.getElementById('historyToSync'),
    document.getElementById('historyExportFrom'),
    document.getElementById('historyExportTo')
  ].filter(Boolean);
}

async function loadHistoryIndex() {
  if (!_historyIndex) _historyIndex = await fetchJsonFresh(HISTORY_INDEX_URL);
  return _historyIndex;
}

async function loadHistorySnapshot(id) {
  if (!id) return null;
  if (_historyCache[id]) return _historyCache[id];
  const index = await loadHistoryIndex();
  const item = (index.snapshots || []).find(s => s.id === id);
  if (!item) throw new Error(`Snapshot not found: ${id}`);
  const path = item.snapshotPath || `data/mb-budget-sync/history/${id}/snapshot-data.json`;
  _historyCache[id] = await fetchJsonFresh(path);
  return _historyCache[id];
}

function populateHistorySelects(index) {
  const snapshots = index && Array.isArray(index.snapshots) ? index.snapshots : [];
  const markup = snapshots.map(s => `<option value="${htmlSafe(s.id)}">${htmlSafe(historySnapshotOption(s))}</option>`).join('');
  historySelects().forEach(sel => {
    const old = sel.value;
    sel.innerHTML = markup;
    if (snapshots.some(s => s.id === old)) sel.value = old;
  });
  if (snapshots.length >= 2) {
    const fromDefault = snapshots[snapshots.length - 2].id;
    const toDefault = snapshots[snapshots.length - 1].id;
    ['historyFromSync','historyExportFrom'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = fromDefault;
    });
    ['historyToSync','historyExportTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = toDefault;
    });
  }
}

function syncHistoryExportSelection(which, value, skipRender=false) {
  const targetIds = which === 'from' ? ['historyFromSync','historyExportFrom'] : ['historyToSync','historyExportTo'];
  targetIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== value) el.value = value;
  });
  if (!skipRender) renderHistoryCompare();
}

function historyDiffRows(fromSnapshot, toSnapshot) {
  const fromMap = new Map((fromSnapshot.puRows || []).map(r => [String(r.pu), r]));
  const toMap = new Map((toSnapshot.puRows || []).map(r => [String(r.pu), r]));
  const codes = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
  return codes.map(code => {
    const from = fromMap.get(code) || {};
    const to = toMap.get(code) || {};
    const row = {
      pu: code,
      description: to.description || from.description || '',
      fromBudget: Number(from.budget) || 0,
      toBudget: Number(to.budget) || 0,
      fromActual: Number(from.actual) || 0,
      toActual: Number(to.actual) || 0,
      fromBalance: Number(from.balance) || 0,
      toBalance: Number(to.balance) || 0,
      fromUtilPct: Number(from.utilPct) || 0,
      toUtilPct: Number(to.utilPct) || 0,
    };
    row.budgetChange = row.toBudget - row.fromBudget;
    row.actualChange = row.toActual - row.fromActual;
    row.balanceChange = row.toBalance - row.fromBalance;
    row.utilPctChange = row.toUtilPct - row.fromUtilPct;
    row.status = !fromMap.has(code) ? 'New' : !toMap.has(code) ? 'Removed' :
      (Math.abs(row.budgetChange) + Math.abs(row.actualChange) + Math.abs(row.balanceChange) + Math.abs(row.utilPctChange) > 0.0001 ? 'Changed' : 'Unchanged');
    return row;
  });
}

function filteredHistoryRows() {
  const q = (document.getElementById('historyFilter')?.value || '').toLowerCase().trim();
  let rows = _historyCompareRows.slice();
  if (q) rows = rows.filter(r => `${r.pu} ${r.description} ${r.status}`.toLowerCase().includes(q));
  const idx = _historySort.idx;
  const keys = ['pu','description','fromBudget','toBudget','budgetChange','fromActual','toActual','actualChange','fromBalance','toBalance','balanceChange','fromUtilPct','toUtilPct','utilPctChange','status'];
  const key = keys[idx] || 'pu';
  rows.sort((a,b) => {
    const av = a[key], bv = b[key];
    if (typeof av === 'number' || typeof bv === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * _historySort.dir;
    return String(av || '').localeCompare(String(bv || ''), undefined, {numeric:true}) * _historySort.dir;
  });
  return rows;
}

function renderHistoryCompareRows() {
  const body = document.getElementById('historyCompareBody');
  if (!body) return;
  const rows = filteredHistoryRows();
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:18px">No PU movement found for this selection/filter.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `<tr>
    <td>${htmlSafe(r.pu)}</td><td>${htmlSafe(r.description)}</td>
    <td class="num">${historyMoneyDualHtml(r.fromBudget)}</td><td class="num">${historyMoneyDualHtml(r.toBudget)}</td><td class="num ${r.budgetChange<0?'neg':'pos'}">${historyMoneyDualHtml(r.budgetChange,true)}</td>
    <td class="num">${historyMoneyDualHtml(r.fromActual)}</td><td class="num">${historyMoneyDualHtml(r.toActual)}</td><td class="num ${r.actualChange<0?'neg':'pos'}">${historyMoneyDualHtml(r.actualChange,true)}</td>
    <td class="num">${historyMoneyDualHtml(r.fromBalance)}</td><td class="num">${historyMoneyDualHtml(r.toBalance)}</td><td class="num ${r.balanceChange<0?'neg':'pos'}">${historyMoneyDualHtml(r.balanceChange,true)}</td>
    <td class="num">${historyPct(r.fromUtilPct)}</td><td class="num">${historyPct(r.toUtilPct)}</td><td class="num ${r.utilPctChange<0?'neg':'pos'}">${historySigned(r.utilPctChange,true)}</td>
    <td><span class="history-status-pill ${htmlSafe(r.status.toLowerCase())}">${htmlSafe(r.status)}</span></td>
  </tr>`).join('');
  applyMobileTableLabels();
}

function renderHistoryTopList(id, rows, field, sign) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = rows.filter(r => sign > 0 ? r[field] > 0 : r[field] < 0)
    .sort((a,b) => Math.abs(b[field]) - Math.abs(a[field])).slice(0,5);
  el.innerHTML = top.length ? top.map(r => `<li>PU ${htmlSafe(r.pu)} - ${htmlSafe(r.description)} <strong>${historySignedDual(r[field])}</strong></li>`).join('') : '<li>No movement</li>';
}

function renderHistoryKpis(fromSnapshot, toSnapshot) {
  const box = document.getElementById('historyCompareKpis');
  if (!box) return;
  const rows = _historyCompareRows;
  const totals = rows.reduce((t,r) => {
    t.budget += r.budgetChange; t.actual += r.actualChange; t.balance += r.balanceChange;
    if (r.status === 'New') t.newCount += 1;
    if (r.status === 'Removed') t.removedCount += 1;
    if (r.status === 'Changed') t.changedCount += 1;
    return t;
  }, {budget:0, actual:0, balance:0, newCount:0, removedCount:0, changedCount:0});
  box.innerHTML = [
    ['From', fromSnapshot.label || fromSnapshot.id],
    ['To', toSnapshot.label || toSnapshot.id],
    ['Budget change', historySignedDual(totals.budget)],
    ['Actual change', historySignedDual(totals.actual)],
    ['Balance change', historySignedDual(totals.balance)],
    ['PU status', `${totals.changedCount} changed, ${totals.newCount} new, ${totals.removedCount} removed`],
  ].map(([label,value]) => `<div class="history-kpi"><span>${htmlSafe(label)}</span><strong>${htmlSafe(value)}</strong></div>`).join('');
  renderHistoryTopList('historyTopBudgetUp', rows, 'budgetChange', 1);
  renderHistoryTopList('historyTopBudgetDown', rows, 'budgetChange', -1);
  renderHistoryTopList('historyTopActualUp', rows, 'actualChange', 1);
  renderHistoryTopList('historyTopActualDown', rows, 'actualChange', -1);
}

async function renderHistoryCompare() {
  if(window.NR_ZONE_DATA){window.NR_YEAR_COMPARE?.display('historycompare');return;}
  const status = document.getElementById('historyCompareStatus');
  try {
    const index = await loadHistoryIndex();
    populateHistorySelects(index);
    const snapshots = index.snapshots || [];
    if (snapshots.length < 2) {
      if (status) status.textContent = 'Need at least two sync snapshots. Run local sync after new data to build history.';
      _historyCompareRows = [];
      renderHistoryCompareRows();
      return;
    }
    const fromId = document.getElementById('historyFromSync')?.value || document.getElementById('historyExportFrom')?.value || snapshots[snapshots.length - 2].id;
    const toId = document.getElementById('historyToSync')?.value || document.getElementById('historyExportTo')?.value || snapshots[snapshots.length - 1].id;
    syncHistoryExportSelection('from', fromId, true);
    syncHistoryExportSelection('to', toId, true);
    const [fromSnapshot, toSnapshot] = await Promise.all([loadHistorySnapshot(fromId), loadHistorySnapshot(toId)]);
    _historyCompareRows = historyDiffRows(fromSnapshot, toSnapshot);
    if (status) status.textContent = `${_historyCompareRows.length} PU rows compared`;
    renderHistoryKpis(fromSnapshot, toSnapshot);
    renderHistoryCompareRows();
    bindHistoryTableSort();
  } catch (error) {
    _historyCompareRows = [];
    if (status) status.textContent = error.message || 'History snapshots are not available yet.';
    renderHistoryCompareRows();
  }
}

function bindHistoryTableSort() {
  document.querySelectorAll('#historyCompareTable th').forEach((th, idx) => {
    if (th.dataset.historySortBound === '1') return;
    th.dataset.historySortBound = '1';
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      _historySort = _historySort.idx === idx ? {idx, dir:_historySort.dir * -1} : {idx, dir:1};
      document.querySelectorAll('#historyCompareTable th').forEach(h => h.classList.remove('sort-asc','sort-desc'));
      th.classList.add(_historySort.dir > 0 ? 'sort-asc' : 'sort-desc');
      renderHistoryCompareRows();
    });
  });
}

function showDataExportPanel(panel) {
  const selected = panel === 'history' ? 'history' : 'reports';
  document.querySelectorAll('.data-export-tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.exportPanel === selected));
  document.querySelectorAll('.data-export-panel').forEach(box => box.classList.toggle('active', box.id === (selected === 'history' ? 'dataExportPanelHistory' : 'dataExportPanelReports')));
  if (selected === 'history'&&window.NR_ZONE_DATA){const panel=document.getElementById('dataExportPanelHistory');panel.innerHTML='<h3>NR previous-year comparison exports</h3>';window.NR_YEAR_COMPARE?.display('historycompare',panel);return;}
  if (selected === 'history') renderHistoryCompare();
}

function historyExportRows() {
  const rows = filteredHistoryRows();
  return rows.map(r => [r.pu, r.description, historyMoneyDualText(r.fromBudget), historyMoneyDualText(r.toBudget), historySignedDualText(r.budgetChange), historyMoneyDualText(r.fromActual), historyMoneyDualText(r.toActual), historySignedDualText(r.actualChange), historyMoneyDualText(r.fromBalance), historyMoneyDualText(r.toBalance), historySignedDualText(r.balanceChange), Number(r.fromUtilPct.toFixed(2)), Number(r.toUtilPct.toFixed(2)), Number(r.utilPctChange.toFixed(2)), r.status]);
}

async function downloadHistoryCompareExport(format) {
  if (!confirmProtectedExport(`History Compare ${format} export`)) return;
  if (!_historyCompareRows.length) await renderHistoryCompare();
  const headers = ['PU','Description','From Budget','To Budget','Budget Change','From Actual','To Actual','Actual Change','From Balance','To Balance','Balance Change','From Util %','To Util %','Util % Change','Status'];
  const rows = historyExportRows();
  const title = 'Ordinary Working Expenses (OWE) PORTAL - NR Zone | History Compare';
  const filename = `OWE_History_Compare_${new Date().toISOString().slice(0,10)}`;
  if (format === 'Excel') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('History Compare', {pageSetup:{orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0}});
    ws.addRow([title]); ws.mergeCells(1,1,1,headers.length);
    ws.addRow(headers); rows.forEach(row => ws.addRow(row));
    ws.eachRow((row, rowNumber) => {
      row.height = rowNumber <= 2 ? 24 : 34;
      row.eachCell(cell => { cell.font = {name:'Times New Roman', size:10}; cell.alignment = {vertical:'middle', wrapText:true}; cell.border = {top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'}}; });
    });
    ws.getRow(1).font = {name:'Times New Roman', size:12, bold:true};
    ws.getRow(2).font = {name:'Times New Roman', size:10, bold:true};
    ws.columns.forEach((col, idx) => { col.width = idx === 1 ? 28 : (idx >= 2 && idx <= 10 ? 18 : 14); });
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `${filename}.xlsx`);
  } else if (format === 'PDF') {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
    if(window.DisplayExport) await DisplayExport.configurePDF(doc);
    doc.setFont('Times','bold'); doc.setFontSize(12); doc.text(title, 28, 28);
    doc.autoTable({head:[headers], body:rows, startY:42, theme:'grid', styles:{font:'Times',fontSize:10,cellPadding:2,overflow:'linebreak',valign:'middle'}, headStyles:{fillColor:[28,58,94],textColor:255,fontSize:10}, columnStyles:{1:{cellWidth:80}}});
    saveBlob(doc.output('blob'), `${filename}.pdf`);
  } else {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'OWE Portal';
    const chunk = 18;
    for (let i=0; i<Math.max(rows.length,1); i+=chunk) {
      const slide = pptx.addSlide();
      slide.background = {color:'FFFFFF'};
      slide.addText(title, {x:0.3,y:0.2,w:12.7,h:0.3,fontFace:'Times New Roman',fontSize:14,bold:true,color:'17365D'});
      const part = rows.slice(i, i+chunk).map(row => row.map(v => typeof v === 'number' ? historyMoney(v) : String(v ?? '')));
      slide.addTable([headers, ...part], {x:0.2,y:0.65,w:12.9,h:6.4,border:{type:'solid',color:'666666',pt:0.5},fontFace:'Times New Roman',fontSize:10,color:'111111',fit:'shrink',margin:0.03,breakLine:false});
    }
    const blob = await pptx.write({outputType:'blob'});
    saveBlob(blob, `${filename}.pptx`);
  }
}

function renderDataExport(){ if(window.DisplayExport) DisplayExport.init(); renderHistoryCompare(); }
function switchTab(name) {
  if(name==='zonalfr')window.renderZonalFR?.();
  if(name==='dataexport')renderDataExport();
  if ((name === 'remarks' || name === 'upload' || name === 'backup' || name === 'admin') && !isUploadAdminUnlocked()) {
    requestUploadAdmin(name);
    return;
  }
  if (name !== activeTabName() && name !== 'dataexport') resetFiltersForNavigation();
  if(name==='summary'){setTimeout(renderSummaryPage,80);}
  if(name==='trend'){setTimeout(renderTrend,80);}
  if(name==='aitrend'){setTimeout(renderAITrendSummary,80);}
  if(name==='historycompare'){setTimeout(renderHistoryCompare,80);}
  if(name==='additionalremarks'){setTimeout(renderAdditionalRemarks,80);}
  if(name==='bpanalysis'){setTimeout(renderBPAnalysis,80);}
  if(name==='budgetcontrol'){setTimeout(renderBudgetControl,80);}
  if(name==='excessshortfall'){setTimeout(renderExcessShortfall,80);}
  if(name==='demandsmh'){setTimeout(renderDemandSMHSummary,80);}
  if(name==='remarks'){setTimeout(renderRemarks,80);}
  if(name==='admin'){setTimeout(renderAdminDesign,80);}
  document.querySelectorAll('.tab').forEach((t,i) => {
    t.classList.toggle('active', TAB_IDS[i]===name);
  });
  syncReportNavigation(name);
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id==='tab-'+name);
  });
  updateReportExportMenu(name);
  window.refreshNRYearComparisons?.();
  if(_pp){ _pp.style.opacity='0'; _pp.style.transform='translateY(6px)'; }
  if(['liability','monthwise','pumaster'].includes(name)){setTimeout(renderAll,50);}
  if(name==='upload') { renderCurDataGrid(); updateHostedUploadGuard(); }
  if(name==='backup') renderBackupPage();
  if(name==='smhdetail'){setTimeout(renderSMHDetail,80);}
  setTimeout(()=>{makeReportTablesSortable();applyMobileTableLabels();}, 140);
  setTimeout(renderBIView, 160);
}

window.jumpReport = jumpReport;
window.switchTab = switchTab;
window.activeTabName = activeTabName;
window.exportCurrentView = exportCurrentView;
window.handleReportExportSelection = handleReportExportSelection;
window.exportCurrentTabFull = exportCurrentTabFull;
window.updateReportExportMenu = updateReportExportMenu;
window.filterPUChecklist = filterPUChecklist;
window.closePUDrawer = closePUDrawer;
window.saveAdminDesign = saveAdminDesign;
window.resetAdminDesign = resetAdminDesign;
window.exportAdminConfig = exportAdminConfig;
window.applyDivisionSetup = applyDivisionSetup;
window.downloadDivisionSetupPack = downloadDivisionSetupPack;
window.renderDivisionSetupPreview = renderDivisionSetupPreview;
window.renderHistoryCompare = renderHistoryCompare;
window.renderHistoryCompareRows = renderHistoryCompareRows;
window.renderAdditionalRemarks = renderAdditionalRemarks;
window.refreshDynamicAI = refreshDynamicAI;
window.buildBudgetAnomalyFindings = buildBudgetAnomalyFindings;
window.showDataExportPanel = showDataExportPanel;
window.syncHistoryExportSelection = syncHistoryExportSelection;
window.downloadHistoryCompareExport = downloadHistoryCompareExport;

function textCr(n) {
  if (!n || isNaN(n)) return '0.00 Cr';
  return ((n * 1000) / 10000000).toFixed(2) + ' Cr';
}

function pctChangeText(curVal, baseVal) {
  if (!baseVal) return curVal ? 'new spend pattern' : 'no movement';
  const pctVal = ((curVal - baseVal) / Math.abs(baseVal)) * 100;
  return (pctVal >= 0 ? '+' : '') + pctVal.toFixed(1) + '%';
}

function signedCr(n) {
  const value = Number(n) || 0;
  if (!value) return '0.00 Cr';
  return (value > 0 ? '+' : '-') + textCr(Math.abs(value));
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Allow slow browsers/download handlers to acquire the full Blob before cleanup.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const BACKUP_FILE_LIST = Object.freeze([
  'index.html',
  'README.md',
  'assets/css/main.css',
  'assets/css/theme-digital-india.css',
  'assets/css/theme-cpgrams-gov.css',
  'assets/css/theme-control-room.css',
  'assets/css/theme-executive-light.css',
  'assets/css/theme-gov-command.css',
  'assets/js/app.js',
  'assets/js/admin-config.js',
  'assets/js/zone-au-data.js',
  'assets/js/zone-au-py-data.js',
  'assets/js/zone-au-scope.js',
  'assets/js/zonal-fr.js',
  'assets/js/fr-monitoring.js',
  'assets/js/fr-enhancements.js',
  'assets/js/nr-graphs.js',
  'assets/js/nr-year-comparison.js',
  'assets/css/zonal-fr.css',
  'assets/css/executive-portal.css',
  'assets/js/detail-data.js',
  'assets/js/demand-smh-data.js',
  'assets/vendor/xlsx.full.min.js',
  'assets/vendor/exceljs.min.js',
  'assets/js/smh-matrix-export.js',
  'assets/js/display-export.js',
  'assets/vendor/pptxgen.bundle.js',
  'assets/fonts/times.ttf',
  'assets/fonts/timesbd.ttf',
  'assets/vendor/jspdf.umd.min.js',
  'assets/vendor/jspdf.plugin.autotable.min.js'
]);

let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function u16(value) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, value, true);
  return b;
}

function u32(value) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return b;
}

function concatUint8(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function createZipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime(new Date());
  entries.forEach(entry => {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, '/'));
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(data);
    const localHeader = concatUint8([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes
    ]);
    localParts.push(localHeader, data);
    const centralHeader = concatUint8([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });
  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const endRecord = concatUint8([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(offset), u16(0)
  ]);
  return new Blob([...localParts, ...centralParts, endRecord], {type:'application/zip'});
}

function renderBackupPage() {
  const status = document.getElementById('backupStatus');
  const detail = document.getElementById('backupDetail');
  const fileList = document.getElementById('backupFileList');
  if (status) status.textContent = 'Ready';
  if (detail) detail.textContent = 'Click the button below to create and download a zip backup.';
  if (fileList) fileList.textContent = `Files: ${BACKUP_FILE_LIST.length} GitHub-ready portal files`;
}

async function downloadPortalBackup() {
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin('backup');
    return;
  }
  const btn = document.getElementById('downloadBackupBtn');
  const status = document.getElementById('backupStatus');
  const detail = document.getElementById('backupDetail');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating ZIP...';
    }
    if (status) status.textContent = 'Preparing';
    if (detail) detail.textContent = 'Reading portal files from current GitHub/local folder...';
    const entries = [];
    for (const file of BACKUP_FILE_LIST) {
      const res = await fetch(file + '?backup=' + Date.now(), {cache:'no-store'});
      if (!res.ok) throw new Error(`Unable to include ${file} (${res.status})`);
      entries.push({name:file, bytes:new Uint8Array(await res.arrayBuffer())});
    }
    const manifest = [
      'Ordinary Working Expenses (OWE) Portal Backup',
      `Created: ${new Date().toLocaleString('en-IN')}`,
      `Financial Year: 2026-27`,
      '',
      'Files included:',
      ...BACKUP_FILE_LIST.map(f => `- ${f}`),
      '',
      'Upload this extracted folder to GitHub Pages repository root.'
    ].join('\n');
    entries.push({name:'BACKUP_MANIFEST.txt', bytes:new TextEncoder().encode(manifest)});
    const fileDate = new Date().toISOString().slice(0,10);
    saveBlob(createZipBlob(entries), `OWE_Portal_GitHub_Backup_${fileDate}.zip`);
    if (status) status.textContent = 'Downloaded';
    if (detail) detail.textContent = `${entries.length} files packaged successfully.`;
  } catch (err) {
    console.error('Backup download failed', err);
    if (status) status.textContent = 'Failed';
    if (detail) detail.textContent = err.message || String(err);
    showPortalNotice('Backup download failed: ' + (err.message || err), 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download Portal Backup ZIP';
    }
  }
}

let _hostedUpdatePackReady = false;

function hostedUploadModeLabel() {
  const host = String(location.hostname || '').toLowerCase();
  if (host.endsWith('github.io')) return 'GitHub Pages live portal';
  if (host === '127.0.0.1' || host === 'localhost') return 'Local test server';
  if (location.protocol === 'file:') return 'Local file preview';
  return 'Static browser portal';
}

function updateHostedUploadGuard(ready) {
  if (typeof ready === 'boolean') _hostedUpdatePackReady = ready;
  const wrap = document.getElementById('hostedUploadGuard');
  const title = document.getElementById('hostedUploadTitle');
  const msg = document.getElementById('hostedUploadMsg');
  const btn = document.getElementById('downloadHostedPackBtn');
  if (!wrap || !title || !msg || !btn) return;
  const mode = hostedUploadModeLabel();
  wrap.classList.toggle('session-ready', _hostedUpdatePackReady);
  title.textContent = _hostedUpdatePackReady ? 'Session data applied - export for GitHub' : `${mode} upload rule`;
  msg.textContent = _hostedUpdatePackReady
    ? 'The open portal has been refreshed in this browser. Download the GitHub Update Pack to make this data permanent on the hosted site.'
    : 'Browser upload refreshes this open session only. GitHub Pages cannot rewrite repository files by itself; use local sync or download an update pack after OK Apply.';
  btn.disabled = !_hostedUpdatePackReady && !isUploadAdminUnlocked();
}

function jsonForPortal(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function replaceRequiredBlock(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Could not update ${label} in app.js`);
  return text.replace(pattern, replacement);
}

function demandCurrentPayload() {
  const rows = demandSMHRows().map(r => ({
    Name: isDemandSMHSuspense(r) ? `Demand ${r.demand || '12N'} / ${r.smh || '10N'}` : `Demand ${r.demand} / SMH ${r.smh}`,
    OBA:Number(r.oba) || 0,
    BP:Number(r.bp) || 0,
    AE:Number(r.ae) || 0,
    Variation:Number(r.variation) || 0,
    BPPercent:Number(r.bpPct) || 0,
    Remaining:Number(r.budgetRemaining) || 0,
    OBAPercent:Number(r.obaUtil) || 0,
    Months:Number(demandSMHData().completedMonths) || getBPModeStatus().bpMonthCount,
    Department:r.dept || r.description || ''
  }));
  const totals = demandSMHTotals();
  rows.push({
    Name:'Total',
    OBA:totals.oba,
    BP:totals.bp,
    AE:totals.ae,
    Variation:totals.variation,
    BPPercent:totals.bpPct,
    Remaining:totals.budgetRemaining,
    OBAPercent:totals.obaUtil,
    Months:Number(demandSMHData().completedMonths) || getBPModeStatus().bpMonthCount
  });
  return {
    demand:{title:'Demand wise Current Year', rows},
    generatedAt:(_dataAsOnDate instanceof Date ? _dataAsOnDate : new Date()).toISOString(),
    source:'Browser upload export pack'
  };
}

function reportsDataSnapshot() {
  const budgetDemand = {};
  demandSMHRows().forEach(r => {
    const key = isDemandSMHSuspense(r) ? `Demand ${r.demand || '12N'} / SMH ${r.smh || '10N'}` : `Demand ${r.demand} / SMH ${r.smh}`;
    budgetDemand[key] = {'2026-27':{oba:Number(r.oba)||0, ae:Number(r.ae)||0, bp:Number(r.bp)||0}};
  });
  const latest = getMonthStatus().latestActual;
  const aiDigest = _latestAIAnomalyDigest || buildBudgetAnomalyFindings();
  return {
    budget:{demand:budgetDemand},
    aiAnomalyDigest:aiDigest,
    generatedAt:(_dataAsOnDate instanceof Date ? _dataAsOnDate : new Date()).toISOString(),
    latestMonth:latest ? `${latest.label} ${latest.year}` : ''
  };
}

function syncManifestSnapshot() {
  const status = getMonthStatus();
  const detail = window.DETAIL_SMH_DATA || {};
  const demandRows = demandSMHRows();
  const demandTotals = demandSMHTotals();
  const generatedAt = (_dataAsOnDate instanceof Date ? _dataAsOnDate : new Date()).toISOString();
  const aiDigest = _latestAIAnomalyDigest || buildBudgetAnomalyFindings();
  return {
    portal:'Ordinary Working Expenses (OWE) Portal',
    division:'NR Zone',
    railway:'Northern Railway',
    financialYear:'2026-2027',
    generatedAt,
    confirmedAt:generatedAt,
    source:'Browser upload export pack',
    latestMonth:status.latestActual ? `${status.latestActual.label} ${status.latestActual.year}` : '',
    currentMonth:`${status.cur.label} ${status.cur.year}`,
    rows:{
      puBudget:Object.keys(BUDGET || {}).length,
      puMonth:Object.keys(MONTH || {}).length,
      detail:Array.isArray(detail.rows) ? detail.rows.length : 0,
      demandSmh:demandRows.length
    },
    aiAnomalyDigest:{
      generatedAt:aiDigest.generatedAt,
      findingCount:(aiDigest.findings || []).length,
      criticalCount:(aiDigest.findings || []).filter(x => x.severity === 'Critical').length,
      watchCount:(aiDigest.findings || []).filter(x => x.severity === 'Watch').length,
      topFindings:(aiDigest.findings || []).slice(0, 10).map(x => ({
        pu:x.pu && x.pu.code,
        description:x.pu && x.pu.desc,
        severity:x.severity,
        type:x.type,
        why:x.why,
        action:x.action
      }))
    },
    totals:{
      grossBudget:getBudget('TOTAL'),
      actualTillDate:(BUDGET.TOTAL && BUDGET.TOTAL.actuals_till) || 0,
      detailBudget:(detail.totals && detail.totals.budget) || 0,
      detailActual:(detail.totals && detail.totals.actualTill) || 0,
      demandMainAECompleted:demandTotals.ae,
      demandMainBPCompleted:demandTotals.bp
    },
    bpMode:getBPModeStatus().formulaLabel
  };
}

async function buildHostedAppJs() {
  const response = await fetch(`assets/js/app.js?export=${Date.now()}`, {cache:'no-store'});
  if (!response.ok) throw new Error(`Cannot read assets/js/app.js (${response.status})`);
  let app = await response.text();
  const buildDate = new Date();
  const buildId = `rlp-mbd-${buildDate.toISOString().slice(0,10)}-browser-upload`;
  app = replaceRequiredBlock(app, /const SOURCE_REGISTER = \{[\s\S]*?\};\r?\n\r?\n\/\/ Budget data from BudgetReport/, `const SOURCE_REGISTER = ${jsonForPortal(SOURCE_REGISTER)};\n\n// Budget data from BudgetReport`, 'SOURCE_REGISTER');
  app = replaceRequiredBlock(app, /let BUDGET = [\s\S]*?;\r?\n\r?\n\/\/ Month-wise actuals from MONTH WISE report - Rs'000s/, `let BUDGET = ${jsonForPortal(BUDGET)};\n\n// Month-wise actuals from MONTH WISE report - Rs'000s`, 'BUDGET');
  app = replaceRequiredBlock(app, /let MONTH = [\s\S]*?;\r?\nlet BUDGET_PY = /, `let MONTH = ${jsonForPortal(MONTH)};\nlet BUDGET_PY = `, 'MONTH');
  app = replaceRequiredBlock(app, /let BUDGET_PY = [\s\S]*?;\r?\nlet MONTH_PY = /, `let BUDGET_PY = ${jsonForPortal(BUDGET_PY)};\nlet MONTH_PY = `, 'BUDGET_PY');
  app = replaceRequiredBlock(app, /let MONTH_PY = [\s\S]*?;\r?\n\r?\n\/\/[\s\S]*?CURRENT MONTH DETECTION/, `let MONTH_PY = ${jsonForPortal(MONTH_PY)};\n\n// CURRENT MONTH DETECTION`, 'MONTH_PY');
  app = replaceRequiredBlock(app, /const DEFAULT_DATA_AS_ON_DATE = new Date\('[^']+'\);/, `const DEFAULT_DATA_AS_ON_DATE = new Date('${(_dataAsOnDate instanceof Date ? _dataAsOnDate : new Date()).toISOString()}');`, 'DEFAULT_DATA_AS_ON_DATE');
  app = replaceRequiredBlock(app, /const RLP_BUILD_ID = '[^']+';/, `const RLP_BUILD_ID = '${buildId}';`, 'RLP_BUILD_ID');
  return app;
}

async function downloadHostedUpdatePack() {
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin('upload');
    return;
  }
  const btn = document.getElementById('downloadHostedPackBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating Pack...';
    }
    const now = new Date();
    const fileDate = now.toISOString().slice(0,10);
    const encoder = new TextEncoder();
    const detailData = window.DETAIL_SMH_DATA || {rows:[], totals:{}, generatedAt:now.toISOString()};
    const demandData = window.DEMAND_SMH_SUMMARY_DATA || {rows:[], totals:{}, generatedAt:now.toISOString()};
    const appJs = await buildHostedAppJs();
    const entries = [
      {name:'assets/js/app.js', bytes:encoder.encode(appJs)},
      {name:'assets/js/detail-data.js', bytes:encoder.encode(`window.DETAIL_SMH_DATA = ${jsonForPortal({...detailData, generatedAt:now.toISOString()})};\n`)},
      {name:'assets/js/demand-smh-data.js', bytes:encoder.encode(`window.DEMAND_SMH_SUMMARY_DATA = ${jsonForPortal({...demandData, generatedAt:now.toISOString()})};\n`)},
      {name:'data/mb-budget-sync/processed/current_payload.js', bytes:encoder.encode(`window.CURRENT_PAYLOAD = ${jsonForPortal(demandCurrentPayload())};\n`)},
      {name:'data/mb-budget-sync/processed/reports-data.json', bytes:encoder.encode(jsonForPortal(reportsDataSnapshot()))},
      {name:'data/mb-budget-sync/sync-manifest.json', bytes:encoder.encode(jsonForPortal(syncManifestSnapshot()))},
      {name:'GITHUB_UPDATE_README.txt', bytes:encoder.encode([
        'Ordinary Working Expenses (OWE) Portal - GitHub Update Pack',
        `Created: ${now.toLocaleString('en-IN')}`,
        `Mode: ${hostedUploadModeLabel()}`,
        '',
        'How to publish:',
        '1. Extract this ZIP into the GitHub repository root.',
        '2. Replace existing files when asked.',
        '3. Commit in GitHub Desktop.',
        '4. Push origin and wait for GitHub Pages deployment.',
        '',
        'Note: GitHub Pages is static hosting. Browser upload cannot write repository files directly; this pack carries the parsed session data into commit-ready files.'
      ].join('\n'))}
    ];
    saveBlob(createZipBlob(entries), `OWE_GitHub_Update_Pack_${fileDate}.zip`);
    showPortalNotice('GitHub Update Pack downloaded. Extract into repo root, then commit and push.', 'ok');
  } catch (err) {
    console.error('GitHub update pack failed', err);
    showPortalNotice('Could not create GitHub Update Pack: ' + (err.message || err), 'err');
  } finally {
    if (btn) {
      btn.disabled = !_hostedUpdatePackReady;
      btn.textContent = 'Download GitHub Update Pack';
    }
    updateHostedUploadGuard();
  }
}

function htmlSafe(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function trendRiskClass(item) {
  if (item.overSpent || item.noBudgetSpend || item.utilPct >= 100) return 'high';
  if (item.utilPct >= 85 || item.balanceRatio < 0.1 || item.projRise) return 'watch';
  return 'ok';
}

function includeInAITrendSummary(pu) {
  const isCommittedStaff = pu.puType === 'Staff PU' && String(pu.liab).includes('Committed');
  return isActiveDisplayPU(pu) && !isCommittedStaff;
}

function hasPYTrendData() {
  const hasRows = obj => Object.keys(obj || {}).some(key => key !== 'TOTAL');
  return hasRows(MONTH_PY) || hasRows(BUDGET_PY);
}

function buildAITrendItems() {
  const {cur, actualMonths} = getMonthStatus();
  // Decision analysis must use completed months only. The running month can be
  // partial and would otherwise distort month movement, YoY and annual forecast.
  const completedKey = actualMonths.length ? actualMonths[actualMonths.length - 1] : FY_MONTHS[Math.max(0, cur.idx - 1)];
  const actualIdx = Math.max(0, FY_MONTHS.indexOf(completedKey));
  const prevIdx = Math.max(0, actualIdx - 1);
  const prevKey = FY_MONTHS[prevIdx];
  const curKey = FY_MONTHS[actualIdx];
  const prevLabel = FY_MONTH_LABELS[prevIdx];
  const curLabel = FY_MONTH_LABELS[actualIdx];
  const compareMonthKeys = FY_MONTHS.slice(0, actualIdx + 1);
  const compareMonthLabels = FY_MONTH_LABELS.slice(0, actualIdx + 1);

  return PU_META.filter(pu => includeInAITrendSummary(pu) && passesPUFocus(pu.code)).map(pu => {
    const md = MONTH[pu.code] || {};
    const py = MONTH_PY[pu.code] || {};
    const cv = compute(pu.code);
    const budget = cv.budget || 0;
    const cyPrev = Number(md[prevKey]) || 0;
    const cyCur = Number(md[curKey]) || 0;
    const pyPrev = Number(py[prevKey]) || 0;
    const pyCur = Number(py[curKey]) || 0;
    const monthRows = compareMonthKeys.map((key, idx) => {
      const cyMonth = Number(md[key]) || 0;
      const pyMonth = Number(py[key]) || 0;
      return {
        key,
        label: compareMonthLabels[idx],
        cy: cyMonth,
        py: pyMonth,
        diff: cyMonth - pyMonth,
        pct: pyMonth ? ((cyMonth - pyMonth) / Math.abs(pyMonth)) * 100 : null
      };
    });
    const cySamePeriod = monthRows.reduce((s,r) => s + r.cy, 0);
    const pySamePeriod = monthRows.reduce((s,r) => s + r.py, 0);
    const cyTotalAsOn = cySamePeriod;
    const pyTotalAsOn = pySamePeriod;
    const ytdDiff = cyTotalAsOn - pyTotalAsOn;
    const avgCyMonth = monthRows.length ? cySamePeriod / monthRows.length : 0;
    const forecastYearEnd = avgCyMonth * 12;
    const forecastVariance = forecastYearEnd - budget;
    const utilPct = budget ? Math.abs((cv.totalCommitted / budget) * 100) : (cv.totalCommitted ? 999 : 0);
    const balanceRatio = budget ? cv.balanceBudget / Math.abs(budget) : 0;
    const overSpent = cv.balanceBudget < 0;
    const noBudgetSpend = budget === 0 && cv.totalCommitted !== 0;
    const projRise = avgCyMonth > 0 && cv.projPerMonth > avgCyMonth * 1.15;
    const budgetNoExpense = budget > 0 && Math.abs(cyTotalAsOn) === 0;
    const latestMovePct = Math.abs(cyPrev) > 0 ? ((cyCur - cyPrev) / Math.abs(cyPrev)) * 100 : (cyCur ? 100 : 0);
    const yoyPct = pyTotalAsOn ? ((cyTotalAsOn - pyTotalAsOn) / Math.abs(pyTotalAsOn)) * 100 : null;
    let riskScore = 0;
    if (noBudgetSpend) riskScore += 55;
    if (overSpent) riskScore += 45;
    else if (utilPct >= 100) riskScore += 40;
    else if (utilPct >= 85) riskScore += 28;
    else if (utilPct >= 70) riskScore += 15;
    if (budget && balanceRatio < .10) riskScore += 15;
    if (forecastVariance > Math.max(budget * .05, 1000)) riskScore += 18;
    if (projRise) riskScore += 8;
    if (budgetNoExpense) riskScore += 18;
    if (Math.abs(latestMovePct) >= 30) riskScore += 8;
    if (yoyPct !== null && yoyPct >= 25) riskScore += 8;
    riskScore = Math.min(100, Math.round(riskScore));
    const risk = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'watch' : 'ok';
    const confidence = monthRows.length >= 3 && hasPYTrendData() ? 'High' : monthRows.length >= 3 ? 'Medium' : 'Low';
    const recommendedAction = noBudgetSpend ? 'Arrange budget provision and verify booking immediately.'
      : overSpent ? 'Restrict further booking and initiate budget re-appropriation/ask review.'
      : forecastVariance > 0 ? `Review likely year-end excess of ${textCr(forecastVariance)} and pending liabilities.`
      : budgetNoExpense ? 'Confirm work/order and pending bills; consider phased surrender if no liability exists.'
      : utilPct >= 85 ? 'Monitor next booking cycle and validate remaining committed liability.'
      : 'Continue monthly monitoring; no immediate budget intervention indicated.';

    return {
      pu, cv, budget, cyPrev, cyCur, pyPrev, pyCur, utilPct, balanceRatio,
      overSpent, noBudgetSpend, projRise, risk, prevLabel, curLabel,
      monthRows, cyTotalAsOn, pyTotalAsOn, ytdDiff, budgetNoExpense, avgCyMonth,
      forecastYearEnd, forecastVariance, latestMovePct, yoyPct, riskScore, confidence, recommendedAction,
      actualIdx, actualMonthLabel:curLabel
    };
  }).sort((a,b) => {
    const riskScore = {high:3, watch:2, ok:1};
    return (b.riskScore - a.riskScore) || (riskScore[b.risk] - riskScore[a.risk]) ||
      (Math.abs(b.utilPct) - Math.abs(a.utilPct)) ||
      (Math.abs(b.cv.balanceBudget) - Math.abs(a.cv.balanceBudget));
  });
}

let _latestAIAnomalyDigest = null;

function buildBudgetAnomalyFindings() {
  const {cur, actualMonths} = getMonthStatus();
  const latestKey = actualMonths[actualMonths.length - 1];
  const prevKey = actualMonths[actualMonths.length - 2];
  const syncAt = _dataAsOnDate ? indianDateTime(_dataAsOnDate) : indianDateTime(new Date());
  const sourceRevision = (window.SYNC_MANIFEST && (window.SYNC_MANIFEST.sourceRevision || window.SYNC_MANIFEST.revision)) ||
    (_uploadConfirmHistory[0] && _uploadConfirmHistory[0].at) ||
    ASSET_VERSION;
  const findings = [];
  const push = (item) => {
    if (!item || !item.pu) return;
    findings.push(Object.assign({
      severity:'Watch',
      source:'Dynamic AI anomaly scan',
      syncAt,
      sourceRevision
    }, item));
  };

  trendDecisionRows().forEach(row => {
    const pu = row.pu;
    const md = MONTH[pu.code] || {};
    const budget = Number(row.budget) || 0;
    const actual = Number(row.actual) || 0;
    const balance = Number(row.balance) || 0;
    const util = Number(row.utilPct) || 0;
    const latestActual = latestKey ? Number(md[latestKey]) || 0 : 0;
    const prevActual = prevKey ? Number(md[prevKey]) || 0 : 0;
    const move = latestActual - prevActual;
    const projectedNeed = Number(row.projPerMonth || row.projectedRequirement || 0) || 0;
    const remainingMonths = Math.max(0, (getMonthStatus().futureMonths || []).length);
    const likelyNeed = actual + projectedNeed * remainingMonths;

    if (balance < 0 || util >= 100) push({
      pu, severity:'Critical', type:'Over Budget',
      why:`Actual has crossed budget; utilisation ${util.toFixed(1)}%.`,
      action:'Restrict further booking and review additional grant/re-appropriation.',
      budget, actual, balance, util
    });
    else if (util >= 95) push({
      pu, severity:'Critical', type:'Utilisation above 95%',
      why:`Only ${textCr(balance)} remains after ${util.toFixed(1)}% utilisation.`,
      action:'Verify pending bills and remaining requirement immediately.',
      budget, actual, balance, util
    });
    else if (util >= 85) push({
      pu, severity:'Watch', type:'High Utilisation above 85%',
      why:`Utilisation is ${util.toFixed(1)}% before year end.`,
      action:'Monitor next booking cycle and validate balance sufficiency.',
      budget, actual, balance, util
    });

    if (budget > 0 && !actual) push({
      pu, severity:'Watch', type:'Budget Available, No Actual',
      why:`Budget ${textCr(budget)} exists but no actual is booked.`,
      action:'Check whether work/order is pending or surrender review is needed.',
      budget, actual, balance, util
    });
    if (!budget && actual) push({
      pu, severity:'Critical', type:'Actual booked without budget',
      why:`Actual ${textCr(actual)} is booked against nil budget.`,
      action:'Confirm booking head and arrange budget provision if valid.',
      budget, actual, balance, util
    });
    if (prevKey && latestKey && Math.abs(move) > Math.max(Math.abs(prevActual) * 0.75, Math.abs(budget) * 0.03, 1000)) push({
      pu, severity: move > 0 ? 'Watch' : 'Normal', type:'Sudden month-on-month movement',
      why:`${FY_MONTH_LABELS[FY_MONTHS.indexOf(prevKey)] || prevKey} to ${FY_MONTH_LABELS[FY_MONTHS.indexOf(latestKey)] || latestKey} movement is ${signedCr(move)}.`,
      action:'Verify whether the movement is due to normal bulk booking or abnormal adjustment.',
      budget, actual, balance, util
    });
    if (latestKey && latestActual === 0 && budget > 0 && actualMonths.length > 1 && !isBudgetNoExpense(pu.code)) push({
      pu, severity:'Watch', type:'Completed month missing actual',
      why:`Latest completed month ${FY_MONTH_LABELS[FY_MONTHS.indexOf(latestKey)] || latestKey} has nil actual for an active budget PU.`,
      action:'Confirm whether booking is delayed or file is incomplete.',
      budget, actual, balance, util
    });
    if (balance > 0 && likelyNeed > budget * 1.03) push({
      pu, severity:'Watch', type:'Balance likely insufficient',
      why:`Projected need ${textCr(likelyNeed)} may exceed budget ${textCr(budget)}.`,
      action:'Review forecast and pending liabilities before next review stage.',
      budget, actual, balance, util
    });
    if (budget > 0 && balance > budget * 0.5 && actualMonths.length >= 4 && actual < budget * 0.25) push({
      pu, severity:'Normal', type:'Large saving / surrender possibility',
      why:`Balance ${textCr(balance)} remains high compared with actual booking.`,
      action:'Check committed liability; consider phased surrender only after validation.',
      budget, actual, balance, util
    });
    const rawBudget = BUDGET[pu.code] || {};
    if (Number(rawBudget.rg) && Number(rawBudget.bg_isl) && Math.abs(Number(rawBudget.rg) - Number(rawBudget.bg_isl)) > Math.max(Math.abs(Number(rawBudget.bg_isl)) * 0.1, 1000)) push({
      pu, severity:'Watch', type:'RG/BG budget replacement',
      why:`RG ${textCr(Number(rawBudget.rg))} differs from BG_ISL ${textCr(Number(rawBudget.bg_isl))}; RG is being used.`,
      action:'Confirm revised grant source and ensure exports use RG where allotted.',
      budget, actual, balance, util
    });
  });

  findings.sort((a,b) => {
    const score = {Critical:3, Watch:2, Normal:1};
    return (score[b.severity] - score[a.severity]) ||
      Math.abs(b.balance || 0) - Math.abs(a.balance || 0) ||
      (b.util || 0) - (a.util || 0);
  });
  _latestAIAnomalyDigest = {generatedAt:new Date().toISOString(), syncAt, sourceRevision, runningMonth:`${cur.label} ${cur.year}`, findings};
  return _latestAIAnomalyDigest;
}

function renderAIAnomalyPanel(digest) {
  const items = (digest && digest.findings || []).slice(0, 12);
  if (!items.length) return '';
  const rows = items.map(item => `
    <tr data-pu="${htmlSafe(item.pu.code)}">
      <td><span class="ai-risk ${item.severity === 'Critical' ? 'high' : item.severity === 'Watch' ? 'watch' : 'ok'}">${htmlSafe(item.severity)}</span></td>
      <td class="desc"><strong>PU-${htmlSafe(item.pu.code)}</strong> ${htmlSafe(item.pu.desc)}</td>
      <td>${htmlSafe(item.type)}</td>
      <td class="n">${textCr(item.budget || 0)}</td>
      <td class="n">${textCr(item.actual || 0)}</td>
      <td class="n">${textCr(item.balance || 0)}</td>
      <td class="n">${(Number(item.util) || 0).toFixed(1)}%</td>
      <td>${htmlSafe(item.why)}</td>
      <td>${htmlSafe(item.action)}</td>
    </tr>`).join('');
  return `<div class="ai-pu-card risk-watch">
    <div class="ai-pu-head">
      <div class="ai-pu-title">Dynamic AI Budget Anomaly Scan</div>
      <span class="ai-risk watch">Auto refreshed</span>
    </div>
    <div class="ai-digest-head" style="margin:0 0 8px">
      <span>Last sync/data refresh: ${htmlSafe(digest.syncAt)} | Source revision: ${htmlSafe(String(digest.sourceRevision || '-'))}</span>
    </div>
    <div class="ai-month-table-wrap">
      <table class="ai-month-table sortable-report">
        <thead><tr><th>Severity</th><th>PU</th><th>Anomaly</th><th>Budget</th><th>Actual</th><th>Balance</th><th>Util%</th><th>Why flagged</th><th>Suggested action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function refreshDynamicAI(reason='data-refresh') {
  buildBudgetAnomalyFindings();
  if (activeTabName && activeTabName() === 'aitrend') renderAITrendSummary();
  renderRiskSpotlight();
  refreshBIViewSoon();
  if (window.DisplayExport && typeof DisplayExport.init === 'function' && activeTabName && activeTabName() === 'dataexport') DisplayExport.init();
  return _latestAIAnomalyDigest;
}

function initAISummaryExpanders() {
  const wrap = document.getElementById('aiTrendSummary');
  if (!wrap) return;
  [...wrap.children].forEach((section, index) => {
    if (section.querySelector(':scope > .ai-summary-toggle')) return;
    const heading = section.querySelector('.ai-pu-title,.ai-digest-head strong')?.textContent || `Summary ${index + 1}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-summary-toggle';
    button.setAttribute('aria-expanded', 'true');
    button.innerHTML = `<span>${htmlSafe(heading)}</span><b>Collapse</b>`;
    button.addEventListener('click', () => {
      const collapsed = section.classList.toggle('ai-summary-collapsed');
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.querySelector('b').textContent = collapsed ? 'Expand' : 'Collapse';
    });
    section.prepend(button);
  });
}

function setAISummaryExpanded(expanded) {
  const wrap = document.getElementById('aiTrendSummary');
  if (!wrap) return;
  wrap.querySelectorAll(':scope > *').forEach(section => {
    section.classList.toggle('ai-summary-collapsed', !expanded);
    const button = section.querySelector(':scope > .ai-summary-toggle');
    if (button) {
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const state = button.querySelector('b');
      if (state) state.textContent = expanded ? 'Collapse' : 'Expand';
    }
  });
}
window.setAISummaryExpanded = setAISummaryExpanded;

function renderAITrendSummary() {
  const wrap = document.getElementById('aiTrendSummary');
  if (!wrap) return;
  const scope = (document.getElementById('aiTrendScope') || {}).value || 'priority';
  const allItems = buildAITrendItems();
  const items = scope === 'all'
    ? allItems
    : scope === 'over'
      ? allItems.filter(x => x.risk === 'high' || x.risk === 'watch')
      : allItems.slice(0, 18);
  const meta = document.getElementById('aiTrendMeta');
  const hasPY = hasPYTrendData();
  if (meta) {
    const sample = allItems[0];
    meta.textContent = sample
      ? `PU-wise latest actual month ${sample.curLabel} review: ${hasPY ? 'CY vs PY month trend' : 'CY-only trend; PY data not loaded'}, actuals, utilisation, overspend and liability projection`
      : 'PU-wise current year trend, previous year comparison if loaded, and projection risk summary';
  }
  if (!items.length) {
    wrap.innerHTML = '<div class="ai-pu-card risk-ok"><ul class="ai-bullets"><li>No high-risk or watch-list PU found for the selected scope.</li></ul></div>';
    initAISummaryExpanders();
    refreshBIViewSoon();
    return;
  }
  const controlRows = trendControlRows();
  const anomalyDigest = buildBudgetAnomalyFindings();
  const askRows = controlRows.filter(r => r.askAmount > 0).sort((a,b)=>b.askAmount-a.askAmount);
  const surrenderRows = controlRows.filter(r => r.surrenderAmount > 0).sort((a,b)=>b.surrenderAmount-a.surrenderAmount);
  const highItems = allItems.filter(x => x.risk === 'high');
  const watchItems = allItems.filter(x => x.risk === 'watch');
  const overItems = allItems.filter(x => x.overSpent).sort((a,b)=>Math.abs(b.cv.balanceBudget)-Math.abs(a.cv.balanceBudget));
  const noExpenseItems = allItems.filter(x => x.budgetNoExpense).sort((a,b)=>b.budget-a.budget);
  const moveItems = allItems.slice().sort((a,b)=>Math.abs((b.cyCur-b.cyPrev)||0)-Math.abs((a.cyCur-a.cyPrev)||0));
  const totalAsk = askRows.reduce((s,r)=>s+(r.askAmount||0),0);
  const totalSurrender = surrenderRows.reduce((s,r)=>s+(r.surrenderAmount||0),0);
  const totalOverspend = overItems.reduce((s,r)=>s+Math.abs(Number(r.cv && r.cv.balanceBudget) || 0),0);
  const financePriority = highItems.length || overItems.length || totalAsk > 0
    ? 'Immediate finance review'
    : watchItems.length || totalSurrender > 0
      ? 'Monitor and validate'
      : 'Routine watch';
  const financeFocus = overItems[0]
    ? `PU-${htmlSafe(overItems[0].pu.code)} requires first attention because it is over budget by ${textCr(Math.abs(overItems[0].cv.balanceBudget))}.`
    : askRows[0]
      ? `PU-${htmlSafe(askRows[0].pu.code)} is the leading additional-fund signal at ${textCr(askRows[0].askAmount)}.`
      : surrenderRows[0]
        ? `PU-${htmlSafe(surrenderRows[0].pu.code)} is the leading saving/surrender signal at ${textCr(surrenderRows[0].surrenderAmount)}.`
        : 'No immediate PU-level exception is dominating the current review.';
  const digest = `<div class="ai-officer-digest">
    <div class="ai-digest-head">
      <strong>Officer AI Digest - Finance Insights</strong>
      <span>Completed-month basis through ${htmlSafe(items[0].actualMonthLabel || 'JUN')} | Running month excluded</span>
    </div>
    <div class="ai-digest-grid">
      <div><span>High / Watch PUs</span><strong>${highItems.length + watchItems.length}</strong><small>High ${highItems.length}, Watch ${watchItems.length}</small></div>
      <div><span>Top Overspend</span><strong>${overItems[0] ? `PU-${htmlSafe(overItems[0].pu.code)}` : '-'}</strong><small>${overItems[0] ? `${textCr(Math.abs(overItems[0].cv.balanceBudget))} over` : 'No over budget PU'}</small></div>
      <div><span>Budget, No Expense</span><strong>${noExpenseItems.length}</strong><small>${noExpenseItems[0] ? `Largest PU-${htmlSafe(noExpenseItems[0].pu.code)} ${textCr(noExpenseItems[0].budget)}` : 'No such case'}</small></div>
      <div><span>Amount to Ask</span><strong>${textCr(totalAsk)}</strong><small>${askRows[0] ? `Top PU-${htmlSafe(askRows[0].pu.code)} ${textCr(askRows[0].askAmount)}` : 'No ask signal'}</small></div>
      <div><span>Possible Surrender</span><strong>${textCr(totalSurrender)}</strong><small>${surrenderRows[0] ? `Top PU-${htmlSafe(surrenderRows[0].pu.code)} ${textCr(surrenderRows[0].surrenderAmount)}` : 'No surrender signal'}</small></div>
      <div><span>Largest Month Move</span><strong>${moveItems[0] ? `PU-${htmlSafe(moveItems[0].pu.code)}` : '-'}</strong><small>${moveItems[0] ? `${signedCr(moveItems[0].cyCur-moveItems[0].cyPrev)} from ${htmlSafe(moveItems[0].prevLabel)} to ${htmlSafe(moveItems[0].curLabel)}` : 'No movement'}</small></div>
      <div><span>Highest Risk Score</span><strong>${allItems[0] ? `${allItems[0].riskScore}/100` : '-'}</strong><small>${allItems[0] ? `PU-${htmlSafe(allItems[0].pu.code)} | ${htmlSafe(allItems[0].confidence)} confidence` : 'No scored PU'}</small></div>
    </div>
    <div class="ai-finance-insight">
      <div><strong>Finance priority:</strong> ${htmlSafe(financePriority)}</div>
      <div><strong>Control focus:</strong> ${financeFocus}</div>
      <div><strong>Grant pressure:</strong> ${textCr(totalOverspend)} current overspend exposure and ${textCr(totalAsk)} indicative additional-fund requirement from Budget Control signals.</div>
      <div><strong>Saving review:</strong> ${textCr(totalSurrender)} appears as possible surrender/saving signal, subject to pending bill and committed-liability confirmation.</div>
      <div><strong>Data confidence:</strong> AI remarks are regenerated from current uploaded data every refresh/sync and use completed-month actuals to avoid partial running-month distortion.</div>
    </div>
    <ul>
      <li>Risk score is rule-based and auditable: overspend, utilisation, forecast excess, low balance, month spike, YoY pressure and budget-with-no-expense.</li>
      <li>Forecast and comparisons use completed months only; the current running month is deliberately excluded to avoid partial-month distortion.</li>
      <li>Staff PU with committed liability remains excluded from this AI Trend Summary to keep focus on controllable action points.</li>
      <li>Budget Control ask/surrender values are indicative and should be checked against pending bills before proposal.</li>
    </ul>
  </div>`;
  wrap.innerHTML = renderAIAnomalyPanel(anomalyDigest) + digest + items.map(item => {
    const riskLabel = item.risk === 'high' ? 'High Risk' : item.risk === 'watch' ? 'Watch' : 'Normal';
    const riskClass = item.risk === 'high' ? 'high' : item.risk === 'watch' ? 'watch' : 'ok';
    const cyMove = item.cyCur - item.cyPrev;
    const pyMove = item.pyCur - item.pyPrev;
    const yoyMove = item.cyCur - item.pyCur;
    const ytdPct = hasPY ? pctChangeText(item.cyTotalAsOn, item.pyTotalAsOn) : 'PY not loaded';
    const monthTable = item.monthRows.map(r => {
      const pctText = !hasPY ? '-' : r.pct === null ? (r.cy ? 'new' : '-') : (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%';
      const cls = r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : '';
      return `<tr>
        <td>${htmlSafe(r.label)}</td>
        <td>${textCr(r.cy)}</td>
        <td>${hasPY ? textCr(r.py) : '-'}</td>
        <td class="${cls}">${hasPY ? signedCr(r.diff) : '-'}</td>
        <td class="${cls}">${htmlSafe(pctText)}</td>
      </tr>`;
    }).join('');
    const projectionImpact = item.noBudgetSpend
      ? 'Expense is booked without budget provision; budget allocation review is needed.'
      : item.budgetNoExpense
        ? 'Budget is available but no expense is booked yet; review whether work/order booking is pending.'
        : item.overSpent
          ? `Overspent by ${textCr(Math.abs(item.cv.balanceBudget))}; control further booking or arrange budget support.`
          : `Balance is ${textCr(item.cv.balanceBudget)} and remaining projection is ${textCr(item.cv.projPerMonth)} per month.`;
    const spendStatus = item.noBudgetSpend
      ? 'Spend booked without available budget.'
      : item.budgetNoExpense
        ? 'Budget exists but no CY actual expense is booked.'
      : item.utilPct >= 100
        ? 'Budget already fully consumed or exceeded.'
        : item.utilPct >= 85
          ? 'High utilisation; monitor before next booking cycle.'
          : 'Within current utilisation range.';
    const liabilityLine = item.overSpent
      ? 'Liability pressure is already above budget.'
      : item.utilPct >= 85
        ? 'Liability pressure is high; remaining balance may become tight.'
        : item.budgetNoExpense
          ? 'No liability trend yet; projection depends on future booking.'
          : 'Liability trend is manageable at current run rate.';
    return `<div class="ai-pu-card risk-${riskClass}">
      <div class="ai-pu-head">
        <div class="ai-pu-title">PU-${htmlSafe(item.pu.code)} - ${htmlSafe(item.pu.desc)}</div>
        <span class="ai-risk ${riskClass}">${riskLabel}</span>
      </div>
      <div class="ai-kpi-row">
        <div><span>CY Actual as on</span><strong>${textCr(item.cyTotalAsOn)}</strong></div>
        <div><span>PY Same Period</span><strong>${hasPY ? textCr(item.pyTotalAsOn) : 'Not loaded'}</strong></div>
        <div><span>Utilisation</span><strong>${item.utilPct.toFixed(1)}%</strong></div>
        <div><span>Balance</span><strong>${textCr(item.cv.balanceBudget)}</strong></div>
        <div><span>Risk Score</span><strong>${item.riskScore}/100</strong></div>
        <div><span>Year-end Forecast</span><strong>${textCr(item.forecastYearEnd)}</strong></div>
        <div><span>Forecast Variance</span><strong>${signedCr(item.forecastVariance)}</strong></div>
        <div><span>Confidence</span><strong>${htmlSafe(item.confidence)}</strong></div>
      </div>
      <div class="ai-decision-layout"><div class="ai-month-table-wrap">
        <table class="ai-month-table"><thead><tr><th>Month</th><th>CY</th><th>PY</th><th>Diff</th><th>YoY</th></tr></thead><tbody>${monthTable}</tbody></table>
      </div><ul class="ai-bullets">
        <li class="ai-recommended-action"><strong>Recommended action:</strong> ${htmlSafe(item.recommendedAction)}</li>
        <li><strong>Latest actual month movement:</strong> CY ${item.prevLabel} to ${item.curLabel} moved from ${textCr(item.cyPrev)} to ${textCr(item.cyCur)} (${signedCr(cyMove)}).${hasPY ? ` PY moved ${signedCr(pyMove)} for the same completed-month pair.` : ' PY comparison will appear after previous-year file is confirmed.'}</li>
        <li><strong>CY vs PY as-on:</strong> CY total is ${textCr(item.cyTotalAsOn)}${hasPY ? ` against PY same-period ${textCr(item.pyTotalAsOn)} (${ytdPct}; difference ${signedCr(item.ytdDiff)})` : '; PY same-period data is not loaded in this browser'}.</li>
        <li><strong>Latest actual month vs PY:</strong> ${hasPY ? `${item.curLabel} CY is ${textCr(item.cyCur)} against ${textCr(item.pyCur)} in PY (${pctChangeText(item.cyCur, item.pyCur)}; difference ${signedCr(yoyMove)}).` : `PY month comparison is pending; current ${item.curLabel} CY amount is ${textCr(item.cyCur)}.`}</li>
        <li><strong>Budget and overspend:</strong> Budget ${textCr(item.budget)}, utilisation ${item.utilPct.toFixed(1)}%, balance ${textCr(item.cv.balanceBudget)}. ${spendStatus}</li>
        <li><strong>Liability AI analysis:</strong> ${projectionImpact} ${liabilityLine}</li>
      </ul></div>
    </div>`;
  }).join('');
  initAISummaryExpanders();
}

function detailCr(value) {
  const n = Number(value) || 0;
  return (n / 10000).toFixed(2) + ' Cr';
}

function detailNum(value) {
  const n = Math.round(Number(value) || 0);
  return n ? n.toLocaleString('en-IN') : '-';
}

function detailBalanceClass(balance, budget) {
  if (balance < 0) return 'bal-neg';
  if (budget && balance < budget * 0.1) return 'bal-low';
  return 'bal-ok';
}
function isSMHBudgetNoExpense(rowOrTotal) {
  return (Number(rowOrTotal.budget) || 0) > 0 && Math.abs(Number(rowOrTotal.actualTill) || 0) === 0;
}

function noExpenseStatus(flag) {
  return flag ? 'Budget Available, No Expenses' : '';
}

function detailStatusText(rowOrTotal) {
  const budget = Number(rowOrTotal.budget) || 0;
  const actualTill = Number(rowOrTotal.actualTill) || 0;
  if (budget > 0 && Math.abs(actualTill) === 0) return 'Budget Available, No Expenses';
  if (budget === 0 && Math.abs(actualTill) !== 0) return 'No Budget, Expense Booked';
  if (budget - actualTill < 0) return 'Over Budget';
  return 'Within Budget';
}

function smhDemandCode(smhValue) {
  const raw = String(smhValue || '').trim();
  const code = (raw.match(/SMH\s*-\s*(.+)$/i) || [])[1] || raw.replace(/^SMH\s*/i, '').replace(/^-/, '').trim();
  const norm = code.trim().toUpperCase();
  const demand = demandNumberForSMH(norm);
  return demand ? `DEMAND ${demand}/SMH-${norm}` : `SMH-${norm}`;
}

function smhCodeOnly(smhValue) {
  const raw = String(smhValue || '').trim();
  return ((raw.match(/SMH\s*-\s*(.+)$/i) || [])[1] || raw.replace(/^SMH\s*/i, '').replace(/^-/, '').trim()).trim().toUpperCase();
}

const DEMAND_BY_SMH = {
  '01':'03',
  '02':'04',
  '03':'05',
  '04':'06',
  '05':'07',
  '06':'08',
  '07':'09',
  '08':'10',
  '09':'11',
  '10':'12',
  '11':'13',
  '10N':'12N/10N'
};

function demandNumberForSMH(smhValue) {
  const smh = smhCodeOnly(smhValue);
  if (DEMAND_BY_SMH[smh]) return DEMAND_BY_SMH[smh];
  const match = demandSMHRows().find(r => String(r.smh || '').trim().toUpperCase() === smh);
  return match ? String(match.demand || '').trim().replace(/^Demand\s*/i, '') : '';
}

function detailDemandSMHLabel(rowOrDept, smhValue) {
  const smh = typeof rowOrDept === 'object' ? rowOrDept.smh : smhValue;
  const smhCode = smhCodeOnly(smh);
  const demand = demandNumberForSMH(smhCode);
  return demand ? `D-${demand}/SMH-${smhCode}` : `SMH-${smhCode}`;
}

function detailBPStatus(rowOrTotal) {
  const bpMode = getBPModeStatus();
  const monthCount = bpMode.bpMonthCount;
  const budget = Number(rowOrTotal.budget) || 0;
  const actualTill = Number(rowOrTotal.actualTill) || 0;
  const bp = (budget / 12) * monthCount;
  const variance = actualTill - bp;
  const overFullBudget = budget > 0 && actualTill > budget;
  const noExpense = budget > 0 && Math.abs(actualTill) === 0;
  const status = overFullBudget ? 'Over Full Budget'
    : noExpense ? 'Budget, No Expense'
    : variance > 0 ? 'Excess vs BP'
    : variance < 0 ? 'Saving vs BP'
    : 'On BP';
  const remark = overFullBudget ? 'Actual has crossed full year budget.'
    : noExpense ? 'Budget is available but no actual expense is booked.'
    : variance > 0 ? 'Actual spending is ahead of proportionate budget.'
    : variance < 0 ? 'Actual spending is below proportionate budget.'
    : 'Actual is aligned with proportionate budget.';
  return {bp, variance, status, remark, monthCount};
}

function smhSelectedCodes() {
  const all = document.getElementById('smhPUAll');
  if (!all) return ['all'];
  if (all.checked) return ['all'];
  return Array.from(document.querySelectorAll('#smhPUFilter .smh-pu-check:checked')).map(o => o.value);
}

function updateSMHPUSelectionCount() {
  const all = document.getElementById('smhPUAll');
  const count = document.getElementById('smhPUCount');
  const inline = document.getElementById('smhPUCountInline');
  const checks = Array.from(document.querySelectorAll('#smhPUFilter .smh-pu-check'));
  const label = all && all.checked
    ? 'All selected'
    : `${checks.filter(ch => ch.checked).length || 'No'} selected`;
  if (count) count.textContent = label;
  if (inline) inline.textContent = label;
}

function onSMHPUAllToggle(checked) {
  document.querySelectorAll('#smhPUFilter .smh-pu-check').forEach(ch => {
    ch.checked = !!checked;
  });
  updateSMHPUSelectionCount();
  renderSMHDetail();
}

function onSMHPUChange() {
  const all = document.getElementById('smhPUAll');
  if (all) all.checked = false;
  updateSMHPUSelectionCount();
  renderSMHDetail();
}

function setSMHPUSelection(mode, silent) {
  const all = document.getElementById('smhPUAll');
  const checks = Array.from(document.querySelectorAll('#smhPUFilter .smh-pu-check'));
  const search = document.getElementById('smhPUSearch');
  if (search) {
    search.value = '';
    filterPUChecklist('smhPUFilter', '');
  }
  if (all) all.checked = mode === 'all';
  checks.forEach(ch => {
    ch.checked = mode === 'all';
  });
  updateSMHPUSelectionCount();
  if (!silent) renderSMHDetail();
}

function applySMHPUSelection(value) {
  const values = Array.isArray(value) ? value : [value || 'all'];
  const all = document.getElementById('smhPUAll');
  const checks = Array.from(document.querySelectorAll('#smhPUFilter .smh-pu-check'));
  const useAll = values.includes('all') || !values.length;
  if (all) all.checked = useAll;
  checks.forEach(ch => {
    ch.checked = !useAll && values.includes(ch.value);
  });
  updateSMHPUSelectionCount();
}

function initSMHDetailFilters() {
  const data = window.DETAIL_SMH_DATA;
  const deptSel = document.getElementById('smhDeptFilter');
  const smhSel = document.getElementById('smhCodeFilter');
  const puList = document.getElementById('smhPUFilter');
  if (!data || !deptSel || !smhSel || !puList || deptSel.dataset.ready === 'yes') return;
  const detailRows = data.rows.filter(r => !isSkippedDisplayPU(r.puCode));
  const depts = [...new Map(detailRows.map(r => [r.deptCode + '|' + r.deptName, r])).values()]
    .sort((a,b) => String(a.deptCode).localeCompare(String(b.deptCode), undefined, {numeric:true}));
  deptSel.innerHTML = '<option value="all">All Departments</option>' +
    depts.map(r => `<option value="${htmlSafe(r.deptCode)}">${htmlSafe(r.deptCode)} - ${htmlSafe(r.deptName)}</option>`).join('');
  const smhs = [...new Set(detailRows.map(r => r.smh))].sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
  smhSel.innerHTML = '<option value="all">All Demand</option>' +
    smhs.map(s => `<option value="${htmlSafe(s)}">${htmlSafe(s)}</option>`).join('');
  const pus = [...new Map(detailRows.map(r => [r.puCode + '|' + r.puName, r])).values()]
    .sort((a,b) => String(a.puCode).localeCompare(String(b.puCode), undefined, {numeric:true}));
  puList.innerHTML = pus.map(r => `<label class="bp-check-item">
      <input type="checkbox" class="smh-pu-check" value="${htmlSafe(r.puCode)}" onchange="onSMHPUChange()">
      <span><strong>PU-${htmlSafe(r.puCode)}</strong> ${htmlSafe(r.puName)}</span>
    </label>`).join('');
  deptSel.dataset.ready = 'yes';
  updateSMHPUSelectionCount();
  initPUDrawerBehavior('smhPUDrawer');
}

function aggregateDetailRows(rows, mode) {
  const monthKeys = window.DETAIL_SMH_DATA.monthKeys || [];
  const map = new Map();
  rows.forEach(r => {
    const key = mode === 'dept'
      ? `${r.deptCode}|${r.deptName}`
      : mode === 'smh'
        ? `${r.deptCode}|${r.deptName}|${r.smh}`
        : `${r.deptCode}|${r.deptName}|${r.smh}|${r.puCode}|${r.puName}`;
    if (!map.has(key)) {
      const months = {};
      monthKeys.forEach(m => months[m] = 0);
      map.set(key, {
        deptCode:r.deptCode, deptName:r.deptName, smh: mode === 'dept' ? '' : r.smh,
        puCode: mode === 'pu' ? r.puCode : '', puName: mode === 'pu' ? r.puName : '',
        budget:0, actualTill:0, months
      });
    }
    const item = map.get(key);
    item.budget += Number(r.budget) || 0;
    item.actualTill += Number(r.actualTill) || 0;
    monthKeys.forEach(m => item.months[m] += Number((r.months || {})[m]) || 0);
  });
  return Array.from(map.values()).sort((a,b) =>
    String(a.deptCode).localeCompare(String(b.deptCode), undefined, {numeric:true}) ||
    String(a.smh).localeCompare(String(b.smh), undefined, {numeric:true}) ||
    String(a.puCode).localeCompare(String(b.puCode), undefined, {numeric:true})
  );
}

function makeDetailTotal(rows) {
  const monthKeys = window.DETAIL_SMH_DATA.monthKeys || [];
  const total = {budget:0, actualTill:0, months:Object.fromEntries(monthKeys.map(m => [m,0]))};
  rows.forEach(r => {
    total.budget += Number(r.budget) || 0;
    total.actualTill += Number(r.actualTill) || 0;
    monthKeys.forEach(m => total.months[m] += Number((r.months || {})[m]) || 0);
  });
  return total;
}

function renderSMHReportRows(rows, monthKeys) {
  const depts = [...new Map(rows.map(r => [r.deptCode + '|' + r.deptName, r])).values()]
    .sort((a,b) => String(a.deptCode).localeCompare(String(b.deptCode), undefined, {numeric:true}));
  let html = '';
  depts.forEach(dept => {
    const deptRows = rows.filter(r => r.deptCode === dept.deptCode);
    const deptTotal = makeDetailTotal(deptRows);
    const blankDetailCells = monthKeys.length + 6;
    html += `<tr class="dept-row"><td>${htmlSafe(dept.deptCode)} - ${htmlSafe(dept.deptName)}</td><td></td><td></td>${'<td></td>'.repeat(blankDetailCells)}</tr>`;
    const smhs = [...new Set(deptRows.map(r => r.smh))].sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
    smhs.forEach(smh => {
      const smhRows = deptRows.filter(r => r.smh === smh)
        .sort((a,b) => String(a.puCode).localeCompare(String(b.puCode), undefined, {numeric:true}));
      const demandSmhLabel = detailDemandSMHLabel(dept.deptCode, smh);
      html += `<tr class="smh-row"><td></td><td>${htmlSafe(demandSmhLabel)}</td><td></td>${'<td></td>'.repeat(blankDetailCells)}</tr>`;
      smhRows.forEach(r => {
        const bal = r.budget - r.actualTill;
        const noExpCls = isSMHBudgetNoExpense(r) ? ' no-exp-row' : '';
        const bp = detailBPStatus(r);
        html += `<tr class="pu-row${noExpCls}${isImportantPU(r.puCode) ? ' important-pu-row' : ''}">
          <td>${htmlSafe(demandSmhLabel)}</td>
          <td></td>
          <td>PU - ${htmlSafe(r.puCode)} - ${htmlSafe(r.puName)}</td>
          <td>${detailNum(r.budget)}</td>
          ${monthKeys.map(m => `<td>${detailNum((r.months || {})[m] || 0)}</td>`).join('')}
          <td><strong>${detailNum(r.actualTill)}</strong></td>
          <td class="${detailBalanceClass(bal, r.budget)}">${detailNum(bal)}</td>
          <td class="no-exp-status">${htmlSafe(noExpenseStatus(isSMHBudgetNoExpense(r)))}</td>
          <td><span class="bp-status ${bp.variance > 0 ? 'bp-excess' : bp.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(bp.status)}</span></td>
          <td class="bp-remark">${htmlSafe(bp.remark)}</td>
        </tr>`;
      });
      const smhTotal = makeDetailTotal(smhRows);
      const smhBal = smhTotal.budget - smhTotal.actualTill;
      const smhNoExpCls = isSMHBudgetNoExpense(smhTotal) ? ' no-exp-row' : '';
      const smhBP = detailBPStatus(smhTotal);
      html += `<tr class="subtot${smhNoExpCls}">
        <td></td>
        <td></td>
        <td>Sub-Total: ${htmlSafe(demandSmhLabel)}</td>
        <td>${detailNum(smhTotal.budget)}</td>
        ${monthKeys.map(m => `<td>${detailNum(smhTotal.months[m] || 0)}</td>`).join('')}
        <td><strong>${detailNum(smhTotal.actualTill)}</strong></td>
        <td class="${detailBalanceClass(smhBal, smhTotal.budget)}">${detailNum(smhBal)}</td>
        <td class="no-exp-status">${htmlSafe(noExpenseStatus(isSMHBudgetNoExpense(smhTotal)))}</td>
        <td><span class="bp-status ${smhBP.variance > 0 ? 'bp-excess' : smhBP.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(smhBP.status)}</span></td>
        <td class="bp-remark">${htmlSafe(smhBP.remark)}</td>
      </tr>`;
    });
    const deptBal = deptTotal.budget - deptTotal.actualTill;
    const deptNoExpCls = isSMHBudgetNoExpense(deptTotal) ? ' no-exp-row' : '';
    const deptBP = detailBPStatus(deptTotal);
    html += `<tr class="dept-total${deptNoExpCls}">
      <td></td>
      <td></td>
      <td>Total: ${htmlSafe(dept.deptCode)} - ${htmlSafe(dept.deptName)}</td>
      <td>${detailNum(deptTotal.budget)}</td>
      ${monthKeys.map(m => `<td>${detailNum(deptTotal.months[m] || 0)}</td>`).join('')}
      <td><strong>${detailNum(deptTotal.actualTill)}</strong></td>
      <td class="${detailBalanceClass(deptBal, deptTotal.budget)}">${detailNum(deptBal)}</td>
      <td class="no-exp-status">${htmlSafe(noExpenseStatus(isSMHBudgetNoExpense(deptTotal)))}</td>
      <td><span class="bp-status ${deptBP.variance > 0 ? 'bp-excess' : deptBP.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(deptBP.status)}</span></td>
      <td class="bp-remark">${htmlSafe(deptBP.remark)}</td>
    </tr>`;
  });
  return html;
}

function renderSMHDetail() {
  const head = document.getElementById('smhDetailHead');
  const body = document.getElementById('smhDetailBody');
  if (!head || !body) return;
  try {
  const data = window.DETAIL_SMH_DATA;
  if (!data || !Array.isArray(data.rows)) {
    body.innerHTML = '<tr><td colspan="10">Detailed SMH data file not loaded.</td></tr>';
    refreshBIViewSoon();
    return;
  }
  initSMHDetailFilters();
  const dept = (document.getElementById('smhDeptFilter') || {}).value || 'all';
  const smh = (document.getElementById('smhCodeFilter') || {}).value || 'all';
  const selectedPUs = smhSelectedCodes();
  const activityFilter = (document.getElementById('activityFilter') || {}).value || 'all';
  const mode = (document.getElementById('smhViewMode') || {}).value || 'report';
  const monthKeys = data.monthKeys || [];
  const monthLabels = data.monthLabels || [];
  let lastActualIdx = 2;
  monthKeys.forEach((m, idx) => { if ((data.totals.months[m] || 0) !== 0) lastActualIdx = idx; });
  lastActualIdx = Math.max(2, lastActualIdx);
  const visibleMonthKeys = monthKeys.slice(0, lastActualIdx + 1);
  const rows = data.rows.filter(r =>
    !isSkippedDisplayPU(r.puCode) &&
    passesPUFocus(r.puCode) &&
    (dept === 'all' || r.deptCode === dept) &&
    (smh === 'all' || r.smh === smh) &&
    (selectedPUs.includes('all') || selectedPUs.includes(r.puCode)) &&
    (activityFilter !== 'budget-no-exp' || isSMHBudgetNoExpense(r))
  );
  const grouped = aggregateDetailRows(rows, mode === 'report' ? 'pu' : mode);
  const totals = makeDetailTotal(rows);
  const balance = totals.budget - totals.actualTill;
  const util = totals.budget ? (totals.actualTill / totals.budget) * 100 : 0;
  const kpis = document.getElementById('smhKpis');
  if (kpis) {
    kpis.innerHTML = [
      ['Effective Budget / OBA', detailCr(totals.budget), detailNum(totals.budget) + " in Rs'000s"],
      ['Actual Till Date', detailCr(totals.actualTill), util.toFixed(1) + '% utilised'],
      ['Balance', detailCr(balance), balance < 0 ? 'Over spent' : 'Budget minus actual'],
      ['Month Actuals', detailCr(visibleMonthKeys.reduce((s,m)=>s+(totals.months[m]||0),0)), `${monthLabels[0]} to ${monthLabels[visibleMonthKeys.length - 1]}`],
      ['Rows', (mode === 'report' ? rows.length : grouped.length).toLocaleString('en-IN'), mode === 'smh' ? 'Demand/SMH + Department groups' : mode === 'report' ? 'PU lines in report' : 'summary groups']
    ].map(([l,v,s]) => `<div class="smh-kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }
  const title = document.getElementById('smhTableTitle');
  if (title) {
    title.textContent = mode === 'report'
      ? `Department > Demand > Primary Unit - Budget vs Expenditure Report (${monthLabels[0]} to ${monthLabels[visibleMonthKeys.length - 1]})`
      : mode === 'dept'
        ? 'Department Summary - Budget vs Expenditure'
        : mode === 'smh'
          ? 'Demand wise Summary - DEMAND/SMH and Department month-wise actuals 2026-2027'
          : 'Department > Demand > PU Detail - Budget vs Expenditure';
  }
  const leftHeaders = mode === 'smh'
    ? '<th>Demand/SMH</th><th>Department</th>'
    : '<th>Department</th><th>Demand</th><th>Primary Unit (PU)</th>';
  head.innerHTML = `<tr>${leftHeaders}<th>Budget<br>2026-27</th>` +
    monthLabels.slice(0,visibleMonthKeys.length).map(l => `<th>${htmlSafe(l.replace(' 2026',''))}<br>Actual</th>`).join('') +
    '<th>Exp. Total</th><th>Balance<br>(Budget-Exp)</th>' +
    (mode === 'smh'
      ? '<th>Status</th><th>BP Status</th>'
      : mode === 'report'
      ? '<th>Status</th><th>BP Status</th><th>BP Remark</th>'
      : '<th>Util%</th><th>Status</th><th>BP Status</th><th>BP Remark</th>') + '</tr>';
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10">No rows found for selected filters.</td></tr>';
    refreshBIViewSoon();
    return;
  }
  if (mode === 'smh') {
    const sortedRows = grouped.slice().sort((a,b) =>
      String(a.smh).localeCompare(String(b.smh), undefined, {numeric:true}) ||
      String(a.deptCode).localeCompare(String(b.deptCode), undefined, {numeric:true})
    );
    const totalBP = detailBPStatus(totals);
    const totalRow = `<tr class="dept-total">
      <td>Total</td>
      <td>All Departments</td>
      <td>${detailNum(totals.budget)}</td>
      ${visibleMonthKeys.map(m => `<td>${detailNum(totals.months[m] || 0)}</td>`).join('')}
      <td><strong>${detailNum(totals.actualTill)}</strong></td>
      <td class="${detailBalanceClass(balance, totals.budget)}">${detailNum(balance)}</td>
      <td>${htmlSafe(detailStatusText(totals))}</td>
      <td><span class="bp-status ${totalBP.variance > 0 ? 'bp-excess' : totalBP.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(totalBP.status)}</span></td>
    </tr>`;
    body.innerHTML = sortedRows.map(r => {
      const bal = r.budget - r.actualTill;
      const noExp = isSMHBudgetNoExpense(r);
      const bp = detailBPStatus(r);
      return `<tr class="pu-row${noExp ? ' no-exp-row' : ''}">
        <td>${htmlSafe(detailDemandSMHLabel(r))}</td>
        <td>${htmlSafe(r.deptCode)} - ${htmlSafe(r.deptName)}</td>
        <td>${detailNum(r.budget)}</td>
        ${visibleMonthKeys.map(m => `<td>${detailNum((r.months || {})[m] || 0)}</td>`).join('')}
        <td><strong>${detailNum(r.actualTill)}</strong></td>
        <td class="${detailBalanceClass(bal, r.budget)}">${detailNum(bal)}</td>
        <td class="no-exp-status">${htmlSafe(detailStatusText(r))}</td>
        <td><span class="bp-status ${bp.variance > 0 ? 'bp-excess' : bp.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(bp.status)}</span></td>
      </tr>`;
    }).join('') + totalRow;
    setTimeout(applyMobileTableLabels, 40);
    refreshBIViewSoon();
    return;
  }
  if (mode === 'report') {
    body.innerHTML = renderSMHReportRows(rows, visibleMonthKeys);
    setTimeout(applyMobileTableLabels, 40);
    refreshBIViewSoon();
    return;
  }
  body.innerHTML = grouped.map(r => {
    const bal = r.budget - r.actualTill;
    const noExp = isSMHBudgetNoExpense(r);
    const bp = detailBPStatus(r);
    const rowClass = (mode === 'dept' ? 'dept-row' : mode === 'smh' ? 'smh-row' : 'pu-row') + (noExp ? ' no-exp-row' : '') + (mode === 'pu' && isImportantPU(r.puCode) ? ' important-pu-row' : '');
    const first = `${htmlSafe(r.deptCode)} - ${htmlSafe(r.deptName)}`;
    const second = mode === 'dept' ? 'All Demand' : htmlSafe(detailDemandSMHLabel(r));
    const third = mode === 'pu' ? `PU - ${htmlSafe(r.puCode)} - ${htmlSafe(r.puName)}` : (mode === 'smh' ? 'Sub-total' : 'Department Total');
    return `<tr class="${rowClass}">
      <td>${first}</td>
      <td>${second}</td>
      <td>${third}</td>
      <td>${detailNum(r.budget)}</td>
      ${visibleMonthKeys.map(m => `<td>${detailNum(r.months[m] || 0)}</td>`).join('')}
      <td><strong>${detailNum(r.actualTill)}</strong></td>
      <td class="${detailBalanceClass(bal, r.budget)}">${detailNum(bal)}</td>
      <td>${r.budget ? ((r.actualTill / r.budget) * 100).toFixed(1) : '0.0'}%</td>
      <td class="no-exp-status">${htmlSafe(noExpenseStatus(noExp))}</td>
      <td><span class="bp-status ${bp.variance > 0 ? 'bp-excess' : bp.variance < 0 ? 'bp-saving' : ''}">${htmlSafe(bp.status)}</span></td>
      <td class="bp-remark">${htmlSafe(bp.remark)}</td>
    </tr>`;
  }).join('');
  setTimeout(applyMobileTableLabels, 40);
  refreshBIViewSoon();
  } catch (err) {
    console.error('SMH detail render failed', err);
    head.innerHTML = '<tr><th>Department</th><th>Demand</th><th>Primary Unit (PU)</th><th>Status</th></tr>';
    body.innerHTML = `<tr><td colspan="4" style="color:#9B0000;font-weight:700;padding:14px">Could not render Department wise report: ${htmlSafe(err.message || err)}</td></tr>`;
    refreshBIViewSoon();
  }
}

function demandSMHData() {
  return window.DEMAND_SMH_SUMMARY_DATA || {rows:[], totals:{}, completedMonths:0};
}

function demandSMHRows() {
  const data = demandSMHData();
  return Array.isArray(data.rows) ? data.rows : [];
}

function isDemandSMHSuspense(row) {
  return !!row && (String(row.smh || '').toUpperCase() === '10N' || String(row.demand || '').toUpperCase().includes('12N/10N'));
}

function demandSMHOperationalRows() {
  return demandSMHRows().filter(r => !isDemandSMHSuspense(r));
}

function demandSMHSuspenseRows() {
  return demandSMHRows().filter(isDemandSMHSuspense);
}

function demandSMHTotals(rowsOverride) {
  const rows = rowsOverride || demandSMHOperationalRows();
  const totals = rows.reduce((t, r) => {
    t.oba += Number(r.oba) || 0;
    t.bp += Number(r.bp) || 0;
    t.ae += Number(r.ae) || 0;
    t.variation += Number(r.variation) || 0;
    t.budgetRemaining += Number(r.budgetRemaining) || 0;
    return t;
  }, {oba:0, bp:0, ae:0, variation:0, budgetRemaining:0});
  totals.bpPct = totals.bp ? Math.round((totals.ae / totals.bp) * 100) : 0;
  totals.obaUtil = totals.oba ? Math.round((totals.ae / totals.oba) * 100) : 0;
  return totals;
}

function demandSMHLabel(row) {
  if (!row) return '';
  if (String(row.demand || '').toLowerCase().includes('demand')) return row.demand;
  return `Demand ${row.demand}/${row.smh}`;
}

function renderDemandSMHSummary() {
  syncBPModeControls();
  const body = document.getElementById('demandSmhBody');
  if (!body) return;
  const data = demandSMHData();
  const bpMode = getBPModeStatus();
  const recalculatedRows = recalcDemandSMHRows(demandSMHRows(), bpMode.bpMonthCount);
  const rows = recalculatedRows.filter(r => !isDemandSMHSuspense(r));
  const suspenseRows = recalculatedRows.filter(isDemandSMHSuspense);
  const totals = demandSMHTotals(rows);
  const meta = document.getElementById('demandSmhMeta');
  const dMoney = value => `<span class="demand-dual"><span>${detailNum(value)}</span><small>${detailCr(value)}</small></span>`;
  const dPct = value => `${detailNum(value)}%`;
  if (meta) meta.textContent = `Current year Demand wise grant summary for FY ${data.fy || '2026-2027'}; BP and AE use completed months only. Imported BP is ignored.`;
  const source = document.getElementById('demandSmhSource');
  if (source) source.textContent = `Source: ${data.sourceBudget || 'SMH Wise Budget'} | Code: ${data.sourceCode || 'DEMAND AND SMH'} | AE as on ${bpMode.bpThrough ? bpMode.bpThrough.label + ' ' + bpMode.bpThrough.year : (data.asOn || 'JUN 2026')} | Suspense kept separate`;
  const kpis = document.getElementById('demandSmhKpis');
  if (kpis) {
    kpis.innerHTML = [
      ['Effective OBA', dMoney(totals.oba), `Rs '000 and Cr`],
      ['BP Value', dMoney(totals.bp), `BG / 12 x ${bpMode.bpMonthCount || 0} months`],
      ['Actual Expenditure', dMoney(totals.ae), `AE up to ${bpMode.bpThrough ? bpMode.bpThrough.label + ' ' + bpMode.bpThrough.year : (data.asOn || 'JUN 2026')}`],
      ['Variation vs BP', dMoney(totals.variation), totals.variation > 0 ? 'Excess against proportionate budget' : 'Saving against proportionate budget'],
      ['OBA Utilized', `${totals.obaUtil}%`, 'Actual as percentage of OBA'],
      ['Suspense Separate', suspenseRows[0] ? dMoney(suspenseRows[0].ae) : dMoney(0), 'Demand 12N/10N not netted in main total']
    ].map(([l,v,s]) => `<div class="demand-smh-kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${htmlSafe(s)}</div></div>`).join('');
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:18px">Demand / SMH summary data file not loaded.</td></tr>';
    refreshBIViewSoon();
    return;
  }
  const rowHtml = rows.map(r => {
    const riskCls = (Number(r.bpPct) || 0) >= 150 || (Number(r.budgetRemaining) || 0) < 0 ? ' high' : (Number(r.bpPct) || 0) >= 115 ? ' watch' : '';
    return `<tr class="demand-smh-row${riskCls}">
      <td><strong>${htmlSafe(demandSMHLabel(r))}</strong></td>
      <td><strong>${htmlSafe(r.dept)}</strong><span>${htmlSafe(r.description || '')}</span></td>
      <td>${dMoney(r.oba)}</td>
      <td>${dMoney(r.bp)}</td>
      <td>${dMoney(r.ae)}</td>
      <td class="${(Number(r.variation)||0) >= 0 ? 'dsmh-excess' : 'dsmh-saving'}">${dMoney(r.variation)}</td>
      <td class="${(Number(r.bpPct)||0) >= 150 || (Number(r.bpPct)||0) < 0 ? 'dsmh-red' : ''}">${dPct(r.bpPct)}</td>
      <td class="${(Number(r.budgetRemaining)||0) < 0 ? 'dsmh-red' : ''}">${dMoney(r.budgetRemaining)}</td>
      <td class="${(Number(r.obaUtil)||0) >= 45 || (Number(r.obaUtil)||0) < 0 ? 'dsmh-red' : ''}">${dPct(r.obaUtil)}</td>
    </tr>`;
  }).join('');
  const suspenseHtml = suspenseRows.map(r => `<tr class="demand-smh-suspense">
      <td><strong>Separate: ${htmlSafe(demandSMHLabel(r))}</strong></td>
      <td><strong>${htmlSafe(r.dept)}</strong><span>Separately calculated - not included in main total</span></td>
      <td>${dMoney(r.oba)}</td>
      <td>${dMoney(r.bp)}</td>
      <td>${dMoney(r.ae)}</td>
      <td class="dsmh-excess">${dMoney(r.variation)}</td>
      <td class="dsmh-red">${dPct(r.bpPct)}</td>
      <td class="dsmh-red">${dMoney(r.budgetRemaining)}</td>
      <td class="dsmh-red">${dPct(r.obaUtil)}</td>
    </tr>`).join('');
  body.innerHTML = rowHtml + `<tr class="demand-smh-total">
    <td>Total</td>
    <td></td>
    <td>${dMoney(totals.oba)}</td>
    <td>${dMoney(totals.bp)}</td>
    <td>${dMoney(totals.ae)}</td>
    <td>${dMoney(totals.variation)}</td>
    <td>${dPct(totals.bpPct)}</td>
    <td>${dMoney(totals.budgetRemaining)}</td>
    <td>${dPct(totals.obaUtil)}</td>
  </tr>${suspenseHtml}`;
  setTimeout(applyMobileTableLabels, 40);
  refreshBIViewSoon();
}

// ═══════════════════════════════════════════════
// EXCEL DOWNLOAD using SheetJS CDN
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// EXCEL DOWNLOAD
// ═══════════════════════════════════════════════
function sumMonthValues(row) {
  return FY_MONTHS.reduce((sum, month) => sum + (Number((row || {})[month]) || 0), 0);
}

function refreshCalculatedSourceData() {
  const budgetCodes = Object.keys(BUDGET).filter(code => code !== 'TOTAL');
  const monthCodes = Object.keys(MONTH).filter(code => code !== 'TOTAL');
  monthCodes.forEach(code => {
    MONTH[code].total = sumMonthValues(MONTH[code]);
    if (BUDGET[code]) BUDGET[code].actuals_till = MONTH[code].total;
  });
  BUDGET.TOTAL = budgetCodes.reduce((total, code) => {
    const row = BUDGET[code] || {};
    total.bg_isl += Number(row.bg_isl) || 0;
    total.rg += Number(row.rg) || 0;
    total.actuals_till += Number(row.actuals_till) || 0;
    return total;
  }, {bg_isl:0, rg:0, actuals_till:0});
  MONTH.TOTAL = FY_MONTHS.reduce((total, month) => {
    total[month] = monthCodes.reduce((sum, code) => sum + (Number(MONTH[code][month]) || 0), 0);
    return total;
  }, {});
  MONTH.TOTAL.total = sumMonthValues(MONTH.TOTAL);
  const detailRows = window.DETAIL_SMH_DATA && Array.isArray(window.DETAIL_SMH_DATA.rows) ? window.DETAIL_SMH_DATA.rows : [];
  detailRows.forEach(row => { row.actualTill = sumMonthValues(row.months || row); });
  if (window.DETAIL_SMH_DATA && detailRows.length) window.DETAIL_SMH_DATA.totals = makeDetailTotal(detailRows);
}

function exportDataFingerprint() {
  const status = getMonthStatus();
  const detail = window.DETAIL_SMH_DATA || {rows:[], totals:{}};
  const demand = window.DEMAND_SMH_SUMMARY_DATA || {rows:[], totals:{}};
  const core = JSON.stringify({
    scope:window.NR_SELECTED_SCOPE?.code,
    build:RLP_BUILD_ID,
    asOn:_dataAsOnDate instanceof Date ? _dataAsOnDate.toISOString() : String(_dataAsOnDate || ''),
    latest:status.latestActual ? status.latestActual.key : '',
    budget:BUDGET.TOTAL || {}, month:MONTH.TOTAL || {},
    detailGenerated:detail.generatedAt || '', detailRows:(detail.rows || []).length, detailTotals:detail.totals || {},
    demandGenerated:demand.generatedAt || '', demandRows:(demand.rows || []).length, demandTotals:demand.totals || {}
  });
  let hash = 2166136261;
  for (let i=0; i<core.length; i++) {
    hash ^= core.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function prepareFreshExport(kind) {
  if (typeof hasPendingUploadData === 'function' && hasPendingUploadData()) {
    throw new Error(`${kind} blocked: uploaded file(s) are parsed but not applied. Click OK Apply All Uploaded Data & Refresh Portal first.`);
  }
  if (typeof hydrateDemandSMHActualMonthsFromSyncedFile === 'function' && hydrateDemandSMHActualMonthsFromSyncedFile.running) {
    throw new Error(`${kind} blocked: synced Demand/SMH data is still refreshing. Please retry in a moment.`);
  }
  refreshCalculatedSourceData();
  renderAll();
  const checks = portalValidationChecks();
  const errors = checks.filter(check => check.state === 'err');
  if (errors.length) throw new Error(`${kind} blocked: ${errors.map(e => e.title).join(', ')}`);
  const status = getMonthStatus();
  const generated = new Date();
  const latestMonth = status.latestActual ? `${status.latestActual.label} ${status.latestActual.year}` : 'No actual month';
  const fingerprint = exportDataFingerprint();
  const id = `${window.nrScopeLabel?.() || "NR Zone"}-${ASSET_VERSION}-${fingerprint}-${generated.toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;
  document.body.dataset.exportFreshness = id;
  document.body.dataset.exportFingerprint = fingerprint;
  return {kind, id, fingerprint, buildId:RLP_BUILD_ID, generatedAt:generated.toISOString(), latestMonth, checks};
}

async function downloadExcel() {
  if (!confirmProtectedExport('Excel export')) return;
  document.body.dataset.exportStatus = 'excel-started';
  try {
  const exportAudit = prepareFreshExport('Excel');
  const useExcelJS = !!window.ExcelJS;
  const wb = useExcelJS ? new ExcelJS.Workbook() : XLSX.utils.book_new();
  if (useExcelJS) {
    wb.creator = 'Ordinary Working Expenses (OWE) Portal';
    wb.created = new Date();
    wb.modified = new Date();
    wb.properties.date1904 = false;
  }
  const HDR_TITLE = 'ORDINARY WORKING EXPENSES (OWE) PORTAL - '+window.nrScopeLabel();
  const HDR_SUB   = "Northern Railway  |  Financial Authority Dashboard  |  All figures in Rs Thousands ('000s) - multiply by 1,000 for actual rupees";
  const {cur} = getMonthStatus();

  // ── Style helpers ─────────────────────────────────────────
  function mkStyle(opts={}) {
    return {
      font:   { name:opts.name||'Times New Roman', sz: opts.sz||10, bold:!!opts.bold, color:{rgb: opts.fc||'000000'} },
      fill:   opts.bg ? {patternType:'solid', fgColor:{rgb:opts.bg}} : undefined,
      border: opts.border ? {
        top:{style:'thin',color:{rgb:'B8C8E0'}}, bottom:{style:'thin',color:{rgb:'B8C8E0'}},
        left:{style:'thin',color:{rgb:'B8C8E0'}}, right:{style:'thin',color:{rgb:'B8C8E0'}}
      } : undefined,
      alignment:{ horizontal:opts.h||'left', vertical:'center', wrapText:!!opts.wrap }
    };
  }

  function addSheet(wb, sheetName, titleRow, subRow, headers, dataRows, colWidths, sheetOpts={}) {
    const sheetFontName = sheetOpts.fontName || 'Times New Roman';
    const textCols = new Set(sheetOpts.textCols || [1, 2]);
    const twoDecimalCols = new Set(sheetOpts.twoDecimalCols || headers.map((header, index) =>
      /(?:rs\s*)?(?:cr|crore)/i.test(String(header || '')) ? index + 1 : null
    ).filter(Boolean));
    if (useExcelJS) {
      const ws = wb.addWorksheet(sheetName, {
        views: [{state:'frozen', ySplit:4, showGridLines:false}],
        pageSetup: {orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9,
          margins:{left:.25,right:.25,top:.5,bottom:.5,header:.2,footer:.2}, horizontalCentered:true}
      });
      ws.addRow([titleRow]);
      ws.addRow([subRow]);
      ws.addRow([]);
      ws.addRow(headers);
      dataRows.forEach(r => ws.addRow(Array.from(r)));
      ws.columns = colWidths.map(w => ({width:w}));
      ws.mergeCells(1, 1, 1, headers.length);
      ws.mergeCells(2, 1, 2, headers.length);

      const border = {
        top:{style:'thin', color:{argb:'FFB8C8E0'}},
        left:{style:'thin', color:{argb:'FFB8C8E0'}},
        bottom:{style:'thin', color:{argb:'FFB8C8E0'}},
        right:{style:'thin', color:{argb:'FFB8C8E0'}}
      };
      const fill = color => ({type:'pattern', pattern:'solid', fgColor:{argb:'FF' + color}});
      const font = (color, bold=false, size=10) => ({name:sheetFontName, size, bold, color:{argb:'FF' + color}});

      ws.getRow(1).height = 24;
      ws.getRow(1).eachCell(cell => {
        cell.fill = fill('0A1628');
        cell.font = font('C9A84C', true, 14);
        cell.alignment = {horizontal:'center', vertical:'middle', wrapText:true};
      });
      ws.getRow(2).height = 18;
      ws.getRow(2).eachCell(cell => {
        cell.fill = fill('1C3A5E');
        cell.font = font('DDEEFF', true, 10);
        cell.alignment = {horizontal:'center', vertical:'middle', wrapText:true};
      });
      ws.getRow(4).height = 22;
      ws.getRow(4).eachCell(cell => {
        cell.fill = fill('1A3A6A');
        cell.font = font('FFFFFF', true, 10);
        cell.border = border;
        cell.alignment = {horizontal:'center', vertical:'middle', wrapText:true};
      });

      dataRows.forEach((rowData, idx) => {
        const row = ws.getRow(idx + 5);
        if (sheetOpts.dataRowHeight) row.height = sheetOpts.dataRowHeight;
        let bg = 'FFFFFF';
        if (rowData) {
          const label = String(rowData[0] || '');
          if (label === '98' || rowData._neg) bg = 'FFE8E8';
          else if (rowData._noexp) bg = 'FFF4C2';
          else if (rowData._important) bg = 'FFF8D8';
          else if (rowData._cs) bg = 'E8FAF0';
          else if (rowData._co) bg = 'FFF8E8';
          else if (rowData._tot) bg = 'E8EFF8';
        }
        row.eachCell({includeEmpty:true}, (cell, colNumber) => {
          cell.fill = fill(bg);
          cell.border = border;
          cell.font = font(rowData && rowData._tot ? '0A1628' : '1A2433', !!(rowData && rowData._tot), 10);
          cell.alignment = {horizontal: textCols.has(colNumber) ? 'left' : 'right', vertical:'middle', wrapText:true};
          if (typeof cell.value === 'number') {
            cell.numFmt = twoDecimalCols.has(colNumber)
              ? '#,##0.00;[Red]-#,##0.00;0.00'
              : '#,##0';
          }
          if (typeof cell.value === 'number' && cell.value < 0) cell.font = font('B00020', true, 10);
          const text = String(cell.value || '').toUpperCase();
          if (text.includes('OVER') || text.includes('EXCESS') || text.includes('NO BUDGET')) {
            cell.font = font('B00020', true, 10);
          }
          if (text.includes('BUDGET AVAILABLE, NO EXPENSES')) {
            cell.fill = fill('FFF1A8');
            cell.font = font('6C4700', true, 10);
          }
          if (rowData && rowData._important && colNumber <= 2) {
            cell.font = font('0E6A52', true, 10);
          }
        });
      });
      ws.autoFilter = {from:{row:4,column:1}, to:{row:4,column:headers.length}};
      ws.eachRow(row => row.commit && row.commit());
      return;
    }

    const aoa = [];
    // Title rows
    aoa.push([titleRow]);
    aoa.push([subRow]);
    aoa.push([]); // blank spacer
    aoa.push(headers);
    dataRows.forEach(r => aoa.push(r));

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = colWidths.map(w => ({wch:w}));

    // Apply styles if XLSX supports it (xlsx-style or sheetjs pro - graceful fallback)
    try {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R=range.s.r; R<=range.e.r; R++) {
        for (let C=range.s.c; C<=range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({r:R,c:C});
          if (!ws[addr]) ws[addr]={v:'',t:'s'};
          if (R===0) ws[addr].s = mkStyle({bold:true,sz:13,bg:'0A1628',fc:'C9A84C',h:'center',wrap:true});
          else if (R===1) ws[addr].s = mkStyle({bold:true,sz:10,bg:'1C3A5E',fc:'B8D0F0',h:'center',wrap:true});
          else if (R===3) ws[addr].s = mkStyle({bold:true,sz:10,bg:'1A3A6A',fc:'FFFFFF',h:'center'});
          else {
            // Data rows - color by row type
            const rowData = dataRows[R-4];
            let bg = 'FFFFFF';
            if (rowData) {
              const label = String(rowData[0]||'');
              if (label==='98') bg='FFE8E8';
              else if (rowData._noexp) bg='FFF4C2';
              else if (rowData._important) bg='FFF8D8';
              else if (rowData._cs) bg='E8FAF0';
              else if (rowData._co) bg='FFF8E8';
              else if (rowData._tot) bg='E8EFF8';
            }
            ws[addr].s = mkStyle({bg, border:true, h: textCols.has(C+1)?'left':'right', name:sheetFontName, wrap:true});
            if (typeof ws[addr].v === 'number') {
              ws[addr].z = twoDecimalCols.has(C+1)
                ? '#,##0.00;[Red]-#,##0.00;0.00'
                : '#,##0';
            }
          }
        }
      }
      // Merge title rows across all columns
      const maxC = headers.length - 1;
      ws['!merges'] = [
        {s:{r:0,c:0},e:{r:0,c:maxC}},
        {s:{r:1,c:0},e:{r:1,c:maxC}},
      ];
      ws['!rows'] = [{hpt:22},{hpt:16},{hpt:6},{hpt:18}];
      ws['!margins'] = {left:.25,right:.25,top:.5,bottom:.5,header:.2,footer:.2};
      ws['!pageSetup'] = {orientation:'landscape', fitToWidth:1, fitToHeight:0, paperSize:9};
    } catch(e) { /* style not supported - data still exports fine */ }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // ── Sheet 1: LIABILITY ────────────────────────────────────
  const liabHdrs = ['PU','Description','PU Type','Liability Type',
    'Budget (Rs\'000s)','Budget (Rs Cr)',
    'APR Actual (Rs\'000s)','APR (Rs Cr)',
    'MAY Actual (Rs\'000s)','MAY (Rs Cr)',
    cur.label+' till date exp',''+cur.label+' Remaining',''+cur.label+' Total',''+cur.label+' % Done',
    'Total Committed (Rs\'000s)','Balance Budget (Rs\'000s)','Proj/Month (Rs\'000s)',
    '% Utilised','Status'];
  const liabRows=[];
  activePUMeta().forEach(pu=>{
    const cv=compute(pu.code); const md=MONTH[pu.code]||{};
    const apr=md.apr||0, may=md.may||0;
    const pctStr=cv.utilisedFlag==='no-budget'?'No Budget - Excess Spend':
                 cv.utilisedFlag==='none'?'Nil (no activity)':
                 cv.utilisedPct!=null?cv.utilisedPct.toFixed(1)+'%':'-';
    const status=isBudgetNoExpense(pu.code)?'BUDGET AVAILABLE, NO EXPENSES':
                 cv.utilisedFlag==='over'?'OVER BUDGET':
                 cv.utilisedFlag==='no-budget'?'NO BUDGET ALLOCATED':
                 cv.utilisedPct>85?'Near Exhausted':cv.utilisedPct>60?'Watch':'On Track';
    const row=[pu.code,pu.desc,pu.puType,pu.liab,
      cv.budget, parseFloat((cv.budget*1000/10000000).toFixed(2)),
      apr, parseFloat((apr*1000/10000000).toFixed(2)),
      may, parseFloat((may*1000/10000000).toFixed(2)),
      cv.curCommitted,cv.curRemaining,cv.curMonthTotal,
      cv.curDonePct!=null?parseFloat(cv.curDonePct.toFixed(1)):0,
      cv.totalCommitted,cv.balanceBudget,Math.round(cv.projPerMonth),
      pctStr, status];
    row._noexp = isBudgetNoExpense(pu.code);
    row._important = isImportantPU(pu.code);
    row._cs = (pu.puType==='Staff PU' && pu.liab==='Committed');
    row._co = (!row._cs && pu.liab==='Committed');
    liabRows.push(row);
  });
  // Total row
  const lt={};
  liabRows.forEach(r=>{ [4,6,8,10,11,12,14,15,16].forEach(i=>lt[i]=(lt[i]||0)+(r[i]||0)); });
  const totRow=['','GRAND TOTAL (excl. Recoveries)','','',
    lt[4],parseFloat((lt[4]*1000/10000000).toFixed(2)),
    lt[6],parseFloat((lt[6]*1000/10000000).toFixed(2)),
    lt[8],parseFloat((lt[8]*1000/10000000).toFixed(2)),
    lt[10],lt[11],lt[12],'',lt[14],lt[15],lt[16],
    lt[4]?parseFloat((lt[14]/lt[4]*100).toFixed(1))+'%':'-',''];
  totRow._tot=true; liabRows.push(totRow);
  addSheet(wb,'OWE',HDR_TITLE,HDR_SUB,liabHdrs,liabRows,
    [6,24,14,12,14,10,14,10,14,10,14,14,14,10,15,14,14,10,16]);

  // ── Sheet 2: MONTH WISE ───────────────────────────────────
  const mwHdrs=['PU','Description',
    'APR Actual','MAY Actual',
    cur.label+' till date exp',cur.label+' Remaining',cur.label+' Total',
    'JUL Proj','AUG Proj','SEP Proj','OCT Proj','NOV Proj','DEC Proj','JAN Proj','FEB Proj','MAR Proj',
    'Budget (Rs\'000s)','Total Committed','Balance','% Used','Status'];
  const mwRows=[];
  activePUMeta().forEach(pu=>{
    const cv=compute(pu.code); const md=MONTH[pu.code]||{};
    const proj=Math.round(cv.projPerMonth);
    const pct=cv.utilisedFlag==='no-budget'?'No Budget':
               cv.utilisedPct!=null?parseFloat(cv.utilisedPct.toFixed(1))+'%':'Nil';
    const status=isBudgetNoExpense(pu.code)?'BUDGET AVAILABLE, NO EXPENSES':'';
    const row=[pu.code,pu.desc,md.apr||0,md.may||0,
      cv.curCommitted,cv.curRemaining,cv.curMonthTotal,
      proj,proj,proj,proj,proj,proj,proj,proj,proj,
      cv.budget,cv.totalCommitted,cv.balanceBudget,pct,status];
    row._noexp=isBudgetNoExpense(pu.code);
    row._important = isImportantPU(pu.code);
    row._cs=(pu.puType==='Staff PU'&&pu.liab==='Committed');
    row._co=(!row._cs&&pu.liab==='Committed');
    mwRows.push(row);
  });
  // Total
  const mt={};
  mwRows.forEach(r=>{ [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].forEach(i=>mt[i]=(mt[i]||0)+(+r[i]||0)); });
  const mwTot=['','GRAND TOTAL',...[2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(i=>mt[i]),mt[16],mt[17],mt[18],
    mt[16]?parseFloat((mt[17]/mt[16]*100).toFixed(1))+'%':'-',''];
  mwTot._tot=true; mwRows.push(mwTot);
  addSheet(wb,'Month Wise',HDR_TITLE,HDR_SUB,mwHdrs,mwRows,
    [6,24,12,12,14,14,12,10,10,10,10,10,10,10,10,10,14,14,12,10,28]);

  // ── Sheet 3: RECOVERIES ───────────────────────────────────
  const r98=compute('98'); const m98=MONTH['98']||{};
  const recHdrs=['PU','Description','Budget (Rs\'000s)','Budget (Rs Cr)',
    'APR Actual','MAY Actual',cur.label+' till date exp',cur.label+' Remaining',
    'Total Committed','Balance','Proj/Month','% Used'];
  const recRows=[[
    '98','Credit or Recoveries',r98.budget,parseFloat((r98.budget*1000/10000000).toFixed(2)),
    m98.apr||0,m98.may||0,r98.curCommitted,r98.curRemaining,
    r98.totalCommitted,r98.balanceBudget,Math.round(r98.projPerMonth),
    r98.utilisedPct!=null?parseFloat(r98.utilisedPct.toFixed(1))+'%':'-'
  ]];
  recRows[0]._neg=true;
  addSheet(wb,'Recoveries PU-98',HDR_TITLE,HDR_SUB,recHdrs,recRows,
    [6,24,14,12,12,12,14,14,15,14,12,10]);

  // ── Sheet 4: PU MASTER ────────────────────────────────────
  const pmHdrs=['PU Code','Description','Type of PU','Type of Liability',
    'Effective Budget / OBA (Rs\'000s)','Budget (Rs Cr)','Actuals Till Date (Rs\'000s)','Remaining Budget (Rs\'000s)','Remaining Budget (Rs Cr)','% Utilised','Status'];
  const pmRows=[];
  PU_META.filter(pu => !isSkippedDisplayPU(pu.code)).forEach(pu=>{
    const bud=BUDGET[pu.code]||{}; const cv=compute(pu.code);
    const pct=cv.utilisedFlag==='no-budget'?'No Budget':
               cv.utilisedFlag==='none'?'Nil':
               cv.utilisedPct!=null?parseFloat(cv.utilisedPct.toFixed(1))+'%':'-';
    const status=isBudgetNoExpense(pu.code)?'BUDGET AVAILABLE, NO EXPENSES':'';
    const row=[pu.code,pu.desc,pu.puType,pu.liab,
      getBudget(pu.code),getBudget(pu.code)/10000,
      bud.actuals_till||0,cv.balanceBudget,parseFloat((cv.balanceBudget*1000/10000000).toFixed(2)),pct,status];
    row._noexp=isBudgetNoExpense(pu.code);
    row._important = isImportantPU(pu.code);
    row._cs=(pu.puType==='Staff PU'&&pu.liab==='Committed');
    row._co=(!row._cs&&pu.liab==='Committed');
    row._neg=pu.isNeg;
    pmRows.push(row);
  });
  addSheet(wb,'PU Master',HDR_TITLE,HDR_SUB,pmHdrs,pmRows,
    [8,24,16,14,18,12,20,20,16,12,28]);

  // Sheet 5: Budget Proportionate Analysis
  const bpRowsSource = buildBPRows();
  const bpModeExport = getBPModeStatus();
  const bpHdrs = ['PU','Description','PU Type','Liability','Budget Grant BG (Rs\'000s)','BP Months',
    'Budget Proportionate (Rs\'000s)','Actual Till Date (Rs\'000s)','Variance vs BP (Rs\'000s)','Utilisation %','BP Status','BP Remark'];
  const bpRows = bpRowsSource.map(r => {
    const row = [r.pu.code, r.pu.desc, r.pu.puType, r.pu.liab, r.budget, r.actualMonthCount,
      Math.round(r.bp), Math.round(r.actualTill), Math.round(r.variance),
      r.budget ? parseFloat(r.utilPct.toFixed(1)) + '%' : '0.0%', r.status, r.remark];
    row._noexp = r.noExpense;
    row._important = isImportantPU(r.pu.code);
    row._cs = (r.pu.puType === 'Staff PU' && r.pu.liab === 'Committed');
    row._co = (!row._cs && r.pu.liab === 'Committed');
    return row;
  });
  const bpTotals = bpRowsSource.reduce((t, r) => {
    t.budget += r.budget; t.bp += r.bp; t.actual += r.actualTill; t.variance += r.variance;
    return t;
  }, {budget:0, bp:0, actual:0, variance:0});
  const bpTotRow = ['', 'TOTAL SELECTED PUs', '', '', Math.round(bpTotals.budget),
    bpModeExport.bpMonthCount, Math.round(bpTotals.bp), Math.round(bpTotals.actual),
    Math.round(bpTotals.variance), bpTotals.budget ? parseFloat(((bpTotals.actual / bpTotals.budget) * 100).toFixed(1)) + '%' : '0.0%',
    bpTotals.variance >= 0 ? 'Net Excess' : 'Net Saving', 'Calculated on all active PUs.'];
  bpTotRow._tot = true;
  bpRows.push(bpTotRow);
  addSheet(wb,'Budget Proportionate',HDR_TITLE,`BP = Budget Grant / 12 x selected BP months; mode: ${bpModeExport.modeLabel}; ${bpModeExport.formulaLabel}; imported BP is ignored`,bpHdrs,bpRows,
    [8,26,14,14,18,14,20,20,18,12,18,36]);

  // Sheet 6: Budget Control - BG/AR/REA/RG/FME/FG action view
  const bcRowsSource = buildBudgetControlRows();
  const bcHdrs = ['PU','Description','Action',
    "Projected Requirement (Rs'000s)","Amount to Ask (Rs'000s)","Possible Surrender (Rs'000s)",
    'Utilisation %','Budget Stage','Budget Control Remark'];
  const bcRows = bcRowsSource.map(r => {
    const row = [
      r.pu.code,
      r.pu.desc,
      r.label,
      Math.round(r.projectedRequirement || 0),
      Math.round(r.askAmount || 0),
      Math.round(r.surrenderAmount || 0),
      r.ceiling ? parseFloat(r.utilPct.toFixed(1)) + '%' : (r.actualTill ? 'No Budget' : '0.0%'),
      r.stage.askLabel,
      r.remark
    ];
    row._important = isImportantPU(r.pu.code);
    row._noexp = r.noExpense || r.key === 'ask' || r.key === 'watch';
    row._neg = r.noBudgetSpend || r.askAmount > 0;
    row._cs = r.key === 'surrender';
    return row;
  });
  const bcTotals = bcRowsSource.reduce((t, r) => {
    t.ceiling += Number(r.ceiling) || 0;
    t.actual += Number(r.actualTill) || 0;
    t.projected += Number(r.projectedRequirement) || 0;
    t.ask += Number(r.askAmount) || 0;
    t.surrender += Number(r.surrenderAmount) || 0;
    return t;
  }, {ceiling:0, actual:0, projected:0, ask:0, surrender:0});
  const bcTotRow = ['', 'TOTAL ACTIVE PUs', '',
    Math.round(bcTotals.projected), Math.round(bcTotals.ask), Math.round(bcTotals.surrender),
    bcTotals.ceiling ? parseFloat(((bcTotals.actual / bcTotals.ceiling) * 100).toFixed(1)) + '%' : '0.0%',
    budgetControlStage().askLabel, 'Net ask/surrender calculated from current projection rule.'];
  bcTotRow._tot = true;
  bcRows.push(bcTotRow);
  addSheet(wb,'Budget Control',HDR_TITLE,'Indian Railways Budget Control - Ask / Surrender / Watch Register',bcHdrs,bcRows,
    [8,28,18,22,18,20,12,18,46]);

  // Workbook-aligned AE vs BP statement - all PUs, HQ custom order.
  const xsMode = getBPModeStatus();
  const xsCur = xsMode.bpThrough || xsMode.cur;
  const xsCurCount = Math.max(1, xsMode.bpMonthCount || 1);
  const xsPrevCount = Math.max(0, xsCurCount - 1);
  const xsPrevIdx = Math.max(0, (xsCur ? xsCur.idx : xsCurCount - 1) - 1);
  const xsCurLabel = xsCur ? `${xsCur.label} ${xsCur.year}` : 'Current period';
  const xsPrevLabel = `${FY_MONTH_LABELS[xsPrevIdx]} ${xsPrevIdx <= 8 ? 2026 : 2027}`;
  const xsToCr = value => parseFloat(((Number(value) || 0) / 10000).toFixed(2));
  const xsHeaders = ['AU','PU Code and Description','AE 2025-26','BG 2026-27',
    `BP up to ${xsPrevLabel}`,`BP up to ${xsCurLabel}`,`COPPY up to prior-year ${xsPrevLabel}`,
    `AE up to ${xsPrevLabel}`,`COPPY up to prior-year ${xsCurLabel}`,`AE up to ${xsCurLabel}`,
    'BG - PY AE',`AE - BP ${xsPrevLabel}`,`AE - BP ${xsCurLabel}`,'Current Movement','Calculation Remark'];
  const xsRows = buildExcessShortfallRows().sort((a,b) => {
    const ai = a.hqIndex < 0 ? 999 : a.hqIndex;
    const bi = b.hqIndex < 0 ? 999 : b.hqIndex;
    return ai - bi || a.pu.code.localeCompare(b.pu.code, undefined, {numeric:true});
  }).map(r => {
    const row = ['MB',`PU-${r.pu.code} - ${r.pu.desc}`,xsToCr(r.pyAnnual),xsToCr(r.budget),
      xsToCr(r.bpPrevious),xsToCr(r.bpCurrent),xsToCr(r.pyPrevious),xsToCr(r.actualPrevious),
      xsToCr(r.pyCurrent),xsToCr(r.actualCurrent),xsToCr(r.budgetVsPY),xsToCr(r.variancePrevious),
      xsToCr(r.varianceCurrent),xsToCr(r.latestMovement),r.remark];
    row._important = r.hqIndex >= 0;
    row._neg = r.varianceCurrent > 0;
    row._cs = r.varianceCurrent < 0;
    return row;
  });
  const xsTotals = buildExcessShortfallRows().reduce((t,r) => {
    ['pyAnnual','budget','bpPrevious','bpCurrent','pyPrevious','actualPrevious','pyCurrent','actualCurrent','budgetVsPY','variancePrevious','varianceCurrent','latestMovement'].forEach(k => t[k] += r[k]);
    return t;
  }, {pyAnnual:0,budget:0,bpPrevious:0,bpCurrent:0,pyPrevious:0,actualPrevious:0,pyCurrent:0,actualCurrent:0,budgetVsPY:0,variancePrevious:0,varianceCurrent:0,latestMovement:0});
  const xsTotalRow = ['',`TOTAL - ${xsRows.length} PUs`,...['pyAnnual','budget','bpPrevious','bpCurrent','pyPrevious','actualPrevious','pyCurrent','actualCurrent','budgetVsPY','variancePrevious','varianceCurrent','latestMovement'].map(k => xsToCr(xsTotals[k])),'Calculated from all PUs.'];
  xsTotalRow._tot = true;
  xsRows.push(xsTotalRow);
  addSheet(wb,'AE vs BP',HDR_TITLE,
    `Figures Rs Cr | BP ${xsPrevLabel} = BG / 12 x ${xsPrevCount}; BP ${xsCurLabel} = BG / 12 x ${xsCurCount}; AE-BP = cumulative AE minus BP; Movement = current variance minus previous variance`,
    xsHeaders,xsRows,[7,34,13,13,15,15,17,15,17,15,14,15,15,14,40],
    {textCols:[1,2,15], twoDecimalCols:[3,4,5,6,7,8,9,10,11,12,13,14]});

  // Sheet 7: Department wise - visible report style, no internal raw JSON
  if (window.DETAIL_SMH_DATA && Array.isArray(window.DETAIL_SMH_DATA.rows)) {
    const smhData = window.DETAIL_SMH_DATA;
    const smhExportRows = smhData.rows.filter(r => !isSkippedDisplayPU(r.puCode));
    const smhMonthKeys = smhData.monthKeys || FY_MONTHS;
    let lastIdx = Math.max(0, smhMonthKeys.indexOf(FY_MONTHS[getCurrentFYMonth().idx]));
    smhMonthKeys.forEach((m, idx) => {
      if (smhExportRows.some(r => Number((r.months || {})[m]) !== 0 && Number.isFinite(Number((r.months || {})[m])))) {
        lastIdx = Math.max(lastIdx, idx);
      }
    });
    const smhVisibleMonths = smhMonthKeys.slice(0, lastIdx + 1);
    const smhHeaders = ['Department','Demand','Primary Unit (PU)',"Budget 2026-27 (Rs'000s)"]
      .concat(smhVisibleMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)] + " Actual (Rs'000s)"))
      .concat(["Exp. Total (Rs'000s)","Balance Budget-Exp (Rs'000s)",'Status','BP Status','BP Remark']);
    const smhRows = [];
    const depts = [...new Map(smhExportRows.map(r => [r.deptCode + '|' + r.deptName, r])).values()]
      .sort((a,b) => String(a.deptCode).localeCompare(String(b.deptCode), undefined, {numeric:true}));
    depts.forEach(dept => {
      const deptRows = smhExportRows.filter(r => r.deptCode === dept.deptCode);
      const deptTotal = makeDetailTotal(deptRows);
      const deptHeader = [`${dept.deptCode} - ${dept.deptName}`,'',''].concat(Array(smhHeaders.length - 3).fill(''));
      deptHeader._tot = true;
      smhRows.push(deptHeader);
      const smhs = [...new Set(deptRows.map(r => r.smh))]
        .sort((a,b) => String(a).localeCompare(String(b), undefined, {numeric:true}));
      smhs.forEach(smh => {
        const demandSmhLabel = detailDemandSMHLabel(dept.deptCode, smh);
        const demandHeader = ['',demandSmhLabel,''].concat(Array(smhHeaders.length - 3).fill(''));
        demandHeader._cs = true;
        smhRows.push(demandHeader);
        const demandRows = deptRows.filter(r => r.smh === smh)
          .sort((a,b) => String(a.puCode).localeCompare(String(b.puCode), undefined, {numeric:true}));
        demandRows.forEach(r => {
          const balance = (Number(r.budget) || 0) - (Number(r.actualTill) || 0);
          const bp = detailBPStatus(r);
          const smhPuRow = [
            '',
            demandSmhLabel,
            `PU - ${r.puCode} - ${r.puName}`,
            Number(r.budget) || 0
          ].concat(smhVisibleMonths.map(m => Number((r.months || {})[m]) || 0))
           .concat([Number(r.actualTill) || 0, balance, isSMHBudgetNoExpense(r) ? 'BUDGET AVAILABLE, NO EXPENSES' : '', bp.status, bp.remark]);
          smhPuRow._noexp = isSMHBudgetNoExpense(r);
          smhPuRow._important = isImportantPU(r.puCode);
          smhRows.push(smhPuRow);
        });
        const demandTotal = makeDetailTotal(demandRows);
        const demandBalance = demandTotal.budget - demandTotal.actualTill;
        const demandBP = detailBPStatus(demandTotal);
        const demandTotalRow = [
          '',
          demandSmhLabel,
          `Sub-Total: ${demandSmhLabel}`,
          demandTotal.budget
        ].concat(smhVisibleMonths.map(m => demandTotal.months[m] || 0))
         .concat([demandTotal.actualTill, demandBalance, isSMHBudgetNoExpense(demandTotal) ? 'BUDGET AVAILABLE, NO EXPENSES' : '', demandBP.status, demandBP.remark]);
        demandTotalRow._noexp = isSMHBudgetNoExpense(demandTotal);
        demandTotalRow._cs = true;
        smhRows.push(demandTotalRow);
      });
      const deptBalance = deptTotal.budget - deptTotal.actualTill;
      const deptBP = detailBPStatus(deptTotal);
      const deptTotalRow = [
        '',
        '',
        `Total: ${dept.deptCode} - ${dept.deptName}`,
        deptTotal.budget
      ].concat(smhVisibleMonths.map(m => deptTotal.months[m] || 0))
       .concat([deptTotal.actualTill, deptBalance, isSMHBudgetNoExpense(deptTotal) ? 'BUDGET AVAILABLE, NO EXPENSES' : '', deptBP.status, deptBP.remark]);
      deptTotalRow._noexp = isSMHBudgetNoExpense(deptTotal);
      deptTotalRow._tot = true;
      smhRows.push(deptTotalRow);
    });
    addSheet(wb,'Department wise',HDR_TITLE,'Department > Demand > Primary Unit - Budget vs Expenditure',smhHeaders,smhRows,
      [18,14,32,16].concat(smhVisibleMonths.map(()=>14)).concat([16,18,28,18,36]));
  }

  // Sheet 8: Demand wise grant summary
  if (window.DEMAND_SMH_SUMMARY_DATA && Array.isArray(window.DEMAND_SMH_SUMMARY_DATA.rows)) {
    const dData = demandSMHData();
    const dTotals = demandSMHTotals();
    const dSuspenseRows = demandSMHSuspenseRows();
    const dHeaders = ['Demand wise','DEPT','OBA',"BP (BG/12 x months)",'AE','Variation','% BP','Budget Remaining','% OBA Utilized'];
    const dRows = demandSMHOperationalRows().map(r => {
      const row = [demandSMHLabel(r), r.dept, r.oba, r.bp, r.ae, r.variation, r.bpPct, r.budgetRemaining, r.obaUtil];
      if ((Number(r.bpPct) || 0) >= 150 || (Number(r.budgetRemaining) || 0) < 0) row._noexp = true;
      return row;
    });
    const dTotalRow = ['Total','', dTotals.oba, dTotals.bp, dTotals.ae, dTotals.variation, dTotals.bpPct, dTotals.budgetRemaining, dTotals.obaUtil];
    dTotalRow._tot = true;
    dRows.push(dTotalRow);
    dSuspenseRows.forEach(r => {
      const sRow = [`Separate: ${demandSMHLabel(r)}`, `${r.dept} - separately calculated, not netted in main total`, r.oba, r.bp, r.ae, r.variation, r.bpPct, r.budgetRemaining, r.obaUtil];
      sRow._noexp = true;
      dRows.push(sRow);
    });
    addSheet(wb,'Demand wise',HDR_TITLE,`Demand wise | ${dData.note || 'Figures in Rs thousands'}`,dHeaders,dRows,
      [18,42,14,14,14,15,10,18,14], {fontName:'Times New Roman', textCols:[1,2], dataRowHeight:28});
  }

  // Sheet 9: Sources / Remarks / Upload confirmation
  const sourceHdrs = ['Area','FY / Type','Source / Date','Used In / Files','Remarks'];
  const sourceRows = Object.values(SOURCE_REGISTER).map(s => [
    s.label,
    s.fy,
    s.source,
    s.used || '',
    s.remarks || 'Pre-loaded / uploaded portal source'
  ]);
  _uploadConfirmHistory.slice(0, 2).forEach((h, idx) => {
    sourceRows.push([
      `Upload Confirmation ${idx + 1}`,
      'Current browser',
      indianDateTime(h.at),
      h.files || '',
      h.detail || 'Admin confirmed parsed upload data.'
    ]);
  });
  sourceRows.push(['Important PU Focus','PU-27, 28, 30, 32, 60','Portal rule','All PU-wise reports','Highlighted in portal, Excel export and PDF report; available through PU focus filter.']);
  sourceRows.push(['Excluded PU Codes','PU-72, 73, 74, 75 and PU-98','Portal rule','All normal expenditure reports','GST/tax heads and recovery PU are excluded from normal operational expenditure display.']);
  sourceRows.push(['Upload retention','Current Year / Previous Year','Browser storage rule','Upload Centre','Current year upload is kept for this browser session. Previous year upload is kept in local browser storage until admin confirms overwrite.']);
  sourceRows.push(['Previous Year Status','2025-2026', _pyUploadMeta ? `Uploaded and confirmed ${indianDateTime(_pyUploadMeta.confirmedAt)}` : 'Pre-loaded static file', 'Trend and PY comparison', _pyUploadMeta ? 'Admin confirmed previous year data is being used.' : 'No admin PY overwrite confirmed in this browser.']);
  sourceRows.push(['Export Freshness', exportAudit.id, exportAudit.generatedAt, 'Excel / PDF / PowerPoint', `Validated against live portal data through ${exportAudit.latestMonth}. Minimum font 10 pt; landscape best-fit page rule.`]);
  addSheet(wb,'Sources Remarks',HDR_TITLE,`As on ${formatAsOnDate(_dataAsOnDate)} | Upload confirmations, exclusions and report rules`,sourceHdrs,sourceRows,
    [24,18,34,38,58]);

  const fileDate = new Date().toISOString().slice(0,10);
  if (useExcelJS) {
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
      `NR_Zone_${window.NR_SELECTED_SCOPE?.code || "03"}_FY2026-27_${fileDate}.xlsx`);
  } else {
    XLSX.writeFile(wb, `NR_Zone_${window.NR_SELECTED_SCOPE?.code || "03"}_FY2026-27_${fileDate}.xlsx`);
  }
  document.body.dataset.exportStatus = 'excel-finished';
  } catch (err) {
    console.error('Excel export failed', err);
    document.body.dataset.exportStatus = 'excel-error';
    showPortalNotice('Excel export failed: ' + (err.message || err), 'err');
  }
}


function reportRowsForActivePUs() {
  return activePUMeta().filter(pu => passesPUFocus(pu.code)).map(pu => {
    const cv = compute(pu.code);
    const budget = cv.budget || 0;
    const actual = cv.totalCommitted || 0;
    const utilPct = budget ? (actual / budget) * 100 : (actual ? 999 : 0);
    return {
      pu, cv, budget, actual, utilPct,
      balance: cv.balanceBudget || 0,
      noExpense: isBudgetNoExpense(pu.code),
      over: (cv.balanceBudget || 0) < 0,
      high: utilPct >= 85 || (cv.balanceBudget || 0) < 0 || (budget === 0 && actual !== 0)
    };
  });
}

function canvasDataUrl(width, height, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  drawFn(ctx, width, height);
  return canvas.toDataURL('image/png', 0.95);
}

function drawReportFrame(ctx, width, height, title) {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#D8E5F2';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.fillStyle = '#0A1628';
  ctx.font = 'bold 18px Segoe UI, Arial';
  ctx.fillText(title, 18, 28);
  ctx.strokeStyle = '#1A3A6A';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, height - 44);
  ctx.lineTo(width - 20, height - 44);
  ctx.moveTo(48, 42);
  ctx.lineTo(48, height - 44);
  ctx.stroke();
}

function makeLineChart(title, labels, series) {
  return canvasDataUrl(900, 310, (ctx, width, height) => {
    drawReportFrame(ctx, width, height, title);
    const left = 55, right = width - 28, top = 50, bottom = height - 58;
    const max = Math.max(1, ...series.flatMap(s => s.values).map(Number)) * 1.12;
    const x = idx => left + (idx / Math.max(labels.length - 1, 1)) * (right - left);
    const y = val => bottom - (Number(val) / max) * (bottom - top);
    ctx.strokeStyle = '#EEF3F8';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const yy = top + i * (bottom - top) / 4;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
    }
    series.forEach(s => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      s.values.forEach((v, idx) => idx === 0 ? ctx.moveTo(x(idx), y(v)) : ctx.lineTo(x(idx), y(v)));
      ctx.stroke();
      ctx.fillStyle = s.color;
      s.values.forEach((v, idx) => {
        ctx.beginPath();
        ctx.arc(x(idx), y(v), 4, 0, Math.PI * 2);
        ctx.fill();
      });
    });
    ctx.font = '12px Segoe UI, Arial';
    ctx.fillStyle = '#33485F';
    labels.forEach((label, idx) => ctx.fillText(label, x(idx) - 10, height - 34));
    let lx = left;
    series.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, height - 20, 12, 8);
      ctx.fillStyle = '#1A2433';
      ctx.fillText(s.name, lx + 18, height - 12);
      lx += 112;
    });
  });
}

function makeBarChart(title, labels, values, colors) {
  return canvasDataUrl(900, 310, (ctx, width, height) => {
    drawReportFrame(ctx, width, height, title);
    const left = 58, right = width - 28, top = 52, bottom = height - 60;
    const max = Math.max(1, ...values.map(Number)) * 1.12;
    const gap = 12;
    const bw = Math.max(16, (right - left - gap * (labels.length - 1)) / Math.max(labels.length, 1));
    ctx.strokeStyle = '#EEF3F8';
    for (let i = 0; i <= 4; i++) {
      const yy = top + i * (bottom - top) / 4;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
    }
    labels.forEach((label, idx) => {
      const h = (Number(values[idx]) / max) * (bottom - top);
      const x = left + idx * (bw + gap);
      ctx.fillStyle = colors[idx] || '#1A7A4A';
      ctx.fillRect(x, bottom - h, bw, h);
      ctx.fillStyle = '#33485F';
      ctx.font = '11px Segoe UI, Arial';
      ctx.save();
      ctx.translate(x + bw / 2, bottom + 13);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(label, -8, 0);
      ctx.restore();
    });
  });
}

function makeGroupedBarChart(title, labels, budgetValues, actualValues) {
  return canvasDataUrl(900, 310, (ctx, width, height) => {
    drawReportFrame(ctx, width, height, title);
    const left = 58, right = width - 28, top = 52, bottom = height - 60;
    const max = Math.max(1, ...budgetValues, ...actualValues) * 1.12;
    const groupW = (right - left) / Math.max(labels.length, 1);
    const bw = Math.max(12, Math.min(28, groupW / 3));
    ctx.strokeStyle = '#EEF3F8';
    for (let i = 0; i <= 4; i++) {
      const yy = top + i * (bottom - top) / 4;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
    }
    labels.forEach((label, idx) => {
      const gx = left + idx * groupW + groupW / 2;
      const bh = (Number(budgetValues[idx]) / max) * (bottom - top);
      const ah = (Number(actualValues[idx]) / max) * (bottom - top);
      ctx.fillStyle = 'rgba(26,74,138,.65)';
      ctx.fillRect(gx - bw - 2, bottom - bh, bw, bh);
      ctx.fillStyle = 'rgba(26,122,74,.78)';
      ctx.fillRect(gx + 2, bottom - ah, bw, ah);
      ctx.fillStyle = '#33485F';
      ctx.font = '11px Segoe UI, Arial';
      ctx.fillText(label, gx - 18, bottom + 17);
    });
    ctx.fillStyle = 'rgba(26,74,138,.65)';
    ctx.fillRect(left, height - 22, 12, 8);
    ctx.fillStyle = '#1A2433';
    ctx.fillText('Budget', left + 18, height - 14);
    ctx.fillStyle = 'rgba(26,122,74,.78)';
    ctx.fillRect(left + 95, height - 22, 12, 8);
    ctx.fillStyle = '#1A2433';
    ctx.fillText('Actual', left + 113, height - 14);
  });
}

async function downloadSMHMatrixPDF(unit) {
  if (!confirmProtectedExport(`SMH matrix ${unit} PDF`)) return;
  try {
    const audit=prepareFreshExport('PDF');
    const mode=getBPModeStatus();
    const data=window.DETAIL_SMH_DATA;
    const fy=window.DEMAND_SMH_SUMMARY_DATA.fy;
    const fonts=await DisplayExport.fonts();
    const doc=window.SMHMatrixExport.generate(window.jspdf.jsPDF,data.rows,mode.bpMonths,{
      scope:window.nrScopeLabel(),fy,through:mode.bpThrough?`${mode.bpThrough.label} ${mode.bpThrough.year}`:'NONE',
      revision:ASSET_VERSION,generated:new Date().toLocaleString('en-IN')
    },unit,fonts);
    doc.save(`NR_Zone_${window.NR_SELECTED_SCOPE.code}_SMH_PU_Department_${fy}_${unit}.pdf`);
  } catch(e) { showPortalNotice(`SMH PDF failed: ${e.message}`,'err'); }
}

async function downloadPDFReport() {
  if (!confirmProtectedExport('PDF export')) return;
  document.body.dataset.exportStatus = 'pdf-started';
  try {
  const exportAudit = prepareFreshExport('PDF');
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF || !jsPDF.API.autoTable) {
    document.body.dataset.exportStatus = 'pdf-error';
    showPortalNotice('PDF library not loaded. Please refresh and try again.', 'err');
    return;
  }
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  if(window.DisplayExport) await DisplayExport.configurePDF(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 34;
  const today = new Date().toISOString().slice(0,10);
  const {cur, actualMonths} = getMonthStatus();
  const rows = reportRowsForActivePUs();
  const totals = rows.reduce((t, r) => {
    t.budget += r.budget;
    t.actual += r.actual;
    t.balance += r.balance;
    t.proj += r.cv.projPerMonth || 0;
    return t;
  }, {budget:0, actual:0, balance:0, proj:0});
  const util = totals.budget ? (totals.actual / totals.budget) * 100 : 0;
  const highRiskAll = rows.filter(r => r.high).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance));
  const highRisk = highRiskAll.slice(0, 18);
  const noExpAll = rows.filter(r => r.noExpense).sort((a,b) => b.budget - a.budget);
  const noExp = noExpAll.slice(0, 18);
  const bpAll = buildBPRows().sort((a,b) => Math.abs(b.variance) - Math.abs(a.variance));
  const bpRows = bpAll.slice(0, 18);
  const bcAll = buildBudgetControlRows();
  const bcRows = bcAll
    .filter(r => r.askAmount > 0 || r.surrenderAmount > 0 || r.key === 'watch' || r.key === 'noexpense')
    .slice(0, 22);
  const aiAll = buildAITrendItems();
  const aiRows = aiAll.slice(0, 14);
  const smhRows = (window.DETAIL_SMH_DATA && Array.isArray(window.DETAIL_SMH_DATA.rows)) ? window.DETAIL_SMH_DATA.rows : [];
  const smhDept = [...new Map(smhRows.filter(r => !isSkippedDisplayPU(r.puCode)).map(r => [r.deptCode + '|' + r.deptName, r])).values()]
    .map(d => {
      const dr = smhRows.filter(r => r.deptCode === d.deptCode && !isSkippedDisplayPU(r.puCode));
      const total = makeDetailTotal(dr);
      return {name:`${d.deptCode} - ${d.deptName}`, budget:total.budget, actual:total.actualTill, balance:total.budget - total.actualTill};
    }).sort((a,b) => b.actual - a.actual).slice(0, 12);
  const actualMonthLabels = actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]);
  const completedMonthKeys = actualMonths.length ? actualMonths : FY_MONTHS.slice(0, Math.max(1, cur.idx));
  const portalSummaryRows = [
    ['PU coverage', `${rows.length} active expenditure PUs`, 'PU-72, 73, 74, 75 GST and PU-98 recovery are excluded from normal display.'],
    ['Risk coverage', `${highRiskAll.length} high/watch PUs`, 'Includes over-budget, high utilisation, no-budget spend and budget-with-no-expense cases.'],
    ['BP coverage', `${bpAll.length} PUs`, `BP uses ${actualMonths.length} completed actual month(s): ${actualMonthLabels.join(', ') || 'none'}.`],
    ['Budget Control coverage', `${bcAll.length} active PUs`, 'Shows ask, surrender, watch and no-expense action using Indian Railways budget control sequence.'],
    ['Important PU Focus', 'PU-27, PU-28, PU-30, PU-32, PU-60', 'These key material/contractual PUs are highlighted in portal and export reports.'],
    ['AI trend coverage', `${aiAll.length} non-staff/planned PUs`, 'Staff PU with committed liability is excluded from AI trend summary.'],
    ['SMH coverage', `${smhRows.filter(r => !isSkippedDisplayPU(r.puCode)).length} detail rows`, 'Department 00 and PU-98 recovery are excluded from SMH operational view.']
  ];
  const liabilityAnnexure = rows.slice().sort((a,b) => b.actual - a.actual).map(r => [
    'PU-' + r.pu.code,
    r.pu.desc,
    r.pu.puType,
    r.pu.liab,
    textCr(r.budget),
    textCr(r.actual),
    textCr(r.balance),
    r.budget ? r.utilPct.toFixed(1) + '%' : (r.actual ? 'No Budget' : '0.0%'),
    r.noExpense ? 'Budget, No Expense' : r.over ? 'Over Budget' : r.utilPct >= 85 ? 'High Utilisation' : 'Normal'
  ]);
  const monthWiseAnnexure = rows.slice().sort((a,b) => b.actual - a.actual).map(r => {
    const md = MONTH[r.pu.code] || {};
    return [
      'PU-' + r.pu.code,
      r.pu.desc,
      ...completedMonthKeys.map(m => textCr(Number(md[m]) || 0)),
      textCr(r.actual),
      textCr(r.balance)
    ];
  });
  const puMasterAnnexure = activePUMeta().map(pu => {
    const cv = compute(pu.code);
    return [
      'PU-' + pu.code,
      pu.desc,
      pu.puType,
      pu.liab,
      textCr(cv.budget),
      textCr(cv.totalCommitted),
      textCr(cv.balanceBudget),
      cv.utilisedPct != null ? cv.utilisedPct.toFixed(1) + '%' : (cv.totalCommitted ? 'No Budget' : '0.0%')
    ];
  });
  const sourceRows = Object.values(SOURCE_REGISTER).map(s => [s.label, s.fy, s.source, s.used || '', s.remarks || 'Pre-loaded / uploaded portal source']);
  sourceRows.push(['Export Freshness', exportAudit.id, exportAudit.generatedAt, `Validated through ${exportAudit.latestMonth}`, 'Live portal memory reconciled immediately before PDF generation; minimum 10 pt and page-fit margins enforced.']);
  _uploadConfirmHistory.slice(0, 2).forEach((h, idx) => {
    sourceRows.push([
      `Upload Confirmation ${idx + 1}`,
      'Current browser',
      indianDateTime(h.at),
      h.files || '',
      h.detail || 'Admin confirmed parsed upload data.'
    ]);
  });
  sourceRows.push(['Important PU Focus','PU-27, 28, 30, 32, 60','All PU-wise reports','Portal / Excel / PDF','Highlighted as Key Important PUs and available through PU focus filter.']);
  sourceRows.push(['Upload retention','CY session / PY browser storage','Upload Centre','Current browser','Current year uploads survive refresh in this session. Previous year upload is retained until admin overwrite.']);
  const exclusionRows = [
    ['Department 00', 'Skipped in detailed SMH analysis', 'Non-operational/summary department code is not mixed with department expenditure review.'],
    ['PU-98', 'Skipped from normal expenditure view', 'Credit or recoveries are shown separately and not treated as expenditure.'],
    ['PU-72, PU-73, PU-74, PU-75', 'Skipped from portal display and analysis', 'GST/tax adjustment heads are excluded from operational PU expenditure analysis.'],
    ['Staff PU committed liability', 'Skipped from AI Trend Summary only', 'Committed staff liability is stable/obligatory and can distort AI trend prioritisation.']
  ];
  const smhDetailAnnexure = smhRows
    .filter(r => !isSkippedDisplayPU(r.puCode) && normPUCode(r.puCode) !== '98')
    .sort((a,b) => (Number(b.actualTill) || 0) - (Number(a.actualTill) || 0))
    .slice(0, 120)
    .map(r => {
      const bal = (Number(r.budget) || 0) - (Number(r.actualTill) || 0);
      const bp = detailBPStatus(r);
      return [
        `${r.deptCode} - ${r.deptName}`,
        detailDemandSMHLabel(r),
        `PU-${r.puCode} - ${r.puName}`,
        detailCr(r.budget),
        detailCr(r.actualTill),
        detailCr(bal),
        isSMHBudgetNoExpense(r) ? 'Budget, No Expense' : bal < 0 ? 'Over Budget' : 'Normal',
        bp.status
      ];
    });
  const smhNoExpenseAnnexure = smhRows
    .filter(r => !isSkippedDisplayPU(r.puCode) && normPUCode(r.puCode) !== '98' && isSMHBudgetNoExpense(r))
    .sort((a,b) => (Number(b.budget) || 0) - (Number(a.budget) || 0))
    .slice(0, 80)
    .map(r => [`${r.deptCode} - ${r.deptName}`, detailDemandSMHLabel(r), `PU-${r.puCode} - ${r.puName}`, detailCr(r.budget), 'Budget available but no actual expense booked']);
  const demandRows = demandSMHOperationalRows();
  const demandSuspenseRows = demandSMHSuspenseRows();
  const demandTotals = demandSMHTotals();
  const demandAnnexure = demandRows.map(r => [
    demandSMHLabel(r),
    r.dept,
    detailCr(r.oba),
    detailCr(r.bp),
    detailCr(r.ae),
    signedCr(r.variation),
    detailNum(r.bpPct) + '%',
    detailCr(r.budgetRemaining),
    detailNum(r.obaUtil) + '%'
  ]);
  const demandSuspenseAnnexure = demandSuspenseRows.map(r => [
    `Separate: ${demandSMHLabel(r)}`,
    `${r.dept} - separately calculated, not netted in main total`,
    detailCr(r.oba),
    detailCr(r.bp),
    detailCr(r.ae),
    signedCr(r.variation),
    detailNum(r.bpPct) + '%',
    detailCr(r.budgetRemaining),
    detailNum(r.obaUtil) + '%'
  ]);

  function header(title) {
    doc.setFillColor(10, 22, 40);
    doc.rect(0, 0, pageW, 44, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('times', 'bold');
    doc.setFontSize(13);
    doc.text(title, margin, 27);
    doc.setTextColor(201, 168, 76);
    doc.setFontSize(10);
    doc.text(`FY 2026-27 | As on ${formatAsOnDate(_dataAsOnDate)} | Current Month ${cur.label} ${cur.year}`, pageW - margin, 27, {align:'right'});
  }
  function footer() {
    doc.setTextColor(96, 112, 128);
    doc.setFontSize(10);
    doc.text(`Ordinary Working Expenses (OWE) Portal - For Official Use Only - Session ${securitySessionId()}`, margin, pageH - 16);
    doc.text(String(doc.internal.getNumberOfPages()), pageW - margin, pageH - 16, {align:'right'});
  }
  function addPage(title) {
    if (doc.internal.getNumberOfPages() > 1 || doc.lastAutoTable) doc.addPage();
    header(title);
    footer();
  }
  function autoTable(opts) {
    const PDF_MIN_FONT_SIZE = 10;
    const callerDidParseCell = opts.didParseCell;
    const mergedOpts = Object.assign({
      theme:'grid',
      margin:{top:52, bottom:30, left:margin, right:margin},
      tableWidth:'auto',
      horizontalPageBreak:true,
      horizontalPageBreakRepeat:0,
      showHead:'everyPage',
      styles:{font:'times', fontSize:PDF_MIN_FONT_SIZE, cellPadding:2.5, lineColor:[190,205,225], lineWidth:.4, overflow:'linebreak'},
      headStyles:{fillColor:[26,58,106], textColor:[255,255,255], fontStyle:'bold', font:'times'},
      alternateRowStyles:{fillColor:[246,250,254]},
      didParseCell: data => {
        const first = Array.isArray(data.row.raw) ? String(data.row.raw[0] || '') : '';
        if (data.section === 'body' && /^PU-(27|28|30|32|60)\b/.test(first)) {
          data.cell.styles.fillColor = [255, 248, 216];
          if (data.column.index <= 1) {
            data.cell.styles.textColor = [14, 106, 82];
            data.cell.styles.fontStyle = 'bold';
          }
        }
        if (callerDidParseCell) callerDidParseCell(data);
      },
      didDrawPage: () => { header(opts.pageTitle || 'OWE Report'); footer(); }
    }, opts);
    mergedOpts.margin = Object.assign({top:52, bottom:30, left:margin, right:margin}, mergedOpts.margin || {});
    mergedOpts.styles = Object.assign({}, mergedOpts.styles || {}, {
      fontSize:Math.max(PDF_MIN_FONT_SIZE, Number((mergedOpts.styles || {}).fontSize) || 0),
      overflow:'linebreak'
    });
    mergedOpts.headStyles = Object.assign({}, mergedOpts.headStyles || {}, {
      fontSize:Math.max(PDF_MIN_FONT_SIZE, Number((mergedOpts.headStyles || {}).fontSize) || 0)
    });
    mergedOpts.footStyles = Object.assign({}, mergedOpts.footStyles || {}, {
      fontSize:Math.max(PDF_MIN_FONT_SIZE, Number((mergedOpts.footStyles || {}).fontSize) || 0)
    });
    mergedOpts.didParseCell = data => {
      data.cell.styles.fontSize = Math.max(PDF_MIN_FONT_SIZE, Number(data.cell.styles.fontSize) || 0);
      const first = Array.isArray(data.row.raw) ? String(data.row.raw[0] || '') : '';
      if (data.section === 'body' && /^PU-(27|28|30|32|60)\b/.test(first)) {
        data.cell.styles.fillColor = [255, 248, 216];
        if (data.column.index <= 1) {
          data.cell.styles.textColor = [14, 106, 82];
          data.cell.styles.fontStyle = 'bold';
        }
      }
      if (callerDidParseCell) callerDidParseCell(data);
    };
    doc.autoTable(mergedOpts);
  }

  addPage('OWE Report - Executive Summary');
  doc.setTextColor(10, 22, 40);
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.text('Ordinary Working Expenses (OWE) Portal', margin, 96);
  doc.setFontSize(14);
  doc.text(window.nrScopeLabel()+' / Northern Railway', margin, 120);
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  doc.text(`Financial Year 2026-27 | Current Month: ${cur.label} ${cur.year} | Actual months: ${actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).join(', ')}`, margin, 145);
  doc.text(`Budget basis: ${isRGActive() ? 'RG where allotted; otherwise BG_ISL' : 'RG not active - using BG_ISL'} | Excluded: PU-72, 73, 74, 75 GST heads and PU-98 recoveries from normal expenditure view.`, margin, 162);
  autoTable({
    startY: 190,
    pageTitle:'OWE Report - Executive Summary',
    head:[['KPI','Value']],
    body:[
      ['Gross Budget', textCr(totals.budget)],
      ['Actual / Committed', textCr(totals.actual)],
      ['Balance Budget', textCr(totals.balance)],
      ['Utilisation', util.toFixed(1) + '%'],
      ['Projection / Month', textCr(totals.proj)],
      ['High / Watch PUs', String(highRiskAll.length)],
      ['Budget but No Expense PUs', String(noExpAll.length)]
    ],
    columnStyles:{0:{fontStyle:'bold', fillColor:[232,239,248]}, 1:{halign:'right', fontStyle:'bold'}},
    tableWidth:360
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    pageTitle:'OWE Report - Executive Summary',
    head:[['Data Area','FY','Source / File']],
    body:sourceRows.map(r => [r[0], r[1], r[2]]),
    columnStyles:{2:{cellWidth:320}}
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    pageTitle:'OWE Report - Executive Summary',
    head:[['Coverage Area','Current Position','Officer Note']],
    body:portalSummaryRows.concat([['Demand wise', `${demandRows.length} grant rows + Suspense separate`, `OBA ${detailCr(demandTotals.oba)}, AE ${detailCr(demandTotals.ae)}, BP utilisation ${detailNum(demandTotals.bpPct)}%. Demand 12N/10N Suspense Heads is separately calculated.`]]),
    columnStyles:{2:{cellWidth:360}}
  });

  addPage('OWE Report - Graphs');
  const monthLabels = FY_MONTH_LABELS.map((m,i) => m + (i <= 8 ? '-26' : '-27'));
  const cyMonthly = FY_MONTHS.map(m => rows.reduce((s,r) => s + (Number((MONTH[r.pu.code] || {})[m]) || 0), 0) / 10000);
  const pyMonthly = FY_MONTHS.map(m => rows.reduce((s,r) => s + (Number((MONTH_PY[r.pu.code] || {})[m]) || 0), 0) / 10000);
  const topUtil = rows.filter(r => r.budget > 0).sort((a,b) => b.utilPct - a.utilPct).slice(0, 10);
  const topActual = rows.slice().sort((a,b) => b.actual - a.actual).slice(0, 10);
  doc.addImage(makeLineChart('CY vs PY Monthly Actuals (Rs Cr)', monthLabels, [
    {name:'CY 2026-27', values:cyMonthly, color:'#1A7A4A'},
    {name:'PY 2025-26', values:pyMonthly, color:'#1A4E9A'}
  ]), 'PNG', margin, 62, 360, 124);
  doc.addImage(makeBarChart('Top Utilisation PUs (%)', topUtil.map(r => 'PU-' + r.pu.code), topUtil.map(r => Math.min(150, r.utilPct)), topUtil.map(r => r.utilPct > 100 ? '#B00020' : r.utilPct > 85 ? '#E85D04' : '#1A7A4A')), 'PNG', margin + 395, 62, 360, 124);
  doc.addImage(makeGroupedBarChart('Major PUs - Budget vs Actual (Rs Cr)', topActual.map(r => 'PU-' + r.pu.code), topActual.map(r => r.budget / 10000), topActual.map(r => r.actual / 10000)), 'PNG', margin, 216, 755, 124);

  addPage('OWE Report - Risk Analysis');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - Risk Analysis',
    head:[['PU','Description','Budget','Actual','Balance','Util %','Status','Suggested Review']],
    body:highRisk.map(r => ['PU-' + r.pu.code, r.pu.desc, textCr(r.budget), textCr(r.actual), textCr(r.balance), r.utilPct.toFixed(1) + '%', r.over ? 'Over Budget' : r.utilPct >= 85 ? 'High Utilisation' : 'Watch', r.over ? 'Budget support / booking control' : r.noExpense ? 'Check pending booking' : 'Monitor next booking cycle']),
    columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    pageTitle:'OWE Report - Risk Analysis',
    head:[['PU','Description','Budget','Remark']],
    body:noExp.map(r => ['PU-' + r.pu.code, r.pu.desc, textCr(r.budget), 'Budget available but no expense booked']),
    columnStyles:{2:{halign:'right'}}
  });

  addPage('OWE Report - BP and AI Summary');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - BP and AI Summary',
    head:[['PU','Description','Budget','BP','Actual','Variance','Util %','BP Status','Accounts Remark']],
    body:bpRows.map(r => ['PU-' + r.pu.code, r.pu.desc, textCr(r.budget), textCr(r.bp), textCr(r.actualTill), signedCr(r.variance), r.budget ? r.utilPct.toFixed(1) + '%' : '0.0%', r.status, r.remark]),
    columnStyles:{2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    pageTitle:'OWE Report - BP and AI Summary',
    head:[['PU','AI Trend / Liability Remark']],
    body:aiRows.map(r => ['PU-' + r.pu.code, `${r.risk.toUpperCase()}: CY as-on ${textCr(r.cyTotalAsOn)} vs PY ${textCr(r.pyTotalAsOn)}; balance ${textCr(r.cv.balanceBudget)}; utilisation ${r.utilPct.toFixed(1)}%.`]),
    columnStyles:{1:{cellWidth:620}}
  });

  addPage('OWE Report - Budget Control');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - Budget Control',
    head:[['PU','Description','Action','Projected','Ask','Surrender','Util %','Budget Stage','Remark']],
    body:bcRows.map(r => [
      'PU-' + r.pu.code,
      r.pu.desc,
      r.label,
      textCr(r.projectedRequirement),
      r.askAmount ? textCr(r.askAmount) : '-',
      r.surrenderAmount ? textCr(r.surrenderAmount) : '-',
      r.ceiling ? r.utilPct.toFixed(1) + '%' : (r.actualTill ? 'No Budget' : '0.0%'),
      r.stage.askLabel,
      r.remark
    ]),
    styles:{fontSize:10, cellPadding:2.5, overflow:'linebreak'},
    columnStyles:{1:{cellWidth:150},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},8:{cellWidth:215}}
  });

  const xsPdfMode = getBPModeStatus();
  const xsPdfCur = xsPdfMode.bpThrough || xsPdfMode.cur;
  const xsPdfCurCount = Math.max(1, xsPdfMode.bpMonthCount || 1);
  const xsPdfPrevCount = Math.max(0, xsPdfCurCount - 1);
  const xsPdfPrevIdx = Math.max(0, (xsPdfCur ? xsPdfCur.idx : xsPdfCurCount - 1) - 1);
  const xsPdfCurLabel = xsPdfCur ? `${xsPdfCur.label} ${xsPdfCur.year}` : 'Current';
  const xsPdfPrevLabel = `${FY_MONTH_LABELS[xsPdfPrevIdx]} ${xsPdfPrevIdx <= 8 ? 2026 : 2027}`;
  const xsPdfRows = buildExcessShortfallRows().sort((a,b) => {
    const ai = a.hqIndex < 0 ? 999 : a.hqIndex;
    const bi = b.hqIndex < 0 ? 999 : b.hqIndex;
    return ai - bi || a.pu.code.localeCompare(b.pu.code, undefined, {numeric:true});
  });
  addPage('OWE Report - AE vs BP Statement');
  doc.setTextColor(45, 65, 88); doc.setFont('times','normal'); doc.setFontSize(10);
  doc.text(`BP ${xsPdfPrevLabel} = BG / 12 x ${xsPdfPrevCount}; BP ${xsPdfCurLabel} = BG / 12 x ${xsPdfCurCount}; AE-BP = cumulative AE minus BP; movement = current variance minus previous variance.`, margin, 60, {maxWidth:pageW-margin*2});
  autoTable({
    startY:78,
    pageTitle:'OWE Report - AE vs BP Statement',
    head:[['AU','PU','PY AE','BG',`BP ${xsPdfPrevLabel}`,`BP ${xsPdfCurLabel}`,`PY ${xsPdfPrevLabel}`,`AE ${xsPdfPrevLabel}`,`PY ${xsPdfCurLabel}`,`AE ${xsPdfCurLabel}`,'BG-PY AE','Prev AE-BP','Current AE-BP','Movement','Remark']],
    body:xsPdfRows.map(r => ['MB',`PU-${r.pu.code} ${r.pu.desc}`,textCr(r.pyAnnual),textCr(r.budget),textCr(r.bpPrevious),textCr(r.bpCurrent),textCr(r.pyPrevious),textCr(r.actualPrevious),textCr(r.pyCurrent),textCr(r.actualCurrent),signedCr(r.budgetVsPY),signedCr(r.variancePrevious),signedCr(r.varianceCurrent),signedCr(r.latestMovement),r.remark]),
    styles:{fontSize:10, cellPadding:2.2, overflow:'linebreak'},
    columnStyles:{1:{cellWidth:170},14:{cellWidth:170}}
  });

  addPage('OWE Report - PU-wise Liability Annexure');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - PU-wise Liability Annexure',
    head:[['PU','Description','Type','Liability','Budget','Actual','Balance','Util %','Status']],
    body:liabilityAnnexure,
    styles:{fontSize:10, cellPadding:2.5, overflow:'linebreak'},
    columnStyles:{1:{cellWidth:170},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'}}
  });

  addPage('OWE Report - Month-wise Actual Annexure');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - Month-wise Actual Annexure',
    head:[['PU','Description'].concat(completedMonthKeys.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)])).concat(['Total Actual','Balance'])],
    body:monthWiseAnnexure,
    styles:{fontSize:10, cellPadding:2.5, overflow:'linebreak'},
    columnStyles:{1:{cellWidth:170}}
  });

  addPage('OWE Report - PU Master Annexure');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - PU Master Annexure',
    head:[['PU','Description','PU Type','Liability','Budget','Actual','Balance','Util %']],
    body:puMasterAnnexure,
    styles:{fontSize:10, cellPadding:2.5, overflow:'linebreak'},
    columnStyles:{1:{cellWidth:210},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'}}
  });

  addPage('OWE Report - Sources and Clarifications');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - Sources and Clarifications',
    head:[['Data Area','FY','Source / File','Used In','Remarks']],
    body:sourceRows,
    styles:{fontSize:10, cellPadding:3, overflow:'linebreak'},
    columnStyles:{2:{cellWidth:210},3:{cellWidth:170},4:{cellWidth:190}}
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    pageTitle:'OWE Report - Sources and Clarifications',
    head:[['Code / Rule','Treatment in Portal','Clarification']],
    body:exclusionRows,
    columnStyles:{2:{cellWidth:440}}
  });

  addPage('OWE Report - Department wise Summary');
  autoTable({
    startY: 58,
    pageTitle:'OWE Report - Department wise Summary',
    head:[['Department','Budget','Actual','Balance']],
    body:smhDept.map(r => [r.name, detailCr(r.budget), detailCr(r.actual), detailCr(r.balance)]),
    columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}}
  });
  autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    pageTitle:'OWE Report - Department wise Summary',
    head:[['Department','Demand','Primary Unit','Budget','Actual','Balance','Status','BP Status']],
    body:smhDetailAnnexure,
    styles:{fontSize:10, cellPadding:2.2, overflow:'linebreak'},
    columnStyles:{0:{cellWidth:120},2:{cellWidth:185},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}
  });
  if (smhNoExpenseAnnexure.length) {
    addPage('OWE Report - Budget Available No Expense');
    autoTable({
      startY: 58,
      pageTitle:'OWE Report - Budget Available No Expense',
      head:[['Department','Demand','Primary Unit','Budget','Remark']],
      body:smhNoExpenseAnnexure,
      styles:{fontSize:10, cellPadding:3, overflow:'linebreak'},
      columnStyles:{2:{cellWidth:260},3:{halign:'right'},4:{cellWidth:230}}
    });
  }

  if (demandAnnexure.length) {
    addPage('OWE Report - Demand wise');
    autoTable({
      startY: 58,
      pageTitle:'OWE Report - Demand wise',
      head:[['Demand wise','DEPT','OBA','BP','AE','Variation','% BP','Budget Remaining','% OBA Utilized']],
      body:demandAnnexure
        .concat([['Total','', detailCr(demandTotals.oba), detailCr(demandTotals.bp), detailCr(demandTotals.ae), signedCr(demandTotals.variation), detailNum(demandTotals.bpPct) + '%', detailCr(demandTotals.budgetRemaining), detailNum(demandTotals.obaUtil) + '%']])
        .concat(demandSuspenseAnnexure),
      styles:{font:'times', fontSize:10, cellPadding:2.5, overflow:'linebreak', minCellHeight:14},
      headStyles:{fillColor:[26,58,106], textColor:[255,255,255], fontStyle:'bold', font:'times', fontSize:10},
      columnStyles:{
        0:{cellWidth:82},
        1:{cellWidth:190},
        2:{cellWidth:70, halign:'right'},
        3:{cellWidth:70, halign:'right'},
        4:{cellWidth:70, halign:'right'},
        5:{cellWidth:74, halign:'right'},
        6:{cellWidth:48, halign:'right'},
        7:{cellWidth:92, halign:'right'},
        8:{cellWidth:64, halign:'right'}
      }
    });
  }

  doc.save(`NR_Zone_${window.NR_SELECTED_SCOPE?.code || "03"}_Report_FY2026-27_${today}.pdf`);
  document.body.dataset.exportStatus = 'pdf-finished';
  } catch (err) {
    console.error('PDF export failed', err);
    document.body.dataset.exportStatus = 'pdf-error';
    showPortalNotice('PDF export failed: ' + (err.message || err), 'err');
  }
}

function pptEscape(value) {
  return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function pptTextShape(id, name, x, y, cx, cy, lines, size=1000, color='203040', bold=false) {
  const paragraphs = lines.map(line => `<a:p><a:r><a:rPr lang="en-IN" sz="${Math.max(1000,size)}" b="${bold?1:0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${pptEscape(line)}</a:t></a:r><a:endParaRPr lang="en-IN" sz="${Math.max(1000,size)}"/></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${pptEscape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function pptSlideXml(title, lines) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Header band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="0A1628"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>${pptTextShape(3,'Title',457200,170000,11277600,600000,[title],2200,'FFFFFF',true)}${pptTextShape(4,'Content',548640,1120000,11094720,5000000,lines,1000,'203040',false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function buildPowerPointBlob(audit) {
  const status = getMonthStatus();
  const actualMonths = status.latestActual ? FY_MONTHS.slice(0, status.latestActual.idx + 1) : status.actualMonths;
  const rows = reportRowsForActivePUs();
  const totals = rows.reduce((t,r) => ({budget:t.budget+r.budget,actual:t.actual+r.actual,balance:t.balance+r.balance}), {budget:0,actual:0,balance:0});
  const top = rows.slice().sort((a,b)=>b.utilPct-a.utilPct).slice(0,10);
  const xsPptMode = getBPModeStatus();
  const xsPptLabel = xsPptMode.bpThrough ? `${xsPptMode.bpThrough.label} ${xsPptMode.bpThrough.year}` : 'completed month';
  const xsPptTop = buildExcessShortfallRows().filter(r => r.hqIndex >= 0).sort((a,b) => b.varianceCurrent - a.varianceCurrent).slice(0,8);
  const slides = [
    ['Ordinary Working Expenses (OWE) Portal - Fresh Export', [`Financial Year 2026-27 | ${window.nrScopeLabel()}`,`Generated: ${indianDateTime(audit.generatedAt)}`,`Actual data through: ${audit.latestMonth}`,`Validation ID: ${audit.id}`,`Rule: live data reconciled before export; minimum font 10 pt; all content within 0.5 inch margins.`]],
    ['Executive Summary', [`Active expenditure PUs: ${rows.length}`,`Gross budget: ${textCr(totals.budget)}`,`Actual / committed: ${textCr(totals.actual)}`,`Balance: ${textCr(totals.balance)}`,`Utilisation: ${totals.budget ? (totals.actual/totals.budget*100).toFixed(1) : '0.0'}%`]],
    ['Month-wise Actuals', actualMonths.map(month => `${FY_MONTH_LABELS[FY_MONTHS.indexOf(month)]}: ${textCr(rows.reduce((s,r)=>s+(Number((MONTH[r.pu.code]||{})[month])||0),0))}`).concat([`Total actual: ${textCr(totals.actual)}`])],
    ['PU Utilisation - Highest', top.map(r => `PU-${r.pu.code} | ${r.pu.desc.slice(0,46)} | ${r.budget ? r.utilPct.toFixed(1)+'%' : 'No budget'} | Actual ${textCr(r.actual)}`)],
    ['AE vs BP PU Summary', [`Logic: BP = BG / 12 x ${xsPptMode.bpMonthCount}; AE-BP = cumulative actual minus BP.`,`Reporting through: ${xsPptLabel}`,`HQ list: ${HQ_EXCESS_SHORTFALL_PUS.map(code => 'PU-'+code).join(', ')}`].concat(xsPptTop.map(r => `PU-${r.pu.code} | AE ${textCr(r.actualCurrent)} | BP ${textCr(r.bpCurrent)} | Variance ${signedCr(r.varianceCurrent)}`))],
    ['Validation and Fixed Export Rules', audit.checks.map(c => `${c.state.toUpperCase()}: ${c.title} - ${c.detail}`).concat(['Excel: landscape, fit-to-one-page-wide, print margins, minimum 10 pt.','PDF: landscape A4, repeating headers, horizontal page breaks, minimum 10 pt.','PowerPoint: 16:9, 0.5 inch safe margins, minimum 10 pt.','Exports are created on demand from current portal memory; old downloaded files are not reused.'])]
  ];
  const enc = new TextEncoder();
  const entry = (name, xml) => {
    // OOXML colour maps reference scheme slots, not RGB literals. Office also
    // requires layout IDs >= 2^31 and three entries in each theme style list.
    if (name === 'ppt/slideMasters/slideMaster1.xml') {
      xml = xml.replace(/accent([1-6])="[0-9A-F]{6}"/g, 'accent$1="accent$1"')
        .replace('<p:sldLayoutId id="1"', '<p:sldLayoutId id="2147483649"');
    }
    if (name === 'ppt/theme/theme1.xml') {
      for (const tag of ['fillStyleLst','lnStyleLst','effectStyleLst','bgFillStyleLst']) {
        xml = xml.replace(new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`), (_, style) => `<a:${tag}>${style.repeat(3)}</a:${tag}>`);
      }
    }
    return {name, bytes:enc.encode(xml)};
  };
  const slideOverrides = slides.map((_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const sldIds = slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join('');
  const presRels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`].concat(slides.map((_,i)=>`<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`)).join('');
  const entries = [
    entry('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`),
    entry('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    entry('docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Ordinary Working Expenses (OWE) Portal Fresh Report</dc:title><dc:creator>Ordinary Working Expenses (OWE) Portal</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`),
    entry('docProps/app.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Ordinary Working Expenses (OWE) Portal</Application><Slides>${slides.length}</Slides><PresentationFormat>Widescreen</PresentationFormat></Properties>`),
    entry('ppt/presentation.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    entry('ppt/_rels/presentation.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels}</Relationships>`),
    entry('ppt/slideMasters/slideMaster1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="1A3A6A" accent2="1A7A4A" accent3="C9A84C" accent4="607080" accent5="4472C4" accent6="70AD47" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`),
    entry('ppt/slideMasters/_rels/slideMaster1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`),
    entry('ppt/slideLayouts/slideLayout1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
    entry('ppt/slideLayouts/_rels/slideLayout1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`),
    entry('ppt/theme/theme1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Portal"><a:themeElements><a:clrScheme name="Portal"><a:dk1><a:srgbClr val="0A1628"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="203040"/></a:dk2><a:lt2><a:srgbClr val="F3F7FB"/></a:lt2><a:accent1><a:srgbClr val="1A3A6A"/></a:accent1><a:accent2><a:srgbClr val="1A7A4A"/></a:accent2><a:accent3><a:srgbClr val="C9A84C"/></a:accent3><a:accent4><a:srgbClr val="607080"/></a:accent4><a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Portal"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Portal"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`)
  ];
  slides.forEach((slide,i) => {
    entries.push(entry(`ppt/slides/slide${i+1}.xml`,pptSlideXml(slide[0],slide[1])));
    entries.push(entry(`ppt/slides/_rels/slide${i+1}.xml.rels`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`));
  });
  return createZipBlob(entries);
}

function downloadPowerPoint() {
  if (!confirmProtectedExport('PowerPoint export')) return;
  document.body.dataset.exportStatus = 'ppt-started';
  try {
    const audit = prepareFreshExport('PowerPoint');
    const fileDate = new Date().toISOString().slice(0,10);
    saveBlob(buildPowerPointBlob(audit), `NR_Zone_${window.NR_SELECTED_SCOPE?.code || "03"}_FY2026-27_${fileDate}.pptx`);
    document.body.dataset.exportStatus = 'ppt-finished';
  } catch (err) {
    console.error('PowerPoint export failed', err);
    document.body.dataset.exportStatus = 'ppt-error';
    showPortalNotice('PowerPoint export failed: ' + (err.message || err), 'err');
  }
}

window.downloadExcel = downloadExcel;
window.downloadPDFReport = downloadPDFReport;
window.downloadPowerPoint = downloadPowerPoint;
window.downloadHostedUpdatePack = downloadHostedUpdatePack;

function initExportButtons() {
  const excelBtn = document.getElementById('downloadExcelBtn');
  const pdfBtn = document.getElementById('downloadPdfBtn');
  const pptBtn = document.getElementById('downloadPptBtn');
  const backupBtn = document.getElementById('downloadBackupBtn');
  if (excelBtn && !excelBtn.dataset.bound) {
    excelBtn.dataset.bound = '1';
    excelBtn.addEventListener('click', downloadExcel);
  }
  if (pdfBtn && !pdfBtn.dataset.bound) {
    pdfBtn.dataset.bound = '1';
    pdfBtn.addEventListener('click', downloadPDFReport);
  }
  if (pptBtn && !pptBtn.dataset.bound) {
    pptBtn.dataset.bound = '1';
    pptBtn.addEventListener('click', downloadPowerPoint);
  }
  if (backupBtn && !backupBtn.dataset.bound) {
    backupBtn.dataset.bound = '1';
    backupBtn.addEventListener('click', downloadPortalBackup);
  }
}


// ── PU DETAIL PAGE ───────────────────────────────────────────
function openPUDetail(code) {
  const pu   = PU_META.find(p => p.code === code);
  if (!pu) return;
  const cv   = compute(code);
  const md   = MONTH[code] || {};
  const b    = BUDGET[code] || {};
  const {actualMonths, futureMonths, cur} = getMonthStatus();

  // ── Helpers ──────────────────────────────────────────────
  function fCr(n)  { if(!n||n===0) return '-'; return (Math.abs(n)*1000/10000000).toFixed(2)+' Cr'; }
  function fT(n)   { if(!n||n===0) return '-'; return (n<0?'('+Math.abs(Math.round(n)).toLocaleString('en-IN')+')':Math.round(n).toLocaleString('en-IN'))+' Rs\'000s'; }
  function pctStr(cv) {
    if (cv.utilisedFlag==='no-budget') return '<span style="color:#CC0000;font-weight:700">Warning No Budget Allocated - Excess Spend</span>';
    if (cv.utilisedFlag==='none')      return '<span style="color:#aaa">- Nil (no activity)</span>';
    if (cv.utilisedFlag==='over')      return `<span style="color:#CC0000;font-weight:700">${Math.abs(cv.utilisedPct).toFixed(1)}% (OVER BUDGET)</span>`;
    const p = cv.utilisedPct;
    const col = p>85?'#CC0000':p>60?'#E85D04':p>30?'#C07000':'#1A7A4A';
    return `<span style="color:${col};font-weight:700">${p.toFixed(1)}%</span>`;
  }
  const typeCol = pu.puType.includes('Staff PU')&&!pu.puType.includes('Non')?'#1A7A4A':
                  pu.puType.includes('Contractual')?'#9A5A00':'#1C3A5E';

  // ── All 12 FY months ──────────────────────────────────────
  const FY_LABELS=['APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR'];
  const FY_KEYS  =['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
  const curIdx   = FY_KEYS.indexOf(cur.key);
  const monthRows = FY_LABELS.map((lbl,i) => {
    const isPast    = i < curIdx;
    const isCurrent = i === curIdx;
    const isFuture  = i > curIdx;
    const val       = isPast||isCurrent ? (md[FY_KEYS[i]]||0) : Math.round(cv.projPerMonth)||0;
    const valCr     = (Math.abs(val)*1000/10000000).toFixed(2);
    const tag       = isPast?'Actual':isCurrent?'Committed (Till Date)':'Projected';
    const bg        = isCurrent?'#FFF8E0':isFuture?'#F0F6FF':'#FAFAFA';
    const tagCol    = isCurrent?'#8A5A00':isFuture?'#1A4A8A':'#607080';
    const barW      = cv.budget ? Math.min(100, Math.abs(val)/Math.abs(cv.budget/12)*100) : 0;
    const barCol    = isFuture?'#1E6FD9':isCurrent?'#F4A932':'#1C3A5E';
    return `<tr style="background:${bg}">
      <td style="padding:7px 12px;font-weight:700;color:#0A1628;border-bottom:1px solid #E8EFF8">${lbl} ${i<=8?2026:2027}</td>
      <td style="padding:7px 12px;color:${tagCol};font-size:10px;border-bottom:1px solid #E8EFF8"><em>${tag}</em></td>
      <td style="padding:7px 12px;text-align:right;font-family:'Times New Roman',Times,serif;border-bottom:1px solid #E8EFF8">${val?val.toLocaleString('en-IN'):'-'}</td>
      <td style="padding:7px 12px;text-align:right;font-weight:600;border-bottom:1px solid #E8EFF8">${valCr} Cr</td>
      <td style="padding:7px 20px;border-bottom:1px solid #E8EFF8">
        <div style="background:#E8EFF8;border-radius:3px;height:10px;min-width:120px;overflow:hidden">
          <div style="width:${barW}%;height:100%;background:${barCol};border-radius:3px;transition:width .4s"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  // ── Budget breakdown rows ────────────────────────────────
  const completedActualRows = actualMonths.map(month => {
    const idx = FY_MONTHS.indexOf(month);
    return [`${FY_MONTH_LABELS[idx]} ${idx <= 8 ? 2026 : 2027} Actuals`, Number(md[month]) || 0, '#607080'];
  });
  const summaryRows = [
    ['Effective Budget / OBA', getBudget(code), '#0A1628'],
    ['Revised Grant (RG)', b.rg||0, '#1C3A5E'],
    ['Current Budget (Active)', cv.budget, '#1A4E9A'],
    ...completedActualRows,
    [`${cur.label} ${cur.year} Committed`, cv.curCommitted, '#8A5A00'],
    [`${cur.label} Remaining (this month)`, cv.curRemaining, '#1A7A4A'],
    ['Total Committed (Till Date)', cv.totalCommitted, '#1A4E9A'],
    ['Balance Budget', cv.balanceBudget, cv.balanceBudget<0?'#CC0000':'#1A7A4A'],
    [`Projected per Month (${futureMonths.length} months left)`, Math.round(cv.projPerMonth), '#0F5A8A'],
    ['Actuals Till Date (Budget Report)', b.actuals_till||0, '#607080'],
  ].map(([lbl,val,col]) => `<tr>
    <td style="padding:7px 14px;color:#4A6A90;border-bottom:1px solid #EEF2F8;width:55%">${lbl}</td>
    <td style="padding:7px 14px;text-align:right;font-family:'Times New Roman',Times,serif;border-bottom:1px solid #EEF2F8;font-weight:600;color:${col}">${val?(val<0?'('+Math.abs(Math.round(val)).toLocaleString('en-IN')+')':Math.round(val).toLocaleString('en-IN')):'-'}</td>
    <td style="padding:7px 14px;text-align:right;border-bottom:1px solid #EEF2F8;color:${col};font-weight:700">${fCr(val)}</td>
  </tr>`).join('');

  // ── Build full HTML page ──────────────────────────────────
  const pctVal = cv.utilisedPct!==null ? Math.min(100,Math.abs(cv.utilisedPct)) : 0;
  const ringCol = cv.utilisedFlag==='over'||cv.utilisedFlag==='no-budget'?'#CC0000':
                  cv.utilisedPct>85?'#E85D04':cv.utilisedPct>60?'#C07000':'#1A7A4A';
  const r=54, circ=2*Math.PI*r, dash=(pctVal/100)*circ;
  const pctLabel = cv.utilisedFlag==='no-budget'?'No Budget':
                   cv.utilisedFlag==='none'?'0%':Math.abs(cv.utilisedPct).toFixed(1)+'%';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PU-${pu.code} - ${pu.desc} | Ordinary Working Expenses (OWE) Portal</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#F0F4FA;color:#0A1628;font-size:13px}
  .page-hdr{background:linear-gradient(135deg,#0A1628 0%,#1A3A6A 100%);color:#fff;padding:16px 32px;display:flex;align-items:center;gap:16px;border-bottom:3px solid #C9A84C}
  .pu-num{font-size:36px;font-weight:800;color:#C9A84C;line-height:1}
  .pu-info h1{font-size:18px;font-weight:700;color:#fff}
  .pu-info p{font-size:11px;color:#A8C0D8;margin-top:3px}
  .badges{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  .pbadge{font-size:10px;font-weight:700;padding:3px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.3);color:#fff}
  .print-tools{margin-left:auto;position:relative;min-width:98px}
  .print-tools summary{list-style:none;background:#C9A84C;color:#0A1628;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:800;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.18)}
  .print-tools summary::-webkit-details-marker{display:none}
  .print-tools summary:hover{background:#E8C050}
  .print-menu{position:absolute;right:0;top:34px;z-index:20;background:#fff;border:1px solid #D8E5F2;border-radius:8px;box-shadow:0 10px 24px rgba(10,22,40,.20);padding:6px;display:grid;gap:5px;min-width:170px}
  .print-menu button{border:0;border-radius:6px;background:#F4F8FE;color:#0A1628;padding:8px 10px;text-align:left;cursor:pointer;font-size:11px;font-weight:800}
  .print-menu button:hover{background:#E8F0FF}
  .print-menu small{display:block;color:#607080;font-size:9px;font-weight:600;margin-top:1px}
  .section{background:#fff;border-radius:8px;padding:20px 24px;margin:16px 24px;box-shadow:0 2px 10px rgba(10,22,40,.08);border:1px solid #E0EAF4}
  .sec-title{font-size:13px;font-weight:700;color:#1C3A5E;border-bottom:2px solid #E0EAF4;padding-bottom:8px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .kpi{background:#F5F8FC;border-radius:6px;padding:14px 16px;border-left:3px solid ${typeCol}}
  .kpi-lbl{font-size:10px;color:#607080;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
  .kpi-val{font-size:18px;font-weight:700;color:#0A1628;margin:4px 0 2px}
  .kpi-sub{font-size:10px;color:#607080}
  .ring-wrap{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
  .ring-info{flex:1;min-width:200px}
  .ring-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #EEF2F8;font-size:12px}
  .ring-row:last-child{border-bottom:none}
  .ring-row .lbl{color:#607080}
  .ring-row .val{font-weight:700;color:#0A1628}
  table.data-tbl{width:100%;border-collapse:collapse;font-family:'Times New Roman',Times,serif}
  table.data-tbl th,table.data-tbl td{font-family:'Times New Roman',Times,serif}
  table.data-tbl thead tr{background:#1A3A6A}
  table.data-tbl thead th{padding:8px 12px;color:#B8D0F0;font-size:10px;font-weight:600;text-align:left;letter-spacing:.3px;text-transform:uppercase}
  table.data-tbl thead th.r{text-align:right}
  footer{text-align:center;padding:16px;font-size:10px;color:#8AAAC8;border-top:1px solid #E0EAF4;margin-top:8px}
  @page{size:A4 landscape;margin:10mm}
  @media print{
    body{background:#fff;font-size:10px}
    .print-tools{display:none}
    .page-hdr{padding:10px 16px;border-bottom:2px solid #C9A84C}
    .pu-num{font-size:28px}
    .pu-info h1{font-size:15px}
    .pu-info p{font-size:10pt}
    .section{box-shadow:none;border:1px solid #CBD7E5;margin:8px 10px;padding:10px 12px;break-inside:avoid}
    .sec-title{font-size:11px;margin-bottom:8px;padding-bottom:5px}
    .kpi-grid{grid-template-columns:repeat(3,1fr);gap:6px}
    .kpi{padding:8px 9px}
    .kpi-val{font-size:13px}
    .kpi-lbl,.kpi-sub{font-size:10pt}
    .ring-wrap{gap:14px}
    .ring-wrap svg{width:100px;height:100px}
    table.data-tbl{table-layout:fixed;width:100%}
    table.data-tbl thead th{font-size:10pt;padding:5px 7px;overflow-wrap:anywhere}
    table.data-tbl td{font-size:10pt!important;padding:5px 7px!important;overflow-wrap:anywhere}
    footer{font-size:10pt;padding:8px}
    body.print-one .print-detail{display:none!important}
    body.print-one .section{margin:7px 10px;padding:9px 11px}
    body.print-two .print-page-2{break-before:page;page-break-before:always}
  }
</style>
<script>
  function setPrintMode(mode){
    document.body.classList.remove('print-one','print-two');
    document.body.classList.add(mode === 'one' ? 'print-one' : 'print-two');
    document.documentElement.setAttribute('data-print-mode', mode);
    setTimeout(function(){ window.print(); }, 80);
  }
</script>
</head>
<body>
<div class="page-hdr">
  <div class="pu-num">PU-${pu.code}</div>
  <div class="pu-info">
    <h1>${pu.desc}</h1>
    <p>NR Zone / Northern Railway  -  FY 2026-27  -  All figures in Rs '000s</p>
    <div class="badges">
      <span class="pbadge" style="background:${typeCol}">${pu.puType}</span>
      <span class="pbadge" style="background:${pu.liab==='Committed'?'#1A7A4A':pu.liab==='Recovery'?'#8B0000':'#4A6A90'}">${pu.liab}</span>
      <span class="pbadge" style="background:#8A5A00">${cur.label} ${cur.year} - Active Month</span>
    </div>
  </div>
  <details class="print-tools">
    <summary>Print/PDF</summary>
    <div class="print-menu">
      <button type="button" onclick="setPrintMode('one')">1 Page Summary<small>KPI and utilisation view</small></button>
      <button type="button" onclick="setPrintMode('two')">2 Page Detail<small>Summary + table pages</small></button>
      <button type="button" onclick="window.print()">Normal Print<small>Full visible page</small></button>
    </div>
  </details>
</div>

<!-- KPI CARDS -->
<div class="section print-summary">
  <div class="sec-title">Key Performance Indicators</div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-lbl">Effective Budget / OBA</div><div class="kpi-val">${fCr(getBudget(code))}</div><div class="kpi-sub">${getBudget(code).toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="kpi"><div class="kpi-lbl">Total Committed</div><div class="kpi-val" style="color:${typeCol}">${fCr(cv.totalCommitted)}</div><div class="kpi-sub">${cv.totalCommitted.toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="kpi"><div class="kpi-lbl">Balance Budget</div><div class="kpi-val" style="color:${cv.balanceBudget<0?'#CC0000':'#1A7A4A'}">${fCr(cv.balanceBudget)}</div><div class="kpi-sub">${cv.balanceBudget.toLocaleString('en-IN')} Rs'000s</div></div>
    <div class="kpi"><div class="kpi-lbl">% Budget Used</div><div class="kpi-val" style="color:${ringCol}">${pctLabel}</div><div class="kpi-sub">${pctStr(cv)}</div></div>
    <div class="kpi"><div class="kpi-lbl">Projected / Month</div><div class="kpi-val" style="color:#1A4E9A">${fCr(cv.projPerMonth)}</div><div class="kpi-sub">${futureMonths.length} months remaining</div></div>
    <div class="kpi"><div class="kpi-lbl">${cur.label} Committed</div><div class="kpi-val" style="color:#8A5A00">${fCr(cv.curCommitted)}</div><div class="kpi-sub">Remaining: ${fCr(cv.curRemaining)}</div></div>
  </div>
</div>

<!-- UTILISATION RING -->
<div class="section print-summary">
  <div class="sec-title">Budget Utilisation</div>
  <div class="ring-wrap">
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="#E8EFF8" stroke-width="14"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${ringCol}" stroke-width="14"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
        stroke-dashoffset="${(circ/4).toFixed(1)}" stroke-linecap="round"/>
      <text x="70" y="65" text-anchor="middle" font-size="20" font-weight="800" fill="${ringCol}">${pctLabel}</text>
      <text x="70" y="82" text-anchor="middle" font-size="10" fill="#607080">Utilised</text>
    </svg>
    <div class="ring-info">
      <div class="ring-row"><span class="lbl">Effective Budget / OBA</span><span class="val">${fCr(getBudget(code))}</span></div>
      ${actualMonths.map(month => {
        const idx = FY_MONTHS.indexOf(month);
        return `<div class="ring-row"><span class="lbl">${FY_MONTH_LABELS[idx]} Actuals</span><span class="val">${fCr(Number(md[month]) || 0)}</span></div>`;
      }).join('')}
      <div class="ring-row"><span class="lbl">${cur.label} Committed</span><span class="val">${fCr(cv.curCommitted)}</span></div>
      <div class="ring-row"><span class="lbl">Total Committed</span><span class="val" style="color:${typeCol}">${fCr(cv.totalCommitted)}</span></div>
      <div class="ring-row"><span class="lbl">Balance</span><span class="val" style="color:${cv.balanceBudget<0?'#CC0000':'#1A7A4A'}">${fCr(cv.balanceBudget)}</span></div>
    </div>
  </div>
</div>

<!-- BUDGET BREAKDOWN TABLE -->
<div class="section print-detail">
  <div class="sec-title">Budget Breakdown</div>
  <table class="data-tbl">
    <thead><tr><th>Parameter</th><th class="r">Rs '000s</th><th class="r">Rs Crore</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
</div>

<!-- MONTHLY PROJECTION TABLE -->
<div class="section print-detail print-page-2">
  <div class="sec-title">Month-wise Actuals & Projections - FY 2026-27</div>
  <table class="data-tbl">
    <thead><tr>
      <th>Month</th><th>Type</th>
      <th class="r">Amount (Rs '000s)</th><th class="r">Amount (Rs Cr)</th>
      <th>vs Monthly Allocation</th>
    </tr></thead>
    <tbody>${monthRows}</tbody>
  </table>
</div>

<footer>
  PU-${pu.code}: ${pu.desc}  -  NR Zone / Northern Railway  -  FY 2026-27  -  For Official Use Only<br>
  Generated: ${new Date().toLocaleString('en-IN')}  -  Ordinary Working Expenses (OWE) Portal v4.0
</footer>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

function isSummaryHoverTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const cell = target.closest('td,th,button,span,strong');
  if (!cell) return false;
  if (target.closest('td.desc,td.pu-desc,td.xs-pu-name,.puc-link,[data-pu-summary]')) return true;
  const tr = target.closest('tr[data-pu]');
  if (!tr) return false;
  const td = target.closest('td');
  if (!td || !tr.contains(td)) return false;
  const cells = Array.from(tr.children).filter(el => el.tagName === 'TD');
  const idx = cells.indexOf(td);
  return idx === 0 || idx === 1 || /desc|description|pu/i.test(td.getAttribute('data-label') || '');
}

function selectableReportRow(target) {
  if (!target || !(target instanceof Element)) return null;
  if (target.closest('#puPopup,button,a,input,select,textarea,summary,label')) return null;
  const tr = target.closest('tbody tr');
  if (!tr || tr.closest('thead')) return null;
  if (!tr.closest('.twrap,.smh-table-wrap,.demand-smh-table-card,.bp-table-wrap,.bc-table-wrap,.pu-master-table-wrap,.xs-scroll,.history-compare-card,.ai-month-table-wrap,.remarks-section,#trendTable')) return null;
  return tr;
}

// ── Event delegation: popup on description hover, yellow row select on click ──────────
document.addEventListener('mouseover', function(e){
  if (e.target.closest('#puPopup')) return;
  if (!isSummaryHoverTarget(e.target)) return;
  const tr = e.target.closest('tr[data-pu]');
  if (!tr) return;
  clearTimeout(_ppTimer);
  showPUPopup(e, tr.dataset.pu);
});
document.addEventListener('mouseout', function(e){
  if (e.target.closest('#puPopup')) return;
  if (!isSummaryHoverTarget(e.target)) return;
  const tr = e.target.closest('tr[data-pu]');
  if (!tr) return;
  if (!tr.contains(e.relatedTarget) && !_pp.contains(e.relatedTarget)) hidePUPopup();
});
document.addEventListener('click', function(e){
  if (e.target.closest('#puPopup')) return;
  const row = selectableReportRow(e.target);
  if (!row) return;
  const table = row.closest('table');
  if (table) table.querySelectorAll('tr.row-selected,tr.report-row-selected').forEach(r => {
    if (r !== row) r.classList.remove('row-selected','report-row-selected');
  });
  row.classList.toggle('row-selected');
  if (row.dataset.pu && isSummaryHoverTarget(e.target)) {
    clearTimeout(_ppTimer);
    showPUPopup(e, row.dataset.pu);
  }
});

// Live clock
(function tick(){
  const el=document.getElementById('liveClock');
  if(el) el.textContent=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  setTimeout(tick,1000);
})();

// Dual scroll sync
function addDualScroll(){
  document.querySelectorAll('.twrap').forEach(wrap=>{
    if(wrap.dataset.ds) return; wrap.dataset.ds='1';
    const top=document.createElement('div'); top.className='scroll-top';
    const inner=document.createElement('div'); top.appendChild(inner); inner.style.height='1px';
    wrap.parentNode.insertBefore(top,wrap);
    function syncW(){ const t=wrap.querySelector('table'); if(t) inner.style.width=t.scrollWidth+'px'; }
    syncW(); top.addEventListener('scroll',()=>wrap.scrollLeft=top.scrollLeft);
    wrap.addEventListener('scroll',()=>top.scrollLeft=wrap.scrollLeft);
    try {
      if (window.ResizeObserver && wrap instanceof Element) {
        new ResizeObserver(syncW).observe(wrap);
      }
    } catch (e) {
      setTimeout(syncW, 200);
    }
  });
}


let currentPopupCode=null;
function showPUPopup(e,code){
  initPopup(); // ensure _pp exists
  currentPopupCode=code;
  clearTimeout(_ppTimer);
  const pu=PU_META.find(p=>p.code===code); if(!pu) return;
  const cv=compute(code); const md=MONTH[code]||{};
  const {actualMonths,futureMonths}=getMonthStatus();
  const pctVal=cv.utilisedPct!=null?Math.abs(cv.utilisedPct):0;
  const pctStr=cv.utilisedFlag==='no-budget'?'No Budget':cv.utilisedFlag==='none'?'Nil':pctVal.toFixed(1)+'%';
  const col=cv.utilisedFlag==='over'||cv.utilisedFlag==='no-budget'?'#CC0000':pctVal>85?'#E85D04':pctVal>60?'#C07000':'#1A7A4A';
  const r=22,circ=2*Math.PI*r,dash=(Math.min(100,pctVal)/100)*circ;
  const vals=actualMonths.map(month => Number(md[month]) || 0);
  const maxV=Math.max(...vals,cv.projPerMonth,1);
  const bars=actualMonths.map((month,i)=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
      <div style="font-size:10px;color:#607080;width:36px">${FY_MONTH_LABELS[FY_MONTHS.indexOf(month)]}</div>
      <div style="flex:1;background:#EDF1F7;border-radius:2px;height:7px;overflow:hidden">
        <div style="width:${Math.min(100,Math.abs(vals[i])/Math.abs(maxV)*100)}%;height:100%;background:#1C3A5E;border-radius:2px"></div>
      </div>
      <div style="font-size:10px;width:62px;text-align:right;font-family:'Times New Roman',Times,serif">${vals[i]?vals[i].toLocaleString('en-IN'):'-'}</div>
    </div>`).join('') || '<div style="font-size:9px;color:#607080">No completed-month actuals loaded.</div>';
  const projBar=`<div style="display:flex;align-items:center;gap:6px">
    <div style="font-size:10px;color:#607080;width:36px">Proj</div>
    <div style="flex:1;background:#EDF1F7;border-radius:2px;height:7px;overflow:hidden">
      <div style="width:${Math.min(100,cv.projPerMonth/maxV*100)}%;height:100%;background:#0FBCB0;border-radius:2px"></div>
    </div>
    <div style="font-size:10px;width:62px;text-align:right;font-family:'Times New Roman',Times,serif">${cv.projPerMonth>0?Math.round(cv.projPerMonth).toLocaleString('en-IN'):'-'}</div>
  </div>`;
  const typeCol = pu.puType.includes('Staff PU')&&!pu.puType.includes('Non')?'#1A7A4A':pu.puType.includes('Contractual')?'#C07000':'#1C3A5E';
  _pp.innerHTML=`
    <div style="background:${typeCol};padding:8px 14px 7px;display:flex;align-items:center;gap:8px">
      <div style="font-size:15px;font-weight:700;color:#fff;min-width:36px">PU-${pu.code}</div>
      <div><div style="font-size:11px;font-weight:700;color:#fff">${pu.desc}</div><div style="font-size:10px;color:rgba(255,255,255,.75);margin-top:1px">${pu.puType} - ${pu.liab}</div></div>
    </div>
    <div style="padding:12px 14px">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
      <div style="position:relative;width:56px;height:56px;flex-shrink:0">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="#E0EAF4" stroke-width="6"/>
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="${col}" stroke-width="6"
            stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
            stroke-dashoffset="${(circ/4).toFixed(1)}" style="transition:stroke-dasharray .4s"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${col}">${pctStr}</div>
      </div>
      <div style="flex:1;font-size:10px">
        <div style="margin-bottom:3px">Budget: <strong>${cv.budget?(cv.budget*1000/10000000).toFixed(2)+' Cr':'-'}</strong></div>
        <div style="margin-bottom:3px">Committed: <strong>${(cv.totalCommitted*1000/10000000).toFixed(2)} Cr</strong></div>
        <div style="margin-bottom:3px">Balance: <strong style="color:${cv.balanceBudget<0?'#CC0000':'#1A7A4A'}">${(cv.balanceBudget*1000/10000000).toFixed(2)} Cr</strong></div>
        <div>Proj/Mo: <strong>${cv.projPerMonth>0?(cv.projPerMonth*1000/10000000).toFixed(2)+' Cr':'-'}</strong></div>
      </div>
    </div>
    <div style="border-top:1px solid #E0EAF4;padding-top:8px">
      <div style="font-size:10px;color:#607080;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px">Monthly Spend (Rs'000s)</div>
      ${bars}${projBar}
    </div>
    </div>
    <div style="background:#F5F8FC;border-top:1px solid #E0EAF4;padding:6px 14px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;color:#8AAAC8">Quick Summary View</span>
      <span style="font-size:10px;color:#1A7A4A;font-weight:700">Click PU Code cell for Full Details</span>
    </div>
    </div>`;
  const vw=window.innerWidth,vh=window.innerHeight;
  const popupW=Math.min(_pp.offsetWidth||320,Math.max(270,vw-24));
  const popupH=Math.min(_pp.offsetHeight||320,Math.max(120,vh-24));
  let x=e.clientX+14, y=e.clientY+8;
  if(x+popupW>vw-12) x=e.clientX-popupW-14;
  if(y+popupH>vh-12) y=vh-popupH-12;
  x=Math.max(12,Math.min(x,vw-popupW-12));
  y=Math.max(12,Math.min(y,vh-popupH-12));
  _pp.style.left=x+'px'; _pp.style.top=y+'px';
  _pp.style.opacity='1'; _pp.style.transform='translateY(0)'; _pp.style.pointerEvents='auto';
}
function hidePUPopup(){ _ppTimer=setTimeout(()=>{_pp.style.opacity='0';_pp.style.transform='translateY(6px)';_pp.style.pointerEvents='none';},200); }
function attachPUPopup(){
  initPopup();
  // Using event delegation on document - works after every re-render, no re-binding needed
  // (listeners are only added once)
}

// ══════════════════════════════════════════════════════════════════
// UPLOAD TAB - File parsing, auto-sense, apply
// ══════════════════════════════════════════════════════════════════

let _syncedBudgetManifest = null;
let _syncedBudgetRoleFiles = [];
let _syncedParseRunning = false;
const SYNCED_BUDGET_ROLE_MAP = Object.freeze({
  'pu-budget.xls': {type:'budget', year:'cy', label:'Budget Available CY'},
  'pu-month-actual.xls': {type:'month', year:'cy', label:'Month-wise Actual CY'},
  'pu-dept-demand-smh-budget.xls': {type:'smhbudget', year:'cy', label:'Dept / SMH Budget CY'},
  'pu-dept-demand-smh-actual.xls': {type:'smhmonth', year:'cy', label:'Dept / SMH Actual CY'},
  'demand-smh-budget.xls': {type:'demandsmhbudget', year:'cy', label:'Demand / SMH Budget CY'},
  'demand-smh-actual.xls': {type:'demandsmhactual', year:'cy', label:'Demand / SMH Actual CY'}
});

const FOLDER_UPLOAD_ROLE_ORDER = Object.freeze([
  {type:'budget', label:'PU Budget'}, {type:'month', label:'PU Month Actual'},
  {type:'smhbudget', label:'DEPT/SMH Budget'}, {type:'smhmonth', label:'DEPT/SMH Actual'},
  {type:'demandsmhbudget', label:'Demand/SMH Budget'}, {type:'demandsmhactual', label:'Demand/SMH Actual'}
]);

function folderRoleFromName(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const isActual = n.includes('actual') || n.includes('month');
  const isBudget = n.includes('budget') || n.includes('bugdet') || n.includes('bg-isl');
  const isDetail = n.includes('pu-dept') || (n.includes('department') && n.includes('pu'));
  const isDemand = n.includes('demand') && n.includes('smh');
  if (isDetail && isActual) return 'smhmonth';
  if (isDetail && isBudget) return 'smhbudget';
  if (isDemand && !isDetail && isActual) return 'demandsmhactual';
  if (isDemand && !isDetail && isBudget) return 'demandsmhbudget';
  if (n.includes('pu') && isActual) return 'month';
  if (n.includes('pu') && isBudget) return 'budget';
  return '';
}

async function senseFolderFileRole(file) {
  const byName = folderRoleFromName(file.name);
  if (byName) return byName;
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const sample = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', range:0}).slice(0,14)
    .flat().map(v => String(v || '').toUpperCase()).join(' | ');
  const hasDept = sample.includes('DEPARTMENT');
  const hasPU = sample.includes('PUCODE') || sample.includes('PU CODE');
  const hasSMH = sample.includes('SMH') || sample.includes('DEMAND');
  const monthCount = FY_MONTH_LABELS.filter(m => sample.includes(m)).length;
  const hasBudget = sample.includes('BG_ISL') || sample.includes('BG ISL') || sample.includes('BUDGET') || sample.includes('OBA');
  if (hasDept && hasPU && hasSMH) return monthCount >= 3 ? 'smhmonth' : hasBudget ? 'smhbudget' : '';
  if (hasSMH && !hasPU) return monthCount >= 3 || sample.includes('ACTUAL') ? 'demandsmhactual' : hasBudget ? 'demandsmhbudget' : '';
  if (hasPU) return monthCount >= 3 ? 'month' : hasBudget ? 'budget' : '';
  return '';
}

function setFolderUploadStatus(message, state='') {
  const el = document.getElementById('folderUploadStatus');
  if (!el) return;
  el.className = 'folder-upload-status' + (state ? ' ' + state : '');
  el.textContent = message;
}

async function choosePortalDataFolder() {
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin('upload');
    return;
  }
  if (!window.showDirectoryPicker) {
    setFolderUploadStatus('Folder picker is unavailable. Use current Chrome/Edge on localhost, or use the six individual upload boxes.', 'err');
    return;
  }
  const btn = document.getElementById('chooseDataFolderBtn');
  const list = document.getElementById('folderUploadFiles');
  try {
    if (btn) btn.disabled = true;
    setFolderUploadStatus('Waiting for folder selection...', 'loading');
    const directory = await window.showDirectoryPicker({id:'mbrlr-data-folder', mode:'read'});
    const detected = new Map();
    const ignored = [];
    for await (const handle of directory.values()) {
      if (handle.kind !== 'file' || !/\.xlsx?$/i.test(handle.name)) continue;
      const file = await handle.getFile();
      const role = await senseFolderFileRole(file);
      if (!role) { ignored.push(file.name); continue; }
      const existing = detected.get(role);
      if (!existing || file.lastModified > existing.lastModified) detected.set(role, file);
    }
    if (list) list.innerHTML = FOLDER_UPLOAD_ROLE_ORDER.map(role => {
      const file = detected.get(role.type);
      return `<div class="folder-file ${file ? 'ok' : 'err'}"><strong>${htmlSafe(role.label)}</strong><span>${file ? htmlSafe(file.name) : 'Missing report'}</span></div>`;
    }).join('');
    const missing = FOLDER_UPLOAD_ROLE_ORDER.filter(role => !detected.has(role.type));
    if (missing.length) throw new Error(`Missing ${missing.length} report(s): ${missing.map(r => r.label).join(', ')}.${ignored.length ? ` Ignored: ${ignored.join(', ')}` : ''}`);
    setFolderUploadStatus(`Folder "${directory.name}" detected all six reports. Parsing...`, 'loading');
    _pendingBudget = _pendingMonth = _pendingSMHBudget = _pendingSMHMonth = _pendingDemandSMHBudget = _pendingDemandSMHActual = null;
    for (const role of FOLDER_UPLOAD_ROLE_ORDER) {
      const result = await parseUpload(detected.get(role.type), role.type, 'cy');
      if (!result || result.ok === false) throw new Error(`${role.label} could not be parsed${result && result.error ? ': ' + result.error : ''}.`);
    }
    setFolderUploadStatus('All reports parsed. Applying, recalculating and refreshing portal...', 'loading');
    applyUploads();
    const checks = portalValidationChecks();
    const errors = checks.filter(check => check.state === 'err');
    if (errors.length) throw new Error(`Applied, but validation failed: ${errors.map(e => e.title).join(', ')}`);
    const audit = prepareFreshExport('Folder refresh validation');
    setFolderUploadStatus(`Updated successfully from "${directory.name}". Revision ${audit.fingerprint}; data through ${audit.latestMonth}. Excel, PDF and PowerPoint will use this refreshed data.`, 'ok');
    showPortalNotice('Folder data applied and all portal views refreshed.', 'ok');
  } catch (err) {
    if (err && err.name === 'AbortError') setFolderUploadStatus('Folder selection cancelled.', '');
    else {
      console.error('Visual folder upload failed', err);
      setFolderUploadStatus('Folder update failed: ' + (err.message || err), 'err');
      showPortalNotice('Folder update failed: ' + (err.message || err), 'err');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
function setSyncedStatus(message, state){
  const el = document.getElementById('syncedDataStatus');
  if(!el) return;
  el.className = 'synced-status' + (state ? ' ' + state : '');
  el.textContent = message;
}

function hasPendingUploadData() {
  return !!(_pendingBudget || _pendingMonth || _pendingSMHBudget || _pendingSMHMonth || _pendingDemandSMHBudget || _pendingDemandSMHActual || _pendingBudgetPY || _pendingMonthPY);
}

function refreshApplyButtonState() {
  const btn = document.getElementById('applyBtn');
  if (btn) btn.disabled = _syncedParseRunning || !hasPendingUploadData();
}

function renderSyncHealthPanel(manifest=_syncedBudgetManifest) {
  const grid = document.getElementById('syncHealthGrid');
  if (!grid) return;
  const rows = manifest ? syncedFileRows(manifest) : [];
  const roleRows = rows.filter(file => SYNCED_BUDGET_ROLE_MAP[file.name]);
  const selected = manifest ? syncedSelectedSet(manifest) : new Set();
  const selectedRows = roleRows.filter(file => !selected.size || selected.has(file.targetPath));
  const sourceCount = rows.length;
  const processedCount = Array.isArray(manifest && manifest.processedFiles) ? manifest.processedFiles.length : 0;
  const latestModified = rows.map(r => r.modifiedAt).filter(Boolean).sort().pop() || '-';
  const actionLog = Array.isArray(manifest && manifest.actionLog) ? manifest.actionLog : [];
  const lastAction = actionLog[0] || null;
  const items = [
    ['Manifest', manifest ? 'Loaded' : 'Not fetched', manifest ? (manifest.syncedAt || manifest.generatedAt || '-') : 'Fetch synced data'],
    ['FY', (manifest && manifest.financialYear) || '2026-2027', `Build ${ASSET_VERSION}`],
    ['Parse-ready', `${selectedRows.length} file(s)`, `${roleRows.length} matched upload roles`],
    ['Source files', `${sourceCount} listed`, `${processedCount} processed artefact(s)`],
    ['Latest source', latestModified, 'As per sync manifest'],
    ['Last confirmed', (manifest && (manifest.confirmedAt || manifest.syncedAt)) || '-', lastAction ? lastAction.status || 'Action logged' : 'No action log fetched'],
    ['Action log', lastAction ? lastAction.action || 'Repository data refreshed' : '-', lastAction && lastAction.summary ? `Latest month ${lastAction.summary.latestMonth || '-'}` : 'Use Fetch Synced Data'],
    ['Pending apply', hasPendingUploadData() ? 'Ready' : 'None', _syncedParseRunning ? 'Parser running' : 'Parser idle']
  ];
  grid.innerHTML = items.map(([label, value, note]) => `
    <div class="sync-health-item">
      <span>${htmlSafe(label)}</span>
      <strong>${htmlSafe(value)}</strong>
      <em>${htmlSafe(note)}</em>
    </div>`).join('');
}

function portalValidationChecks() {
  const checks = [];
  const activeCodes = activePUMeta().map(p => p.code).filter(code => BUDGET[code]);
  const budgetTotal = activeCodes.reduce((sum, code) => sum + getBudget(code), 0);
  const actualTotal = activeCodes.reduce((sum, code) => sum + (Number((BUDGET[code] || {}).actuals_till) || 0), 0);
  checks.push({
    state: window.NR_ZONE_DATA ? (activeCodes.length ? 'ok' : 'warn') : (budgetTotal > 0 ? 'ok' : 'err'),
    title: 'Current year PU budget',
    detail: (window.NR_ZONE_DATA || budgetTotal > 0) ? `${activeCodes.length} active PUs, ${textCr(budgetTotal)} gross budget, ${textCr(actualTotal)} actual till date.` : 'No active PU budget total found.'
  });
  const monthMismatchCodes = activeCodes.filter(code => {
    if (!MONTH[code]) return false;
    return Math.abs((Number((BUDGET[code] || {}).actuals_till) || 0) - sumMonthValues(MONTH[code])) > 0.5;
  });
  checks.push({
    state: monthMismatchCodes.length ? 'err' : 'ok',
    title: 'PU actual/month reconciliation',
    detail: monthMismatchCodes.length ? `Mismatch in ${monthMismatchCodes.length} PU(s): ${monthMismatchCodes.slice(0,12).join(', ')}.` : 'Every loaded PU actual-till value equals the sum of its actual month values.'
  });
  const budgetGrand = Object.keys(BUDGET).filter(code => code !== 'TOTAL').reduce((sum, code) => sum + (Number(BUDGET[code].bg_isl) || 0), 0);
  const monthGrand = Object.keys(MONTH).filter(code => code !== 'TOTAL').reduce((sum, code) => sum + sumMonthValues(MONTH[code]), 0);
  const totalMismatch = Math.abs(budgetGrand - (Number((BUDGET.TOTAL || {}).bg_isl) || 0)) > 0.5 ||
    Math.abs(monthGrand - sumMonthValues(MONTH.TOTAL || {})) > 0.5;
  checks.push({
    state: totalMismatch ? 'err' : 'ok',
    title: 'Grand-total reconciliation',
    detail: totalMismatch ? 'Stored total rows do not reconcile with PU rows.' : 'Budget and month grand totals reconcile with all loaded PU rows.'
  });
  const monthStatus = getMonthStatus();
  const monthRows = activeCodes.filter(code => MONTH[code] && monthStatus.actualMonths.some(m => Number(MONTH[code][m]) || 0));
  checks.push({
    state: monthRows.length ? 'ok' : 'warn',
    title: 'Month-wise CY actuals',
    detail: monthRows.length ? `${monthRows.length} active PUs have actuals through ${monthStatus.latestActual ? monthStatus.latestActual.label + ' ' + monthStatus.latestActual.year : 'latest completed month'}.` : 'No month-wise actual rows detected for active PUs.'
  });
  const demandRows = recalcDemandSMHRows(demandSMHRows(), getBPModeStatus().bpMonthCount);
  const demandOps = demandRows.filter(r => !isDemandSMHSuspense(r));
  const suspenseRows = demandRows.filter(isDemandSMHSuspense);
  const demandTotals = demandSMHTotals(demandOps);
  checks.push({
    state: demandOps.length ? 'ok' : 'warn',
    title: 'Demand / SMH Summary',
    detail: demandOps.length ? `${demandOps.length} main rows, ${textCr(demandTotals.oba)} OBA/BG_ISL; ${suspenseRows.length ? 'Suspense kept separate.' : 'No suspense row detected.'}` : 'Demand / SMH rows are not loaded.'
  });
  const detailRows = (window.DETAIL_SMH_DATA && Array.isArray(window.DETAIL_SMH_DATA.rows)) ? window.DETAIL_SMH_DATA.rows : [];
  const detailBudget = detailRows.reduce((sum, row) => sum + (Number(row.budget) || 0), 0);
  checks.push({
    state: detailRows.length ? 'ok' : 'warn',
    title: 'Department wise detail',
    detail: detailRows.length ? `${detailRows.length} detail rows available, ${textCr(detailBudget)} detail budget.` : 'Department > SMH > PU detail data is not loaded.'
  });
  checks.push({
    state: 'ok',
    title: 'Display exclusions',
    detail: 'PU-98 recoveries and PU-72/73/74/75 remain excluded. Zone department 00 is retained as Unassigned; AU department 00 remains excluded.'
  });
  return checks;
}

function runPortalValidation() {
  const resultBox = document.getElementById('validationResults');
  const checks = portalValidationChecks();
  const bad = checks.filter(c => c.state === 'err').length;
  const warn = checks.filter(c => c.state === 'warn').length;
  if (resultBox) {
    resultBox.className = 'validation-results ' + (bad ? 'err' : warn ? 'warn' : 'ok');
    resultBox.innerHTML = checks.map(c => `
      <div class="validation-row ${c.state}">
        <strong>${htmlSafe(c.title)}</strong>
        <span>${htmlSafe(c.detail)}</span>
      </div>`).join('');
  }
  renderSyncHealthPanel();
  showPortalNotice(bad ? 'Validation found blocking data issue.' : warn ? 'Validation complete with warning(s).' : 'Validation complete. Data checks passed.', bad ? 'err' : warn ? 'warn' : 'ok');
  return checks;
}

function syncedFileRows(manifest){
  const rows = [];
  ['sourceFiles','processedFiles','frFiles'].forEach(group => {
    (manifest[group] || []).forEach(file => rows.push({...file, group}));
  });
  return rows;
}
function syncedSelectedSet(manifest){
  return new Set((manifest.selectedTargets || (manifest.copied || []).map(item => item.target)).filter(Boolean));
}
function renderSyncedDataList(manifest){
  const box = document.getElementById('syncedDataList');
  if(!box) return;
  const selected = syncedSelectedSet(manifest);
  const rows = syncedFileRows(manifest).filter(file => !selected.size || selected.has(file.targetPath));
  if(!rows.length){
    box.innerHTML = '<div class="upload-confirm-empty">No synced files found in manifest.</div>';
    return;
  }
  box.innerHTML = `<table><thead><tr><th>Use</th><th>File</th><th>Synced Path</th><th>Modified</th><th>Status</th></tr></thead><tbody>${rows.map(file => {
    const role = SYNCED_BUDGET_ROLE_MAP[file.name];
    const canParse = !!role;
    return `<tr><td>${role ? `<span class="synced-role">${role.label}</span>` : '<span style="color:#8AAAC8">Reference</span>'}</td><td><strong>${file.name}</strong></td><td><code>${file.targetPath}</code></td><td>${file.modifiedAt || '-'}</td><td>${canParse ? '<span class="log-dot ok"></span>Ready to parse' : 'Fetched for reference'}</td></tr>`;
  }).join('')}</tbody></table>`;
}
async function fetchSyncedBudgetData(){
  if(window.NR_ZONE_DATA){showPortalNotice('Run SYNC-NR-ZONE-LOCAL.bat to refresh all NR Zone/AU files.', 'warn');return;}
  if(!isUploadAdminUnlocked()){
    requestUploadAdmin('upload');
    return;
  }
  setSyncedStatus('Fetching MB-BUDGET sync manifest...', 'warn');
  const btn = document.getElementById('senseSyncedBtn');
  if(btn) btn.disabled = true;
  try{
    const response = await fetch(`data/mb-budget-sync/sync-manifest.json?v=${Date.now()}`, {cache:'no-store'});
    if(!response.ok) throw new Error('No sync-manifest.json found. First sync selected files from MB-BUDGET Admin Portal.');
    const manifest = await response.json();
    _syncedBudgetManifest = manifest;
    const selected = syncedSelectedSet(manifest);
    _syncedBudgetRoleFiles = syncedFileRows(manifest).filter(file => SYNCED_BUDGET_ROLE_MAP[file.name] && (!selected.size || selected.has(file.targetPath)));
    renderSyncedDataList(manifest);
    renderSyncHealthPanel(manifest);
    const syncedAt = manifest.syncedAt || manifest.generatedAt || 'unknown time';
    const year = manifest.financialYear || 'current year';
    const note = _syncedBudgetRoleFiles.length
      ? `Fetched ${_syncedBudgetRoleFiles.length} parse-ready file(s) for ${year}. Last sync: ${syncedAt}. Review, tick Manual OK if required, then Sense / Parse.`
      : `Manifest fetched for ${year}, but no parse-ready XLS files are selected in sync. Sync raw current-year source files from MB-BUDGET.`;
    setSyncedStatus(note, _syncedBudgetRoleFiles.length ? 'ok' : 'warn');
    if(btn) btn.disabled = !_syncedBudgetRoleFiles.length;
  }catch(error){
    _syncedBudgetManifest = null;
    _syncedBudgetRoleFiles = [];
    renderSyncedDataList({sourceFiles:[],processedFiles:[],frFiles:[]});
    renderSyncHealthPanel(null);
    setSyncedStatus(error.message || 'Unable to fetch synced data.', 'err');
  }
}
async function senseAndParseSyncedData(){
  if(!isUploadAdminUnlocked()){
    requestUploadAdmin('upload');
    return;
  }
  if(!_syncedBudgetRoleFiles.length){
    setSyncedStatus('Fetch synced data first, then sense/parse.', 'warn');
    return;
  }
  const manualOk = document.getElementById('syncedManualOk');
  if(manualOk && !manualOk.checked){
    setSyncedStatus('Review fetched file list and tick Manual OK after review before parsing.', 'warn');
    return;
  }
  _syncedParseRunning = true;
  refreshApplyButtonState();
  const senseBtn = document.getElementById('senseSyncedBtn');
  const fetchBtn = document.getElementById('fetchSyncedBtn');
  if(senseBtn) senseBtn.disabled = true;
  if(fetchBtn) fetchBtn.disabled = true;
  setSyncedStatus(`Parsing ${_syncedBudgetRoleFiles.length} synced file(s). Apply will unlock after parsing finishes...`, 'warn');
  let okCount = 0;
  let failCount = 0;
  for(const fileInfo of _syncedBudgetRoleFiles){
    const role = SYNCED_BUDGET_ROLE_MAP[fileInfo.name];
    try{
      const response = await fetch(`${fileInfo.targetPath}?v=${Date.now()}`, {cache:'no-store'});
      if(!response.ok) throw new Error(`Cannot fetch ${fileInfo.targetPath}`);
      const blob = await response.blob();
      const file = new File([blob], `Synced-${fileInfo.name}`, {type: blob.type || 'application/vnd.ms-excel', lastModified: Date.now()});
      const result = await parseUpload(file, role.type, role.year);
      if(result && result.ok) okCount++;
      else failCount++;
    }catch(error){
      failCount++;
      setDZState(`${role.type}-${role.year}`, 'error', error.message || 'Synced file fetch failed');
    }
  }
  _syncedParseRunning = false;
  if(senseBtn) senseBtn.disabled = !_syncedBudgetRoleFiles.length;
  if(fetchBtn) fetchBtn.disabled = false;
  const btn = document.getElementById('applyBtn');
  if(btn) btn.textContent = 'OK Apply Synced Parsed Data & Refresh Portal';
  refreshApplyButtonState();
  renderSyncHealthPanel();
  setSyncedStatus(
    failCount
      ? `Parsed ${okCount} file(s), ${failCount} file(s) need attention. Apply is available only for successfully parsed data.`
      : `Parsed ${okCount} synced file(s). Check green upload cards, then click OK Apply to refresh portal.`,
    failCount ? 'warn' : 'ok'
  );
  showPortalNotice(failCount ? 'Synced parsing completed with warning(s).' : 'Synced parsing completed.', failCount ? 'warn' : 'ok');
}
let _pendingBudget = null;  // parsed budget data waiting to apply
let _pendingMonth  = null;  // parsed month data waiting to apply
let _pendingSMHBudget = null;
let _pendingSMHMonth = null;
let _pendingDemandSMHBudget = null;
let _pendingDemandSMHActual = null;
let _uploadHistory = [];    // log entries

// Drag-and-drop helpers
function dzDrag(e,type){ e.preventDefault(); const el=document.getElementById('dz-'+type); if(el) el.classList.add('drag-over'); }
function dzLeave(type){ const el=document.getElementById('dz-'+type); if(el) el.classList.remove('drag-over'); }
function dzDrop(e,type){
  e.preventDefault(); dzLeave(type);
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin();
    return;
  }
  const file = e.dataTransfer.files[0];
  const parts=type.split('-'), t=parts.slice(0,-1).join('-') || parts[0], yr=(parts[parts.length-1]==='py')?'py':'cy';
  if(file) parseUpload(file, t, yr);
}

function handleFileEx(e, type, year) {
  if (!isUploadAdminUnlocked()) {
    if (e && e.target) e.target.value = '';
    requestUploadAdmin();
    return;
  }
  const file = e.target.files[0];
  if(file) parseUpload(file, type, year||'cy');
}
function handleFile(e, type) { handleFileEx(e, type, 'cy'); }

function setDZState(type, state, msg) {
  const dz   = document.getElementById('dz-'+type);
  const icon = document.getElementById('dz-'+type+'-icon');
  const stat = document.getElementById('dz-'+type+'-status');
  if(!dz||!stat) return;
  dz.classList.remove('done','error','drag-over');
  if(state==='done'){ dz.classList.add('done'); icon.textContent='OK'; stat.className='dz-status ok'; }
  else if(state==='error'){ dz.classList.add('error'); icon.textContent='Error'; stat.className='dz-status err'; }
  else { icon.textContent='...'; stat.className='dz-status'; }
  stat.textContent = msg||'';
  // Enable apply button if at least one pending
  refreshApplyButtonState();
  renderSyncHealthPanel();
}

function smhEmptyMonths() {
  return Object.fromEntries(FY_MONTHS.map(m => [m, 0]));
}

function smhNorm(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function smhNormUpper(value) {
  return smhNorm(value).toUpperCase();
}

function smhDeptParts(value) {
  const raw = smhNorm(value);
  const m = raw.match(/^(\d+)\s*-\s*(.*)$/);
  return m ? {code:m[1], name:m[2].trim()} : {code:raw, name:''};
}

function smhPUParts(value) {
  const raw = smhNorm(value);
  const m = raw.match(/PU\s*-\s*(\d+)\s*-\s*(.*)$/i);
  return m ? {code:m[1].padStart(2,'0'), name:m[2].trim()} : null;
}

function smhKeyFromParts(dept, smh, pu) {
  return `${dept.code}|${dept.name}|${smh}|${pu.code}|${pu.name}`;
}

function parseSMHDetailUpload(rows, kind) {
  function findHdrRow(testFn) {
    for (let i=0; i<Math.min(14, rows.length); i++) {
      if ((rows[i] || []).some(c => testFn(smhNormUpper(c)))) return i;
    }
    return -1;
  }
  const hr = kind === 'budget'
    ? findHdrRow(n => n.includes('BG_ISL') || n.includes('BG ISL'))
    : findHdrRow(n => /^APR(IL)?(\s|$|-|_)/.test(n) || n === 'APR 2026');
  if (hr < 0) throw new Error(kind === 'budget' ? 'Cannot find BG_ISL header in SMH budget file.' : 'Cannot find APR-MAR headers in SMH month-wise file.');
  const hdr = rows[hr].map(c => smhNormUpper(c));
  const deptC = hdr.findIndex(h => h.includes('DEPARTMENTCODE') || h.includes('DEPARTMENT CODE'));
  const smhC = hdr.findIndex(h => h === 'SMH' || h.includes('DEMAND'));
  const puC = hdr.findIndex(h => h === 'PUCODE' || h === 'PU CODE' || h === 'PU');
  if (deptC < 0 || smhC < 0 || puC < 0) throw new Error('Cannot map Department, SMH/Demand and PU columns.');
  const map = {};
  const monthCols = {};
  if (kind === 'budget') {
    var budgetC = hdr.findIndex(h => h.includes('BG_ISL') || h.includes('BG ISL'));
    var rgC = hdr.findIndex(h => /^RG(?:\s|$)/.test(h));
    var actualC = hdr.findIndex(h => h.includes('ACTUALS') && h.includes('2026-2027') && h.includes('TILL DATE'));
    if (actualC < 0) actualC = hdr.reduce((best,h,i) => (h.includes('ACTUALS') && h.includes('TILL') && i > best) ? i : best, -1);
    if (budgetC < 0 || actualC < 0) throw new Error('Cannot map BG_ISL or Actuals Till Date columns.');
  } else {
    FY_MONTHS.forEach((mk, idx) => {
      const ml = FY_MONTH_LABELS[idx].toUpperCase();
      const abbr = mk.toUpperCase();
      const ci = hdr.findIndex(h => h === abbr || h.startsWith(abbr + ' ') || h === ml || h.startsWith(ml + ' '));
      if (ci >= 0) monthCols[mk] = ci;
    });
    if (Object.keys(monthCols).length < 3) throw new Error('Could not map at least 3 month columns.');
  }
  let n = 0;
  for (let i=hr+1; i<rows.length; i++) {
    const row = rows[i] || [];
    const dept = smhDeptParts(row[deptC]);
    const pu = smhPUParts(row[puC]);
    const smh = smhNorm(row[smhC]);
    if (!dept.code || dept.code === '00' || !pu || pu.code === '98' || isSkippedDisplayPU(pu.code) || !smh) continue;
    const key = smhKeyFromParts(dept, smh, pu);
    if (!map[key]) {
      map[key] = {deptCode:dept.code, deptName:dept.name, smh, puCode:pu.code, puName:pu.name, budget:0, actualTill:0, months:smhEmptyMonths()};
    }
    if (kind === 'budget') {
      map[key].budget += (rgC >= 0 ? Number(row[rgC]) : 0) || Number(row[budgetC]) || 0;
      map[key].actualTill += Number(row[actualC]) || 0;
    } else {
      FY_MONTHS.forEach(m => { map[key].months[m] += monthCols[m] !== undefined ? (Number(row[monthCols[m]]) || 0) : 0; });
    }
    n++;
  }
  if (n === 0) throw new Error('No SMH detail rows found after excluding Department 00 and PU-98.');
  return {rows:Object.values(map), rowCount:n};
}

function mergeSMHDetailRows(baseRows, updateRows, mode) {
  const map = {};
  (baseRows || []).forEach(r => {
    const key = `${r.deptCode}|${r.deptName}|${r.smh}|${r.puCode}|${r.puName}`;
    map[key] = {...r, months:{...smhEmptyMonths(), ...(r.months || {})}};
  });
  updateRows.forEach(r => {
    const key = `${r.deptCode}|${r.deptName}|${r.smh}|${r.puCode}|${r.puName}`;
    if (!map[key]) map[key] = {...r, budget:0, actualTill:0, months:smhEmptyMonths()};
    if (mode === 'budget') {
      map[key].budget = r.budget;
      map[key].actualTill = r.actualTill;
    } else {
      map[key].months = {...smhEmptyMonths(), ...(r.months || {})};
      const monthTotal = FY_MONTHS.reduce((s,m) => s + (map[key].months[m] || 0), 0);
      if (!map[key].actualTill) map[key].actualTill = monthTotal;
    }
  });
  return Object.values(map);
}

function rebuildSMHDetailTotals() {
  const data = window.DETAIL_SMH_DATA;
  if (!data || !Array.isArray(data.rows)) return;
  const totals = {budget:0, actualTill:0, months:smhEmptyMonths()};
  data.rows.forEach(r => {
    totals.budget += Number(r.budget) || 0;
    totals.actualTill += Number(r.actualTill) || 0;
    FY_MONTHS.forEach(m => { totals.months[m] += Number((r.months || {})[m]) || 0; });
  });
  data.totals = totals;
}

function demandSummaryNorm(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function demandSummaryUpper(value) {
  return demandSummaryNorm(value).toUpperCase();
}

function demandSummaryNumber(value) {
  const n = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeDemandCode(value) {
  const raw = demandSummaryUpper(value);
  if (!raw) return '';
  if (raw.includes('12N') || raw.includes('10N')) return '12N/10N';
  const demandMatch = raw.match(/DEMAND\s*(\d{1,2})/);
  const plain = raw.match(/^(\d{1,2})$/);
  const slash = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2}|10N)/);
  const code = (demandMatch && demandMatch[1]) || (plain && plain[1]) || (slash && slash[1]) || '';
  return code ? code.padStart(2, '0') : '';
}

function normalizeSMHCode(value) {
  const raw = demandSummaryUpper(value);
  if (!raw) return '';
  if (raw.includes('10N')) return '10N';
  const smhMatch = raw.match(/SMH\s*-?\s*(\d{1,2}|10N)/);
  const grantMatch = raw.match(/GRANT\s*-?\s*(\d{1,2}|10N)/);
  const slash = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2}|10N)/);
  const plain = raw.match(/^(\d{1,2})$/);
  const code = (smhMatch && smhMatch[1]) || (grantMatch && grantMatch[1]) || (slash && slash[2]) || (plain && plain[1]) || '';
  return code ? (code.toUpperCase() === '10N' ? '10N' : code.padStart(2, '0')) : '';
}

function demandSmhMetaFor(demand, smh) {
  const baseRows = demandSMHRows();
  const byBoth = baseRows.find(r => String(r.demand || '').trim().toUpperCase() === String(demand || '').trim().toUpperCase() && String(r.smh || '').trim().toUpperCase() === String(smh || '').trim().toUpperCase());
  const bySmh = byBoth || baseRows.find(r => String(r.smh || '').trim().toUpperCase() === String(smh || '').trim().toUpperCase());
  return {
    dept: bySmh && bySmh.dept ? bySmh.dept : '',
    description: bySmh && bySmh.description ? bySmh.description : ''
  };
}

function findDemandSummaryHeader(rows, kind) {
  const limit = Math.min(rows.length, 18);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const cells = row.map(demandSummaryUpper);
    const joined = cells.join(' | ');
    const hasDemand = joined.includes('DEMAND') || joined.includes('SMH') || joined.includes('GRANT');
    const monthHeaderCount = cells.filter(h => FY_MONTHS.some((mk, idx) => {
      const ml = FY_MONTH_LABELS[idx].toUpperCase();
      const abbr = mk.toUpperCase();
      return h === abbr || h.startsWith(abbr + ' ') || h === ml || h.startsWith(ml + ' ');
    })).length;
    const hasBudget = joined.includes('OBA') || joined.includes('BG_ISL') || joined.includes('BG ISL') || joined.includes('BUDGET');
    const hasActual = joined.includes('AE') || joined.includes('ACTUAL') || joined.includes('EXP') || monthHeaderCount >= 3;
    if (hasDemand && (kind === 'budget' ? hasBudget : hasActual)) return i;
  }
  return -1;
}

function parseDemandSMHSummaryUpload(rows, kind) {
  const hr = findDemandSummaryHeader(rows, kind);
  if (hr < 0) throw new Error(kind === 'budget' ? 'Cannot find Demand/SMH budget header.' : 'Cannot find Demand/SMH actual header.');
  const hdr = (rows[hr] || []).map(demandSummaryUpper);
  const demandC = hdr.findIndex(h => h.includes('DEMAND') && !h.includes('/'));
  const smhC = hdr.findIndex(h => h.includes('SMH') || h.includes('GRANT'));
  const comboC = hdr.findIndex(h => h.includes('DEMAND') && (h.includes('SMH') || h.includes('/')));
  const deptC = hdr.findIndex(h => h === 'DEPT' || h.includes('DEPARTMENT'));
  let valueC = -1;
  const rgC = hdr.findIndex(h => /^RG(?:\s|$)/.test(h));
  let bpC = -1;
  const monthCols = {};
  if (kind === 'budget') {
    valueC = hdr.findIndex(h => h.includes('OBA') || h.includes('BG_ISL') || h.includes('BG ISL'));
    if (valueC < 0) valueC = hdr.findIndex(h => h.includes('BUDGET') && !h.includes('REMAIN') && !h.includes('BALANCE') && !h.includes('BP'));
    bpC = hdr.findIndex(h => h === 'BP' || (!h.includes('% BP') && (h.includes('BUDGET PROPORTION') || h.includes('BP UPTO') || h.includes('BP UP TO'))));
  } else {
    FY_MONTHS.forEach((mk, idx) => {
      const ml = FY_MONTH_LABELS[idx].toUpperCase();
      const abbr = mk.toUpperCase();
      const ci = hdr.findIndex(h => h === abbr || h.startsWith(abbr + ' ') || h === ml || h.startsWith(ml + ' '));
      if (ci >= 0) monthCols[mk] = ci;
    });
    valueC = hdr.findIndex(h => h === 'AE' || h.includes('TILL DATE') || h.includes('EXP. TOTAL') || h.includes('EXP TOTAL') || (h.includes('ACTUAL') && h.includes('TOTAL')));
    if (valueC < 0) valueC = hdr.findIndex(h => h.includes('ACTUALS') || h.includes('ACTUAL') || h.includes('EXPENDITURE'));
  }
  if (kind === 'budget' && valueC < 0) throw new Error('Cannot map OBA/BG_ISL/Budget column.');
  if (kind !== 'budget' && Object.keys(monthCols).length < 3 && valueC < 0) throw new Error('Cannot map AE/Actual month columns or total expenditure column.');

  const map = {};
  let n = 0;
  for (let i = hr + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowText = row.map(demandSummaryUpper).join(' ');
    if (!rowText || /^TOTAL\b/.test(rowText) || rowText.includes('GRAND TOTAL')) continue;
    const comboVal = comboC >= 0 ? row[comboC] : row[0];
    let demand = normalizeDemandCode(demandC >= 0 ? row[demandC] : comboVal);
    let smh = normalizeSMHCode(smhC >= 0 ? row[smhC] : comboVal);
    if (!smh && row.length > 1) smh = normalizeSMHCode(row[1]);
    if (!demand && smh) demand = demandNumberForSMH(smh) || '';
    if (!demand || !smh) continue;
    const key = `${demand}|${smh}`;
    const meta = demandSmhMetaFor(demand, smh);
    const deptText = deptC >= 0 ? demandSummaryNorm(row[deptC]) : '';
    if (!map[key]) {
      map[key] = {demand, smh, dept:deptText || meta.dept, description:meta.description, oba:0, ae:0, months:{}};
    }
    if (deptText) map[key].dept = deptText;
    if (!map[key].description) map[key].description = meta.description;
    if (kind === 'budget') map[key].oba += (rgC >= 0 ? demandSummaryNumber(row[rgC]) : 0) || demandSummaryNumber(row[valueC]);
    else if (Object.keys(monthCols).length) {
      FY_MONTHS.forEach(m => {
        const val = monthCols[m] !== undefined ? demandSummaryNumber(row[monthCols[m]]) : 0;
        map[key].months[m] = (Number(map[key].months[m]) || 0) + val;
        map[key].ae += val;
      });
    } else {
      map[key].ae += demandSummaryNumber(row[valueC]);
    }
    n++;
  }
  if (n === 0) throw new Error('No Demand/SMH rows found in uploaded file.');
  return {rows:Object.values(map), rowCount:n};
}

function recalcDemandSMHRows(rows, completedMonths) {
  const mode = getBPModeStatus();
  const months = Number(completedMonths) || mode.bpMonthCount || 3;
  const monthKeys = mode.bpMonths || [];
  return (rows || []).map(row => {
    const oba = Number(row.oba) || 0;
    const totalAe = Number(row.ae) || 0;
    const hasMonthData = row.months && monthKeys.some(key => Object.prototype.hasOwnProperty.call(row.months, key));
    const ae = hasMonthData ? monthKeys.reduce((sum, key) => sum + (Number(row.months[key]) || 0), 0) : totalAe;
    const bp = Math.round(oba / 12 * months);
    const variation = Math.round(ae - bp);
    const budgetRemaining = Math.round(oba - ae);
    const bpPct = bp ? Math.round((ae / bp) * 100) : (ae ? 999 : 0);
    const obaUtil = oba ? Math.round((ae / oba) * 100) : (ae ? 999 : 0);
    return {...row, oba, ae, bp, variation, bpPct, budgetRemaining, obaUtil};
  });
}

function rebuildDemandSMHSummaryFromUploads(budgetUpload, actualUpload) {
  const data = demandSMHData();
  const currentRows = demandSMHRows();
  const map = {};
  const mergeKey = (demand, smh) => {
    const d = String(demand || '').trim().toUpperCase();
    const s = String(smh || '').trim().toUpperCase();
    return (d.includes('12N') || s === '10N') ? '12N/10N|10N' : `${d}|${s}`;
  };
  currentRows.forEach(r => {
    const demand = String(r.demand || '').trim();
    const smh = String(r.smh || '').trim().toUpperCase();
    if (demand && smh) map[mergeKey(demand, smh)] = {...r};
  });
  function mergeRows(upload, mode) {
    if (!upload || !Array.isArray(upload.rows)) return;
    upload.rows.forEach(r => {
      const demand = String(r.demand || '').trim();
      const smh = String(r.smh || '').trim().toUpperCase();
      if (!demand || !smh) return;
      const key = mergeKey(demand, smh);
      const meta = demandSmhMetaFor(demand, smh);
      if (!map[key]) map[key] = {demand, smh, dept:r.dept || meta.dept, description:r.description || meta.description, oba:0, ae:0, months:{}};
      if (r.dept) map[key].dept = r.dept;
      if (r.description) map[key].description = r.description;
      if (!map[key].dept) map[key].dept = meta.dept;
      if (!map[key].description) map[key].description = meta.description;
      map[key].months = {...(map[key].months || {})};
      if (mode === 'budget') {
        map[key].oba = Number(r.oba) || 0;
      } else {
        if (r.months) map[key].months = {...map[key].months, ...r.months};
        map[key].ae = r.months ? FY_MONTHS.reduce((sum, m) => sum + (Number(map[key].months[m]) || 0), 0) : (Number(r.ae) || 0);
      }
    });
  }
  mergeRows(budgetUpload, 'budget');
  mergeRows(actualUpload, 'actual');
  const {latestActual} = getMonthStatus();
  const bpMode = getBPModeStatus();
  const completedMonths = bpMode.bpMonthCount || Number(data.completedMonths) || 3;
  const rows = recalcDemandSMHRows(Object.values(map), completedMonths).sort((a,b) => {
    const as = isDemandSMHSuspense(a), bs = isDemandSMHSuspense(b);
    if (as !== bs) return as ? 1 : -1;
    return String(a.smh).localeCompare(String(b.smh), undefined, {numeric:true});
  });
  const opRows = rows.filter(r => !isDemandSMHSuspense(r));
  const totals = opRows.reduce((t, r) => {
    t.oba += Number(r.oba) || 0;
    t.bp += Number(r.bp) || 0;
    t.ae += Number(r.ae) || 0;
    t.variation += Number(r.variation) || 0;
    t.budgetRemaining += Number(r.budgetRemaining) || 0;
    return t;
  }, {oba:0, bp:0, ae:0, variation:0, budgetRemaining:0});
  totals.bpPct = totals.bp ? Math.round((totals.ae / totals.bp) * 100) : 0;
  totals.obaUtil = totals.oba ? Math.round((totals.ae / totals.oba) * 100) : 0;
  window.DEMAND_SMH_SUMMARY_DATA = {
    ...data,
    fy:data.fy || '2026-2027',
    asOn:latestActual ? `${latestActual.label} ${latestActual.year}` : (data.asOn || 'JUL 2026'),
    completedMonths,
    sourceBudget:budgetUpload && budgetUpload.filename ? budgetUpload.filename : data.sourceBudget,
    sourceActual:actualUpload && actualUpload.filename ? actualUpload.filename : data.sourceActual,
    note:`OBA uses uploaded RG when available, otherwise BG_ISL/OBA. BP always recalculates inside portal as OBA / 12 x ${completedMonths}; imported BP is ignored. AE uses completed month columns only. Demand 12N/10N Suspense Heads is shown separately and is not netted from the main Demand/SMH total.`,
    rows,
    totals
  };
  return window.DEMAND_SMH_SUMMARY_DATA;
}

function demandSMHNeedsMonthHydration() {
  const rows = demandSMHRows();
  if (!rows.length) return false;
  return rows.some(r => {
    const months = r && r.months;
    return !months || !Object.prototype.hasOwnProperty.call(months, 'jun');
  });
}

async function hydrateDemandSMHActualMonthsFromSyncedFile() {
  if(window.NR_ZONE_DATA) return;
  if (!demandSMHNeedsMonthHydration() || !window.XLSX || hydrateDemandSMHActualMonthsFromSyncedFile.running) return;
  hydrateDemandSMHActualMonthsFromSyncedFile.running = true;
  try {
    const response = await fetch('data/mb-budget-sync/source-files/2026-2027/demand-smh-actual.xls', {cache:'no-store'});
    if (!response.ok) throw new Error('Demand/SMH synced actual file not available.');
    const buffer = await response.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:0});
    const parsed = parseDemandSMHSummaryUpload(rows, 'actual');
    rebuildDemandSMHSummaryFromUploads(null, {
      rows: parsed.rows,
      filename: 'demand-smh-actual.xls',
      rowCount: parsed.rowCount,
      at: new Date()
    });
    saveCYUploadState();
    renderDemandSMHSummary();
    renderRemarks();
    refreshBIViewSoon();
  } catch (err) {
    console.warn('Could not hydrate Demand/SMH month-wise actuals', err);
  } finally {
    hydrateDemandSMHActualMonthsFromSyncedFile.running = false;
  }
}

function parseUpload(file, type, year) {
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin();
    return Promise.resolve({ok:false, error:'Admin access required'});
  }
  year = year || 'cy';
  const fileTimestamp = uploadFileTimestamp(file);
  const dzId = type + '-' + year;
  setDZState(dzId, 'loading', 'Reading file...');
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = function(e) {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:0});

      function norm(v){ return String(v==null?'':v).replace(/\s+/g,' ').trim().toUpperCase(); }
      function extractPU(v){
        const s=norm(v); if(!s||s==='PUCODE'||s==='PU CODE'||s==='TOTAL'||s==='GRAND TOTAL') return null;
        let m=s.match(/^PU\s*-?\s*(\d+)/); if(m) return m[1].padStart(2,'0');
        m=s.match(/^(\d{1,2})$/); if(m) return m[1].padStart(2,'0'); return null;
      }
      function findHdrRow(rows,testFn){ for(let i=0;i<Math.min(12,rows.length);i++){if(rows[i].some(c=>testFn(norm(c)))) return i;} return -1; }

      if(type==='demandsmhbudget' || type==='demandsmhactual') {
        if (year !== 'cy') throw new Error('Demand / SMH summary upload is currently for CY 2026-27 only.');
        const parsed = parseDemandSMHSummaryUpload(rows, type === 'demandsmhbudget' ? 'budget' : 'actual');
        if (type === 'demandsmhbudget') {
          _pendingDemandSMHBudget = {rows:parsed.rows, filename:file.name, rowCount:parsed.rowCount, at:new Date()};
          setDZState(dzId,'done','Parsed '+parsed.rowCount+' Demand/SMH budget rows');
          addLog('Demand SMH Budget CY 2026-27', file.name, parsed.rowCount, null);
        } else {
          _pendingDemandSMHActual = {rows:parsed.rows, filename:file.name, rowCount:parsed.rowCount, at:new Date()};
          setDZState(dzId,'done','Parsed '+parsed.rowCount+' Demand/SMH actual rows');
          addLog('Demand SMH Actual CY 2026-27', file.name, parsed.rowCount, getMonthStatus().latestActual ? getMonthStatus().latestActual.label : null);
        }

      } else if(type==='smhbudget' || type==='smhmonth') {
        if (year !== 'cy') throw new Error('SMH detail upload is currently for CY 2026-27 only.');
        const parsed = parseSMHDetailUpload(rows, type === 'smhbudget' ? 'budget' : 'month');
        if (type === 'smhbudget') {
          _pendingSMHBudget = {rows:parsed.rows, filename:file.name, rowCount:parsed.rowCount, at:new Date()};
          setDZState(dzId,'done','Parsed '+parsed.rowCount+' SMH budget rows');
          addLog('SMH Budget CY 2026-27', file.name, parsed.rowCount, null);
        } else {
          _pendingSMHMonth = {rows:parsed.rows, filename:file.name, rowCount:parsed.rowCount, at:new Date()};
          const latestIdx = FY_MONTHS.reduce((best,m,idx) => parsed.rows.some(r => (r.months || {})[m] !== 0) ? idx : best, 0);
          setDZState(dzId,'done','Parsed '+parsed.rowCount+' SMH month rows - Latest: '+FY_MONTH_LABELS[latestIdx]);
          addLog('SMH Month Wise CY 2026-27', file.name, parsed.rowCount, FY_MONTH_LABELS[latestIdx]);
        }

      } else if(type==='budget'){
        const hr=findHdrRow(rows,n=>n.includes('BG_ISL')||n.includes('BG ISL'));
        if(hr<0) throw new Error('Cannot find BG_ISL column header.');
        const hdr=rows[hr].map(c=>norm(c));
        const bgC=hdr.findIndex(h=>h.includes('BG_ISL')||h.includes('BG ISL'));
        const rgC=hdr.findIndex(h=>h==='RG'||h.includes('REVISED GRANT'));
        const atC=hdr.findIndex(h=>h.includes('TILL DATE')||(h.includes('ACTUALS')&&h.includes('TILL')));
        const atC2=atC>=0?atC:hdr.reduce((best,h,i)=>(h.includes('ACTUALS')&&i>best)?i:best,-1);
        const puC=hdr.findIndex(h=>h==='PUCODE'||h==='PU CODE'||h==='PU');
        let parsed={},n=0;
        for(let i=hr+1;i<rows.length;i++){
          const row=rows[i],code=extractPU(row[puC>=0?puC:1]); if(!code) continue;
          parsed[code]={bg_isl:bgC>=0?(Number(row[bgC])||0):0,rg:rgC>=0?(Number(row[rgC])||0):0,actuals_till:atC2>=0?(Number(row[atC2])||0):0};
          n++;
        }
        if(n===0) throw new Error('No PU rows found. Check PUCODE and BG_ISL columns.');
        if(year==='cy'){ _pendingBudget={data:parsed,filename:file.name,puCount:n,at:new Date()}; }
        else           { _pendingBudgetPY={data:parsed,filename:file.name,puCount:n,at:new Date()}; }
        setDZState(dzId,'done','OK Parsed '+n+' PUs - '+(year==='cy'?'CY 2026-27':'PY 2025-26'));
        addLog((year==='cy'?'Budget CY 2026-27':'Budget PY 2025-26'),file.name,n,null);

      } else {
        const APR_RE=/^APR(IL)?[\s\-_]?\d{0,4}$/;
        const ANY_M=/^(APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JAN|FEB|MAR)/;
        let hr=findHdrRow(rows,n=>APR_RE.test(n));
        if(hr<0) hr=findHdrRow(rows,n=>ANY_M.test(n));
        if(hr<0) throw new Error('Cannot find APR-MAR month headers.');
        const hdr=rows[hr].map(c=>norm(c));
        const mCols={};
        FY_MONTHS.forEach((mk,idx2)=>{
          const ml=FY_MONTH_LABELS[idx2];
          const ci=hdr.findIndex(h=>h===ml||h.startsWith(ml+' ')||h.startsWith(ml+'-')||(ml==='APR'&&h==='APRIL'));
          if(ci>=0) mCols[mk]=ci;
        });
        if(Object.keys(mCols).length<3) throw new Error('Could not map at least 3 month columns. Check headers.');
        const puC=hdr.findIndex(h=>h==='PUCODE'||h==='PU CODE'||h==='PU');
        let parsed={},n=0,latestIdx=0;
        for(let i=hr+1;i<rows.length;i++){
          const row=rows[i],code=extractPU(row[puC>=0?puC:1]); if(!code) continue;
          const vals={}; FY_MONTHS.forEach((mk,i2)=>{vals[mk]=mCols[mk]!==undefined?(Number(row[mCols[mk]])||0):0;});
          parsed[code]=vals; n++;
          FY_MONTHS.forEach((mk,i2)=>{if(vals[mk]!==0&&i2>=latestIdx) latestIdx=i2;});
        }
        if(n===0) throw new Error('No PU rows found.');
        const dml=FY_MONTH_LABELS[latestIdx];
        if(year==='cy'){ _pendingMonth={data:parsed,filename:file.name,puCount:n,detectedMonthIdx:latestIdx,detectedMonthKey:FY_MONTHS[latestIdx],detectedMonthLabel:dml,detectedYear:latestIdx<=8?2026:2027,at:new Date()}; }
        else           { _pendingMonthPY={data:parsed,filename:file.name,puCount:n,detectedMonthIdx:latestIdx,at:new Date()}; }
        setDZState(dzId,'done','OK Parsed '+n+' PUs - Latest: '+dml+' | '+(year==='cy'?'CY':'PY'));
        addLog((year==='cy'?'Month Wise CY 2026-27':'Month Wise PY 2025-26'),file.name,n,dml);
      }
      resolve({ok:true, type, year, filename:file.name});
    } catch(err) {
      setDZState(type+'-'+year,'error','Error '+err.message);
      console.error(err);
      resolve({ok:false, type, year, filename:file.name, error:err});
    }
  };
    reader.onerror = function() {
      const err = reader.error || new Error('Unable to read file.');
      setDZState(type+'-'+year,'error','Error '+(err.message || err));
      resolve({ok:false, type, year, filename:file.name, error:err});
    };
    reader.readAsArrayBuffer(file);
  });
}
function addLog(fileType, filename, puCount, monthDetected) {
  _uploadHistory.unshift({
    fileType, filename, puCount, monthDetected,
    at: new Date().toLocaleString('en-IN')
  });
  updateSourceRegisterFromUpload(fileType, filename, puCount, monthDetected);
  renderUploadLog();
}

function updateSourceRegisterFromUpload(fileType, filename, puCount, monthDetected) {
  const key = fileType.includes('Demand SMH Budget') ? 'demandSmhCY'
    : fileType.includes('Demand SMH Actual') ? 'demandSmhCY'
    : fileType.includes('SMH Budget') ? 'smhBudgetCY'
    : fileType.includes('SMH Month') ? 'smhMonthCY'
    : fileType.includes('Budget CY') ? 'budgetCY'
    : fileType.includes('Month Wise CY') ? 'monthCY'
    : fileType.includes('Budget PY') ? 'budgetPY'
    : fileType.includes('Month Wise PY') ? 'monthPY'
    : '';
  if (!key || !SOURCE_REGISTER[key]) return;
  SOURCE_REGISTER[key].source = filename || SOURCE_REGISTER[key].source;
  SOURCE_REGISTER[key].remarks = [
    'Uploaded from IPAS download in this browser session',
    puCount ? `${puCount} rows/PUs parsed` : '',
    monthDetected ? `latest month detected: ${monthDetected}` : ''
  ].filter(Boolean).join('; ');
}

function renderUploadLog() {
  const tbody = document.getElementById('uploadLogTbody');
  if(!tbody) return;
  if(!_uploadHistory.length){
    tbody.innerHTML='<tr><td colspan="6" style="color:#8AAAC8;text-align:center;padding:16px">No uploads yet - using pre-loaded data</td></tr>';
    return;
  }
  tbody.innerHTML = _uploadHistory.map(e=>`
    <tr>
      <td><strong>${e.fileType}</strong></td>
      <td style="font-family:'Times New Roman',Times,serif;font-size:9px">${e.filename}</td>
      <td>${e.at}</td>
      <td>${e.monthDetected||'<span style="color:#aaa">N/A</span>'}</td>
      <td>${e.puCount} PUs</td>
      <td><span class="log-dot ok"></span><strong style="color:#1A7A4A">Applied</strong></td>
    </tr>`).join('');
}

function applyUploads() {
  if (!isUploadAdminUnlocked()) {
    requestUploadAdmin();
    return;
  }
  let monthChanged = false;
  const hadCYUpdate = !!(_pendingBudget || _pendingMonth);
  const hadPYUpdate = !!(_pendingBudgetPY || _pendingMonthPY);
  const hadSMHUpdate = !!(_pendingSMHBudget || _pendingSMHMonth);
  const hadDemandSMHUpdate = !!(_pendingDemandSMHBudget || _pendingDemandSMHActual);
  const pendingNames = {
    cyBudget:_pendingBudget && _pendingBudget.filename,
    cyMonth:_pendingMonth && _pendingMonth.filename,
    pyBudget:_pendingBudgetPY && _pendingBudgetPY.filename,
    pyMonth:_pendingMonthPY && _pendingMonthPY.filename,
    smhBudget:_pendingSMHBudget && _pendingSMHBudget.filename,
    smhMonth:_pendingSMHMonth && _pendingSMHMonth.filename,
    demandSmhBudget:_pendingDemandSMHBudget && _pendingDemandSMHBudget.filename,
    demandSmhActual:_pendingDemandSMHActual && _pendingDemandSMHActual.filename
  };
  if (hadCYUpdate || hadPYUpdate || hadSMHUpdate || hadDemandSMHUpdate) {
    _dataAsOnDate = new Date();
  }

  // ── Apply budget data ──────────────────────────────────────
  if(_pendingBudget) {
    Object.entries(_pendingBudget.data).forEach(([code,vals])=>{
      if(!BUDGET[code]) BUDGET[code]={bg_isl:0,rg:0,actuals_till:0};
      BUDGET[code].bg_isl       = vals.bg_isl;
      BUDGET[code].rg           = vals.rg;
      BUDGET[code].actuals_till = vals.actuals_till;
    });
    _pendingBudget=null;
  }

  // ── Apply month data + override current month detection ────
  if(_pendingMonth) {
    Object.entries(_pendingMonth.data).forEach(([code,vals])=>{
      MONTH[code]=vals;
    });
    _uploadedMonthIdx = _pendingMonth.detectedMonthIdx;
    _latestActualMonthIdx = _pendingMonth.detectedMonthIdx;
    monthChanged = true;
    _pendingMonth=null;
  }

  // ── Re-render everything ───────────────────────────────────
  if(_pendingBudgetPY){
    Object.entries(_pendingBudgetPY.data).forEach(([c,v])=>{ BUDGET_PY[c]={bg_isl:v.bg_isl,rg:v.rg,actuals_till:v.actuals_till}; });
    SOURCE_REGISTER.budgetPY.source = _pendingBudgetPY.filename || SOURCE_REGISTER.budgetPY.source;
    _pendingBudgetPY=null;
  }
  if(_pendingMonthPY){
    Object.entries(_pendingMonthPY.data).forEach(([c,v])=>{ MONTH_PY[c]=v; });
    SOURCE_REGISTER.monthPY.source = _pendingMonthPY.filename || SOURCE_REGISTER.monthPY.source;
    _pendingMonthPY=null;
  }
  if(_pendingSMHBudget || _pendingSMHMonth) {
    if (!window.DETAIL_SMH_DATA) {
      window.DETAIL_SMH_DATA = {
        source:'Uploaded SMH detail reports',
        generatedAt:new Date().toISOString(),
        rules:'Skipped DEPARTMENTCODE 00 and PU 98 Credit or Recoveries',
        monthLabels:['April 2026','May 2026','June 2026','July 2026','August 2026','September 2026','October 2026','November 2026','December 2026','January 2027','February 2027','March 2027'],
        monthKeys:FY_MONTHS,
        totals:{budget:0,actualTill:0,months:smhEmptyMonths()},
        rows:[]
      };
    }
    if(_pendingSMHBudget) {
      window.DETAIL_SMH_DATA.rows = mergeSMHDetailRows(window.DETAIL_SMH_DATA.rows, _pendingSMHBudget.rows, 'budget');
      _pendingSMHBudget = null;
    }
    if(_pendingSMHMonth) {
      window.DETAIL_SMH_DATA.rows = mergeSMHDetailRows(window.DETAIL_SMH_DATA.rows, _pendingSMHMonth.rows, 'month');
      _pendingSMHMonth = null;
    }
    window.DETAIL_SMH_DATA.generatedAt = new Date().toISOString();
    rebuildSMHDetailTotals();
    const deptSel = document.getElementById('smhDeptFilter');
    if (deptSel) delete deptSel.dataset.ready;
    initSMHDetailFilters();
  }
  if(_pendingDemandSMHBudget || _pendingDemandSMHActual) {
    const budgetUpload = _pendingDemandSMHBudget;
    const actualUpload = _pendingDemandSMHActual;
    rebuildDemandSMHSummaryFromUploads(budgetUpload, actualUpload);
    const srcParts = [
      (budgetUpload && budgetUpload.filename) || (window.DEMAND_SMH_SUMMARY_DATA && window.DEMAND_SMH_SUMMARY_DATA.sourceBudget),
      (actualUpload && actualUpload.filename) || (window.DEMAND_SMH_SUMMARY_DATA && window.DEMAND_SMH_SUMMARY_DATA.sourceActual)
    ].filter(Boolean);
    SOURCE_REGISTER.demandSmhCY.source = srcParts.join(' + ') || SOURCE_REGISTER.demandSmhCY.source;
    SOURCE_REGISTER.demandSmhCY.remarks = `Demand / SMH summary refreshed from admin upload; BP recalculated using ${getBPModeStatus().formulaLabel}. Imported BP is ignored. Demand 12N/10N Suspense Heads remains separately calculated.`;
    _pendingDemandSMHBudget = null;
    _pendingDemandSMHActual = null;
  }
  // Fixed freshness rule: portal display, saved upload state and every export must
  // use the same PU actuals and recomputed total rows immediately after Apply.
  if (hadCYUpdate || hadSMHUpdate || hadDemandSMHUpdate) refreshCalculatedSourceData();
  if(hadCYUpdate || hadSMHUpdate || hadDemandSMHUpdate) saveCYUploadState();
  if(hadPYUpdate) {
    savePYUploadState({
      budgetFile:pendingNames.pyBudget || SOURCE_REGISTER.budgetPY.source,
      monthFile:pendingNames.pyMonth || SOURCE_REGISTER.monthPY.source
    });
    SOURCE_REGISTER.budgetPY.remarks = `Previous year data uploaded and confirmed ${indianDateTime(_pyUploadMeta && _pyUploadMeta.confirmedAt)}.`;
    SOURCE_REGISTER.monthPY.remarks = SOURCE_REGISTER.budgetPY.remarks;
    setPYUpdateMode(false);
  }
  if(hadCYUpdate || hadPYUpdate || hadSMHUpdate || hadDemandSMHUpdate) {
    const parts = [];
    if (hadCYUpdate) parts.push('CY PU data');
    if (hadSMHUpdate) parts.push('CY Department wise detail');
    if (hadDemandSMHUpdate) parts.push('CY Demand / SMH summary');
    if (hadPYUpdate) parts.push('PY comparison data');
    const files = Object.values(pendingNames).filter(Boolean).join(' | ');
    addUploadConfirmation({
      label:'Confirmed upload',
      detail:parts.join(', ') || 'Portal data refreshed',
      files
    });
    updateHostedUploadGuard(true);
  }
  renderAll();
  renderCurDataGrid();
  renderUploadConfirmHistory();
  renderRemarks();
  renderUploadLog();
  renderSyncHealthPanel();
  if(typeof renderTrend==='function') renderTrend();
  if(hadSMHUpdate && typeof renderSMHDetail==='function') renderSMHDetail();
  if(hadDemandSMHUpdate && typeof renderDemandSMHSummary==='function') renderDemandSMHSummary();
  if(hadCYUpdate || hadPYUpdate || hadSMHUpdate || hadDemandSMHUpdate) refreshDynamicAI('apply-upload-or-sync');

  // Flash the apply button to confirm
  const btn = document.getElementById('applyBtn');
  btn.textContent = 'OK Applied! Tables Updated.';
  btn.style.background='#1A7A4A';
  btn.disabled=true;
  setTimeout(()=>{
    btn.textContent='OK Apply Uploaded Data & Refresh All Tables';
    btn.style.background='';
    btn.disabled=true; // reset - need new upload to enable again
  },3000);

  if(hadCYUpdate || hadPYUpdate || hadSMHUpdate || hadDemandSMHUpdate){
    // Show confirmation banner at top
    const banner=document.createElement('div');
    banner.style.cssText='position:fixed;top:70px;right:20px;z-index:9998;background:#1A7A4A;color:#fff;padding:10px 18px;border-radius:8px;font-size:11px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.2)';
    banner.textContent=monthChanged ? 'OK Data applied - current month auto-updated from uploaded file' : 'OK Data applied - portal timestamp updated';
    document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),4000);
  }
}

function renderCurDataGrid() {
  const {cur,futureMonths,actualMonths} = getMonthStatus();
  const pus = activePUMeta();
  let totB=0,totC=0;
  pus.forEach(p=>{const cv=compute(p.code);totB+=cv.budget;totC+=cv.totalCommitted;});
  const grid=document.getElementById('curDataGrid');
  if(!grid) return;
  const latestActualKey = actualMonths.length ? actualMonths[actualMonths.length - 1] : cur.key;
  const repoMonthIdx = Number.isInteger(_latestActualMonthIdx) ? _latestActualMonthIdx : FY_MONTHS.indexOf(latestActualKey);
  const repoMonthYear = repoMonthIdx <= 8 ? 2026 : 2027;
  const dataSource = _uploadedMonthIdx !== null
    ? `Uploaded file (${FY_MONTH_LABELS[_uploadedMonthIdx]} ${_uploadedMonthIdx<=8?2026:2027})`
    : `Repository data (${FY_MONTH_LABELS[repoMonthIdx] || cur.label} ${repoMonthYear})`;
  const lastConfirm = _uploadConfirmHistory[0] ? indianDateTime(_uploadConfirmHistory[0].at) : 'Not confirmed this browser';
  const pySource = _pyUploadMeta ? `Stored PY (${indianDateTime(_pyUploadMeta.confirmedAt)})` : 'Pre-loaded PY static';
  grid.innerHTML=`
    <div class="cdb-item"><div class="cdb-lbl">Data Source</div><div class="cdb-val" style="font-size:10px">${dataSource}</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Current Month</div><div class="cdb-val" style="color:#1A4E9A">${cur.label} ${cur.year}</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Gross Budget</div><div class="cdb-val">${(totB*1000/10000000).toFixed(0)} Cr</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Committed Till Date</div><div class="cdb-val" style="color:#1A7A4A">${(totC*1000/10000000).toFixed(0)} Cr</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Remaining Months</div><div class="cdb-val">${futureMonths.length}</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Budget Mode</div><div class="cdb-val" style="font-size:10px">${isRGActive()?'OK RG Active':'BG_ISL'}</div></div>
    <div class="cdb-item"><div class="cdb-lbl">PY Source</div><div class="cdb-val" style="font-size:10px">${htmlSafe(pySource)}</div></div>
    <div class="cdb-item"><div class="cdb-lbl">Last Confirm</div><div class="cdb-val" style="font-size:10px">${htmlSafe(lastConfirm)}</div></div>
  `;
  renderUploadConfirmHistory();
}

function renderRemarks() {
  const kpiWrap = document.getElementById('remarksKpis');
  const sourceBody = document.getElementById('remarksSourceBody');
  const ruleBody = document.getElementById('remarksRuleBody');
  const puBody = document.getElementById('remarksPUBody');
  if (!kpiWrap || !sourceBody || !ruleBody || !puBody) return;

  const activePus = activePUMeta();
  const gstExcluded = PU_META.filter(pu => isSkippedDisplayPU(pu.code));
  const recoveryPU = PU_META.find(pu => pu.code === '98');
  const staffCommitted = PU_META.filter(pu => pu.puType === 'Staff PU' && String(pu.liab).includes('Committed') && !pu.isNeg);
  const smhRows = (window.DETAIL_SMH_DATA && Array.isArray(window.DETAIL_SMH_DATA.rows)) ? window.DETAIL_SMH_DATA.rows : [];
  const smhVisibleRows = smhRows.filter(r => !isSkippedDisplayPU(r.puCode) && normPUCode(r.puCode) !== '98');
  const {cur, actualMonths} = getMonthStatus();

  kpiWrap.innerHTML = [
    ['Current Year Used', '2026-2027', 'CY budget and actual files'],
    ['Previous Year Used', '2025-2026', 'PY comparison base'],
    ['Visible PU Count', activePus.length, 'after display exclusions'],
    ['Actual Months', actualMonths.map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).join(', ') || 'None', `current running month: ${cur.label} ${cur.year}`],
    ['SMH Rows Used', smhVisibleRows.length, 'after Dept 00, PU-98 and GST display rules'],
    ['Excluded PU Codes', '72, 73, 74, 75, 98', 'GST and recoveries display rules']
  ].map(([label, value, note]) => `
    <div class="remarks-kpi">
      <span>${htmlSafe(label)}</span>
      <strong>${htmlSafe(value)}</strong>
      <em>${htmlSafe(note)}</em>
    </div>`).join('');

  sourceBody.innerHTML = Object.values(SOURCE_REGISTER).map(row => `
    <tr>
      <td><strong>${htmlSafe(row.label)}</strong></td>
      <td>${htmlSafe(row.fy)}</td>
      <td class="remarks-source-file">${htmlSafe(row.source)}</td>
      <td>${htmlSafe(row.used)}</td>
      <td>${htmlSafe(row.remarks || 'Static/pre-loaded portal data unless replaced through Data Upload.')}</td>
    </tr>`).join('');

  const aiSkipCodes = staffCommitted.map(pu => `PU-${pu.code}`).join(', ');
  ruleBody.innerHTML = [
    ['Department skip from IPAS detail file', 'DEPARTMENTCODE = 00', 'Department wise import/parsing', 'Department 00 rows are treated as non-operational/control rows and are not included in detail display.'],
    ['Credit / recovery skip', 'PU-98 Credit or Recoveries', 'All normal budget/expense display; kept separately for recovery reference/export', 'Recoveries are negative/credit nature and are not mixed with expenditure analysis.'],
    ['GST PU display skip', 'PU-72 CGST, PU-73 SGST, PU-74 UTGST, PU-75 IGST', 'All visible tabs/tables and analysis pages', 'These are tax adjustment heads and are excluded from operational expenditure view.'],
    ['AI Trend committed staff skip', aiSkipCodes, 'AI Trend Analysis Summary only', 'Staff committed liability is regular payroll type spending, so AI Trend focuses on controllable/non-committed pressure.'],
    ['Budget source rule', isRGActive() ? 'RG where allotted; otherwise BG_ISL' : 'RG not active - BG_ISL used', 'Budget values across portal', isRGActive() ? 'Each PU uses its own RG immediately when allotted; other PUs retain BG_ISL.' : 'Budget calculations are currently based on BG_ISL.']
  ].map(([rule, codes, where, clarification]) => `
    <tr>
      <td><strong>${htmlSafe(rule)}</strong></td>
      <td>${htmlSafe(codes)}</td>
      <td>${htmlSafe(where)}</td>
      <td>${htmlSafe(clarification)}</td>
    </tr>`).join('');

  const excludedPus = [...gstExcluded, recoveryPU].filter(Boolean);
  puBody.innerHTML = excludedPus.map(pu => {
    const bud = BUDGET[pu.code] || {};
    const reason = pu.code === '98'
      ? 'Credit or Recoveries - shown separately, excluded from normal expense view'
      : 'GST tax head - excluded from operational display';
    return `<tr>
      <td><strong>PU-${htmlSafe(pu.code)}</strong></td>
      <td>${htmlSafe(pu.desc)}</td>
      <td class="n">${fmtT(getBudget(pu.code))}</td>
      <td class="n">${fmtT(Number(bud.actuals_till) || 0)}</td>
      <td>${htmlSafe(reason)}</td>
    </tr>`;
  }).join('');
  refreshBIViewSoon();
}

function renderAdditionalRemarks() {
  const box = document.getElementById('additionalRemarksGrid');
  if (!box) return;

  const bp = getBPModeStatus();
  const month = getMonthStatus();
  const cur = month.cur || {};
  const actualLabels = (month.actualMonths || []).map(m => FY_MONTH_LABELS[FY_MONTHS.indexOf(m)]).filter(Boolean);
  const budgetBasis = isRGActive()
    ? 'Budget basis: RG is used immediately for any PU where RG amount is available; other PUs continue on BG_ISL.'
    : 'Budget basis: BG_ISL is used until RG values are available.';
  const sourceRows = Object.values(SOURCE_REGISTER || {});
  const sourceList = sourceRows.length
    ? sourceRows.map(row => `${row.label}: ${row.source}`).join(' | ')
    : 'Source register is loaded from the current portal data bundle.';

  const pages = [
    ['Summary', [
      'Executive overview of budget, actual, balance, utilisation and risk indicators.',
      `Current running month: ${cur.label || '-'} ${cur.year || ''}. Actual months available: ${actualLabels.join(', ') || 'None'}.`,
      'Risk Spotlight is intentionally kept on Summary only for a compact main workflow.'
    ]],
    ['OWE Statement', [
      'Uses current-year PU budget and PU month actual files for the main Ordinary Working Expenses view.',
      budgetBasis,
      'GST and recovery display exclusions remain unchanged from existing portal rules.'
    ]],
    ['Department wise', [
      'Uses department/SMH PU-wise budget and actual source files.',
      'Department 00 and excluded tax/recovery heads are not shown in the operational display where applicable.',
      'Visible tables keep the current filtered/sorted portal state for Current View exports.'
    ]],
    ['Demand wise', [
      'Uses Demand wise budget and actual summary files.',
      `BP uses completed months only: ${bp.bpMonthCount || 0} month(s). Running month remains provisional.`,
      'Values are displayed in Rs thousands with crore companion line where enabled.'
    ]],
    ['PU Master & Status', [
      'Classification is based on the embedded PU master list and current portal budget/actual values.',
      'Cards and table show budget, actual, balance, utilisation and status without changing calculations.'
    ]],
    ['Month-wise', [
      'Uses PU month-wise actuals for monthly movement and trend review.',
      'Current month values are treated as running/provisional until the sync month is marked complete.'
    ]],
    ['BP Analysis', [
      'BP is portal-generated using current completed-month logic.',
      `Current BP through: ${bp.bpThrough ? `${bp.bpThrough.label} ${bp.bpThrough.year}` : 'None'}.`
    ]],
    ['Budget Control', [
      'Shows saving/excess pressure and action-support views from existing portal calculations.',
      'Officer review remarks and action labels are advisory, not a change to source figures.'
    ]],
    ['AE vs BP', [
      'Shows actual expenditure against budget proportionate values.',
      'Excel-style column references in exports are used only for readability of displayed columns.'
    ]],
    ['Graphs', [
      'Charts are generated from the same in-browser data used by report tables.',
      'Chart exports include the visible chart image and related summary/table values where available.'
    ]],
    ['AI Summary', [
      'AI-style text is rule-based portal commentary derived from the currently loaded data.',
      'Staff committed PU treatment remains unchanged and is used to keep controllable pressure visible.'
    ]],
    ['History Compare', [
      'Compares archived sync snapshots saved under data/mb-budget-sync/history.',
      'From/To snapshot selections drive the displayed difference and related exports.'
    ]]
  ];

  box.innerHTML = pages.map(([title, notes]) => `
    <section class="additional-remarks-card">
      <h3>${htmlSafe(title)}</h3>
      <ul>${notes.map(note => `<li>${htmlSafe(note)}</li>`).join('')}</ul>
    </section>
  `).join('') + `
    <section class="additional-remarks-card wide">
      <h3>Source Register</h3>
      <p>${htmlSafe(sourceList)}</p>
    </section>
  `;
}


let _tCharts={};
function _dC(id){if(_tCharts[id]){_tCharts[id].destroy();delete _tCharts[id];}}
function _mC(id,cfg){_dC(id);const ctx=document.getElementById(id);if(!ctx)return;_tCharts[id]=new Chart(ctx,cfg);return _tCharts[id];}

const FOCUS_PUS = Array.from(IMPORTANT_PUS);
const FOCUS_DESC={'27':'Materials from stock','28':'Materials-Dir. purchase','30':'Cost Of Elec. Energy/Traction Energy Procurement','32':'Contractual payments','60':'Fuel/Power'};

function drawFallbackChart(id, title, labels, series, kind='bar') {
  const canvas = document.getElementById(id);
  if (!canvas || !canvas.getContext) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(760, Math.round(rect.width || canvas.parentElement?.clientWidth || 900));
  const height = Number(canvas.getAttribute('height')) || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = '100%';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0A1628';
  ctx.font = '700 12px Segoe UI, Arial';
  ctx.fillText(title, 12, 18);
  const plot = {x:46, y:30, w:width - 66, h:height - 62};
  const all = series.flatMap(s => s.data.map(v => Number(v) || 0));
  const max = Math.max(...all.map(v => Math.abs(v)), 1);
  ctx.strokeStyle = '#D8E5F2';
  ctx.lineWidth = 1;
  for (let i=0;i<=4;i++) {
    const y = plot.y + plot.h - (plot.h * i / 4);
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    ctx.fillStyle = '#607080'; ctx.font = '9px Segoe UI, Arial';
    ctx.fillText((max * i / 4).toFixed(0), 6, y + 3);
  }
  const colors = ['#1C6FD9', '#C9A84C', '#1A7A4A', '#E85D04', '#6A4C93'];
  const n = Math.max(labels.length, 1);
  if (kind === 'line') {
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color || colors[si % colors.length];
      ctx.lineWidth = si ? 1.8 : 2.6;
      ctx.beginPath();
      s.data.forEach((v, i) => {
        const x = plot.x + (n === 1 ? plot.w / 2 : i * plot.w / (n - 1));
        const y = plot.y + plot.h - ((Number(v) || 0) / max) * plot.h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  } else {
    const groupW = plot.w / n;
    const barW = Math.max(4, Math.min(28, groupW / (series.length + 1)));
    series.forEach((s, si) => {
      ctx.fillStyle = s.color || colors[si % colors.length];
      s.data.forEach((v, i) => {
        const h = ((Number(v) || 0) / max) * plot.h;
        const x = plot.x + i * groupW + (groupW - barW * series.length) / 2 + si * barW;
        const y = plot.y + plot.h - h;
        ctx.fillRect(x, y, barW - 1, Math.max(1, h));
      });
    });
  }
  ctx.fillStyle = '#496276';
  ctx.font = '9px Segoe UI, Arial';
  labels.forEach((label, i) => {
    if (i % Math.ceil(labels.length / 10) !== 0) return;
    const x = plot.x + (n === 1 ? plot.w / 2 : i * plot.w / Math.max(1, n - 1));
    ctx.save();
    ctx.translate(x, height - 22);
    ctx.rotate(-Math.PI / 8);
    ctx.fillText(String(label).slice(0, 12), 0, 0);
    ctx.restore();
  });
  let lx = plot.x;
  series.forEach((s, si) => {
    ctx.fillStyle = s.color || colors[si % colors.length];
    ctx.fillRect(lx, height - 12, 8, 8);
    ctx.fillStyle = '#0A1628';
    ctx.font = '9px Segoe UI, Arial';
    ctx.fillText(s.label, lx + 12, height - 5);
    lx += 120;
  });
}

function renderTrendFallback() {
  const puSel  =(document.getElementById('trendPUSelect') ||{}).value||'ALL';
  const useBPSelection = !!((document.getElementById('trendUseBPPU') || {}).checked);
  const topNv  =(document.getElementById('trendTopN') ||{}).value||'10';
  const topN   =topNv==='999'?999:parseInt(topNv, 10);
  const activePUs=activePUMeta().filter(p => passesPUFocus(p.code));
  const trendSelectedCodes = useBPSelection ? bpSelectedCodes() : (puSel === 'ALL' ? ['all'] : [puSel]);
  const puList=trendSelectedCodes.includes('all') ? activePUs : activePUs.filter(p=>trendSelectedCodes.includes(p.code));
  const trendScopeLabel = useBPSelection
    ? (trendSelectedCodes.includes('all') ? 'BP ticks: All PUs' : `BP ticks: ${trendSelectedCodes.length} PU(s)`)
    : (puSel==='ALL'?'All PUs':'PU-'+puSel);
  const monthStatus = getMonthStatus();
  const labels = FY_MONTH_LABELS.map((m,i)=>m+(i<=8?' 26':' 27'));
  const cyV = FY_MONTHS.map(m => puList.reduce((s,p)=>s + Number((MONTH[p.code]||{})[m] || 0), 0) / 10000);
  const pyV = FY_MONTHS.map(m => puList.reduce((s,p)=>s + Number((MONTH_PY[p.code]||{})[m] || 0), 0) / 10000);
  const totB=puList.reduce((s,p)=>(s + getBudget(p.code)),0);
  const totA=puList.reduce((s,p)=>(s + Number((BUDGET[p.code]||{}).actuals_till || 0)),0);
  const strip=document.getElementById('trendKPIStrip');
  if(strip){
    strip.innerHTML=[
      ['Effective Budget / OBA',detailCr(totB),trendScopeLabel],
      ['Actuals Till Date',detailCr(totA),totB ? (totA/totB*100).toFixed(1)+'% utilised' : 'No budget'],
      ['Balance',detailCr(totB - totA),(totB - totA) < 0 ? 'Over Budget' : 'Remaining'],
      ['Latest Month',`${monthStatus.cur.label} ${monthStatus.cur.year}`,'Local canvas fallback']
    ].map(([l,v,s])=>`<div class="trend-kpi"><div class="tk-lbl">${l}</div><div class="tk-val">${v}</div><div class="tk-sub">${s}</div></div>`).join('');
  }
  const note=document.getElementById('trendDataNote');
  const pyNote = hasPYTrendData() ? 'PY comparison loaded' : 'PY data not loaded';
  if(note) note.textContent=`Data: latest local sync | Current month ${monthStatus.cur.label} ${monthStatus.cur.year} | ${pyNote}`;
  const titleEl=document.getElementById('mainChartTitle');
  if(titleEl) titleEl.textContent='Monthly Actuals Trend - '+trendScopeLabel;
  drawFallbackChart('trendMainChart', 'CY vs PY Monthly Actuals (Rs Cr)', labels, [
    {label:'CY 2026-27', data:cyV, color:'#1C6FD9'},
    {label:'PY 2025-26', data:pyV, color:'#C9A84C'}
  ], 'bar');
  const topU=activePUs.filter(p=>BUDGET[p.code] && getBudget(p.code)>0).sort((a,b)=>((BUDGET[b.code].actuals_till||0)/(getBudget(b.code)||1))-((BUDGET[a.code].actuals_till||0)/(getBudget(a.code)||1))).slice(0,10);
  drawFallbackChart('trendUtilChart', 'Top Utilisation PUs (%)', topU.map(p=>'PU-'+p.code), [{label:'Utilisation %', data:topU.map(p=>Math.min(150, (BUDGET[p.code].actuals_till||0)/(getBudget(p.code)||1)*100)), color:'#1A7A4A'}], 'bar');
  const topA=activePUs.filter(p=>BUDGET[p.code] && (BUDGET[p.code].actuals_till||0)>0).sort((a,b)=>(BUDGET[b.code].actuals_till||0)-(BUDGET[a.code].actuals_till||0)).slice(0,Math.min(topN,15));
  drawFallbackChart('trendTopPUChart', 'Top PUs Budget vs Actuals (Rs Cr)', topA.map(p=>'PU-'+p.code), [
    {label:'Budget', data:topA.map(p=>(getBudget(p.code)||0)/10000), color:'#1C6FD9'},
    {label:'Actual', data:topA.map(p=>(BUDGET[p.code].actuals_till||0)/10000), color:'#1A7A4A'}
  ], 'bar');
  drawFallbackChart('trendFocusChart', 'Important PU CY Monthly Trend (Rs Cr)', labels, FOCUS_PUS.map((code,i)=>({label:'PU-'+code, data:FY_MONTHS.map(m=>((MONTH[code]||{})[m]||0)/10000), color:['#1C6FD9','#1A7A4A','#E85D04','#9B2226','#6A4C93'][i%5]})), 'line');
  const pressureRows = trendDecisionRows().filter(r => r.over || r.noExpense || r.utilPct >= 85).sort((a,b) => {
    const av = a.over ? Math.abs(a.balance) : a.noExpense ? a.budget : a.actual;
    const bv = b.over ? Math.abs(b.balance) : b.noExpense ? b.budget : b.actual;
    return bv - av;
  }).slice(0,12);
  drawFallbackChart('trendRiskChart', 'Budget Pressure - Over Budget / No Expense (Rs Cr)', pressureRows.map(r=>'PU-'+r.pu.code), [
    {label:'Budget', data:pressureRows.map(r=>r.budget/10000), color:'#1C6FD9'},
    {label:'Actual', data:pressureRows.map(r=>r.actual/10000), color:'#E85D04'}
  ], 'bar');
  const controlRows = trendControlRows().filter(r => r.askAmount > 0 || r.surrenderAmount > 0).sort((a,b) => (b.askAmount || b.surrenderAmount) - (a.askAmount || a.surrenderAmount)).slice(0,12);
  drawFallbackChart('trendControlChart', 'Budget Control - Ask vs Surrender (Rs Cr)', controlRows.map(r=>'PU-'+r.pu.code), [
    {label:'Ask', data:controlRows.map(r=>(r.askAmount || 0)/10000), color:'#9B2226'},
    {label:'Surrender', data:controlRows.map(r=>(r.surrenderAmount || 0)/10000), color:'#1A7A4A'}
  ], 'bar');
  const hmDiv=document.getElementById('trendHeatmap');
  if(hmDiv) {
    const hmPUs=activePUs.filter(p=>FY_MONTHS.some(m=>(MONTH[p.code]||{})[m])).slice(0,18);
    hmDiv.innerHTML='<table><thead><tr><th>PU</th>'+FY_MONTH_LABELS.map(m=>`<th>${m}</th>`).join('')+'</tr></thead><tbody>'+
      hmPUs.map(p=>`<tr><td>PU-${p.code}</td>`+FY_MONTHS.map(m=>`<td>${((MONTH[p.code]||{})[m]||0) ? (((MONTH[p.code]||{})[m]||0)/10000).toFixed(1) : '-'}</td>`).join('')+'</tr>').join('')+
      '</tbody></table>';
  }
  refreshBIViewSoon();
}

function renderTrend(){renderTrendLegacy();window.renderNRGraph?.();}
function renderTrendLegacy(){
  if(!window.Chart){
    renderTrendFallback();
    return;
  }
  const puSel  =(document.getElementById('trendPUSelect') ||{}).value||'ALL';
  const useBPSelection = !!((document.getElementById('trendUseBPPU') || {}).checked);
  const cType  =(document.getElementById('trendChartType')||{}).value||'monthly';
  const topNv  =(document.getElementById('trendTopN')     ||{}).value||'10';
  const showPY =((document.getElementById('trendShowPY')  ||{}).checked!==false);
  const topN   =topNv==='999'?999:parseInt(topNv);
  const hasPY  =hasPYTrendData();
  const MK=FY_MONTHS, ML=FY_MONTH_LABELS;
  const monthStatus = getMonthStatus();
  const CUR_IDX = monthStatus.cur.idx;
  const actualDoneIdxs = monthStatus.actualMonths.map(m => MK.indexOf(m)).filter(i => i >= 0);
  if (!actualDoneIdxs.includes(CUR_IDX)) actualDoneIdxs.push(CUR_IDX);
  const ML_S=['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  const activePUs=activePUMeta().filter(p => passesPUFocus(p.code));
  const trendSelectedCodes = useBPSelection ? bpSelectedCodes() : (puSel === 'ALL' ? ['all'] : [puSel]);
  const puList=trendSelectedCodes.includes('all')
    ? activePUs
    : activePUs.filter(p=>trendSelectedCodes.includes(p.code));
  const trendScopeLabel = useBPSelection
    ? (trendSelectedCodes.includes('all') ? 'BP ticks: All PUs' : `BP ticks: ${trendSelectedCodes.length} PU(s)`)
    : (puSel==='ALL'?'All PUs':'PU-'+puSel);

  function fCr(v){return v?(Math.abs(v)*1000/10000000).toFixed(1)+' Cr':'-';}
  function fN(v){return v?Math.round(v).toLocaleString('en-IN'):'-';}
  function sumM(pus,ds){return MK.map((_,mi)=>pus.reduce((s,p2)=>s+(ds[p2.code]?ds[p2.code][MK[mi]]||0:0),0));}

  // ── KPI Strip ────────────────────────────────────────────────
  const strip=document.getElementById('trendKPIStrip');
  if(strip){
    const totB=puList.reduce((s,p2)=>s+getBudget(p2.code),0);
    const totA=puList.reduce((s,p2)=>s+(BUDGET[p2.code]?BUDGET[p2.code].actuals_till||0:0),0);
    const bal=totB-totA, util=totB?(totA/totB*100):0;
    const matchedMonths=getBPModeStatus().bpMonths;const matchedCY=puList.reduce((s,p)=>s+matchedMonths.reduce((t,m)=>t+Number(MONTH[p.code]?.[m]||0),0),0);const pyA=hasPY&&showPY?puList.reduce((s,p)=>s+matchedMonths.reduce((t,m)=>t+Number(MONTH_PY[p.code]?.[m]||0),0),0):null;
    const yoy=pyA&&pyA!==0?((matchedCY-pyA)/Math.abs(pyA)*100):null;
    const activeMths=sumM(puList,MONTH).filter(v=>v>0).length;
    strip.innerHTML=[
      ['Effective Budget / OBA',fCr(totB),trendScopeLabel],
      ['Actuals Till Date',fCr(totA),util.toFixed(1)+'% utilised'],
      ['Balance',fCr(Math.abs(bal)),(bal<0?'Warning Over Budget':'Remaining')],
      ['Months Active',activeMths+'/12','APR 2026 to MAR 2027'],
      yoy!==null?['YoY Change',(yoy>=0?'+':'')+yoy.toFixed(1)+'%','same completed months, PY 2025-26']:
                 ['PY Data',hasPY ? 'Loaded' : 'Not loaded',hasPY ? 'Comparison active' : 'Upload PY files in Admin'],
    ].map(([l,v,s])=>`<div class="trend-kpi"><div class="tk-lbl">${l}</div><div class="tk-val">${v}</div><div class="tk-sub">${s}</div></div>`).join('');
  }
  const note=document.getElementById('trendDataNote');
  if(note) note.textContent=`Data: latest local sync | Current month ${monthStatus.cur.label} ${monthStatus.cur.year} | ${hasPY ? 'PY: 2025-26 comparison' : 'PY data not loaded'}`;

  // ── Main Chart ────────────────────────────────────────────────
  const titleEl=document.getElementById('mainChartTitle');
  const cyV=sumM(puList,MONTH), pyV=hasPY&&showPY?sumM(puList,MONTH_PY):null;
  let mainLabels = ML_S.map((m,i)=>m+(i<=8?'\'26':'\'27'));
  let mainTooltipCallbacks = null;
  if(['monthly','actualdone','cumulative','yoy'].includes(cType)){
    let ds=[];
    if(cType==='actualdone'){
      const doneIdxs = actualDoneIdxs.filter(i => cyV[i] || i <= CUR_IDX);
      mainLabels = doneIdxs.map(i => ML_S[i] + (i <= 8 ? '\'26' : '\'27'));
      const doneCY = doneIdxs.map(i => (cyV[i] * 1000 / 10000000).toFixed(1));
      ds = [{
        label:'CY Actual Expenses Done',
        data:doneCY,
        backgroundColor:doneIdxs.map(i => i === CUR_IDX ? 'rgba(244,169,50,.88)' : 'rgba(26,122,74,.78)'),
        borderColor:'#1A7A4A',
        borderWidth:1.5,
        borderRadius:4
      }];
      if(pyV){
        ds.push({
          label:'PY Same Months',
          data:doneIdxs.map(i => (pyV[i] * 1000 / 10000000).toFixed(1)),
          type:'line',
          borderColor:'#C9A84C',
          backgroundColor:'transparent',
          borderWidth:2.5,
          tension:.28,
          pointRadius:4,
          borderDash:[4,2]
        });
      }
      const rangeLabel = mainLabels.length ? ` (${mainLabels[0]} to ${mainLabels[mainLabels.length - 1]})` : '';
      if(titleEl) titleEl.textContent='Actual Expenses Done Months'+rangeLabel+' - '+trendScopeLabel;
      mainTooltipCallbacks = {afterLabel:c=>c.dataIndex===doneIdxs.indexOf(CUR_IDX)?'Current month till-date / committed':''};
    } else if(cType==='cumulative'){
      let cc=0,cp=0;
      const cumCY=cyV.map(v=>{cc+=v;return(cc*1000/10000000).toFixed(1);});
      ds=[{label:'CY 2026-27 Cumulative (RsCr)',data:cumCY,borderColor:'#1C6FD9',backgroundColor:'rgba(28,111,217,.12)',fill:true,tension:.35,pointRadius:4,type:'line'}];
      if(pyV){const cumPY=pyV.map(v=>{cp+=v;return(cp*1000/10000000).toFixed(1);}); ds.push({label:'PY 2025-26 Cumulative (RsCr)',data:cumPY,borderColor:'#C9A84C',fill:false,tension:.35,pointRadius:4,type:'line',borderDash:[5,3]});}
      if(titleEl) titleEl.textContent='Cumulative Spend - APR to MAR';
    } else if(cType==='yoy'){
      if(!pyV||!hasPY){if(titleEl) titleEl.textContent='YoY - PY data pre-loaded'; return;}
      const yoyD=cyV.map((v,i)=>pyV[i]?((v-pyV[i])/Math.abs(pyV[i])*100).toFixed(1):null);
      ds=[{label:'YoY % Change',data:yoyD,backgroundColor:yoyD.map(v=>parseFloat(v)>=0?'rgba(26,122,74,.75)':'rgba(204,0,0,.75)'),borderRadius:4}];
      if(titleEl) titleEl.textContent='Month-wise Year-on-Year % Change (CY vs PY)';
    } else {
      const barsClr=cyV.map((_,i)=>i<CUR_IDX?'rgba(28,111,217,.75)':i===CUR_IDX?'rgba(244,169,50,.85)':'rgba(28,111,217,.2)');
      ds=[{label:'CY 2026-27 Actuals',data:cyV.map(v=>(v*1000/10000000).toFixed(1)),backgroundColor:barsClr,borderRadius:3}];
      if(pyV) ds.push({label:'PY 2025-26',data:pyV.map(v=>(v*1000/10000000).toFixed(1)),type:'line',borderColor:'#C9A84C',backgroundColor:'transparent',borderWidth:2.5,tension:.3,pointRadius:4,borderDash:[4,2]});
      if(titleEl) titleEl.textContent='Monthly Actuals - '+trendScopeLabel;
    }
    _mC('trendMainChart',{type:'bar',data:{labels:mainLabels,datasets:ds},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}},tooltip:{callbacks:mainTooltipCallbacks||{}}},scales:{x:{ticks:{font:{size:10}}},y:{title:{display:true,text:'Rs Crore'},ticks:{font:{size:10}}}}}});
  } else {
    const sorted=activePUs.filter(p2=>BUDGET[p2.code]&&getBudget(p2.code)>0).sort((a,b)=>(BUDGET[b.code].actuals_till||0)-(BUDGET[a.code].actuals_till||0)).slice(0,topN);
    if(cType==='pubar'){
      _mC('trendMainChart',{type:'bar',data:{labels:sorted.map(p2=>'PU-'+p2.code),datasets:[{label:'Budget',data:sorted.map(p2=>(getBudget(p2.code)/10000).toFixed(0)),backgroundColor:'rgba(26,74,138,.45)',borderRadius:3},{label:'Actuals',data:sorted.map(p2=>(BUDGET[p2.code].actuals_till/10000).toFixed(0)),backgroundColor:'rgba(26,122,74,.75)',borderRadius:3}]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}}},scales:{x:{ticks:{font:{size:9},maxRotation:35}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:10}}}}}});
      if(titleEl) titleEl.textContent='Top '+sorted.length+' PUs - Budget vs Actuals (Rs Cr)';
    } else if(cType==='riskbar'){
      const riskRows=trendDecisionRows().filter(r=>r.over||r.noExpense||r.utilPct>=85).sort((a,b)=>{
        const av=a.over?Math.abs(a.balance):a.noExpense?a.budget:a.actual;
        const bv=b.over?Math.abs(b.balance):b.noExpense?b.budget:b.actual;
        return bv-av;
      }).slice(0,Math.min(topN,20));
      _mC('trendMainChart',{type:'bar',data:{labels:riskRows.map(r=>'PU-'+r.pu.code),datasets:[
        {label:'Budget',data:riskRows.map(r=>(r.budget/10000).toFixed(1)),backgroundColor:'rgba(28,111,217,.35)',borderRadius:3},
        {label:'Actual',data:riskRows.map(r=>(r.actual/10000).toFixed(1)),backgroundColor:riskRows.map(r=>r.over?'rgba(204,0,0,.78)':r.noExpense?'rgba(184,135,0,.68)':'rgba(232,93,4,.68)'),borderRadius:3}
      ]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}},tooltip:{callbacks:{afterLabel:c=>{const r=riskRows[c.dataIndex];return r?r.over?'Over budget':r.noExpense?'Budget available, no expense':'High utilisation':'';}}}},scales:{x:{ticks:{font:{size:9},maxRotation:35}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:10}}}}}});
      if(titleEl) titleEl.textContent='Budget Pressure Ranking - Over Budget / No Expense';
    } else if(cType==='askbar'){
      const controlRows=trendControlRows().filter(r=>r.askAmount>0||r.surrenderAmount>0).sort((a,b)=>(b.askAmount||b.surrenderAmount)-(a.askAmount||a.surrenderAmount)).slice(0,Math.min(topN,20));
      _mC('trendMainChart',{type:'bar',data:{labels:controlRows.map(r=>'PU-'+r.pu.code),datasets:[
        {label:'Amount to Ask',data:controlRows.map(r=>((r.askAmount||0)/10000).toFixed(1)),backgroundColor:'rgba(155,34,38,.78)',borderRadius:3},
        {label:'Possible Surrender',data:controlRows.map(r=>((r.surrenderAmount||0)/10000).toFixed(1)),backgroundColor:'rgba(26,122,74,.75)',borderRadius:3}
      ]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}}},scales:{x:{ticks:{font:{size:9},maxRotation:35}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:10}}}}}});
      if(titleEl) titleEl.textContent='Budget Control Projection - Ask vs Surrender';
    } else if(cType==='noexpense'){
      const noExpRows=trendDecisionRows().filter(r=>r.noExpense).sort((a,b)=>b.budget-a.budget).slice(0,Math.min(topN,20));
      _mC('trendMainChart',{type:'bar',data:{labels:noExpRows.map(r=>'PU-'+r.pu.code),datasets:[{label:'Budget with No Expense',data:noExpRows.map(r=>(r.budget/10000).toFixed(1)),backgroundColor:'rgba(184,135,0,.72)',borderRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:9},maxRotation:35}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:10}}}}}});
      if(titleEl) titleEl.textContent='Budget Available but No Expense Booked';
    } else {
      const utD=sorted.map(p2=>Math.min(150,Math.round((BUDGET[p2.code].actuals_till||0)/Math.max(getBudget(p2.code)||1,1)*100)));
      _mC('trendMainChart',{type:'bar',data:{labels:sorted.map(p2=>'PU-'+p2.code),datasets:[{label:'Utilisation %',data:utD,backgroundColor:utD.map(u=>u>100?'rgba(204,0,0,.75)':u>85?'rgba(232,93,4,.75)':u>60?'rgba(192,112,0,.65)':'rgba(26,122,74,.75)'),borderRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:9},maxRotation:35}},y:{max:155,title:{display:true,text:'%'},ticks:{callback:v=>v+'%',font:{size:10}}}}}});
      if(titleEl) titleEl.textContent='Budget Utilisation Ranking (Top '+sorted.length+')';
    }
  }

  // ── Utilisation bar ───────────────────────────────────────────
  const topU=activePUs.filter(p2=>BUDGET[p2.code]&&getBudget(p2.code)>0).sort((a,b)=>{return (BUDGET[b.code].actuals_till||0)/Math.max(getBudget(b.code)||1,1)-(BUDGET[a.code].actuals_till||0)/Math.max(getBudget(a.code)||1,1);}).slice(0,10);
  _mC('trendUtilChart',{type:'bar',data:{labels:topU.map(p2=>'PU-'+p2.code+': '+p2.desc.substring(0,14)),datasets:[{label:'Utilisation %',data:topU.map(p2=>Math.min(150,Math.round((BUDGET[p2.code].actuals_till||0)/Math.max(getBudget(p2.code)||1,1)*100))),backgroundColor:topU.map(p2=>{const u=(BUDGET[p2.code].actuals_till||0)/Math.max(getBudget(p2.code)||1,1)*100;return u>100?'rgba(204,0,0,.75)':u>85?'rgba(232,93,4,.75)':u>60?'rgba(192,112,0,.65)':'rgba(26,122,74,.75)';}),borderRadius:3}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'% utilised'}}},scales:{x:{max:155,title:{display:true,text:'%'},ticks:{callback:v=>v+'%',font:{size:9}}},y:{ticks:{font:{size:8}}}}}});

  // ── Top 15 Budget vs Actuals bar ──────────────────────────────
  const top15=activePUs.filter(p2=>BUDGET[p2.code]&&(BUDGET[p2.code].actuals_till||0)>0).sort((a,b)=>(BUDGET[b.code].actuals_till||0)-(BUDGET[a.code].actuals_till||0)).slice(0,15);
  _mC('trendTopPUChart',{type:'bar',data:{labels:top15.map(p2=>'PU-'+p2.code+': '+p2.desc.substring(0,14)),datasets:[{label:'Budget (RsCr)',data:top15.map(p2=>((getBudget(p2.code)||0)/10000).toFixed(0)),backgroundColor:'rgba(26,74,138,.4)',borderRadius:2},{label:'Actuals (RsCr)',data:top15.map(p2=>((BUDGET[p2.code].actuals_till||0)/10000).toFixed(0)),backgroundColor:'rgba(26,122,74,.75)',borderRadius:2}]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}}},scales:{x:{ticks:{font:{size:8},maxRotation:35}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:10}}}}}});

  // ── Heatmap ───────────────────────────────────────────────────
  const hmDiv=document.getElementById('trendHeatmap');
  if(hmDiv){
    const hmPUs=activePUs.filter(p2=>MK.some(mk=>MONTH[p2.code]&&MONTH[p2.code][mk]>0)).slice(0,18);
    const allV=[];hmPUs.forEach(p2=>MK.forEach(mk=>{if(MONTH[p2.code]&&MONTH[p2.code][mk]>0)allV.push(MONTH[p2.code][mk]);}));
    const maxV=Math.max(...allV,1);
    function hC(v){const r=Math.round(28+(v/maxV)*176),g=Math.round(111*(v/maxV)),b=Math.round(217-(v/maxV)*160);return 'rgb('+r+','+g+','+b+')';}
    const hdr='<tr><th style="text-align:left;background:#0A1628;position:sticky;left:0;z-index:3">PU</th>'+ML.map((m,i)=>'<th>'+m+'<br><span style="font-size:7px">'+(i<=8?'26':'27')+'</span></th>').join('')+'</tr>';
    const rows=hmPUs.map(pu=>'<tr><td style="text-align:left;font-weight:700;background:#F5F8FC;position:sticky;left:0;z-index:2;white-space:nowrap">PU-'+pu.code+'</td>'+MK.map((mk,i)=>{const v=MONTH[pu.code]?MONTH[pu.code][mk]||0:0;const cr2=(v*1000/10000000).toFixed(1);const bg=v>0?hC(v):'#F8FAFB';const fg=v>maxV*0.4?'#fff':'#0A1628';return '<td style="background:'+bg+';color:'+fg+'">'+(v>0?cr2:'-')+'</td>';}).join('')+'</tr>').join('');
    hmDiv.innerHTML='<table><thead>'+hdr+'</thead><tbody>'+rows+'</tbody></table>';
  }

  // ── Focus PUs YoY chart ───────────────────────────────────────
  const focusDs=[];
  const cyColors=['#1C6FD9','#1A7A4A','#E85D04','#9B2226','#6A4C93','#C9A84C'];
  FOCUS_PUS.forEach((code,fi)=>{
    const cyVf=MK.map((_,mi)=>((MONTH[code]?MONTH[code][MK[mi]]||0:0)*1000/10000000).toFixed(1));
    const pyVf=hasPY&&showPY?MK.map((_,mi)=>((MONTH_PY[code]?MONTH_PY[code][MK[mi]]||0:0)*1000/10000000).toFixed(1)):null;
    focusDs.push({label:'PU-'+code+' CY',data:cyVf,borderColor:cyColors[fi],backgroundColor:'transparent',borderWidth:2.5,tension:.3,pointRadius:4});
    if(pyVf) focusDs.push({label:'PU-'+code+' PY',data:pyVf,borderColor:cyColors[fi],backgroundColor:'transparent',borderWidth:1.5,tension:.3,pointRadius:2,borderDash:[4,3],opacity:.5});
  });
  _mC('trendFocusChart',{type:'line',data:{labels:ML_S.map((m,i)=>m+(i<=8?'\'26':'\'27')),datasets:focusDs},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'top',labels:{boxWidth:10,font:{size:8},filter:i=>!i.text.includes('PY')||showPY}}},scales:{x:{ticks:{font:{size:9}}},y:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:9}}}}}});

  // ── Analytics Table ───────────────────────────────────────────
  const pressureRows=trendDecisionRows().filter(r=>r.over||r.noExpense||r.utilPct>=85).sort((a,b)=>{
    const av=a.over?Math.abs(a.balance):a.noExpense?a.budget:a.actual;
    const bv=b.over?Math.abs(b.balance):b.noExpense?b.budget:b.actual;
    return bv-av;
  }).slice(0,12);
  _mC('trendRiskChart',{type:'bar',data:{labels:pressureRows.map(r=>'PU-'+r.pu.code+': '+r.pu.desc.substring(0,12)),datasets:[
    {label:'Budget',data:pressureRows.map(r=>(r.budget/10000).toFixed(1)),backgroundColor:'rgba(28,111,217,.35)',borderRadius:3},
    {label:'Actual',data:pressureRows.map(r=>(r.actual/10000).toFixed(1)),backgroundColor:pressureRows.map(r=>r.over?'rgba(204,0,0,.78)':r.noExpense?'rgba(184,135,0,.68)':'rgba(232,93,4,.68)'),borderRadius:3}
  ]},options:{indexAxis:'y',responsive:true,plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}},tooltip:{callbacks:{afterLabel:c=>{const r=pressureRows[c.dataIndex];return r?r.over?'Over budget':r.noExpense?'Budget available, no expense':'High utilisation':'';}}}},scales:{x:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:9}}},y:{ticks:{font:{size:8}}}}}});

  const controlRows=trendControlRows().filter(r=>r.askAmount>0||r.surrenderAmount>0).sort((a,b)=>(b.askAmount||b.surrenderAmount)-(a.askAmount||a.surrenderAmount)).slice(0,12);
  _mC('trendControlChart',{type:'bar',data:{labels:controlRows.map(r=>'PU-'+r.pu.code+': '+r.pu.desc.substring(0,12)),datasets:[
    {label:'Amount to Ask',data:controlRows.map(r=>((r.askAmount||0)/10000).toFixed(1)),backgroundColor:'rgba(155,34,38,.78)',borderRadius:3},
    {label:'Possible Surrender',data:controlRows.map(r=>((r.surrenderAmount||0)/10000).toFixed(1)),backgroundColor:'rgba(26,122,74,.75)',borderRadius:3}
  ]},options:{indexAxis:'y',responsive:true,plugins:{legend:{position:'top',labels:{boxWidth:12,font:{size:10}}}},scales:{x:{title:{display:true,text:'Rs Cr'},ticks:{font:{size:9}}},y:{ticks:{font:{size:8}}}}}});

  const thead=document.getElementById('trendTHead'),tbody=document.getElementById('trendTBody');
  if(thead&&tbody){
    thead.innerHTML='<tr><th style="text-align:left">PU</th><th style="text-align:left">Description</th><th>Type</th><th>Budget</th><th>Actuals CY</th><th>Util%</th><th>Status</th><th>PY Actuals</th><th>YoY</th>'+MK.map((mk,i)=>'<th>'+ML[i]+'</th>').join('')+'<th>Total</th></tr>';
    tbody.innerHTML=activePUs.map(pu=>{
      const b=BUDGET[pu.code]||{},mo=MONTH[pu.code]||{},bpy=BUDGET_PY[pu.code]||{};
      const util=getBudget(pu.code)?Math.round((b.actuals_till||0)/getBudget(pu.code)*100):0;
      const uC=util>100?'#CC0000':util>85?'#E85D04':util>60?'#C07000':'#1A7A4A';
      const pyAct=bpy.actuals_till||0;
      const yoy=pyAct?((b.actuals_till||0)-pyAct)/Math.abs(pyAct)*100:null;
      const total=MK.reduce((s,mk)=>s+(mo[mk]||0),0);
      const isFocus=FOCUS_PUS.includes(pu.code);
      const noExp = isBudgetNoExpense(pu.code);
      return '<tr style="'+(noExp?'background:#FFF4C2;box-shadow:inset 4px 0 0 #B88700;':isFocus?'background:#FFFBF0;':'')+(isFocus?'font-weight:600':'')+'">'+
        '<td style="font-weight:700;color:#1C3A5E;cursor:pointer" onclick="openPUDetail(\''+pu.code+'\')">PU-'+pu.code+(isFocus?' *':'')+'</td>'+
        '<td>'+pu.desc+'</td>'+
        '<td style="font-size:9px">'+(pu.puType==='Staff PU'?'<span style="color:#1A7A4A">Staff</span>':'<span style="color:#1A4E9A">Non-Staff</span>')+'</td>'+
        '<td>'+fN(getBudget(pu.code))+'</td>'+
        '<td>'+fN(b.actuals_till||0)+'</td>'+
        '<td style="color:'+uC+';font-weight:700">'+util+'%</td>'+
        '<td class="no-exp-status">'+htmlSafe(noExpenseStatus(noExp))+'</td>'+
        '<td>'+fN(pyAct)+'</td>'+
        '<td style="color:'+(yoy===null?'#888':yoy>=0?'#CC0000':'#1A7A4A')+';font-weight:700">'+(yoy===null?'-':(yoy>=0?'+':'')+yoy.toFixed(1)+'%')+'</td>'+
        MK.map((mk,i)=>{const v=mo[mk]||0;const isCur=i===CUR_IDX,isFut=i>CUR_IDX;return '<td style="'+(v>0&&isCur?'background:#FFF8E0;font-weight:700;':'')+(isFut?'color:#B0C0D8;':'')+'font-size:9px">'+(v>0?v.toLocaleString('en-IN'):'<span style="color:#ddd">-</span>')+'</td>';}).join('')+
        '<td style="font-weight:700;font-size:10px">'+fN(total)+'</td>'+
        '</tr>';
    }).join('');
  }
  refreshBIViewSoon();
}

function renderMonthwise() {
  const pus = getFiltered();
  const {actualMonths, futureMonths, cur} = getMonthStatus();
  const futurePadCount = Math.max(0, 9 - futureMonths.length);
  const pastHdr = actualMonths.map(m => {
    const idx = FY_MONTHS.indexOf(m);
    return `<th>${FY_MONTH_LABELS[idx]}<br>Actual</th>`;
  }).join('');
  const futureHdr = futureMonths.map(m => {
    const idx = FY_MONTHS.indexOf(m);
    return `<th style="background:#1A3A6A;color:#DDEEFF">${FY_MONTH_LABELS[idx]}<br>Projected</th>`;
  }).join('') + '<th style="color:#aaa">-</th>'.repeat(futurePadCount);
  const mwHead = document.getElementById('mw-thead');
  if (mwHead) {
    mwHead.innerHTML = `
      <tr>
        <th class="la" style="min-width:40px">PU</th>
        <th class="la" style="min-width:160px">Description</th>
        ${pastHdr}
        <th style="background:#7A5A00;color:#FFF9E0">${cur.label} till<br>date exp</th>
        <th style="background:#7A5A00;color:#FFF9E0">${cur.label}<br>Remaining</th>
        <th style="background:#7A5A00;color:#FFF9E0">${cur.label}<br>Total</th>
        ${futureHdr}
        <th>Budget<br>(Rs'000s)</th>
        <th>Committed<br>Till Date</th>
        <th>Balance<br>Budget</th>
        <th>%<br>Used</th>
        <th>Status</th>
      </tr>`;
  }

  let rows = '';
  const tots = {curC:0, curR:0, curT:0, tB:0, tC:0, tBal:0};
  actualMonths.forEach(m => tots[m] = 0);
  futureMonths.forEach(m => tots[m] = 0);

  pus.forEach(pu => {
    const md = MONTH[pu.code] || {};
    const c = compute(pu.code);
    const proj = c.projPerMonth;
    const pastCells = actualMonths.map(m => {
      const v = md[m] || 0;
      tots[m] += v;
      return `<td class="n">${fmtT(v)}</td>`;
    }).join('');
    tots.curC += c.curCommitted;
    tots.curR += c.curRemaining;
    tots.curT += c.curMonthTotal;
    tots.tB += c.budget;
    tots.tC += c.totalCommitted;
    tots.tBal += c.balanceBudget;
    futureMonths.forEach(m => tots[m] += (proj || 0));

    const util = c.utilisedPct;
    const col = utilColor(util);
    const noExp = isBudgetNoExpense(pu.code);
    let futureCells = futureMonths.map(() => `<td class="n" style="color:#1A4A8A;background:#F0F6FF">${fmtT(proj)}</td>`).join('');
    if (futurePadCount) futureCells += '<td class="n" style="color:#aaa">-</td>'.repeat(futurePadCount);
    const balCls = c.balanceBudget < 0 ? 'neg' : c.balanceBudget < c.budget * 0.1 ? 'low' : 'ok';
    rows += `<tr class="${getRowClass(pu)}" data-pu="${pu.code}" style="cursor:pointer">
      <td class="puc puc-link" title="Open Full Details: PU-${pu.code}" onclick="event.stopPropagation();openPUDetail('${pu.code}')">${pu.code}</td>
      <td class="desc" title="${pu.desc}" style="font-weight:700">${pu.desc}</td>
      ${pastCells}
      <td class="n" style="background:#FFF9E0;font-weight:600">${fmtT(c.curCommitted)}</td>
      <td class="n" style="background:#FFF9E0;color:var(--muted)">${fmtT(c.curRemaining)}</td>
      <td class="n" style="background:#FFF9E0;font-weight:700">${fmtT(c.curMonthTotal)}</td>
      ${futureCells}
      <td class="n">${fmtT(c.budget)}</td>
      <td class="n" style="font-weight:700">${fmtT(c.totalCommitted)}</td>
      <td class="n rem ${balCls}">${fmtT(c.balanceBudget)}</td>
      <td>${miniProg(util, col)}</td>
      <td class="no-exp-status">${htmlSafe(noExpenseStatus(noExp))}</td>
    </tr>`;
  });

  const futTotCells = futureMonths.map(m =>
    `<td class="n" style="color:#1A4A8A;background:#E8F0FF;font-weight:700">${fmtT(tots[m] || 0)}</td>`).join('');
  let ftPad = futTotCells;
  for (let i = 0; i < futurePadCount; i++) ftPad += '<td class="n" style="color:#aaa">-</td>';
  const totalPastCells = actualMonths.map(m => `<td class="n">${fmtT(tots[m] || 0)}</td>`).join('');
  const tUtil = pct(tots.tC, tots.tB);
  rows += `<tr class="tot">
    <td colspan="2" style="text-align:left">GRAND TOTAL</td>
    ${totalPastCells}
    <td class="n" style="background:#FFF0C0">${fmtT(tots.curC)}</td>
    <td class="n" style="background:#FFF0C0">${fmtT(tots.curR)}</td>
    <td class="n" style="background:#FFF0C0">${fmtT(tots.curT)}</td>
    ${ftPad}
    <td class="n">${fmtT(tots.tB)}</td>
    <td class="n">${fmtT(tots.tC)}</td>
    <td class="n rem ${tots.tBal < 0 ? 'neg' : 'ok'}">${fmtT(tots.tBal)}</td>
    <td>${miniProg(Math.min(100, tUtil), utilColor(tUtil))}</td>
    <td>-</td>
  </tr>`;
  document.getElementById('mw-tbody').innerHTML = rows;
}

function renderAll() {
  window.renderZonalFR?.();
  window.refreshNRYearComparisons?.();
  initPopup();
  initExportButtons();
  initReportExportMenu();
  initReportMenuButtons();
  initTableSortObserver();
  initDashboardDock();
  initSmartTools();
  initReportViewMode();
  renderCards();
  renderJuneBars();
  renderSummaryPage();
  renderLiability();
  renderMonthwise();
  renderPUMaster();
  renderDemandSMHSummary();
  renderBPAnalysis();
  renderBudgetControl();
  renderRemarks();
  buildBudgetAnomalyFindings();
  renderBIView();
  updateHostedUploadGuard();
  setTimeout(() => {
    if (typeof renderTrend === 'function') renderTrend();
    if (typeof renderAITrendSummary === 'function') renderAITrendSummary();
  }, 120);
  document.getElementById('rgNote').textContent=isRGActive()?'RG where allotted; otherwise BG_ISL':'BG_ISL';
  const {cur:_cur}=getMonthStatus();
  const _cmb=document.getElementById('curMonBadge'); if(_cmb) _cmb.textContent=_cur.label+' '+_cur.year;
  setTimeout(()=>{addDualScroll();attachPUPopup();makeReportTablesSortable();applyMobileTableLabels();},80);
  setTimeout(()=>{makeReportTablesSortable();applyMobileTableLabels();},260);
}

function tableHeaderLabels(table) {
  const rows = Array.from((table.tHead || table.querySelector('thead'))?.rows || []);
  if (!rows.length) return [];
  const grid = [];
  rows.forEach((row, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    Array.from(row.cells).forEach(cell => {
      while (grid[r][c]) c++;
      const rs = Math.max(1, cell.rowSpan || 1);
      const cs = Math.max(1, cell.colSpan || 1);
      const text = cell.textContent.replace(/\s+/g, ' ').trim();
      for (let rr = 0; rr < rs; rr++) {
        grid[r + rr] = grid[r + rr] || [];
        for (let cc = 0; cc < cs; cc++) {
          const existing = grid[r + rr][c + cc];
          grid[r + rr][c + cc] = existing ? `${existing} ${text}`.trim() : text;
        }
      }
      c += cs;
    });
  });
  const width = Math.max(...grid.map(r => r.length));
  return Array.from({length:width}, (_, c) => {
    const parts = grid.map(r => r[c]).filter(Boolean);
    return [...new Set(parts)].join(' - ').replace(/\s+-\s+$/, '') || 'Value';
  });
}

function applyMobileTableLabels() {
  document.querySelectorAll('table').forEach(table => {
    const labels = tableHeaderLabels(table);
    if (!labels.length) return;
    Array.from(table.tBodies || []).forEach(tbody => {
      Array.from(tbody.rows).forEach(row => {
        Array.from(row.cells).forEach((cell, i) => {
          if (!cell.dataset.label) cell.dataset.label = labels[i] || `Column ${i + 1}`;
        });
      });
    });
  });
}

const TABLE_SORT_STATE = new Map();
let _tableSortObserver = null;
let _tableSortTimer = null;

function sortTableId(table) {
  if (!table.dataset.sortId) {
    const section = table.closest('.tab-content');
    const page = section ? section.id.replace(/^tab-/, '') : 'page';
    const index = Array.from((section || document).querySelectorAll('table')).indexOf(table);
    table.dataset.sortId = `${page}:${index}`;
  }
  return table.dataset.sortId;
}

function headerCellStartColumn(row, cell) {
  let col = 0;
  Array.from(row.cells).some(th => {
    if (th === cell) return true;
    col += Math.max(1, th.colSpan || 1);
    return false;
  });
  return col;
}

function sortValueFromText(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '-' || s === '--') return {type:'blank', value:''};
  const pct = /%$/.test(s);
  const numeric = s
    .replace(/[₹,\s]/g, '')
    .replace(/\(([-+]?\d+(?:\.\d+)?)\)/, '-$1')
    .replace(/cr$/i, '')
    .replace(/'/g, '');
  if (/^[-+]?\d+(?:\.\d+)?%?$/.test(numeric)) {
    return {type:'number', value:Number(numeric.replace('%', ''))};
  }
  const firstNumber = s.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (pct && firstNumber) return {type:'number', value:Number(firstNumber[0].replace(/,/g, ''))};
  return {type:'text', value:s.toLowerCase()};
}

function tableRowIsLocked(row) {
  const text = String(row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const first = String(row.cells[0]?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return row.classList.contains('tot') ||
    row.classList.contains('dept-total') ||
    row.classList.contains('demand-smh-total') ||
    row.classList.contains('grand-total') ||
    /^total\b|grand total|subtotal|sub-total/.test(first) ||
    /^total\b|grand total|subtotal|sub-total/.test(text);
}

function rowGroupKeyText(group, col) {
  for (const row of group) {
    const text = row.cells[col] ? row.cells[col].textContent : '';
    if (String(text || '').trim()) return text;
  }
  return '';
}

function sortableRowGroups(tbody) {
  const groups = [];
  Array.from(tbody.rows).forEach(row => {
    if (tableRowIsLocked(row)) {
      groups.push({locked:true, rows:[row]});
      return;
    }
    const first = String(row.cells[0]?.textContent || '').trim();
    const prev = groups[groups.length - 1];
    if (!first && prev && !prev.locked) prev.rows.push(row);
    else groups.push({locked:false, rows:[row]});
  });
  return groups;
}

function applyTableSort(table, col, dir) {
  const tbody = table.tBodies && table.tBodies[0];
  if (!tbody || col == null) return;
  const groups = sortableRowGroups(tbody);
  let segment = [];
  const output = [];
  const flush = () => {
    segment.sort((a, b) => {
      const av = sortValueFromText(rowGroupKeyText(a.rows, col));
      const bv = sortValueFromText(rowGroupKeyText(b.rows, col));
      if (av.type === 'blank' && bv.type !== 'blank') return 1;
      if (bv.type === 'blank' && av.type !== 'blank') return -1;
      const cmp = av.type === 'number' && bv.type === 'number'
        ? av.value - bv.value
        : String(av.value).localeCompare(String(bv.value), undefined, {numeric:true, sensitivity:'base'});
      return dir === 'desc' ? -cmp : cmp;
    });
    output.push(...segment);
    segment = [];
  };
  groups.forEach(group => {
    if (group.locked) {
      flush();
      output.push(group);
    } else {
      segment.push(group);
    }
  });
  flush();
  const orderedRows = output.flatMap(group => group.rows);
  const currentRows = Array.from(tbody.rows);
  if (orderedRows.every((row, index) => row === currentRows[index])) return;
  orderedRows.forEach(row => tbody.appendChild(row));
}

function setTableSortIndicators(table, col, dir) {
  table.querySelectorAll('th[data-sort-col]').forEach(th => {
    const active = Number(th.dataset.sortCol) === col;
    th.classList.toggle('sort-asc', active && dir === 'asc');
    th.classList.toggle('sort-desc', active && dir === 'desc');
    th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

function makeReportTablesSortable(scope=document) {
  scope.querySelectorAll('.tab-content table').forEach(table => {
    const thead = table.tHead || table.querySelector('thead');
    const tbody = table.tBodies && table.tBodies[0];
    if (!thead || !tbody || !tbody.rows.length) return;
    table.classList.add('sortable-table');
    const id = sortTableId(table);
    Array.from(thead.rows).forEach(row => {
      Array.from(row.cells).forEach(cell => {
        const col = headerCellStartColumn(row, cell);
        cell.dataset.sortCol = String(col);
        cell.title = 'Click to sort this table';
        if (cell.dataset.sortBound === '1') return;
        cell.dataset.sortBound = '1';
        cell.tabIndex = 0;
        cell.addEventListener('click', () => {
          const current = TABLE_SORT_STATE.get(id);
          const nextDir = current && current.col === col && current.dir === 'asc' ? 'desc' : 'asc';
          TABLE_SORT_STATE.set(id, {col, dir:nextDir});
          applyTableSort(table, col, nextDir);
          setTableSortIndicators(table, col, nextDir);
          applyMobileTableLabels();
        });
        cell.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            cell.click();
          }
        });
      });
    });
    const saved = TABLE_SORT_STATE.get(id);
    if (saved) {
      applyTableSort(table, saved.col, saved.dir);
      setTableSortIndicators(table, saved.col, saved.dir);
    }
  });
}

function scheduleTableSortRefresh() {
  clearTimeout(_tableSortTimer);
  _tableSortTimer = setTimeout(() => {
    makeReportTablesSortable();
    applyMobileTableLabels();
  }, 60);
}

function initTableSortObserver() {
  if (_tableSortObserver) return;
  _tableSortObserver = new MutationObserver(mutations => {
    if (mutations.some(m => m.target && m.target.closest && m.target.closest('.tab-content'))) {
      scheduleTableSortRefresh();
    }
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    _tableSortObserver.observe(section, {childList:true, subtree:true});
  });
}

// SheetJS embedded inline above

// INIT
initBrowserProtection();
initPortalTheme();
initBlockStyle();
loadCYUploadState();
loadUploadAdminState();
window.initNRScope();
initSMHDetailFilters();
restoreLoginSession();
loadAdminConfig();
applyAdminConfig(_adminConfig);
window.applyNRScope(window.NR_SELECTED_SCOPE.code,false);
renderAll();
renderUploadConfirmHistory();
renderSyncHealthPanel();
setTimeout(renderSMHDetail, 120);
setTimeout(hydrateDemandSMHActualMonthsFromSyncedFile, 250);
(function(){
  const sel=document.getElementById('trendPUSelect'); if(!sel) return;
  activePUMeta().forEach(pu=>{
    const o=document.createElement('option'); o.value=pu.code;
    o.textContent='PU-'+pu.code+' - '+pu.desc; sel.appendChild(o);
  });
})();
