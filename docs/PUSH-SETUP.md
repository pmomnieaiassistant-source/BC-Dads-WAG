# Phone push notifications: setup

The code is already in the repo. Push stays off until these steps are done, and nothing else in the app changes.

You can **reuse the Firebase project you made for the Momnie app** (the keys below are the same ones). Each app keeps its own phones and its own sending, so they never mix.

## 1. Firebase keys into `config.js`

1. Firebase console, your project, **Project settings, General**, scroll to "Your apps". Add a **Web app** called "BC Dads" (or open the existing Momnie one).
2. Copy its `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId` into `config.js`.
3. **Project settings, Cloud Messaging, Web Push certificates**: generate a key pair (or use the existing one) and paste it into `FIREBASE_VAPID_KEY` in `config.js`.
4. Commit `config.js` to `main` (these are public web keys, safe in a public repo).

## 2. Sending side (Apps Script)

1. **Project settings, Service accounts, Generate new private key** (the same JSON file you used for Momnie works).
2. Apps Script editor for the BC Dads project, **Project Settings, Script properties**, add `FIREBASE_SERVICE_ACCOUNT` and paste the whole JSON file as the value.
3. In the Sheet's **Settings** tab, make sure `app_url` is the GitHub Pages address of the app, ending in `/`.
4. In the Apps Script editor, pick **`setupPush`** in the function menu and press **Run** (once). It asks for permission, then starts the every-minute sending job.
   (After a merge to `main` the deploy workflow uploads `Push.gs` for you.)

## 3. Turn it on, per phone

1. Open BC Dads from the **Home Screen icon** (iPhone needs iOS 16.4 or newer; Safari tabs cannot get push).
2. **Me** tab, **Notifications**, **Turn on notifications**, tap Allow.
3. Press **Send me a test**. It should arrive in a few seconds.

Each person controls their own alerts in the same card: which kinds they get (fires and comments, side bets, group updates and reminders) and how they arrive (as they happen, bundled 3 minutes, every 15 minutes, or hourly). If a phone blocked alerts earlier, the card explains where to allow them in the phone's Settings.

## What gets sent

| Alert | Who gets it | Switch |
| --- | --- | --- |
| Someone fires up your workout or post | the post's owner | Fires and comments |
| Someone comments on your post or wall | the post's owner | Fires and comments |
| A side bet is posted | everyone it is not hidden from | Side bets |
| A side bet settles or is called off | everyone who had money on it | Side bets |
| Dormie, buying the bet, weekly recap, last-day nudge | the group (nudge: only those who still need a workout) | Group updates and reminders |

Alerts for one person are held a few minutes and sent together ("3 updates in BC Dads WAG"). Change the wait with `push_bundle_min` in the Settings tab (default 3).

## Feedback

The **Talk shit and make this app better** link at the bottom of the Me tab saves each message in a new **Feedback** tab in the Sheet (when, who, text).

## Troubleshooting

- Test says "No phone is set up for push yet": turn it on in the app first (step 3).
- Test says "Push is not set up on the server yet": the `FIREBASE_SERVICE_ACCOUNT` script property is missing (step 2).
- No notification but no error: run `pushTest` from the Apps Script editor and read the log. Check the Firebase Cloud Messaging API is enabled for the project.

## Hide and delete on the feed

- Swipe any feed card **left** to reveal **Hide**. It removes the post from your own feed only. "N hidden posts, Show again" appears at the bottom of the feed to bring them back.
- People listed in the Settings tab row `admins` (default `Paul`; names or participant ids, comma separated) also see **Delete**, which removes a post for everyone.
