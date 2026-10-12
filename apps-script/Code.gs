/**
 * Tomahawk Open — Google Sheets backend for both scoreboards:
 *   index.html       Roommates Scramble  (tabs "Scores", "Ticks")
 *   ryder-cup.html   Ryder Cup           (tabs "RC Matches", "RC Scores"; requests carry game=rc)
 *
 * Setup (once):
 *  1. Create a new Google Sheet. Extensions > Apps Script. Paste this file over Code.gs. Save.
 *  2. Pick "setup" in the function dropdown and click Run. Approve the permissions prompt.
 *  3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *  4. Copy the Web app URL (ends in /exec) into API_URL near the top of index.html and ryder-cup.html.
 *
 * If you change this code later: Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 * That keeps the same /exec URL. Run setup() again after pasting a new version: it only adds missing tabs.
 */

var ROOMS = ['1707', '905', '906', '205', '505', '1605'];
var SCORES = 'Scores';
var TICKS = 'Ticks';

var RC_MATCHES = 'RC Matches';
var RC_SCORES = 'RC Scores';
// Starting matchups, written to "RC Matches" by setup() only when that tab is new. Edit the tab
// (or use "Set up the 6 matches" on the page) to change them later.
var RC_DEFAULT = [
  ['White', 'Angelo', 'Kurt', 'Nate', 'Brad'],
  ['White', 'Chris W.', 'Noonan', 'Rock', 'Edwin'],
  ['White', 'Jimmy C.', 'Pat Ryan', 'Opie', 'Chris S.'],
  ['Gold', 'Kissick', 'Zen', 'Pat B.', 'Gumby'],
  ['Gold', 'Tony', 'Keith', 'Paul', 'Kip'],
  ['Gold', 'Teo', 'Gary H.', 'Fitz', 'Welks']
];

function setup() {
  var ss = SpreadsheetApp.getActive();
  var s = ss.getSheetByName(SCORES) || ss.insertSheet(SCORES);
  if (s.getLastRow() === 0) s.appendRow(['Room', 'Hole', 'Strokes', 'Saved at']);
  var t = ss.getSheetByName(TICKS) || ss.insertSheet(TICKS);
  if (t.getLastRow() === 0) {
    t.appendRow(['Room', 'Ticks']);
    ROOMS.forEach(function (r) { t.appendRow([r, 0]); });
  }
  s.getRange('A:A').setNumberFormat('@');
  t.getRange('A:A').setNumberFormat('@');

  var m = ss.getSheetByName(RC_MATCHES) || ss.insertSheet(RC_MATCHES);
  if (m.getLastRow() === 0) {
    m.appendRow(['Match', 'Tees', 'Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Red tees off on 7 (1 or 2)', 'Blue tees off on 7 (1 or 2)']);
    RC_DEFAULT.forEach(function (d, i) { m.appendRow([i + 1, d[0], d[1], d[2], d[3], d[4], 1, 1]); });
  }
  var rs = ss.getSheetByName(RC_SCORES) || ss.insertSheet(RC_SCORES);
  if (rs.getLastRow() === 0) rs.appendRow(['Match', 'Hole', 'Red', 'Blue', 'Saved at']);
}

/** Clears every Ryder Cup hole score (keeps the matchups). Run by hand from the editor. */
function resetRyderCup() {
  var rs = SpreadsheetApp.getActive().getSheetByName(RC_SCORES);
  if (rs && rs.getLastRow() > 1) rs.deleteRows(2, rs.getLastRow() - 1);
}

/** Clears every score and tick. Run by hand from the editor before a new round. */
function resetRound() {
  var ss = SpreadsheetApp.getActive();
  var s = ss.getSheetByName(SCORES);
  if (s && s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 4).clearContent();
  var t = ss.getSheetByName(TICKS);
  if (t && t.getLastRow() > 1) t.getRange(2, 2, t.getLastRow() - 1, 1).setValue(0);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.game === 'rc') return json_(readRc_());
  return json_(readState_());
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_json' }); }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    if (body.game === 'rc') return json_(postRc_(body));
    var ss = SpreadsheetApp.getActive();
    if (body.action === 'score' || body.action === 'clear') {
      var room = String(body.room), hole = Number(body.hole);
      if (ROOMS.indexOf(room) < 0 || !(hole >= 1 && hole <= 18) || hole % 1) return json_({ ok: false, error: 'bad_hole' });
      var strokes = Number(body.strokes);
      if (body.action === 'score' && !(strokes >= 1 && strokes <= 15 && strokes % 1 === 0)) return json_({ ok: false, error: 'bad_score' });
      var s = ss.getSheetByName(SCORES);
      var rows = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 2).getValues() : [];
      var at = -1;
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === room && Number(rows[i][1]) === hole) { at = i + 2; break; }
      }
      if (body.action === 'score') {
        var row = [room, hole, strokes, new Date()];
        if (at > 0) s.getRange(at, 1, 1, 4).setValues([row]);
        else s.appendRow(row);
      } else if (at > 0) {
        s.deleteRow(at);
      }
    } else if (body.action === 'ticks') {
      var t = ss.getSheetByName(TICKS);
      var data = body.ticks || {};
      var trows = t.getLastRow() > 1 ? t.getRange(2, 1, t.getLastRow() - 1, 1).getValues() : [];
      ROOMS.forEach(function (r) {
        var n = Math.max(0, Math.min(18, Math.round(Number(data[r]) || 0)));
        var idx = -1;
        for (var j = 0; j < trows.length; j++) if (String(trows[j][0]) === r) { idx = j + 2; break; }
        if (idx > 0) t.getRange(idx, 2).setValue(n);
        else t.appendRow([r, n]);
      });
    } else {
      return json_({ ok: false, error: 'bad_action' });
    }
    SpreadsheetApp.flush();
    var state = readState_();
    state.ok = true;
    return json_(state);
  } finally {
    lock.releaseLock();
  }
}

