# quicklog-fuelup recipe (direct POST)

Build this in the iOS Shortcuts app:

1. **Ask for input** — Number, prompt "Vehicle ID" → save as `vehicleId`
2. **Ask for input** — Number, prompt "Volume" → save as `volume`
3. **Choose from menu** — `gal`, `L` → save as `volumeUnit`
4. **Ask for input** — Number, prompt "Cost" → save as `cost`
5. **Choose from menu** — `USD`, `CAD`, `EUR` → save as `currency`
6. **Choose from menu** — `Yes`, `No` → save as `fillToFull`
7. **Get current date** → save as `nowDate`
8. **Format date** — ISO format (`yyyy-MM-dd`) → save as `isoDate`
9. **Get UUID** → save as `uuid`
10. **Dictionary** — build:
    - `vehicleId` → variable
    - `date` → `isoDate`
    - `odometer` → `Ask for input` Number, prompt "Odometer"
    - `volume` → variable
    - `volumeUnit` → variable
    - `cost` → variable
    - `currency` → variable
    - `isFillToFull` → equals "Yes" → true/false
    - `missedFuelup` → false
    - `clientSubmissionId` → uuid
11. **Get contents of URL** — `https://<your-quicklogger-host>/api/fuelup`
    - Method: POST
    - Headers: `content-type: application/json`
    - Request body: JSON, the Dictionary from step 10
12. **Show result** — read `submitted.gallons` and `submitted.cost`,
    show `"Logged: X gal · $Y"`
