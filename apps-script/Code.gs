/**
 * Tomahawk Open — Google Sheets backend for both scoreboards:
 *   index.html       Roommates Scramble  (tabs "Events", "Courses", "Scores")
 *   setup.html       Committee setup for Roommates events and courses (needs the committee PIN)
 *   ryder-cup.html   Ryder Cup           (tabs "RC Matches", "RC Scores"; requests carry game=rc)
 *
 * Setup (once):
 *  1. Create a new Google Sheet. Extensions > Apps Script. Paste this file over Code.gs. Save.
 *  2. Pick "setup" in the function dropdown and click Run. Approve the permissions prompt.
 *  3. Project Settings > Script Properties: add COMMITTEE_PIN (never put the PIN in this file).
 *  4. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *  5. Copy the Web app URL (ends in /exec) into API_URL near the top of index.html, setup.html
 *     and ryder-cup.html.
 *
 * If you change this code later: Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 * That keeps the same /exec URL. Run setup() again after pasting a new version: it only adds what's
 * missing and never deletes scores.
 */

var SCORES = 'Scores';    // Room, Hole, Strokes, Saved at, Drive ("Name" or "Name|ghost"), Event
var EVENTS = 'Events';    // Id, Name, Date, Course, Status (live | final), Config (JSON), Updated
var COURSES = 'Courses';  // Name, Where, Par (18, comma list), Hole handicaps (18, comma list)
var CURRENT = 'CURRENT_EVENT';   // Script Property: the event index.html shows by default

// Courses written to "Courses" the first time setup() runs.
var SEED_COURSES = [
  { name: 'Meadowlands GC', place: 'Calabash, NC',
    par: [4, 4, 4, 5, 3, 4, 4, 3, 5, 4, 3, 4, 4, 5, 3, 4, 4, 5],
    hcp: [7, 5, 1, 15, 13, 3, 17, 11, 9, 12, 10, 4, 2, 14, 18, 6, 16, 8] },
  { name: 'Blackmoor GC', place: 'Murrells Inlet, SC',
    par: [4, 3, 5, 3, 4, 3, 5, 4, 4, 4, 4, 4, 5, 4, 3, 4, 3, 5],
    hcp: [10, 18, 6, 16, 2, 12, 4, 14, 8, 1, 15, 13, 7, 9, 11, 3, 17, 5] }
];

// The first event: Roommates day of the 2026 trip. setup() files every score saved before events
// existed under this id, so that round stays in the history.
var FIRST_EVENT = {
  id: '2026-10-12-roommates', name: 'Roommates Scramble', date: '2026-10-12', course: 'Meadowlands GC', status: 'final',
  rooms: [
    { id: '1707', p: ['Rock', 'Opie', 'Gumby', 'Teo'], strokes: 1.5, ghosts: 3, perSide: false, start: 1 },
    { id: '905', p: ['Fitz', 'Blanch', 'Scoobie', 'Doc'], strokes: 1.5, ghosts: 3, perSide: false, start: 1 },
    { id: '906', p: ['Moses', 'Jimmy C', 'Angelo'], strokes: 0, ghosts: 1, perSide: true, start: 1, note: 'Threesome (Chub-Rock was out): one player hit an extra ball every shot.' },
    { id: '205', p: ['Nater', 'Nooner', 'Flyin Pat', 'Ace'], strokes: 0, ghosts: 1, perSide: true, start: 1 },
    { id: '505', p: ['Fairway Ninja', 'Kripla', 'Welks', 'Kipper'], strokes: 3, ghosts: 4, perSide: false, start: 1 },
    { id: '1605', p: ['PT', 'Zen', 'Billy'], strokes: 0, ghosts: 1, perSide: true, start: 1, note: 'Threesome (Smitty was out): one player hit an extra ball every shot.' }
  ]
};

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
  if (s.getLastRow() === 0) s.appendRow(['Room', 'Hole', 'Strokes', 'Saved at', 'Drive', 'Event']);
  s.getRange('A:A').setNumberFormat('@');
  s.getRange('F:F').setNumberFormat('@');
  if (s.getRange(1, 5).getValue() === '') s.getRange(1, 5).setValue('Drive');
  if (s.getRange(1, 6).getValue() === '') s.getRange(1, 6).setValue('Event');

  var c = ss.getSheetByName(COURSES) || ss.insertSheet(COURSES);
  c.getRange('A:D').setNumberFormat('@');   // keep "4,4,5" lists as text
  if (c.getLastRow() === 0) {
    c.appendRow(['Name', 'Where', 'Par', 'Hole handicaps']);
    SEED_COURSES.forEach(function (k) { c.appendRow([k.name, k.place, k.par.join(','), k.hcp.join(',')]); });
  }

  var ev = ss.getSheetByName(EVENTS) || ss.insertSheet(EVENTS);
  ev.getRange('A:F').setNumberFormat('@');
  if (ev.getLastRow() === 0) {
    ev.appendRow(['Id', 'Name', 'Date', 'Course', 'Status', 'Config', 'Updated']);
    var course = findCourse_(FIRST_EVENT.course);
    ev.appendRow(eventRow_(FIRST_EVENT, course));
  }

  // File any score saved before events existed under the first event.
  if (s.getLastRow() > 1) {
    var n = s.getLastRow() - 1, rows = s.getRange(2, 1, n, 6).getValues(), changed = false;
    for (var i = 0; i < n; i++) {
      if (rows[i][0] !== '' && rows[i][5] === '') { s.getRange(i + 2, 6).setValue(FIRST_EVENT.id); changed = true; }
    }
    if (changed) SpreadsheetApp.flush();
  }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CURRENT)) props.setProperty(CURRENT, FIRST_EVENT.id);

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

