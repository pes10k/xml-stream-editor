import { strict as assert } from 'node:assert'
import { Transform, TransformCallback } from 'node:stream'

import { SaxesAttributeNS, SaxesOptions, SaxesParser, TagForOptions, XMLDecl } from 'saxes'
import xml from 'xml'

interface XMLEditorNeedle {
  depth: number
  path: XMLEditorPath
  func: XMLEditorFunc
}

type XMLEditorAttrs = Record<string, SaxesAttributeNS> | Record<string, string>
type XMLEditorPath = string
type XMLEditorFunc = (elm: XMLElement) => XMLElement
type XMLEditorConfig = Record<XMLEditorPath, XMLEditorFunc>

class XMLElement {
  readonly name: string
  readonly attrs?: XMLEditorAttrs

  text?: string
  #children: XMLElement[] = []

  constructor (name: string, attrs?: XMLEditorAttrs) {
    this.name = name
    this.attrs = attrs
  }

  addChild (elm: XMLElement) {
    this.#children.push(elm)
  }

  // This passes the simple key=value attrs along if the XML attributes
  // are simple, or converts the annoying namespace'ed XML attributes
  // to simpler ones if needed.
  flatAttrs (): Record<string, string> {
    if (this.attrs === undefined) {
      return {}
    }

    const flatAttrs: Record<string, string> = {}
    for (const [attrKey, attrValue] of Object.entries(this.attrs)) {
      if (typeof attrValue === 'string') {
        flatAttrs[attrKey] = attrValue
        continue
      }
      // Otherwise, the key is a SaxesAttributeNS instance
      flatAttrs[attrValue.name] = attrValue.value
    }
    return flatAttrs
  }

  // Convert our representation of an XML element to a 'xml' / 'node-xml'
  // representation, that can be passed to the libraries default `xml()`
  // function.
  toXMLObject (): xml.XmlObject {
    const xmlObjParts: xml.XmlDesc[] = []
    if (this.attrs) {
      xmlObjParts.push({ _attr: this.flatAttrs() })
    }
    if (this.text) {
      xmlObjParts.push(this.text)
    }

    const xmlDesc = xml.element(xmlObjParts)
    for (const childObj of this.#children) {
      xmlDesc.push(childObj.toXMLObject())
    }
    return { [this.name]: xmlDesc }
  }

  toString (xmlDecl?: XMLDecl): string {
    if (xmlDecl) {
      const xmlOption: xml.Option = {
        declaration: {},
      }
      assert(typeof xmlOption.declaration === 'object')
      if (xmlDecl.version) {
        xmlOption.declaration.standalone = xmlDecl.standalone
      }
      if (xmlDecl.encoding) {
        xmlOption.declaration.encoding = xmlDecl.encoding
      }
      return xml(this.toXMLObject(), xmlOption)
    }

    return xml(this.toXMLObject())
  }
}

export class XMLEditorTransformer extends Transform {
  // Used to mirror the XML tree as its being parsed. Only used to keep track
  // of when we're parsing (and so buffering) a subtree in the XML document
  // that will be edited when the entire subtree is parsed.
  readonly #elmStack: XMLElement[] = []

  // This is a map of (VERY) simple xpaths (i.e., only XML element names;
  // no attributes, no name spaces, etc).
  readonly #config: XMLEditorConfig

  // Handle to the 'saxes' xml parser object.
  readonly #xmlParser: SaxesParser

  // References to the depth of the stack where a to-be-edited subtree starts,
  // the function that's been registered to do that editing,
  // and the element that is the root of the subtree to be edited (we need
  // this second reference to it, outside the stack, so that we still have
  // a handle to the child elements after they've been pop'ed off the stack).
  #subtreeToEditDepth?: number
  #subtreeToEditFunc?: XMLEditorFunc
  #subtreeToEdit?: XMLElement

  // We store information about the xml declaration here, since the xml library
  // requires us to pass along the xml declaration with the first element
  // being written (seems we can't write the declaration by itself).
  #xmlDecl?: XMLDecl
  #hasAddedDecl = false

  // Store any errors we've been passed by the saxes parser so that we
  // can pass it along in the transformer callback next time we get data.
  #error?: Error

