/* Default-browser handoff. Kakao's openExternal route is unofficial; the user
 * confirmed it works on their Galaxy/KakaoTalk with our other sites (2026-10-02).
 * Never force a browser package or treat an attempted handoff as success. */
(function () {
  'use strict';
  var marker = '_pj_external';
  var current;
  try { current = new URL(window.location.href); } catch (_) { return; }
  if (current.origin !== 'https://actor-park.github.io' &&
      !(/^https?:$/.test(current.protocol) && /^(localhost|127\.0\.0\.1)$/.test(current.hostname))) return;
  if (current.username || current.password) return;
  var hadMarker = current.searchParams.has(marker);
  if (hadMarker) {
    // Preserve the spelling, ordering and encoding of all original parameters.
    var remaining = current.search.slice(1).split('&').filter(function (part) {
      try { return decodeURIComponent(part.split('=')[0]) !== marker; } catch (_) { return true; }
    }).join('&');
    current.search = remaining ? '?' + remaining : '';
  }
  var cleanUrl = current.href;
  window.PJA_PUBLIC_URL = cleanUrl;
  function guardedUrl() {
    var target = new URL(cleanUrl);
    target.search += (target.search ? '&' : '?') + marker + '=1';
    return target.href;
  }
  var ua = navigator.userAgent || '';
  var android = /Android/i.test(ua);
  var mobile = android || /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var app = /KAKAOWORK/i.test(ua) ? '카카오워크' : /KAKAOTALK/i.test(ua) ? '카카오톡' :
    /Instagram/i.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook' :
    /;\s*wv\)/i.test(ua) ? '이 앱' : '';
  if (!mobile || !app) {
    if (hadMarker) {
      try { window.history.replaceState(window.history.state, '', cleanUrl); } catch (_) {}
    }
    return;
  }
  var canLaunch = android && app === '카카오톡';
  var sessionKey = 'pj-browser-handoff-v1:' + current.pathname + current.search + current.hash;
  var attempted = hadMarker;
  try { attempted = attempted || window.sessionStorage.getItem(sessionKey) === '1'; } catch (_) {}
  function markAttempt() {
    attempted = true;
    try { window.sessionStorage.setItem(sessionKey, '1'); } catch (_) {}
    // Guard the source page AND the destination even when storage is blocked.
    try { window.history.replaceState(window.history.state, '', guardedUrl()); } catch (_) {}
  }
  function mount() {
    if (!document.body || document.querySelector('[data-pj-browser-handoff]')) return;
    var style = document.createElement('style');
    style.textContent =
      '[data-pj-browser-handoff]{box-sizing:border-box;position:fixed;z-index:2000;left:16px;bottom:max(16px,env(safe-area-inset-bottom));width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid #c9ae8260;border-radius:16px;background:#141418;color:#ede9e2;box-shadow:0 16px 60px #0008;font-family:var(--sans,sans-serif);font-size:14px;line-height:1.6;text-align:left;overflow-wrap:anywhere}' +
      '[data-pj-browser-handoff] *{box-sizing:border-box}' +
      '[data-pj-browser-handoff][hidden]{display:none}' +
      '[data-pj-browser-handoff] strong{display:block;font-size:16px;letter-spacing:-.02em}' +
      '[data-pj-browser-handoff] p{margin:8px 0 14px;color:#c5c0b7;font-size:13px;line-height:1.65}' +
      '[data-pj-browser-handoff] .pj-browser-actions{display:flex;flex-wrap:wrap;gap:8px}' +
      '[data-pj-browser-handoff] button{min-height:44px;max-width:100%;padding:9px 13px;border:1px solid #c9ae8260;border-radius:8px;background:transparent;color:#ede9e2;font:inherit;cursor:pointer}' +
      '[data-pj-browser-handoff] .pj-browser-primary{background:#c9ae82;border-color:#c9ae82;color:#08080a;font-weight:600}' +
      '[data-pj-browser-handoff] button:focus-visible,[data-pj-browser-handoff] input:focus-visible{outline:3px solid #ede9e2;outline-offset:3px}' +
      '[data-pj-browser-handoff] .pj-browser-stay{border:0;padding:8px 0 0;color:#c5c0b7;text-decoration:underline;text-underline-offset:4px;font-size:12px}' +
      '[data-pj-browser-handoff] input{display:block;width:100%;margin-top:10px;min-height:44px;padding:9px;border:1px solid #c9ae8260;border-radius:8px;background:#08080a;color:#ede9e2;font:inherit;font-size:12px;user-select:text}' +
      '[data-pj-browser-handoff] input[hidden]{display:none}' +
      '@media print{[data-pj-browser-handoff]{display:none}}';
    document.head.appendChild(style);
    var panel = document.createElement('aside');
    panel.setAttribute('data-pj-browser-handoff', '');
    panel.setAttribute('aria-label', '기본 브라우저로 열기');
    var title = document.createElement('strong');
    title.textContent = '기본 브라우저로 이어서 보기';
    var message = document.createElement('p');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    var guidance = app + ' 메뉴에 외부 브라우저 열기 기능이 있으면 사용하거나, 주소를 복사해 기기의 기본 브라우저에서 열어 주세요.';
    var admin = /\/admin\.html$/.test(current.pathname);
    message.textContent = (canLaunch ? '자동으로 열리지 않으면 아래 버튼을 눌러 주세요. ' : '') + guidance +
      (admin ? ' 외부 브라우저에서는 다시 로그인해야 할 수 있습니다.' : '');
    var actions = document.createElement('div');
    actions.className = 'pj-browser-actions';
    var open = canLaunch ? document.createElement('button') : null;
    if (open) {
      open.type = 'button';
      open.className = 'pj-browser-primary';
      open.textContent = '기본 브라우저로 열기';
      actions.appendChild(open);
    }
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '주소 복사';
    if (!open) copy.className = 'pj-browser-primary';
    actions.appendChild(copy);
    var address = document.createElement('input');
    address.type = 'text';
    address.readOnly = true;
    address.hidden = true;
    address.value = cleanUrl;
    address.setAttribute('aria-label', '현재 페이지 주소');
    var stay = document.createElement('button');
    stay.type = 'button';
    stay.className = 'pj-browser-stay';
    stay.textContent = '여기서 계속 보기';
    [title, message, actions, address, stay].forEach(function (item) { panel.appendChild(item); });
    document.body.appendChild(panel);
    function launch() {
      markAttempt();
      // Kakao/OS chooses the browser. Keep the original WebView available.
      try { window.location.assign('kakaotalk://web/openExternal?url=' + encodeURIComponent(guardedUrl())); }
      catch (_) { message.textContent = guidance; }
    }
    if (open) open.addEventListener('click', function () {
      message.textContent = '열리지 않으면 ' + guidance;
      launch();
    });
    copy.addEventListener('click', async function () {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(cleanUrl);
        message.textContent = '주소를 복사했습니다. 기기의 기본 브라우저 주소창에 붙여 넣어 주세요.';
      } catch (_) {
        address.hidden = false;
        address.focus();
        address.select();
        message.textContent = '아래 주소를 길게 눌러 복사한 뒤 기본 브라우저에서 열어 주세요.';
      }
    });
    stay.addEventListener('click', function () { markAttempt(); panel.hidden = true; });
    function attemptAutomatically() {
      if (!canLaunch || attempted || panel.hidden || document.visibilityState === 'hidden') return;
      launch();
    }
    document.addEventListener('visibilitychange', attemptAutomatically);
    attemptAutomatically();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
