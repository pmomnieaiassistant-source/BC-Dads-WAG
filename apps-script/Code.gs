// ================================================================
// BC Dads WAG - v7 backend
// Version: Nov 22, 2026 - v8.6
//   - v8.6: audit fixes: new people start fresh this week, one read per tab while building the app's data
//   - v8.5: custom pots, admin Settings + share links, quiet admin edits / workouts for others, head-to-head bets close when decided, photos on bets
//   - v8.4: a logged workout and the WHOOP workout for the same day merge into one card (WHOOP strain, heart rate, zones, calories)
//   - v8.3: payments wait for the admin to confirm; Venmo deposit; pot cards with who owes / paid, photos and chat; only the admin settles pots
//   - v8.2: notifications back on, sent one by one right away (no bundling); alerts for every reaction and for @tags
//   - v8.1: admin Usage report (who uses the app, who never has, who went back to texting) and Feedback inbox
//   - v8.0: last active also counts what people did in the app (comments, reactions, posts, logged workouts)
//   - v7.9: general posts (text, @tags, photo) alongside workouts; owner can delete their post
//   - v7.8: photos on workout posts (Drive folder, Photos tab). Run setupPhotos once to approve Drive access.
//   - v7.7: reactions beyond fire, last-seen, What's new messages (Updates tab)
//   - v7.6: push notifications switched off (Settings > push_enabled), queued alerts cleared hourly
//   - v7.5: phone push notifications (Push.gs), feedback from the Me tab, swipe to hide a post,
//           admin delete (Settings > admins, default Paul)
//   - v7.4: side bets match dollar for dollar (any amount, uncovered money refunded), weekly badges
//   - v7.1: profiles, badges, comment wall, who-reacted, edit posts, duplicate hiding,
//           initials column, feed safeguard, tidier menu
//   - v7.0.2: texted/old workouts show on their real date in the feed; feed holds 150 posts
//   - v7.0.1: setup stops old triggers and clears the oversized Run_Log FIRST (fixes setup timeout)
//   - WHOOP sync fixes (no login-code reuse, dead-token flag, hourly sync)
//   - Permanent Workouts store (nothing is wiped on disconnect)
//   - JSON API for the phone app (feed, tracker, bets/bank, challenges)
//   - Twilio text log kept as a backup source
// This ONE file replaces Code.gs, webapp.gs, appsheet_v6_bridge.gs and Index.html.
// ================================================================

var V7_VERSION = '8.9';
var SB_GRACE_MIN = 90;            // side bets: how long after a period ends before a "didn't happen" is paid out (lets late WHOOP data arrive)
var APP_SYNC_COOLDOWN_MIN = 5;   // the in-app Sync button pulls WHOOP at most this often, for the whole group

var WHOOP_AUTH_URL  = 'https://api.prod.whoop.com/oauth/oauth2/auth';
var WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
var WHOOP_API_BASE  = 'https://api.prod.whoop.com/developer';
var WHOOP_SCOPES    = 'offline read:workout read:profile read:cycles';
var WHOOP_CLIENT_ID = '86eb831e-5cf7-404a-a924-6d086dad8534';

var TAB = {
  SETTINGS: 'Settings', PARTICIPANTS: 'Participants', WORKOUTS: 'Workouts',
  CYCLES: 'Cycles', EVENTS: 'Feed_Events', COMMENTS: 'Comments',
  REACTIONS: 'Reactions', POTS: 'Bet_Pots', BANK: 'Bank_Log',
  MEMBERS: 'Challenge_Members', WEIGHTS: 'Weights', RUN_LOG: 'Run_Log',
  TRACKER: 'Tracker', BETS: 'Side_Bets', WAGERS: 'Side_Wagers', FEEDBACK: 'Feedback', UPDATES: 'Updates', PHOTOS: 'Photos', CPOTS: 'Custom_Pots', CHAL: 'Custom_Challenges', CHK: 'Challenge_Checkins'
};

var HEAD = {
  Workouts: ['workout_id', 'participant_id', 'workout_date', 'workout_start', 'workout_end',
             'duration_minutes', 'strain', 'source', 'activity', 'effort', 'note', 'created_at', 'status', 'edited_at',
             'avg_hr', 'max_hr', 'kilojoules', 'distance_m', 'zones', 'link_to', 'entered_by'],
  Cycles: ['cycle_key', 'participant_id', 'cycle_date', 'strain', 'updated_at'],
  Feed_Events: ['event_id', 'created_at', 'type', 'participant_id', 'week', 'title', 'body', 'deleted'],
  Comments: ['comment_id', 'target_id', 'participant_id', 'text', 'created_at'],
  Reactions: ['target_id', 'participant_id', 'created_at', 'kind'],
  Updates: ['update_id', 'date', 'title', 'message', 'hidden_from'],
  Custom_Pots: ['pot_id', 'created_at', 'created_by', 'name', 'description', 'entry', 'status', 'members', 'joined', 'winners', 'end_amount', 'settled_by', 'settled_at'],
  Custom_Challenges: ['chal_id', 'created_at', 'created_by', 'name', 'rules', 'weeks', 'fine', 'start_date', 'status', 'members', 'joined'],
  Challenge_Checkins: ['checkin_id', 'chal_id', 'participant_id', 'week', 'answer', 'created_at'],
  Photos: ['photo_id', 'target_id', 'participant_id', 'file_id', 'created_at'],
  Bet_Pots: ['week', 'end_amount', 'members', 'settled_by', 'settled_at'],
  Bank_Log: ['entry_id', 'created_at', 'type', 'participant_id', 'week', 'amount', 'note', 'status', 'confirmed_by', 'confirmed_at'],
  Challenge_Members: ['challenge', 'participant_id', 'joined_at'],
  Weights: ['participant_id', 'date', 'weight', 'created_at'],
  Run_Log: ['timestamp', 'source_mode', 'records_imported', 'notes'],
  Side_Bets: ['bet_id', 'created_at', 'proposer', 'type', 'status', 'prompt', 'label_a', 'label_b', 'subjects_a', 'subjects_b',
              'stat', 'line', 'question', 'n', 'scoring', 'period', 'period_start', 'period_end', 'date_from', 'date_to', 'week',
              'close_at', 'hidden', 'stake', 'winner', 'settled_at', 'decided_at', 'settled_by', 'result_title', 'result_body'],
  Feedback: ['feedback_id', 'created_at', 'participant_id', 'name', 'text'],
  Side_Wagers: ['wager_id', 'bet_id', 'participant_id', 'side', 'amount', 'created_at', 'status', 'payout', 'matched']
};

var DEFAULTS = {
  min_days: '3',
  min_time: '20',
  min_effort: '8',
  challenge_start_date: '2025-09-01',
  timezone: 'America/New_York',
  bet_per_miss: '10',
  redirect_url: 'PASTE_YOUR_DEPLOYMENT_URL_HERE',
  sms_import_enabled: 'TRUE',
  sms_tracker_spreadsheet_id: '',
  sms_workout_log_tab_name: 'Workout Log',
  inactive_week_indices: '',
  app_url: '',
  bank_name: 'the bank',
  bank_start_week: '',
  sync_days: '10',
  season_weeks: '20',
  feed_show_all_whoop: 'FALSE',
  admins: 'p001',
  venmo_user: 'BC-Dads-WAG'
};


// ----------------------------------------------------------------
// SMALL HELPERS
// ----------------------------------------------------------------

function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/ /g, ' ').trim();
}

function isTrue_(v) {
  var s = str_(v).toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1' || s === 'ON';
}

function num_(v, fallback) {
  var n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function round2_(n) { return Math.round(n * 100) / 100; }

function nowIso_() { return new Date().toISOString(); }

function truncate_(s, n) {
  s = String(s || '');
  return s.length > n ? s.substring(0, n - 3) + '...' : s;
}

function shortId_() { return Utilities.getUuid().replace(/-/g, '').substring(0, 12); }

function htmlEscape_(v) {
  return str_(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- dates: everything is a 'yyyy-MM-dd' string; math is done on day numbers ----

function isoOf_(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz || 'America/New_York', 'yyyy-MM-dd');
  var s = str_(value);
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + parseInt(m[2], 10)).slice(-2) + '-' + ('0' + parseInt(m[3], 10)).slice(-2);
  var d = new Date(s);
  if (!s || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, tz || 'America/New_York', 'yyyy-MM-dd');
}

function dayNum_(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Bad date: "' + iso + '"');
  return Math.floor(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) / 86400000);
}

function isoFromDayNum_(n) {
  var d = new Date(n * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function addDays_(iso, n) { return isoFromDayNum_(dayNum_(iso) + n); }

function mdLabel_(iso) {
  var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return parseInt(m[2], 10) + '/' + parseInt(m[3], 10);
}

function dowLabel_(iso) {
  return ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'][((dayNum_(iso) % 7) + 7) % 7];
}

function todayIso_(tz) { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); }

function money_(n) {
  var r = round2_(n);
  var a = Math.abs(r);
  return (r < 0 ? '-' : '') + '$' + (a % 1 === 0 ? String(a) : a.toFixed(2));
}


// ----------------------------------------------------------------
// SHEET LAYER
// ----------------------------------------------------------------

var _ssCache = null;
function ss_() {
  if (!_ssCache) _ssCache = SpreadsheetApp.getActiveSpreadsheet();
  return _ssCache;
}

var _tabChecked = {};
function tab_(name) {
  var sh = ss_().getSheetByName(name);
  var headers = HEAD[name];
  if (!sh) {
    sh = ss_().insertSheet(name);
    if (headers) {
      if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
      sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    _tabChecked[name] = true;
  } else if (headers && !_tabChecked[name]) {
    _tabChecked[name] = true;
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      var have = sheetHeaders_(sh);
      headers.forEach(function(h) {
        if (have.indexOf(h) !== -1) return;
        var col = sh.getLastColumn() + 1;
        if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
        sh.getRange(1, col).setValue(h);
        sh.getRange(1, col).setFontWeight('bold');
        have.push(h);
      });
    }
  }
  return sh;
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  return str_(v);
}

function sheetHeaders_(sh) {
  var width = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, width).getValues()[0].map(function(h) { return str_(h).toLowerCase(); });
}

// While set, each tab is read from the Sheet once and reused (used only for read-only work such as building the
// app's data, where the same tab is needed by several parts). Rows are parsed fresh each time, so callers can change them.
var _vcache = null;
function withReadCache_(fn) {
  var had = _vcache;
  _vcache = had || {};
  try { return fn(); } finally { _vcache = had; }
}

// Returns [{header: value, ..., _row: sheetRowNumber}], all values as strings.
function readTable_(name) {
  var data = _vcache ? _vcache[name] : null;
  if (!data) {
    var sh = HEAD[name] ? tab_(name) : ss_().getSheetByName(name);
    if (!sh) return [];
    var last = sh.getLastRow();
    if (last < 2) { if (_vcache) _vcache[name] = []; return []; }
    var width = Math.max(sh.getLastColumn(), 1);
    data = sh.getRange(1, 1, last, width).getValues();
    if (_vcache) _vcache[name] = data;
  }
  if (!data.length) return [];
  var headers = data[0].map(function(h) { return str_(h).toLowerCase(); });
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var o = { _row: r + 1 };
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      o[headers[c]] = cell_(data[r][c]);
      if (o[headers[c]] !== '') any = true;
    }
    if (any) out.push(o);
  }
  return out;
}

function rowArray_(headers, obj) {
  return headers.map(function(h) {
    var v = obj[h];
    return (v === null || v === undefined) ? '' : String(v);
  });
}

function appendRows_(name, objs) {
  if (!objs || objs.length === 0) return;
  var sh = tab_(name);
  var headers = sheetHeaders_(sh);
  var rows = objs.map(function(o) { return rowArray_(headers, o); });
  var start = sh.getLastRow() + 1;
  var need = start + rows.length - 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  var range = sh.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function updateRow_(name, rowNumber, obj) {
  var sh = tab_(name);
  var headers = sheetHeaders_(sh);
  var range = sh.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([rowArray_(headers, obj)]);
}

function logRun_(mode, count, notes) {
  try {
    appendRows_(TAB.RUN_LOG, [{ timestamp: nowIso_(), source_mode: mode, records_imported: String(count || 0), notes: truncate_(notes || '', 40000) }]);
  } catch (e) {
    Logger.log('logRun_ failed: ' + e.message);
  }
}

function trimRunLog_(keep) {
  keep = keep || 500;
  var sh = ss_().getSheetByName(TAB.RUN_LOG);
  if (!sh) return 0;
  var last = sh.getLastRow();
  var extra = last - 1 - keep;
  if (extra <= 0) return 0;
  sh.deleteRows(2, extra);
  return extra;
}


// ----------------------------------------------------------------
// SETTINGS + PARTICIPANTS
// ----------------------------------------------------------------

function readSettings_() {
  var out = {};
  var sh = ss_().getSheetByName(TAB.SETTINGS);
  if (sh && sh.getLastRow() > 0) {
    var data = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    for (var i = 0; i < data.length; i++) {
      var k = str_(data[i][0]);
      if (k) out[k] = cell_(data[i][1]);
    }
  }
  for (var key in DEFAULTS) {
    if (out[key] === undefined || out[key] === '') out[key] = DEFAULTS[key];
  }
  return out;
}

function setSetting_(key, value) {
  var sh = ss_().getSheetByName(TAB.SETTINGS) || ss_().insertSheet(TAB.SETTINGS);
  var last = sh.getLastRow();
  if (last > 0) {
    var keys = sh.getRange(1, 1, last, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (str_(keys[i][0]) === key) {
        sh.getRange(i + 1, 2).setNumberFormat('@');
        sh.getRange(i + 1, 2).setValue(String(value));
        return;
      }
    }
  }
  sh.getRange(last + 1, 2).setNumberFormat('@');
  sh.getRange(last + 1, 1, 1, 2).setValues([[key, String(value)]]);
  sh.getRange(last + 1, 1).setFontWeight('bold');
}

function seedMissingSettings_() {
  var sh = ss_().getSheetByName(TAB.SETTINGS) || ss_().insertSheet(TAB.SETTINGS);
  var have = {};
  if (sh.getLastRow() > 0) {
    sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach(function(r) { have[str_(r[0])] = true; });
  }
  for (var key in DEFAULTS) {
    if (!have[key]) setSetting_(key, DEFAULTS[key]);
  }
}

function ensureParticipantCols_() {
  var sh = ss_().getSheetByName(TAB.PARTICIPANTS);
  if (!sh) throw new Error('Participants tab is missing.');
  var headers = sheetHeaders_(sh);
  ['initials', 'app_key', 'app_link'].forEach(function(h) {
    if (headers.indexOf(h) === -1) {
      var col = sh.getLastColumn() + 1;
      if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
      sh.getRange(1, col).setValue(h);
      sh.getRange(1, col).setFontWeight('bold');
      headers.push(h);
    }
  });
  return sh;
}

function readPeople_() {
  var rows = readTable_(TAB.PARTICIPANTS);
  var out = [];
  rows.forEach(function(r) {
    var pid = str_(r.participant_id);
    var name = str_(r.display_name);
    if (!pid || !name) return;
    var a = str_(r.active).toUpperCase();
    var off = {};
    str_(r.inactive_weeks).split(',').forEach(function(piece) {
      var n = parseInt(str_(piece), 10);
      if (!isNaN(n) && n > 0) off[n] = true;
    });
    out.push({
      pid: pid, name: name,
      active: a === '' || a === 'TRUE' || a === 'YES' || a === 'Y' || a === '1' || a === 'ACTIVE',
      phone: str_(r.phone), offWeeks: off, key: str_(r.app_key), initials: str_(r.initials), row: r._row
    });
  });
  return out;
}

function generateAppKeys_() {
  var sh = ensureParticipantCols_();
  var headers = sheetHeaders_(sh);
  var keyCol = headers.indexOf('app_key') + 1;
  var linkCol = headers.indexOf('app_link') + 1;
  var appUrl = str_(readSettings_().app_url);
  var made = 0;
  readPeople_().forEach(function(p) {
    var key = p.key;
    if (!key) {
      key = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
      sh.getRange(p.row, keyCol).setValue(key);
      made++;
    }
    sh.getRange(p.row, linkCol).setValue(appUrl ? appUrl + (appUrl.indexOf('?') >= 0 ? '&' : '?') + 'k=' + key : '');
  });
  return made;
}


// ----------------------------------------------------------------
// WEEKS, COMPLIANCE, TRACKER MATRIX
// ----------------------------------------------------------------

function weekStartIso_(startIso, wk) { return addDays_(startIso, (wk - 1) * 7); }

function weekOf_(iso, startIso) {
  var diff = dayNum_(iso) - dayNum_(startIso);
  if (diff < 0) return 0;
  return Math.floor(diff / 7) + 1;
}

function weekLabel_(startIso, wk) {
  var ws = weekStartIso_(startIso, wk);
  return 'Week ' + wk + ' (' + mdLabel_(ws) + '-' + mdLabel_(addDays_(ws, 6)) + ')';
}

function isCompliant_(w, minTime, minEffort) {
  var src = str_(w.source).toLowerCase();
  var dur = parseFloat(w.duration_minutes);
  if (src === 'whoop') {
    var strain = parseFloat(w.strain);
    return !isNaN(dur) && !isNaN(strain) && dur >= minTime && strain >= minEffort;
  }
  if (src === 'app') return !isNaN(dur) && dur >= minTime;
  return true; // sms backup and legacy manual logs always count
}

// One place that loads everything the rules need.
function loadCtx_() {
  var settings = readSettings_();
  var tz = settings.timezone || 'America/New_York';
  var startIso = isoOf_(settings.challenge_start_date, tz);
  var today = todayIso_(tz);
  var ctx = {
    settings: settings, tz: tz, startIso: startIso, today: today,
    minDays: parseInt(settings.min_days, 10) || 3,
    minTime: num_(settings.min_time, 20),
    minEffort: num_(settings.min_effort, 8),
    baseBet: num_(settings.bet_per_miss, 10),
    currentWeek: weekOf_(today, startIso),
    inactiveWeeks: {},
    people: readPeople_(),
    workouts: readTable_(TAB.WORKOUTS).filter(function(w) { return str_(w.status).toLowerCase() !== 'deleted'; })
  };
  str_(settings.inactive_week_indices).split(',').forEach(function(piece) {
    var n = parseInt(str_(piece), 10);
    if (!isNaN(n) && n > 0) ctx.inactiveWeeks[n] = true;
  });
  ctx.byPid = {};
  ctx.people.forEach(function(p) { ctx.byPid[p.pid] = p; });

  // credits[pid][iso] = [sources] for every day with a workout that counts
  ctx.credits = {};
  ctx.workouts.forEach(function(w) {
    w._date = isoOf_(w.workout_date, tz);
    w._ok = isCompliant_(w, ctx.minTime, ctx.minEffort);
    if (!w._ok || !w._date || !ctx.byPid[w.participant_id]) return;
    if (!ctx.credits[w.participant_id]) ctx.credits[w.participant_id] = {};
    var day = ctx.credits[w.participant_id];
    if (!day[w._date]) day[w._date] = [];
    var src = str_(w.source).toLowerCase();
    if (day[w._date].indexOf(src) === -1) day[w._date].push(src);
  });

  ctx.matrix = computeMatrix_(ctx);
  var bs = parseInt(settings.bank_start_week, 10);
  ctx.bankStartWeek = (isNaN(bs) || bs < 1) ? 1 : bs;
  return ctx;
}

function countInRange_(dayMap, fromIso, toIso) {
  if (!dayMap) return 0;
  var a = dayNum_(fromIso), b = dayNum_(toIso), n = 0;
  for (var iso in dayMap) {
    var d = dayNum_(iso);
    if (d >= a && d <= b) n++;
  }
  return n;
}

function computeMatrix_(ctx) {
  var weeks = [];
  var streak = {};
  ctx.people.forEach(function(p) { streak[p.pid] = 0; });
  var todayNum = dayNum_(ctx.today);

  for (var wk = 1; wk <= ctx.currentWeek; wk++) {
    var ws = weekStartIso_(ctx.startIso, wk);
    var we = addDays_(ws, 6);
    var isCurrent = (wk === ctx.currentWeek);
    var globalOff = !!ctx.inactiveWeeks[wk];
    var week = {
      week: wk, start: ws, end: we, label: weekLabel_(ctx.startIso, wk),
      isCurrent: isCurrent, exempt: globalOff, cells: [], inMoney: [], buying: [], betTotal: 0
    };

    ctx.people.forEach(function(p) {
      var cnt = countInRange_(ctx.credits[p.pid], ws, we);
      var cell = { pid: p.pid, count: cnt, status: '' };
      if (!p.active) {
        cell.status = 'inactive';
      } else if (globalOff || p.offWeeks[wk]) {
        cell.status = 'exempt';
        if (!globalOff) streak[p.pid] = 0;
      } else if (cnt >= ctx.minDays) {
        cell.status = 'complete';
        week.inMoney.push(p.pid);
        streak[p.pid] = 0;
      } else {
        var failed = !isCurrent;
        var dormie = false;
        if (isCurrent) {
          var needed = ctx.minDays - cnt;
          var remainingDays = Math.max(0, dayNum_(we) - todayNum + 1);
          var hasToday = !!(ctx.credits[p.pid] && ctx.credits[p.pid][ctx.today]);
          var opps = Math.max(0, remainingDays - (hasToday ? 1 : 0));
          failed = opps < needed;
          dormie = !failed && opps === needed;
          cell.needed = needed;
          cell.daysLeft = opps;
        }
        if (failed) {
          streak[p.pid] = (streak[p.pid] || 0) + 1;
          var amt = ctx.baseBet * Math.pow(2, streak[p.pid] - 1);
          cell.status = 'eliminated';
          cell.fine = amt;
          cell.streak = streak[p.pid];
          week.buying.push({ pid: p.pid, amount: amt });
          week.betTotal += amt;
        } else {
          cell.status = dormie ? 'dormie' : 'eligible';
        }
      }
      week.cells.push(cell);
    });
    weeks.push(week);
  }
  return weeks;
}

// Writes the familiar grid to the Tracker tab (for you; the dads use the app).
function writeTrackerTab_(ctx) {
  var sh = ss_().getSheetByName(TAB.TRACKER) || ss_().insertSheet(TAB.TRACKER);
  var people = ctx.people;
  var width = people.length + 4;
  var rowsNeeded = ctx.matrix.length + 1;
  if (sh.getMaxRows() < rowsNeeded) sh.insertRowsAfter(sh.getMaxRows(), rowsNeeded - sh.getMaxRows());
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  try { sh.showColumns(1, sh.getMaxColumns()); } catch (e) {}
  sh.clear();
  var COLORS = { complete: '#c6efce', eligible: '#fff2cc', dormie: '#ffd9a8', eliminated: '#ffc7ce', exempt: '#d9d9d9', inactive: '#bfbfbf' };
  var header = ['Week'].concat(people.map(function(p) { return p.name; })).concat(['In the Money', 'Buying the Bet', 'Bet Amount']);
  var vals = [header];
  var bgs = [header.map(function() { return '#ffffff'; })];
  ctx.matrix.forEach(function(w) {
    var row = [w.label], bg = ['#ffffff'];
    w.cells.forEach(function(c) {
      row.push(c.status === 'inactive' ? '' : c.count);
      bg.push(COLORS[c.status] || '#ffffff');
    });
    row.push(w.inMoney.map(function(pid) { return ctx.byPid[pid].name; }).join(', '));
    row.push(w.buying.map(function(b) { return ctx.byPid[b.pid].name + ' ($' + b.amount + ')'; }).join(', '));
    row.push(w.exempt ? '' : w.betTotal);
    bg.push('#e7f3e7'); bg.push('#fcecec'); bg.push('#fff2cc');
    vals.push(row); bgs.push(bg);
  });
  var range = sh.getRange(1, 1, vals.length, width);
  range.setValues(vals);
  range.setBackgrounds(bgs);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
}


// ----------------------------------------------------------------
// FEED EVENTS (in the money, dormie, buying the bet, nudge, recap)
// ----------------------------------------------------------------

function generateEvents_(ctx) {
  var cw = ctx.currentWeek;
  if (cw < 1) return 0;
  // Never post until setup has finished copying the season's workouts (a half-copied season makes wrong recaps).
  if (!PropertiesService.getScriptProperties().getProperty('V7_MIGRATED')) return 0;
  var existing = {};
  readTable_(TAB.EVENTS).forEach(function(e) { existing[e.event_id] = true; });
  var add = [];
  function push(id, type, pid, week, title, body) {
    if (existing[id]) return;
    existing[id] = true;
    add.push({ event_id: id, created_at: nowIso_(), type: type, participant_id: pid || '', week: String(week), title: title, body: body });
  }
  function nm(pid) { return ctx.byPid[pid] ? ctx.byPid[pid].name : pid; }

  var cur = ctx.matrix[cw - 1];
  if (cur && !cur.exempt) {
    var stillNeed = [], needPids = [];
    cur.cells.forEach(function(c) {
      var name = nm(c.pid);
      if (c.status === 'complete') {
        push('inmoney_w' + cw + '_' + c.pid, 'inmoney', c.pid, cw, name + ' is in the money',
          c.count + ' of ' + ctx.minDays + ' done for week ' + cw + '.');
      } else if (c.status === 'eliminated') {
        push('buying_w' + cw + '_' + c.pid, 'buying', c.pid, cw, name + ' is buying the bet',
          "Can't reach " + ctx.minDays + ' this week. $' + c.fine + ' to the pot' +
          (c.streak > 1 ? ' - ' + c.streak + ' weeks in a row.' : '.'));
      } else if (c.status === 'dormie') {
        stillNeed.push(name); needPids.push(c.pid);
        push('dormie_w' + cw + '_' + c.pid, 'dormie', c.pid, cw, name,
          c.count + ' of ' + ctx.minDays + ' with ' + c.daysLeft + (c.daysLeft === 1 ? ' day' : ' days') +
          ' left. Has to work out every day left this week or he buys the bet.');
      } else if (c.status === 'eligible') {
        stillNeed.push(name); needPids.push(c.pid);
      }
    });
    var hour = parseInt(Utilities.formatDate(new Date(), ctx.tz, 'H'), 10);
    if (ctx.today === cur.end && hour >= 12 && stillNeed.length > 0) {
      push('nudge_w' + cw, 'nudge', '', cw,
        stillNeed.length + (stillNeed.length === 1 ? ' guy still needs' : ' guys still need') + ' a workout today',
        stillNeed.join(', ') + ' - last day of the week.');
    }
  }

  if (cw >= 2) {
    var prev = ctx.matrix[cw - 2];
    if (prev && !prev.exempt) {
      var body = 'In the money: ' + (prev.inMoney.length ? prev.inMoney.map(nm).join(', ') : 'nobody') + '. ' +
        'Buying the bet: ' + (prev.buying.length ? prev.buying.map(function(b) { return nm(b.pid) + ' ($' + b.amount + ')'; }).join(', ') : 'nobody') + '. ' +
        'Pot: $' + prev.betTotal + '.';
      push('recap_w' + prev.week, 'recap', '', prev.week, 'Week ' + prev.week + ' recap', body);
    }
  }

  appendRows_(TAB.EVENTS, add);
  // Phone alerts for the new posts (each event is only ever created once, so each alert goes out once).
  try {
    var all = pushEveryone_(ctx);
    add.forEach(function(e) {
      if (e.type === 'dormie') {
        pushQueue_(e.participant_id, 'updates', "You're dormie", e.body);
        pushToPeople_(all, 'updates', 'Dormie', e.title + ': ' + e.body, e.participant_id);
      } else if (e.type === 'buying') pushToPeople_(all, 'updates', e.title, e.body);
      else if (e.type === 'recap') pushToPeople_(all, 'updates', e.title, e.body);
      else if (e.type === 'nudge') pushToPeople_(needPids, 'updates', 'Last day to get one in', e.body);
    });
  } catch (pe) { Logger.log('push events: ' + pe.message); }
  return add.length;
}


// ----------------------------------------------------------------
// WHOOP - tokens
// ----------------------------------------------------------------

function getRedirectUri_() {
  var url = str_(readSettings_().redirect_url);
  if (!url || url === 'PASTE_YOUR_DEPLOYMENT_URL_HERE') {
    throw new Error('redirect_url is not set in the Settings tab.');
  }
  return url;
}

function getWhoopClientSecret_() {
  var prop = str_(PropertiesService.getScriptProperties().getProperty('WHOOP_CLIENT_SECRET'));
  if (prop) return prop;
  var fromSettings = str_(readSettings_().whoop_client_secret);
  if (fromSettings) return fromSettings;
  throw new Error('WHOOP client secret is missing. Use BC Dads > Store WHOOP client secret.');
}

function tokenKey_(pid) { return 'whoop_token_' + str_(pid); }

function getTokens_(pid) {
  var raw = PropertiesService.getScriptProperties().getProperty(tokenKey_(pid));
  if (!raw) return null;
  try {
    var t = JSON.parse(raw);
    if (!t || (!t.access_token && !t.refresh_token)) return null;
    return t;
  } catch (e) { return null; }
}

function saveTokens_(pid, tokenData, extra) {
  var t = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_in: tokenData.expires_in,
    scope: tokenData.scope,
    saved_at: Math.floor(Date.now() / 1000)
  };
  if (extra) { for (var k in extra) t[k] = extra[k]; }
  PropertiesService.getScriptProperties().setProperty(tokenKey_(pid), JSON.stringify(t));
}

