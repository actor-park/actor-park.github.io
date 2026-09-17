/*!
 * analytics.js — visit logging for the Ji-oh Park profile site.
 *
 * Two modes:
 *   local  (default) — visits are kept in this browser's localStorage only.
 *                      Useful for a demo, but each device sees only itself.
 *   remote           — set PJA_CONFIG.endpoint to a collector URL and every
 *                      visit is also POSTed there, so the admin page can show
 *                      real cross-device totals. See assets/collector.gs.
 */
(function (root) {
  'use strict';

  var CONFIG = root.PJA_CONFIG || {};
  var KEY_VISITS = 'pj_visits_v1';
  var KEY_VID    = 'pj_vid_v1';
  var KEY_SEEN   = 'pj_seen_v1';
  var MAX_LOCAL  = 5000;

  // ── small helpers ────────────────────────────────────────────────────────
  function safeGet(store, key) {
    try { return root[store].getItem(key); } catch (e) { return null; }
  }
  function safeSet(store, key, val) {
    try { root[store].setItem(key, val); return true; } catch (e) { return false; }
  }
  function uid() {
    try {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ── classification ───────────────────────────────────────────────────────
  var SEARCH = /(^|\.)(google|naver|daum|bing|yahoo|duckduckgo|baidu|yandex|zum)\./i;
  var SNS    = /(^|\.)(instagram|facebook|fb|twitter|x|t|threads|youtube|youtu|tiktok|kakao|band|linkedin|pinterest|reddit)\.(com|co|be|kr|me|net)$/i;

  /** Where did this visit come from? QR wins over everything else. */
  function classify(params, referrer) {
    var src = (params.get('src') || params.get('utm_source') || '').toLowerCase();
    if (src === 'qr' || src === 'namecard' || src === 'card') return 'qr';
    var host = '';
    try { host = referrer ? new URL(referrer).hostname : ''; } catch (e) { host = ''; }
    if (!host) return 'direct';
    if (host === root.location.hostname) return 'internal';
    if (SEARCH.test(host)) return 'search';
    if (SNS.test(host)) return 'sns';
    return 'referral';
  }

  function deviceOf(ua, width) {
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
    return width > 0 && width < 768 ? 'mobile' : 'desktop';
  }

  function browserOf(ua) {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/SamsungBrowser/.test(ua)) return 'Samsung';
    if (/NAVER|Whale/i.test(ua)) return 'Whale';
    if (/KAKAOTALK/i.test(ua)) return 'KakaoTalk';
    if (/FBAN|FBAV|Instagram/i.test(ua)) return 'In-app';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Other';
  }

  function osOf(ua) {
    if (/Windows NT/.test(ua)) return 'Windows';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Other';
  }

  // ── store ────────────────────────────────────────────────────────────────
  function readLocal() {
    var raw = safeGet('localStorage', KEY_VISITS);
    if (!raw) return [];
    try {
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function writeLocal(list) {
    if (list.length > MAX_LOCAL) list = list.slice(list.length - MAX_LOCAL);
    safeSet('localStorage', KEY_VISITS, JSON.stringify(list));
  }

  function visitorId() {
    var id = safeGet('localStorage', KEY_VID);
    if (!id) { id = uid(); safeSet('localStorage', KEY_VID, id); }
    return id;
  }

  // ── record one pageview ──────────────────────────────────────────────────
  function track(extra) {
    var loc = root.location;
    // a file:// or about: page has nothing meaningful to log
    if (!loc || !/^https?:/.test(loc.protocol)) return null;

    var params = new URLSearchParams(loc.search || '');
    var ua = navigator.userAgent || '';
    var w = (root.screen && root.screen.width) || root.innerWidth || 0;
    var firstSeen = safeGet('localStorage', KEY_SEEN);
    var rec = {
      t: Date.now(),
      p: loc.pathname + (loc.search || ''),
      src: classify(params, document.referrer),
      ref: (function () {
        try { return document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { return ''; }
      })(),
      d: deviceOf(ua, w),
      b: browserOf(ua),
      os: osOf(ua),
      lang: (navigator.language || '').slice(0, 5),
      sw: w,
      vid: visitorId(),
      nv: firstSeen ? 'ret' : 'new',
      tz: -new Date().getTimezoneOffset() / 60
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) rec[k] = extra[k];
    if (!firstSeen) safeSet('localStorage', KEY_SEEN, String(rec.t));

    var list = readLocal();
    list.push(rec);
    writeLocal(list);

    if (CONFIG.endpoint) send(rec);
    return rec;
  }

  /** Fire-and-forget POST; never let a collector outage break the page. */
  function send(rec) {
    var body = JSON.stringify({ token: CONFIG.token || '', visit: rec });
    try {
      fetch(CONFIG.endpoint, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  /** All visits, newest last. Resolves from the collector when one is set. */
  function all() {
    if (!CONFIG.endpoint) return Promise.resolve(readLocal());
    var url = CONFIG.endpoint +
      (CONFIG.endpoint.indexOf('?') > -1 ? '&' : '?') +
      'action=list&token=' + encodeURIComponent(CONFIG.token || '');
    return fetch(url, { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var rows = Array.isArray(j) ? j : (j && j.visits) || [];
        return rows.map(function (r) { r.t = Number(r.t); return r; })
                   .sort(function (a, b) { return a.t - b.t; });
      })
      .catch(function () { return readLocal(); });
  }

  function clearLocal() { try { root.localStorage.removeItem(KEY_VISITS); } catch (e) {} }

  root.PJA = {
    track: track,
    all: all,
    readLocal: readLocal,
    clearLocal: clearLocal,
    mode: function () { return CONFIG.endpoint ? 'remote' : 'local'; },
    _classify: classify
  };
})(window);
