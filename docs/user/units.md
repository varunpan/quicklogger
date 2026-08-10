# Instance units (gallons/liters, miles/km)

quicklogger writes fuel volume to LubeLogger in the unit your instance is
configured for, and labels every volume and distance in the app to match.

## Setup

Two environment variables (see [configuration.md](./configuration.md)):

| Variable                   | Values                 | Default      |
| -------------------------- | ---------------------- | ------------ |
| `LUBELOGGER_VOLUME_UNIT`   | `gallons_us`, `liters` | `gallons_us` |
| `LUBELOGGER_DISTANCE_UNIT` | `miles`, `km`          | `miles`      |

Set them to **match your LubeLogger instance's own settings** (LubeLogger →
Settings → Imperial Calculation). quicklogger can't detect them automatically —
LubeLogger's API doesn't expose them. A wrong value writes wrong-magnitude
numbers into your records; an invalid value stops the server at startup with a
clear error instead of failing on every submit.

## What follows the units

- **Volume**: the success toast, "Will log" preview, last-fill strip, history
  unit prices ("CA$1.45/L"), and offline-queued fill-ups all use the instance
  volume unit. You can still _enter_ volume in gal or L — it's converted at
  submit time.
- **Distance**: odometer labels on the log form, history, stats, maintenance
  reminders, and smart-check warnings read mi or km. Odometer _values_ are
  never converted — your instance already stores them in its own unit.
- **Odometer photo OCR**: the vision model is told which distance unit
  your instance uses, so it reads a km-instance odometer photo as
  kilometers instead of assuming miles. Pump-photo OCR reads whatever
  unit (gal or L) is printed on the display itself and doesn't need
  the instance setting.
- **Fuel economy preview**: MPG on a gallons+miles instance, L/100km on a
  liters+km instance (the same figure LubeLogger shows). On mixed setups
  (liters+miles, gallons+km) there's no standard single figure, so the preview
  is hidden.
- **Photo filenames**: attached photos are named after the odometer reading
  with the distance unit (`odometer-84012km.jpg`).

## Notes

- On a device that hasn't talked to the server yet (first visit, cleared
  storage), labels briefly show gal/mi until the first refresh lands — the
  same warm-up the currency display has. Once a device has loaded the app
  online at least once, its units/currency/locale are remembered locally and
  keep working through an offline reload too — gal/mi/USD/en-US only shows up
  on that very first-ever load, never on a later offline cold-start.
- The smart-check "big odometer jump" warning fires above 2,000 in your
  distance unit (2,000 mi or 2,000 km).
