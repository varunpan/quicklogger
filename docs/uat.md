# Manual UAT checklist (v0.1.0)

Run after each release before tagging stable.

## Setup

- [ ] Latest tag pulled on homelab: `docker compose pull && docker compose up -d`
- [ ] Browser cache cleared on iPhone (or new device fresh install)
- [ ] LubeLogger has at least one test vehicle
- [ ] `LUBELOGGER_API_KEY` is set in `/home/varun/stacks/quicklogger/.env`

## Cert check

- [ ] Open `https://quicklog.home.lab` on iPhone (Safari)
- [ ] Page loads with green padlock — no cert warnings
- [ ] (Root CA was installed on iPhone 2026-05-07 per homelab memory)

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
- [ ] Browser opens `quicklog.home.lab/?...` with form pre-filled
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
