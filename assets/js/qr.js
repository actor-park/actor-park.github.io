/*!
 * qr.js — minimal QR Code encoder (byte mode, versions 1–20, EC levels L/M/Q/H).
 * Self-contained: no network, no dependencies. Tables verified against segno.
 * Exposes window.QR = { encode, toSVG, toCanvas }.
 */
(function (root) {
  'use strict';

  // ── tables ───────────────────────────────────────────────────────────────
  // ECC[level][version-1] = [[numBlocks, totalCodewords, dataCodewords], ...]
  var ECC = {"L":[[[1,26,19]],[[1,44,34]],[[1,70,55]],[[1,100,80]],[[1,134,108]],[[2,86,68]],[[2,98,78]],[[2,121,97]],[[2,146,116]],[[2,86,68],[2,87,69]],[[4,101,81]],[[2,116,92],[2,117,93]],[[4,133,107]],[[3,145,115],[1,146,116]],[[5,109,87],[1,110,88]],[[5,122,98],[1,123,99]],[[1,135,107],[5,136,108]],[[5,150,120],[1,151,121]],[[3,141,113],[4,142,114]],[[3,135,107],[5,136,108]]],"M":[[[1,26,16]],[[1,44,28]],[[1,70,44]],[[2,50,32]],[[2,67,43]],[[4,43,27]],[[4,49,31]],[[2,60,38],[2,61,39]],[[3,58,36],[2,59,37]],[[4,69,43],[1,70,44]],[[1,80,50],[4,81,51]],[[6,58,36],[2,59,37]],[[8,59,37],[1,60,38]],[[4,64,40],[5,65,41]],[[5,65,41],[5,66,42]],[[7,73,45],[3,74,46]],[[10,74,46],[1,75,47]],[[9,69,43],[4,70,44]],[[3,70,44],[11,71,45]],[[3,67,41],[13,68,42]]],"Q":[[[1,26,13]],[[1,44,22]],[[2,35,17]],[[2,50,24]],[[2,33,15],[2,34,16]],[[4,43,19]],[[2,32,14],[4,33,15]],[[4,40,18],[2,41,19]],[[4,36,16],[4,37,17]],[[6,43,19],[2,44,20]],[[4,50,22],[4,51,23]],[[4,46,20],[6,47,21]],[[8,44,20],[4,45,21]],[[11,36,16],[5,37,17]],[[5,54,24],[7,55,25]],[[15,43,19],[2,44,20]],[[1,50,22],[15,51,23]],[[17,50,22],[1,51,23]],[[17,47,21],[4,48,22]],[[15,54,24],[5,55,25]]],"H":[[[1,26,9]],[[1,44,16]],[[2,35,13]],[[4,25,9]],[[2,33,11],[2,34,12]],[[4,43,15]],[[4,39,13],[1,40,14]],[[4,40,14],[2,41,15]],[[4,36,12],[4,37,13]],[[6,43,15],[2,44,16]],[[3,36,12],[8,37,13]],[[7,42,14],[4,43,15]],[[12,33,11],[4,34,12]],[[11,36,12],[5,37,13]],[[11,36,12],[7,37,13]],[[3,45,15],[13,46,16]],[[2,42,14],[17,43,15]],[[2,42,14],[19,43,15]],[[9,39,13],[16,40,14]],[[15,43,15],[10,44,16]]]};
  // alignment-pattern centre coordinates, indexed by version-2
  var ALIGN = [[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90]];
  // format info bits, indexed by (segnoEcKey * 8 + mask)
  var FORMAT = [21522,20773,24188,23371,17913,16590,20375,19104,30660,29427,32170,30877,26159,25368,27713,26998,5769,5054,7399,6608,1890,597,3340,2107,13663,12392,16177,14854,9396,8579,11994,11245];
  // version info bits, indexed by version-7
  var VERSION_INFO = [31892,34236,39577,42195,48118,51042,55367,58893,63784,68472,70749,76311,79154,84390,87683,92361,96236,102084,102881,110507,110734,117786,119615,126325,127568,133589,136944,141498,145311,150283,152622,158308,161089,167017];
  var EC_KEY = { L: 1, M: 0, Q: 3, H: 2 };
  // remainder bits appended after the interleaved codewords, by version
  function remainderBits(v) {
    if (v === 1) return 0;
    if (v <= 6) return 7;
    if (v <= 13) return 0;
    if (v <= 20) return 3;
    return 4;
  }

  // ── GF(256) arithmetic, primitive polynomial 0x11D ───────────────────────
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    for (var i = 0, x = 1; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= gmul(g[j], EXP[i]);
        ng[j + 1] ^= g[j];
      }
      g = ng;
    }
    return g.reverse();   // highest degree first, so g[0] is the leading 1
  }

  function rsEncode(data, ecLen) {
    var g = genPoly(ecLen), res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < ecLen; j++) res[j] ^= gmul(g[j + 1], factor);
    }
    return res;
  }

  // ── bit buffer ───────────────────────────────────────────────────────────
  function Bits() { this.b = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.b.push((val >>> i) & 1);
  };

  function utf8(str) {
    var out = [], s = encodeURIComponent(str);
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '%') { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else out.push(s.charCodeAt(i));
    }
    return out;
  }

  function dataCodewordCount(version, level) {
    var infos = ECC[level][version - 1], n = 0;
    for (var i = 0; i < infos.length; i++) n += infos[i][0] * infos[i][2];
    return n;
  }

  // ── matrix scaffolding ───────────────────────────────────────────────────
  function reservedMatrix(version) {
    var size = version * 4 + 17;
    var r = [];
    for (var i = 0; i < size; i++) r.push(new Array(size).fill(false));
    function block(row, col, h, w) {
      for (var i = 0; i < h; i++)
        for (var j = 0; j < w; j++) {
          var y = row + i, x = col + j;
          if (y >= 0 && y < size && x >= 0 && x < size) r[y][x] = true;
        }
    }
    block(0, 0, 9, 9);                 // finder TL + separator + format
    block(0, size - 8, 9, 8);          // finder TR + format
    block(size - 8, 0, 8, 9);          // finder BL + format
    for (var i = 0; i < size; i++) { r[6][i] = true; r[i][6] = true; }  // timing
    if (version >= 2) {
      var pos = ALIGN[version - 2];
      for (var a = 0; a < pos.length; a++)
        for (var b = 0; b < pos.length; b++) {
          var cy = pos[a], cx = pos[b];
          // the three cells that collide with finder patterns carry no alignment
          if ((cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8)) continue;
          block(cy - 2, cx - 2, 5, 5);
        }
    }
    if (version >= 7) {
      block(size - 11, 0, 3, 6);
      block(0, size - 11, 6, 3);
    }
    return r;
  }

  function drawFunctions(m, version) {
    var size = m.length;
    function finder(row, col) {
      for (var i = -1; i <= 7; i++)
        for (var j = -1; j <= 7; j++) {
          var y = row + i, x = col + j;
          if (y < 0 || y >= size || x < 0 || x >= size) continue;
          var inner = (i >= 2 && i <= 4 && j >= 2 && j <= 4);
          var ring  = (i === 0 || i === 6) && j >= 0 && j <= 6;
          var side  = (j === 0 || j === 6) && i >= 0 && i <= 6;
          m[y][x] = inner || ring || side;
        }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (var i = 8; i < size - 8; i++) { var v = (i % 2 === 0); m[6][i] = v; m[i][6] = v; }
    if (version >= 2) {
      var pos = ALIGN[version - 2];
      for (var a = 0; a < pos.length; a++)
        for (var b = 0; b < pos.length; b++) {
          var cy = pos[a], cx = pos[b];
          if ((cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8)) continue;
          for (var dy = -2; dy <= 2; dy++)
            for (var dx = -2; dx <= 2; dx++)
              m[cy + dy][cx + dx] = (Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
        }
    }
    m[size - 8][8] = true;  // the always-dark module
  }

  function placeFormat(m, level, mask) {
    var size = m.length, bits = FORMAT[EC_KEY[level] * 8 + mask];
    function bit(i) { return ((bits >>> i) & 1) === 1; }
    // copy 1 — up the left of the top-left finder, then along its underside
    for (var i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (var j = 9; j < 15; j++) m[8][14 - j] = bit(j);
    // copy 2 — bottom-left finder, then right of the top-right finder
    for (var k = 0; k < 8; k++) m[8][size - 1 - k] = bit(k);
    for (var n = 8; n < 15; n++) m[size - 15 + n][8] = bit(n);
  }

  function placeVersion(m, version) {
    if (version < 7) return;
    var size = m.length, bits = VERSION_INFO[version - 7];
    for (var i = 0; i < 18; i++) {
      var b = ((bits >>> i) & 1) === 1, y = Math.floor(i / 3), x = i % 3;
      m[size - 11 + x][y] = b;
      m[y][size - 11 + x] = b;
    }
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i)    { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i + j) % 2 + (i * j) % 3) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.length, score = 0, i, j, run, last;
    // rule 1 — runs of five or more same-colour modules in a row or column
    for (i = 0; i < size; i++) {
      run = 1; last = m[i][0];
      for (j = 1; j < size; j++) {
        if (m[i][j] === last) { run++; } else { if (run >= 5) score += run - 2; run = 1; last = m[i][j]; }
      }
      if (run >= 5) score += run - 2;
      run = 1; last = m[0][i];
      for (j = 1; j < size; j++) {
        if (m[j][i] === last) { run++; } else { if (run >= 5) score += run - 2; run = 1; last = m[j][i]; }
      }
      if (run >= 5) score += run - 2;
    }
    // rule 2 — 2x2 blocks of one colour
    for (i = 0; i < size - 1; i++)
      for (j = 0; j < size - 1; j++)
        if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) score += 3;
    // rule 3 — finder-like 1:1:3:1:1 patterns with four light modules on one side
    var A = [true, false, true, true, true, false, true, false, false, false, false];
    var B = [false, false, false, false, true, false, true, true, true, false, true];
    function match(get, at) {
      var okA = true, okB = true;
      for (var k = 0; k < 11; k++) {
        var v = get(at + k);
        if (v !== A[k]) okA = false;
        if (v !== B[k]) okB = false;
      }
      return okA || okB;
    }
    for (i = 0; i < size; i++)
      for (j = 0; j + 11 <= size; j++) {
        if (match(function (x) { return m[i][x]; }, j)) score += 40;
        if (match(function (y) { return m[y][i]; }, j)) score += 40;
      }
    // rule 4 — deviation of the dark-module ratio from 50%
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  // ── public API ───────────────────────────────────────────────────────────
  function encode(text, opts) {
    opts = opts || {};
    var level = opts.level || 'M';
    if (!EC_KEY.hasOwnProperty(level)) throw new Error('bad EC level: ' + level);
    var bytes = utf8(String(text));

    var version = opts.version || 0;
    if (!version) {
      for (var v = 1; v <= ECC[level].length; v++) {
        var countBits = v <= 9 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= dataCodewordCount(v, level) * 8) { version = v; break; }
      }
      if (!version) throw new Error('data too long for QR versions 1-' + ECC[level].length);
    }
    var size = version * 4 + 17;
    var totalData = dataCodewordCount(version, level);

    // bit stream: mode indicator, length, payload, terminator, padding
    var bb = new Bits();
    bb.put(4, 4);
    bb.put(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);
    var cap = totalData * 8;
    bb.put(0, Math.min(4, cap - bb.b.length));
    while (bb.b.length % 8 !== 0) bb.b.push(0);
    var cw = [];
    for (var k = 0; k < bb.b.length; k += 8) {
      var byte = 0;
      for (var n = 0; n < 8; n++) byte = (byte << 1) | bb.b[k + n];
      cw.push(byte);
    }
    var pad = [0xec, 0x11], p = 0;
    while (cw.length < totalData) cw.push(pad[p++ % 2]);

    // split into blocks, error-correct each, then interleave
    var infos = ECC[level][version - 1];
    var dataBlocks = [], ecBlocks = [], off = 0;
    for (var a = 0; a < infos.length; a++) {
      var nb = infos[a][0], total = infos[a][1], dataLen = infos[a][2];
      for (var b = 0; b < nb; b++) {
        var blk = cw.slice(off, off + dataLen); off += dataLen;
        dataBlocks.push(blk);
        ecBlocks.push(rsEncode(blk, total - dataLen));
      }
    }
    var out = [], maxData = 0, maxEc = 0, x;
    for (x = 0; x < dataBlocks.length; x++) {
      maxData = Math.max(maxData, dataBlocks[x].length);
      maxEc = Math.max(maxEc, ecBlocks[x].length);
    }
    for (var c1 = 0; c1 < maxData; c1++)
      for (x = 0; x < dataBlocks.length; x++)
        if (c1 < dataBlocks[x].length) out.push(dataBlocks[x][c1]);
    for (var c2 = 0; c2 < maxEc; c2++)
      for (x = 0; x < ecBlocks.length; x++)
        if (c2 < ecBlocks[x].length) out.push(ecBlocks[x][c2]);

    var stream = [];
    for (x = 0; x < out.length; x++)
      for (var s = 7; s >= 0; s--) stream.push((out[x] >>> s) & 1);
    for (var rb = remainderBits(version); rb > 0; rb--) stream.push(0);

    // lay the stream out in the two-column zigzag, skipping function modules
    var reserved = reservedMatrix(version);
    var m = [];
    for (var y = 0; y < size; y++) m.push(new Array(size).fill(false));
    drawFunctions(m, version);

    var idx = 0;
    for (var col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;   // the vertical timing column is never data
      var upward = ((col + 1) & 2) === 0;
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var dx = 0; dx < 2; dx++) {
          var cx = col - dx;
          if (reserved[row][cx]) continue;
          m[row][cx] = idx < stream.length ? stream[idx] === 1 : false;
          idx++;
        }
      }
    }

    // choose the mask that scores lowest
    var best = null, bestScore = Infinity, bestMask = 0;
    var only = (opts.mask == null) ? -1 : opts.mask;
    for (var mk = 0; mk < 8; mk++) {
      if (only >= 0 && mk !== only) continue;
      var cand = m.map(function (r) { return r.slice(); });
      for (var ry = 0; ry < size; ry++)
        for (var rx = 0; rx < size; rx++)
          if (!reserved[ry][rx] && MASKS[mk](ry, rx)) cand[ry][rx] = !cand[ry][rx];
      placeFormat(cand, level, mk);
      placeVersion(cand, version);
      var sc = penalty(cand);
      if (sc < bestScore) { bestScore = sc; best = cand; bestMask = mk; }
    }
    return { modules: best, size: size, version: version, level: level, mask: bestMask };
  }

  function toSVG(qr, opts) {
    opts = opts || {};
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#ffffff';
    var dim = qr.size + quiet * 2, d = '';
    for (var y = 0; y < qr.size; y++)
      for (var x = 0; x < qr.size; x++)
        if (qr.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR code') + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  function toCanvas(qr, opts) {
    opts = opts || {};
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var scale = opts.scale || 8;
    var dim = (qr.size + quiet * 2) * scale;
    var cv = document.createElement('canvas');
    cv.width = cv.height = dim;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opts.dark || '#000000';
    for (var y = 0; y < qr.size; y++)
      for (var x = 0; x < qr.size; x++)
        if (qr.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    return cv;
  }

  var API = { encode: encode, toSVG: toSVG, toCanvas: toCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QR = API;
})(typeof window !== 'undefined' ? window : globalThis);
