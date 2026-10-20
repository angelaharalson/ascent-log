# Ascent Log: ascent tracker for a 17-ascent, 36-hour mountain ultra

A Progressive Web App (PWA). It installs on your phone's home screen, works with no signal once installed, and keeps all data on your phone.

## What it does
- **Mantras**: tapping *Start Ascent* shows a popup with a mantra picked at random from 17. None repeats during the event. The current ascent's mantra stays in the top section while you climb, and it's included in the CSV export. *Clear all ascent times* makes all 17 available again.
- **One big button** records *Start Ascent N* and then *Finish Ascent N*. A second tap within 4 seconds is ignored, and an **Undo** shows for 10 seconds after each tap.
- **Enter time** button (and tapping any ascent in the table) lets you type or adjust start/end times. The −5m/−1m/+1m/+5m/Now chips are there for when you forgot to tap.
- **Ascents table** shows start, end, ascent time, the break after each ascent, the goal start time, and how far ahead (+) or behind (−) you started each ascent.
- **Totals**: ascents, mileage (1.4 mi/ascent), elevation (1,750 ft/ascent), total ascent time, total time between ascents, and fastest/slowest ascent.
- **Projections** use the average of your previous 2 ascents (ascent time plus the break after it). They estimate:
  - when the current ascent will finish
  - when the final ascent (ascent 17) will finish, and the margin against the 36-hour cutoff
  - the per-ascent pace you need from now on to make the cutoff
- **Goal scenarios** that you can switch between on the fly. Each one gives target start times for every ascent:
  | | Rule | Goal finish |
  |---|---|---|
  | Red Hat | 2 hr from one ascent start to the next, +30 min on ascents 4, 6, 12, 15 | 36:00 (6:00 PM day 2) |
  | Main | 90 min from one ascent start to the next, +30 min on ascents 6, 9, 12, 15 | 27:30 (9:30 AM day 2) |
  | Stretch | 65 min for ascents 1–2, +5 min every 2 ascents, +30 min on ascents 4, 6, 12, 15 | 25:45 (7:45 AM day 2) |

  You can edit these or add your own under **Settings → Goal scenarios**.
- **Seven Summits**: finishing certain ascents shows a celebration popup, and a checklist at the bottom ticks off each summit. A summit is awarded at the ascent whose total climb is closest to its height (1,750 ft per ascent, rounded to the nearest ascent). Everest is the final ascent:
  | Summit | Height | Ascent |
  |---|---|---|
  | Kosciuszko | 7,310 ft | 4 |
  | Vinson | 16,050 ft | 9 |
  | Elbrus | 18,510 ft | 11 |
  | Kilimanjaro | 19,341 ft | 11 (shown right after Elbrus) |
  | Denali | 20,310 ft | 12 |
  | Aconcagua | 22,841 ft | 13 |
  | Everest | 29,029 ft | 17 (final) |
- **Chart** of elapsed time by ascent: your actual times, your projection, every scenario, and the cutoff line.
- **Look and feel** is modeled on 29029.co: black background, signal red (#E52726) with gold and teal accents, bold uppercase type, and a red countdown bar at the top. Here it counts down to the cutoff. The font is Archivo, a free Google Font close to the site's licensed Tofino. It's cached for offline use. Dark is the default, and you can switch to Light for bright sun in Settings.
- **Backup**: export or import JSON, and export a CSV of your ascents.

## Live app
**https://angelaharalson.github.io/ascent-log/**, hosted on GitHub Pages from this repository's `main` branch.

## Put it on your phone
- **iPhone:** open the link above in **Safari**, tap Share, then **Add to Home Screen**.
- **Android:** open it in **Chrome**, then tap **Install app** (or ⋮ → Add to Home screen).

To host a copy somewhere else, any static HTTPS host works. Two free options:

**Netlify Drop (easiest)**
1. Go to https://app.netlify.com/drop and sign in (free).
2. Drag this whole `29029` folder onto the page. You'll get an `https://….netlify.app` link.

**GitHub Pages**
1. Create a repository, upload these files, then go to Settings → Pages → Deploy from branch → `main` / root.

**Then install it**
- **iPhone:** open the link in **Safari**, tap Share, then **Add to Home Screen**.
- **Android:** open the link in **Chrome**, then tap **Install app** (or ⋮ → Add to Home screen).

## Before race day
1. Open the app from the **home-screen icon**. On iPhone, the home-screen app and Safari keep separate data, so always use the icon.
2. Check the **event start**. It defaults to **Fri, Oct 23, 2026 at 6:00 AM** (cutoff Sat 6:00 PM). You can change it in Settings. Goal times and the cutoff are measured from it.
3. Test it in airplane mode to confirm it opens offline.
4. During the event, use **Settings → Export backup** now and then.

## Updating the app later
Commit and push changes to `main`, and GitHub Pages republishes in about a minute. Also bump `CACHE` in `sw.js` (for example `ascent-log-v14`) so installed copies pick up the change. Then reopen the app twice so the phone picks up the new version. Your ascent data isn't affected. (The app was renamed from Summit Log; data saved under the old name still loads.)

## Files
`index.html`, `styles.css`, `app.js` (all logic), `sw.js` (offline cache), `manifest.webmanifest` and `icons/` (install metadata). The app icons and header mark use the red outline shape from the original 29029 logo file. That file isn't published here. There's no build step and nothing to install.

To preview on a computer, run this inside the folder and then open http://localhost:8000:

```bash
python3 -m http.server 8000
```
