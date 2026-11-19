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
// No bundling: every alert goes out on its own, right away. Alerts raised while handling one request (or one sync)
// are collected and sent together at the end of it, in parallel, so the app is not slowed down one by one.
// Push is on unless Settings > push_enabled is FALSE.
// ================================================================

var PUSH_CATS = {
  social:  'Fires, reactions, comments and tags',
  bets:    'Side bets',
  updates: 'Group updates and reminders'
};

var _pushOut = [];   // alerts waiting to be sent at the end of this request

// ---------- queueing (within one request) ----------

// Line up one alert for one person. Skipped if push is off, they have no phone with push on, or they switched that kind off.
function pushQueue_(pid, cat, title, body) {
  try {
    if (!pushEnabled_()) return false;
    pid = str_(pid);
    if (!pid || !pushTokens_(pid).length || pushOff_(pid).indexOf(cat) !== -1) return false;
    var key = pid + '|' + title + '|' + body;
    if (_pushOut.some(function(x) { return x.key === key; })) return false;   // same alert twice in one go
    _pushOut.push({ key: key, pid: pid, title: truncate_(str_(title), 80), body: truncate_(str_(body), 200) });
    return true;
  } catch (e) { Logger.log('pushQueue_: ' + e.message); return false; }
}

// The same alert for several people (never for exceptPid, usually the person who did the thing).
function pushToPeople_(pids, cat, title, body, exceptPid) {
  var seen = {};
  (pids || []).forEach(function(p) {
    if (!p || p === exceptPid || seen[p]) return;
    seen[p] = true;
    pushQueue_(p, cat, title, body);
  });
}

function pushEveryone_(ctx) { return ctx.people.filter(function(p) { return p.active; }).map(function(p) { return p.pid; }); }

// People named with @Name in a piece of text.
function pushMentioned_(ctx, text) {
  var t = ' ' + str_(text).toLowerCase() + ' ';
  return ctx.people.filter(function(p) {
    var n = '@' + str_(p.name).toLowerCase(), i = t.indexOf(n);
    while (i !== -1) { if (!/[a-z0-9_]/.test(t.charAt(i + n.length))) return true; i = t.indexOf(n, i + 1); }
    return false;
  }).map(function(p) { return p.pid; });
}

// Sends everything lined up during this request, each alert on its own, all at once. Never throws.
function pushSendQueued_() {
  var out = _pushOut; _pushOut = [];
  if (!out.length) return 0;
  try {
    var reqs = [], meta = [], base = pushBase_();
    out.forEach(function(a) {
      pushTokens_(a.pid).forEach(function(tok) { reqs.push(pushRequest_(base, tok, a.title, a.body, false)); meta.push({ pid: a.pid, tok: tok }); });
    });
    var res = UrlFetchApp.fetchAll(reqs), sent = 0;
    res.forEach(function(r, i) { if (pushResult_(r, meta[i].pid, meta[i].tok)) sent++; });
    return sent;
  } catch (e) { Logger.log('pushSendQueued_: ' + e.message); return 0; }
}

// Run once from the editor: approves access and switches push on. (Older versions also set up a sending job; it is removed.)
function setupPush() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'pushFlush'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  pushAccess_();
  setSetting_('push_enabled', 'TRUE');
  var n = readPeople_().map(function(p) { return p.name + ' ' + pushTokens_(p.pid).length; }).join(', ');
  Logger.log('Push is on. Phones with push turned on: ' + n);
}
// Left over from the bundled version: if its every-minute job still exists, it removes itself.
function pushFlush() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'pushFlush'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
}

// ---------- settings (tokens and switches) ----------

// On unless Settings > push_enabled says FALSE.
function pushEnabled_() { return str_(pushSet_().push_enabled).toUpperCase() !== 'FALSE'; }

// Clears anything the old bundled version left waiting in script storage. Runs with the hourly sync.
function pushPurge_() {
  var props = PropertiesService.getScriptProperties(), n = 0;
  Object.keys(props.getProperties()).forEach(function(k) { if (k.indexOf('PUSHQ_') === 0) { props.deleteProperty(k); n++; } });
  return n;
}

