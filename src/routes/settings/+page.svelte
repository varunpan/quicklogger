<script lang="ts">
  import { loadPrefs, savePrefs } from '$lib/client/prefs';
  import type { VolumeUnit } from '$lib/shared/types';

  let prefs = $state(loadPrefs());

  function updateUnit(u: VolumeUnit) {
    prefs.defaultVolumeUnit = u;
    savePrefs({ defaultVolumeUnit: u });
  }

  function updateCurrency(c: string) {
    prefs.defaultCurrency = c;
    savePrefs({ defaultCurrency: c });
  }

  function updatePrefillEnabled(enabled: boolean) {
    prefs.odometerPrefillEnabled = enabled;
    savePrefs({ odometerPrefillEnabled: enabled });
  }

  function updateIncrement(value: string) {
    // Coerce to a non-negative integer; clamp invalid input back to 0.
    const n = Number(value);
    const safe = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    prefs.odometerIncrementMi = safe;
    savePrefs({ odometerIncrementMi: safe });
  }
</script>

<header class="flex items-center mb-4 gap-3">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="text-zinc-400">‹</a>
  <h1 class="text-xl font-bold">Settings</h1>
</header>

<div class="flex flex-col gap-4">
  <label class="field">
    <span class="field-label">Default volume unit</span>
    <div class="flex bg-zinc-800 rounded-xl p-1">
      <button
        type="button"
        class="toggle-pill flex-1"
        class:active={prefs.defaultVolumeUnit === 'gal'}
        class:inactive={prefs.defaultVolumeUnit !== 'gal'}
        onclick={() => updateUnit('gal')}
      >
        Gallons
      </button>
      <button
        type="button"
        class="toggle-pill flex-1"
        class:active={prefs.defaultVolumeUnit === 'L'}
        class:inactive={prefs.defaultVolumeUnit !== 'L'}
        onclick={() => updateUnit('L')}
      >
        Liters
      </button>
    </div>
  </label>

  <label class="field">
    <span class="field-label">Default currency</span>
    <select
      class="field-input"
      bind:value={prefs.defaultCurrency}
      onchange={() => updateCurrency(prefs.defaultCurrency)}
    >
      <option>USD</option>
      <option>CAD</option>
      <option>EUR</option>
      <option>GBP</option>
      <option>MXN</option>
    </select>
  </label>

  <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="field-label">Odometer prefill</div>
        <div class="text-xs text-zinc-500 mt-1">Open form with last reading filled in</div>
      </div>
      <div class="flex bg-zinc-800 rounded-xl p-1 shrink-0" style="width: 96px;">
        <button
          type="button"
          class="toggle-pill flex-1"
          class:active={prefs.odometerPrefillEnabled}
          class:inactive={!prefs.odometerPrefillEnabled}
          onclick={() => updatePrefillEnabled(true)}
        >On</button>
        <button
          type="button"
          class="toggle-pill flex-1"
          class:active={!prefs.odometerPrefillEnabled}
          class:inactive={prefs.odometerPrefillEnabled}
          onclick={() => updatePrefillEnabled(false)}
        >Off</button>
      </div>
    </div>

    <label class="field">
      <span class="field-label">Quick increment (mi)</span>
      <input
        class="field-input"
        type="number"
        inputmode="numeric"
        min="0"
        step="1"
        bind:value={prefs.odometerIncrementMi}
        onchange={(e) => updateIncrement((e.currentTarget as HTMLInputElement).value)}
      />
      <span class="text-xs text-zinc-500 mt-2 leading-relaxed">
        Adds this many miles when you tap the chip below the odometer field. Set to 0 to hide the chip.
      </span>
    </label>
  </div>

  <p class="text-xs text-zinc-500">
    Server converts to the LubeLogger-configured target unit and currency before
    posting. These prefs only affect form defaults.
  </p>
</div>
