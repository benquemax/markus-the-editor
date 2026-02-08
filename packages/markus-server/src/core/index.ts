/**
 * Core Integration Module
 *
 * Re-exports the bundled Markus core modules for use in the standalone server.
 * The bundle is created by scripts/build-core.mjs using esbuild.
 */

// Re-export everything from the bundled core modules
export * from './bundle.mjs'
