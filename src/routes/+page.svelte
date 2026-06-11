<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { loadPrefs, savePrefs } from '$lib/client/prefs';
  import { Queue } from '$lib/client/idb';
  import { submitFuelup, submitFuelupWithPhotos, getFx, postOcr } from '$lib/client/api';
  import { resizeForOcr } from '$lib/client/image';
  import { bufferPickedPhoto, type BufferedPhoto } from '$lib/client/photo-buffer';
  import type { Vehicle } from '$lib/server/lubelogger';
  import type {
    VolumeUnit,
    FuelSubmissionInput,
    OcrPumpResult,
    OcrOdometerResult,
    OcrMode
  } from '$lib/shared/types';
  import { formatOdometer, formatLastFillupDate, formatCost } from '$lib/client/format';
  import { loadServerInfo } from '$lib/client/server-info';
  import { loadDismissedUpdateVersion, saveDismissedUpdateVersion } from '$lib/client/dismissed-update';
  import {
    evaluateSmartChecks,
    ODOMETER_MAX_DELTA_MI,
    type SmartCheckIssue,
    type LastFuelupForCheck
  } from '$lib/client/smart-checks';
  import OcrPreview from '$lib/client/OcrPreview.svelte';
  import VehicleImage from '$lib/client/VehicleImage.svelte';
  import { readPhotoDate, interpretPhotoDate, formatLocalDate } from '$lib/client/exif';
  import type { Rotation, NormalizedRect } from '$lib/client/image';

  let { data } = $props();
  const prefs = loadPrefs();

  // Live connectivity for the offline banner + submit-button label. Initialized
  // from navigator.onLine so an offline cold-start paints the banner with no
  // flash; updated live on the window online/offline events. Home route only.
  let online = $state(browser ? navigator.onLine : true);
  onMount(() => {
    const goOnline = () => (online = true);
    const goOffline = () => (online = false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  });

  // --- self-update banner (v0.2.3+) — reader-only off the cached ServerInfo,
  // mirroring the Settings block. Boot-refresh in +layout.svelte keeps the
  // cache fresh; this paints whatever the cache holds at load.
  const _appInfo = loadServerInfo();
  const appLatestVersion = _appInfo?.appLatestVersion ?? null;
  const appReleaseUrl = _appInfo?.appReleaseUrl ?? null;
  const appUpdateAvailable = _appInfo?.appUpdateAvailable ?? false;
  let dismissedUpdateVersion = $state(loadDismissedUpdateVersion());
  const showUpdateBanner = $derived(
    appUpdateAvailable && appLatestVersion !== null && appLatestVersion !== dismissedUpdateVersion
  );
  function dismissUpdateBanner() {
    if (!appLatestVersion) return;
    saveDismissedUpdateVersion(appLatestVersion);
    dismissedUpdateVersion = appLatestVersion;
  }

  // form state — Svelte 5 runes
  let vehicle: Vehicle | null = $state(data.initialVehicle);
  // Initialize from last fillup when prefill is on (Decision 2 / 8). Stored
  // as raw digits because the input is type="number" and can't render
  // thousands separators — the formatted version lives in the strip only.
  function initialOdometer(): string {
    if (!prefs.odometerPrefillEnabled) return '';
    if (!data.lastFuelup) return '';
    const n = Number(data.lastFuelup.odometer);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n));
  }
  let odometer: string = $state(initialOdometer());
  let odometerEdited: boolean = $state(false);
  let isoDate: string = $state(new Date().toISOString().slice(0, 10));
  let volume: string = $state(data.prefill.volume ?? '');
  let volumeUnit: VolumeUnit = $state(
    (data.prefill.volumeUnit as VolumeUnit) ?? prefs.defaultVolumeUnit
  );
  let cost: string = $state(data.prefill.cost ?? '');
  let currency: string = $state(data.prefill.currency ?? prefs.defaultCurrency);
  let isFillToFull: boolean = $state(data.prefill.fillToFull !== 'false');
  let missedFuelup: boolean = $state(false);
  let notes: string = $state('');
  let manualFxRate: string = $state('');
  let needsManualFx: boolean = $state(false);
  let submitting: boolean = $state(false);
  let toast: { kind: 'success' | 'queued' | 'error' | 'warning'; text: string } | null = $state(null);

  // --- Photo OCR state (v0.2.0+) ---

  type OdoWarn = { detected: number; reason: 'lower' | 'too-high' };

  let pumpOcrPending: boolean = $state(false);
  let pumpSuggestion: OcrPumpResult | null = $state(null);
  let pumpCameraInput: HTMLInputElement | undefined = $state();

  // Photo-date prefill cue. 'set' / 'missing' chip variants per the spec.
  let photoDateCue: 'set' | 'missing' | null = $state(null);
  let photoDatePickSeq = 0; // last-write-wins for racing readPhotoDate calls

  let odoOcrPending: boolean = $state(false);
  let odoSuggestion: OcrOdometerResult | null = $state(null);
  let odoWarning: OdoWarn | null = $state(null);
  let odoCameraInput: HTMLInputElement | undefined = $state();

  // Preview screen state — set when the user picks/captures a file,
  // cleared when they Cancel, Retake (after the input re-fires), or Send.
  type PendingCapture = { file: File; mode: OcrMode };
  let pendingCapture: PendingCapture | null = $state(null);

  // --- Attach OCR photo to the record (v0.2.6) ---
  // Exact bytes sent to /api/ocr this session, retained in client memory only
  // (never persisted — attach is online-only). Latest send of each mode wins.
  let attachPumpBlob: Blob | null = $state(null);
  let attachOdometerBlob: Blob | null = $state(null);
  let attachPhotos: boolean = $state(true);

  const attachLabel = $derived(
    attachPumpBlob && attachOdometerBlob
      ? 'Attach photos to this record'
      : 'Attach photo to this record'
  );
  const attachSubLabel = $derived(
    attachPumpBlob && attachOdometerBlob
      ? 'Pump & odometer photos from this session'
      : attachPumpBlob
        ? 'Pump display photo from this session'
        : 'Odometer photo from this session'
  );

  // --- Smart checks state (v0.2.0) ---
  let smartCheckIssues: SmartCheckIssue[] = $state([]);

  // After locale-invariant-parsing the wire date is already ISO YYYY-MM-DD.
  // Helper survives as a defensive validator: caller wants a clean ISO or null.
  function lubeDateToIso(s: string): string | null {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  function lastFuelupForCheck(): LastFuelupForCheck | null {
    if (!data.lastFuelup) return null;
    const odo = Number(data.lastFuelup.odometer);
    const iso = lubeDateToIso(data.lastFuelup.date);
    if (!Number.isFinite(odo) || !iso) return null;
    return { odometer: odo, date: iso };
  }

  function clearSmartCheckIssues() {
    if (smartCheckIssues.length > 0) smartCheckIssues = [];
  }

  function pumpModeEnabled(): boolean {
    return data.ocrEnabled && data.ocrModes.includes('pump' as OcrMode);
  }
  function odoModeEnabled(): boolean {
    return data.ocrEnabled && data.ocrModes.includes('odometer' as OcrMode);
  }

  function openPumpCamera() {
    pumpSuggestion = null;
    attachPumpBlob = null;   // a fresh capture/retake supersedes retained pump bytes
    pumpCameraInput?.click();
  }
  function openOdoCamera() {
    odoSuggestion = null;
    odoWarning = null;
    attachOdometerBlob = null;
    odoCameraInput?.click();
  }

  function ocrErrorToast(err: unknown): { kind: 'error'; text: string } {
    const e = err as Error & { status?: number; retryAfter?: number; serverError?: string };
    const s = e.status;
    if (s === 0) return { kind: 'error', text: 'OCR took too long — please type values' };
    if (s === 429) {
      const ra = e.retryAfter ?? 60;
      return { kind: 'error', text: `OCR rate limit reached, try again in ${ra}s` };
    }
    if (s === 400) {
      return { kind: 'error', text: e.serverError ? `OCR rejected photo: ${e.serverError}` : 'OCR rejected photo' };
    }
    if (s === 402) return { kind: 'error', text: 'OCR budget for today reached' };
    if (s === 413) return { kind: 'error', text: 'Photo too large — try again' };
    if (s === 415) return { kind: 'error', text: "Couldn't read image — try a clearer photo" };
    if (s === 422) return { kind: 'error', text: "Couldn't read clearly — try again or type manually" };
    if (s === 502 || s === 503) return { kind: 'error', text: 'OCR service unreachable — please type values' };
    return { kind: 'error', text: `OCR failed (${s ?? 'network'})` };
  }

  async function handlePumpCamera(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = '';
    if (!picked) return;
    const buf = await bufferPickedPhotoOrToast(picked);
    if (!buf) return;
    pendingCapture = { file: buf.ocrFile, mode: 'pump' };
    // EXIF prefill runs on an INDEPENDENT copy (`exifFile`) so reading it for
    // the date never touches the OCR File's backing store. Sharing one File
    // between the two paths is what produced the "multipart parse failed" 400
    // in Safari — see src/lib/client/photo-buffer.ts.
    void prefillDateFromPhoto(buf.exifFile);
  }

  // Thin wrapper around bufferPickedPhoto that surfaces the "couldn't read"
  // toast on a degenerate pick (null) or an arrayBuffer rejection (throw),
  // keeping the toast (component state) out of the pure helper module.
  async function bufferPickedPhotoOrToast(picked: File): Promise<BufferedPhoto | null> {
    let buf: BufferedPhoto | null;
    try {
      buf = await bufferPickedPhoto(picked);
    } catch {
      buf = null;
    }
    if (!buf) toast = { kind: 'error', text: "Couldn't read photo — try again" };
    return buf;
  }

  // EXIF read + state-machine apply. Errors (parser throws, file deleted
  // between pick and read, etc.) collapse to the 'missing' cue — never
  // affects the parallel OCR pipeline.
  async function prefillDateFromPhoto(file: File) {
    const seq = ++photoDatePickSeq;
    try {
      const photoDate = await readPhotoDate(file);
      if (seq !== photoDatePickSeq) return; // a newer pick won
      const today = formatLocalDate(new Date());
      const result = interpretPhotoDate(photoDate, today);
      if (result.newIsoDate !== undefined) isoDate = result.newIsoDate;
      photoDateCue = result.cue;
    } catch {
      if (seq !== photoDatePickSeq) return;
      photoDateCue = 'missing';
    }
  }

  async function handleOdoCamera(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = '';
    if (!picked) return;
    const buf = await bufferPickedPhotoOrToast(picked);
    if (!buf) return;
    pendingCapture = { file: buf.ocrFile, mode: 'odometer' };
  }

  function checkOdometerRelative(
    detected: number
  ): { ok: true } | OdoWarn {
    if (!data.lastFuelup) return { ok: true };
    const last = Number(data.lastFuelup.odometer);
    if (!Number.isFinite(last) || last <= 0) return { ok: true };
    if (detected < last) return { detected, reason: 'lower' };
    if (detected - last > ODOMETER_MAX_DELTA_MI) return { detected, reason: 'too-high' };
    return { ok: true };
  }

  async function runOcr(file: File, mode: OcrMode, rotation: Rotation, crop: NormalizedRect | null) {
    if (mode === 'pump') {
      pumpOcrPending = true;
    } else {
      odoOcrPending = true;
    }
    toast = null;
    try {
      const blob = await resizeForOcr(file, { rotation, crop });
      // Retain the EXACT bytes sent to OCR so submit can attach them. Set on
      // send (not on success) — a misread photo is still worth attaching.
      // Latest send of each mode replaces the slot.
      if (mode === 'pump') attachPumpBlob = blob;
      else attachOdometerBlob = blob;
      // Per-mode soft sanity-check hints baked into the prompt. Each
      // mode reads only its own field — pump ignores lastOdoHint,
      // odometer ignores lastPriceHint. Both are best-effort: we send
      // the hint when the prior fillup parses cleanly, and the server
      // is defensive about garbage anyway.
      //
      // Odometer: UAT surfaced that small open-source models
      // (qwen2.5vl:7b @ Q4_K_M) reliably drop the leading digit on
      // 6+-digit readings; the hint anchors them on a known-recent
      // ballpark.
      //
      // Pump: three close-magnitude decimal numbers on the same
      // panel (cost / volume / price-per-unit) are easy for the model
      // to swap, and US pumps use fractional cents. The hint is
      // derived as cost / fuelConsumed and is currency-unit-agnostic
      // on purpose — `lastFuelup.cost` is FX-normalized to USD for
      // upstream rows but in entered currency for offline-queue rows,
      // and the pump itself may read gal or L. The model uses the
      // magnitude as a sanity check, not as a unit-locked anchor.
      let lastOdoHint: number | undefined;
      let lastPriceHint: number | undefined;
      if (mode === 'odometer' && data.lastFuelup) {
        const candidate = Number(data.lastFuelup.odometer);
        if (Number.isFinite(candidate) && candidate > 0) lastOdoHint = candidate;
      }
      if (mode === 'pump' && data.lastFuelup && data.lastFuelup.cost != null) {
        const cost = Number(data.lastFuelup.cost);
        const gallons = Number(data.lastFuelup.fuelConsumed);
        if (
          Number.isFinite(cost) && cost > 0 &&
          Number.isFinite(gallons) && gallons > 0
        ) {
          lastPriceHint = cost / gallons;
        }
      }
      const result = await postOcr(blob, mode, rotation, crop, lastOdoHint, lastPriceHint, data.ocrChainTimeoutMs);
      if (result.mode === 'pump') {
        pumpSuggestion = result;
      } else if (result.mode === 'odometer') {
        const check = checkOdometerRelative(result.odometer);
        if ('ok' in check) {
          odoSuggestion = result;
          odoWarning = null;
        } else {
          odoSuggestion = null;
          odoWarning = check;
        }
      }
    } catch (err) {
      toast = ocrErrorToast(err);
    } finally {
      // Narrow to the originating mode so concurrent OCR (a future change)
      // wouldn't have one completion clear the other's spinner.
      if (mode === 'pump') pumpOcrPending = false;
      else odoOcrPending = false;
    }
  }

  function previewSubmit({ rotation, crop }: { rotation: Rotation; crop: NormalizedRect | null }) {
    if (!pendingCapture) return;
    const { file, mode } = pendingCapture;
    pendingCapture = null;
    void runOcr(file, mode, rotation, crop);
  }

  function previewCancel() {
    pendingCapture = null;
  }

  function previewRetake() {
    if (!pendingCapture) return;
    const mode = pendingCapture.mode;
    pendingCapture = null;
    // Re-open the originating file input. A synchronous .click() from
    // inside the modal-unmount frame is dropped silently on iOS Safari;
    // queueMicrotask defers it to the next task once the modal is gone.
    queueMicrotask(() => {
      if (mode === 'pump') pumpCameraInput?.click();
      else odoCameraInput?.click();
    });
  }

  function applyPumpOcr() {
    if (!pumpSuggestion) return;
    volume = String(pumpSuggestion.volume);
    volumeUnit = pumpSuggestion.volumeUnit;
    cost = String(pumpSuggestion.cost);
    pumpSuggestion = null;
  }
  function discardPumpOcr() { pumpSuggestion = null; }

  function applyOdoOcr() {
    if (!odoSuggestion) return;
    odometer = String(Math.round(odoSuggestion.odometer));
    odometerEdited = true;
    odoSuggestion = null;
  }
  function discardOdoOcr() { odoSuggestion = null; }
  function dismissOdoWarning() { odoWarning = null; }
  function useOdoWarning() {
    if (!odoWarning) return;
    odometer = String(Math.round(odoWarning.detected));
    odometerEdited = true;
    odoWarning = null;
  }

  // Mirror server-side FX target — server converts submission to env.lubeloggerCurrency.
  // Cached from /api/server-info; fallback to USD when cache is empty (first boot).
  const TARGET_CURRENCY = loadServerInfo()?.lubeloggerCurrency ?? 'USD';

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
    // Sequence concurrent lookups. A rapid currency switch (USD→CAD→EUR) fires
    // one effect run each and the responses can resolve out of order; without a
    // guard, CAD's late response would overwrite the rate/flags while the select
    // already shows EUR. The cleanup flag marks a superseded run stale so only
    // the currently-selected currency's response can apply. Mirrors the
    // photoDatePickSeq guard in prefillDateFromPhoto.
    let stale = false;
    getFx(currency, TARGET_CURRENCY).then((r) => {
      if (stale) return;
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
      if (stale) return;
      // The rate source is unreachable: offline (getFx sees the SW's synthetic
      // 504 and throws) or a transient error that isn't the deliberate 503.
      // Offer the manual-rate field — the same affordance as the 503/
      // {available:false} branch — so an offline foreign-currency fillup can
      // still pin a rate. Matches the field's own "rate sources are
      // unreachable" label.
      fxRate = null;
      fxStale = false;
      needsManualFx = true;
    });
    return () => {
      stale = true;
    };
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

  // Submit gate — every fuelup must have all four required fields with
  // sensible non-zero values. Server enforces the same; this keeps the
  // button visibly disabled so the user knows what's still missing.
  const canSubmit = $derived.by(() => {
    if (submitting) return false;
    if (!isoDate) return false;
    const od = Number(odometer);
    const vol = Number(volume);
    const c = Number(cost);
    return Number.isFinite(od) && od > 0
        && Number.isFinite(vol) && vol > 0
        && Number.isFinite(c) && c > 0;
  });

  // Per-tank delta shown under the odometer field once the user has interacted.
  const odometerDelta = $derived.by(() => {
    if (!odometerEdited || !data.lastFuelup) return null;
    const od = Number(odometer);
    const last = Number(data.lastFuelup.odometer);
    if (!Number.isFinite(od) || !Number.isFinite(last)) return null;
    return od - last;
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

  function bumpOdometer(): void {
    const current = Number(odometer || 0);
    const safe = Number.isFinite(current) ? current : 0;
    odometer = String(safe + prefs.odometerIncrementMi);
    odometerEdited = true;
  }

  async function submit(skipSmartChecks: boolean = false) {
    if (!vehicle) return;

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

    if (!skipSmartChecks) {
      const result = evaluateSmartChecks(
        {
          odometer: input.odometer,
          volume: input.volume,
          volumeUnit: input.volumeUnit,
          date: input.date
        },
        lastFuelupForCheck(),
        { smartChecksEnabled: prefs.smartChecksEnabled }
      );
      if (result.issues.length > 0) {
        smartCheckIssues = result.issues;
        return;
      }
    }

    // Attach is requested only when the checkbox is on AND we actually have
    // bytes to send. Computed once: drives both the submit branch and the
    // offline toast copy.
    const wantsAttach = attachPhotos && (attachPumpBlob !== null || attachOdometerBlob !== null);

    submitting = true;
    toast = null;

    try {
      const result = wantsAttach
        ? await submitFuelupWithPhotos(input, { pump: attachPumpBlob, odometer: attachOdometerBlob })
        : await submitFuelup(input);
      toast = result.photoWarning
        ? { kind: 'warning', text: "Logged — but the photo couldn't be attached." }
        : {
            kind: 'success',
            text: `Logged: ${result.submitted.gallons.toFixed(2)} Gal · ${formatCost(result.submitted.cost, null)}`
          };
      savePrefs({ lastVehicleId: vehicle.id });
      try {
        const q = await Queue.open();
        await q.enqueue(input, 'synced');
      } catch {
        // IDB unavailable (private mode, quota); ignore.
      }
      // Reset the form, THEN navigate. Previously these ~12 writes ran *after*
      // a fire-and-forget goto, landing on a component already navigating away
      // (and leaving the goto rejection unhandled). Running them first keeps
      // them on the live component; the toast set above stays visible through
      // the maintenance load (SvelteKit keeps this page mounted until that
      // load resolves). The .catch() drops the unhandled-rejection risk
      // without routing a navigation failure into the offline-enqueue branch.
      odometer = initialOdometer();
      odometerEdited = false;
      volume = '';
      cost = '';
      pumpSuggestion = null;
      photoDateCue = null;
      photoDatePickSeq++; // invalidate any in-flight readPhotoDate
      odoSuggestion = null;
      odoWarning = null;
      smartCheckIssues = [];
      attachPumpBlob = null;
      attachOdometerBlob = null;
      attachPhotos = true;   // default-on again; checkbox stays hidden until the next OCR send (blobs cleared)
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(`/maintenance?vehicleId=${vehicle.id}`).catch(() => {});
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        toast = { kind: 'error', text: `Submission rejected: ${(err as Error).message}` };
      } else {
        const q = await Queue.open();
        await q.enqueue(input);   // text-only — no image bytes ever enter IDB (online-only attach)
        toast = {
          kind: 'queued',
          text: wantsAttach ? 'Saved locally — photo not attached.' : 'Saved locally — will sync when online'
        };
      }
    } finally {
      submitting = false;
    }
  }

  function submitAnyway() {
    smartCheckIssues = [];
    void submit(true);
  }
</script>

{#if !online}
  <div role="status" data-testid="offline-banner" class="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 mb-4 flex items-start gap-2">
    <svg class="text-amber-300 mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
    <span class="text-sm text-amber-200 leading-relaxed">You're offline — this fill-up will be saved and synced when you reconnect.</span>
  </div>
{/if}

{#if showUpdateBanner}
  <div class="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 mb-4 flex items-center gap-3" data-testid="update-banner">
    <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
      <span class="text-sm font-medium text-amber-200">quicklogger v{appLatestVersion} available</span>
      {#if appReleaseUrl}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={appReleaseUrl} target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sm text-blue-400 active:text-blue-300" data-testid="banner-release-notes">
          Release notes
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 17L17 7" /><path d="M8 7h9v9" />
          </svg>
        </a>
      {/if}
    </div>
    <button type="button" class="p-1 -mr-1 text-amber-300/70 active:text-amber-200 shrink-0" aria-label="Dismiss" onclick={dismissUpdateBanner} data-testid="banner-dismiss">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
      </svg>
    </button>
  </div>
{/if}

{#if !vehicle}
  <div class="rounded-xl bg-zinc-900 p-4 text-center text-zinc-400">
    No vehicles found. Add one in LubeLogger first.
  </div>
{:else}
  {#if data.lastFuelup}
    <div class="text-xs text-zinc-500 mb-3 leading-relaxed">
      <div class="flex items-center gap-2">
        <span>Last fill: {formatOdometer(data.lastFuelup.odometer)} mi · {formatLastFillupDate(data.lastFuelup.date)}</span>
        {#if data.lastFuelupSource === 'offline'}
          <span class="text-[10px] uppercase tracking-wider font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">
            offline copy
          </span>
        {/if}
      </div>
      <div>
        {data.lastFuelup.fuelConsumed} Gal ·
        {#if data.lastFuelup.cost !== null}
          {formatCost(Number(data.lastFuelup.cost), data.lastFuelup.costCurrency)}
        {:else}
          —
        {/if}
        {#if data.lastFuelup.notes}
          · {data.lastFuelup.notes}
        {/if}
      </div>
    </div>
  {/if}
  <button
    type="button"
    class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full"
    onclick={() => navigateToVehicles()}
  >
    <VehicleImage vehicleId={vehicle.id} class="w-12 h-12" />
    <div class="text-left flex-1 min-w-0">
      <div class="field-label">Vehicle</div>
      <div class="text-base font-semibold truncate">
        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
      </div>
    </div>
    <span class="text-zinc-500" aria-hidden="true">›</span>
  </button>

  {#if pumpModeEnabled() || odoModeEnabled()}
    <div class="flex gap-2 mb-3">
      {#if pumpModeEnabled()}
        <button
          type="button"
          class="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-300 bg-blue-600/15 border border-blue-500/35 rounded-full px-3 py-2"
          aria-label="Read pump display from photo"
          onclick={openPumpCamera}
          disabled={pumpOcrPending}
        >
          {#if pumpOcrPending}
            <span class="inline-block w-3 h-3 rounded-full border-2 border-blue-300/30 border-t-blue-300 animate-spin" aria-hidden="true"></span>
            <span class="truncate">Reading photo…</span>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
            <span class="truncate">Pump display photo</span>
          {/if}
        </button>
        <input
          bind:this={pumpCameraInput}
          type="file"
          accept="image/*"
          class="hidden"
          onchange={handlePumpCamera}
        />
      {/if}
      {#if odoModeEnabled()}
        <button
          type="button"
          class="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-300 bg-blue-600/15 border border-blue-500/35 rounded-full px-3 py-2"
          aria-label="Read odometer from photo"
          onclick={openOdoCamera}
          disabled={odoOcrPending}
        >
          {#if odoOcrPending}
            <span class="inline-block w-3 h-3 rounded-full border-2 border-blue-300/30 border-t-blue-300 animate-spin" aria-hidden="true"></span>
            <span class="truncate">Reading photo…</span>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
            <span class="truncate">Odometer photo</span>
          {/if}
        </button>
        <input
          bind:this={odoCameraInput}
          type="file"
          accept="image/*"
          class="hidden"
          onchange={handleOdoCamera}
        />
      {/if}
    </div>

    {#if pumpSuggestion}
      <div class="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 mb-2" role="status">
        <div class="flex items-start gap-2">
          <svg class="text-blue-300 mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"/>
            <circle cx="12" cy="13" r="3.5"/>
          </svg>
          <div class="text-xs text-blue-200 flex-1 leading-relaxed">
            <span class="text-blue-300/70">Detected:</span>
            <span class="font-semibold">{pumpSuggestion.volume} {pumpSuggestion.volumeUnit} · {formatCost(pumpSuggestion.cost, null)}</span>
            <span class="text-blue-300/70"> · {formatCost(pumpSuggestion.pricePerUnit, null)}/{pumpSuggestion.volumeUnit}</span>
          </div>
        </div>
        <div class="flex gap-2 mt-2 ml-6">
          <button type="button" class="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={applyPumpOcr}>Use</button>
          <button type="button" class="text-zinc-400 rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={discardPumpOcr}>Discard</button>
        </div>
      </div>
    {/if}

    {#if odoSuggestion}
      <div class="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 mb-2" role="status">
        <div class="flex items-start gap-2">
          <svg class="text-blue-300 mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"/>
            <circle cx="12" cy="13" r="3.5"/>
          </svg>
          <div class="text-xs text-blue-200 flex-1 leading-relaxed">
            <span class="text-blue-300/70">Detected:</span>
            <span class="font-semibold">{formatOdometer(String(odoSuggestion.odometer))} mi</span>
          </div>
        </div>
        <div class="flex gap-2 mt-2 ml-6">
          <button type="button" class="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={applyOdoOcr}>Use</button>
          <button type="button" class="text-zinc-400 rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={discardOdoOcr}>Discard</button>
        </div>
      </div>
    {/if}

    {#if odoWarning}
      <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mb-2" role="alert">
        <div class="flex items-start gap-2">
          <svg class="text-amber-300 mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
          </svg>
          <div class="text-xs text-amber-300 flex-1 leading-relaxed">
            <span class="font-semibold">Detected: {formatOdometer(String(odoWarning.detected))} mi</span> —
            {#if odoWarning.reason === 'lower'}
              lower than last fillup ({formatOdometer(String(data.lastFuelup?.odometer ?? ''))} mi).
            {:else}
              &gt; {formatOdometer(String(ODOMETER_MAX_DELTA_MI))} mi above last fillup ({formatOdometer(String(data.lastFuelup?.odometer ?? ''))} mi).
            {/if}
          </div>
        </div>
        <div class="flex gap-2 mt-2 ml-6">
          <button type="button" class="bg-amber-500/20 text-amber-200 border border-amber-500/40 rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={useOdoWarning}>Use anyway</button>
          <button type="button" class="text-zinc-400 rounded-lg px-3 py-1.5 text-xs font-semibold" onclick={dismissOdoWarning}>Dismiss</button>
        </div>
      </div>
    {/if}
  {/if}

  <div class="grid grid-cols-2 gap-2 mb-3">
    <div class="field min-w-0">
      <label for="odometer" class="field-label">Odometer</label>
      <div class="relative">
        <input id="odometer" class="field-input min-w-0" type="number" inputmode="numeric"
               bind:value={odometer}
               oninput={() => { odometerEdited = true; clearSmartCheckIssues(); }}
               class:text-zinc-400={!odometerEdited && odometer !== ''}
               placeholder="87,432" />
        {#if !odometerEdited && odometer !== ''}
          <span class="absolute top-1.5 right-2 text-[10px] uppercase tracking-wider font-semibold text-zinc-500 bg-zinc-700/60 px-1.5 py-0.5 rounded">
            prefilled
          </span>
        {/if}
      </div>
      {#if odometerDelta !== null}
        <div class="text-xs text-zinc-500 mt-1 px-1">
          <span class="text-blue-400 font-semibold">{odometerDelta > 0 ? '+' : ''}{odometerDelta} mi</span> this tank
        </div>
      {/if}
    </div>
    <label class="field min-w-0">
      <span class="field-label">Date</span>
      <input class="field-input min-w-0 appearance-none" type="date" bind:value={isoDate}
             oninput={() => { clearSmartCheckIssues(); photoDateCue = null; }} />
      {#if photoDateCue === 'set'}
        <div class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 mt-1 flex items-center gap-1.5" role="status" data-testid="photo-date-cue">
          <svg class="text-blue-300 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"/>
            <circle cx="12" cy="13" r="3.5"/>
          </svg>
          <span class="text-[11px] font-semibold text-blue-200">set from photo</span>
        </div>
      {:else if photoDateCue === 'missing'}
        <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 mt-1 flex items-center gap-1.5" role="status" data-testid="photo-date-cue">
          <svg class="text-amber-300 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
          </svg>
          <span class="text-[11px] font-semibold text-amber-300">no date in photo</span>
        </div>
      {/if}
    </label>
    {#if prefs.odometerPrefillEnabled && prefs.odometerIncrementMi > 0}
      <div class="col-span-2 flex flex-wrap gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 bg-blue-600/15 border border-blue-500/35 rounded-full px-3 py-1.5"
          onclick={bumpOdometer}
        >
          <span aria-hidden="true">↑</span>+{prefs.odometerIncrementMi} mi
        </button>
      </div>
    {/if}
  </div>

  <label class="field mb-3">
    <span class="field-label">Volume</span>
    <div class="flex gap-2">
      <input class="field-input min-w-0 flex-1" type="number" inputmode="decimal" step="0.01"
             bind:value={volume} oninput={clearSmartCheckIssues} placeholder="11.2" />
      <div class="flex bg-zinc-800 rounded-xl p-1 w-20 shrink-0">
        <button type="button" class="toggle-pill flex-1" class:active={volumeUnit === 'gal'} class:inactive={volumeUnit !== 'gal'}
                onclick={() => (volumeUnit = 'gal')}>Gal</button>
        <button type="button" class="toggle-pill flex-1" class:active={volumeUnit === 'L'} class:inactive={volumeUnit !== 'L'}
                onclick={() => (volumeUnit = 'L')}>L</button>
      </div>
    </div>
  </label>

  <label class="field mb-3">
    <span class="field-label">Cost</span>
    <div class="flex gap-2">
      <input class="field-input min-w-0 flex-1" type="number" inputmode="decimal" step="0.01"
             bind:value={cost} placeholder="42.18" />
      <div class="flex bg-zinc-800 rounded-xl p-1 w-20 shrink-0">
        <select
          class="bg-transparent rounded-lg text-xs font-semibold text-zinc-100 outline-none cursor-pointer w-full appearance-none text-center [text-align-last:center]"
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

  <label class="field mb-3">
    <span class="field-label">Note · station · grade</span>
    <input class="field-input text-sm" type="text" bind:value={notes}
           placeholder="Costco Pump 4, regular grade" />
  </label>

  {#if previewUsd !== null && previewGallons !== null}
    <!-- `previewUsd` is a legacy name — value is in env.lubeloggerCurrency, not always USD. -->
    <div class="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300 mb-3">
      Will log: {previewGallons.toFixed(2)} Gal · {formatCost(previewUsd, TARGET_CURRENCY)}
      {#if mpgPreview !== null}
        &nbsp;·&nbsp; {mpgPreview.toFixed(1)} MPG since last fill
      {/if}
      {#if fxStale}
        &nbsp;·&nbsp; <span class="text-amber-300">FX rate is stale</span>
      {/if}
    </div>
  {/if}

  {#if smartCheckIssues.length > 0}
    <div class="rounded-xl px-4 py-3 mb-3 border border-amber-500/30 bg-amber-500/15 text-amber-300 text-sm leading-relaxed" role="alert" data-testid="smart-check-chip">
      <div class="flex items-center gap-2 font-semibold mb-2">
        <span aria-hidden="true">⚠</span>
        <span>{smartCheckIssues.length} {smartCheckIssues.length === 1 ? 'issue' : 'issues'} found</span>
      </div>
      <ul class="list-disc pl-5 space-y-1 mb-3">
        {#each smartCheckIssues as issue (issue.code)}
          <li>{issue.message}</li>
        {/each}
      </ul>
      <button type="button"
              class="w-full rounded-lg py-2 px-3 text-sm font-semibold border border-amber-500/40 text-amber-200"
              onclick={submitAnyway}>
        Submit anyway
      </button>
    </div>
  {/if}

  {#if attachPumpBlob || attachOdometerBlob}
    <button type="button"
            aria-pressed={attachPhotos}
            class="flex items-center gap-3 w-full rounded-xl px-3 py-3 mb-3 bg-zinc-800/60 border border-zinc-700/60 text-left"
            onclick={() => (attachPhotos = !attachPhotos)}>
      {#if attachPhotos}
        <span class="w-5 h-5 rounded-md bg-blue-600 flex items-center justify-center shrink-0" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      {:else}
        <span class="w-5 h-5 rounded-md border-2 border-zinc-600 bg-transparent shrink-0" aria-hidden="true"></span>
      {/if}
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold" class:text-zinc-100={attachPhotos} class:text-zinc-300={!attachPhotos}>{attachLabel}</span>
        <span class="block text-xs text-zinc-500 mt-0.5">{attachSubLabel}</span>
      </span>
    </button>
  {/if}

  <button type="button"
          disabled={!canSubmit || smartCheckIssues.length > 0}
          class="bg-blue-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl py-4 text-base font-semibold text-white w-full"
          onclick={() => submit()}>
    {submitting ? 'Logging…' : online ? 'Log fillup' : 'Save offline'}
  </button>

  {#if pendingCapture}
    <OcrPreview
      file={pendingCapture.file}
      mode={pendingCapture.mode}
      onsubmit={previewSubmit}
      oncancel={previewCancel}
      onretake={previewRetake}
    />
  {/if}

  {#if toast}
    <div class="mt-4 rounded-xl px-4 py-3 text-sm"
         class:bg-emerald-600={toast.kind === 'success'}
         class:bg-amber-600={toast.kind === 'queued' || toast.kind === 'warning'}
         class:bg-rose-600={toast.kind === 'error'}>
      {toast.text}
    </div>
  {/if}
{/if}
