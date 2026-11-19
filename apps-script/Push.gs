// ================================================================
// BC Dads WAG - phone push notifications (Firebase Cloud Messaging)
//
// Works alongside Code.gs. Setup steps are in docs/PUSH-SETUP.md.
//
// Script properties (Project Settings > Script properties):
//   FIREBASE_SERVICE_ACCOUNT   the whole JSON key file from Firebase (Project settings > Service accounts > Generate new private key)
//
// The app address comes from Settings > app_url (the GitHub Pages address, ending in "/").
// Each phone that turns push on saves its token in the Settings tab, row "<participant id>|pushTokens".
// Each person's switched-off categories are saved in the row "<participant id>|pushOff".
//
// Bundling: alerts are held for a few minutes (Settings > push_bundle_min, default 3) and go out as one notification,
// e.g. "3 updates in BC Dads WAG". Urgent alerts (the test button) go out right away.
// ================================================================

var PUSH_BUNDLE_MIN = 3;
var PUSH_CATS = {
  social:  'Fires and comments',
  bets:    'Side bets',
  updates: 'Group updates and reminders'
};

// ---------- queueing ----------

// Queue one alert for one person. Does nothing if they have no phone with push on, or switched that category off.
function pushQueue_(pid, cat, title, body) {
  try {
    pid = str_(pid);
    if (!pid || !pushTokens_(pid).length || pushOff_(pid).indexOf(cat) !== -1) return false;
    var at = Date.now();
    PropertiesService.getScriptProperties().setProperty('PUSHQ_' + at + '_' + shortId_(),
      JSON.stringify({ pid: pid, title: truncate_(str_(title), 80), body: truncate_(str_(body), 200), at: at }));
    return true;
  } catch (e) { Logger.log('pushQueue_: ' + e.message); return false; }
}

// Queue the same alert for several people (never for exceptPid, usually the person who did the thing).
function pushToPeople_(pids, cat, title, body, exceptPid) {
  var seen = {};
  (pids || []).forEach(function(p) {
    if (!p || p === exceptPid || seen[p]) return;
    seen[p] = true;
    pushQueue_(p, cat, title, body);
  });
}

function pushEveryone_(ctx) { return ctx.people.filter(function(p) { return p.active; }).map(function(p) { return p.pid; }); }

// Runs every minute (see setupPush). Sends each person's alerts once their bundling window has closed.
function pushFlush() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  var due = {};
  try {
    var props = PropertiesService.getScriptProperties(), all = props.getProperties(), groups = {};
    Object.keys(all).filter(function(k) { return k.indexOf('PUSHQ_') === 0; }).forEach(function(k) {
      var it; try { it = JSON.parse(all[k]); } catch (e) { props.deleteProperty(k); return; }
      if (!it || !it.pid) { props.deleteProperty(k); return; }
      (groups[it.pid] = groups[it.pid] || []).push({ k: k, it: it });
    });
    var win = (num_(readSettings_().push_bundle_min, PUSH_BUNDLE_MIN)) * 60000;
    Object.keys(groups).forEach(function(pid) {
      var g = groups[pid].sort(function(a, b) { return a.it.at - b.it.at; });
      if (Date.now() - g[0].it.at < win) return;
      g.forEach(function(x) { props.deleteProperty(x.k); });
      due[pid] = g.map(function(x) { return x.it; });
    });
  } finally { lock.releaseLock(); }
  Object.keys(due).forEach(function(pid) {
    try {
      var it = due[pid];
      if (it.length === 1) { pushSendAll_(pid, it[0].title, it[0].body, false); return; }
      var lines = it.slice(0, 6).map(function(x) { return '• ' + (x.body || x.title); });
      if (it.length > 6) lines.push('and ' + (it.length - 6) + ' more');
      pushSendAll_(pid, it.length + ' updates in BC Dads WAG', lines.join('\n'), false);
    } catch (e) { Logger.log('pushFlush ' + pid + ': ' + e.message); }
  });
}

// Run once from the editor: approves access and turns on the every-minute sending job.
function setupPush() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'pushFlush'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushFlush').timeBased().everyMinutes(1).create();
  pushAccess_();
  var n = readPeople_().map(function(p) { return p.name + ' ' + pushTokens_(p.pid).length; }).join(', ');
  Logger.log('Push is set up. Phones with push on: ' + n);
}

// ---------- settings (tokens and switches) ----------

