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

  function saveShortcutUrl() {
    const trimmed = (prefs.siriShortcutUrl ?? '').trim();
    const value = trimmed.length === 0 ? null : trimmed;
    prefs.siriShortcutUrl = value;
    savePrefs({ siriShortcutUrl: value });
  }

  function isLikelyValidIcloudUrl(u: string | null): boolean {
    if (!u) return false;
    try {
      const url = new URL(u);
      return url.hostname.endsWith('icloud.com') && url.pathname.startsWith('/shortcuts/');
    } catch {
      return false;
    }
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

  <hr class="border-zinc-800" />

  <section class="flex flex-col gap-2">
    <h2 class="text-sm font-semibold text-zinc-200">Siri shortcut</h2>
    <p class="text-xs text-zinc-500">
      Build the shortcut on this iPhone (see
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href="https://github.com/varunpan/quicklogger/blob/main/docs/shortcuts.md" class="text-blue-400 underline">docs/shortcuts.md</a>)
      and publish via Shortcuts app → Share → Copy iCloud Link. Paste the link
      below to install on future devices in one tap.
    </p>

    <label class="field">
      <span class="field-label">iCloud share URL</span>
      <input
        class="field-input text-sm"
        type="url"
        inputmode="url"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="https://www.icloud.com/shortcuts/..."
        bind:value={prefs.siriShortcutUrl}
        onblur={saveShortcutUrl}
      />
    </label>

    {#if isLikelyValidIcloudUrl(prefs.siriShortcutUrl)}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href={prefs.siriShortcutUrl}
        class="bg-blue-600 text-white rounded-xl py-3 text-base font-semibold text-center w-full"
      >
        Install Siri Shortcut on this iPhone
      </a>
    {:else if prefs.siriShortcutUrl && prefs.siriShortcutUrl.trim().length > 0}
      <p class="text-xs text-amber-400">
        That doesn't look like an icloud.com/shortcuts/ link. Paste the URL from
        Shortcuts app → Share → Copy iCloud Link.
      </p>
    {/if}
  </section>
</div>
