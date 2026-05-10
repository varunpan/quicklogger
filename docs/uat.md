# Manual UAT checklist (v0.1.0)

Run after each release before tagging stable.

## Setup

- [ ] Latest tag pulled: `docker compose pull && docker compose up -d`
- [ ] Browser cache cleared on iPhone (or new device fresh install)
- [ ] LubeLogger has at least one test vehicle
- [ ] `LUBELOGGER_API_KEY` is set in your stack's `.env`

## Cert check

- [ ] Open the deployed URL on iPhone (Safari)
- [ ] Page loads with green padlock — no cert warnings
- [ ] (If using a private CA: confirm the root cert is trusted on the phone)

## PWA install

- [ ] Tap **Share** → **Add to Home Screen**
- [ ] Icon appears on home screen with "quicklog" label
- [ ] Tap icon: launches in standalone mode (no browser chrome)
- [ ] Status bar matches `#09090b` theme

## Happy-path submission

- [ ] App auto-selects last vehicle
- [ ] Enter odometer, volume in gallons, cost in USD, fill-to-full = on
- [ ] Tap "Log fillup"
- [ ] Toast shows "Logged: X.XX gal · $YY.YY"
- [ ] Verify the entry appears in LubeLogger UI within 5 seconds

## Unit / currency conversion

- [ ] Switch volume to L, enter 50
- [ ] Switch currency to CAD, enter 65
- [ ] Tap "Log fillup"
- [ ] Toast confirms ~13.2 gal · ~$47 USD
- [ ] LubeLogger record matches (US gal / USD)

## Offline + queue

- [ ] Enable airplane mode
- [ ] Submit a fillup → toast shows "Saved locally — will sync"
- [ ] Disable airplane mode
- [ ] Tap away and return to the app (focus event triggers sync)
- [ ] /history shows pending count drops to 0
- [ ] LubeLogger receives the entry

## Apple Shortcut — direct POST

- [ ] Run `quicklog-fuelup` shortcut from home screen
- [ ] Voice prompts complete (vehicle, volume, cost)
- [ ] Shortcut shows "Logged: X gal · $Y"
- [ ] LubeLogger receives the entry

## Apple Shortcut — URL deep link

- [ ] Run `quicklog-prefill` shortcut
- [ ] Browser opens the deployed URL with form pre-filled (`?vehicleId=...&volume=...`)
- [ ] Tap "Log fillup" → confirmation
- [ ] LubeLogger receives the entry

## FX outage / manual override

- [ ] On homelab, briefly block outbound TCP 443:
      `sudo iptables -I OUTPUT -p tcp --dport 443 -j REJECT`
      (or temporarily disable WAN at the router)
- [ ] Restart container: `docker compose restart quicklogger`
- [ ] Submit a CAD fillup
- [ ] Manual FX rate field becomes visible
- [ ] Enter `0.73`, submit → success
- [ ] Restore outbound:
      `sudo iptables -D OUTPUT -p tcp --dport 443 -j REJECT`

## Settings persistence

- [ ] Set default unit = L, currency = CAD
- [ ] Quit + relaunch app
- [ ] Form opens with L + CAD as defaults

## Odometer prefill + last-fillup strip (v0.1.3)

Run on a vehicle that has at least one previous fillup in LubeLogger.

### Strip

- [ ] Open `/`. Above the vehicle picker, two-line strip is visible:
      `Last fill: <comma-formatted miles> · <"today"|"yesterday"|"N days ago">`
      `<volume> Gal · $<cost> · <notes if any>`.
- [ ] Switch to a vehicle with **no** previous fillup. Strip is gone.

### Prefill

- [ ] On a vehicle with a previous fillup, open `/`. Odometer field shows the
      last reading as raw digits (no comma) in muted text. Small
      `PREFILLED` tag visible in the field's top-right corner.
- [ ] Type into the field. Text snaps to white, the tag disappears.
- [ ] Helper line under the field reads `+N mi this tank` where N is the
      delta from the last reading.

### `+N mi` chip

- [ ] Chip is visible below the odometer field, labelled with the increment
      from Settings (e.g. `+300 mi`).
- [ ] Tap once → field value increases by the increment, helper updates,
      muted style clears.
- [ ] Tap twice in succession → value increases by 2× the increment.
- [ ] After typing manually, tap chip → adds the increment to whatever was
      typed (not to the original prefill).

### Settings card

- [ ] `/settings` shows the new **Odometer prefill** card under Currency.
- [ ] Toggle Off → return to `/` → field is empty, chip is hidden, strip
      still shows.
- [ ] Toggle On, set increment to 0 → return to `/` → field is prefilled,
      chip is hidden.
- [ ] Toggle On, set increment to 250 → return to `/` → chip reads `+250 mi`
      and bumps by 250.

### Submit flow regression

- [ ] Submit a fillup successfully. Form resets — odometer re-prefills with
      the same prior value (snapshot from page-load), volume/cost reset.
- [ ] Submit a fillup with the chip-bumped value. LubeLogger receives the
      bumped value, not the original prefill.

### Real-phone (LAN preview)

- [ ] `npm run build && npm run preview:lan`
- [ ] Open `http://<LAN-IP>:4173` on iPhone Safari.
- [ ] Walk through Strip / Prefill / Chip / Settings card sections above on
      the phone.
- [ ] Tap-target sizes feel comfortable for one-handed use at the pump.

## Offline odometer prefill (v0.1.3)

Run on a vehicle that already has at least one fillup logged from this
device while online (so the local cache is populated).

### Setup — populate local data

- [ ] On a normal online session, submit one fillup successfully on the
      target vehicle. This writes both the upstream cache and a `'synced'`
      queue entry.

### Cache fallback (upstream down, cache populated)

- [ ] Take upstream offline (e.g., point dev `.env` `LUBELOGGER_BASE_URL`
      at an unreachable host, or pause the upstream container).
- [ ] Restart `quicklogger` so the page loader hits the broken upstream.
- [ ] Open `/`. Strip renders with the previously-cached values + small
      amber `offline copy` chip next to the days-ago text.
- [ ] Odometer field is prefilled with the last reading.
- [ ] `+N mi` chip increments work as normal.
- [ ] Submit a fillup — toast shows "Saved locally — will sync".

### Queue-derived fallback (upstream down, no cache)

- [ ] Clear `quicklogger.lastFuelup.<vehicleId>` from localStorage (DevTools
      → Application → Local Storage). Leave the `'synced'` queue entry
      from the prior submit intact.
- [ ] Reload `/`. Strip still renders (sourced from the queue entry).
- [ ] Cost is shown as `<currency> <amount>` (e.g. `CAD 60.00`), not
      `$<amount>`.

### Empty state (upstream down, nothing local)

- [ ] Clear both localStorage and IndexedDB.
- [ ] Reload `/`. Strip is hidden, field is empty (matches today's
      no-prior-fillup behaviour).

### Recovery (upstream returns)

- [ ] Restore upstream connectivity. Reload `/`. Strip renders without
      the `offline copy` chip; cost reverts to `$<amount>` rendering.
- [ ] Cache key is refreshed.
