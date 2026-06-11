<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { installClientLogger } from '$lib/client/logger';
  import { loadServerInfo, saveServerInfo } from '$lib/client/server-info';
  import { registerSyncTriggers } from '$lib/client/sync-trigger';
  import { warmVehiclesCache } from '$lib/client/cache-warm';
  import { registerControllerReload } from '$lib/client/sw-update';

  let { children } = $props();

  let drawerOpen = $state(false);

  // Amber dot in the footer when a newer quicklogger release exists. Seeded from
  // the cache for instant paint, then refreshed by the boot-refresh below.
  let appUpdateAvailable = $state(loadServerInfo()?.appUpdateAvailable ?? false);

  const navItems = [
    { href: '/', label: 'Log Fuel' },
    { href: '/history', label: 'History' },
    { href: '/maintenance', label: 'Maintenance' },
    { href: '/vehicles', label: 'Vehicles' },
    { href: '/settings', label: 'Settings' }
  ];

  function isActive(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }

  function close() {
    drawerOpen = false;
  }

  function handleKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && drawerOpen) close();
  }

  onMount(() => {
    installClientLogger();

    // Boot-refresh the LubeLogger /api/server-info cache so consumers
    // (format.ts locale, last-fillup.ts tolerant-read, etc.) read fresh
    // values app-wide. Silent on failure — keep whatever the cache holds.
    void (async () => {
      try {
        const res = await fetch('/api/server-info');
        if (res.ok) {
          const info = await res.json();
          saveServerInfo(info);
          appUpdateAvailable = info.appUpdateAvailable ?? false;
        }
      } catch {
        /* keep cached value */
      }
    })();

    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' });

    // SSR serializes the vehicle list into the page HTML, so the browser never
    // requests /api/vehicles on a full navigation and the SW's offline cache
    // would stay cold. One real fetch per page load keeps it warm. See cache-warm.ts.
    void warmVehiclesCache(navigator.serviceWorker, fetch);

    // The SW skipWaiting()s + claim()s and prunes the old shell cache, so a tab
    // open across a deploy must reload or its next lazy chunk load 404s. See sw-update.ts.
    const cleanupReload = registerControllerReload(navigator.serviceWorker, () =>
      location.reload()
    );

    // Drain the offline submission queue on resume (focus / visibility) and on
    // reconnect (online), plus once the SW is ready. See sync-trigger.ts.
    const cleanupTriggers = registerSyncTriggers({
      serviceWorker: navigator.serviceWorker,
      window,
      document
    });

    return () => {
      cleanupReload();
      cleanupTriggers();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

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
  inert={!drawerOpen}
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

  <footer class="mt-auto pt-6 text-xs text-zinc-500 flex items-center gap-2">
    <span class="inline-flex items-center gap-1.5">
      <span>v{__APP_VERSION__}</span>
      {#if appUpdateAvailable}
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500" title="Update available" data-testid="drawer-update-dot"></span>
      {/if}
    </span>
    <span aria-hidden="true">·</span>
    <a
      href="https://github.com/varunpan/quicklogger"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 active:text-zinc-100"
    >
      GitHub
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 17L17 7" />
        <path d="M8 7h9v9" />
      </svg>
    </a>
  </footer>
</aside>
