/**
 * FileViewer Components
 *
 * Exports the main FileViewer router and individual viewer components.
 */

// Configure Monaco to use local files instead of CDN (must be imported before Editor components)
import '../../lib/monaco-config'

export { FileViewer } from './FileViewer'
export type { FileViewerHandle } from './FileViewer'
export { ImageViewer } from './ImageViewer'
export { VideoPlayer } from './VideoPlayer'
export { JsonEditor } from './JsonEditor'
export { HtmlEditor } from './HtmlEditor'
export { MonacoWrapper } from './MonacoWrapper'
