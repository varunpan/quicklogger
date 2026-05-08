# quicklog-prefill — URL deep link shortcut (form pre-filled, tap to confirm)

Builds a URL with query params, opens it in Safari. The form mounts pre-filled; you tap **Log fuel** to submit.

For the full walkthrough with detail on each Shortcuts UI action, see [`docs/shortcuts.md`](../docs/shortcuts.md) § "Path 1 — URL deep link".

## Actions (in order)

1. **Ask for Input** — Number, prompt "Volume" → save as `volume`
2. **Ask for Input** — Number, prompt "Cost" → save as `cost`
3. **Text** — build the URL using the magic-variable picker for the saved variables:

   ```
   https://<your-quicklogger-host>/?vehicleId=1&volume=[volume]&volumeUnit=gal&cost=[cost]&currency=USD&fillToFull=true
   ```

4. **Open URLs** — drag the Text from step 3 in as the input

The web form mounts pre-filled. User taps **Log fuel** to submit.

## Install

- Name the shortcut `quicklog-prefill`.
- **Share → Add to Home Screen** for one-tap access.
- A voice trigger works too but is awkward — you'd say "Log fillup pre-filled" or similar, then dictate the values, then Safari opens, then you still have to tap submit. Path 2 (`quicklog-fuelup`) is the better voice flow.

## Multi-vehicle variant

Insert at the top, before step 1:

- **Dictionary** — `Honda Accord: 1`, `VW Atlas: 2`, etc.
- **Choose from List** — input is the Dictionary keys, prompt "Which vehicle?", save as `vehicleName`
- **Get Dictionary Value** — `[vehicleName]` from the Dictionary, save as `vehicleId`

Then in step 3, replace `vehicleId=1` with `vehicleId=[vehicleId]`.
