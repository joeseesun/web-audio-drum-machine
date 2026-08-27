/* Node ESM requires file extensions; the app source (correctly) omits them
   because Vite resolves them. This hook bridges the gap for the test script. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err;
    for (const ext of ['.js', '.jsx', '.mjs']) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        /* try the next extension */
      }
    }
    throw err;
  }
}