/** Clears the scores of the CURRENT event only (other events' history is kept). Run by hand. */
function resetRound() {
  var s = SpreadsheetApp.getActive().getSheetByName(SCORES), id = currentId_();
  if (!s || s.getLastRow() < 2) return;
  var rows = s.getRange(2, 1, s.getLastRow() - 1, 6).getValues();
  for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][5]) === id) s.deleteRow(i + 2);
}

/**
 * Committee PIN for setup and Ryder Cup matchups. It lives in Script Properties
 * (Project Settings > Script Properties > COMMITTEE_PIN), never in this file: the repo is public.
 * Returns '' when the PIN matches, otherwise an error code for the page.
 */
function pinError_(pin) {
  var want = PropertiesService.getScriptProperties().getProperty('COMMITTEE_PIN');
  if (!want) return 'no_pin';
  return String(pin == null ? '' : pin).trim() === String(want).trim() ? '' : 'bad_pin';
}

/* ---------- Courses and events ---------- */

function nums_(v) { return String(v == null ? '' : v).split(',').map(function (x) { return Number(x); }); }

function readCourses_() {
  var c = SpreadsheetApp.getActive().getSheetByName(COURSES), out = [];
  if (!c || c.getLastRow() < 2) return out;
  c.getRange(2, 1, c.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (r[0] === '') return;
    out.push({ name: String(r[0]), place: String(r[1]), par: nums_(r[2]), hcp: nums_(r[3]) });
  });
  return out;
}

function findCourse_(name) {
  var key = String(name || '').trim().toLowerCase(), list = readCourses_();
  for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === key) return list[i];
  return null;
}

function courseError_(k) {
  if (!k || !String(k.name || '').trim()) return 'course_name';
  var par = k.par || [], hcp = k.hcp || [];
  if (par.length !== 18 || par.some(function (p) { return !(p >= 3 && p <= 6 && p % 1 === 0); })) return 'course_par';
  var seen = {};
  if (hcp.length !== 18 || hcp.some(function (h) { if (!(h >= 1 && h <= 18 && h % 1 === 0) || seen[h]) return true; seen[h] = 1; return false; })) return 'course_hcp';
  return '';
}

function eventRow_(e, course) {
  var cfg = { rooms: e.rooms, par: course ? course.par : [], hcp: course ? course.hcp : [], place: course ? course.place : '' };
  return [e.id, e.name, e.date, e.course, e.status || 'live', JSON.stringify(cfg), new Date()];
}

