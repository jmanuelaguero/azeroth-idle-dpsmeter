# Azeroth Meter

[![Latest release](https://img.shields.io/github/v/release/jmanuelaguero/azeroth-idle-dpsmeter?label=download&logo=github)](https://github.com/jmanuelaguero/azeroth-idle-dpsmeter/releases/latest)
[![CI](https://github.com/jmanuelaguero/azeroth-idle-dpsmeter/actions/workflows/ci.yml/badge.svg)](https://github.com/jmanuelaguero/azeroth-idle-dpsmeter/actions/workflows/ci.yml)
<!-- vt-badges:start -->
[![VirusTotal portable](https://img.shields.io/badge/VirusTotal%20%28portable%29-0%2F65%20detections-=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/660d2395b2dd7e9b52c865e4f8bd7ed431ef284ca22d7090c838410031550471)
[![VirusTotal installer](https://img.shields.io/badge/VirusTotal%20%28installer%29-0%2F59%20detections-=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/1b8bce85e86bdaa5f0b14684c3fd1f6ba506c7c6d8d232a2de80db0929224fc5)
<!-- vt-badges:end -->

A Details!-style live damage meter overlay for **Azeroth Idle**.
It reads the combat log the game itself writes to disk. It never touches game memory, network traffic or game input.

> Unofficial fan project. Not affiliated with or endorsed by Blizzard Entertainment or the Azeroth Idle team.

## Install

1. Download the latest release from the [Releases page](https://github.com/jmanuelaguero/azeroth-idle-dpsmeter/releases/latest):
   - **AzerothMeter-Setup-x.y.z.exe**: installer (recommended)
   - **AzerothMeter-x.y.z-portable.exe**: no install, just run it
2. Windows may show *"Windows protected your PC"* because the app is not code-signed. Click **More info → Run anyway**.
   Every release is scanned with Microsoft Defender during the build, and its SHA-256 checksums are published with it.
3. Open Azeroth Idle and type **`/combatlog`** in the game chat. That's the only setup step:
   the meter finds the game's files automatically and starts showing data as soon as you fight.

If the overlay says *"No combat events"* while you are fighting, combat logging is off: type `/combatlog` again.

## Features

- **Displays:** Damage Done, DPS, Damage Taken, Damage Taken by Spell, Enemy Damage Taken, Healing Done, HPS,
  Healing Taken, Deaths (with death recap) and Resources.
- **Segments:** current fight, overall, previous fights and **instance runs** (all fights of one dungeon visit).
- **Zones:** detects open world, dungeons and raids, including Scarlet Monastery wings.
- **Breakdowns:** click a bar for abilities and targets; hover a bar for its top 3 abilities.
- **Pets** are added to their owner. Class and spec icons and colors are detected from the abilities used.
- **Report:** copy a Details!-style report and paste it in the game chat (line by line) or in Discord.
- Always-on-top overlay with adjustable opacity. Works over the game in windowed or borderless mode.

## Privacy

Everything stays on your PC. The app only reads local files written by the game
(`%LOCALAPPDATA%\AzerothIdle\data`). The only network access is downloading ability icons
from Wowhead's public icon CDN (`wow.zamimg.com`); they are cached so later runs work offline.

## Limitations of the text combat log

- No unit flags: friend/foe is inferred (damage = opposite sides, healing = same side, anchored on you).
- No pet owner in the log: ownership is inferred; ambiguous pets stay as separate `PET` rows.
  Override with `"petOwners": { "Pet Name": "Owner" }` in the app's `settings.json`.
- No overhealing, interrupts, dispels or threat data are logged, so those displays are not available.

## Development

```sh
npm install
npm start      # run the overlay
npm test       # domain test suite
npm run dist   # build the Windows installer and portable exe into dist/
```

Releases are built by GitHub Actions when a `v*` tag is pushed (see `.github/workflows/release.yml`):
tests, build, Microsoft Defender scan, SHA-256 checksums and an optional VirusTotal scan
(enabled with the `VT_API_KEY` repository secret: results are added to the release notes and the README badges).

`AZEROTH_METER_USER_DATA=<folder>` runs the app with an isolated settings/cache folder, useful for testing.

## License

[MIT](LICENSE). The app icon is original artwork. Ability icons are downloaded at runtime and belong to their owners.
