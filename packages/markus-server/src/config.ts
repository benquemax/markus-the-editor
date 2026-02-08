/**
 * Server Configuration
 *
 * Configuration options for the Markus standalone server.
 * Reads from environment variables with sensible defaults.
 */

export interface ServerConfig {
  /** HTTP server port */
  port: number

  /** Host to bind to (default: localhost for security) */
  host: string

  /** Enable CORS for development */
  corsEnabled: boolean

  /** Allowed origins for CORS */
  corsOrigins: string[]

  /** Path to settings file */
  settingsPath?: string

  /** Enable debug logging */
  debug: boolean
}

/**
 * Gets server configuration from environment variables.
 */
export function getConfig(): ServerConfig {
  return {
    port: parseInt(process.env.MARKUS_PORT || '3847', 10),
    host: process.env.MARKUS_HOST || 'localhost',
    // CORS enabled by default for local development
    corsEnabled: process.env.MARKUS_CORS !== 'false',
    corsOrigins: (process.env.MARKUS_CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(','),
    settingsPath: process.env.MARKUS_SETTINGS_PATH,
    debug: process.env.MARKUS_DEBUG === 'true'
  }
}

/**
 * Default port for the Markus server.
 * 3847 = MARK in T9 keypad (loosely)
 */
export const DEFAULT_PORT = 3847