function readEvents_() {
  var ev = SpreadsheetApp.getActive().getSheetByName(EVENTS), out = [];
  if (!ev || ev.getLastRow() < 2) return out;
  ev.getRange(2, 1, ev.getLastRow() - 1, 6).getValues().forEach(function (r, i) {
    if (r[0] === '') return;
    var cfg = {};
    try { cfg = JSON.parse(String(r[5] || '{}')); } catch (err) { cfg = {}; }
    out.push({ row: i + 2, id: String(r[0]), name: String(r[1]), date: String(r[2]), course: String(r[3]),
      status: String(r[4]) === 'final' ? 'final' : 'live', place: cfg.place || '',
      par: cfg.par || [], hcp: cfg.hcp || [], rooms: cfg.rooms || [] });
  });
  return out;
}

function findEvent_(id) {
  var list = readEvents_();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function currentId_() { return PropertiesService.getScriptProperties().getProperty(CURRENT) || FIRST_EVENT.id; }

function eventPublic_(e) {
  if (!e) return null;
  return { id: e.id, name: e.name, date: e.date, course: e.course, place: e.place, status: e.status,
    par: e.par, hcp: e.hcp, rooms: e.rooms, current: e.id === currentId_() };
}

function roomsError_(rooms) {
  if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > 12) return 'rooms_count';
  var ids = {};
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i] || {}, id = String(r.id || '').trim();
    if (!id || ids[id]) return 'room_id';
    ids[id] = 1;
    var p = (r.p || []).filter(function (x) { return String(x || '').trim(); });
    if (p.length < 1 || p.length > 5) return 'room_players';
    var st = Number(r.strokes);
    if (!(st >= 0 && st <= 30) || (st * 2) % 1) return 'room_strokes';
    var g = Number(r.ghosts);
    if (!(g >= 0 && g <= 18) || g % 1) return 'room_ghosts';
  }
  return '';
}

function cleanRooms_(rooms) {
  return rooms.map(function (r) {
    var o = { id: String(r.id).trim().slice(0, 12),
      p: (r.p || []).map(function (x) { return String(x || '').trim().slice(0, 30); }).filter(String),
      strokes: Number(r.strokes) || 0, ghosts: Number(r.ghosts) || 0, perSide: !!r.perSide,
      start: Number(r.start) === 10 ? 10 : 1 };
    var note = String(r.note || '').trim().slice(0, 160);
    if (note) o.note = note;
    return o;
  });
}

function slug_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'event'; }

function listState_() {
  var events = readEvents_().map(eventPublic_).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return { events: events, courses: readCourses_(), current: currentId_() };
}

