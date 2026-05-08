# quicklog-prefill recipe (URL deep link)

A simpler shortcut that opens the web form pre-filled.

1. **Ask for input** — Number, prompt "Volume" → save as `volume`
2. **Ask for input** — Number, prompt "Cost" → save as `cost`
3. **Text** — build URL:
   `https://quicklog.home.lab/?vehicleId=1&volume=[volume]&volumeUnit=gal&cost=[cost]&currency=USD&fillToFull=true`
4. **Open URLs** — opens the URL from step 3 in the default browser

The web form mounts pre-filled. User taps "Log fillup" to submit.
