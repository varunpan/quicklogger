<script lang="ts">
  import type { Reminder, ReminderUrgency } from '$lib/server/lubelogger';
  import { formatOdometer, formatDueDate, humanCountdown } from '$lib/client/format';

  let { data } = $props();

  const URGENCY_ORDER: Record<ReminderUrgency, number> = {
    PastDue: 0,
    VeryUrgent: 1,
    Urgent: 2,
    NotUrgent: 3
  };

  // Pick the right countdown value for within-group sort. `Both` uses
  // min(days, distance) as a heuristic — comparing days to miles mixes
  // units, but the more-negative side correctly surfaces the more-overdue
  // reminder first within the Both subset.
  function sortValue(r: Reminder): number {
    const days = Number(r.dueDays);
    const dist = Number(r.dueDistance);
    if (r.userMetric === 'Date') return Number.isFinite(days) ? days : Infinity;
    if (r.userMetric === 'Odometer') return Number.isFinite(dist) ? dist : Infinity;
    const ds = Number.isFinite(days) ? days : Infinity;
    const di = Number.isFinite(dist) ? dist : Infinity;
    return Math.min(ds, di);
  }

  const visible = $derived.by(() => {
    return data.reminders
      .filter((r) => r.urgency !== 'NotUrgent')
      .slice()
      .sort((a, b) => {
        const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
        if (u !== 0) return u;
        return sortValue(a) - sortValue(b);
      });
  });

  const vehicleLabel = $derived.by(() => {
    const v = data.vehicle;
    if (!v) return '';
    return [v.year, v.make, v.model].filter(Boolean).join(' ');
  });

  function chipClasses(urgency: ReminderUrgency): string {
    switch (urgency) {
      case 'PastDue':
        return 'text-rose-300 bg-rose-500/15 border-rose-500/30';
      case 'VeryUrgent':
        return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
      case 'Urgent':
        return 'text-yellow-300 bg-yellow-500/15 border-yellow-500/30';
      default:
        return 'text-zinc-400 bg-zinc-700/30 border-zinc-700/40';
    }
  }

  function chipLabel(urgency: ReminderUrgency): string {
    switch (urgency) {
      case 'PastDue':
        return 'Past Due';
      case 'VeryUrgent':
        return 'Very Urgent';
      case 'Urgent':
        return 'Urgent';
      default:
        return urgency;
    }
  }

  function dateLine(r: Reminder): string {
    const date = formatDueDate(r.dueDate);
    const countdown = humanCountdown(r.dueDays, 'days');
    if (!countdown) return date ? `Due ${date}` : '';
    return date ? `Due ${date} · ${countdown}` : `Due ${countdown}`;
  }

  function odometerLine(r: Reminder): string {
    const od = formatOdometer(r.dueOdometer);
    const countdown = humanCountdown(r.dueDistance, 'mi');
    if (!countdown) return od ? `Due at ${od} mi` : '';
    return od ? `Due at ${od} mi · ${countdown}` : `Due ${countdown}`;
  }
</script>

<div class="mb-4">
  <h1 class="text-xl font-bold text-zinc-100">Upcoming maintenance</h1>
</div>

{#if data.error === 'no-vehicle'}
  <div class="rounded-xl px-3 py-2 text-sm text-rose-300 bg-rose-500/15 border border-rose-500/30">
    Pick a vehicle first.
  </div>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/vehicles?from=maintenance" class="block text-sm text-blue-400 mt-6">→ Pick vehicle</a>
{:else}
  {#if data.vehicle}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href="/vehicles?from=maintenance" class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full">
      <div class="w-12 h-12 rounded-lg bg-zinc-700 shrink-0 flex items-center justify-center text-zinc-500">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 17h14M5 17v-5l2-5h10l2 5v5M5 17H3M19 17h2M7 12h10" />
          <circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" />
        </svg>
      </div>
      <div class="text-left flex-1 min-w-0">
        <div class="field-label">Vehicle</div>
        <div class="text-base font-semibold truncate text-zinc-100">
          {vehicleLabel}
        </div>
      </div>
      <span class="text-zinc-500" aria-hidden="true">›</span>
    </a>
  {/if}

  {#if data.error}
    <div class="rounded-xl px-3 py-2 text-sm text-amber-300 bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 mb-3">
      <span aria-hidden="true">⚠</span>
      <span>Couldn't reach LubeLogger right now.</span>
    </div>
  {/if}

  {#if visible.length === 0 && !data.error}
    <p class="text-sm text-zinc-500 italic">
      Looks good — no upcoming maintenance for this vehicle.
    </p>
  {:else}
    {#each visible as r (r.id)}
      <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-2">
        <div class="flex items-start justify-between gap-2">
          <span class="text-base font-semibold text-zinc-100 leading-tight">
            {r.description}
          </span>
          <span class="text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 border shrink-0 mt-0.5 {chipClasses(r.urgency)}">
            {chipLabel(r.urgency)}
          </span>
        </div>
        {#if r.userMetric === 'Date' || r.userMetric === 'Both'}
          {@const line = dateLine(r)}
          {#if line}
            <div class="text-xs text-zinc-500 mt-1">{line}</div>
          {/if}
        {/if}
        {#if r.userMetric === 'Odometer' || r.userMetric === 'Both'}
          {@const line = odometerLine(r)}
          {#if line}
            <div class="text-xs text-zinc-500 mt-1">{line}</div>
          {/if}
        {/if}
        {#if r.notes}
          <div class="text-xs text-zinc-500 mt-1 italic">{r.notes}</div>
        {/if}
      </div>
    {/each}
  {/if}

  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="block text-sm text-blue-400 mt-6">← Back to Log Fuel</a>
{/if}
