# Automatic Apps Script deploy

When files under `apps-script/` change on `main`, GitHub pushes them to this app's Apps Script project and makes a new version of the existing web app deployment (same web address). Workflow: `.github/workflows/deploy-apps-script.yml`.

The deploy copies the repo over the project and removes any project file that is not in the repo, so it stays off until `apps-script/appsscript.json` and all three secrets exist.

## One-time setup

1. **Turn on the Apps Script API** (skip if already done): https://script.google.com/home/usersettings

2. **Pull the backend into its own folder.** In Cloud Shell (shell.cloud.google.com), use a new folder so this project does not mix with any other:
   ```
   mkdir ~/bcdads
   cd ~/bcdads
   clasp list
   ```
   `clasp list` shows your projects and their Script IDs. Find this app's project, then:
   ```
   clasp clone <Script ID>
   ls
   ```
   If `clasp` says no credentials, run `clasp login --no-localhost` first (use clasp 3: `npm install -g @google/clasp@3`).

3. **Put the files in the repo.** Download every file `ls` shows (`appsscript.json` and the `.js` files; ignore `.clasp.json`) and upload them into a new `apps-script/` folder in this repo (Add file, Upload files). Keep the names as they are.

4. **Add three repository secrets** (Settings, Secrets and variables, Actions):
   - `CLASP_RC_B64`: your clasp login as one line. In Cloud Shell: `base64 -w0 ~/.clasprc.json > ~/clasprc.b64`, download `clasprc.b64`, paste its single line. This signs in as your Google account, so treat it like a password. Never paste it in chat or commit it.
   - `APPS_SCRIPT_ID`: the Script ID from step 2.
   - `APPS_SCRIPT_DEPLOYMENT_ID`: the web app's deployment ID. It is the long `AKfycb...` part of the app's `/exec` address (also under Deploy, Manage deployments).

5. Run **Actions, Deploy Apps Script, Run workflow** once to test.

## After that

Every merge to `main` that changes `apps-script/` deploys on its own. Check runs under the Actions tab.

If the login ever stops working, run `clasp login --no-localhost` again and update `CLASP_RC_B64`. The workflow uses clasp 3, so log in with clasp 3.
