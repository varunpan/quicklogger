export type FxProviderName = 'frankfurter' | 'erapi' | 'fawazahmed';

const KNOWN_FX_PROVIDERS: ReadonlySet<FxProviderName> = new Set([
  'frankfurter', 'erapi', 'fawazahmed'
]);

export interface Env {
  lubeloggerUrl: string;
  lubeloggerApiKey: string;
  lubeloggerVolumeUnit: string;
  lubeloggerCurrency: string;
  fxProviders: FxProviderName[];
  fxCachePath: string;
  port: number;
  origin: string | undefined;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new EnvError(`Required env var ${name} is not set`);
  return v;
}

export function loadEnv(): Env {
  const fxRaw = (process.env.FX_PROVIDERS ?? 'frankfurter,erapi,fawazahmed')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of fxRaw) {
    if (!KNOWN_FX_PROVIDERS.has(p as FxProviderName)) {
      throw new EnvError(`Unknown FX provider: ${p}`);
    }
  }
  return {
    lubeloggerUrl: required('LUBELOGGER_URL'),
    lubeloggerApiKey: required('LUBELOGGER_API_KEY'),
    lubeloggerVolumeUnit: process.env.LUBELOGGER_VOLUME_UNIT ?? 'gallons_us',
    lubeloggerCurrency: process.env.LUBELOGGER_CURRENCY ?? 'USD',
    fxProviders: fxRaw as FxProviderName[],
    fxCachePath: process.env.FX_CACHE_PATH ?? '/data/fx-cache.json',
    port: Number(process.env.PORT ?? 3000),
    origin: process.env.ORIGIN
  };
}
