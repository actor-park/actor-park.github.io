/**
 * collector.gs — visit collector for the Ji-oh Park profile site.
 *
 * Two separate secrets, on purpose:
 *
 *   WRITE_TOKEN — PUBLIC. It ships inside assets/js/config.js so every
 *                 visitor's browser can log its own visit. If someone digs it
 *                 out of the page source they can submit visits, so the
 *                 collector must validate and neutralize every field.
 *
 *   READ_KEY    — PRIVATE. It exists only in this file. The admin page asks
 *                 for it at login and it is never committed to the repository,
 *                 so the visit log cannot be opened from the page source alone.
 *                 This is what makes the admin login mean something.
 *
 * Reads use POST only; GET never accepts credentials or returns visit data.
 * Failed authentication is limited across this single-admin service.
 *
 * Everything written here is later rendered as HTML by admin.html, so the
 * values are constrained on the way IN as well: known fields only, enumerated
 * values where the client only ever sends a fixed set, angle brackets stripped,
 * length capped. The admin page escapes too — one layer is never enough.
 *
 * Change the admin password  = change READ_KEY below, then redeploy.
 * Redeploy without changing the /exec address:
 *   배포 → 배포 관리 → (연필 아이콘) → 버전: 새 버전 → 배포
 */

var WRITE_TOKEN = 'pja_T9lwsFX1SRGDBeL7s6ODCeXjVvmchrX7VruUO6Fe';
var READ_KEY    = 'REPLACE_WITH_YOUR_OWN_ADMIN_KEY';

var SHEET_ID    = '';   // empty: this script is bound to its own Sheet
var SHEET_NAME  = 'visits';
var MAX_RETURN  = 20000;

var COLUMNS   = ['t', 'p', 'src', 'ref', 'd', 'b', 'os', 'lang', 'sw', 'vid', 'nv', 'tz'];
var NUMERIC   = { t: 1, sw: 1, tz: 1 };

/* analytics.js only ever produces these. Anything else is dropped, which is
   what keeps a crafted payload out of the admin page's charts and summary. */
var ENUMS = {
  src: ['qr', 'direct', 'internal', 'search', 'sns', 'referral'],
  d:   ['mobile', 'tablet', 'desktop'],
  nv:  ['new', 'ret'],
  b:   ['Edge', 'Opera', 'Samsung', 'Whale', 'KakaoTalk', 'In-app', 'Chrome', 'Firefox', 'Safari', 'Other'],
  os:  ['Windows', 'iOS', 'macOS', 'Android', 'Linux', 'Other']
};

var MAX_FIELD = 300;    // characters kept per free-text field
var MAX_BODY  = 4000;   // characters accepted per request
var SECURITY_VERSION = '20261006';
var AUTH_STATE = 'pj_auth_failures_v1';
var AUTH_WINDOW_MS = 5 * 60 * 1000;
var AUTH_MAX_FAILURES = 8;
var AUTH_BLOCK_MS = 60 * 1000;

function sheet_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet. Open Apps Script from inside the Sheet, or set SHEET_ID.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS);
  }
  return sh;
}

/** Constant-time-ish comparison so a wrong key leaks no timing hint. */
function eq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Keep only the shape we expect. */
function clean_(value, col) {
  if (value === undefined || value === null) return '';

  if (NUMERIC[col]) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    if (col === 'sw') return n >= 0 && n <= 16384 ? Math.round(n) : '';
    if (col === 'tz') return n >= -14 && n <= 14 ? n : '';
    return n;
  }

  var s = String(value)
    .slice(0, MAX_FIELD)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '');          // nothing that can open an HTML tag downstream

  if (ENUMS[col]) return ENUMS[col].indexOf(s) === -1 ? '' : s;
  if (col === 'lang') return s.replace(/[^A-Za-z-]/g, '').slice(0, 5);
  // appendRow treats a leading '=' as a formula. Also protect later CSV use.
  if (/^[\s\uFEFF]*[=+\-@＝＋－＠]/.test(s)) s = "'" + s;
  return s;
}

function list_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return { visits: [] };

  var first = Math.max(2, last - MAX_RETURN + 1);
  var values = sh.getRange(first, 1, last - first + 1, COLUMNS.length).getValues();
  var visits = values.map(function (r) {
    var o = {};
    COLUMNS.forEach(function (c, i) { o[c] = r[i]; });
    o.t = Number(o.t);
    return o;
  }).filter(function (o) { return !!o.t; });

  return { visits: visits };
}

/** A shared finite cooldown: Apps Script does not expose a trusted client IP.
 * Check the limit BEFORE comparing credentials, including otherwise valid keys.
 * Requests during a cooldown never extend it. State survives cache eviction.
 */
function authorize_(key) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { ok: false, error: 'rate_limited', retry_after: 2 };
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(AUTH_STATE);
    var state = raw ? JSON.parse(raw) : {};
    var now = Date.now();
    if (Number(state.blockedUntil) > now) {
      return { ok: false, error: 'rate_limited', retry_after: Math.ceil((state.blockedUntil - now) / 1000) };
    }
    if (state.blockedUntil || !state.started || now - state.started >= AUTH_WINDOW_MS) {
      state = { started: now, failures: 0 };
    }
    if (typeof key === 'string' && key && READ_KEY !== 'REPLACE_WITH_YOUR_OWN_ADMIN_KEY' && eq_(key, READ_KEY)) {
      props.deleteProperty(AUTH_STATE);
      return { ok: true };
    }
    state.failures = (Number(state.failures) || 0) + 1;
    if (state.failures >= AUTH_MAX_FAILURES) state.blockedUntil = now + AUTH_BLOCK_MS;
    props.setProperty(AUTH_STATE, JSON.stringify(state));
    return state.blockedUntil
      ? { ok: false, error: 'rate_limited', retry_after: AUTH_BLOCK_MS / 1000 }
      : { ok: false, error: 'unauthorized' };
  } finally {
    lock.releaseLock();
  }
}

/** Anything that reads the log comes through here. */
function read_(action, key) {
  if (action !== 'ping' && action !== 'list') return { ok: false, error: 'bad request' };
  var auth = authorize_(key);
  if (!auth.ok) return auth;
  if (action === 'ping') return { ok: true, security_version: SECURITY_VERSION };
  if (action === 'list') return list_();
  return { ok: true, hint: 'action must be list or ping' };
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '';
    if (!raw || raw.length > MAX_BODY) return json_({ ok: false, error: 'bad request' });

    var body = JSON.parse(raw);

    // read request:  { action: 'list' | 'ping', key: '...' }
    if (body.action) return json_(read_(String(body.action), body.key));

    // write request: { token: '...', visit: { ... } }
    if (!eq_(body.token, WRITE_TOKEN)) return json_({ ok: false, error: 'unauthorized' });

    var v = body.visit || {};
    var row = COLUMNS.map(function (c) { return clean_(v[c], c); });
    row[0] = Date.now();                     // do not trust a supplied timestamp
    sheet_().appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
}

function doGet(e) {
  return json_({ ok: false, error: 'post required' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
