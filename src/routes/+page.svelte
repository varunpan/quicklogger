<script lang="ts">
  import { goto } from '$app/navigation';
  import { loadPrefs, savePrefs } from '$lib/client/prefs';
  import { Queue } from '$lib/client/idb';
  import { submitFuelup, getFx } from '$lib/client/api';
  import type { Vehicle } from '$lib/server/lubelogger';
  import type { VolumeUnit, FuelSubmissionInput } from '$lib/shared/types';

  let { data } = $props();
  const prefs = loadPrefs();

  // form state — Svelte 5 runes
  let vehicle: Vehicle | null = $state(data.initialVehicle);
  let odometer: string = $state('');
  let isoDate: string = $state(new Date().toISOString().slice(0, 10));
  let volume: string = $state(data.prefill.volume ?? '');
  let volumeUnit: VolumeUnit = $state(
    (data.prefill.volumeUnit as VolumeUnit) ?? prefs.defaultVolumeUnit
  );
  let cost: string = $state(data.prefill.cost ?? '');
  let currency: string = $state(data.prefill.currency ?? prefs.defaultCurrency);
  let isFillToFull: boolean = $state(data.prefill.fillToFull !== 'false');
  let missedFuelup: boolean = $state(false);
  let extrasOpen: boolean = $state(false);
  let notes: string = $state('');
  let manualFxRate: string = $state('');
  let needsManualFx: boolean = $state(false);
  let submitting: boolean = $state(false);
  let toast: { kind: 'success' | 'queued' | 'error'; text: string } | null = $state(null);

  const TARGET_CURRENCY = 'USD'; // server enforces; this is just for the UI hint

  // live FX rate for inline preview
  let fxRate: number | null = $state(null);
  let fxStale: boolean = $state(false);

  $effect(() => {
    if (!currency || currency === TARGET_CURRENCY) {
      fxRate = 1;
      fxStale = false;
      needsManualFx = false;
      return;
    }
    getFx(currency, TARGET_CURRENCY).then((r) => {
      if ('available' in r) {
        fxRate = null;
        fxStale = false;
        needsManualFx = true;
      } else {
        fxRate = r.rate;
        fxStale = r.stale;
        needsManualFx = false;
        manualFxRate = '';
      }
    }).catch(() => {
      fxRate = null;
    });
  });

  // derived previews
  const previewGallons = $derived.by(() => {
    const v = Number(volume);
    if (!Number.isFinite(v) || v <= 0) return null;
    return volumeUnit === 'gal' ? v : v / 3.785411784;
  });

  const previewUsd = $derived.by(() => {
    const c = Number(cost);
    if (!Number.isFinite(c) || c <= 0) return null;
    const rate = manualFxRate ? Number(manualFxRate) : fxRate;
    if (!rate) return null;
    return currency === TARGET_CURRENCY ? c : c * rate;
  });

  const mpgPreview = $derived.by(() => {
    if (!data.lastFuelup) return null;
    const od = Number(odometer);
    const last = Number(data.lastFuelup.odometer);
    const gal = previewGallons;
    if (!Number.isFinite(od) || !Number.isFinite(last) || gal === null) return null;
    const delta = od - last;
    if (delta <= 0) return null;
    return delta / gal;
  });

  // /vehicles route is stood up in Task 20. Until then, route into it via a string-typed
  // intermediate so the typed-routes RouteId union doesn't reject the literal.
  function navigateToVehicles(): void {
    const path: string = '/vehicles';
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    goto(path);
  }

  function genUuid(): string {
    const c = globalThis.crypto;
    if (c && 'randomUUID' in c) return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function submit() {
    if (!vehicle) return;
    submitting = true;
    toast = null;

    const input: FuelSubmissionInput = {
      vehicleId: vehicle.id,
      date: isoDate,
      odometer: Number(odometer),
      volume: Number(volume),
      volumeUnit,
      cost: Number(cost),
      currency,
      isFillToFull,
      missedFuelup,
      notes: notes || undefined,
      manualFxRate: manualFxRate ? Number(manualFxRate) : undefined,
      clientSubmissionId: genUuid()
    };

    try {
      const result = await submitFuelup(input);
      toast = {
        kind: 'success',
        text: `Logged: ${result.submitted.gallons.toFixed(2)} gal · $${result.submitted.cost.toFixed(2)}`
      };
      savePrefs({
        lastVehicleId: vehicle.id,
        defaultVolumeUnit: volumeUnit,
        defaultCurrency: currency
      });
      // reset volatile fields
      odometer = '';
      volume = '';
      cost = '';
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        toast = { kind: 'error', text: `Submission rejected: ${(err as Error).message}` };
      } else {
        // queue
        const q = await Queue.open();
        await q.enqueue(input);
        toast = { kind: 'queued', text: 'Saved locally — will sync when online' };
      }
    } finally {
      submitting = false;
    }
  }
</script>

