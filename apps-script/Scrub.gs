// ================================================================
// BC Dads WAG - Scrub.gs: Claude cleans up and matches workouts
//
// After every hourly sync, Claude looks at each person's recent workouts that the normal same-day rules cannot settle on
// their own (a workout logged on the wrong day, a texted entry next to a WHOOP one, two logs of the same session, a Peloton ride
// that Strava, WHOOP and the app all recorded) and decides which rows are the SAME session. Duplicates are folded into one
// card, with every source's data on it, and count once toward the week.
//
// Nothing is ever deleted: a duplicate only gets "merged_into" (the id of the main workout) in the Workouts tab.
// Every decision is written to the Scrub_Log tab, and Me > Admin > Workout matching has an Undo button for each one.
//
// Setup (once): Apps Script > Project Settings > Script properties > add ANTHROPIC_API_KEY (from console.anthropic.com).
// Optional Settings tab rows:
//   scrub_mode    apply (default: high-confidence matches are applied)  |  suggest (only logs what it would do)  |  off
//   scrub_model   the Claude model to use (default claude-opus-5-5; claude-haiku-5-5 is the cheapest)
//   scrub_days    how many days back to look (default 14)
// ================================================================

var SCRUB_DEFAULT_MODEL = 'claude-opus-5-5';
var SCRUB_MAX_CLUSTERS = 20;      // questions per run
var SCRUB_API_VERSION = '2023-06-01';

var SCRUB_SYSTEM =
  'You clean up a private workout-accountability app for a group of friends. Each person logs workouts three ways: typed into the app ("app"), ' +
  'copied automatically from a WHOOP strap ("whoop"), from Strava ("strava", which also carries Peloton classes), or a text message that only says he worked out ("sms"). ' +
  'The same real-world workout often shows up in more than one source. You get small clusters of ONE person\'s workouts that are close together in time. ' +
  'For each cluster decide which rows are the very same workout session and should be merged into one.\n\n' +
  'Rules:\n' +
  '- Merge only when it is clearly one session: similar start time (allow for a late-night workout landing on the next day in UTC), similar length, and a compatible kind of activity. A Peloton ride and a cycling or ride row are the same thing; "Strength", "Weightlifting" and "Functional Fitness" can be the same; a walk and a run are not.\n' +
  '- Two real, separate sessions on the same day (a morning run and an evening lift) must NOT be merged, even from different sources.\n' +
  '- An "sms" row only says he worked out that day. Merge it into a real workout of the same day when there is one; otherwise leave it alone.\n' +
  '- Rows with different dates may still be the same session only if the start times show it (for example 11:40 pm and 12:30 am, or an app log entered a day late for a workout WHOOP recorded).\n' +
  '- primary_id is the row to keep: prefer the "app" row (a human wrote it), then "whoop", then "strava", then "sms". duplicate_ids are the rows folded into it.\n' +
  '- confidence "high" only when you would bet on it. Use "medium" or "low" when unsure; those are never applied.\n' +
  '- If nothing in a cluster should be merged, return no groups for it. Keep each reason to one short sentence.';

var SCRUB_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cluster: { type: 'integer' },
          primary_id: { type: 'string' },
          duplicate_ids: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' }
        },
        required: ['cluster', 'primary_id', 'duplicate_ids', 'confidence', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['groups'],
  additionalProperties: false
};