function markTokenDead_(pid, reason) {
  var t = getTokens_(pid);
  if (!t) return;
  t.dead = true;
  t.dead_reason = truncate_(reason, 300);
  t.dead_at = nowIso_();
  PropertiesService.getScriptProperties().setProperty(tokenKey_(pid), JSON.stringify(t));
  logRun_('whoop_needs_reconnect', 0, 'participant_id=' + pid + ' | ' + reason);
}

function whoopStatus_(pid) {
  var t = getTokens_(pid);
  if (!t) return 'none';
  return t.dead ? 'reconnect' : 'connected';
}

function buildAuthUrl_(pid) {
  var params = {
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: getRedirectUri_(),
    response_type: 'code',
    scope: WHOOP_SCOPES,
    state: ('enroll_' + str_(pid)).substring(0, 32)
  };
  return WHOOP_AUTH_URL + '?' + Object.keys(params).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function tokenRequest_(payload) {
  try {
    var resp = UrlFetchApp.fetch(WHOOP_TOKEN_URL, {
      method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: payload, muteHttpExceptions: true
    });
    return { code: resp.getResponseCode(), body: resp.getContentText() };
  } catch (e) {
    return { code: 0, body: String(e && e.message || e) };
  }
}

// Returns an access token or null. Callers must already hold the script lock.
// A rejected refresh (400/401) marks the connection dead so we stop hammering WHOOP.
// A WHOOP outage (5xx / timeout) leaves the tokens alone and simply tries again next hour.
function getAccessToken_(pid, forceRefresh) {
  var t = getTokens_(pid);
  if (!t || t.dead) return null;
  var now = Math.floor(Date.now() / 1000);
  var fresh = now <= (t.saved_at || 0) + (t.expires_in || 3600) - 300;
  if (fresh && t.access_token && !forceRefresh) return t.access_token;
  if (!t.refresh_token) { markTokenDead_(pid, 'no refresh token saved'); return null; }

  var r = tokenRequest_({
    grant_type: 'refresh_token', refresh_token: t.refresh_token,
    client_id: WHOOP_CLIENT_ID, client_secret: getWhoopClientSecret_(), scope: 'offline'
  });
  if (r.code === 200) {
    var fresh2;
    try { fresh2 = JSON.parse(r.body); } catch (e) { fresh2 = null; }
    if (fresh2 && fresh2.access_token) {
      if (!fresh2.refresh_token) fresh2.refresh_token = t.refresh_token;
      saveTokens_(pid, fresh2, t.needs_backfill ? { needs_backfill: true } : null);
      return fresh2.access_token;
    }
    return null;
  }
  if (r.code === 400 || r.code === 401) {
    markTokenDead_(pid, 'refresh rejected (' + r.code + '): ' + truncate_(r.body, 200));
  } else {
    logRun_('whoop_refresh_retry_later', 0, 'participant_id=' + pid + ' | code=' + r.code + ' | ' + truncate_(r.body, 200));
  }
  return null;
}


// ----------------------------------------------------------------
// WHOOP - data pulls
// ----------------------------------------------------------------

function whoopGet_(url, token) {
  try {
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return { code: resp.getResponseCode(), body: resp.getContentText() };
  } catch (e) {
    return { code: 0, body: String(e && e.message || e) };
  }
}

// Pages through a WHOOP collection. Returns {ok, records, code, body}.
function whoopCollection_(path, startIso, endIso, token) {
  var records = [];
  var next = '';
  for (var page = 1; page <= 40; page++) {
    var qs = 'start=' + encodeURIComponent(startIso + 'T00:00:00.000Z') +
      '&end=' + encodeURIComponent(endIso + 'T23:59:59.999Z') + '&limit=25' +
      (next ? '&nextToken=' + encodeURIComponent(next) : '');
    var r = whoopGet_(WHOOP_API_BASE + path + '?' + qs, token);
    if (r.code !== 200) return { ok: false, records: records, code: r.code, body: r.body };
    var data;
    try { data = JSON.parse(r.body || '{}'); } catch (e) { return { ok: false, records: records, code: -1, body: 'bad JSON' }; }
    (data.records || []).forEach(function(x) { records.push(x); });
    next = data.next_token || '';
    if (!next) break;
  }
  return { ok: true, records: records, code: 200, body: '' };
}

function syncWhoop_(ctx, fullForAll) {
  var summary = [];
  var existing = {};
  readTable_(TAB.WORKOUTS).forEach(function(w) { existing[w.workout_id] = w; });
  var cycleRows = {};
  readTable_(TAB.CYCLES).forEach(function(c) { cycleRows[c.cycle_key] = c; });
  var addW = [], addC = [], changed = 0;
  var syncDays = parseInt(ctx.settings.sync_days, 10) || 10;

  ctx.people.forEach(function(p) {
    if (!p.active) return;
    var t = getTokens_(p.pid);
    if (!t) return;
    if (t.dead) { summary.push(p.name + ': needs_reconnect'); return; }

    var token = getAccessToken_(p.pid, false);
    if (!token) { summary.push(p.name + ': no_token'); return; }

    var full = fullForAll || !!t.needs_backfill;
    var fromIso = full ? ctx.startIso : addDays_(ctx.today, -syncDays);
    if (dayNum_(fromIso) < dayNum_(ctx.startIso)) fromIso = ctx.startIso;
    var qStart = addDays_(fromIso, -1);
    var qEnd = addDays_(ctx.today, 1);

    var res = whoopCollection_('/v2/activity/workout', qStart, qEnd, token);
    if (!res.ok && res.code === 401) {
      // One forced refresh, then one retry. If WHOOP still says no, flag for reconnect.
      token = getAccessToken_(p.pid, true);
      if (token) res = whoopCollection_('/v2/activity/workout', qStart, qEnd, token);
      if (!token || (!res.ok && res.code === 401)) {
        if (whoopStatus_(p.pid) === 'connected') markTokenDead_(p.pid, 'API 401 after refresh');
        summary.push(p.name + ': needs_reconnect');
        return;
      }
    }
    if (!res.ok) {
      summary.push(p.name + ': error_' + res.code + ' ' + truncate_(res.body, 80));
      return;
    }

    var added = 0;
    res.records.forEach(function(w) {
      var id = String(w.id || w.v1_id || '');
      if (!id || !w.start) return;
      var date = isoOf_(new Date(w.start), ctx.tz);
      if (!date || dayNum_(date) < dayNum_(ctx.startIso)) return;
      var dur = '';
      if (w.end) {
        var ms = new Date(w.end).getTime() - new Date(w.start).getTime();
        if (!isNaN(ms)) dur = String(Math.round(ms / 60000 * 10) / 10);
      }
      var strain = '';
      if (w.score_state === 'SCORED' && w.score && w.score.strain !== undefined && w.score.strain !== null) {
        strain = String(Math.round(w.score.strain * 100) / 100);
      }
      // Heart rate, calories, distance and time in each heart rate zone (zone minutes: zone 0 through 5).
      var sc = (w.score_state === 'SCORED' && w.score) ? w.score : {}, zd = sc.zone_durations || {};
      function numStr(v, d) { return v === undefined || v === null || v === '' || isNaN(Number(v)) ? '' : String(Math.round(Number(v) * d) / d); }
      var zonesStr = ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli']
        .map(function(k) { return numStr(zd[k] === undefined || zd[k] === null ? '' : zd[k] / 60000, 10); }).join(',');
      if (zonesStr === ',,,,,') zonesStr = '';
      var row = {
        workout_id: id, participant_id: p.pid, workout_date: date,
        workout_start: w.start, workout_end: w.end || '', duration_minutes: dur, strain: strain,
        source: 'whoop', activity: str_(w.sport_name || 'workout'), effort: '', note: '',
        created_at: w.end || w.start, status: 'active',
        avg_hr: numStr(sc.average_heart_rate, 1), max_hr: numStr(sc.max_heart_rate, 1), kilojoules: numStr(sc.kilojoule, 10),
        distance_m: numStr(sc.distance_meter, 1), zones: zonesStr
      };
      var old = existing[id];
      if (!old) {
        addW.push(row); existing[id] = row; added++;
      } else if (old._row && str_(old.status).toLowerCase() !== 'deleted' &&
                 (str_(old.strain) !== strain || str_(old.duration_minutes) !== dur || isoOf_(old.workout_date, ctx.tz) !== date ||
                  str_(old.avg_hr) !== row.avg_hr || str_(old.zones) !== row.zones || str_(old.kilojoules) !== row.kilojoules)) {
        row.note = old.note || ''; row.edited_at = old.edited_at || ''; row.created_at = old.created_at || row.created_at;
        updateRow_(TAB.WORKOUTS, old._row, row);
        changed++;
      }
    });

    // Day strain (for the weekly Strain leaderboard). Never allowed to break the workout sync.
    try {
      var cres = whoopCollection_('/v2/cycle', qStart, qEnd, token);
      if (cres.ok) {
        cres.records.forEach(function(c) {
          if (!c.start || c.score_state !== 'SCORED' || !c.score || c.score.strain === undefined || c.score.strain === null) return;
          // A WHOOP "day" starts when you fall asleep the night before, so date it 12 hours after its start.
          var cdate = isoOf_(new Date(new Date(c.start).getTime() + 12 * 3600000), ctx.tz);
          var key = p.pid + '|' + String(c.id);
          var val = String(Math.round(c.score.strain * 100) / 100);
          var crow = { cycle_key: key, participant_id: p.pid, cycle_date: cdate, strain: val, updated_at: nowIso_() };
          var oldC = cycleRows[key];
          if (!oldC) { addC.push(crow); cycleRows[key] = crow; }
          else if (oldC._row && str_(oldC.strain) !== val) { updateRow_(TAB.CYCLES, oldC._row, crow); }
        });
      }
    } catch (cycErr) {
      Logger.log('cycle sync failed for ' + p.pid + ': ' + cycErr.message);
    }

    if (t.needs_backfill) {
      var t2 = getTokens_(p.pid);
      if (t2) { delete t2.needs_backfill; PropertiesService.getScriptProperties().setProperty(tokenKey_(p.pid), JSON.stringify(t2)); }
    }
    summary.push(p.name + ': ok fetched=' + res.records.length + ' new=' + added + (full ? ' (full)' : ''));
  });

  appendRows_(TAB.WORKOUTS, addW);
  appendRows_(TAB.CYCLES, addC);
  return { added: addW.length, changed: changed, summary: summary };
}


// ----------------------------------------------------------------
// TWILIO TEXT LOG (backup source)
// ----------------------------------------------------------------

function normalizePhone_(phone) {
  var raw = str_(phone);
  if (!raw) return '';
  var digits = raw.replace(/\D/g, '');
  if (raw.charAt(0) === '+' && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return '';
}

function syncSms_(ctx) {
  var s = ctx.settings;
  if (!isTrue_(s.sms_import_enabled)) return { added: 0, note: 'off' };
  var raw = str_(s.sms_tracker_spreadsheet_id);
  var m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  var id = m ? m[1] : raw;
  if (!id) return { added: 0, note: 'no sms sheet id' };

  var byPhone = {};
  ctx.people.forEach(function(p) {
    var ph = normalizePhone_(p.phone);
    if (p.active && ph && !byPhone[ph]) byPhone[ph] = p;
  });

  var sh = SpreadsheetApp.openById(id).getSheetByName(str_(s.sms_workout_log_tab_name) || 'Workout Log');
  if (!sh || sh.getLastRow() < 2) return { added: 0, note: 'no sms rows' };
  var rows = sh.getRange(1, 1, sh.getLastRow(), Math.max(8, sh.getLastColumn())).getValues();
  var hmap = {};
  rows[0].forEach(function(h, i) { var k = str_(h).toLowerCase(); if (k) hmap[k] = i; });
  function col(names, fallback) {
    for (var i = 0; i < names.length; i++) { if (hmap[names[i]] !== undefined) return hmap[names[i]]; }
    return fallback;
  }
  var iPhone = col(['phone'], 2), iDate = col(['date'], 3), iWorked = col(['worked out?', 'worked out', 'worked_out'], 5);

  var existing = {};
  readTable_(TAB.WORKOUTS).forEach(function(w) { existing[w.workout_id] = true; });
  var add = [];
  var startNum = dayNum_(ctx.startIso), todayNum = dayNum_(ctx.today);
  for (var r = 1; r < rows.length; r++) {
    var worked = str_(rows[r][iWorked]).toUpperCase();
    if (!(worked === 'Y' || worked === 'YES' || worked === 'TRUE' || worked === '1')) continue;
    var date = isoOf_(rows[r][iDate], ctx.tz);
    if (!date) continue;
    var dn = dayNum_(date);
    if (dn < startNum || dn > todayNum) continue;
    var p = byPhone[normalizePhone_(rows[r][iPhone])];
    if (!p) continue;
    var wid = 'sms_' + p.pid + '_' + date;
    if (existing[wid]) continue;
    existing[wid] = true;
    add.push({
      workout_id: wid, participant_id: p.pid, workout_date: date, workout_start: '', workout_end: '',
      duration_minutes: '', strain: '', source: 'sms', activity: 'Texted in', effort: '', note: '',
      created_at: nowIso_(), status: 'active'
    });
  }
  appendRows_(TAB.WORKOUTS, add);
  return { added: add.length, note: '' };
}


// ----------------------------------------------------------------
// SYNC ENTRY POINTS
// ----------------------------------------------------------------

function runSync_(mode, fullWhoop) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) { logRun_(mode + '_skipped', 0, 'another run was in progress'); return null; }
  var started = Date.now();
  try {
    try { ensureParticipantCols_(); } catch (colErr) {}
    try { pushPurge_(); } catch (pushErr) {}
    var ctx = loadCtx_();
    var whoop = { added: 0, changed: 0, summary: [] };
    if (ctx.currentWeek >= 1) whoop = syncWhoop_(ctx, fullWhoop);
    var sms = { added: 0, note: '' };
    try { sms = syncSms_(ctx); } catch (smsErr) { sms = { added: 0, note: 'sms error: ' + smsErr.message }; }

    ctx = loadCtx_();
    var events = generateEvents_(ctx);
    try { events += settleSideBets_(ctx); } catch (sbErr) { Logger.log('side bets: ' + sbErr.message); }
    try { events += generateBadgeEvents_(ctx).length; } catch (bErr) { Logger.log('badge events: ' + bErr.message); }
    writeTrackerTab_(ctx);
    var note = 'whoop_new=' + whoop.added + '; whoop_updated=' + whoop.changed + '; sms_new=' + sms.added +
      (sms.note ? ' (' + sms.note + ')' : '') + '; events=' + events +
      '; seconds=' + Math.round((Date.now() - started) / 1000) + '; ' + whoop.summary.join(' | ');
    logRun_(mode, whoop.added + sms.added, note);
    trimRunLog_(500);
    try { PropertiesService.getScriptProperties().setProperty('LAST_SYNC_AT', nowIso_()); } catch (pErr) {}
    return { whoop: whoop, sms: sms, events: events };
  } catch (err) {
    logRun_(mode + '_error', 0, String(err && err.message || err));
    throw err;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
    pushSendQueued_();
  }
}

// Runs on the hourly trigger.
function hourlySync() { runSync_('sync', false); }

// Old trigger name from v6. Kept so a leftover trigger cannot throw errors.
function runWhoopAuto() { runSync_('sync', false); }


// ----------------------------------------------------------------
// WEB APP - WHOOP connect pages + JSON API
// ----------------------------------------------------------------

function page_(title, color, bodyHtml) {
  return HtmlService.createHtmlOutput(
    '<html><head><base target="_top"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:-apple-system,Arial,sans-serif;padding:36px 24px;max-width:480px;margin:0 auto;text-align:center;background:#0E1013;color:#F2F3F5;">' +
    '<h2 style="color:' + color + ';">' + htmlEscape_(title) + '</h2>' + bodyHtml + '</body></html>'
  ).setTitle('BC Dads WAG').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function appLinkHtml_() {
  var url = str_(readSettings_().app_url);
  return url ? '<p><a style="color:#C8F04B;font-weight:bold;" href="' + htmlEscape_(url) + '">Back to the app</a></p>' : '';
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (str_(params.code) || str_(params.error) || str_(params.state).indexOf('enroll_') === 0) {
      return handleWhoopCallback_(params);
    }
    if (str_(params.connect)) {
      var who = null;
      readPeople_().forEach(function(p) { if (p.key && p.key === str_(params.connect)) who = p; });
      if (!who) return page_('Link not recognized', '#FF8A80', '<p>Open the app from your personal link and try again.</p>');
      return page_('Connect WHOOP', '#F2F3F5',
        '<p>Connecting as <strong>' + htmlEscape_(who.name) + '</strong>.</p>' +
        '<p><a style="display:inline-block;background:#C8F04B;color:#0E1013;font-weight:bold;padding:14px 22px;border-radius:999px;text-decoration:none;" href="' +
        htmlEscape_(buildAuthUrl_(who.pid)) + '">Continue to WHOOP</a></p>' +
        '<p style="color:#9AA1AC;font-size:14px;">Log in to WHOOP and tap Grant. When you see "Connected", close that page.</p>');
    }
  } catch (err) {
    logRun_('doGet_error', 0, String(err && err.message || err));
    return page_('Something went wrong', '#FF8A80', '<p>' + htmlEscape_(err && err.message) + '</p>');
  }
  return page_('BC Dads WAG', '#C8F04B', '<p>The tracker engine is running (v' + V7_VERSION + ').</p>' + appLinkHtml_());
}

