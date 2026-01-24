# xml-stream-editor

Library to edit xml files in a streaming manner. Inspired by
[xml-stream](https://www.npmjs.com/package/xml-stream), but 1. allows using
current node versions, and 2. provides a higher level, easier to use API.

The main benefit of `xml-stream-editor` over most other existing
(and otherwise excellent) libraries for editing XML is that `xml-stream-editor`
allows you to modify XML without needing to buffer the XML files in memory.
For small to mid-sized XML files buffering is fine. But when editing very large
files (e.g., multi-Gb files) buffering can be a problem or an absolute blocker.

## Usage

`xml-stream-editor` is designed to be used with node's stream systems
by subclassing [`stream.Transform`](https://nodejs.org/api/stream.html#class-streamtransform),
so it can be used with the [streams promises API](https://nodejs.org/api/stream.html#streams-promises-api)
and stdlib interfaces like [`stream.pipeline`](https://nodejs.org/api/stream.html#streampipelinestreams-options).

The main way to use `xml-stream-editor` is to 1. select which XML elements
you want to edit using simple declarative selectors (like _very_ simple XPath
rules or CSS selectors), and 2. write functions to be called with each
matching XML element in the document. Those functions then either edit and
return the provided element, or remove the element from the document
by returning nothing.

## Example

Start with this input as `simpsons.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<simpsons decade="90s" locale="US">
    <main>
        <character sex="female">Marge Simpson</character>
        <character sex="male">Homer Simpson</character>
        <character sex="female">Lisa Simpson</character>
        <character sex="male">Bart Simpson</character>
    </main>
    <side>
        <character sex="male">Disco Stu</character>
        <character sex="male" title="Dr.">Julius Hibbert</character>
    </side>
</simpsons>
```

You can edit in a streaming manner like this:

```javascript
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createXMLEditor, newElement } from 'xml-stream-editor'

(async () => {
    const config = {
        // Map element selectors to editing functions
        "main character": (elm) => {
            switch (elm.text) {
                case "Marge Simpson":
                    elm.attributes["hair"] = "blue"
                    break
                case "Homer Simpson":
                    elm.text += " (Sr.)"
                    break
                case "Lisa Simpson":
                    const newElm = newElement("instrument")
                    newElm.text = "saxaphone"
                    elm.children.push(newElm)
                    break
                case "Bart Simpson":
                    // Remove the node by not returning an element.
                    return
            }
        }
    }
    await pipeline(
        createReadStream("simpsons.xml"), // above example
        createXMLEditor(selectorsToEditingFunctions),
        process.stdout
    )
})()
```

And you'll find this printed to `STDOUT`:

```text

```