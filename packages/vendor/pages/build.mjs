/**
 * Build the browser bundle for this plugin.
 *
 * The package ships `lib/client.js`, a single CJS bundle loaded by the DSH
 * client module table. React and the host's shared client libraries are served
 * by the host at runtime, so they are external here: bundling them would give
 * the plugin a second React and a second Cordis instance, and its effects would
 * land in a different context than the host's.
 */
import { build } from 'esbuild';

/** Modules the DSH host serves from its own module table. */
export const HOST_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

export async function buildClient() {
  const shared = {
    entryPoints: ['src/client.jsx'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: HOST_EXTERNALS,
    loader: { '.css': 'text', '.svg': 'text', '.md': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  };
  const results = await Promise.all([
    // DSH discovers lib/client.js directly. Its module-table registration must
    // stay separate from the ordinary importable ESM entry below.
    build({
      ...shared, outfile: 'lib/client.js', format: 'cjs',
      banner: { js: 'window.__ModuleLoader__.load({id:"@lybx-leyw/dsh-pages",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
      footer: { js: 'return module.exports;}});' },
    }),
    build({ ...shared, outfile: 'lib/client.mjs', format: 'esm' }),
  ]);
  return {
    errors: results.flatMap(result => result.errors),
    warnings: results.flatMap(result => result.warnings),
  };
}

if (process.argv[1]?.endsWith('build.mjs')) {
  const result = await buildClient();
  if (result.errors.length > 0) process.exit(1);
}