function handleWhoopCallback_(params) {
  var code = str_(params.code);
  var state = str_(params.state);
  var error = str_(params.error);
  var pid = str_(state.replace('enroll_', ''));

  if (error) {
    logRun_('whoop_connect_error', 0, 'participant_id=' + pid + ' | whoop_error=' + error + ' | ' + str_(params.error_description));
    return page_('Authorization failed', '#FF8A80', '<p>WHOOP said: <strong>' + htmlEscape_(error) + '</strong></p><p>Open the app and tap Connect WHOOP again.</p>');
  }
  if (!code || !pid) {
    return page_('BC Dads WAG', '#F2F3F5', '<p>This page finishes WHOOP connections.</p>' + appLinkHtml_());
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // A WHOOP login code works exactly once. If this page is reloaded (phones do that with old tabs),
    // sending the same code again makes WHOOP cancel the tokens it already issued. So: never send a code twice.
    var cache = CacheService.getScriptCache();
    var codeKey = 'whoopcode_' + code.substring(0, 180);
    if (cache.get(codeKey)) {
      return page_('Already connected', '#C8F04B', '<p>This WHOOP link was already used and you are connected.</p><p>You can close this page.</p>' + appLinkHtml_());
    }
    cache.put(codeKey, '1', 21600);

    var known = false;
    readPeople_().forEach(function(p) { if (p.pid === pid) known = true; });
    if (!known) return page_('Connection failed', '#FF8A80', '<p>Unknown participant.</p>');

    var r = tokenRequest_({
      grant_type: 'authorization_code', code: code, redirect_uri: getRedirectUri_(),
      client_id: WHOOP_CLIENT_ID, client_secret: getWhoopClientSecret_()
    });
    if (r.code !== 200) {
      logRun_('whoop_connect_error', 0, 'participant_id=' + pid + ' | token exchange ' + r.code + ' | ' + truncate_(r.body, 400));
      return page_('Connection failed', '#FF8A80', '<p>WHOOP did not accept the login (' + r.code + ').</p><p>Open the app and tap Connect WHOOP to try again.</p>');
    }
    var tokens = JSON.parse(r.body);
    saveTokens_(pid, tokens, { needs_backfill: true });
    logRun_('whoop_connected', 0, 'participant_id=' + pid + ' | scope=' + str_(tokens.scope));
    return page_('Connected', '#C8F04B',
      '<p>WHOOP is linked. Your workouts will show up in the app within the hour.</p>' +
      '<p style="color:#9AA1AC;">You can close this page now.</p>' + appLinkHtml_());
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = req && req.action ? handleApi_(req) : { ok: true, ignored: true };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handleApi_(req) {
  var key = str_(req.k);
  var me = null;
  if (key) readPeople_().forEach(function(p) { if (p.key && p.key === key && p.active) me = p; });
  if (!me) return { ok: false, error: 'bad_key' };
  seenMark_(me);

  var action = str_(req.action);
  var profilePid = str_(req.profile);
  var ctx;

  // Admin only: Settings screen data and the personal links (read-only).
  if (action === 'adminSettings' || action === 'adminLinks') {
    var sctx = loadCtx_();
    if (!isAdmin_(me, sctx.settings)) return { ok: false, error: 'Only the admin can see this.' };
    return action === 'adminLinks' ? { ok: true, links: adminLinks_(sctx) } : { ok: true, admin: adminSettings_(sctx) };
  }

  // Admin only: the Usage report and the Feedback inbox (read-only).
  if (action === 'adminUsage') {
    var actx = loadCtx_();
    if (!isAdmin_(me, actx.settings)) return { ok: false, error: 'Only the admin can see this.' };
    return { ok: true, usage: buildUsage_(actx), feedback: feedbackList_() };
  }

  // Small actions that never touch the tracker data: no recalculation, quick answer.
  var LIGHT = { adminSet: apiAdminSet_, adminWeeksOff: apiAdminWeeksOff_, adminPersonAdd: apiAdminPersonAdd_, adminPersonSet: apiAdminPersonSet_, adminEditPost: apiAdminEditPost_, updateHide: apiUpdateHide_, pushToken: apiPushToken_, pushPrefs: apiPushPrefs_, pushTest: apiPushTest_, feedback: apiFeedback_, hidePost: apiHidePost_, unhidePosts: apiHidePost_ };
  if (LIGHT[action]) {
    var lk = LockService.getScriptLock();
    if (!lk.tryLock(25000)) return { ok: false, error: 'The tracker is busy for a moment. Try again.' };
    try { return { ok: true, message: LIGHT[action](me, req) || '' }; } finally { try { lk.releaseLock(); } catch (e3) {} }
  }

  if (action === 'state' || action === 'profile') {
    ctx = loadCtx_();
    var out = { ok: true };
    if (action === 'state') out.state = buildState_(me, ctx);
    if (action === 'profile') profilePid = str_(req.pid);
    if (profilePid) out.profile = buildProfile_(me, ctx, profilePid);
    return out;
  }

  var handlers = {
    logWorkout: apiLogWorkout_, editWorkout: apiEditWorkout_, deleteWorkout: apiDeleteWorkout_,
    react: apiReact_, comment: apiComment_, deleteComment: apiDeleteComment_,
    settle: apiSettle_, payment: apiPayment_, join: apiJoin_, leave: apiLeave_, weight: apiWeight_,
    betPropose: apiBetPropose_, betPlace: apiBetPlace_, betResolve: apiBetResolve_, paymentDecide: apiPaymentDecide_, potCreate: apiPotCreate_, potJoin: apiPotJoin_, potLeave: apiPotLeave_, potSettle: apiPotSettle_, potCancel: apiPotCancel_, chalCreate: apiChalCreate_, chalJoin: apiChalJoin_, chalLeave: apiChalLeave_, chalAnswer: apiChalAnswer_, chalCancel: apiChalCancel_, adminDelete: apiAdminDelete_, photoAdd: apiPhotoAdd_, photoDelete: apiPhotoDelete_, post: apiPost_, deletePost: apiDeletePost_
  };
  if (action === 'syncNow') return apiSyncNow_(me, profilePid);
  if (!handlers[action]) return { ok: false, error: 'Unknown action: ' + action };
  var BADGE_ACTIONS = { paymentDecide: 1, adminDelete: 1, logWorkout: 1, editWorkout: 1, deleteWorkout: 1, settle: 1, payment: 1, weight: 1, betResolve: 1 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'The tracker is busy for a moment. Try again.' };
  try {
    var message = handlers[action](me, req, loadCtx_()) || '';
    ctx = loadCtx_();
    generateEvents_(ctx);
    var paid = 0;
    try { paid = settleSideBets_(ctx); } catch (sbErr) { Logger.log('side bets: ' + sbErr.message); }
    var news = [];
    if (BADGE_ACTIONS[action] || paid) {
      try { news = generateBadgeEvents_(ctx); } catch (bErr) { Logger.log('badge events: ' + bErr.message); }
    }
    var res = { ok: true, message: message, state: buildState_(me, ctx) };
    var mine = [];
    news.forEach(function(n) {
      if (n.participant_id === me.pid || (n._winners || []).indexOf(me.pid) !== -1) mine.push({ type: 'badge_gain', text: n._you || n.title, badgeId: n.week });
      else if ((n._lost || []).indexOf(me.pid) !== -1) mine.push({ type: 'badge_loss', text: 'You lost ' + n._badge + ' to ' + ctx.byPid[n.participant_id].name, badgeId: n.week });
    });
    if (mine.length) res.badgeNews = mine;
    if (profilePid) res.profile = buildProfile_(me, ctx, profilePid);
    return res;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
    pushSendQueued_();   // phone alerts for this save, sent after the lock so nobody else waits on them
  }
}

// ----------------------------------------------------------------
// API ACTIONS
// ----------------------------------------------------------------

// The in-app Sync button. Same work as the hourly sync, but at most once every
// APP_SYNC_COOLDOWN_MIN minutes for the whole group, so a dozen thumbs cannot hammer WHOOP.
function apiSyncNow_(me, profilePid) {
  var last = Date.parse(str_(PropertiesService.getScriptProperties().getProperty('LAST_SYNC_AT'))) || 0;
  var mins = Math.floor((Date.now() - last) / 60000);
  var message;
  if (last && mins < APP_SYNC_COOLDOWN_MIN) {
    message = 'Already synced ' + (mins < 1 ? 'less than a minute' : mins + ' min') + ' ago. Showing the latest.';
  } else {
    var res = runSync_('app_sync', false);
    if (!res) message = 'A sync is already running. Showing the latest.';
    else {
      var n = res.whoop.added + res.sms.added;
      message = n ? 'Synced: ' + n + ' new workout' + (n === 1 ? '' : 's') + '.' : 'Synced. Nothing new from WHOOP.';
    }
  }
  var ctx = loadCtx_();
  var out = { ok: true, message: message, state: buildState_(me, ctx) };
  if (profilePid) out.profile = buildProfile_(me, ctx, profilePid);
  return out;
}

function apiLogWorkout_(me, req, ctx) {
  if (ctx.currentWeek < 1) throw new Error('The challenge has not started yet.');
  var admin = isAdmin_(me, ctx.settings), who = me, forPid = str_(req.forPid);
  if (forPid && forPid !== me.pid) {
    if (!admin) throw new Error('Only the admin can log a workout for someone else.');
    who = ctx.byPid[forPid];
    if (!who) throw new Error('Unknown person.');
  }
  var date = isoOf_(req.date, ctx.tz);
  var ws = weekStartIso_(ctx.startIso, ctx.currentWeek);
  if (!date || dayNum_(date) > dayNum_(ctx.today)) throw new Error('Pick today or an earlier day.');
  if (admin) { if (dayNum_(date) < dayNum_(ctx.startIso)) throw new Error('That is before the challenge started.'); }
  else if (dayNum_(date) < dayNum_(ws)) throw new Error('You can log workouts for this week only, today or earlier.');
  var minutes = Math.round(num_(req.minutes, 0));
  if (minutes < 1 || minutes > 600) throw new Error('Enter how many minutes you worked out.');
  var type = truncate_(str_(req.type) || 'Workout', 30);
  var effort = truncate_(str_(req.effort), 20);
  var note = truncate_(str_(req.note), 500);
  var forOther = who.pid !== me.pid, back = admin && date !== ctx.today;
  appendRows_(TAB.WORKOUTS, [{
    workout_id: 'app_' + who.pid + '_' + date + '_' + shortId_(), participant_id: who.pid, workout_date: date,
    workout_start: '', workout_end: '', duration_minutes: String(minutes), strain: '', source: 'app',
    activity: type, effort: effort, note: note,
    created_at: (forOther || back) && date !== ctx.today ? date + 'T17:00:00.000Z' : nowIso_(),   // a back-dated entry sits on its own day in the feed
    status: 'active', entered_by: forOther ? me.pid : ''
  }]);
  if (forOther) return 'Logged for ' + who.name + '.';
  return minutes >= ctx.minTime ? 'Workout logged.' : 'Logged, but it needs ' + ctx.minTime + ' minutes to count.';
}

function apiDeleteWorkout_(me, req, ctx) {
  var id = str_(req.id);
  var hit = null;
  readTable_(TAB.WORKOUTS).forEach(function(w) { if (w.workout_id === id) hit = w; });
  if (!hit || hit.participant_id !== me.pid || str_(hit.source) !== 'app') throw new Error('You can only delete workouts you logged in the app.');
  if (weekOf_(isoOf_(hit.workout_date, ctx.tz), ctx.startIso) !== ctx.currentWeek) throw new Error('Past weeks are locked.');
  hit.status = 'deleted';
  updateRow_(TAB.WORKOUTS, hit._row, hit);
  return 'Workout removed.';
}

// Feedback from the Me tab: one row per message in the Feedback tab.
function apiFeedback_(me, req) {
  var text = truncate_(str_(req.text), 2000);
  if (!text) throw new Error('Write something first.');
  appendRows_(TAB.FEEDBACK, [{ feedback_id: 'f_' + shortId_(), created_at: nowIso_(), participant_id: me.pid, name: me.name, text: text }]);
  return 'Sent. Thanks for the feedback.';
}

// Admins (Settings > admins, names or ids, default Paul) may delete any post for everyone.
function isAdmin_(me, settings) {
  var list = str_((settings || readSettings_()).admins).split(',').map(function(x) { return str_(x).toLowerCase(); });
  return list.indexOf(str_(me.name).toLowerCase()) !== -1 || list.indexOf(str_(me.pid).toLowerCase()) !== -1;
}

// "Hide" a post from your own feed only (swipe left). Stored per person, newest 400.
function apiHidePost_(me, req) {
  var key = me.pid + '|hidden', cur = str_(readSettings_()[key]).split(',').map(str_).filter(function(x) { return x; });
  if (isTrue_(req.clear)) cur = [];
  else {
    var id = truncate_(str_(req.id), 120);
    if (!id) throw new Error('Missing post.');
    if (cur.indexOf(id) === -1) cur.push(id);
  }
  setSetting_(key, cur.slice(-400).join(','));
  return '';
}

// Admin only: remove a post for everyone. Workouts are marked deleted; posts like recaps are flagged so they are not made again.
function apiAdminDelete_(me, req, ctx) {
  if (!isAdmin_(me, ctx.settings)) throw new Error('Only the admin can delete other posts.');
  var id = str_(req.id), hit = null;
  readTable_(TAB.WORKOUTS).forEach(function(w) { if (w.workout_id === id) hit = w; });
  if (hit) { hit.status = 'deleted'; updateRow_(TAB.WORKOUTS, hit._row, hit); return 'Post deleted.'; }
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.event_id === id) hit = e; });
  if (hit) { hit.deleted = '1'; updateRow_(TAB.EVENTS, hit._row, hit); return 'Post deleted.'; }
  throw new Error('That post cannot be deleted.');
}

// ---------- admin: settings, people, weeks off, share links ----------
var ADMIN_RULES = { min_days: [1, 7], min_time: [1, 300], min_effort: [0, 21], bet_per_miss: [0, 1000] };

function partLink_(ctx, key) { var u = str_(ctx.settings.app_url); return key && u ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'k=' + key : ''; }

function adminSettings_(ctx) {
  var st = ctx.settings, offAll = [];
  str_(st.inactive_week_indices).split(',').forEach(function(x) { var n = parseInt(x, 10); if (n > 0) offAll.push(n); });
  return {
    rules: { min_days: str_(st.min_days), min_time: str_(st.min_time), min_effort: str_(st.min_effort), bet_per_miss: str_(st.bet_per_miss), venmo_user: str_(st.venmo_user), bank_name: str_(st.bank_name) },
    offAll: offAll, currentWeek: ctx.currentWeek, seasonWeeks: Math.max(ctx.currentWeek, parseInt(st.season_weeks, 10) || 20),
    people: ctx.people.map(function(p) {
      var off = []; Object.keys(p.offWeeks || {}).forEach(function(k) { off.push(parseInt(k, 10)); });
      return { pid: p.pid, name: p.name, active: p.active, phone: p.phone, initials: p.initials, hasKey: !!p.key, off: off.sort(function(a, b) { return a - b; }) };
    })
  };
}
function adminLinks_(ctx) {
  return ctx.people.filter(function(p) { return p.active; }).map(function(p) { return { pid: p.pid, name: p.name, phone: str_(p.phone).replace(/\D/g, ''), link: partLink_(ctx, p.key) }; });
}
function needAdmin_(me) { if (!isAdmin_(me, readSettings_())) throw new Error('Only the admin can do that.'); }

// Changes one rule or setting. These apply to the whole season at once, past weeks included.
function apiAdminSet_(me, req) {
  needAdmin_(me);
  var key = str_(req.key), val = str_(req.value);
  if (ADMIN_RULES[key]) {
    var n = Number(val), r = ADMIN_RULES[key];
    if (val === '' || isNaN(n) || n < r[0] || n > r[1]) throw new Error('Enter a number from ' + r[0] + ' to ' + r[1] + '.');
    setSetting_(key, String(n));
  } else if (key === 'venmo_user') {
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(val.replace(/^@/, ''))) throw new Error('That does not look like a Venmo name.');
    setSetting_(key, val.replace(/^@/, ''));
  } else if (key === 'bank_name') { setSetting_(key, truncate_(val, 80)); }
  else throw new Error('That setting cannot be changed here.');
  return 'Saved.';
}

function partCell_(row, field, value) {
  var sh = ensureParticipantCols_(), col = sheetHeaders_(sh).indexOf(field) + 1;
  if (col < 1) throw new Error('Participants is missing the ' + field + ' column.');
  sh.getRange(row, col).setNumberFormat('@').setValue(value);
}

// Weeks off: for everyone (pid "all": Settings > inactive_week_indices) or for one person (Participants > inactive_weeks).
function apiAdminWeeksOff_(me, req) {
  needAdmin_(me);
  var weeks = [], seen = {};
  str_(req.weeks).split(',').forEach(function(x) { var n = parseInt(x, 10); if (n > 0 && n < 100 && !seen[n]) { seen[n] = 1; weeks.push(n); } });
  weeks.sort(function(a, b) { return a - b; });
  var pid = str_(req.pid);
  if (pid === 'all') { setSetting_('inactive_week_indices', weeks.length ? weeks.join(',') : '0'); return 'Saved.'; }
  var hit = null; readPeople_().forEach(function(p) { if (p.pid === pid) hit = p; });
  if (!hit) throw new Error('Unknown person.');
  partCell_(hit.row, 'inactive_weeks', weeks.join(','));
  return 'Saved.';
}

function apiAdminPersonSet_(me, req) {
  needAdmin_(me);
  var hit = null; readPeople_().forEach(function(p) { if (p.pid === str_(req.pid)) hit = p; });
  if (!hit) throw new Error('Unknown person.');
  if (req.active !== undefined) partCell_(hit.row, 'active', isTrue_(req.active) ? 'TRUE' : 'FALSE');
  if (req.name !== undefined) {
    var nm = truncate_(str_(req.name), 30);
    if (nm.length < 2) throw new Error('Enter a name.');
    if (readPeople_().some(function(p) { return p.pid !== hit.pid && p.name.toLowerCase() === nm.toLowerCase(); })) throw new Error('Someone already has that name.');
    partCell_(hit.row, 'display_name', nm);
  }
  if (req.phone !== undefined) { var ph = str_(req.phone) ? normalizePhone_(req.phone) : ''; if (str_(req.phone) && !ph) throw new Error('That phone number does not look right.'); partCell_(hit.row, 'phone', ph.replace('+', '')); }
  if (req.initials !== undefined) partCell_(hit.row, 'initials', truncate_(str_(req.initials), 3).toUpperCase());
  return 'Saved.';
}

// A new person: next id, a personal key and link ready to text them.
function apiAdminPersonAdd_(me, req) {
  needAdmin_(me);
  var name = truncate_(str_(req.name), 30);
  if (name.length < 2) throw new Error('Enter a name.');
  var people = readPeople_();
  if (people.some(function(p) { return p.name.toLowerCase() === name.toLowerCase(); })) throw new Error('Someone already has that name.');
  var ph = str_(req.phone) ? normalizePhone_(req.phone) : '';
  if (str_(req.phone) && !ph) throw new Error('That phone number does not look right.');
  var max = 0; people.forEach(function(p) { var n = parseInt(String(p.pid).replace(/\D/g, ''), 10); if (n > max) max = n; });
  var pid = 'p' + ('00' + (max + 1)).slice(-3), key = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  var st = readSettings_(), tz = st.timezone || 'America/New_York';
  var cw = weekOf_(todayIso_(tz), isoOf_(st.challenge_start_date, tz)), off = [];
  for (var w = 1; w < cw; w++) off.push(w);   // every week before this one is marked off for them
  ensureParticipantCols_();
  appendRows_(TAB.PARTICIPANTS, [{ participant_id: pid, display_name: name, active: 'TRUE', source_identifier: ph ? 'SMS only' : 'App only', date_added: todayIso_(tz),
    phone: ph.replace('+', ''), inactive_weeks: off.join(','), app_key: key, app_link: partLink_({ settings: readSettings_() }, key), initials: truncate_(str_(req.initials) || name.replace(/[^A-Za-z]/g, '').substring(0, 2), 3).toUpperCase() }]);
  return 'Added ' + name + '. They start fresh this week, and their link is ready under Share the app.';
}

// Admin: change the words of someone's post, quietly (no "edited" mark, no alert).
function apiAdminEditPost_(me, req) {
  needAdmin_(me);
  var id = str_(req.id), text = truncate_(str_(req.text), 1000), hit = null;
  if (!text) throw new Error('A post cannot be empty.');
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.event_id === id && e.type === 'post') hit = e; });
  if (!hit) throw new Error('That post was not found.');
  hit.body = text;
  updateRow_(TAB.EVENTS, hit._row, hit);
  return '';
}

// ---------- admin: usage report ----------
// For each person: when they last used the app, how often (days in the last 7 / 30, sessions since tracking began),
// what they log through (app, WHOOP, text), and a flag when they used the app but have since gone back to texting.
// "Used the app" = opened it (tracked since v7.7) or did anything in it (comments, fires, reactions, posts,
// wall posts, workouts logged in the app, bets, photos, feedback).
function buildUsage_(ctx) {
  var tz = ctx.tz, now = Date.now(), act = {};
  function add(pid, ts) {
    pid = str_(pid); ts = str_(ts);
    var ms = Date.parse(ts);
    if (!pid || !/^\d{4}-\d{2}-\d{2}T/.test(ts) || isNaN(ms)) return;
    (act[pid] = act[pid] || []).push(ms);
  }
  readTable_(TAB.COMMENTS).forEach(function(r) { add(r.participant_id, r.created_at); });
  readTable_(TAB.REACTIONS).forEach(function(r) { add(r.participant_id, r.created_at); });
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.type === 'post' || e.type === 'wall') add(e.participant_id, e.created_at); });
  readTable_(TAB.WAGERS).forEach(function(w) { add(w.participant_id, w.created_at); });
  readTable_(TAB.FEEDBACK).forEach(function(f) { add(f.participant_id, f.created_at); });
  readTable_(TAB.PHOTOS).forEach(function(f) { add(f.participant_id, f.created_at); });
  var src = {};
  ctx.workouts.forEach(function(w) {
    var s = str_(w.source).toLowerCase(), pid = w.participant_id;
    var o = src[pid] = src[pid] || { app: 0, whoop: 0, text: 0, lastText: '', lastAppLog: '' };
    if (s === 'app') { o.app++; if (!(str_(w.entered_by) && str_(w.entered_by) !== str_(pid))) add(pid, w.created_at); if (w._date > o.lastAppLog) o.lastAppLog = w._date; }
    else if (s === 'whoop') o.whoop++;
    else if (s === 'sms') { o.text++; if (w._date > o.lastText) o.lastText = w._date; }
  });
  var props = PropertiesService.getScriptProperties().getProperties();
  var d7 = now - 7 * 86400000, d30 = now - 30 * 86400000;
  var rows = ctx.people.map(function(p) {
    var ms = (act[p.pid] || []).slice(), u = {};
    try { u = JSON.parse(props['USAGE_' + p.pid] || '{}') || {}; } catch (e) { u = {}; }
    var seen = Date.parse(props['SEEN_' + p.pid] || '');
    if (!isNaN(seen)) ms.push(seen);
    var days = {};
    ms.forEach(function(m) { days[Utilities.formatDate(new Date(m), tz, 'yyyy-MM-dd')] = true; });
    (u.days || []).forEach(function(d) { days[d] = true; });
    var dayList = Object.keys(days).sort();
    var last = ms.length ? Math.max.apply(null, ms) : NaN, first = ms.length ? Math.min.apply(null, ms) : NaN;
    var lastDay = isNaN(last) ? '' : Utilities.formatDate(new Date(last), tz, 'yyyy-MM-dd');
    var s = src[p.pid] || { app: 0, whoop: 0, text: 0, lastText: '', lastAppLog: '' };
    var status = isNaN(last) ? 'never' : (s.lastText && s.lastText > lastDay ? 'texting' : (last >= d7 ? 'active' : 'lapsed'));
    return {
      pid: p.pid, name: p.name, active: p.active, hasLink: !!p.key, whoop: whoopStatus_(p.pid), status: status,
      last: isNaN(last) ? '' : new Date(last).toISOString(), first: isNaN(first) ? '' : new Date(first).toISOString(),
      days7: dayList.filter(function(d) { return Date.parse(d + 'T12:00:00Z') >= d7; }).length,
      days30: dayList.filter(function(d) { return Date.parse(d + 'T12:00:00Z') >= d30; }).length,
      daysTotal: dayList.length, sessions: u.sessions || 0, trackedSince: str_(u.since),
      logs: { app: s.app, whoop: s.whoop, text: s.text }, lastText: s.lastText
    };
  });
  return rows;
}
function feedbackList_() {
  return readTable_(TAB.FEEDBACK).map(function(f) { return { name: str_(f.name), pid: str_(f.participant_id), ts: str_(f.created_at), text: str_(f.text) }; })
    .sort(function(a, b) { return b.ts.localeCompare(a.ts); }).slice(0, 200);
}

// Who a post belongs to (for "X fired up your workout" alerts): a workout's owner, a wall's owner, or an event's person.
function pushOwnerOf_(ctx, target) {
  if (target.indexOf('wall_') === 0 && ctx.byPid[target.substring(5)]) return { pid: target.substring(5), what: 'wall' };
  var w = ctx.workouts.filter(function(x) { return x.workout_id === target; })[0];
  if (w) return { pid: w.participant_id, what: 'workout' };
  var e = readTable_(TAB.EVENTS).filter(function(x) { return x.event_id === target; })[0];
  if (e) return { pid: e.type === 'wall' ? str_(e.week) : e.participant_id, what: e.type === 'post' ? 'userpost' : 'post' };
  return null;
}

// Last time each person had the app open (any call from their phone). One script property each, written at most once a minute.
// Also keeps a small usage record per person (USAGE_<id>): the days they used the app and how many separate
// sessions (a gap of 30+ minutes starts a new one). Counting started with v8.1.
function seenMark_(me) {
  try {
    var c = CacheService.getScriptCache();
    if (c.get('seen_' + me.pid)) return;
    c.put('seen_' + me.pid, '1', 60);
    var props = PropertiesService.getScriptProperties(), now = new Date(), prev = Date.parse(props.getProperty('SEEN_' + me.pid) || '');
    props.setProperty('SEEN_' + me.pid, now.toISOString());
    var u = {};
    try { u = JSON.parse(props.getProperty('USAGE_' + me.pid) || '{}') || {}; } catch (e2) { u = {}; }
    if (!u.since) u.since = now.toISOString();
    if (isNaN(prev) || now.getTime() - prev > 30 * 60000) u.sessions = (u.sessions || 0) + 1;
    var day = Utilities.formatDate(now, Session.getScriptTimeZone() || 'America/New_York', 'yyyy-MM-dd');
    u.days = u.days || [];
    if (u.days.indexOf(day) === -1) u.days.push(day);
    u.days = u.days.slice(-120);
    props.setProperty('USAGE_' + me.pid, JSON.stringify(u));
  } catch (e) { Logger.log('seenMark_: ' + e.message); }
}
// Last active = the latest of: opening the app (recorded since v7.7) and anything they did in it
// (comments, reactions, posts, wall posts, workouts logged in the app). The feed builder collects the activity.
function actBump_(ctx, pid, ts) {
  pid = str_(pid); ts = str_(ts);
  if (!pid || !/^\d{4}-\d{2}-\d{2}T/.test(ts)) return;
  var a = ctx._act || (ctx._act = {});
  if (!a[pid] || Date.parse(ts) > Date.parse(a[pid])) a[pid] = ts;
}
function seenAll_(ctx) {
  if (ctx) ctx.workouts.forEach(function(w) { if (str_(w.source).toLowerCase() === 'app' && !(str_(w.entered_by) && str_(w.entered_by) !== str_(w.participant_id))) actBump_(ctx, w.participant_id, w.created_at); });
  var all = PropertiesService.getScriptProperties().getProperties(), out = {};
  Object.keys((ctx && ctx._act) || {}).forEach(function(pid) { out[pid] = ctx._act[pid]; });
  Object.keys(all).forEach(function(k) {
    if (k.indexOf('SEEN_') !== 0) return;
    var pid = k.substring(5);
    if (!out[pid] || Date.parse(all[k]) > Date.parse(out[pid])) out[pid] = all[k];
  });
  return out;
}

