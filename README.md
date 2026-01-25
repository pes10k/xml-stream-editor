xml-stream-editor
===

Library to edit xml files in a streaming manner. Inspired by
[xml-stream](https://www.npmjs.com/package/xml-stream), but 1. allows using
current node versions, and 2. provides a higher level, easier to use API.

The main benefit of `xml-stream-editor` over most other existing
(and otherwise excellent) libraries for editing XML is that `xml-stream-editor`
allows you to modify XML without needing to buffer the XML files in memory.
For small to mid-sized XML files buffering is fine. But when editing very large
files (e.g., multi-Gb files) buffering can be a problem or an absolute blocker.

Usage
---

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

Example
---

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
                    elm.text = ""

                    const instrumentElm = newElement("instrument")
                    instrumentElm.text = "saxophone"
                    elm.children.push(instrumentElm)

                    const nameElm = newElement("name")
                    nameElm.text = "Lisa Simpson"
                    elm.children.push(nameElm)
                    break
                case "Bart Simpson":
                    // Remove the node by not returning an element.
                    return
            }
            return elm
        }
    }
    await pipeline(
        createReadStream("simpsons.xml"), // above example
        createXMLEditor(config),
        process.stdout
    )
})()
```

And you'll find this printed to `STDOUT` (reformatted):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<simpsons decade="90s" locale="US">
  <main>
    <character sex="female" hair="blue">Marge Simpson</character>
    <character sex="male">Homer Simpson (Sr.)</character>
    <character sex="female">
      <instrument>saxophone</instrument>
      <name>Lisa Simpson</name>
    </character>
    <character sex="female">Maggie Simpson</character>
  </main>
  <side>
    <character sex="male">Disco Stu</character>
    <character sex="male" title="Dr.">Julius Hibbert</character>
  </side>
</simpsons>
```

Notes
---

Nested editing functions are not supported. You can define as many editing
rules as you'd like, but only one rule can be matching the xml document
at a time as its being streamed. So anytime a selector is matching part of a
document that is already matched by a parent rule, that child rule will
not be applied.

For example (using to the same example XML document as above):

```javascript
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createXMLEditor, newElement } from 'xml-stream-editor'

(async () => {
    const config = {
        // This rule will match first, since the "main" element will be
        // identified first during parsing.
        "main character": (elm) => {
            // editing goes here
            return elm
        },
        // And as a result, this rule will never be applied during editing
        // (since anytime "character" would match a <character> element,
        // that <character> element will have already been matched by the
        // above "main character" selector.
        "character": (elm) => {
            // this function would never be called in this document.
            return elm
        },
    }
    await pipeline(
        createReadStream("simpsons.xml"), // above example
        createXMLEditor(config),
        process.stdout
    )
})()
```

Motivation
---

`xml-stream-editor` was built to handle the extremely large XML files
generated by [Brave Software's PageGraph system](https://github.com/brave/brave-browser/wiki/PageGraph),
which records both a broad range of actions that occur when loading a web page
(e.g.,, an image sub-resource being loaded, a WebAPI being called, a HTML
element being added to the DOM), but also the actor in the page that is
responsible for that action (e.g., the `<img>` element that included the image,
the `<script>` element calling the WebAPI, the `<script>` element creating
and modifying the HTML element).

**PageGraph** records this information in [GraphML](http://graphml.graphdrawing.org/)
format, an XML format for encoding directed graphs. These GraphML files
can get enormous quickly (multiple Gb), and so, a streaming system for editing
these files was needed.
