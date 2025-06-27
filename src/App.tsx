import { useState } from 'react'
import { marked } from 'marked'
import './App.css'

function App() {
  const [markdown, setMarkdown] = useState(`# Hello, Markus!

This is **bold** and *italic*.

## A Subheading

*   Item 1
*   Item 2
    *   Subitem 2.1
    *   Subitem 2.2

1.  Numbered Item 1
2.  Numbered Item 2

> This is a blockquote.

```javascript
console.log("Hello, world!");
```

`

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
