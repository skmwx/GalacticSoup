/**
 * The compiled content bundle, supplied by `config/contentPlugin.mjs`.
 *
 * It is typed as `unknown` on purpose: `parseContentBundle` is the only thing
 * that may decide a bundle is well formed, and it must guard a value that
 * arrives from outside the type system.
 */
declare module 'virtual:galactic-soup/content-bundle' {
  const bundle: unknown;
  export default bundle;
}
