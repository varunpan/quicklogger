<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  let { children } = $props();

  onMount(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' });

    const trigger = () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'sync-queue' });
    };
    window.addEventListener('focus', trigger);
    trigger();
    return () => window.removeEventListener('focus', trigger);
  });
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#09090b" />
  <title>quicklogger</title>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<main class="min-h-screen flex flex-col max-w-md mx-auto px-4 py-6">
  {@render children()}
</main>