var _pushSet = null;
function pushSet_() { if (!_pushSet) _pushSet = readSettings_(); return _pushSet; }
function pushTokens_(pid) { return str_(pushSet_()[pid + '|pushTokens']).split(',').map(str_).filter(function(t) { return t; }); }
function pushOff_(pid) { return str_(pushSet_()[pid + '|pushOff']).split(',').map(str_).filter(function(t) { return t; }); }
function pushSave_(key, value) { setSetting_(key, value); if (_pushSet) _pushSet[key] = String(value); }

function pushInfo_(me) { return { off: pushOff_(me.pid), phones: pushTokens_(me.pid).length, cats: PUSH_CATS, on: pushEnabled_() }; }

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
  return isTrue_(req.remove) ? 'Notifications are off for this phone.' : 'Notifications are on for this phone.';
}

function apiPushPrefs_(me, req) {
  var off = str_(req.off).split(',').map(str_).filter(function(c) { return PUSH_CATS[c]; });
  if (req.off !== undefined) pushSave_(me.pid + '|pushOff', off.join(','));
  return '';
}

// The "Send me a test" button: sends straight away and says exactly what went wrong if it did not work.
function apiPushTest_(me) {
  var tokens = pushTokens_(me.pid);
  if (!tokens.length) throw new Error('This phone is not registered for notifications yet. Tap Turn off, then Allow notifications again.');
  var base = pushBase_(), errs = [], sent = 0;
  UrlFetchApp.fetchAll(tokens.map(function(t) { return pushRequest_(base, t, 'BC Dads WAG', 'Notifications are working ✅', true); })).forEach(function(r, i) {
    if (pushResult_(r, me.pid, tokens[i])) sent++; else errs.push(r.getResponseCode() + ' ' + truncate_(r.getContentText(), 160));
  });
  if (!sent) throw new Error('Firebase did not deliver it: ' + errs.join(' | '));
  return 'Test sent to ' + sent + (sent === 1 ? ' phone' : ' phones') + '. It should arrive in a few seconds.';
}

// Run from the editor to test: sends to the first person who has push on and logs Firebase's answer.
function pushTest() {
  var hit = readPeople_().filter(function(p) { return pushTokens_(p.pid).length; })[0];
  if (!hit) { Logger.log('Nobody has turned notifications on in the app yet (Me tab > Notifications).'); return; }
  try { Logger.log(apiPushTest_(hit)); } catch (e) { Logger.log(e.message); }
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

function pushBase_() {
  var at = pushAccess_();
  var project = CacheService.getScriptCache().get('fcm_project') || JSON.parse(PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT')).project_id;
  return { at: at, url: 'https://fcm.googleapis.com/v1/projects/' + project + '/messages:send', app: str_(pushSet_().app_url) };
}

function pushRequest_(base, tok, title, body, urgent) {
  var msg = { token: tok, webpush: { headers: { Urgency: urgent ? 'high' : 'normal', TTL: '86400' }, notification: { title: String(title || 'BC Dads WAG'), body: String(body || '') } } };
  if (/^https:\/\//.test(base.app)) {
    msg.webpush.fcm_options = { link: base.app };
    msg.webpush.notification.icon = base.app.replace(/\/?$/, '/') + 'icon-180.png';
  }
  return { url: base.url, method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + base.at }, muteHttpExceptions: true, payload: JSON.stringify({ message: msg }) };
}

// true if delivered; drops tokens Firebase says are gone (phone uninstalled the app or turned it off).
function pushResult_(r, pid, tok) {
  var code = r.getResponseCode();
  if (code === 200) return true;
  if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(r.getContentText())) pushDropToken_(pid, tok);
  else Logger.log('Push to ' + pid + ' failed (' + code + '): ' + r.getContentText());
  return false;
}

// Sends one notification right away to every phone the person turned push on for. Returns how many phones got it.
function pushSendAll_(pid, title, body, urgent) {
  var tokens = pushTokens_(pid);
  if (!tokens.length) return 0;
  var base = pushBase_(), sent = 0;
  UrlFetchApp.fetchAll(tokens.map(function(t) { return pushRequest_(base, t, title, body, urgent); })).forEach(function(r, i) { if (pushResult_(r, pid, tokens[i])) sent++; });
  return sent;
}
