# Smart checks

quicklogger nudges you when a fillup you're about to submit looks off —
lower odometer than the previous fillup, a future date, a tiny volume
that's probably a typo. The chip explains what looks wrong, and you can
either fix the field or tap **Submit anyway** to log it as-is.

Smart checks are advisory. They never block you — you keep the override.

## What you'll see

When you tap **Log fillup** with a sketchy combination, a single amber
chip appears just above the Submit button:

        ⚠ 2 issues found
          • Odometer (12,400 mi) is lower than the last fillup
            (45,210 mi on May 7).
          • Date is in the future.

                       [ Submit anyway ]

The main **Log fillup** button greys out while the chip is showing.
Tap **Submit anyway** to send the fillup as you typed it, or edit one
of the fields the chip flagged — odometer, volume, or date — and the
chip clears. Tap **Log fillup** again to re-check.

## The six checks

quicklogger evaluates these at the moment you tap Submit:

| What it catches | Example chip line |
| --- | --- |
| Odometer is lower than the previous fillup (and the date isn't older) | `Odometer (12,400 mi) is lower than the last fillup (45,210 mi on May 7).` |
| Date is older than the last fillup but odometer is higher | `Older date but higher odometer than the most recent fillup (45,210 mi on May 7).` |
| Looks like a duplicate of an entry on the same date | `Looks like a duplicate of the May 7 fillup at 45,210 mi.` |
| Date is in the future | `Date is in the future.` |
| Odometer jumped more than 2,000 miles since the last fillup | `Odometer is 2,150 mi above the last fillup — over 2,000 mi.` |
| Volume looks tiny (under 0.5 gal or 2 L) — likely a decimal slip | `Volume (0.5) seems small — did you mean 5?` |

The first three plus the odometer-jump check are silent when there's no
previous fillup for the active vehicle (no baseline to compare against).
The future-date and tiny-volume checks run regardless.

## Turning it off

Open **Settings** (drawer → Settings) and scroll to the **Smart checks**
card. Tap **Off** to disable the feature entirely — the chip will never
appear, and Submit behaves exactly like before.

The toggle defaults to **On**. There's no per-check toggle in v0.2.0; if
one of the checks turns out to be noisy in real use, the plan is to
break the master toggle into individual switches in a future release.

## When the chip is showing

- **Edit odometer, volume, or date** → chip clears, Submit re-enables.
  Tap Log fillup again to re-evaluate against your edits.
- **Edit cost (or anything else)** → chip stays. Cost isn't a smart-check
  field, so editing it doesn't trigger a re-check.
- **Tap [Submit anyway]** → fillup posts immediately. No second
  confirmation, no extra prompt.

## What smart checks don't do

- **They don't block external submissions.** Apple Shortcuts and any
  direct `/api/fuelup` callers bypass smart checks entirely — the
  server still only enforces "all four required fields present and
  positive". Smart checks are a UI-side guard, not a contract.
- **They don't catch every weird case.** A cost-vs-volume ratio check
  is deferred — too many currency × market combinations to ship
  responsibly in v0.2.0. If a fillup is overpriced or underpriced for
  its volume, smart checks won't flag it.
- **They don't auto-correct.** The chip points at what looks off; you
  decide whether to fix the field or override. Even the "did you mean
  5?" suggestion is a hint, not an auto-fill.
