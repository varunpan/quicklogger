/** The currencies offered by the entry-form and Settings selects. One list,
 *  two `{#each}` consumers — the pair of hard-coded `<option>` lists used to
 *  drift-risk apart. Server-side validation is intentionally broader (any
 *  ISO-4217 code passes /api/fuelup), so extending this list is UI-only. */
export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'MXN'] as const;
