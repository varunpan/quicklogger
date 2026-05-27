<script lang="ts">
  import { onMount } from 'svelte';
  import { loadPrefs, savePrefs } from '$lib/client/prefs';
  import { loadServerInfo, saveServerInfo } from '$lib/client/server-info';
  import type { ServerInfo, VolumeUnit } from '$lib/shared/types';

  let prefs = $state(loadPrefs());

  // Server-info SWR: paint the cached value instantly, fetch live on mount.
  let serverInfo = $state<ServerInfo | null>(loadServerInfo());
  let checking = $state(serverInfo === null);

  onMount(async () => {
    try {
      const res = await fetch('/api/server-info');
      if (res.ok) {
        const info = (await res.json()) as ServerInfo;
        serverInfo = info;
        saveServerInfo(info);
      }
    } catch {
      // /api/server-info normally returns 200 even when LubeLogger is down;
      // a throw here means quicklogger itself is unreachable. Keep any cached
      // value; the {:else} branch renders the unreachable state if there is none.
    } finally {
      checking = false;
    }
  });

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

  function updateSmartChecks(enabled: boolean) {
    prefs.smartChecksEnabled = enabled;
    savePrefs({ smartChecksEnabled: enabled });
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

  <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="field-label">Smart checks</div>
        <div class="text-xs text-zinc-500 mt-1 leading-relaxed">
          Warn before submitting fillups that look off — lower odometer
          than last, future date, tiny volume, etc.
        </div>
      </div>
      <div class="flex bg-zinc-800 rounded-xl p-1 shrink-0" style="width: 96px;">
        <button
          type="button"
          class="toggle-pill flex-1"
          class:active={prefs.smartChecksEnabled}
          class:inactive={!prefs.smartChecksEnabled}
          onclick={() => updateSmartChecks(true)}
        >On</button>
        <button
          type="button"
          class="toggle-pill flex-1"
          class:active={!prefs.smartChecksEnabled}
          class:inactive={prefs.smartChecksEnabled}
          onclick={() => updateSmartChecks(false)}
        >Off</button>
      </div>
    </div>
  </div>

  <div
    class="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3"
    data-testid="server-info"
  >
    <div class="field-label">LubeLogger server</div>

    {#if checking && !serverInfo}
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-zinc-600 shrink-0"></span>
          <span class="text-sm font-medium text-zinc-400">Checking…</span>
        </div>
        <span class="h-3 w-12 rounded bg-zinc-800"></span>
      </div>
    {:else if serverInfo?.status === 'ok'}
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
          <span class="text-sm font-medium text-zinc-200">Connected</span>
        </div>
        <span class="text-sm text-zinc-400 tabular-nums" data-testid="server-version"
          >v{serverInfo.currentVersion}</span
        >
      </div>
      {#if serverInfo.updateAvailable}
        <div class="flex items-center gap-2 text-xs text-zinc-400" data-testid="update-available">
          <span
            class="text-[10px] uppercase tracking-wider font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5"
            >Update available</span
          >
          <span class="tabular-nums">v{serverInfo.currentVersion} → v{serverInfo.latestVersion}</span>
        </div>
      {/if}
    {:else if serverInfo?.status === 'unauthorized'}
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
        <span class="text-sm font-medium text-zinc-200">API key rejected</span>
      </div>
      <p class="text-xs text-zinc-500 leading-relaxed">
        LubeLogger refused the API key. Check
        <span class="text-zinc-400 font-mono">LUBELOGGER_API_KEY</span>.
      </p>
    {:else}
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
        <span class="text-sm font-medium text-zinc-200">Can't reach LubeLogger</span>
      </div>
      <p class="text-xs text-zinc-500 leading-relaxed">
        No response from the server. It may be down, restarting, or unreachable from here.
      </p>
    {/if}
  </div>

  <p class="text-xs text-zinc-500">
    Server converts to the LubeLogger-configured target unit and currency before
    posting. These prefs only affect form defaults.
  </p>
</div>