// What's new: rows Paul writes in the Updates tab (update_id, date, title, message, hidden_from).
// Each one pops up on everyone's phone until they tap Hide (their id goes in hidden_from).
function updatesFor_(me) {
  return readTable_(TAB.UPDATES).filter(function(u) { return str_(u.title) || str_(u.message); }).map(function(u) {
    return { id: str_(u.update_id) || ('u' + u._row), date: str_(u.date), title: str_(u.title), message: str_(u.message), hidden: csv_(u.hidden_from).indexOf(me.pid) !== -1 };
  }).sort(function(a, b) { return b.date.localeCompare(a.date); });
}
function apiUpdateHide_(me, req) {
  var id = str_(req.id), hit = null;
  readTable_(TAB.UPDATES).forEach(function(u) { if ((str_(u.update_id) || ('u' + u._row)) === id) hit = u; });
  if (!hit) return '';
  var list = csv_(hit.hidden_from);
  if (list.indexOf(me.pid) === -1) list.push(me.pid);
  hit.hidden_from = list.join(',');
  if (!str_(hit.update_id)) hit.update_id = id;
  updateRow_(TAB.UPDATES, hit._row, hit);
  return '';
}

// ---------- custom pots ----------
// A group of guys going in together: each who joins owes the entry amount (like a fine, paid through Deposit);
// the admin settles it by choosing the winner(s) and the final total, which is split between them.
function cpotRows_() {
  return readTable_(TAB.CPOTS).filter(function(r) { return str_(r.status) !== 'cancelled'; }).map(function(r) {
    var members = csv_(r.members), joined = csv_(r.joined);
    return { id: str_(r.pot_id), name: str_(r.name), description: str_(r.description), entry: num_(r.entry, 0), status: str_(r.status) || 'open', createdBy: str_(r.created_by), createdAt: str_(r.created_at),
      members: members, joined: members.map(function(m, i) { return joined[i] || str_(r.created_at); }), winners: csv_(r.winners), end: r.end_amount === '' ? null : num_(r.end_amount, 0),
      by: str_(r.settled_by), at: str_(r.settled_at), _row: r._row, _raw: r };
  });
}
function cpotFind_(id) { var hit = null; cpotRows_().forEach(function(p) { if (p.id === id) hit = p; }); return hit; }
function cpotSave_(pot, members, joined, extra) {
  var r = pot._raw; r.members = members.join(','); r.joined = joined.join(',');
  Object.keys(extra || {}).forEach(function(k) { r[k] = extra[k]; });
  updateRow_(TAB.CPOTS, pot._row, r);
}

function apiPotCreate_(me, req, ctx) {
  var name = truncate_(str_(req.name), 40), desc = truncate_(str_(req.description), 300), entry = round2_(num_(req.entry, NaN));
  if (name.length < 3) throw new Error('Give the pot a name.');
  if (isNaN(entry) || entry < 1 || entry > 1000) throw new Error('Set the entry amount, $1 to $1,000.');
  var id = /^cpot_[A-Za-z0-9]{8,30}$/.test(str_(req.id)) && !cpotFind_(str_(req.id)) ? str_(req.id) : 'cpot_' + shortId_(), now = nowIso_();
  appendRows_(TAB.CPOTS, [{ pot_id: id, created_at: now, created_by: me.pid, name: name, description: desc, entry: String(entry), status: 'open', members: me.pid, joined: now, winners: '', end_amount: '', settled_by: '', settled_at: '' }]);
  appendRows_(TAB.EVENTS, [{ event_id: 'custompot_' + id, created_at: now, type: 'custompot', participant_id: me.pid, week: id, title: me.name + ' started a pot: ' + name, body: (desc ? desc + ' ' : '') + 'Entry ' + money_(entry) + '.' }]);
  try { pushToPeople_(pushEveryone_(ctx), 'updates', 'New pot', me.name + ' started "' + name + '" (' + money_(entry) + ' to get in).', me.pid); } catch (pe) { Logger.log('push pot: ' + pe.message); }
  return 'Pot started. You are in.';
}
function apiPotJoin_(me, req, ctx) {
  var pot = cpotFind_(str_(req.id));
  if (!pot) throw new Error('That pot was not found.');
  if (pot.status !== 'open') throw new Error('That pot is already settled.');
  if (pot.members.indexOf(me.pid) !== -1) return 'You are already in.';
  cpotSave_(pot, pot.members.concat([me.pid]), pot.joined.concat([nowIso_()]), {});
  return 'You are in. Your ' + money_(pot.entry) + ' entry shows as owed until you deposit it.';
}
function apiPotLeave_(me, req, ctx) {
  var pot = cpotFind_(str_(req.id));
  if (!pot) throw new Error('That pot was not found.');
  if (pot.status !== 'open') throw new Error('That pot is already settled.');
  var i = pot.members.indexOf(me.pid);
  if (i === -1) return '';
  var m = pot.members.slice(), j = pot.joined.slice(); m.splice(i, 1); j.splice(i, 1);
  cpotSave_(pot, m, j, {});
  return 'You are out.';
}
// Admin: pick the winner(s) and the final total (default: everyone's entries). Can be run again to change it.
function apiPotSettle_(me, req, ctx) {
  if (!isAdmin_(me, ctx.settings)) throw new Error('Only the admin can settle pots.');
  var pot = cpotFind_(str_(req.id));
  if (!pot) throw new Error('That pot was not found.');
  var winners = csv_(req.winners).filter(function(w) { return pot.members.indexOf(w) !== -1; });
  if (!winners.length) throw new Error('Pick at least one winner from the people in the pot.');
  var total = req.total === undefined || str_(req.total) === '' ? round2_(pot.entry * pot.members.length) : round2_(num_(req.total, NaN));
  if (isNaN(total) || total < 0 || total > 100000) throw new Error('Enter the total to pay out.');
  var again = pot.status === 'settled', each = round2_(total / winners.length), now = nowIso_();
  cpotSave_(pot, pot.members, pot.joined, { status: 'settled', winners: winners.join(','), end_amount: String(total), settled_by: me.pid, settled_at: now });
  var names = winners.map(function(w) { return (ctx.byPid[w] || { name: w }).name; }).join(', ');
  var txt = (again ? 'Updated' : 'Settled') + ' ' + pot.name + ': ' + money_(total) + ' to ' + names + (winners.length > 1 ? ' (' + money_(each) + ' each)' : '') + '.';
  appendRows_(TAB.EVENTS, [{ event_id: 'settle_' + pot.id + '_' + Date.now(), created_at: now, type: 'settle', participant_id: me.pid, week: '', title: me.name + (again ? ' updated' : ' settled') + ' the ' + pot.name + ' pot', body: txt }]);
  appendRows_(TAB.COMMENTS, [{ comment_id: 'c_' + shortId_(), target_id: pot.id, participant_id: me.pid, created_at: now, text: txt }]);
  return 'Pot settled.';
}
function apiPotCancel_(me, req, ctx) {
  if (!isAdmin_(me, ctx.settings)) throw new Error('Only the admin can cancel a pot.');
  var pot = cpotFind_(str_(req.id));
  if (!pot) throw new Error('That pot was not found.');
  cpotSave_(pot, pot.members, pot.joined, { status: 'cancelled' });
  return 'Pot cancelled. Nobody owes an entry for it any more.';
}


// ---------- custom challenges ----------
// Anyone proposes a challenge: a rule, a number of weeks and a fine per missed week. People join before it starts (it always starts on a Monday).
// When each week ends, everyone in it is asked "did you keep to it?" in the feed. Yes = in the money. No (or no answer by the deadline) = owes the fine.
// The fines of the week are split between the people who said yes, and show up in the bank accounts next to the regular tracker money.
var CHAL_GRACE_DAYS = 3;   // answer by Wednesday after the week ends, or it counts as a miss

function chalAll_(ctx) {
  if (ctx._chal) return ctx._chal;
  var answers = {};
  readTable_(TAB.CHK).forEach(function(a) { answers[str_(a.chal_id) + '|' + str_(a.week) + '|' + str_(a.participant_id)] = { ans: str_(a.answer).toLowerCase(), ts: str_(a.created_at) }; });
  var tn = dayNum_(ctx.today), out = [];
  readTable_(TAB.CHAL).forEach(function(r) {
    if (str_(r.status) === 'cancelled') return;
    var c = { id: str_(r.chal_id), name: str_(r.name), rules: str_(r.rules), weeks: Math.max(1, parseInt(r.weeks, 10) || 1), fine: num_(r.fine, 0), start: str_(r.start_date),
      createdBy: str_(r.created_by), createdAt: str_(r.created_at), _row: r._row, _raw: r, weeksList: [] };
    c.members = csv_(r.members).filter(function(pid) { return ctx.byPid[pid] && ctx.byPid[pid].active; });
    if (!c.start || isNaN(dayNum_(c.start))) return;
    for (var k = 1; k <= c.weeks; k++) {
      var ws = addDays_(c.start, (k - 1) * 7), we = addDays_(ws, 6), deadline = addDays_(we, CHAL_GRACE_DAYS);
      var state = tn < dayNum_(ws) ? 'upcoming' : tn <= dayNum_(we) ? 'running' : 'answering';
      var yes = [], no = [], pending = [], last = '', ans = {};
      c.members.forEach(function(pid) {
        var a = answers[c.id + '|' + k + '|' + pid];
        if (a && a.ans === 'yes') yes.push(pid); else if (a && a.ans === 'no') no.push(pid); else pending.push(pid);
        if (a) { ans[pid] = a.ans; if (a.ts > last) last = a.ts; }
      });
      var allIn = c.members.length > 0 && !pending.length;
      if (state === 'answering' && (tn > dayNum_(deadline) || allIn || !c.members.length)) state = 'final';
      var misses = state === 'final' ? no.concat(pending) : [];
      var pot = round2_(misses.length * c.fine);
      c.weeksList.push({ k: k, start: ws, end: we, state: state, yes: state === 'final' ? yes : [], misses: misses, answers: ans, answered: yes.length + no.length, total: c.members.length,
        pot: pot, each: state === 'final' && yes.length ? round2_(pot / yes.length) : 0,
        finalTs: allIn && last ? last : addDays_(deadline, 1) + 'T05:00:00.000Z' });
    }
    out.push(c);
  });
  ctx._chal = out;
  return out;
}
function chalFind_(ctx, id) { var hit = null; chalAll_(ctx).forEach(function(c) { if (c.id === id) hit = c; }); return hit; }
function chalSave_(c, members, joined, extra) {
  var r = c._raw; r.members = members.join(','); r.joined = joined.join(',');
  Object.keys(extra || {}).forEach(function(k) { r[k] = extra[k]; });
  updateRow_(TAB.CHAL, c._row, r);
}
function chalResultText_(ctx, c, w) {
  function nm(pid) { return (ctx.byPid[pid] || { name: pid }).name; }
  if (!w.misses.length) return 'Everybody kept to it. Nobody pays.';
  var t = (w.yes.length ? 'In the money: ' + w.yes.map(nm).join(', ') + '. ' : 'Nobody kept to it. ') + 'Missed: ' + w.misses.map(nm).join(', ') + ' (' + money_(c.fine) + ' each).';
  return t + (w.yes.length ? ' ' + money_(w.pot) + ' pot, ' + money_(w.each) + ' each.' : ' Nobody to split the pot with, so it stays in the bank.');
}

function chalState_(me, ctx) {
  var tn = dayNum_(ctx.today);
  return chalAll_(ctx).map(function(c) {
    var enrolling = tn < dayNum_(c.start), done = c.weeksList.every(function(w) { return w.state === 'final'; });
    var stand = {};
    c.members.forEach(function(pid) { stand[pid] = { pid: pid, hit: 0, missed: 0, won: 0, owes: 0 }; });
    c.weeksList.forEach(function(w) {
      if (w.state !== 'final') return;
      w.yes.forEach(function(pid) { if (stand[pid]) { stand[pid].hit++; stand[pid].won = round2_(stand[pid].won + w.each); } });
      w.misses.forEach(function(pid) { if (stand[pid]) { stand[pid].missed++; stand[pid].owes = round2_(stand[pid].owes + c.fine); } });
    });
    return { id: c.id, name: c.name, rules: c.rules, weeks: c.weeks, fine: c.fine, start: c.start, end: addDays_(c.start, c.weeks * 7 - 1), createdBy: c.createdBy, createdAt: c.createdAt,
      members: c.members, status: enrolling ? 'enrolling' : done ? 'done' : 'running', joined: c.members.indexOf(me.pid) !== -1,
      canCancel: isAdmin_(me, ctx.settings) || (c.createdBy === me.pid && enrolling), grace: CHAL_GRACE_DAYS,
      standings: Object.keys(stand).map(function(k) { return stand[k]; }).sort(function(a, b) { return (b.won - b.owes) - (a.won - a.owes) || b.hit - a.hit; }),
      weeksOut: c.weeksList.map(function(w) { return { k: w.k, start: w.start, end: w.end, state: w.state, yes: w.yes, misses: w.misses, answered: w.answered, total: w.total, mine: w.answers[me.pid] || '', pot: w.pot, each: w.each }; }) };
  }).sort(function(a, b) { var o = { enrolling: 0, running: 1, done: 2 }; return o[a.status] - o[b.status] || String(b.createdAt).localeCompare(String(a.createdAt)); });
}

function apiChalCreate_(me, req, ctx) {
  var name = truncate_(str_(req.name), 60), rules = truncate_(str_(req.rules), 500), weeks = parseInt(req.weeks, 10), fine = round2_(num_(req.fine, NaN)), start = str_(req.start);
  if (name.length < 3) throw new Error('Give the challenge a name.');
  if (rules.length < 5) throw new Error('Say what the rule is, so everyone knows what a yes means.');
  if (isNaN(weeks) || weeks < 1 || weeks > 26) throw new Error('Pick 1 to 26 weeks.');
  if (isNaN(fine) || fine < 1 || fine > 1000) throw new Error('Set the fine per missed week, $1 to $1,000.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(dayNum_(start))) throw new Error('Pick a start date.');
  if (new Date(start + 'T12:00:00Z').getUTCDay() !== 1) throw new Error('A challenge starts on a Monday.');
  if (dayNum_(start) <= dayNum_(ctx.today)) throw new Error('Pick a start date in the future so people can join first.');
  if (dayNum_(start) - dayNum_(ctx.today) > 42) throw new Error('Start within the next 6 weeks.');
  var id = /^chal_[A-Za-z0-9]{8,30}$/.test(str_(req.id)) && !chalFind_(ctx, str_(req.id)) ? str_(req.id) : 'chal_' + shortId_(), now = nowIso_();
  appendRows_(TAB.CHAL, [{ chal_id: id, created_at: now, created_by: me.pid, name: name, rules: rules, weeks: String(weeks), fine: String(fine), start_date: start, status: 'open', members: me.pid, joined: now }]);
  appendRows_(TAB.EVENTS, [{ event_id: 'customchal_' + id, created_at: now, type: 'customchal', participant_id: me.pid, week: id, title: me.name + ' proposed a challenge: ' + name,
    body: rules + ' ' + weeks + (weeks === 1 ? ' week' : ' weeks') + ', ' + money_(fine) + ' per missed week. Starts ' + dowLabel_(start) + ' ' + mdLabel_(start) + '. Join before then.' }]);
  try { pushToPeople_(pushEveryone_(ctx), 'updates', 'New challenge', me.name + ' proposed "' + name + '" (' + money_(fine) + ' per miss). Join before it starts.', me.pid); } catch (pe) { Logger.log('push chal: ' + pe.message); }
  return 'Challenge posted. You are in.';
}
function apiChalJoin_(me, req, ctx) {
  var c = chalFind_(ctx, str_(req.id));
  if (!c) throw new Error('That challenge was not found.');
  if (dayNum_(ctx.today) >= dayNum_(c.start)) throw new Error('That challenge has already started.');
  if (c.members.indexOf(me.pid) !== -1) return 'You are already in.';
  var raw = csv_(c._raw.members), jn = csv_(c._raw.joined);
  chalSave_(c, raw.concat([me.pid]), raw.map(function(m, i) { return jn[i] || c.createdAt; }).concat([nowIso_()]), {});
  return 'You are in. Miss a week and it costs ' + money_(c.fine) + '.';
}
function apiChalLeave_(me, req, ctx) {
  var c = chalFind_(ctx, str_(req.id));
  if (!c) throw new Error('That challenge was not found.');
  if (dayNum_(ctx.today) >= dayNum_(c.start)) throw new Error('It has started. No backing out now.');
  var raw = csv_(c._raw.members), jn = csv_(c._raw.joined), i = raw.indexOf(me.pid);
  if (i === -1) return '';
  raw.splice(i, 1); jn.splice(i, 1);
  chalSave_(c, raw, jn, {});
  return 'You are out.';
}
// "Did you keep to it this week?" Yes or no, changeable until the week is settled.
function apiChalAnswer_(me, req, ctx) {
  var c = chalFind_(ctx, str_(req.id)), k = parseInt(req.week, 10), ans = str_(req.answer).toLowerCase();
  if (!c) throw new Error('That challenge was not found.');
  if (c.members.indexOf(me.pid) === -1) throw new Error('You are not in this challenge.');
  if (ans !== 'yes' && ans !== 'no') throw new Error('Answer yes or no.');
  var w = c.weeksList[k - 1];
  if (!w) throw new Error('That week does not exist.');
  if (w.state === 'upcoming' || w.state === 'running') throw new Error('That week is not over yet.');
  if (w.state === 'final') throw new Error('That week is already settled.');
  var hit = null;
  readTable_(TAB.CHK).forEach(function(a) { if (str_(a.chal_id) === c.id && str_(a.week) === String(k) && str_(a.participant_id) === me.pid) hit = a; });
  if (hit) { hit.answer = ans; hit.created_at = nowIso_(); updateRow_(TAB.CHK, hit._row, hit); }
  else appendRows_(TAB.CHK, [{ checkin_id: 'k_' + shortId_(), chal_id: c.id, participant_id: me.pid, week: String(k), answer: ans, created_at: nowIso_() }]);
  return ans === 'yes' ? 'Logged: you kept to it.' : 'Logged: missed. ' + money_(c.fine) + ' goes in the pot.';
}
function apiChalCancel_(me, req, ctx) {
  var c = chalFind_(ctx, str_(req.id));
  if (!c) throw new Error('That challenge was not found.');
  var admin = isAdmin_(me, ctx.settings), early = dayNum_(ctx.today) < dayNum_(c.start);
  if (!admin && !(c.createdBy === me.pid && early)) throw new Error('Only the person who proposed it (before it starts) or the admin can cancel it.');
  chalSave_(c, csv_(c._raw.members), csv_(c._raw.joined), { status: 'cancelled' });
  return 'Challenge cancelled. Nobody owes anything for it.';
}

// ---------- photos on workout posts ----------
// Files go in a Drive folder ("BC Dads WAG photos", shared view-only by link so the app can show them).
// One row per photo in the Photos tab. Up to 4 per post. Only the post's owner adds; the owner or the admin deletes.
var PHOTO_MAX = 4;
function photoFolder_() {
  var id = str_(readSettings_().photo_folder_id), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
  if (!f) { f = DriveApp.createFolder('BC Dads WAG photos'); setSetting_('photo_folder_id', f.getId()); }
  return f;
}
// Run once from the Apps Script editor after this version is deployed: approves Drive access and makes the folder.
function setupPhotos() { Logger.log('Photos are ready. Folder: ' + photoFolder_().getUrl()); }

function apiPhotoAdd_(me, req, ctx) {
  var target = truncate_(str_(req.target), 120);
  var isPot = /^(pot_\d{1,3}|cpot_[A-Za-z0-9]{4,30})$/.test(target);   // anyone can add photos to a pot's card
  var isBet = /^sb_[A-Za-z0-9]{4,40}$/.test(target), betOk = false;       // the person who proposed a bet can add photos to it
  if (isBet) readTable_(TAB.BETS).forEach(function(b) { if (b.bet_id === target && b.proposer === me.pid) betOk = true; });
  var isCmt = /^c_[A-Za-z0-9]{6,40}$/.test(target), cmtOk = false;          // a photo posted as a comment, by whoever wrote it
  if (isCmt) readTable_(TAB.COMMENTS).forEach(function(c) { if (c.comment_id === target && c.participant_id === me.pid) cmtOk = true; });
  if (isCmt && !cmtOk) throw new Error('You can only add a photo to your own comment.');
  var own = isPot || isBet || isCmt ? null : pushOwnerOf_(ctx, target);
  if (isBet && !betOk) throw new Error('Only the person who proposed the bet can add photos to it.');
  if (!isPot && !isBet && !isCmt && (!own || (own.what !== 'workout' && own.what !== 'userpost') || own.pid !== me.pid)) throw new Error('You can add photos to your own posts and workouts.');
  var max = isPot ? 8 : isCmt ? 1 : PHOTO_MAX;
  var have = readTable_(TAB.PHOTOS).filter(function(x) { return x.target_id === target; }).length;
  if (have >= max) throw new Error(isCmt ? 'That comment already has a photo.' : 'That already has ' + max + ' photos.');
  var m = str_(req.data).match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) throw new Error("That photo couldn't be read.");
  if (m[2].length > 6000000) throw new Error('That photo is too big.');
  var file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], 'bcd_' + me.pid + '_' + Date.now() + (m[1] === 'png' ? '.png' : '.jpg')));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { Logger.log('photo sharing: ' + e.message); }
  appendRows_(TAB.PHOTOS, [{ photo_id: 'ph_' + shortId_(), target_id: target, participant_id: me.pid, file_id: file.getId(), created_at: nowIso_() }]);
  return 'Photo added.';
}
function apiPhotoDelete_(me, req, ctx) {
  var id = str_(req.id), hit = null;
  readTable_(TAB.PHOTOS).forEach(function(x) { if (x.photo_id === id) hit = x; });
  if (!hit) return '';
  if (hit.participant_id !== me.pid && !isAdmin_(me, ctx.settings)) throw new Error('You can only delete your own photos.');
  try { DriveApp.getFileById(hit.file_id).setTrashed(true); } catch (e) { Logger.log('photo trash: ' + e.message); }
  tab_(TAB.PHOTOS).deleteRow(hit._row);
  return 'Photo deleted.';
}

// ---------- general posts ----------
// Anyone can post text (with @tags) and an optional photo, without logging a workout.
// Stored in Feed_Events as type "post", so fires, reactions, comments, photos, hide and admin delete all work.
// The phone picks the id (post_...) so a photo can be attached right behind it in the same save queue.
function apiPost_(me, req, ctx) {
  var text = truncate_(str_(req.text), 1000);
  if (!text && !isTrue_(req.photo)) throw new Error('Write something first.');
  var id = str_(req.id);
  if (!/^post_[A-Za-z0-9_]{6,80}$/.test(id)) id = 'post_' + shortId_();
  var exists = readTable_(TAB.EVENTS).some(function(e) { return e.event_id === id; });
  if (exists) return '';
  appendRows_(TAB.EVENTS, [{ event_id: id, created_at: nowIso_(), type: 'post', participant_id: me.pid, week: '', title: '', body: text }]);
  try { pushToPeople_(pushMentioned_(ctx, text), 'social', 'You were tagged', me.name + ' tagged you: ' + truncate_(text, 100), me.pid); } catch (pe) { Logger.log('push post: ' + pe.message); }
  return '';
}
function apiDeletePost_(me, req, ctx) {
  var id = str_(req.id), hit = null;
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.event_id === id && e.type === 'post') hit = e; });
  if (!hit) return '';
  if (hit.participant_id !== me.pid && !isAdmin_(me, ctx.settings)) throw new Error('You can only delete your own posts.');
  hit.deleted = '1';
  updateRow_(TAB.EVENTS, hit._row, hit);
  return 'Post deleted.';
}

