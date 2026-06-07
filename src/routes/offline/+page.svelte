<!--
  Minimal carrier for the prerendered offline shell. On a normal offline
  navigation the service worker serves THIS prerendered HTML for the requested
  route (e.g. `/`), and the client router renders the real route from
  `location` — this copy is only ever shown if someone navigates to `/offline`
  directly.
-->
<p class="text-center text-zinc-400 p-6">You're offline. Reconnecting…</p>
