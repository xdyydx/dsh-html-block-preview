/**
 * Host half of the code-block-preview bundle.
 *
 * The whole feature is browser-side: the Client module decorates the code-block banner
 * that the Web UI already renders. This row exists so the client bundle has a Loader
 * entry in the boot graph, and it registers nothing.
 */
export function apply() {}