// Reactions: fire (the original) plus a few more. Each person can give each kind once per post (tap again to take it back).
var REACT_KINDS = ['fire', 'beast', 'lol', 'clown', 'dead'];
function reactKind_(r) { var k = str_(r.kind); return k && REACT_KINDS.indexOf(k) !== -1 ? k : 'fire'; }

function apiReact_(me, req, ctx) {
  var target = truncate_(str_(req.target), 120);
  if (!target) throw new Error('Missing post.');
  var kind = REACT_KINDS.indexOf(str_(req.kind)) !== -1 ? str_(req.kind) : 'fire';
  var sh = tab_(TAB.REACTIONS);
  var rows = readTable_(TAB.REACTIONS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].target_id === target && rows[i].participant_id === me.pid && reactKind_(rows[i]) === kind) {
      sh.deleteRow(rows[i]._row);
      return '';
    }
  }
  appendRows_(TAB.REACTIONS, [{ target_id: target, participant_id: me.pid, created_at: nowIso_(), kind: kind }]);
  try {
    var own = pushOwnerOf_(ctx, target);
    var what = own ? (own.what === 'wall' ? 'wall' : own.what === 'workout' ? 'workout' : 'post') : '';
    var said = { fire: ['Fired up', ' fired up your ' + what + '.'], beast: ['Beast', ' gave your ' + what + ' a Beast.'], lol: ['LOL', ' laughed at your ' + what + '.'],
                 clown: ['Clown', ' clowned your ' + what + '.'], dead: ['Dead', ' is dead at your ' + what + '.'] }[kind];
    if (own && own.pid && own.pid !== me.pid) pushQueue_(own.pid, 'social', said[0], me.name + said[1]);
  } catch (pe) { Logger.log('push react: ' + pe.message); }
  return '';
}

function apiComment_(me, req, ctx) {
  var target = truncate_(str_(req.target), 120);
  var text = truncate_(str_(req.text), 500), withPhoto = isTrue_(req.photo);
  if (!target || (!text && !withPhoto)) throw new Error('Write a comment first.');
  // The phone picks the id (c_...) so a photo can be attached to the comment right behind it in the same save queue.
  var id = /^c_[A-Za-z0-9]{6,40}$/.test(str_(req.id)) ? str_(req.id) : 'c_' + shortId_();
  if (readTable_(TAB.COMMENTS).some(function(c) { return c.comment_id === id; })) return '';
  var said = text || 'sent a photo';
  appendRows_(TAB.COMMENTS, [{ comment_id: id, target_id: target, participant_id: me.pid, text: text, created_at: nowIso_() }]);
  if (target.indexOf('wall_') === 0) {
    var owner = ctx.byPid[target.substring(5)];
    if (!owner) throw new Error('Unknown profile.');
    appendRows_(TAB.EVENTS, [{
      event_id: 'wall_' + id, created_at: nowIso_(), type: 'wall', participant_id: me.pid, week: owner.pid,
      title: owner.pid === me.pid ? me.name + ' posted on his own wall' : me.name + ' wrote on ' + owner.name + "'s wall",
      body: text || '(photo)'
    }]);
  }
  try {
    var own = pushOwnerOf_(ctx, target);
    if (own && own.pid && own.pid !== me.pid) pushQueue_(own.pid, 'social', 'New comment', me.name + (own.what === 'wall' ? ' wrote on your wall: ' : ' commented: ') + truncate_(said, 100));
    pushToPeople_(pushMentioned_(ctx, text).filter(function(p) { return !own || p !== own.pid; }), 'social', 'You were tagged', me.name + ': ' + truncate_(text, 100), me.pid);
  } catch (pe) { Logger.log('push comment: ' + pe.message); }
  return '';
}

function apiDeleteComment_(me, req) {
  var id = str_(req.id);
  var rows = readTable_(TAB.COMMENTS);
  var hit = null;
  rows.forEach(function(c) { if (c.comment_id === id) hit = c; });
  if (!hit || hit.participant_id !== me.pid) throw new Error('You can only delete your own comments.');
  tab_(TAB.COMMENTS).deleteRow(hit._row);
  // Photos posted with the comment go too (bottom row first so the row numbers stay right).
  readTable_(TAB.PHOTOS).filter(function(x) { return x.target_id === id; }).sort(function(a, b) { return b._row - a._row; }).forEach(function(x) {
    try { DriveApp.getFileById(x.file_id).setTrashed(true); } catch (e) { Logger.log('photo trash: ' + e.message); }
    tab_(TAB.PHOTOS).deleteRow(x._row);
  });
  var ev = null;
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.event_id === 'wall_' + id) ev = e; });
  if (ev) tab_(TAB.EVENTS).deleteRow(ev._row);
  return 'Comment deleted.';
}

function apiEditWorkout_(me, req, ctx) {
  var id = str_(req.id);
  var hit = null;
  var admin = isAdmin_(me, ctx.settings);
  readTable_(TAB.WORKOUTS).forEach(function(w) { if (w.workout_id === id) hit = w; });
  if (!hit || str_(hit.status).toLowerCase() === 'deleted') throw new Error('You can only edit your own workouts.');
  var others = hit.participant_id !== me.pid;
  if (others && !admin) throw new Error('You can only edit your own workouts.');
  if (!admin && weekOf_(isoOf_(hit.workout_date, ctx.tz), ctx.startIso) !== ctx.currentWeek) throw new Error('Past weeks are locked.');
  var src = str_(hit.source).toLowerCase();
  if (src !== 'app' && src !== 'whoop' && !admin) throw new Error('That workout cannot be edited.');
  hit.note = truncate_(str_(req.note), 500);
  if (src !== 'whoop') {
    var minutes = Math.round(num_(req.minutes, 0));
    if (minutes < 1 || minutes > 600) throw new Error('Enter how many minutes you worked out.');
    hit.duration_minutes = String(minutes);
    hit.activity = truncate_(str_(req.type) || 'Workout', 30);
    hit.effort = truncate_(str_(req.effort), 20);
  }
  if (!(admin && others)) hit.edited_at = nowIso_();   // an admin's edits to someone else's workout leave no "edited" mark
  updateRow_(TAB.WORKOUTS, hit._row, hit);
  return admin && others ? 'Updated.' : 'Workout updated.';
}

function apiSettle_(me, req, ctx) {
  if (!isAdmin_(me, ctx.settings)) throw new Error('Only the admin can settle pots.');
  var week = parseInt(req.week, 10);
  var amount = round2_(num_(req.amount, NaN));
  if (isNaN(week) || week < ctx.bankStartWeek || week >= ctx.currentWeek) throw new Error('That pot is not ready to settle.');
  if (isNaN(amount) || amount < 0 || amount > 100000) throw new Error('Enter the total left after betting.');
  var w = ctx.matrix[week - 1];
  if (!w || w.betTotal <= 0) throw new Error('There was no pot that week.');

  var pots = readTable_(TAB.POTS);
  var existing = null;
  pots.forEach(function(p) { if (parseInt(p.week, 10) === week) existing = p; });
  var members = existing && str_(existing.members) ? str_(existing.members) : w.inMoney.join(',');
  if (!members) throw new Error('Nobody was in the money that week.');
  var row = { week: String(week), end_amount: String(amount), members: members, settled_by: me.pid, settled_at: nowIso_() };
  if (existing) updateRow_(TAB.POTS, existing._row, row); else appendRows_(TAB.POTS, [row]);

  var n = members.split(',').length;
  var each = round2_(amount / n);
  var entryId = 'b_' + shortId_();
  appendRows_(TAB.BANK, [{ entry_id: entryId, created_at: nowIso_(), type: 'settle', participant_id: me.pid, week: String(week), amount: String(amount), note: existing ? 'updated total' : '' }]);
  appendRows_(TAB.EVENTS, [{
    event_id: 'settle_' + entryId, created_at: nowIso_(), type: 'settle', participant_id: me.pid, week: String(week),
    title: me.name + (existing ? ' updated' : ' settled') + ' the Week ' + week + ' pot',
    body: '$' + w.betTotal + ' pot ended at ' + money_(amount) + ' - ' + money_(each) + ' each for ' + n + (n === 1 ? ' guy.' : ' guys.')
  }]);
  // The new total also shows as a comment on the pot's card, so people can reply under it.
  appendRows_(TAB.COMMENTS, [{ comment_id: 'c_' + shortId_(), target_id: 'pot_' + week, participant_id: me.pid, created_at: nowIso_(),
    text: (existing ? 'Updated the pot total to ' : 'Settled the pot at ') + money_(amount) + ' (' + money_(each) + ' each for ' + n + (n === 1 ? ' guy' : ' guys') + ').' }]);
  return 'Pot settled.';
}

// A deposit. Someone's own payment waits (status "pending") until the admin confirms it arrived; only then does it count
// and post to the feed. The admin's own payments, and ones the admin records for someone else (cash), count right away.
function apiPayment_(me, req, ctx) {
  var amount = round2_(num_(req.amount, NaN));
  if (isNaN(amount) || amount <= 0 || amount > 100000) throw new Error('Enter the amount you paid.');
  var admin = isAdmin_(me, ctx.settings), payer = me;
  var forPid = str_(req.forPid);
  if (forPid && forPid !== me.pid) {
    if (!admin) throw new Error('Only the admin can record a payment for someone else.');
    payer = ctx.byPid[forPid];
    if (!payer) throw new Error('Unknown person.');
  }
  var week = /^\d{1,3}$/.test(str_(req.week)) ? str_(req.week) : '';
  var now = nowIso_(), id = 'b_' + shortId_(), confirmed = admin;
  appendRows_(TAB.BANK, [{ entry_id: id, created_at: now, type: 'payment', participant_id: payer.pid, week: week, amount: String(amount), note: truncate_(str_(req.note), 200),
    status: confirmed ? 'confirmed' : 'pending', confirmed_by: confirmed ? me.pid : '', confirmed_at: confirmed ? now : '' }]);
  if (confirmed) {
    paymentEvent_(ctx, id, payer, amount, week);
    return payer.pid === me.pid ? 'Payment recorded.' : 'Recorded ' + money_(amount) + ' from ' + payer.name + '.';
  }
  try {
    pushToPeople_(ctx.people.filter(function(p) { return p.active && isAdmin_(p, ctx.settings); }).map(function(p) { return p.pid; }), 'updates',
      'Payment to confirm', payer.name + ' says they paid ' + money_(amount) + '. Confirm it in the Ledger.', me.pid);
  } catch (pe) { Logger.log('push payment: ' + pe.message); }
  return 'Sent. It counts once the admin confirms it arrived.';
}

function paymentEvent_(ctx, entryId, payer, amount, week) {
  appendRows_(TAB.EVENTS, [{
    event_id: 'payment_' + entryId, created_at: nowIso_(), type: 'payment', participant_id: payer.pid, week: week,
    title: payer.name + ' paid ' + money_(amount), body: (week ? 'Into the Week ' + week + ' pot.' : 'Paid to ' + str_(ctx.settings.bank_name) + '.')
  }]);
}

// Admin: confirm or decline a pending payment. The person who sent it can cancel their own.
function apiPaymentDecide_(me, req, ctx) {
  var id = str_(req.id), decision = str_(req.decision), hit = null;
  readTable_(TAB.BANK).forEach(function(b) { if (b.entry_id === id && b.type === 'payment') hit = b; });
  if (!hit || str_(hit.status).toLowerCase() !== 'pending') throw new Error('That payment is not waiting any more.');
  var payer = ctx.byPid[hit.participant_id], amount = num_(hit.amount, 0), admin = isAdmin_(me, ctx.settings);
  if (decision === 'cancel') {
    if (hit.participant_id !== me.pid && !admin) throw new Error('You can only cancel your own payment.');
    tab_(TAB.BANK).deleteRow(hit._row);
    return 'Payment cancelled.';
  }
  if (!admin) throw new Error('Only the admin can confirm payments.');
  var ok = decision === 'confirm';
  hit.status = ok ? 'confirmed' : 'declined'; hit.confirmed_by = me.pid; hit.confirmed_at = nowIso_();
  updateRow_(TAB.BANK, hit._row, hit);
  if (ok && payer) paymentEvent_(ctx, id, payer, amount, str_(hit.week));
  try {
    if (payer) pushQueue_(payer.pid, 'updates', ok ? 'Payment confirmed' : 'Payment not confirmed',
      ok ? 'Your ' + money_(amount) + ' payment was confirmed. Thanks!' : 'Your ' + money_(amount) + " payment wasn't confirmed. Check with " + me.name + '.');
  } catch (pe) { Logger.log('push decide: ' + pe.message); }
  return ok ? 'Payment confirmed.' : 'Payment declined.';
}

function apiJoin_(me, req) {
  var ch = str_(req.challenge);
  if (ch !== 'strain' && ch !== 'weight') throw new Error('Unknown challenge.');
  var rows = readTable_(TAB.MEMBERS);
  for (var i = 0; i < rows.length; i++) { if (rows[i].challenge === ch && rows[i].participant_id === me.pid) return ''; }
  appendRows_(TAB.MEMBERS, [{ challenge: ch, participant_id: me.pid, joined_at: nowIso_() }]);
  return 'You are in.';
}

function apiLeave_(me, req) {
  var ch = str_(req.challenge);
  var sh = tab_(TAB.MEMBERS);
  var rows = readTable_(TAB.MEMBERS);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].challenge === ch && rows[i].participant_id === me.pid) sh.deleteRow(rows[i]._row);
  }
  return 'You left the challenge.';
}

function apiWeight_(me, req, ctx) {
  var v = Math.round(num_(req.weight, NaN) * 10) / 10;
  if (isNaN(v) || v < 50 || v > 700) throw new Error('Enter your weight in pounds.');
  var rows = readTable_(TAB.WEIGHTS);
  var row = { participant_id: me.pid, date: ctx.today, weight: String(v), created_at: nowIso_() };
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].participant_id === me.pid && isoOf_(rows[i].date, ctx.tz) === ctx.today) {
      updateRow_(TAB.WEIGHTS, rows[i]._row, row);
      return 'Weight updated.';
    }
  }
  appendRows_(TAB.WEIGHTS, [row]);
  return 'Weight logged.';
}


// ----------------------------------------------------------------
// STATE - everything the app shows, in one payload
// ----------------------------------------------------------------

