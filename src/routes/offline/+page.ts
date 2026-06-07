// Page-level options override the layout's `ssr=true; prerender=false`.
// prerender=true emits a route-agnostic SPA shell at build time; ssr=false keeps
// it data-free so the build needs no runtime env. The service worker precaches
// this HTML and serves it for ANY offline navigation — the client router then
// renders the requested route from `location`.
export const prerender = true;
export const ssr = false;