var _pushSet = null;
function pushSet_() { if (!_pushSet) _pushSet = readSettings_(); return _pushSet; }
function pushTokens_(pid) { return str_(pushSet_()[pid + '|pushTokens']).split(',').map(str_).filter(function(t) { return t; }); }
function pushOff_(pid) { return str_(pushSet_()[pid + '|pushOff']).split(',').map(str_).filter(function(t) { return t; }); }
function pushSave_(key, value) { setSetting_(key, value); if (_pushSet) _pushSet[key] = String(value); }

function pushInfo_(me) { return { off: pushOff_(me.pid), phones: pushTokens_(me.pid).length, cats: PUSH_CATS }; }

function pushDropToken_(pid, tok) {
  pushSave_(pid + '|pushTokens', pushTokens_(pid).filter(function(t) { return t !== tok; }).join(','));
}

// ---------- app calls (from the phone) ----------

// The phone turns push on (token) or off (remove). A phone belongs to one person: signing in as someone else moves it.
function apiPushToken_(me, req) {
  var tok = str_(req.token);
  if (!tok) throw new Error('No phone token.');
  readPeople_().forEach(function(p) { if (p.pid !== me.pid && pushTokens_(p.pid).indexOf(tok) !== -1) pushDropToken_(p.pid, tok); });
  var cur = pushTokens_(me.pid).filter(function(t) { return t !== tok; });
  if (!isTrue_(req.remove)) cur.push(tok);
  pushSave_(me.pid + '|pushTokens', cur.slice(-6).join(','));
  return isTrue_(req.remove) ? 'Push is off for this phone.' : 'Push is on for this phone.';
}

function apiPushPrefs_(me, req) {
  var off = str_(req.off).split(',').map(str_).filter(function(c) { return PUSH_CATS[c]; });
  pushSave_(me.pid + '|pushOff', off.join(','));
  return '';
}

function apiPushTest_(me) {
  var n = pushSendAll_(me.pid, 'BC Dads WAG', 'Push notifications are working ✅', true);
  if (!n) throw new Error('No phone is set up for push yet.');
  return 'Test sent. It should arrive in a few seconds.';
}

// Run from the editor to test: sends to the first person who has push on.
function pushTest() {
  var hit = readPeople_().filter(function(p) { return pushTokens_(p.pid).length; })[0];
  if (!hit) { Logger.log('Nobody has turned push on in the app yet (Me tab > Notifications).'); return; }
  Logger.log('Sent to ' + pushSendAll_(hit.pid, 'BC Dads WAG', 'Push notifications are working ✅', true) + ' phone(s) for ' + hit.name + '.');
}

// ---------- Firebase ----------

// OAuth token for Firebase, from the service account key. Cached for 50 minutes.
function pushAccess_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('fcm_at');
  if (hit) return hit;
  var raw = PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) throw new Error('Push is not set up on the server yet (FIREBASE_SERVICE_ACCOUNT script property).');
  var sa = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  function b64(x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); }
  var head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  var sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true, payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig } });
  var j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error('Firebase sign-in failed: ' + r.getContentText());
  cache.put('fcm_at', j.access_token, 3000);
  cache.put('fcm_project', sa.project_id, 21600);
  return j.access_token;
}

// Sends one notification to every phone the person turned push on for. Returns how many phones got it.
function pushSendAll_(pid, title, body, urgent) {
  var tokens = pushTokens_(pid);
  if (!tokens.length) return 0;
  var at = pushAccess_(), cache = CacheService.getScriptCache();
  var project = cache.get('fcm_project') || JSON.parse(PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT')).project_id;
  var app = str_(readSettings_().app_url);
  var sent = 0;
  tokens.forEach(function(tok) {
    var msg = { token: tok, webpush: { headers: { Urgency: urgent ? 'high' : 'normal', TTL: '86400' }, notification: { title: String(title || 'BC Dads WAG'), body: String(body || '') } } };
    if (/^https:\/\//.test(app)) {
      msg.webpush.fcm_options = { link: app };
      msg.webpush.notification.icon = app.replace(/\/?$/, '/') + 'icon-180.png';
    }
    var r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + project + '/messages:send', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + at }, muteHttpExceptions: true, payload: JSON.stringify({ message: msg }) });
    var code = r.getResponseCode();
    if (code === 200) sent++;
    else if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(r.getContentText())) pushDropToken_(pid, tok);
    else Logger.log('Push to ' + pid + ' failed (' + code + '): ' + r.getContentText());
  });
  return sent;
}