function computeBank_(ctx) {
  var potRows = {};
  readTable_(TAB.POTS).forEach(function(p) { potRows[parseInt(p.week, 10)] = p; });
  var acct = {};
  ctx.people.forEach(function(p) { if (p.active) acct[p.pid] = { pid: p.pid, won: 0, fines: 0, entries: 0, paid: 0, side: 0, open: 0, openCount: 0, cwon: 0, cfines: 0 }; });

  var pots = [], fineRows = {};
  for (var wk = ctx.currentWeek - 1; wk >= ctx.bankStartWeek; wk--) {
    var w = ctx.matrix[wk - 1];
    if (!w || w.exempt) continue;
    w.buying.forEach(function(b) {
      if (!acct[b.pid]) return;
      acct[b.pid].fines += b.amount;
      (fineRows[b.pid] = fineRows[b.pid] || []).push({ key: 'w' + wk, date: Date.parse(w.end + 'T12:00:00Z') || 0, amount: b.amount });
    });
    if (w.betTotal <= 0) continue;
    var saved = potRows[wk];
    var members = saved && str_(saved.members) ? str_(saved.members).split(',') : w.inMoney.slice();
    var pot = {
      week: wk, label: 'Week ' + wk + ' pot',
      betDates: mdLabel_(addDays_(w.end, 1)) + '-' + mdLabel_(addDays_(w.end, 7)),
      start: w.betTotal, members: members, settled: !!saved, id: 'pot_' + wk,
      dues: w.buying.filter(function(b) { return acct[b.pid]; }).map(function(b) { return { pid: b.pid, amount: b.amount }; })
    };
    if (saved) {
      pot.end = num_(saved.end_amount, 0);
      pot.each = members.length ? round2_(pot.end / members.length) : 0;
      pot.by = saved.settled_by; pot.at = saved.settled_at;
      members.forEach(function(pid) { if (acct[pid]) acct[pid].won = round2_(acct[pid].won + pot.each); });
    }
    pots.push(pot);
  }

  // Payments count once confirmed (older rows with no status count too). Pending ones are listed for the admin to confirm.
  var log = [], pending = [];
  readTable_(TAB.BANK).forEach(function(b) {
    var amt = num_(b.amount, 0), st = str_(b.status).toLowerCase();
    if (b.type === 'payment' && acct[b.participant_id]) {
      if (st === 'pending') pending.push({ id: b.entry_id, pid: b.participant_id, amount: amt, week: str_(b.week), ts: b.created_at });
      else if (st !== 'declined') acct[b.participant_id].paid = round2_(acct[b.participant_id].paid + amt);
    }
    log.push({ type: b.type, pid: b.participant_id, week: b.week, amount: amt, ts: b.created_at, note: b.note, status: st });
  });
  pending.sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  log.sort(function(a, b) { return String(b.ts).localeCompare(String(a.ts)); });

  // Side bets: settled ones move the balance; money on bets still open is only listed, not counted.
  var sb = sbData_(ctx), betStatus = {};
  sb.bets.forEach(function(b) { betStatus[b.bet_id] = b.status; });
  Object.keys(sb.wagers).forEach(function(id) {
    sb.wagers[id].forEach(function(w) {
      var a = acct[w.participant_id];
      if (!a || w.status !== 'in') return;
      if (betStatus[id] === 'settled') a.side = round2_(a.side + num_(w.payout, 0));
      else if (betStatus[id] === 'open') { a.open = round2_(a.open + num_(w.amount, 0)); a.openCount++; }
    });
  });

  // Custom challenges: a missed week is a fine; the fines of a finished week are split by the people who hit it.
  chalAll_(ctx).forEach(function(c) {
    c.weeksList.forEach(function(w) {
      if (w.state !== 'final') return;
      w.misses.forEach(function(pid) {
        if (!acct[pid]) return;
        acct[pid].cfines = round2_(acct[pid].cfines + c.fine);
        (fineRows[pid] = fineRows[pid] || []).push({ key: 'x' + c.id + '_' + w.k, date: Date.parse(w.end + 'T12:00:00Z') || 0, amount: c.fine });
      });
      w.yes.forEach(function(pid) { if (acct[pid]) acct[pid].cwon = round2_(acct[pid].cwon + w.each); });
    });
  });

  // Custom pots: each member owes the entry; winners of a settled pot split the total.
  var cpots = cpotRows_();
  cpots.forEach(function(cp) {
    cp.members.forEach(function(pid, i) {
      if (!acct[pid]) return;
      acct[pid].entries = round2_(acct[pid].entries + cp.entry);
      (fineRows[pid] = fineRows[pid] || []).push({ key: 'c' + cp.id, date: Date.parse(cp.joined[i]) || 0, amount: cp.entry });
    });
    if (cp.status === 'settled' && cp.winners.length) {
      var share = round2_((cp.end || 0) / cp.winners.length);
      cp.winners.forEach(function(w) { if (acct[w]) acct[w].won = round2_(acct[w].won + share); });
    }
  });

  var accounts = Object.keys(acct).map(function(pid) {
    var a = acct[pid];
    a.balance = round2_(a.won + a.cwon - a.fines - a.cfines - a.entries + a.paid + a.side);
    a.owes = a.balance < 0 ? round2_(-a.balance) : 0;
    a.pending = round2_(pending.filter(function(x) { return x.pid === pid; }).reduce(function(t, x) { return t + x.amount; }, 0));
    return a;
  });

  // Who has paid what into each pot: confirmed payments are applied to a person's fines oldest week first.
  var alloc = {};
  accounts.forEach(function(a) {
    var left = a.paid; alloc[a.pid] = {};
    (fineRows[a.pid] || []).sort(function(x, y) { return x.date - y.date; }).forEach(function(f) {
      var take = Math.max(0, Math.min(left, f.amount)); alloc[a.pid][f.key] = round2_(take); left = round2_(left - take);
    });
  });
  var potTalk = {}, potPics = {};
  var cmtPics = {};
  readTable_(TAB.PHOTOS).forEach(function(x) {
    var t = str_(x.target_id), ph = { id: x.photo_id, fileId: x.file_id, pid: x.participant_id, ts: x.created_at };
    if (t.indexOf('pot_') === 0 || t.indexOf('cpot_') === 0) (potPics[t] = potPics[t] || []).push(ph);
    else if (t.indexOf('c_') === 0) (cmtPics[t] = cmtPics[t] || []).push(ph);
  });
  readTable_(TAB.COMMENTS).forEach(function(c) { if (str_(c.target_id).indexOf('pot_') === 0 || str_(c.target_id).indexOf('cpot_') === 0) (potTalk[c.target_id] = potTalk[c.target_id] || []).push({ id: c.comment_id, pid: c.participant_id, text: c.text, ts: c.created_at, photos: cmtPics[c.comment_id] || [] }); });
  pots.forEach(function(pt) {
    pt.dues = pt.dues.map(function(d) { var paid = alloc[d.pid] && alloc[d.pid]['w' + pt.week] || 0; return { pid: d.pid, amount: d.amount, paid: paid, left: round2_(d.amount - paid) }; });
    pt.paid = round2_(pt.dues.reduce(function(t, d) { return t + d.paid; }, 0));
    pt.outstanding = round2_(pt.dues.reduce(function(t, d) { return t + d.left; }, 0));
    pt.comments = (potTalk[pt.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    pt.photos = (potPics[pt.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  });
  var openBets = accounts.filter(function(a) { return a.open > 0; }).map(function(a) { return { pid: a.pid, amount: a.open, count: a.openCount }; })
    .sort(function(a, b) { return b.amount - a.amount; });
  accounts.sort(function(a, b) { return b.balance - a.balance || ctx.byPid[a.pid].name.localeCompare(ctx.byPid[b.pid].name); });
  var cpotOut = cpots.map(function(cp) {
    var dues = cp.members.filter(function(pid) { return acct[pid]; }).map(function(pid) { var paid = alloc[pid] && alloc[pid]['c' + cp.id] || 0; return { pid: pid, amount: cp.entry, paid: paid, left: round2_(cp.entry - paid) }; });
    var each = cp.status === 'settled' && cp.winners.length ? round2_((cp.end || 0) / cp.winners.length) : 0;
    return { id: cp.id, custom: true, label: cp.name, description: cp.description, entry: cp.entry, createdBy: cp.createdBy, createdAt: cp.createdAt, settled: cp.status === 'settled', members: cp.members, winners: cp.winners,
      start: round2_(cp.entry * cp.members.length), end: cp.end, each: each, by: cp.by, at: cp.at, dues: dues,
      paid: round2_(dues.reduce(function(t, d) { return t + d.paid; }, 0)), outstanding: round2_(dues.reduce(function(t, d) { return t + d.left; }, 0)),
      comments: (potTalk[cp.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); }), photos: (potPics[cp.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); }) };
  }).sort(function(a, b) { return a.settled - b.settled || String(b.createdAt).localeCompare(String(a.createdAt)); });
  var adm = ctx.people.filter(function(p) { return isAdmin_(p, ctx.settings); })[0];
  return { startWeek: ctx.bankStartWeek, bankName: str_(ctx.settings.bank_name), venmo: str_(ctx.settings.venmo_user) || 'BC-Dads-WAG', adminName: adm ? adm.name : 'the admin',
    pots: pots, customPots: cpotOut, accounts: accounts, openBets: openBets, pending: pending, log: log.slice(0, 40) };
}

function computeChallenges_(me, ctx) {
  var members = { strain: {}, weight: {} };
  readTable_(TAB.MEMBERS).forEach(function(m) { if (members[m.challenge]) members[m.challenge][m.participant_id] = true; });

  // Strain: total day strain per member for this week and last week.
  function strainBoard(wk) {
    if (wk < 1) return [];
    var ws = dayNum_(weekStartIso_(ctx.startIso, wk)), we = ws + 6;
    var totals = {};
    cycles.forEach(function(c) {
      if (!members.strain[c.participant_id] || !ctx.byPid[c.participant_id]) return;
      var iso = isoOf_(c.cycle_date, ctx.tz);
      if (!iso) return;
      var d = dayNum_(iso);
      if (d < ws || d > we) return;
      if (!totals[c.participant_id]) totals[c.participant_id] = { pid: c.participant_id, total: 0, days: 0 };
      totals[c.participant_id].total += num_(c.strain, 0);
      totals[c.participant_id].days++;
    });
    var out = Object.keys(totals).map(function(k) { totals[k].total = Math.round(totals[k].total * 10) / 10; return totals[k]; });
    out.sort(function(a, b) { return b.total - a.total; });
    return out;
  }
  var cycles = readTable_(TAB.CYCLES);
  ctx._cycles = cycles;
  ctx._members = members;
  var seasonTotals = {};
  cycles.forEach(function(c) {
    if (!members.strain[c.participant_id] || !ctx.byPid[c.participant_id]) return;
    var iso = isoOf_(c.cycle_date, ctx.tz);
    if (!iso || dayNum_(iso) < dayNum_(ctx.startIso)) return;
    seasonTotals[c.participant_id] = (seasonTotals[c.participant_id] || 0) + num_(c.strain, 0);
  });
  var season = Object.keys(seasonTotals).map(function(pid) { return { pid: pid, total: Math.round(seasonTotals[pid] * 10) / 10 }; });
  season.sort(function(a, b) { return b.total - a.total; });

  // Weight: percent change from each member's first weigh-in. Other people's pounds never leave the server.
  var byPid = {};
  readTable_(TAB.WEIGHTS).forEach(function(r) {
    if (!members.weight[r.participant_id]) return;
    var iso = isoOf_(r.date, ctx.tz);
    var v = num_(r.weight, NaN);
    if (!iso || isNaN(v)) return;
    if (!byPid[r.participant_id]) byPid[r.participant_id] = [];
    byPid[r.participant_id].push({ date: iso, weight: v });
  });
  var board = [];
  Object.keys(byPid).forEach(function(pid) {
    if (!ctx.byPid[pid]) return;
    var list = byPid[pid].sort(function(a, b) { return a.date.localeCompare(b.date); });
    var first = list[0].weight, last = list[list.length - 1].weight;
    board.push({ pid: pid, pct: Math.round((last - first) / first * 1000) / 10, weighIns: list.length, lastDate: list[list.length - 1].date });
  });
  board.sort(function(a, b) { return a.pct - b.pct; });

  return {
    strain: {
      joined: !!members.strain[me.pid], count: Object.keys(members.strain).length,
      thisWeek: strainBoard(ctx.currentWeek), lastWeek: strainBoard(ctx.currentWeek - 1), season: season,
      members: Object.keys(members.strain)
    },
    weight: {
      joined: !!members.weight[me.pid], count: Object.keys(members.weight).length,
      board: board, mine: (byPid[me.pid] || []).slice(-12), members: Object.keys(members.weight)
    }
  };
}

// When a workout shows in the feed. WHOOP: when it ended. Texts and old manual logs: when they were
// received if that was the same day, otherwise midday on the workout's own date (so a bulk import
// doesn't stamp a whole season of texts as "just now").
function feedTime_(w, tz) {
  if (str_(w.workout_end)) return str_(w.workout_end);
  var created = str_(w.created_at);
  if (created && str_(w.source) === 'app') return created;
  if (created && isoOf_(new Date(created), tz) === w._date) return created;
  return w._date + 'T17:00:00.000Z';
}

// The WHOOP numbers shown on a card: heart rate, calories, distance, and minutes in each heart rate zone.
function whoopDetail_(w) {
  var z = str_(w.zones) ? str_(w.zones).split(',').map(function(x) { return x === '' ? 0 : num_(x, 0); }) : [];
  var avg = num_(w.avg_hr, 0), max = num_(w.max_hr, 0), kj = num_(w.kilojoules, 0), dist = num_(w.distance_m, 0);
  if (!avg && !max && !kj && !dist && !z.length) return null;
  return { avgHr: Math.round(avg) || 0, maxHr: Math.round(max) || 0, kcal: Math.round(kj / 4.184) || 0,
           miles: dist ? Math.round(dist / 1609.344 * 100) / 100 : 0, zones: z, sport: str_(w.activity), minutes: w.duration_minutes === '' ? null : Math.round(num_(w.duration_minutes, 0)) };
}

// Builds feed items. onlyPid = one person's posts (for profiles); limit = how many to return.
function feedItems_(me, ctx, onlyPid, limit) {
  var showAll = isTrue_(ctx.settings.feed_show_all_whoop);
  var adminMe = isAdmin_(me, ctx.settings);

  // Matching: a workout logged in the app and a WHOOP workout from the same person on the same day (similar length) are
  // the same session, so they merge into ONE card: the logged workout (its note, effort, photos) plus the WHOOP numbers
  // (strain, heart rate, zones, calories). Merging never changes what counts toward the week: that is worked out from
  // each workout on its own, so a logged workout still counts even if the WHOOP session was under the strain minimum.
  // Override in the Sheet: put a WHOOP workout id (or "none" to never merge) in the logged workout's link_to column.
  var whoopBy = {}, loggedBy = {};
  ctx.workouts.forEach(function(w) {
    if (!w._date) return;
    var k = w.participant_id + '|' + w._date, sr = str_(w.source).toLowerCase();
    if (sr === 'whoop') (whoopBy[k] = whoopBy[k] || []).push(w);
    else if (sr !== 'sms') (loggedBy[k] = loggedBy[k] || []).push(w);
  });
  var mergedInto = {}, withWhoop = {};
  Object.keys(loggedBy).forEach(function(k) {
    // Every logged/WHOOP pairing for the day, scored by how close the lengths are; the closest pairs are matched first.
    var pairs = [];
    loggedBy[k].forEach(function(lw) {
      var want = str_(lw.link_to);
      if (want === 'none') return;
      var ld = parseFloat(lw.duration_minutes);
      (whoopBy[k] || []).forEach(function(ww) {
        var cost;
        if (want) { if (ww.workout_id !== want) return; cost = -1; }
        else {
          var wd = parseFloat(ww.duration_minutes);
          if (!isNaN(ld) && !isNaN(wd)) { if (Math.min(ld, wd) / Math.max(ld, wd) < 0.4) return; cost = Math.abs(ld - wd); }
          else cost = 1000 - num_(ww.strain, 0);   // no length to compare: prefer the biggest session
        }
        pairs.push({ lw: lw, ww: ww, cost: cost });
      });
    });
    pairs.sort(function(a, b) { return a.cost - b.cost || String(a.lw.created_at).localeCompare(String(b.lw.created_at)); });
    pairs.forEach(function(pr) {
      if (withWhoop[pr.lw.workout_id] || mergedInto[pr.ww.workout_id]) return;
      mergedInto[pr.ww.workout_id] = pr.lw; withWhoop[pr.lw.workout_id] = pr.ww;
    });
  });

  // Texted entries stay as before: hidden when a WHOOP post (or another counted log) covers the same day.
  // The WHOOP post "owns" the day: the highest-strain unmerged one that counts.
  var primary = {}, hasReal = {};
  ctx.workouts.forEach(function(w) {
    if (!w._date || !w._ok) return;
    var key = w.participant_id + '|' + w._date;
    var src = str_(w.source).toLowerCase();
    if (src !== 'sms') hasReal[key] = true;
    if (src === 'whoop' && !mergedInto[w.workout_id] && (!primary[key] || num_(w.strain, 0) > num_(primary[key].strain, 0))) primary[key] = w;
  });

  var alias = {};
  var items = [];
  ctx.workouts.forEach(function(w) {
    var p = ctx.byPid[w.participant_id];
    if (!p || !w._date) return;
    if (onlyPid && w.participant_id !== onlyPid) return;
    var src = str_(w.source).toLowerCase();
    var key = w.participant_id + '|' + w._date;
    if (src === 'whoop' && mergedInto[w.workout_id]) { alias[w.workout_id] = mergedInto[w.workout_id].workout_id; return; }   // shown on the logged workout's card
    if (src === 'sms' && primary[key]) { alias[w.workout_id] = primary[key].workout_id; return; }
    if (src === 'whoop' && !w._ok && !showAll) return;
    if (src === 'sms' && hasReal[key]) return;
    var mineThisWeek = w.participant_id === me.pid && weekOf_(w._date, ctx.startIso) === ctx.currentWeek;
    var ww = withWhoop[w.workout_id], detailRow = src === 'whoop' ? w : ww;
    items.push({
      id: w.workout_id, kind: 'w', pid: w.participant_id, ts: feedTime_(ww || w, ctx.tz),
      date: w._date, source: src, activity: str_(w.activity),
      minutes: w.duration_minutes === '' ? null : Math.round(num_(w.duration_minutes, 0)),
      strain: ww ? (ww.strain === '' ? null : num_(ww.strain, null)) : (w.strain === '' ? null : num_(w.strain, null)),
      effort: str_(w.effort), note: str_(w.note), ok: !!w._ok, editedAt: str_(w.edited_at),
      detail: detailRow ? whoopDetail_(detailRow) : null,
      canDelete: src === 'app' && mineThisWeek,
      canEdit: mineThisWeek || adminMe ? (src === 'whoop' ? 'note' : (src === 'app' || adminMe ? 'full' : '')) : ''
    });
  });
  readTable_(TAB.EVENTS).forEach(function(e) {
    if (e.type === 'post' || e.type === 'wall') actBump_(ctx, e.participant_id, e.created_at);
    if (str_(e.deleted)) return;
    if (onlyPid && e.participant_id !== onlyPid) return;
    items.push({ id: e.event_id, kind: 'e', type: e.type, pid: e.participant_id, ts: e.created_at, title: e.title, body: e.body,
                 toPid: e.type === 'wall' ? str_(e.week) : '', badgeId: e.type.indexOf('badge_') === 0 ? str_(e.week) : '', potId: e.type === 'custompot' ? str_(e.week) : '', chalId: e.type === 'customchal' ? str_(e.week) : '' });
  });
  if (!onlyPid) {
    // Side bets: an open bet shows as a card (never to the people it is hidden from); a finished one shows its result to everyone.
    sbData_(ctx).bets.forEach(function(b) {
      if (b.status === 'open') {
        if (csv_(b.hidden).indexOf(me.pid) !== -1) return;
        items.push({ id: b.bet_id, kind: 'e', type: 'bet', pid: b.proposer, ts: b.created_at, title: b.prompt, body: '', betId: b.bet_id });
      } else {
        alias[b.bet_id] = 'r' + b.bet_id;
        items.push({ id: 'r' + b.bet_id, kind: 'e', type: b.status === 'void' ? 'bet_off' : 'bet_result', pid: '', ts: b.settled_at, title: b.result_title, body: b.result_body, betId: b.bet_id });
      }
    });
  }
  if (!onlyPid) {
    // Custom challenges: the check-in question (only to people in it, until the week is settled) and the result once it is.
    chalAll_(ctx).forEach(function(c) {
      c.weeksList.forEach(function(w) {
        if (w.state === 'answering' && c.members.indexOf(me.pid) !== -1) {
          items.push({ id: 'cq_' + c.id + '_' + w.k, kind: 'e', type: 'chalq', pid: '', ts: addDays_(w.end, 1) + 'T05:00:00.000Z', title: 'Check-in: ' + c.name,
            body: 'Week ' + w.k + ' of ' + c.weeks + '. ' + c.rules, chalId: c.id, week: w.k, mine: (w.answers[me.pid] || ''), fine: c.fine, by: addDays_(w.end, CHAL_GRACE_DAYS) });
        }
        if (w.state === 'final') items.push({ id: 'cr_' + c.id + '_' + w.k, kind: 'e', type: 'chalres', pid: '', ts: w.finalTs, title: c.name + ': Week ' + w.k + ' results', body: chalResultText_(ctx, c, w), chalId: c.id, week: w.k });
      });
    });
  }
  items.sort(function(a, b) { return new Date(b.ts).getTime() - new Date(a.ts).getTime(); });
  items = items.slice(0, limit);

  var reacts = {};
  readTable_(TAB.REACTIONS).forEach(function(r) {
    actBump_(ctx, r.participant_id, r.created_at);
    var t = alias[r.target_id] || r.target_id, k = reactKind_(r);
    if (!reacts[t]) reacts[t] = {};
    if (!reacts[t][k]) reacts[t][k] = [];
    if (reacts[t][k].indexOf(r.participant_id) === -1) reacts[t][k].push(r.participant_id);
  });
  var photos = {};
  readTable_(TAB.PHOTOS).forEach(function(x) {
    var t = alias[x.target_id] || x.target_id;
    (photos[t] = photos[t] || []).push({ id: x.photo_id, fileId: x.file_id, pid: x.participant_id, ts: x.created_at });
  });
  var comments = {};
  readTable_(TAB.COMMENTS).forEach(function(c) {
    actBump_(ctx, c.participant_id, c.created_at);
    var t = alias[c.target_id] || c.target_id;
    if (!comments[t]) comments[t] = [];
    comments[t].push({ id: c.comment_id, pid: c.participant_id, text: c.text, ts: c.created_at, photos: photos[c.comment_id] || [] });
  });
  items.forEach(function(it) {
    it.photos = (photos[it.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    it.reacts = reacts[it.id] || {};
    it.firedBy = it.reacts.fire || [];
    it.fires = it.firedBy.length;
    it.fired = it.firedBy.indexOf(me.pid) !== -1;
    it.comments = (comments[it.id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  });
  return items;
}

function buildFeed_(me, ctx) { return feedItems_(me, ctx, '', 150); }

// One person's page: all their posts plus their comment wall.
function buildProfile_(me, ctx, pid) { return withReadCache_(function() { return buildProfileCore_(me, ctx, pid); }); }
function buildProfileCore_(me, ctx, pid) {
  if (!ctx.byPid[pid]) return null;
  var wall = [];
  readTable_(TAB.COMMENTS).forEach(function(c) {
    if (c.target_id === 'wall_' + pid) wall.push({ id: c.comment_id, pid: c.participant_id, text: c.text, ts: c.created_at, mine: c.participant_id === me.pid });
  });
  wall.sort(function(a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  return { pid: pid, items: feedItems_(me, ctx, pid, 200), wall: wall };
}

// Posts "earned" / "lost" badge events by comparing today's holders with the last saved list.
// Runs on every sync and right after someone logs, edits or deletes a workout, settles a pot,
// logs a payment or a weigh-in. (Not after fires or comments - tapping a fire on and off would
// spam the feed - so Crowd Favorite / Hype Man changes land on the next sync.)
// The first run (and any brand-new badge) just records who holds what, without posting.
// Returns the list of events it posted.
function generateBadgeEvents_(ctx) {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('V7_MIGRATED')) return [];
  var bank = computeBank_(ctx);
  var ch = computeChallenges_({ pid: '' }, ctx);
  var badges = computeBadges_(ctx, bank, ch).badges;
  var saved = {};
  try { saved = JSON.parse(props.getProperty('BADGE_HOLDERS') || '{}') || {}; } catch (e) { saved = {}; }
  var next = {}, add = [];
  badges.forEach(function(b) {
    var now = b.holders.map(function(h) { return h.pid; });
    next[b.id] = now;
    var before = saved[b.id];
    if (b.kind === 'weekly') {
      // Weekly badges are handed out once, when a week closes: one post naming whoever won it.
      var wkKey = '_week_' + b.id, lastWeek = ctx.currentWeek - 1;
      var seen = saved[wkKey] ? parseInt(saved[wkKey][0], 10) : null;
      var settled = Date.now() >= localMidnightMs_(weekStartIso_(ctx.startIso, ctx.currentWeek), ctx.tz) + SB_GRACE_MIN * 60000;   // give late WHOOP data time to land
      if (seen === null || !before) { next[wkKey] = [String(lastWeek)]; return; }       // first time this badge is seen: no post
      if (seen === lastWeek || !settled) { next[wkKey] = [String(seen)]; return; }
      next[wkKey] = [String(lastWeek)];
      var wn = now.filter(function(pid) { return ctx.byPid[pid]; });
      if (wn.length) {
        var d0 = b.holders.filter(function(x) { return x.pid === wn[0]; })[0];
        add.push({ event_id: 'badge_' + shortId_(), created_at: nowIso_(), type: 'badge_gain', participant_id: wn.length === 1 ? wn[0] : '', week: b.id,
          title: wn.map(function(x) { return ctx.byPid[x].name; }).join(', ').replace(/, ([^,]*)$/, ' and $1') + (wn.length > 1 ? ' share ' : ' takes ') + b.name + ' for Week ' + lastWeek,
          body: b.desc + (d0 && d0.detail ? ' ' + d0.detail + '.' : ''), _you: 'You took ' + b.name, _lost: [], _badge: b.name, _winners: wn });
      }
      return;
    }
    if (!before) return;
    var gained = now.filter(function(pid) { return before.indexOf(pid) === -1 && ctx.byPid[pid]; });
    var lost = before.filter(function(pid) { return now.indexOf(pid) === -1 && ctx.byPid[pid] && ctx.byPid[pid].active; });
    function detailOf(pid) { var h = b.holders.filter(function(x) { return x.pid === pid; })[0]; return h && h.detail ? ' ' + h.detail + '.' : ''; }
    function names(list) { return list.map(function(x) { return ctx.byPid[x].name; }).join(' and '); }
    if (b.kind === 'title') {
      // A title changing hands is ONE post: "Marquis stole Strain King from Protasewich."
      gained.forEach(function(pid) {
        var kept = before.filter(function(x) { return now.indexOf(x) !== -1 && ctx.byPid[x]; });
        var verb = lost.length ? ' stole ' + b.name + ' from ' + names(lost) : kept.length ? ' tied ' + names(kept) + ' for ' + b.name : ' took ' + b.name;
        add.push({ event_id: 'badge_' + shortId_(), created_at: nowIso_(), type: 'badge_gain', participant_id: pid, week: b.id,
          title: ctx.byPid[pid].name + verb, body: b.desc + detailOf(pid),
          _you: 'You' + verb, _lost: lost, _badge: b.name });
      });
      if (!gained.length) lost.forEach(function(pid) {
        add.push({ event_id: 'badge_' + shortId_(), created_at: nowIso_(), type: 'badge_loss', participant_id: pid, week: b.id,
          title: ctx.byPid[pid].name + ' lost ' + b.name, body: b.desc + (now.length ? ' Now held by ' + names(now) + '.' : ''), _you: 'You lost ' + b.name });
      });
      return;
    }
    gained.forEach(function(pid) {
      add.push({ event_id: 'badge_' + shortId_(), created_at: nowIso_(), type: 'badge_gain', participant_id: pid, week: b.id,
        title: ctx.byPid[pid].name + ' earned ' + b.name, body: b.desc + detailOf(pid), _you: 'You earned ' + b.name });
    });
    lost.forEach(function(pid) {
      add.push({ event_id: 'badge_' + shortId_(), created_at: nowIso_(), type: 'badge_loss', participant_id: pid, week: b.id,
        title: ctx.byPid[pid].name + ' lost ' + b.name, body: b.desc, _you: 'You lost ' + b.name });
    });
  });
  props.setProperty('BADGE_HOLDERS', JSON.stringify(next));
  appendRows_(TAB.EVENTS, add);
  return add;
}

// Season stats per person (used by profiles and by the badge rules in Badges.gs).
function computeStats_(ctx, bank, ch) {
  var active = ctx.people.filter(function(p) { return p.active; });
  var idx = {};
  ctx.people.forEach(function(p, i) { idx[p.pid] = i; });
  var startNum = dayNum_(ctx.startIso);

  // fires received and given
  var owner = {};
  ctx.workouts.forEach(function(w) { owner[w.workout_id] = w.participant_id; });
  readTable_(TAB.EVENTS).forEach(function(e) { if (e.participant_id) owner[e.event_id] = e.participant_id; });
  var got = {}, gave = {};
  readTable_(TAB.REACTIONS).forEach(function(r) {
    if (reactKind_(r) !== 'fire') return;   // badges count fires only
    gave[r.participant_id] = (gave[r.participant_id] || 0) + 1;
    var o = owner[r.target_id];
    if (o && o !== r.participant_id) got[o] = (got[o] || 0) + 1;
  });

  // total day strain per person per week (Strain challenge members only)
  var weekStrain = {};
  (ctx._cycles || []).forEach(function(c) {
    if (!ctx._members || !ctx._members.strain[c.participant_id]) return;
    var iso = isoOf_(c.cycle_date, ctx.tz);
    if (!iso || dayNum_(iso) < startNum) return;
    var k = c.participant_id + '|' + weekOf_(iso, ctx.startIso);
    weekStrain[k] = (weekStrain[k] || 0) + num_(c.strain, 0);
  });

  var balance = {}, seasonStrain = {}, weightPct = {};
  bank.accounts.forEach(function(a) { balance[a.pid] = a.balance; });
  ch.strain.season.forEach(function(r) { seasonStrain[r.pid] = r.total; });
  ch.weight.board.forEach(function(r) { weightPct[r.pid] = r.pct; });

  var counted = countedWorkouts_(ctx);
  var stats = {};
  active.forEach(function(p) {
    var days = ctx.credits[p.pid] || {};
    var nums = [];
    for (var iso in days) { var dn = dayNum_(iso); if (dn >= startNum) nums.push(dn); }
    var s = {
      pid: p.pid, name: p.name,
      total: nums.length,          // workouts that counted this season (one per day)
      complete: 0,                 // weeks made
      missed: 0,                   // weeks bought the bet
      played: 0,                   // complete + missed
      streak: 0,                   // current run of weeks made
      longest: 0,                  // longest run of weeks made
      fines: 0,                    // total fines, dollars
      bestWeek: 0,                 // most workouts in any one week
      overWeek: 0,                 // first week with 5+ workouts (0 = never)
      dailyWeek: 0,                // first week with a workout all 7 days
      earlyWeek: 0,                // first week the minimum was hit by Wednesday
      escapeWeek: 0,               // first week he was dormie and still made it
      comebackWeek: 0,             // first week made right after buying the bet
      balance: balance[p.pid] || 0,
      firesGot: got[p.pid] || 0,
      firesGave: gave[p.pid] || 0,
      inStrain: !!(ctx._members && ctx._members.strain[p.pid]),
      strainSeason: seasonStrain[p.pid] || 0,
      strainBestWeek: 0,           // highest one-week strain total
      strain100Week: 0,            // first week with 100+ total strain
      inWeight: !!(ctx._members && ctx._members.weight[p.pid]),
      weightPct: weightPct[p.pid] === undefined ? null : weightPct[p.pid],
      minutesSeason: 0,            // workout minutes this season
      compliantMinutes: 0,         // workout minutes in the weeks he made (missed weeks left out)
      lastWeek: 0,                 // number of the week that just finished (0 = none yet, or it was an off week)
      lastWeekWorkouts: 0,         // workouts that counted last week
      lastWeekMinutes: 0,          // workout minutes last week
      lastWeekStrain: 0            // total day strain last week (Strain challenge members only)
    };
    var mineCounted = counted[p.pid] || [];
    var prev = '';
    ctx.matrix.forEach(function(w) {
      var c = w.cells[idx[p.pid]];
      if (!c || c.status === 'exempt' || c.status === 'inactive') return;
      if (c.count > s.bestWeek) s.bestWeek = c.count;
      if (c.count >= 5 && !s.overWeek) s.overWeek = w.week;
      if (c.count >= 7 && !s.dailyWeek) s.dailyWeek = w.week;
      var wkMin = 0, d0 = dayNum_(w.start);
      mineCounted.forEach(function(it) { var dn = dayNum_(it.date); if (dn >= d0 && dn <= d0 + 6) wkMin += it.minutes; });
      s.minutesSeason += wkMin;
      if (c.status === 'complete') s.compliantMinutes += wkMin;
      var ws = weekStrain[p.pid + '|' + w.week] || 0;
      if (ws > s.strainBestWeek) s.strainBestWeek = Math.round(ws * 10) / 10;
      if (ws >= 100 && !s.strain100Week) s.strain100Week = w.week;
      if (w.week === ctx.currentWeek - 1) { s.lastWeek = w.week; s.lastWeekWorkouts = c.count; s.lastWeekMinutes = wkMin; s.lastWeekStrain = Math.round(ws * 10) / 10; }
      if (c.status === 'eliminated') {
        s.missed++; s.fines += c.fine || 0; s.streak = 0; prev = 'eliminated';
      } else if (c.status === 'complete') {
        s.complete++; s.streak++;
        if (s.streak > s.longest) s.longest = s.streak;
        if (prev === 'eliminated' && !s.comebackWeek) s.comebackWeek = w.week;
        prev = 'complete';
        var start = dayNum_(w.start);
        var byWed = nums.filter(function(n) { return n >= start && n <= start + 2; }).length;
        if (byWed >= ctx.minDays && !s.earlyWeek) s.earlyWeek = w.week;
        for (var i = 0; i < 7 && !s.escapeWeek; i++) {
          var before = nums.filter(function(n) { return n >= start && n < start + i; }).length;
          var needed = ctx.minDays - before;
          if (needed > 0 && (7 - i) === needed) s.escapeWeek = w.week;
        }
      }
    });
    s.played = s.complete + s.missed;
    stats[p.pid] = s;
  });
  return stats;
}

// Turns the BADGE_LIST in Badges.gs into "who holds what". A mistake in one badge only hides that badge.
function computeBadges_(ctx, bank, ch) {
  var stats = computeStats_(ctx, bank, ch);
  var list = (typeof BADGE_LIST !== 'undefined' && BADGE_LIST) ? BADGE_LIST : [];
  var pids = Object.keys(stats);
  var badges = [];
  list.forEach(function(b) {
    try {
      var holders = [];
      if (b.kind === 'title' || b.kind === 'weekly') {
        var rows = [], max = null;
        pids.forEach(function(pid) {
          var v = Number(b.score(stats[pid]));
          if (isNaN(v) || v <= 0) return;
          rows.push({ pid: pid, v: v });
          if (max === null || (b.lowest ? v < max : v > max)) max = v;      // lowest: true = the smallest score wins
        });
        rows.forEach(function(r) { if (r.v === max) holders.push({ pid: r.pid, detail: String(b.detail ? b.detail(stats[r.pid]) : r.v) }); });
      } else {
        pids.forEach(function(pid) {
          var d = b.earned(stats[pid]);
          if (d) holders.push({ pid: pid, detail: d === true ? '' : String(d) });
        });
      }
      badges.push({ id: String(b.id), name: String(b.name), kind: b.kind === 'title' ? 'title' : b.kind === 'weekly' ? 'weekly' : 'milestone', desc: String(b.desc || ''), holders: holders });
    } catch (err) {
      Logger.log('Badge "' + (b && b.id) + '" skipped: ' + err.message);
    }
  });
  var out = {};
  pids.forEach(function(pid) {
    var s = stats[pid];
    out[pid] = { total: s.total, complete: s.complete, played: s.played, streak: s.streak, longest: s.longest, fines: s.fines };
  });
  return { stats: out, badges: badges };
}

function buildState_(me, ctx) { return withReadCache_(function() { return buildStateCore_(me, ctx); }); }
function buildStateCore_(me, ctx) {
  var cw = ctx.currentWeek;
  var days = [];
  if (cw >= 1) {
    var ws = weekStartIso_(ctx.startIso, cw);
    for (var i = 0; i < 7; i++) {
      var iso = addDays_(ws, i);
      days.push({ iso: iso, label: dowLabel_(iso) + ' ' + mdLabel_(iso), future: dayNum_(iso) > dayNum_(ctx.today), today: iso === ctx.today });
    }
  }
  var redirect = '';
  try { redirect = getRedirectUri_(); } catch (e) {}
  var bank = computeBank_(ctx);
  var ch = computeChallenges_(me, ctx);
  var extras = computeBadges_(ctx, bank, ch);
  return {
    version: V7_VERSION, now: nowIso_(),
    lastSync: str_(PropertiesService.getScriptProperties().getProperty('LAST_SYNC_AT')),
    me: {
      pid: me.pid, name: me.name, whoop: whoopStatus_(me.pid), push: pushInfo_(me), admin: isAdmin_(me, ctx.settings),
      hidden: str_(ctx.settings[me.pid + '|hidden']).split(',').map(str_).filter(function(x) { return x; }),
      connectUrl: redirect ? redirect + '?connect=' + encodeURIComponent(me.key) : ''
    },
    rules: { minDays: ctx.minDays, minTime: ctx.minTime, minEffort: ctx.minEffort, baseBet: ctx.baseBet },
    week: { current: cw, today: ctx.today, days: days, label: cw >= 1 ? weekLabel_(ctx.startIso, cw) : 'Not started' },
    people: ctx.people.map(function(p) { return { pid: p.pid, name: p.name, initials: p.initials, active: p.active, whoop: whoopStatus_(p.pid) }; }),
    matrix: ctx.matrix,
    credits: ctx.credits,
    feed: buildFeed_(me, ctx),
    seen: seenAll_(ctx),
    updates: updatesFor_(me),
    bets: sbState_(me, ctx, sbData_(ctx)),
    sbStats: Object.keys(SB_STATS).map(function(k) { return { id: k, label: SB_STATS[k].label, whoop: SB_STATS[k].whoop }; }),
    bank: bank,
    chals: chalState_(me, ctx),
    challenges: ch,
    stats: extras.stats,
    badges: extras.badges
  };
}


// ----------------------------------------------------------------
// SIDE BETS
//   Stat bets (over/under, yes/no, head to head) settle themselves from the workout data.
//   Custom bets are settled by whoever proposed them.
//   Tabs: Side_Bets (one row per bet) and Side_Wagers (one row each time someone puts money down).
// ----------------------------------------------------------------

var SB_STATS = {
  workouts:   { label: 'workouts', unit: 'workouts', whoop: false },
  minutes:    { label: 'workout minutes', unit: 'min', whoop: false },
  strain:     { label: 'total workout strain', unit: 'strain', whoop: true },
  beststrain: { label: 'best single-workout strain', unit: 'strain', whoop: true }
};
var SB_SCORING = { total: 'combined', best: 'best man', avg: 'team average' };

function csv_(s) { return str_(s) ? str_(s).split(',').map(str_).filter(function(x) { return x; }) : []; }

// Offset between the group's clock and UTC at a given moment, in ms (negative in the US).
function tzOffsetMs_(ms, tz) {
  var d = new Date(ms);
  var p = Utilities.formatDate(d, tz, 'yyyy-MM-dd').split('-');
  var h = parseInt(Utilities.formatDate(d, tz, 'H'), 10);
  return Date.UTC(+p[0], +p[1] - 1, +p[2], h) - (ms - (ms % 3600000));
}
function localMidnightMs_(iso, tz) {
  var base = dayNum_(iso) * 86400000;
  return base - tzOffsetMs_(base + 12 * 3600000, tz);
}
// "Thu 11/12 4:50 PM" on the group's clock.
function timeLabel_(ms, tz) {
  var d = new Date(ms + tzOffsetMs_(ms, tz));
  var h = d.getUTCHours(), m = d.getUTCMinutes();
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' +
    ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
}
function namesJoin_(ctx, pids) {
  var n = pids.map(function(p) { return ctx.byPid[p] ? ctx.byPid[p].name : p; });
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
}

// The workouts that count, per person: on a day with WHOOP workouts those are used (each one);
// otherwise the longest manual / texted log for that day. A log with no length counts as the minimum time.
// Each has t = when it happened as far as the app can tell (WHOOP start time, or when the log was posted).
function countedWorkouts_(ctx) {
  if (ctx._counted) return ctx._counted;
  var byKey = {};
  ctx.workouts.forEach(function(w) {
    if (!w._ok || !w._date || !ctx.byPid[w.participant_id]) return;
    var k = w.participant_id + '|' + w._date;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(w);
  });
  var out = {};
  Object.keys(byKey).forEach(function(k) {
    var list = byKey[k], pid = list[0].participant_id, date = list[0]._date;
    var noon = localMidnightMs_(date, ctx.tz) + 12 * 3600000;
    var whoop = list.filter(function(w) { return str_(w.source).toLowerCase() === 'whoop'; });
    if (!out[pid]) out[pid] = [];
    if (whoop.length) {
      whoop.forEach(function(w) {
        out[pid].push({ date: date, minutes: num_(w.duration_minutes, 0), strain: num_(w.strain, 0),
          t: Date.parse(str_(w.workout_start)) || Date.parse(str_(w.created_at)) || noon });
      });
    } else {
      var best = null;
      list.forEach(function(w) {
        var m = str_(w.duration_minutes) === '' ? ctx.minTime : num_(w.duration_minutes, ctx.minTime);
        var t = Date.parse(str_(w.created_at)) || noon;
        if (!best || m > best.minutes) best = { date: date, minutes: m, strain: 0, t: best ? Math.min(best.t, t) : t };
        else best.t = Math.min(best.t, t);
      });
      out[pid].push(best);
    }
  });
  Object.keys(out).forEach(function(pid) { out[pid].sort(function(a, b) { return a.t - b.t; }); });
  ctx._counted = out;
  return out;
}

// One person's running number for a bet: [{ t, v }] in time order. The last v is where he stands now.
function sbSeries_(ctx, pid, bet) {
  var items = countedWorkouts_(ctx)[pid] || [];
  var ps = Date.parse(bet.period_start), pe = Date.parse(bet.period_end);
  var from = dayNum_(bet.date_from), to = dayNum_(bet.date_to);
  var out = [], v = 0, seenDay = {};
  items.forEach(function(it) {
    var dn = dayNum_(it.date);
    if (dn < from || dn > to) return;
    if (bet.period === '24h' && (it.t < ps || it.t > pe)) return;
    if (bet.stat === 'workouts') { if (seenDay[it.date]) return; seenDay[it.date] = true; v += 1; }
    else if (bet.stat === 'minutes') v += it.minutes;
    else if (bet.stat === 'strain') v = Math.round((v + it.strain) * 100) / 100;
    else if (bet.stat === 'beststrain') { if (it.strain <= v) return; v = it.strain; }
    out.push({ t: it.t, v: v });
  });
  return out;
}
function sbValue_(ctx, pid, bet) { var s = sbSeries_(ctx, pid, bet); return s.length ? s[s.length - 1].v : 0; }
function sbTeamValue_(ctx, pids, bet) {
  var vals = pids.map(function(p) { return sbValue_(ctx, p, bet); });
  if (!vals.length) return 0;
  var sum = vals.reduce(function(a, b) { return a + b; }, 0);
  if (bet.type !== 'h2h' || pids.length === 1 || bet.scoring === 'total') return Math.round(sum * 100) / 100;
  if (bet.scoring === 'best') return Math.max.apply(null, vals);
  return Math.round(sum / vals.length * 100) / 100;
}
// The most a side could still reach if every remaining day went perfectly (per person per day: 1 workout day, 360 minutes, 21 strain).
var SB_DAY_CAP = { workouts: 1, minutes: 360, strain: 21 };
function sbTeamPotential_(ctx, pids, bet, remaining) {
  var vals = pids.map(function(p) {
    var v = sbValue_(ctx, p, bet);
    return bet.stat === 'beststrain' ? Math.max(v, 21) : v + (SB_DAY_CAP[bet.stat] || 0) * remaining;
  });
  if (!vals.length) return 0;
  var sum = vals.reduce(function(a, b) { return a + b; }, 0);
  if (pids.length === 1 || bet.scoring === 'total') return sum;
  if (bet.scoring === 'best') return Math.max.apply(null, vals);
  return sum / vals.length;
}
function sbAmt_(v, stat) { return sbFmt_(v, stat) + ' ' + (stat === 'workouts' && v === 1 ? 'workout' : SB_STATS[stat].unit); }
function sbFmt_(v, stat) {
  if (stat === 'strain' || stat === 'beststrain') return (Math.round(v * 10) / 10).toFixed(1);
  return String(Math.round(v * 100) / 100);
}

// Where a stat bet stands. Returns { winner: 'a' | 'b' | 'void' | '', at: ms the outcome was locked, note: text }.
// Side a is always the "it happens" side: Over, Yes, or the first man / team.
function sbEvaluate_(ctx, bet, nowMs) {
  var pe = Date.parse(bet.period_end);
  var ended = nowMs >= pe + SB_GRACE_MIN * 60000;      // wait for late WHOOP data before calling a "didn't happen"
  var A = csv_(bet.subjects_a), B = csv_(bet.subjects_b);
  var who = namesJoin_(ctx, A), i;

  if (bet.type === 'ou' || (bet.type === 'yn' && bet.question === 'workouts')) {
    var series = sbSeries_(ctx, A[0], bet);
    var line = num_(bet.line, 0), n = parseInt(bet.n, 10) || 1;
    for (i = 0; i < series.length; i++) {
      if (bet.type === 'ou' ? series[i].v > line : series[i].v >= n) {
        return { winner: 'a', at: series[i].t, note: who + ' is at ' + sbAmt_(series[series.length - 1].v, bet.stat) + '.' };
      }
    }
    if (ended) return { winner: 'b', at: pe, note: who + ' finished with ' + sbAmt_(series.length ? series[series.length - 1].v : 0, bet.stat) + '.' };
    return { winner: '', at: 0, note: '' };
  }

  if (bet.type === 'yn') {                              // 'week' (makes the week) or 'dormie' (never goes dormie)
    var wk = parseInt(bet.week, 10);
    if (wk > ctx.currentWeek) return { winner: '', at: 0, note: '' };
    var w = ctx.matrix[wk - 1], cell = null;
    if (w) w.cells.forEach(function(c) { if (c.pid === A[0]) cell = c; });
    if (!w || !cell || cell.status === 'exempt' || cell.status === 'inactive') return { winner: 'void', at: nowMs, note: 'Week ' + wk + ' did not count for ' + who + '.' };
    var days = ctx.credits[A[0]] || {};
    var probe = { period: 'week', stat: 'workouts', period_start: bet.period_start, period_end: bet.period_end, date_from: w.start, date_to: w.end };
    var ser = sbSeries_(ctx, A[0], probe);
    var doneAt = ser.length >= ctx.minDays ? ser[ctx.minDays - 1].t : 0;
    for (i = 0; i < 7; i++) {
      var dayStart = localMidnightMs_(addDays_(w.start, i), ctx.tz);
      if (dayStart > nowMs) break;
      var before = countInRange_(days, w.start, addDays_(w.start, i - 1));
      if (i === 0) before = 0;
      var needed = ctx.minDays - before;
      if (needed <= 0) break;
      if (7 - i < needed) return { winner: 'b', at: dayStart, note: who + ' could not make Week ' + wk + '.' };
      if (bet.question === 'dormie' && 7 - i === needed) return { winner: 'b', at: dayStart, note: who + ' went dormie on ' + dowLabel_(addDays_(w.start, i)) + '.' };
    }
    if (doneAt) return { winner: 'a', at: doneAt, note: who + ' made Week ' + wk + (bet.question === 'dormie' ? ' without going dormie.' : '.') };
    if (ended) return { winner: 'b', at: pe, note: who + ' missed Week ' + wk + '.' };
    return { winner: '', at: 0, note: '' };
  }

  if (bet.type === 'h2h') {
    var va = sbTeamValue_(ctx, A, bet), vb = sbTeamValue_(ctx, B, bet);
    if (!ended) {
      // Closes as soon as the result is out of reach: one side leads by more than the other could possibly add in the days left.
      var remaining = bet.period === '24h' ? Math.ceil((pe - nowMs) / 86400000) : dayNum_(bet.date_to) - dayNum_(ctx.today) + 1;
      if (remaining >= 1 && va !== vb) {
        var pa = sbTeamPotential_(ctx, A, bet, remaining), pb = sbTeamPotential_(ctx, B, bet, remaining);
        var lead = va > vb ? 'a' : 'b';
        if (lead === 'a' ? va > pb : vb > pa) {
          return { winner: lead, at: nowMs, note: namesJoin_(ctx, A) + ' ' + sbFmt_(va, bet.stat) + ', ' + namesJoin_(ctx, B) + ' ' + sbFmt_(vb, bet.stat) + '. ' +
            (lead === 'a' ? namesJoin_(ctx, B) : namesJoin_(ctx, A)) + ' cannot catch up in the ' + remaining + (remaining === 1 ? ' day' : ' days') + ' left.' };
        }
      }
      return { winner: '', at: 0, note: '' };
    }
    var note = namesJoin_(ctx, A) + ' ' + sbFmt_(va, bet.stat) + ', ' + namesJoin_(ctx, B) + ' ' + sbFmt_(vb, bet.stat) + '.';
    if (va === vb) return { winner: 'void', at: pe, note: 'Tie. ' + note };
    return { winner: va > vb ? 'a' : 'b', at: pe, note: note };
  }
  return { winner: '', at: 0, note: '' };
}

function sbLoad_() {
  var wagers = {};
  readTable_(TAB.WAGERS).forEach(function(w) { if (!wagers[w.bet_id]) wagers[w.bet_id] = []; wagers[w.bet_id].push(w); });
  return { bets: readTable_(TAB.BETS), wagers: wagers };
}

// Lines the money up dollar for dollar, oldest first. rows: [{ id, pid, side, amt }] in the order placed.
// Returns what each wager has covered, who is matched against whom, and what is still waiting for a taker.
function sbMatchRows_(rows) {
  var q = { a: [], b: [] }, tot = { a: 0, b: 0 }, matched = {}, pairs = [], pairIdx = {};
  rows.forEach(function(r) {
    if (r.side !== 'a' && r.side !== 'b') return;
    var c = Math.round(r.amt * 100);
    if (c <= 0) return;
    q[r.side].push({ id: r.id, pid: r.pid, left: c });
    tot[r.side] += c; matched[r.id] = 0;
  });
  var i = 0, j = 0, done = 0;
  while (i < q.a.length && j < q.b.length) {
    var x = q.a[i], y = q.b[j], m = Math.min(x.left, y.left);
    x.left -= m; y.left -= m; matched[x.id] += m; matched[y.id] += m; done += m;
    var k = x.pid + '|' + y.pid;
    if (pairIdx[k] === undefined) { pairIdx[k] = pairs.length; pairs.push({ a: x.pid, b: y.pid, amount: 0 }); }
    pairs[pairIdx[k]].amount += m;
    if (!x.left) i++;
    if (!y.left) j++;
  }
  Object.keys(matched).forEach(function(id) { matched[id] = matched[id] / 100; });
  pairs.forEach(function(p) { p.amount = p.amount / 100; });
  var diff = tot.a - tot.b;
  return { matched: matched, pairs: pairs, total: { a: tot.a / 100, b: tot.b / 100 }, matchedTotal: done / 100,
    openSide: diff > 0 ? 'a' : diff < 0 ? 'b' : '',          // the side with money still waiting for a taker
    openAmount: Math.abs(diff) / 100 };
}
function sbMatch_(wagers) {
  return sbMatchRows_((wagers || []).filter(function(w) { return w.status === 'in'; }).map(function(w) {
    return { id: w.wager_id, pid: w.participant_id, side: w.side, amt: num_(w.amount, 0) };
  }));
}

// Pays out one bet. winner: 'a' | 'b' | 'void'. lockedAt: wagers placed after this moment are handed back.
// Every matched dollar wins or loses a dollar. Money nobody covered goes back to whoever put it up.
function sbSettle_(ctx, bet, wagers, winner, lockedAt, note, byPid) {
  var live = [], back = [];
  (wagers || []).forEach(function(w) {
    if (w.status !== 'in') return;
    if (lockedAt && Date.parse(w.created_at) > lockedAt) back.push(w); else live.push(w);
  });
  var m = sbMatch_(live);
  var reason = '';
  if (winner === 'void') reason = note || 'Called off.';
  else if (m.matchedTotal <= 0) {
    reason = back.length ? 'The only money on the other side came in after it was already decided, so everyone gets their money back.' : 'Nobody took the other side, so everyone gets their money back.';
    winner = 'void';
  }
  function nm(pid) { return (ctx.byPid[pid] || { name: pid }).name; }
  var net = {}, order = [], refund = {}, rorder = [];
  live.forEach(function(w) {
    var amt = num_(w.amount, 0), got = winner === 'void' ? 0 : (m.matched[w.wager_id] || 0), pid = w.participant_id;
    if (got <= 0) { w.status = 'refunded'; w.payout = '0'; w.matched = '0'; }
    else {
      w.matched = String(got);
      w.payout = String(w.side === winner ? got : -got);
      if (net[pid] === undefined) { net[pid] = 0; order.push(pid); }
      net[pid] = round2_(net[pid] + (w.side === winner ? got : -got));
      if (amt > got) { if (refund[pid] === undefined) { refund[pid] = 0; rorder.push(pid); } refund[pid] = round2_(refund[pid] + amt - got); }
    }
    updateRow_(TAB.WAGERS, w._row, w);
  });
  back.forEach(function(w) { w.status = 'refunded'; w.payout = '0'; w.matched = '0'; updateRow_(TAB.WAGERS, w._row, w); });

  var label = winner === 'a' ? bet.label_a : bet.label_b;
  bet.status = winner === 'void' ? 'void' : 'settled';
  bet.winner = winner === 'void' ? '' : winner;
  bet.settled_at = nowIso_();
  bet.decided_at = lockedAt ? new Date(lockedAt).toISOString() : bet.settled_at;
  bet.settled_by = byPid || '';
  if (winner === 'void') {
    bet.result_title = 'Side bet off: ' + bet.prompt;
    bet.result_body = reason + (reason === note || !note ? '' : ' ' + note);
  } else {
    var wins = order.filter(function(p) { return net[p] > 0; }).map(function(p) { return nm(p) + ' +' + money_(net[p]); });
    var losses = order.filter(function(p) { return net[p] < 0; }).map(function(p) { return nm(p) + ' -' + money_(-net[p]); });
    bet.result_title = '"' + label + '" wins: ' + bet.prompt;
    bet.result_body = (note ? note + ' ' : '') + wins.join(', ') + '. ' + losses.join(', ') + '.' +
      (rorder.length ? ' ' + rorder.map(function(p) { return money_(refund[p]) + ' of ' + nm(p) + "'s money"; }).join(' and ') + ' was never covered and went back.' : '') +
      (back.length ? ' Money put down after it was decided was handed back.' : '') +
      (byPid && ctx.byPid[byPid] ? ' Called by ' + ctx.byPid[byPid].name + '.' : '');
    appendRows_(TAB.BANK, [{ entry_id: 'b_' + shortId_(), created_at: nowIso_(), type: 'sidebet', participant_id: byPid || bet.proposer, week: bet.bet_id,
      amount: String(round2_(m.matchedTotal * 2)), note: truncate_(bet.result_title, 200) }]);
  }
  updateRow_(TAB.BETS, bet._row, bet);
  try {
    var who = [];
    (wagers || []).forEach(function(w) { if (who.indexOf(w.participant_id) === -1) who.push(w.participant_id); });
    pushToPeople_(who, 'bets', winner === 'void' ? 'Side bet off' : 'Side bet settled', bet.result_title + (winner === 'void' ? '' : ' ' + truncate_(bet.result_body, 100)));
  } catch (pe) { Logger.log('push settle: ' + pe.message); }
}

// Checks every open stat bet and pays out the ones that are decided. Returns how many it settled.
function settleSideBets_(ctx) {
  var data = sbLoad_(), n = 0, nowMs = Date.now();
  data.bets.forEach(function(bet) {
    if (bet.status !== 'open' || bet.type === 'custom') return;
    try {
      var r = sbEvaluate_(ctx, bet, nowMs);
      if (!r.winner) return;
      sbSettle_(ctx, bet, data.wagers[bet.bet_id], r.winner, r.winner === 'void' ? 0 : r.at, r.note, '');
      n++;
    } catch (err) { Logger.log('side bet ' + bet.bet_id + ': ' + err.message); }
  });
  return n;
}

function sbPeriod_(ctx, period, nowMs) {
  var tz = ctx.tz, cw = ctx.currentWeek, ws;
  if (period === 'today') {
    return { start: localMidnightMs_(ctx.today, tz), end: localMidnightMs_(addDays_(ctx.today, 1), tz), from: ctx.today, to: ctx.today,
      week: '', text: 'today (' + dowLabel_(ctx.today) + ' ' + mdLabel_(ctx.today) + ')' };
  }
  if (period === '24h') {
    var end = nowMs + 24 * 3600000;
    return { start: nowMs, end: end, from: ctx.today, to: isoOf_(new Date(end), tz), week: '', text: 'by ' + timeLabel_(end, tz) };
  }
  if (period === 'week' || period === 'nextweek') {
    var wk = cw + (period === 'nextweek' ? 1 : 0);
    ws = weekStartIso_(ctx.startIso, wk);
    return { start: localMidnightMs_(ws, tz), end: localMidnightMs_(addDays_(ws, 7), tz), from: ws, to: addDays_(ws, 6), week: String(wk), text: 'in Week ' + wk };
  }
  if (period === 'season') {
    var weeks = parseInt(ctx.settings.season_weeks, 10) || 20;
    var last = addDays_(ctx.startIso, weeks * 7 - 1);
    return { start: localMidnightMs_(ctx.startIso, tz), end: localMidnightMs_(addDays_(last, 1), tz), from: ctx.startIso, to: last, week: '', text: 'this season' };
  }
  throw new Error('Pick a time period.');
}

function apiBetPropose_(me, req, ctx) {
  if (ctx.currentWeek < 1) throw new Error('The challenge has not started yet.');
  var nowMs = Date.now();
  var type = str_(req.type);
  var active = {};
  ctx.people.forEach(function(p) { if (p.active) active[p.pid] = true; });
  function pids(v) {
    var seen = {}, out = [];
    (Array.isArray(v) ? v : []).forEach(function(x) { x = str_(x); if (active[x] && !seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }
  var side = str_(req.side);
  if (side !== 'a' && side !== 'b') throw new Error('Pick your side.');
  var amount = round2_(num_(req.amount, NaN));
  if (isNaN(amount) || amount < 1 || amount > 1000) throw new Error('Enter your bet, $1 to $1,000.');

  var newId = /^sb_[A-Za-z0-9]{8,40}$/.test(str_(req.id)) && !sbLoad_().bets.some(function(b) { return b.bet_id === str_(req.id); }) ? str_(req.id) : 'sb_' + shortId_();
  var bet = { bet_id: newId, created_at: nowIso_(), proposer: me.pid, type: type, status: 'open',
    subjects_a: '', subjects_b: '', stat: '', line: '', question: '', n: '', scoring: '', period: '', period_start: '', period_end: '',
    date_from: '', date_to: '', week: '', close_at: '', hidden: '', prompt: '', label_a: '', label_b: '', stake: '',
    winner: '', settled_at: '', decided_at: '', settled_by: '', result_title: '', result_body: '' };
  var closeMs;
  var mins = parseInt(req.closeMinutes, 10);

  if (type === 'custom') {
    var prompt = truncate_(str_(req.prompt), 200);
    if (prompt.length < 5) throw new Error('Write the question people are betting on.');
    bet.prompt = prompt;
    bet.label_a = truncate_(str_(req.labelA), 24) || 'Yes';
    bet.label_b = truncate_(str_(req.labelB), 24) || 'No';
    if (bet.label_a.toLowerCase() === bet.label_b.toLowerCase()) throw new Error('The two answers need different names.');
    bet.hidden = pids(req.hiddenFrom).filter(function(p) { return p !== me.pid; }).join(',');
    closeMs = str_(req.closeAt) ? Date.parse(str_(req.closeAt)) : nowMs + (isNaN(mins) ? 0 : mins) * 60000;
    if (isNaN(closeMs) || closeMs < nowMs + 60000) throw new Error('Pick when betting closes (it has to be in the future).');
  } else {
    if (type !== 'ou' && type !== 'yn' && type !== 'h2h') throw new Error('Pick a type of bet.');
    var A = pids(req.subjA), B = type === 'h2h' ? pids(req.subjB) : [];
    if (type !== 'h2h') A = A.slice(0, 1);
    if (!A.length) throw new Error('Pick who the bet is about.');
    if (type === 'h2h') {
      if (!B.length) throw new Error('Pick who is on the other side.');
      if (A.some(function(p) { return B.indexOf(p) !== -1; })) throw new Error('Someone is on both sides.');
    }
    var question = type === 'yn' ? str_(req.q) : '';
    if (type === 'yn' && ['workouts', 'week', 'dormie'].indexOf(question) === -1) throw new Error('Pick the question.');
    var weekly = question === 'week' || question === 'dormie';
    var period = str_(req.period);
    if (weekly && period !== 'week' && period !== 'nextweek') throw new Error('That bet is about a week. Pick this week or next week.');
    var P = sbPeriod_(ctx, period, nowMs);
    if (weekly && ctx.inactiveWeeks[parseInt(P.week, 10)]) throw new Error('That week is an off week.');
    var stat = weekly || question === 'workouts' ? 'workouts' : str_(req.stat);
    if (!SB_STATS[stat]) throw new Error('Pick what is being measured.');
    var all = A.concat(B);
    if (SB_STATS[stat].whoop && all.some(function(p) { return whoopStatus_(p) !== 'connected'; })) throw new Error('Strain bets need everyone in the bet to have WHOOP connected.');
    var hide = req.hide !== false && req.hide !== 'false';
    var meIn = all.indexOf(me.pid) !== -1;
    if (meIn && hide) throw new Error('You cannot hide a bet from yourself. Turn off hiding, or leave yourself out.');
    if (meIn && side !== (A.indexOf(me.pid) !== -1 ? 'a' : 'b')) throw new Error('You can only bet on yourself to come through.');

    bet.subjects_a = A.join(','); bet.subjects_b = B.join(',');
    bet.stat = stat; bet.question = question; bet.period = period;
    bet.period_start = new Date(P.start).toISOString(); bet.period_end = new Date(P.end).toISOString();
    bet.date_from = P.from; bet.date_to = P.to; bet.week = P.week;
    bet.hidden = hide ? all.join(',') : '';
    var nameA = namesJoin_(ctx, A);
    if (type === 'ou') {
      var raw = num_(req.line, NaN);
      if (isNaN(raw) || raw < 0 || raw > 100000) throw new Error('Enter the over/under number.');
      var line = SB_STATS[stat].whoop ? round2_(Math.floor(raw * 10 + 1e-6) / 10 + 0.05) : Math.floor(raw + 1e-6) + 0.5;   // never lands exactly on the line
      bet.line = String(line);
      bet.prompt = nameA + ': over/under ' + line + ' ' + SB_STATS[stat].label + ' ' + P.text;
      bet.label_a = 'Over'; bet.label_b = 'Under';
    } else if (type === 'yn') {
      var n = Math.max(1, Math.min(60, parseInt(req.n, 10) || 1));
      bet.label_a = 'Yes'; bet.label_b = 'No';
      if (question === 'workouts') {
        bet.n = String(n);
        bet.prompt = n === 1 ? 'Will ' + nameA + ' work out ' + P.text + '?' : 'Will ' + nameA + ' get at least ' + n + ' workouts ' + P.text + '?';
      } else if (question === 'week') bet.prompt = 'Will ' + nameA + ' make Week ' + P.week + '?';
      else bet.prompt = 'Will ' + nameA + ' finish Week ' + P.week + ' without going dormie?';
    } else {
      var team = A.length > 1 || B.length > 1;
      bet.scoring = team ? (SB_SCORING[str_(req.scoring)] ? str_(req.scoring) : 'total') : '';
      bet.prompt = nameA + ' vs ' + namesJoin_(ctx, B) + ': more ' + SB_STATS[stat].label + (team ? ' (' + SB_SCORING[bet.scoring] + ')' : '') + ' ' + P.text;
      var lab = function(list) { return truncate_(ctx.byPid[list[0]].name, 16) + (list.length > 1 ? ' +' + (list.length - 1) : ''); };
      bet.label_a = lab(A); bet.label_b = lab(B);
    }
    var mode = str_(req.closeMode);
    closeMs = mode === 'start' ? P.start : mode === 'end' ? P.end : str_(req.closeAt) ? Date.parse(str_(req.closeAt)) : nowMs + (isNaN(mins) ? 0 : mins) * 60000;
    if (isNaN(closeMs)) throw new Error('Pick when betting closes.');
    closeMs = Math.min(closeMs, P.end);
    if (closeMs < nowMs + 60000) throw new Error(mode === 'start' ? 'That period already started. Pick another closing time.' : 'Betting has to stay open at least a minute.');
    var r = sbEvaluate_(ctx, bet, nowMs);
    if (r.winner) throw new Error('That one is already decided: ' + r.note);
  }
  bet.close_at = new Date(closeMs).toISOString();
  appendRows_(TAB.BETS, [bet]);
  appendRows_(TAB.WAGERS, [{ wager_id: 'w_' + shortId_(), bet_id: bet.bet_id, participant_id: me.pid, side: side, amount: String(amount), created_at: nowIso_(), status: 'in', payout: '', matched: '' }]);
  try {
    var skip = csv_(bet.hidden);
    pushToPeople_(pushEveryone_(ctx).filter(function(p) { return skip.indexOf(p) === -1; }), 'bets', 'New side bet', me.name + ': ' + bet.prompt, me.pid);
  } catch (pe) { Logger.log('push bet: ' + pe.message); }
  return 'Side bet posted.';
}

// Which sides this person may put money on right now: 'ab', 'a', 'b' or ''.
//   - Never both sides: once you are on a side you can only add to that side.
//   - If you are in the bet's subject you may only back yourself.
//   - While one side has money waiting for a taker, nobody can add to that side; the only move is to take the other side.
function sbCanBet_(bet, pid, wagers, nowMs, m) {
  if (bet.status !== 'open' || nowMs >= Date.parse(bet.close_at)) return '';
  if (csv_(bet.hidden).indexOf(pid) !== -1) return '';
  var can = 'ab';
  (wagers || []).forEach(function(w) { if (w.participant_id === pid && w.status === 'in') can = w.side; });
  if (bet.type !== 'custom') {
    var own = csv_(bet.subjects_a).indexOf(pid) !== -1 ? 'a' : csv_(bet.subjects_b).indexOf(pid) !== -1 ? 'b' : '';
    if (own) { if (can.indexOf(own) === -1) return ''; can = own; }
  }
  m = m || sbMatch_(wagers);
  if (m.openSide) can = can.replace(m.openSide, '');
  return can;
}

function apiBetPlace_(me, req, ctx) {
  var data = sbLoad_(), bet = null, nowMs = Date.now();
  data.bets.forEach(function(b) { if (b.bet_id === str_(req.id)) bet = b; });
  if (!bet || csv_(bet.hidden).indexOf(me.pid) !== -1) throw new Error('That bet was not found.');
  var side = str_(req.side), other = side === 'a' ? 'b' : 'a';
  if (side !== 'a' && side !== 'b') throw new Error('Pick a side.');
  var wagers = data.wagers[bet.bet_id] || [];
  var m = sbMatch_(wagers);
  if (bet.status !== 'open' || nowMs >= Date.parse(bet.close_at)) throw new Error('Betting is closed on that one.');
  var can = sbCanBet_(bet, me.pid, wagers, nowMs, m);
  if (can.indexOf(side) === -1) {
    if (wagers.some(function(w) { return w.participant_id === me.pid && w.status === 'in' && w.side === other; })) throw new Error('You are already on the other side of this one.');
    if (bet.type !== 'custom' && csv_(bet.subjects_a).concat(csv_(bet.subjects_b)).indexOf(me.pid) !== -1 &&
        csv_(side === 'a' ? bet.subjects_a : bet.subjects_b).indexOf(me.pid) === -1) throw new Error('You can only bet on yourself to come through.');
    if (m.openSide === side) throw new Error('There is still ' + money_(m.openAmount) + ' on "' + (side === 'a' ? bet.label_a : bet.label_b) + '" waiting for a taker. Someone has to take the other side first.');
    throw new Error('You cannot bet on that one.');
  }
  if (bet.type !== 'custom' && sbEvaluate_(ctx, bet, nowMs).winner) throw new Error('That one is already decided.');
  var amount = round2_(num_(req.amount, NaN));
  if (isNaN(amount) || amount < 1 || amount > 1000) throw new Error('Enter your bet, $1 to $1,000.');
  appendRows_(TAB.WAGERS, [{ wager_id: 'w_' + shortId_(), bet_id: bet.bet_id, participant_id: me.pid, side: side, amount: String(amount), created_at: nowIso_(), status: 'in', payout: '', matched: '' }]);
  var covered = m.openSide === other ? Math.min(amount, m.openAmount) : 0, left = round2_(amount - covered);
  var lab = side === 'a' ? bet.label_a : bet.label_b;
  return money_(amount) + ' on "' + lab + '". ' + (left <= 0 ? 'All of it is matched.' : covered > 0 ? money_(covered) + ' is matched and ' + money_(left) + ' is open for a taker.' : 'It is open for a taker.');
}

// The proposer closes out a custom bet (a / b / void), or calls off a stat bet nobody else has joined.
function apiBetResolve_(me, req, ctx) {
  var data = sbLoad_(), bet = null;
  data.bets.forEach(function(b) { if (b.bet_id === str_(req.id)) bet = b; });
  if (!bet || bet.proposer !== me.pid) throw new Error('Only the person who proposed a bet can close it.');
  if (bet.status !== 'open') throw new Error('That bet is already closed.');
  var winner = str_(req.winner);
  var wagers = data.wagers[bet.bet_id] || [];
  if (bet.type !== 'custom') {
    if (winner !== 'void') throw new Error('The app settles this one on its own.');
    if (wagers.some(function(w) { return w.participant_id !== me.pid; })) throw new Error('Someone has already taken this bet, so it stands.');
    sbSettle_(ctx, bet, wagers, 'void', 0, 'Called off by ' + me.name + '.', me.pid);
    return 'Bet called off.';
  }
  if (winner !== 'a' && winner !== 'b' && winner !== 'void') throw new Error('Pick the winner.');
  sbSettle_(ctx, bet, wagers, winner, 0, winner === 'void' ? 'Called off by ' + me.name + '. Everyone gets their money back.' : '', me.pid);
  return winner === 'void' ? 'Bet called off. Everyone was refunded.' : 'Bet closed. Paid out.';
}

// The side bets this person is allowed to see, newest first: everything still open, plus the last 15 finished.
function sbState_(me, ctx, data) {
  var nowMs = Date.now(), out = [], done = 0;
  var betPics = {};
  var cmtPics = {}, betTalk = {};
  readTable_(TAB.PHOTOS).forEach(function(x) {
    var t = str_(x.target_id), ph = { id: x.photo_id, fileId: x.file_id, pid: x.participant_id, ts: x.created_at };
    if (t.indexOf('sb_') === 0) (betPics[t] = betPics[t] || []).push(ph);
    else if (t.indexOf('c_') === 0) (cmtPics[t] = cmtPics[t] || []).push(ph);
  });
  // The bet's comment thread: comments on its feed card (open bet) and on its result card, in one list.
  readTable_(TAB.COMMENTS).forEach(function(c) {
    var t = str_(c.target_id).replace(/^rsb_/, 'sb_');
    if (t.indexOf('sb_') === 0) (betTalk[t] = betTalk[t] || []).push({ id: c.comment_id, pid: c.participant_id, text: c.text, ts: c.created_at, photos: cmtPics[c.comment_id] || [] });
  });
  var bets = data.bets.slice().sort(function(a, b) { return String(b.created_at).localeCompare(String(a.created_at)) || b._row - a._row; });
  bets.forEach(function(bet) {
    var hidden = csv_(bet.hidden);
    var open = bet.status === 'open';
    if (open && hidden.indexOf(me.pid) !== -1) return;
    if (!open && ++done > 15) return;
    var wagers = (data.wagers[bet.bet_id] || []);
    // Open bets are matched live. Finished ones use what was recorded when they paid out.
    // (Bets settled before v7.4 split a pool instead; those have no pairings and are flagged "legacy".)
    var legacy = !open && bet.status === 'settled' && !wagers.some(function(w) { return str_(w.matched) !== ''; });
    var m = open ? sbMatch_(wagers) : sbMatchRows_(wagers.map(function(w) { return { id: w.wager_id, pid: w.participant_id, side: w.side, amt: legacy ? 0 : num_(w.matched, 0) }; }));
    var sides = { a: { total: 0, matched: 0, bettors: [] }, b: { total: 0, matched: 0, bettors: [] } }, idx = {}, mine = null, mySide = '';
    wagers.forEach(function(w) {
      if (!sides[w.side]) return;
      var amt = num_(w.amount, 0), S = sides[w.side], k = w.side + w.participant_id;
      var got = open ? (w.status === 'in' ? (m.matched[w.wager_id] || 0) : 0) : legacy ? (w.status === 'in' ? amt : 0) : num_(w.matched, 0);
      var row = idx[k];
      if (!row) { row = idx[k] = { pid: w.participant_id, amount: 0, matched: 0, net: null }; S.bettors.push(row); }
      row.amount = round2_(row.amount + amt);
      row.matched = round2_(row.matched + got);
      if (w.payout !== '' && w.payout !== undefined) row.net = round2_((row.net || 0) + num_(w.payout, 0));
      if (open ? w.status === 'in' : true) S.total = round2_(S.total + amt);
      S.matched = round2_(S.matched + got);
      if (w.participant_id === me.pid) { mine = row; mySide = w.side; }
    });
    if (mine) mine = { side: mySide, amount: mine.amount, matched: mine.matched, open: round2_(mine.amount - mine.matched), net: mine.net };
    var progress = '';
    if (open && bet.type !== 'custom') {
      try {
        var A = csv_(bet.subjects_a), B = csv_(bet.subjects_b);
        if (bet.type === 'h2h') progress = 'Now: ' + bet.label_a + ' ' + sbFmt_(sbTeamValue_(ctx, A, bet), bet.stat) + ', ' + bet.label_b + ' ' + sbFmt_(sbTeamValue_(ctx, B, bet), bet.stat);
        else if (bet.type === 'ou' || bet.question === 'workouts') progress = 'Now: ' + sbAmt_(sbValue_(ctx, A[0], bet), bet.stat);
      } catch (e) {}
    }
    var closeMs = Date.parse(bet.close_at);
    out.push({
      id: bet.bet_id, type: bet.type, prompt: bet.prompt, labelA: bet.label_a, labelB: bet.label_b, proposer: bet.proposer,
      createdAt: bet.created_at, closeAt: bet.close_at, closeText: timeLabel_(closeMs, ctx.tz),
      endText: bet.type === 'custom' ? '' : timeLabel_(Date.parse(bet.period_end), ctx.tz),
      phase: open ? (nowMs < closeMs ? 'open' : 'waiting') : bet.status,
      hiddenFrom: hidden, legacy: legacy, photos: betPics[bet.bet_id] || [],
      comments: (betTalk[bet.bet_id] || []).sort(function(a, b) { return String(a.ts).localeCompare(String(b.ts)); }),
      sides: sides, pairs: m.pairs, matched: m.matchedTotal,
      openSide: open ? m.openSide : '', openAmount: open ? m.openAmount : 0,
      mine: mine, canBet: sbCanBet_(bet, me.pid, wagers, nowMs, open ? m : null), progress: progress,
      canResolve: open && bet.type === 'custom' && bet.proposer === me.pid,
      canVoid: open && bet.type !== 'custom' && bet.proposer === me.pid && !wagers.some(function(w) { return w.participant_id !== me.pid; }),
      winner: bet.winner, resultTitle: bet.result_title, resultBody: bet.result_body, settledAt: bet.settled_at
    });
  });
  return out;
}

function sbData_(ctx) { if (!ctx._sb) ctx._sb = sbLoad_(); return ctx._sb; }


// ----------------------------------------------------------------
// ONE-TIME MOVE FROM v6
// ----------------------------------------------------------------

function migrateFromV6_() {
  var legacy = readTable_('Raw_Workouts');
  if (legacy.length === 0) return 0;
  var existing = {};
  readTable_(TAB.WORKOUTS).forEach(function(w) { existing[w.workout_id] = true; });
  var add = [];
  legacy.forEach(function(r) {
    var pid = str_(r.participant_id);
    var date = isoOf_(r.workout_date, 'America/New_York');
    var id = str_(r.workout_id);
    if (!pid || !date || !id) return;
    if (existing[id]) id = id + '_' + date;
    if (existing[id]) return;
    existing[id] = true;
    var raw = str_(r.source).toLowerCase();
    var source = 'manual', activity = 'Logged';
    if (raw.indexOf('whoop') === 0) { source = 'whoop'; activity = raw.indexOf(':') > 0 ? raw.split(':')[1] : 'workout'; }
    else if (raw === 'sms_backup') { source = 'sms'; activity = 'Texted in'; }
    add.push({
      workout_id: id, participant_id: pid, workout_date: date,
      workout_start: str_(r.workout_start), workout_end: str_(r.workout_end),
      duration_minutes: source === 'whoop' ? str_(r.duration_minutes) : '',
      strain: source === 'whoop' ? str_(r.effort_score) : '',
      source: source, activity: activity, effort: '', note: '',
      created_at: str_(r.workout_end) || (date + 'T12:00:00'), status: 'active'
    });
  });
  appendRows_(TAB.WORKOUTS, add);
  return add.length;
}


// ----------------------------------------------------------------
// MENU
// ----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('BC Dads')
    .addItem('Sync now', 'menuSyncNow')
    .addItem('WHOOP status', 'showWhoopStatus')
    .addItem('Full WHOOP re-pull (whole season)', 'menuFullResync')
    .addItem('Store WHOOP client secret', 'storeWhoopClientSecret')
    .addItem('Clear a WHOOP connection', 'clearWhoopConnection')
    .addItem('Make app links', 'showAppLinks')
    .addToUi();
  try { ensureParticipantCols_(); } catch (e) {}
}

function setupV7() {
  var ui = SpreadsheetApp.getUi();
  var notes = [];

  // Do the two things that make everything else slow FIRST:
  // stop the old 5-minute run, and throw away the oversized Run_Log (it is only a diagnostic log).
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  var oldLog = ss_().getSheetByName(TAB.RUN_LOG);
  if (oldLog && oldLog.getLastRow() > 2000) {
    if (ss_().getSheets().length === 1) ss_().insertSheet('Temp');
    ss_().deleteSheet(oldLog);
    notes.push('Cleared the old Run_Log (it had grown too big and was slowing the sheet down).');
  }

  for (var name in HEAD) tab_(name);
  seedMissingSettings_();
  ensureParticipantCols_();

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('V7_MIGRATED')) {
    var moved = migrateFromV6_();
    props.setProperty('V7_MIGRATED', nowIso_());
    notes.push('Copied ' + moved + ' past workouts into the new Workouts tab.');
  } else {
    notes.push('Past workouts were already copied over.');
  }

  var settings = readSettings_();
  var tz = settings.timezone || 'America/New_York';
  var cw = weekOf_(todayIso_(tz), isoOf_(settings.challenge_start_date, tz));
  if (!str_(settings.bank_start_week)) {
    setSetting_('bank_start_week', String(Math.max(1, cw)));
    notes.push('Bank starts counting fines and pots from week ' + Math.max(1, cw) + ' (change bank_start_week in Settings if you want earlier weeks).');
  }

  notes.push('Made ' + generateAppKeys_() + ' new personal app keys.');

  ScriptApp.newTrigger('hourlySync').timeBased().everyHours(1).create();
  notes.push('Auto-sync now runs once an hour (the old 5-minute run is off).');


  var ctx = loadCtx_();
  writeTrackerTab_(ctx);

  var todo = [];
  if (!str_(settings.app_url)) todo.push('Paste your GitHub Pages address into Settings > app_url, then run "Make app links".');
  try { getWhoopClientSecret_(); } catch (e) { todo.push('Store the WHOOP client secret (BC Dads menu).'); }
  ui.alert('v7 setup finished', notes.join('\n') + (todo.length ? '\n\nStill to do:\n- ' + todo.join('\n- ') : ''), ui.ButtonSet.OK);
}

function showAppLinks() {
  var ui = SpreadsheetApp.getUi();
  var appUrl = str_(readSettings_().app_url);
  if (!appUrl) { ui.alert('Add app_url first', 'Paste your GitHub Pages address into the Settings tab next to app_url, then run this again.', ui.ButtonSet.OK); return; }
  generateAppKeys_();
  ui.alert('App links ready', 'Each person\'s private link is in the app_link column of the Participants tab. Text each dad his own link. Do not share the spreadsheet itself - the links are the passwords.', ui.ButtonSet.OK);
}

function menuSyncNow() {
  var res = runSync_('manual_sync', false);
  var ui = SpreadsheetApp.getUi();
  if (!res) { ui.alert('Busy', 'Another sync is running. Try again in a minute.', ui.ButtonSet.OK); return; }
  ui.alert('Sync done', 'New WHOOP workouts: ' + res.whoop.added + '\nNew texted workouts: ' + res.sms.added + '\n\n' + res.whoop.summary.join('\n'), ui.ButtonSet.OK);
}

function menuFullResync() {
  var res = runSync_('full_resync', true);
  var ui = SpreadsheetApp.getUi();
  if (!res) { ui.alert('Busy', 'Another sync is running. Try again in a minute.', ui.ButtonSet.OK); return; }
  ui.alert('Full re-pull done', 'New WHOOP workouts: ' + res.whoop.added + '\n\n' + res.whoop.summary.join('\n'), ui.ButtonSet.OK);
}

function showWhoopStatus() {
  var lines = readPeople_().filter(function(p) { return p.active; }).map(function(p) {
    var st = whoopStatus_(p.pid);
    var t = getTokens_(p.pid);
    var label = st === 'connected' ? 'Connected' : (st === 'reconnect' ? 'NEEDS RECONNECT' + (t && t.dead_reason ? ' (' + t.dead_reason + ')' : '') : 'Not on WHOOP');
    return p.name + ': ' + label;
  });
  SpreadsheetApp.getUi().alert('WHOOP status', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function storeWhoopClientSecret() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Store WHOOP client secret', 'Paste the WHOOP Client Secret. It is saved in Script Properties, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var secret = str_(response.getResponseText());
  if (!secret) { ui.alert('Nothing entered. Nothing was saved.'); return; }
  PropertiesService.getScriptProperties().setProperty('WHOOP_CLIENT_SECRET', secret);
  ui.alert('Saved.');
}

function clearWhoopConnection() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Clear a WHOOP connection', 'Enter the participant_id (for example p006). Their past workouts stay.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var pid = str_(response.getResponseText());
  if (!pid) return;
  PropertiesService.getScriptProperties().deleteProperty(tokenKey_(pid));
  ui.alert('Cleared WHOOP connection for ' + pid + '.');
}
