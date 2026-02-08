import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictMode disabled to prevent double rendering in development
  // Re-enable once WebSocket integration is stable
  <App />
)