function scrubKey_() { return str_(PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')); }
function scrubMode_(ctx) { var m = str_(ctx.settings.scrub_mode).toLowerCase(); return m === 'suggest' || m === 'off' ? m : 'apply'; }
function scrubRank_(w) { var s = str_(w.source).toLowerCase(); return s === 'whoop' ? 1 : s === 'strava' ? 2 : s === 'sms' ? 3 : 0; }
function scrubHash_(s) { var h = 5381, i; for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

function scrubStart_(w, tz) {
  var t = Date.parse(str_(w.workout_start));
  if (isNaN(t)) return null;
  return t;
}
function scrubLocal_(ms, tz) {
  try { return Utilities.formatDate(new Date(ms), tz, 'yyyy-MM-dd HH:mm'); } catch (e) { return new Date(ms).toISOString(); }
}

// Groups one person's recent workouts into small clusters worth a second opinion (the same-day rules already handle the easy pairs).
function scrubClusters_(ctx, days) {
  var cutoff = dayNum_(addDays_(ctx.today, -days)), byPid = {}, out = [];
  ctx.workouts.forEach(function(w) {
    if (!w._date || dayNum_(w._date) < cutoff || str_(w.merged_into) || !ctx.byPid[w.participant_id] || !ctx.byPid[w.participant_id].active) return;
    (byPid[w.participant_id] = byPid[w.participant_id] || []).push(w);
  });
  Object.keys(byPid).forEach(function(pid) {
    var rows = byPid[pid], parent = rows.map(function(x, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (var i = 0; i < rows.length; i++) for (var j = i + 1; j < rows.length; j++) {
      var dd = Math.abs(dayNum_(rows[i]._date) - dayNum_(rows[j]._date));
      if (dd > 1) continue;
      var a = scrubStart_(rows[i], ctx.tz), b = scrubStart_(rows[j], ctx.tz);
      if (a !== null && b !== null && Math.abs(a - b) > 16 * 3600000) continue;
      if (dd === 1 && str_(rows[i].source) === str_(rows[j].source)) continue;   // the same source on two days is two workouts
      parent[find(i)] = find(j);
    }
    var comp = {};
    rows.forEach(function(w, k) { (comp[find(k)] = comp[find(k)] || []).push(w); });
    Object.keys(comp).forEach(function(k) {
      var c = comp[k];
      if (c.length < 2 || c.length > 8) return;
      var srcs = {}; c.forEach(function(w) { srcs[str_(w.source).toLowerCase()] = true; });
      var kinds = Object.keys(srcs);
      if (kinds.length === 1 && (kinds[0] === 'whoop' || kinds[0] === 'strava')) return;   // separate sessions from one device
      if (c.length === 2) {
        var x = c[0], y = c[1], sameDay = x._date === y._date, dx = parseFloat(x.duration_minutes), dy = parseFloat(y.duration_minutes);
        var ratio = !isNaN(dx) && !isNaN(dy) && dx > 0 && dy > 0 ? Math.min(dx, dy) / Math.max(dx, dy) : 0;
        if (sameDay && kinds.length === 2 && ratio >= 0.6) return;                     // the normal rules pair these already
        if (sameDay && (str_(x.source) === 'sms' || str_(y.source) === 'sms')) return; // a text under a real workout is hidden by the rules
      }
      c.sort(function(p, q) { return String(p.workout_start || p.created_at).localeCompare(String(q.workout_start || q.created_at)); });
      out.push({ pid: pid, rows: c, newest: c.reduce(function(m, w) { return w._date > m ? w._date : m; }, '') });
    });
  });
  out.sort(function(a, b) { return b.newest.localeCompare(a.newest); });
  return out;
}

function scrubRowJson_(ctx, w) {
  var st = scrubStart_(w, ctx.tz);
  var o = { id: w.workout_id, source: str_(w.source), date: w._date, start: st === null ? '' : scrubLocal_(st, ctx.tz), minutes: w.duration_minutes === '' ? null : Math.round(num_(w.duration_minutes, 0)), activity: str_(w.activity) };
  if (w.strain !== '' && w.strain !== undefined) o.strain = num_(w.strain, 0);
  if (str_(w.title)) o.title = str_(w.title);
  if (str_(w.device)) o.device = str_(w.device);
  if (str_(w.note)) o.note = str_(w.note).substring(0, 120);
  if (num_(w.distance_m, 0) > 0) o.miles = Math.round(num_(w.distance_m, 0) / 1609.344 * 10) / 10;
  if (num_(w.avg_hr, 0) > 0) o.avg_hr = Math.round(num_(w.avg_hr, 0));
  return o;
}

// One call to Claude. Returns { ok, data, error }.
function scrubAsk_(key, model, clusters, ctx) {
  var payload = clusters.map(function(c, i) { return { cluster: i, person: (ctx.byPid[c.pid] || {}).name || c.pid, workouts: c.rows.map(function(w) { return scrubRowJson_(ctx, w); }) }; });
  var body = {
    model: model, max_tokens: 8000, system: SCRUB_SYSTEM,
    messages: [{ role: 'user', content: 'Timezone: ' + ctx.tz + '. Times are local. Clusters:\n' + JSON.stringify(payload) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCRUB_SCHEMA } }
  };
  var r;
  try {
    r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': SCRUB_API_VERSION }, payload: JSON.stringify(body) });
  } catch (e) { return { ok: false, error: 'fetch failed: ' + e.message }; }
  var code = r.getResponseCode(), text = r.getContentText();
  if (code !== 200) return { ok: false, error: 'Claude API ' + code + ': ' + truncate_(text, 300) };
  var j; try { j = JSON.parse(text); } catch (e2) { return { ok: false, error: 'unreadable answer' }; }
  if (j.stop_reason === 'refusal') return { ok: false, error: 'Claude declined' };
  var blk = (j.content || []).filter(function(b) { return b.type === 'text'; })[0];
  if (!blk) return { ok: false, error: 'no answer (' + str_(j.stop_reason) + ')' };
  try { return { ok: true, data: JSON.parse(blk.text), usage: j.usage || {} }; } catch (e3) { return { ok: false, error: 'answer was not JSON' }; }
}

function scrubLog_() { return readTable_(TAB.SCRUB); }

// Runs the scrub. Never throws. Returns { asked, merged, suggested, skipped, error }.
function scrubRun_(ctx) {
  var res = { asked: 0, merged: 0, suggested: 0, skipped: 0, error: '' };
  try {
    var mode = scrubMode_(ctx), key = scrubKey_();
    if (mode === 'off' || !key) { res.error = !key ? 'no ANTHROPIC_API_KEY' : 'off'; return res; }
    var days = parseInt(ctx.settings.scrub_days, 10) || 14, model = str_(ctx.settings.scrub_model) || SCRUB_DEFAULT_MODEL;
    var log = scrubLog_(), seen = {}, undone = {};
    log.forEach(function(l) {
      if (str_(l.fingerprint)) seen[l.fingerprint] = true;
      if (str_(l.status) === 'undone') str_(l.duplicate_ids).split(',').forEach(function(id) { if (id) undone[id] = true; });
    });
    var todo = [];
    scrubClusters_(ctx, days).forEach(function(c) {
      c.fp = scrubHash_(c.rows.map(function(w) { return [w.workout_id, w.duration_minutes, w._date, w.workout_start].join('~'); }).join('|'));
      if (!seen[c.fp] && todo.length < SCRUB_MAX_CLUSTERS) todo.push(c);
    });
    if (!todo.length) return res;
    res.asked = todo.length;
    var ans = scrubAsk_(key, model, todo, ctx);
    var now = nowIso_(), logRows = [], byId = {};
    ctx.workouts.forEach(function(w) { byId[w.workout_id] = w; });
    if (!ans.ok) { res.error = ans.error; logRun_('scrub_error', 0, ans.error); return res; }
    var decided = {};
    (ans.data.groups || []).forEach(function(g) {
      var c = todo[g.cluster]; if (!c) return;
      decided[g.cluster] = true;
      var ids = c.rows.map(function(w) { return w.workout_id; });
      var dups = (g.duplicate_ids || []).filter(function(id) { return ids.indexOf(id) !== -1 && id !== g.primary_id; });
      if (ids.indexOf(g.primary_id) === -1 || !dups.length) return;
      // Keep the most "human" row as the main one, whatever Claude picked.
      var group = [byId[g.primary_id]].concat(dups.map(function(id) { return byId[id]; }));
      group.sort(function(a, b) { return scrubRank_(a) - scrubRank_(b); });
      var primary = group[0], dupRows = group.slice(1);
      var protect = !primary._ok && dupRows.some(function(w) { return w._ok; });            // never take a counting workout away
      var blocked = dupRows.some(function(w) { return undone[w.workout_id]; });
      var action = g.confidence !== 'high' ? 'suggested' : protect ? 'skipped' : blocked ? 'skipped' : mode === 'apply' ? 'merged' : 'suggested';
      var why = str_(g.reason) + (protect ? ' (not applied: the main row would not count by itself)' : blocked ? ' (not applied: you undid this before)' : g.confidence !== 'high' ? ' (' + g.confidence + ' confidence)' : '');
      if (action === 'merged') {
        dupRows.forEach(function(w) { w.merged_into = primary.workout_id; updateRow_(TAB.WORKOUTS, w._row, w); });
        res.merged++;
      } else if (action === 'suggested') res.suggested++; else res.skipped++;
      logRows.push({ log_id: 'sc_' + shortId_(), created_at: now, participant_id: c.pid, status: action, primary_id: primary.workout_id,
        duplicate_ids: dupRows.map(function(w) { return w.workout_id; }).join(','), confidence: g.confidence, reason: truncate_(why, 300), fingerprint: '' });
    });
    // Remember every cluster that was asked about so it is not asked again until a row in it changes.
    todo.forEach(function(c, i) {
      logRows.push({ log_id: 'sc_' + shortId_(), created_at: now, participant_id: c.pid, status: decided[i] ? 'asked' : 'no_match', primary_id: '', duplicate_ids: '',
        confidence: '', reason: decided[i] ? '' : 'Separate workouts', fingerprint: c.fp });
    });
    appendRows_(TAB.SCRUB, logRows);
    logRun_('scrub', res.merged, 'asked=' + res.asked + '; merged=' + res.merged + '; suggested=' + res.suggested + '; skipped=' + res.skipped + '; model=' + model);
  } catch (err) { res.error = String(err && err.message || err); try { logRun_('scrub_error', 0, res.error); } catch (e) {} }
  return res;
}

// What the admin screen shows: the decisions, newest first, with the workouts' own details.
function scrubList_(ctx) {
  var byId = {};
  ctx.workouts.forEach(function(w) { byId[w.workout_id] = w; });
  function nm(id) { var w = byId[id]; return w ? (str_(w.activity) || 'Workout') + ' ' + (w._date || '') + (w.duration_minutes !== '' ? ', ' + Math.round(num_(w.duration_minutes, 0)) + ' min' : '') + ' (' + str_(w.source) + ')' : id; }
  return scrubLog_().filter(function(l) { return ['merged', 'suggested', 'skipped', 'undone'].indexOf(str_(l.status)) !== -1; })
    .sort(function(a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 40)
    .map(function(l) {
      var p = ctx.byPid[l.participant_id];
      return { id: l.log_id, ts: l.created_at, pid: l.participant_id, who: p ? p.name : l.participant_id, status: l.status, confidence: l.confidence, reason: l.reason,
        primary: nm(l.primary_id), dups: str_(l.duplicate_ids).split(',').filter(function(x) { return x; }).map(nm) };
    });
}

// Admin: put a merged set of workouts back as separate ones, and never merge them again.
function apiScrubUndo_(me, req, ctx) {
  if (!isAdmin_(me, ctx.settings)) throw new Error('Only the admin can undo a match.');
  var id = str_(req.id), hit = null;
  scrubLog_().forEach(function(l) { if (l.log_id === id) hit = l; });
  if (!hit) throw new Error('That match was not found.');
  var ids = str_(hit.duplicate_ids).split(',').filter(function(x) { return x; });
  ctx.workouts.forEach(function(w) { if (ids.indexOf(w.workout_id) !== -1 && str_(w.merged_into)) { w.merged_into = ''; updateRow_(TAB.WORKOUTS, w._row, w); } });
  hit.status = 'undone';
  updateRow_(TAB.SCRUB, hit._row, hit);
  return 'Put back as separate workouts.';
}

// Sheet menu: BC Dads > Run workout scrub now
function menuScrubNow() {
  var ui = SpreadsheetApp.getUi();
  var ctx = loadCtx_(), r = scrubRun_(ctx);
  ui.alert('Workout scrub', r.error ? 'Did not run: ' + r.error : 'Looked at ' + r.asked + ' group(s) of workouts. Merged ' + r.merged + ', suggested ' + r.suggested + ', skipped ' + r.skipped + '. See the Scrub_Log tab.', ui.ButtonSet.OK);
}
