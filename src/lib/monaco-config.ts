/**
 * Monaco Editor Configuration
 *
 * Configures Monaco to load from local node_modules instead of CDN.
 * This is required for Electron apps with Content Security Policy restrictions.
 */

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure the loader to use the local Monaco package
loader.config({ monaco })

export { monaco }
