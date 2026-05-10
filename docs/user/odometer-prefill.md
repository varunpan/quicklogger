# Odometer prefill & last-fillup strip

quicklogger pre-fills the odometer field with your previous reading and gives
you a one-tap chip to bump it by your typical miles-per-fillup. At the pump
you glance, tap once if your mileage was typical, type a couple of digits if
it wasn't, and submit.

## What you'll see

When you open the form on a vehicle that has a previous fillup, two things
appear:

1. **Last-fillup strip** at the top, above the vehicle picker:

        Last fill: 87,234 mi · 7 days ago
        10.8 Gal · $39.42 · Costco Pump 4

   The strip is read-only — it's there so you can sanity-check what the
   previous fillup was without leaving the form.

2. **Odometer field** opens already filled with the last reading (e.g.
   `87234`). The text is muted and a small **`prefilled`** tag sits in the
   corner of the input, signalling "this is a guess, double-check it."

3. **`+300 mi` chip** sits just below the odometer field. One tap adds 300
   miles to the value. Tap twice for 600. The number on the chip reflects
   what you've configured in Settings.

As soon as you tap the chip OR start typing, the muted styling clears and
the field becomes a normal editable input. A small helper line appears under
the field showing the delta from your last fillup, e.g. `+312 mi this tank`.

## Configuring it

Open **Settings** (drawer → Settings) and look for the **Odometer prefill**
card:

- **On / Off toggle** — turn the whole feature off if you'd rather start
  with an empty field. Default: **On**.
- **Quick increment (mi)** — the number the `+N mi` chip adds on each tap.
  Default: **300**. Set to **0** to hide the chip entirely while keeping the
  prefill behaviour.

Settings changes apply on the next time you open the form.

## Common patterns

| Situation | What to do |
| --- | --- |
| Typical fillup, ~300 miles since last fill | Tap `+300 mi` once, adjust by a few digits if needed. |
| Long road trip, ~600 miles | Tap `+300 mi` twice. |
| You wrote down the exact reading | Just type it — the prefill is overwritten the moment you start typing. |
| First-ever fillup for a vehicle | The strip and chip are hidden; field is empty, exactly like before. |
| You don't want any prefill | Settings → Odometer prefill → **Off**. |
| You want the prefill but no chip | Settings → Quick increment → **0**. |

## Why both?

The strip is informational — it gives you context without you having to leave
the form to look up the previous reading. The chip is the action — it turns
"type six digits on a glaring screen" into "tap once, fix one digit if your
mileage was off." Together they cut the at-pump gesture to roughly ten
seconds.

## When you're offline

quicklogger remembers your previous fillup so the strip and prefill keep
working when LubeLogger is unreachable (no signal at the pump, server
down, etc.).

The first time you submit a fillup while online, two things happen
behind the scenes:

1. The fillup is sent to LubeLogger as usual.
2. A copy is saved on the device — both the upstream snapshot and the
   submission itself are kept locally.

Next time you open the form and the server is unreachable, you'll see the
last-fillup strip with a small amber **`offline copy`** tag next to the
date:

        Last fill: 87,234 mi · 2 days ago  [offline copy]
        11.50 Gal · CAD 60.00

The odometer prefill works exactly like online — the field opens with the
last reading, the chip still bumps by your configured increment.

### What the tag means

- The number is the freshest reading the app could find on the device. It
  may be a fillup you logged from this phone, or a snapshot of what
  LubeLogger had the last time you were online.
- Cost is shown in whatever currency you originally entered (e.g.
  `CAD 60.00`) — no FX conversion happens offline. Online cached entries
  still render with a leading `$` because that's what the strip has
  always shown for the upstream value (typically USD; whatever your
  LubeLogger is configured to return).
- Submit works normally. The fillup queues locally and syncs on its own
  when the connection comes back.

The first time you ever open the form on a vehicle without ever having
been online, the strip is hidden and the field is empty (same as before).
