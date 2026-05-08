# Apple Shortcuts integration

quicklogger supports two iOS Shortcut patterns. Both work over the same HTTPS endpoint and require nothing on quicklogger's side beyond the regular setup.

| | Path 1 — URL deep link | Path 2 — Direct POST |
|---|---|---|
| **What it does** | Opens the form pre-filled in Safari, you tap "Log fuel" to submit | POSTs JSON straight to `/api/fuelup`, no UI |
| **Best for** | Eyeball-and-confirm flows; reading values off the pump display | Voice-first ("Hey Siri, log fillup"); hands-busy |
| **Browser opens?** | Yes (then iOS may keep it focused) | No |
| **Voice-friendly?** | Awkward (browser tab needed) | Yes (designed for it) |
| **Failure mode if offline** | Form will queue the submit via SW once Safari is open | POST fails immediately; the Shortcut errors |
| **Setup complexity** | Easy (4 actions) | Moderate (10–13 actions) |

If you only build one, **Path 1 is the higher-leverage one** — you'll use it daily.
If you do a lot of pump-side work and want voice, **also build Path 2**.

---

## Path 1 — URL deep link (form opens pre-filled)

The home page (`/`) accepts query params. The shortcut just builds a URL and opens it in Safari; the form mounts pre-filled and you tap **Log fuel** to submit.

### Supported query params

| Param | Type | Notes |
|---|---|---|
| `vehicleId` | int | LubeLogger vehicle id (`/vehicles` page shows the id under each name) |
| `volume` | decimal | Matches the chosen unit |
| `volumeUnit` | `gal` \| `L` | |
| `cost` | decimal | Matches the chosen currency |
| `currency` | ISO 4217 | `USD`, `CAD`, `EUR`, `GBP`, `MXN` |
| `fillToFull` | `true` \| `false` | Defaults `true` if missing |