{#if !vehicle}
  <div class="rounded-xl bg-zinc-900 p-4 text-center text-zinc-400">
    No vehicles found. Add one in LubeLogger first.
  </div>
{:else}
  <button
    type="button"
    class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full"
    onclick={() => navigateToVehicles()}
  >
    <div class="w-12 h-12 rounded-lg bg-zinc-700 shrink-0 flex items-center justify-center text-zinc-500">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 17h14M5 17v-5l2-5h10l2 5v5M5 17H3M19 17h2M7 12h10" />
        <circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" />
      </svg>
    </div>
    <div class="text-left flex-1 min-w-0">
      <div class="field-label">Vehicle</div>
      <div class="text-base font-semibold truncate">
        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
      </div>
    </div>
    <span class="text-zinc-500" aria-hidden="true">›</span>
  </button>

  <div class="grid grid-cols-2 gap-2 mb-3">
    <label class="field">
      <span class="field-label">Odometer</span>
      <input class="field-input" type="number" inputmode="numeric"
             bind:value={odometer} placeholder="87,432" />
    </label>
    <label class="field">
      <span class="field-label">Date</span>
      <input class="field-input text-base" type="date" bind:value={isoDate} />
    </label>
  </div>

  <label class="field mb-3">
    <span class="field-label">Volume</span>
    <div class="flex gap-1">
      <input class="field-input" type="number" inputmode="decimal" step="0.01"
             bind:value={volume} placeholder="11.2" />
      <div class="flex bg-zinc-800 rounded-xl p-1">
        <button type="button" class="toggle-pill" class:active={volumeUnit === 'gal'} class:inactive={volumeUnit !== 'gal'}
                onclick={() => (volumeUnit = 'gal')}>gal</button>
        <button type="button" class="toggle-pill" class:active={volumeUnit === 'L'} class:inactive={volumeUnit !== 'L'}
                onclick={() => (volumeUnit = 'L')}>L</button>
      </div>
    </div>
  </label>

  <label class="field mb-3">
    <span class="field-label">Cost</span>
    <div class="flex gap-1">
      <input class="field-input" type="number" inputmode="decimal" step="0.01"
             bind:value={cost} placeholder="42.18" />
      <div class="flex bg-zinc-800 rounded-xl p-1 min-w-[72px]">
        <select
          class="bg-transparent rounded-lg px-3 text-xs font-semibold text-zinc-100 outline-none cursor-pointer w-full appearance-none text-center"
          bind:value={currency}
          aria-label="Currency"
        >
          <option>USD</option>
          <option>CAD</option>
          <option>EUR</option>
          <option>GBP</option>
          <option>MXN</option>
        </select>
      </div>
    </div>
  </label>

  {#if needsManualFx}
    <label class="field mb-3">
      <span class="field-label">FX rate (1 {currency} = ? USD) — entered manually because rate sources are unreachable</span>
      <input class="field-input" type="number" inputmode="decimal" step="0.0001"
             bind:value={manualFxRate} placeholder="0.73" />
    </label>
  {/if}

  <div class="grid grid-cols-2 gap-2 mb-3">
    <button type="button"
            class="rounded-xl py-2 text-sm font-semibold"
            class:bg-blue-600={isFillToFull}
            class:text-white={isFillToFull}
            class:bg-zinc-800={!isFillToFull}
            class:text-zinc-400={!isFillToFull}
            onclick={() => (isFillToFull = !isFillToFull)}>
      {isFillToFull ? '✓ Fill to full' : 'Fill to full'}
    </button>
    <button type="button"
            class="rounded-xl py-2 text-sm font-semibold"
            class:bg-blue-600={missedFuelup}
            class:text-white={missedFuelup}
            class:bg-zinc-800={!missedFuelup}
            class:text-zinc-400={!missedFuelup}
            onclick={() => (missedFuelup = !missedFuelup)}>
      {missedFuelup ? '✓ Missed fillup' : 'Missed fillup'}
    </button>
  </div>

  <button type="button"
          class="border border-dashed border-zinc-600 hover:border-zinc-500 rounded-xl px-4 py-3 text-sm text-zinc-300 mb-3 w-full text-left transition-colors"
          onclick={() => (extrasOpen = !extrasOpen)}>
    {extrasOpen ? '− Hide note · station · grade' : '+ Add note · station · grade'}
  </button>
  {#if extrasOpen}
    <label class="field mb-3">
      <span class="field-label">Note</span>
      <input class="field-input text-sm" type="text" bind:value={notes}
             placeholder="Costco Pump 4, regular grade" />
    </label>
  {/if}

  {#if previewUsd !== null && previewGallons !== null}
    <div class="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300 mb-3">
      Will log: {previewGallons.toFixed(2)} gal · ${previewUsd.toFixed(2)} USD
      {#if mpgPreview !== null}
        &nbsp;·&nbsp; {mpgPreview.toFixed(1)} MPG since last fill
      {/if}
      {#if fxStale}
        &nbsp;·&nbsp; <span class="text-amber-300">FX rate is stale</span>
      {/if}
    </div>
  {/if}

  <button type="button"
          disabled={submitting || !odometer || !volume || !cost}
          class="bg-blue-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl py-4 text-base font-semibold text-white w-full"
          onclick={submit}>
    {submitting ? 'Logging…' : 'Log fillup'}
  </button>

  {#if toast}
    <div class="mt-4 rounded-xl px-4 py-3 text-sm"
         class:bg-emerald-600={toast.kind === 'success'}
         class:bg-amber-600={toast.kind === 'queued'}
         class:bg-rose-600={toast.kind === 'error'}>
      {toast.text}
    </div>
  {/if}
{/if}