  #addXMLDeclOnce (): XMLDecl | undefined {
    if (this.#xmlDecl && this.#hasAddedDecl === false) {
      this.#hasAddedDecl = true
      return this.#xmlDecl
    }
  }

  #isAtRootOfSubtreeToEdit (): XMLEditorNeedle | null {
    const currentElementPath = this.#elmStack.map(x => x.name).join(' ')
    for (const [editorFuncPath, editorFunc] of Object.entries(this.#config)) {
      if (currentElementPath.endsWith(editorFuncPath)) {
        // The depth of the root of this subtree in the stack
        const subtreeDepth = this.#elmStack.length - 1
        assert(subtreeDepth >= 0)
        return { depth: subtreeDepth, path: editorFuncPath, func: editorFunc }
      }
    }
    return null
  }

  #isInSubtreeToBeEdited (): boolean {
    return this.#elmStack.length !== null
  }

  #configureParserCallbacks () {
    this.#xmlParser.on('opentag', (node: TagForOptions<SaxesOptions>) => {
      // When we hit a new XML opening tag, the following cases are possible:
      //
      // 1. We're a CHILD in a subtree to be edited, in which case we can
      //    avoid a little work and just append ourselves to the stack.
      // 2. We are the ROOT of an subtree to be edited, in which case we
      //    note the current callback function we'll eventually get passed to,
      //    and append ourselves to the stack.
      // 3. We are NOT the root of a subtree to be edited, in which case
      //    we just add ourselves to the stack.
      const newXMLElement = new XMLElement(node.name, node.attributes)
      this.#elmStack.push(newXMLElement)
      // Check for case one
      if (this.#isInSubtreeToBeEdited()) {
        return
      }
      // Check for case two, if we're at the root of a subtree to edit.
      const editorFuncInfo = this.#isAtRootOfSubtreeToEdit()
      if (editorFuncInfo !== null) {
        this.#subtreeToEditFunc = editorFuncInfo.func
        this.#subtreeToEdit = newXMLElement
        return
      }
      // Otherwise we're in case three (with nothing extra to do)
      return
    })

    this.#xmlParser.on('text', (text: string) => {
      assert(this.#elmStack.length > 0)
      const topOfStack = this.#elmStack.at(-1)
      assert(topOfStack)
      topOfStack.text = text
    })

    this.#xmlParser.on('xmldecl', (decl: XMLDecl) => {
      this.#xmlDecl = decl
    })

    this.#xmlParser.on('error', (error: Error) => {
      this.#error = error
    })

    this.#xmlParser.on('closetag', () => {
      // When we hit an XML element's close tag, three cases are possible.
      //
      // 1. We've completed a node that is NOT in a subtree with an assigned
      //    editing function. In that case we write the element as XML
      //    to the write stream and pop it off the stack.
      // 2. We've completed a ROOT NODE in a subtree being edited,
      //    in which case we pass that buffered subtree to the registered
      //    editing function, write the modified subtree as XML to the
      //    write stream, loose the reference to the buffered subtree,
      //    and pop the element off the stack too.
      // 3. We've completed a CHILD NODE in a subtree being edited,
      //    in which case we append this node to our buffered subtree
      //    and pop it off the stack.
      const completedElm = this.#elmStack.pop()
      assert(completedElm)

      // Check for case one
      if (this.#isInSubtreeToBeEdited() === false) {
        this.push(completedElm.toString(this.#addXMLDeclOnce()))
        return
      }

      // Check for case two
      if (completedElm === this.#subtreeToEdit) {
        assert(this.#subtreeToEditDepth === this.#elmStack.length)
        assert(this.#subtreeToEditFunc)
        const editedSubtreeElm = this.#subtreeToEditFunc(completedElm)
        this.push(editedSubtreeElm.toString(this.#addXMLDeclOnce()))

        this.#subtreeToEditFunc = undefined
        this.#subtreeToEdit = undefined
        this.#subtreeToEditDepth = undefined
        return
      }

      // Otherwise, we must be in case three
      assert(this.#elmStack.length > 0)
      this.#elmStack.at(-1)?.addChild(completedElm)
    })
  }

  constructor (config: XMLEditorConfig, saxesOptions?: SaxesOptions) {
    super()
    this.#config = config
    this.#xmlParser = new SaxesParser(saxesOptions)
    this.#configureParserCallbacks()
  }

  _transform (chunk: any, encoding: BufferEncoding,
              callback: TransformCallback): void {
    if (this.#error) {
      callback(this.#error)
      return
    }

    this.#xmlParser.write(chunk)
    if (this.#error) {
      callback(this.#error)
      return
    }

    callback()
  }
}

export const makeXMLEditor = (config: XMLEditorConfig,
                              saxesOptions?: SaxesOptions) => {
  return new XMLEditorTransformer(config, saxesOptions)
}
