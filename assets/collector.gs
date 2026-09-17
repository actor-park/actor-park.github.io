/**
 * collector.gs — optional visit collector for the Ji-oh Park profile site.
 *
 * Without this, visit logs live only in each visitor's own browser, so the
 * admin page can only ever show that one device. Deploying this script gives
 * you real cumulative stats across every visitor.
 *
 * Setup (four steps, about two minutes):
 *   1. Create a Google Sheet, then from inside it: Extensions -> Apps Script.
 *      Paste this file over whatever is there.
 *   2. Set SHARED_TOKEN below to any long random string.
 *   3. Deploy -> New deployment -> Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL it gives you.
 *   4. In assets/js/config.js set endpoint to that URL and token to the same
 *      SHARED_TOKEN.
 *
 * Opening the script from inside the Sheet binds it to that Sheet, so there is
 * no ID to copy. SHEET_ID below is only needed if you instead created a
 * standalone script (Apps Script -> New project), which is not the easy path.
 *
 * The token keeps casual readers out of the log; it is visible in the page
 * source, so treat these stats as non-sensitive.
 */

var SHARED_TOKEN = 'PUT_A_LONG_RANDOM_TOKEN_HERE';
var SHEET_ID     = '';   // leave empty for a script opened from inside the Sheet
var SHEET_NAME   = 'visits';
var MAX_RETURN   = 20000;

var COLUMNS = ['t', 'p', 'src', 'ref', 'd', 'b', 'os', 'lang', 'sw', 'vid', 'nv', 'tz'];

function sheet_() {
  // A container-bound script already knows its Sheet; SHEET_ID is the fallback
  // for a standalone script.
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet. Open Apps Script from inside the Sheet, or set SHEET_ID.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS);
  }
  return sh;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.token) !== SHARED_TOKEN) return json_({ ok: false, error: 'bad token' });
    var v = body.visit || {};
    var row = COLUMNS.map(function (c) { return v[c] === undefined ? '' : v[c]; });
    sheet_().appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (String(p.token) !== SHARED_TOKEN) return json_({ ok: false, error: 'bad token' });
  if (p.action !== 'list') return json_({ ok: true, hint: 'use ?action=list&token=...' });

  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return json_({ visits: [] });
  var first = Math.max(2, last - MAX_RETURN + 1);
  var values = sh.getRange(first, 1, last - first + 1, COLUMNS.length).getValues();
  var visits = values.map(function (r) {
    var o = {};
    COLUMNS.forEach(function (c, i) { o[c] = r[i]; });
    o.t = Number(o.t);
    return o;
  }).filter(function (o) { return !!o.t; });
  return json_({ visits: visits });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