function readState_() {
  var ss = SpreadsheetApp.getActive();
  var out = { scores: {}, ticks: {}, updated: null };
  ROOMS.forEach(function (r) { out.scores[r] = {}; out.ticks[r] = 0; });
  var s = ss.getSheetByName(SCORES);
  if (s && s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 4).getValues().forEach(function (r) {
      var room = String(r[0]), hole = Number(r[1]), v = Number(r[2]);
      if (!out.scores[room] || !(hole >= 1 && hole <= 18) || !v) return;
      out.scores[room][hole] = v;
      var when = r[3] instanceof Date ? r[3].toISOString() : null;
      if (when && (!out.updated || when > out.updated)) out.updated = when;
    });
  }
  var t = ss.getSheetByName(TICKS);
  if (t && t.getLastRow() > 1) {
    t.getRange(2, 1, t.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (out.ticks.hasOwnProperty(String(r[0]))) out.ticks[String(r[0])] = Number(r[1]) || 0;
    });
  }
  return out;
}

/* ---------- Ryder Cup ---------- */

function postRc_(body) {
  var ss = SpreadsheetApp.getActive();
  if (body.action === 'score' || body.action === 'clear') {
    var match = Number(body.match), hole = Number(body.hole);
    if (!(match >= 1 && match <= 6) || match % 1 || !(hole >= 1 && hole <= 18) || hole % 1) return { ok: false, error: 'bad_hole' };
    var red = Number(body.red), blue = Number(body.blue);
    var good = function (v) { return v >= 1 && v <= 15 && v % 1 === 0; };
    if (body.action === 'score' && !(good(red) && good(blue))) return { ok: false, error: 'bad_score' };
    var s = ss.getSheetByName(RC_SCORES);
    if (!s) return { ok: false, error: 'not_set_up' };
    var rows = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 2).getValues() : [];
    var at = -1;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i][0]) === match && Number(rows[i][1]) === hole) { at = i + 2; break; }
    }
    if (body.action === 'score') {
      var row = [match, hole, red, blue, new Date()];
      if (at > 0) s.getRange(at, 1, 1, 5).setValues([row]);
      else s.appendRow(row);
    } else if (at > 0) {
      s.deleteRow(at);
    }
  } else if (body.action === 'matches') {
    var m = ss.getSheetByName(RC_MATCHES);
    if (!m) return { ok: false, error: 'not_set_up' };
    var list = body.matches || [];
    if (list.length !== 6) return { ok: false, error: 'bad_matches' };
    var name = function (v) { return String(v == null ? '' : v).slice(0, 40); };
    var out = list.map(function (d, i) {
      d = d || {};
      var red = d.red || [], blue = d.blue || [];
      return [i + 1, name(d.tees), name(red[0]), name(red[1]), name(blue[0]), name(blue[1]),
        Number(d.redAlt) === 1 ? 2 : 1, Number(d.blueAlt) === 1 ? 2 : 1];
    });
    m.getRange(2, 1, 6, 8).setValues(out);
  } else {
    return { ok: false, error: 'bad_action' };
  }
  SpreadsheetApp.flush();
  var state = readRc_();
  state.ok = true;
  return state;
}

function readRc_() {
  var ss = SpreadsheetApp.getActive();
  var out = { matches: [], updated: null };
  for (var i = 0; i < 6; i++) {
    var d = RC_DEFAULT[i];
    out.matches.push({ tees: d[0], red: [d[1], d[2]], blue: [d[3], d[4]], redAlt: 0, blueAlt: 0, scores: {} });
  }
  var m = ss.getSheetByName(RC_MATCHES);
  if (m && m.getLastRow() > 1) {
    m.getRange(2, 1, Math.min(6, m.getLastRow() - 1), 8).getValues().forEach(function (r) {
      var k = Number(r[0]) - 1;
      if (!(k >= 0 && k < 6)) return;
      out.matches[k] = {
        tees: String(r[1]), red: [String(r[2]), String(r[3])], blue: [String(r[4]), String(r[5])],
        redAlt: Number(r[6]) === 2 ? 1 : 0, blueAlt: Number(r[7]) === 2 ? 1 : 0, scores: {}
      };
    });
  }
  var s = ss.getSheetByName(RC_SCORES);
  if (s && s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 5).getValues().forEach(function (r) {
      var k = Number(r[0]) - 1, hole = Number(r[1]), red = Number(r[2]), blue = Number(r[3]);
      if (!(k >= 0 && k < 6) || !(hole >= 1 && hole <= 18) || !red || !blue) return;
      out.matches[k].scores[hole] = { r: red, b: blue };
      var when = r[4] instanceof Date ? r[4].toISOString() : null;
      if (when && (!out.updated || when > out.updated)) out.updated = when;
    });
  }
  return out;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
