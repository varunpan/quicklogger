<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  let { children } = $props();

  let drawerOpen = $state(false);

  const navItems = [
    { href: '/', label: 'Log Fuel' },
    { href: '/history', label: 'History' },
    { href: '/vehicles', label: 'Vehicles' },
    { href: '/settings', label: 'Settings' }
  ];

  function isActive(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }

  function close() {
    drawerOpen = false;
  }

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
</svelte:head>

<div class="max-w-md mx-auto min-h-screen flex flex-col">
  <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
    <h1 class="text-lg font-bold flex items-center gap-1.5">
      <span aria-hidden="true">⛽</span>
      <span>quicklogger</span>
    </h1>
    <button
      type="button"
      aria-label="Open menu"
      aria-expanded={drawerOpen}
      onclick={() => (drawerOpen = !drawerOpen)}
      class="p-2 -mr-2 text-zinc-300 active:text-zinc-100"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </button>
  </header>

  <main class="flex-1 px-4 py-4">
    {@render children()}
  </main>
</div>

<button
  type="button"
  tabindex="-1"
  aria-label="Close menu"
  class="fixed inset-0 z-40 bg-black/60 transition-opacity duration-200"
  class:opacity-0={!drawerOpen}
  class:pointer-events-none={!drawerOpen}
  class:opacity-100={drawerOpen}
  onclick={close}
></button>

<aside
  class="fixed inset-y-0 left-0 z-50 w-72 bg-zinc-950 border-r border-zinc-800 px-5 py-6 flex flex-col transition-transform duration-200 ease-out"
  class:-translate-x-full={!drawerOpen}
  class:translate-x-0={drawerOpen}
  aria-hidden={!drawerOpen}
>
  <div class="flex items-center justify-between mb-6">
    <span class="text-lg font-bold flex items-center gap-1.5">
      <span aria-hidden="true">⛽</span>
      <span>quicklogger</span>
    </span>
    <button type="button" aria-label="Close menu" onclick={close} class="p-2 -mr-2 text-zinc-400">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="6" y1="18" x2="18" y2="6" />
      </svg>
    </button>
  </div>
  <nav>
    <ul class="flex flex-col gap-1">
      {#each navItems as item (item.href)}
        <li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={item.href} onclick={close}
            class="block px-3 py-3 rounded-lg text-base"
            class:bg-zinc-800={isActive(item.href)}
            class:text-blue-400={isActive(item.href)}
            class:text-zinc-200={!isActive(item.href)}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</aside>
