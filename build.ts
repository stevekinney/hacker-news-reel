import type { BuildConfig } from 'bun';

import pkg from './package.json' assert { type: 'json' };

const isWatchMode = process.argv.includes('--watch');

const external = Object.keys(pkg.dependencies ?? {});

const configuration: BuildConfig = {
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  sourcemap: 'inline',
  minify: true,
  target: 'node',
  external,
};

const targets = [
  { format: 'esm' as const },
  { format: 'cjs' as const, naming: '[name].cjs' },
  {
    format: 'esm' as const,
    target: 'browser' as const,
    outdir: './dist/browser',
    external: ['bottleneck'],
    sourcemap: 'external' as const,
    splitting: true,
    env: 'inline' as const,
  },
];

const buildOptions = targets.map((opts) => ({
  ...configuration,
  ...opts,
}));

if (isWatchMode) {
  // In watch mode, only build ESM for faster development
  const _watcher = Bun.build({
    ...configuration,
  });
  console.log('👀 Watching for changes...');
} else {
  const [esm, commonJs, browser] = await Promise.all(buildOptions.map((opts) => Bun.build(opts)));
  console.log({ esm, commonJs, browser });
}
