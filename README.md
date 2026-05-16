# Vibe Break

A corner mini-game for the dead time while AI generates code. Lives in your menu bar, pops up in the corner of your screen, and gets out of the way when you're done.

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

## Use it

- Press **⌘⇧G** anywhere to show/hide the game window.
- Or click the menu-bar icon.
- Quit from the menu-bar icon → Quit.

## Build from source

Requires Node.js.

```bash
npm install
npm start              # run in dev mode
npm run build          # produce dist/Vibe Break-x.y.z-universal.dmg
```
