<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Rotation } from './image';
  import type { OcrMode } from '$lib/shared/types';

  interface Props {
    file: File;
    mode: OcrMode;
    onsubmit: (payload: { rotation: Rotation }) => void;
    oncancel: () => void;
    onretake: () => void;
  }

  let { file, mode, onsubmit, oncancel, onretake }: Props = $props();

  let rotation: Rotation = $state(0);
  let objectUrl: string = $state('');

  onMount(() => {
    objectUrl = URL.createObjectURL(file);
  });

  onDestroy(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  function rotateRight() {
    rotation = ((rotation + 90) % 360) as Rotation;
  }
  function rotateLeft() {
    rotation = ((rotation + 270) % 360) as Rotation;
  }
  function send() {
    onsubmit({ rotation });
  }
  function handleKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') oncancel();
  }

  const modeLabel = $derived(mode === 'pump' ? 'Pump display' : 'Odometer');
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class="fixed inset-0 z-50 bg-zinc-950 flex flex-col"
  role="dialog"
  aria-modal="true"
  aria-label="Photo preview"
>
  <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
    <button
      type="button"
      class="flex items-center gap-1.5 text-zinc-300 -ml-1"
      aria-label="Cancel"
      onclick={oncancel}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="6" y1="18" x2="18" y2="6" />
      </svg>
      <span class="text-sm font-semibold">Cancel</span>
    </button>
    <div class="text-sm font-semibold text-zinc-300">
      Preview · <span class="text-zinc-500">{modeLabel}</span>
    </div>
  </header>

  <div class="flex-1 flex items-center justify-center bg-zinc-950 px-6 py-6 overflow-hidden">
    {#if objectUrl}
      <img
        src={objectUrl}
        alt="Captured for OCR preview"
        class="max-w-full max-h-full object-contain transition-transform duration-150"
        style="transform: rotate({rotation}deg)"
      />
    {/if}
  </div>

  <div class="px-4 pb-2">
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="flex-1 inline-flex items-center justify-center gap-1.5 text-zinc-300 bg-zinc-800 rounded-xl px-3 py-2.5 text-sm font-semibold"
        aria-label="Rotate left 90 degrees"
        onclick={rotateLeft}
      >
        <span aria-hidden="true">↺</span>
        <span>Rotate</span>
      </button>
      <button
        type="button"
        class="flex-1 inline-flex items-center justify-center gap-1.5 text-zinc-300 bg-zinc-800 rounded-xl px-3 py-2.5 text-sm font-semibold"
        onclick={onretake}
      >
        <span>Retake</span>
      </button>
      <button
        type="button"
        class="flex-1 inline-flex items-center justify-center gap-1.5 text-zinc-300 bg-zinc-800 rounded-xl px-3 py-2.5 text-sm font-semibold"
        aria-label="Rotate right 90 degrees"
        onclick={rotateRight}
      >
        <span>Rotate</span>
        <span aria-hidden="true">↻</span>
      </button>
    </div>
  </div>

  <div class="px-4 pt-2 pb-4">
    <button
      type="button"
      class="bg-blue-600 text-white rounded-xl py-4 text-base font-semibold w-full"
      onclick={send}
    >
      Send for OCR
    </button>
  </div>
</div>
