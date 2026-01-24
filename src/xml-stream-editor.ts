import { strict as assert } from 'node:assert'
import { Transform, TransformCallback } from 'node:stream'

import { SaxesOptions, SaxesParser, TagForOptions, XMLDecl } from 'saxes'

import { isValidName, toAttrValue, toBodyText, toCloseTag,
  toOpenTag } from './markup.js'

export type Selector = string
export type EditorFunc = (elm: Element) => Element | undefined
export type Config = Record<Selector, EditorFunc>

// Records a position in the parser stack that matches a user-provided
// selector, and the corresponding function the user provided to
// edit the matching element
interface ElementToEditInfo {
  selector: Selector
  func: EditorFunc
  element: Element
}

export interface Element {
  name: string
  text?: string
  attributes: Record<string, string>
  children: Element[]
}

export const newElement = (name: string): Element => {
  if (isValidName(name) === false) {
    throw new Error(`"${name}" is not a valid XML element name`)
  }

  return {
    name: name,
    text: undefined,
    attributes: {},
    children: [],
  }
}

const cloneElement = (elm: Element): Element => {
  const newElm = newElement(elm.name)
  newElm.text = elm.text
  newElm.attributes = JSON.parse(JSON.stringify(elm.attributes))
  newElm.children = elm.children.map(cloneElement)
  return newElm
}

const elementForNode = (node: TagForOptions<SaxesOptions>): Element => {
  // Here we check if each attribute name is simple (and so just a
  // string), or in the namespace representation the "saxes" library
  // uses (in which case attrValue will be a SaxesAttributeNS
  // object, that we have to unpack a bit)
  const attributes: Record<string, string> = {}
  if (node.attributes) {
    for (const [attrName, attrValue] of Object.entries(node.attributes)) {
      if (typeof attrValue === 'string') {
        attributes[attrName] = attrValue
        continue
      }
      attributes[attrValue.name] = attrValue.value
    }
  }

  return elementForNameAndAttrs(node.name, attributes)
}

const elementForNameAndAttrs = (name: string,
                                attrs?: Record<string, string>) => {
  const newElm = newElement(name)
  if (attrs) {
    newElm.attributes = attrs
  }
  return newElm
}

class XMLStreamEditorTransformer extends Transform {
  // Used to track how deep in the XML tree the parser is, so that we can
  // check newly parsed elements against the passed editor rules.
  readonly #elmStack: Element[] = []

  // This is a map of (VERY) simple xpaths (i.e., only XML element names;
  // no attributes, no name spaces, etc).
  readonly #config: Config

  // Handle to the 'saxes' xml parser object.
  readonly #xmlParser: SaxesParser

  // If set, tracks the current element in the parser stack that matches
  // a user-provided selector, and the corresponding editor function
  // the user provided.
  #elmToEditInfo?: ElementToEditInfo

  // Store any errors we've been passed by the saxes parser so that we
  // can pass it along in the transformer callback next time we get data.
  #error?: Error

  // Checks to see if the current editor stack (which tracks the current
  // element being parsed in the input XML stream, along with its parent
  // elements) matches any of the passed editor rules.
  #doesStackMatchEditorRule (): ElementToEditInfo | null {
    const currentElementPath = this.#elmStack.map(x => x.name).join(' ')
    for (const [selector, editorFunc] of Object.entries(this.#config)) {
      if (currentElementPath.endsWith(selector)) {
        // The depth of the root of this subtree in the stack
        const depth = this.#elmStack.length - 1
        assert(depth >= 0)
        const elmToEdit = this.#elmStack[depth]
        return { selector: selector, func: editorFunc, element: elmToEdit }
      }
    }
    return null
  }

  #isInSubtreeToBeEdited (): boolean {
    return this.#elmToEditInfo !== undefined
  }

  #writeElementToStream (element: Element): void {
    this.push(toOpenTag(element.name, element.attributes))
    if (element.text) {
      this.push(toBodyText(element.text))
    }
    for (const childElm of element.children) {
      this.#writeElementToStream(childElm)
    }
    this.push(toCloseTag(element.name))
  }

  #writeSubtreeToStream (): void {
    assert(this.#elmToEditInfo)
    const clonedElm = cloneElement(this.#elmToEditInfo.element)

    try {
      const editedElm = this.#elmToEditInfo.func(clonedElm)
      if (editedElm) {
        this.#writeElementToStream(editedElm)
      }
      this.#elmToEditInfo = undefined
    }
    catch (e: any) {
      this.#error = e as Error
      this.#xmlParser.close()
    }
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
      const newElement = elementForNode(node)
      this.#elmStack.push(newElement)
      // Check for case one
      if (this.#isInSubtreeToBeEdited()) {
        return
      }
      // Check for case two, if we're at the root of a subtree to edit.
      const matchingElementInfo = this.#doesStackMatchEditorRule()
      if (matchingElementInfo !== null) {
        this.#elmToEditInfo = matchingElementInfo
        return
      }
      // Otherwise we're in case three, so print out the opening tag
      // immediately.
      this.push(toOpenTag(newElement.name, newElement.attributes))
    })

    this.#xmlParser.on('text', (text: string) => {
      // There are two possible cases here
      //
      // 1. We're in a subtree to be edited, in which case we buffer
      //    the text, or
      // 2. We're not in the subtree being edited, in which case we can
      //    print the text out immediately.

      // Check for case one
      if (this.#isInSubtreeToBeEdited()) {
        const topOfStack = this.#elmStack.at(-1)
        assert(topOfStack)
        topOfStack.text = text
        return
      }

      // Otherwise we're in case two, and can print the text out immediately.
      this.push(toBodyText(text))
    })

    this.#xmlParser.on('xmldecl', (decl: XMLDecl) => {
      let xmlDecl = '<?xml version="1.0"'
      if (decl.encoding) {
        xmlDecl += ` encoding="${toAttrValue(decl.encoding)}"`
      }
      if (decl.standalone) {
        xmlDecl += ` standalone="${toAttrValue(decl.standalone)}"`
      }
      xmlDecl += '?>'
      this.push(xmlDecl)
    })

    this.#xmlParser.on('error', (error: Error) => {
      this.#error = error
    })

    this.#xmlParser.on('closetag', (node: TagForOptions<SaxesOptions>) => {
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
        this.push(toCloseTag(node.name))
        return
      }

      // Check for case two
      assert(this.#elmToEditInfo)
      if (completedElm === this.#elmToEditInfo.element) {
        this.#writeSubtreeToStream()
        return
      }

      // Otherwise, we must be in case three
      assert(this.#elmStack.length > 0)
      this.#elmStack.at(-1)?.children.push(completedElm)
    })
  }

  constructor (config: Config, saxesOptions?: SaxesOptions) {
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

export const createXMLEditor = (config: Config,
                                saxesOptions?: SaxesOptions) => {
  return new XMLStreamEditorTransformer(config, saxesOptions)
}