/* ---------- Web app ---------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.game === 'rc') return json_(readRc_());
  if (p.list) return json_(listState_());
  return json_(readState_(p.event));
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_json' }); }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    if (body.game === 'rc') return json_(postRc_(body));
    if (body.action === 'score' || body.action === 'clear') return json_(postScore_(body));
    var pe = pinError_(body.pin);
    if (pe) return json_({ ok: false, error: pe });
    var res = postAdmin_(body);
    if (res.ok === false) return json_(res);
    SpreadsheetApp.flush();
    var out = listState_();
    out.ok = true;
    if (res.id) out.saved = res.id;
    return json_(out);
  } finally {
    lock.releaseLock();
  }
}

function postScore_(body) {
  var ev = findEvent_(body.event ? String(body.event) : currentId_());
  if (!ev) return { ok: false, error: 'no_event' };
  if (ev.status === 'final') return { ok: false, error: 'event_final' };
  var room = String(body.room), hole = Number(body.hole);
  var known = ev.rooms.some(function (r) { return String(r.id) === room; });
  if (!known || !(hole >= 1 && hole <= 18) || hole % 1) return { ok: false, error: 'bad_hole' };
  var strokes = Number(body.strokes);
  if (body.action === 'score' && !(strokes >= 1 && strokes <= 15 && strokes % 1 === 0)) return { ok: false, error: 'bad_score' };
  var s = SpreadsheetApp.getActive().getSheetByName(SCORES);
  if (!s) return { ok: false, error: 'not_set_up' };
  var rows = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 6).getValues() : [];
  var at = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === room && Number(rows[i][1]) === hole && String(rows[i][5]) === ev.id) { at = i + 2; break; }
  }
  if (body.action === 'score') {
    var row = [room, hole, strokes, new Date(), String(body.drive == null ? '' : body.drive).slice(0, 40), ev.id];
    if (at > 0) s.getRange(at, 1, 1, 6).setValues([row]);
    else s.appendRow(row);
  } else if (at > 0) {
    s.deleteRow(at);
  }
  SpreadsheetApp.flush();
  var state = readState_(ev.id);
  state.ok = true;
  return state;
}

function postAdmin_(body) {
  var ss = SpreadsheetApp.getActive();
  if (body.action === 'checkPin') return { ok: true };
  if (body.action === 'saveCourse') {
    var k = body.course || {};
    k = { name: String(k.name || '').trim().slice(0, 60), place: String(k.place || '').trim().slice(0, 60),
      par: (k.par || []).map(Number), hcp: (k.hcp || []).map(Number) };
    var ce = courseError_(k);
    if (ce) return { ok: false, error: ce };
    var c = ss.getSheetByName(COURSES);
    if (!c) return { ok: false, error: 'not_set_up' };
    var row = [k.name, k.place, k.par.join(','), k.hcp.join(',')];
    var names = c.getLastRow() > 1 ? c.getRange(2, 1, c.getLastRow() - 1, 1).getValues() : [];
    for (var i = 0; i < names.length; i++) {
      if (String(names[i][0]).toLowerCase() === k.name.toLowerCase()) { c.getRange(i + 2, 1, 1, 4).setValues([row]); return { ok: true }; }
    }
    c.appendRow(row);
    return { ok: true };
  }
  if (body.action === 'saveEvent') {
    var e = body.event || {};
    var name = String(e.name || '').trim().slice(0, 60), date = String(e.date || '').trim();
    if (!name) return { ok: false, error: 'event_name' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'event_date' };
    var course = findCourse_(e.course);
    if (!course) return { ok: false, error: 'event_course' };
    var re = roomsError_(e.rooms);
    if (re) return { ok: false, error: re };
    var sh = ss.getSheetByName(EVENTS);
    if (!sh) return { ok: false, error: 'not_set_up' };
    var existing = e.id ? findEvent_(String(e.id)) : null;
    var id = existing ? existing.id : date + '-' + slug_(name);
    if (!existing) { var base = id, n = 2; while (findEvent_(id)) id = base + '-' + (n++); }
    var ev = { id: id, name: name, date: date, course: course.name,
      status: e.status === 'final' ? 'final' : (existing && !e.status ? existing.status : 'live'), rooms: cleanRooms_(e.rooms) };
    if (existing) sh.getRange(existing.row, 1, 1, 7).setValues([eventRow_(ev, course)]);
    else sh.appendRow(eventRow_(ev, course));
    if (body.makeCurrent) PropertiesService.getScriptProperties().setProperty(CURRENT, id);
    return { ok: true, id: id };
  }
  if (body.action === 'setStatus' || body.action === 'setCurrent') {
    var target = findEvent_(String(body.id || ''));
    if (!target) return { ok: false, error: 'no_event' };
    if (body.action === 'setCurrent') { PropertiesService.getScriptProperties().setProperty(CURRENT, target.id); return { ok: true, id: target.id }; }
    ss.getSheetByName(EVENTS).getRange(target.row, 5).setValue(body.status === 'final' ? 'final' : 'live');
    return { ok: true, id: target.id };
  }
  return { ok: false, error: 'bad_action' };
}

function readState_(id) {
  var ev = findEvent_(id ? String(id) : currentId_()) || (id ? null : findEvent_(FIRST_EVENT.id));
  var out = { event: eventPublic_(ev), scores: {}, drives: {}, updated: null };
  if (!ev) return out;
  ev.rooms.forEach(function (r) { out.scores[r.id] = {}; out.drives[r.id] = {}; });
  var s = SpreadsheetApp.getActive().getSheetByName(SCORES);
  if (s && s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (String(r[5]) !== ev.id) return;
      var room = String(r[0]), hole = Number(r[1]), v = Number(r[2]);
      if (!out.scores[room] || !(hole >= 1 && hole <= 18) || !v) return;
      out.scores[room][hole] = v;
      if (r[4] !== '' && r[4] != null) out.drives[room][hole] = String(r[4]);
      var when = r[3] instanceof Date ? r[3].toISOString() : null;
      if (when && (!out.updated || when > out.updated)) out.updated = when;
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
    var pe = pinError_(body.pin);
    if (pe) return { ok: false, error: pe };
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
