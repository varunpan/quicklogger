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

  <p class="text-xs text-zinc-500">
    Server converts to the LubeLogger-configured target unit and currency before
    posting. These prefs only affect form defaults.
  </p>
</div>
