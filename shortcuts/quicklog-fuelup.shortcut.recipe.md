# quicklog-fuelup — direct POST shortcut (voice-friendly)

Voice-driven log: "Hey Siri, log fillup" → 3 spoken prompts → POST to `/api/fuelup` → spoken confirmation. No browser, no UI.

For the full walkthrough with detail on each Shortcuts UI action, see [`docs/user/shortcuts.md`](../docs/user/shortcuts.md) § "Path 2 — Direct POST".

## Actions (in order)

1. **Current Date**
2. **Format Date** — Format: `Custom`, format string `yyyy-MM-dd` → save as `date`
3. **UUID** → save as `clientSubmissionId`
4. **Ask for Input** — Number, prompt "Odometer?" → save as `odometer`
5. **Ask for Input** — Number, prompt "Volume in gallons?" → save as `volume`
6. **Ask for Input** — Number, prompt "Cost in dollars?" → save as `cost`
7. **Dictionary** — JSON body:

   | Key | Type | Value |
   |---|---|---|
   | `vehicleId` | Number | `1` (your LubeLogger vehicle id) |
   | `date` | Text | `[date]` magic var |
   | `odometer` | Number | `[odometer]` magic var |
   | `volume` | Number | `[volume]` magic var |
   | `volumeUnit` | Text | `gal` |
   | `cost` | Number | `[cost]` magic var |
   | `currency` | Text | `USD` |
   | `isFillToFull` | Boolean | `true` |
   | `missedFuelup` | Boolean | `false` |
   | `clientSubmissionId` | Text | `[clientSubmissionId]` magic var |

8. **Get Contents of URL** — `https://<your-quicklogger-host>/api/fuelup`
   - Method: `POST`
   - Headers: `Content-Type: application/json`
   - Request Body: `JSON`, drag the Dictionary from step 7
9. **Get Dictionary Value** — `submitted.gallons` from previous result → save as `loggedGal`
10. **Get Dictionary Value** — `submitted.cost` from previous result → save as `loggedUsd`
11. **Speak Text** — `Logged [loggedGal] gallons, [loggedUsd] dollars`

## Install

- Name the shortcut `quicklog-fuelup`.
- **Share → Add to Home Screen** for one-tap access.
- **Share → Add Voice Trigger** → "Log fillup" for "Hey Siri, log fillup".

## Multi-vehicle variant

Insert at the top, before step 4:

- **Dictionary** — `Honda Accord: 1`, `VW Atlas: 2`, etc.
- **Choose from List** — input is the Dictionary keys, prompt "Which vehicle?", save as `vehicleName`
- **Get Dictionary Value** — `[vehicleName]` from the Dictionary, save as `vehicleId`

Then in step 7 use `[vehicleId]` instead of the hardcoded `1`.
