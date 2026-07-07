import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVehicleId, withLubeLogger } from '$lib/server/lubeloggerProxy';
import { getCachedVehicles, _resetVehicleCache } from '$lib/server/vehicleCache';

export function _resetCache() { _resetVehicleCache(); }

export const GET: RequestHandler = ({ url, locals }) => {
  const vehicleId = parseVehicleId(url);
  if (vehicleId instanceof Response) return vehicleId;

  return withLubeLogger(
    locals,
    { resource: 'vehicle image', logMessage: 'vehicle image fetch failed' },
    async (client) => {
      const vehicles = await getCachedVehicles(client);
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return json({ error: 'no image' }, { status: 404 });

      const path = (vehicle as { imageLocation?: unknown }).imageLocation;
      if (typeof path !== 'string' || path === '') {
        return json({ error: 'no image' }, { status: 404 });
      }
      if (!path.startsWith('/images/')) {
        return json({ error: 'no image' }, { status: 404 });
      }

      const upstream = await client.fetchImage(path);
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-store'
        }
      });
    }
  );
};