All params are optional — anything you don't pass uses the form's normal defaults (last vehicle, today's date, your Settings defaults for unit/currency).

### Build it on iPhone

1. Open **Shortcuts** app → **+** to create a new shortcut.
2. Add these actions in order:
   - **Ask for Input** — Type: Number, Prompt: "Volume" → save the result as `volume`.
   - **Ask for Input** — Type: Number, Prompt: "Cost" → save the result as `cost`.
   - **Text** — type the URL with magic-variable substitutions:

     ```
     https://<your-quicklogger-host>/?vehicleId=1&volume=[volume]&volumeUnit=gal&cost=[cost]&currency=USD&fillToFull=true
     ```

     Replace `[volume]` and `[cost]` by tapping the variable picker (the magic-wand icon) and selecting the saved variables from steps 1–2.
   - **Open URLs** — drag the Text from step 3 in as the input.
3. Name it `quicklog-prefill` and tap **Done**.
4. **Share → Add to Home Screen** so it's one tap from the lock screen.

### Multi-vehicle variant

If you have more than one vehicle, replace step 1 with:

- **Dictionary** — keys are vehicle names, values are the corresponding `vehicleId` integers:

  ```
  Honda Accord:  1
  VW Atlas:      2
  ```

- **Choose from List** — input is the Dictionary's keys, prompt "Which vehicle?". Save as `vehicleName`.
- **Get Dictionary Value** — Get value for `vehicleName` in the Dictionary. Save as `vehicleId`.

Then use `[vehicleId]` instead of the hard-coded `1` in the URL Text action.

### Recipe file

[`shortcuts/quicklog-prefill.shortcut.recipe.md`](../shortcuts/quicklog-prefill.shortcut.recipe.md) — condensed step list.

---

## Path 2 — Direct POST (voice-friendly)

POSTs JSON directly to `/api/fuelup`. No browser, no UI. Designed for voice trigger via "Hey Siri, log fillup."

### Endpoint shape

```http
POST https://<your-quicklogger-host>/api/fuelup
Content-Type: application/json

{
  "vehicleId": 1,
  "date": "2026-05-08",
  "odometer": 87432,
  "volume": 11.2,
  "volumeUnit": "gal",
  "cost": 42.18,
  "currency": "USD",
  "isFillToFull": true,
  "missedFuelup": false,
  "clientSubmissionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

The server returns:

```json
{
  "ok": true,
  "submitted": { "gallons": 11.2, "cost": 42.18 }
}
```

Use `submitted.gallons` and `submitted.cost` in a final **Speak Text** action so Siri tells you what was logged (handy for verifying the conversion when you submitted in CAD/L).

### How Siri prompts you

When you say **"Hey Siri, log fillup"**:

1. Siri runs the shortcut from the top.
2. For each **Ask for Input** action, Siri speaks the prompt and **listens for your spoken response**.
3. Siri parses the spoken response according to the input type:
   - **Number**: dictate digits (`forty-two point one eight` → `42.18`). Saying *"point"* explicitly is the most reliable way to get decimals; *"and"* sometimes works but is ambiguous.
   - **Yes/No**: spoken "yes" or "no".
   - **Text**: free-form dictation.
4. After all prompts, the shortcut runs the POST silently.
5. The final **Speak Text** action speaks the confirmation (e.g., *"Logged 11.2 gallons, 42 dollars and 18 cents"*).

**Each `Ask for Input` is a separate Siri prompt.** They are sequential — Siri waits for each answer before moving on. So a 3-prompt shortcut is roughly:

> 🗣 "Hey Siri, log fillup."
> 🤖 "Odometer?"
> 🗣 "Eighty-seven thousand four hundred thirty-two."
> 🤖 "Volume?"
> 🗣 "Eleven point two."
> 🤖 "Cost?"
> 🗣 "Forty-two point one eight."
> 🤖 "Logged 11.2 gallons, 42 dollars."

The whole flow takes ~25–35 seconds depending on how cleanly Siri parses each spoken number. For a single-vehicle, single-currency setup, that's the fastest "no-tap" log.

### Build it on iPhone

The recipe below assumes a single-vehicle (`vehicleId=1`) `gal`/`USD` setup. Adjust the hardcoded values if you have a different default.

1. Open **Shortcuts** app → **+** to create a new shortcut.
2. Add these actions in order:
   1. **Current Date** — gives today's date.
   2. **Format Date** — Format: `Custom`, Format String: `yyyy-MM-dd` → save as `date`.
   3. **UUID** → save as `clientSubmissionId`.
   4. **Ask for Input** — Type: Number, Prompt: "Odometer?" → save as `odometer`.
   5. **Ask for Input** — Type: Number, Prompt: "Volume in gallons?" → save as `volume`.
   6. **Ask for Input** — Type: Number, Prompt: "Cost in dollars?" → save as `cost`.
   7. **Dictionary** — build the JSON body with these key/value pairs:

      | Key | Value |
      |---|---|
      | `vehicleId` | `1` (Number) |
      | `date` | `[date]` (Text, magic var) |
      | `odometer` | `[odometer]` (Number, magic var) |
      | `volume` | `[volume]` (Number, magic var) |
      | `volumeUnit` | `gal` (Text) |
      | `cost` | `[cost]` (Number, magic var) |
      | `currency` | `USD` (Text) |
      | `isFillToFull` | `true` (Boolean) |
      | `missedFuelup` | `false` (Boolean) |
      | `clientSubmissionId` | `[clientSubmissionId]` (Text, magic var) |

   8. **Get Contents of URL** — drag the Dictionary in as the body:
      - URL: `https://<your-quicklogger-host>/api/fuelup`
      - Method: `POST`
      - Headers: `Content-Type: application/json`
      - Request Body: `JSON`, value = the Dictionary from step 7.
   9. **Get Dictionary Value** — Get value for `submitted.gallons` in the previous result → save as `loggedGal`.
   10. **Get Dictionary Value** — Get value for `submitted.cost` in the previous result → save as `loggedUsd`.
   11. **Speak Text** — `Logged [loggedGal] gallons, [loggedUsd] dollars`.
3. Name it `quicklog-fuelup` and tap **Done**.
4. **Share → Add to Home Screen** so it works without voice too.
5. **Share → Add Voice Trigger** → say "Log fillup" → save. (Same trigger word as the shortcut name is fine.)

### Test it

- Tap the shortcut on the home screen first (no voice). Walk through the prompts via tap-to-type. Verify the POST lands in LubeLogger and the Speak action announces the right numbers.
- Then trigger by voice: **"Hey Siri, log fillup."**

### Multi-vehicle variant

Same as Path 1 — insert a Dictionary + Choose from List + Get Dictionary Value at the top to pick `vehicleId` before the other prompts.

### Recipe file

[`shortcuts/quicklog-fuelup.shortcut.recipe.md`](../shortcuts/quicklog-fuelup.shortcut.recipe.md) — condensed step list.

---

## Tips & gotchas

- **Dictating decimals**: Siri's most reliable parse is `<integer> point <integer>` (e.g., "eleven point two"). Saying "and" instead of "point" works sometimes but Siri may interpret "ten dollars and fifty cents" as `10` then prompt again for the decimal.
- **Currency conversion**: if you submit in non-USD (e.g., CAD), the server converts to USD before storing in LubeLogger. The Speak Text action announces the *converted* USD amount, which is the actual stored value.
- **Offline**: Path 1 works offline (the form's IndexedDB queue handles it once Safari is open). Path 2 fails immediately — the POST has no client-side queue. Future enhancement could add one.
- **Multi-vehicle without picking**: an alternative to a Choose-from-List is to build *two* separate shortcuts (`log-honda`, `log-atlas`), each hardcoded to its `vehicleId`. Lower friction at the pump, more shortcuts to maintain.
- **Apple Watch**: shortcuts published to the watch can run there. Path 2 works well on watch since there's no browser. Path 1 typically opens Safari on the paired iPhone.

## Re-publishing iCloud links

When you publish a new shortcut version, paste the iCloud share link here so future-you (or fork users) can install in one tap.

| Shortcut | iCloud link |
|---|---|
| quicklog-fuelup | _(populate after first publish)_ |
| quicklog-prefill | _(populate after first publish)_ |

To publish: in Shortcuts app, long-press the shortcut → **Share** → **Copy iCloud Link**. Anyone with the link can add the shortcut and adjust the URL/vehicleId for their setup.

## Android

Android Shortcuts (Tasker / Macrodroid) are out of scope for v0.1.x. The same `/api/fuelup` JSON endpoint will serve any client; build a Tasker HTTP Request task with the same payload and headers to integrate.
