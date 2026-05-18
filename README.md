# Vibe Break

A corner mini-game for the dead time while AI generates code. Lives in your menu bar / system tray, pops up in the corner of your screen, and gets out of the way when you're done.

Cross-platform — runs on macOS (Intel + Apple Silicon) and Windows x64.

## Install (macOS)

1. Download the latest `Vibe Break-x.y.z-universal.dmg` from the [Releases page](https://github.com/pra465/vibe-break/releases).
2. Open the DMG and drag **Vibe Break** into your Applications folder.
3. **Run this one line in Terminal** (the app isn't code-signed, so macOS quarantines it on download — this removes the quarantine flag so it can launch):

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Vibe Break.app"
   ```
4. Now double-click **Vibe Break** in Applications. It'll hide from the Dock and live in your menu bar — look for the small play-icon up top.

Works on both Apple Silicon and Intel Macs (universal binary).

<details>
<summary>If you'd rather not use Terminal</summary>

- **Right-click** the app in Applications → **Open** → click **Open** in the warning dialog. (Sometimes the Open button is hidden on newer macOS — in that case use the next option.)
- Open **System Settings → Privacy & Security**, scroll down to find *"'Vibe Break' was blocked..."*, and click **Open Anyway**.
</details>

## Install (Windows)

Two options — pick whichever you prefer:

| File | What it does |
|---|---|
| `Vibe Break Setup x.y.z.exe` | Standard installer — creates Start Menu shortcut, lets you pick the install location |
| `Vibe Break x.y.z.exe` | **Portable** — just run it, no install needed. Good for trying it out without committing |

Both are on the [Releases page](https://github.com/pra465/vibe-break/releases).

1. Download whichever you prefer.
2. Double-click the `.exe`. Windows will show **"Windows protected your PC"** because the app isn't code-signed.
3. Click **More info** → then click **Run anyway**.
4. The app lives in the **system tray** (bottom-right, near the clock — you may need to click the `^` to see hidden tray icons).

Windows remembers your decision — the warning only appears the first time.

## Use it

- **macOS:** press **⌘ Shift G** anywhere to show/hide the game window.
- **Windows:** press **Ctrl + Shift + G** anywhere to show/hide the game window.
- Or click the tray / menu-bar icon.
- Quit from the tray icon menu → Quit.

## What's in it

A handful of mini-games — quick to play, easy to drop:

- **Maze** — escape a procedurally generated maze
- **Snake** — speed ramps with score
- **Predict** — guess what the next line of code does
- **Runner** — endless side-scroller
- **Shooter** — top-down arcade shmup, 20 waves + boss
- **Chess Puzzles** — mate-in-1 and tactical puzzles
- **Taxi** — endless traffic dodger, jump over cars
- **Ghost Man** — neon maze chase with 4 enemy types

Pick from the dropdown in the top-right of the popup window.

## Build from source

Requires Node.js.

```bash
npm install
npm start              # run in dev mode

npm run build          # macOS — produces dist/Vibe Break-x.y.z-universal.dmg
npm run build:win      # Windows — produces dist/Vibe Break Setup x.y.z.exe + portable
npm run build:all      # both at once (macOS host can cross-build Windows via bundled tools)
```
