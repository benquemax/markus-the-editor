import { useState } from 'react'
import { marked } from 'marked'
import './App.css'

function App() {
  const [markdown, setMarkdown] = useState('# Hello, Markus!')

  const handleMarkdownChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMarkdown(event.target.value)
  }

  return (
    <div className="app-container">
      <textarea
        className="editor"
        value={markdown}
        onChange={handleMarkdownChange}
      ></textarea>
      <div
        className="preview"
        dangerouslySetInnerHTML={{ __html: marked(markdown) }}
      ></div>
    </div>
  )
}

export default App
