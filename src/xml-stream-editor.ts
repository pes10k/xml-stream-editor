import { strict as assert } from 'node:assert'
import { Transform, TransformCallback } from 'node:stream'

import { SaxesOptions, SaxesParser, TagForOptions, XMLDecl } from 'saxes'

import { Element, ParsedElement } from './element.js'
import { toAttrValue, toBodyText, toCloseTag, toOpenTag } from './markup.js'
import { ElementPath, SelectorRule } from './selector.js'

export type Selector = string
export type EditorFunc = (elm: Element) => Element | undefined
export type EditingRules = Map<Selector, EditorFunc>

export interface Options {
  // Whether to check and enforce the validity of created and modified
  // XML element names and attributes. If true, will throw an error
  // if you create an XML element with a disallowed name (e.g.,
  // <no spaces allowed>) or with an invalid attribute name
  // (<my-elm a:b:c="too many namespaces" d@y="no @ in attr names">)
  //
  // default: true
  validate: boolean // = true

  // Options defined by the "saxes" library, and passed to the "saxes" parser
  //
  // default: undefined
  saxes?: SaxesOptions
}

// Records a position in the parser stack that matches a user-provided
// selector, and the corresponding function the user provided to
// edit the matching element
interface ElementToEditInfo {
  element: ParsedElement
  func: EditorFunc
  selector: SelectorRule
}

interface ParserStackEntry {
  element: ParsedElement
  path: ElementPath
}

class XMLStreamEditorTransformer extends Transform {
  // Default options, used if the caller doesn't provide any options (or
  // merged into the provided options if the user only sets some options).
  static readonly defaultOptions: Options = {
    validate: true,
    saxes: undefined,
  }

  // The configuration options, including possible options to pass to
  // the (above) saxes parser at instantiation.
  readonly #options: Options

  // Used to track how deep in the XML tree the parser is, so that we can
  // check newly parsed elements against the passed editor rules.
  readonly #parseStack: ParserStackEntry[] = []

  // This is a map of objects that represent simple xpaths (i.e., only XML
  // element names (no attributes, no name spaces, etc).
  readonly #rules: Map<SelectorRule, EditorFunc>

  // Handle to the 'saxes' xml parser object.
  readonly #xmlParser: SaxesParser

  // If set, tracks the current element in the parser stack that matches
  // a user-provided selector, and the corresponding editor function
  // the user provided.
  #elmToEditInfo?: ElementToEditInfo

  // Store any errors we've been passed by the saxes parser so that we
  // can pass it along in the transformer callback next time we get data.
  #error?: Error

  #pushParsedElementToStack (element: ParsedElement): void {
    const topOfStackElm = this.#parseStack.at(-1)
    // We prefix every element name in the parse stack with '@' (a character
    // that isn't valid in an XML element name) so that we can easily
    // check if a selector matches the parse stack by just checking if
    // the selector matches right end of the stack path.
    const pathToElement = topOfStackElm
      ? topOfStackElm.path.append(element.name)
      : new ElementPath(element.name)
    this.#parseStack.push({
      element: element,
      path: pathToElement,
    })
  }

  // Checks to see if the current editor stack (which tracks the current
  // element being parsed in the input XML stream, along with its parent
  // elements) matches any of the passed editor rules.
  #doesStackMatchEditingRule (): ElementToEditInfo | null {
    const topOfStack = this.#parseStack.at(-1)
    // This method is only called after pushing an element to the stack,
    // so this is guaranteed to be true
    assert(topOfStack)

    for (const [selectorRule, editorFunc] of this.#rules.entries()) {
      if (topOfStack.path.matches(selectorRule)) {
        // The depth of the root of this subtree in the stack
        const depth = this.#parseStack.length - 1
        assert(depth >= 0)
        const elmToEdit = this.#parseStack[depth].element
        return { selector: selectorRule, func: editorFunc, element: elmToEdit }
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

  #callUserFuncOnCompletedElementAndWriteToStream (): void {
    assert(this.#elmToEditInfo)
    const clonedElm = this.#elmToEditInfo.element.clone()
    const editElmFunc = this.#elmToEditInfo.func

    try {
      const editedElm = editElmFunc(clonedElm)
      if (editedElm) {
        if (this.#options.validate === true) {
          const [isValid, error] = editedElm.validate()
          if (!isValid) {
            throw error
          }
        }
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
      const newElement = ParsedElement.fromSaxesNode(node)
      this.#pushParsedElementToStack(newElement)
      // Check for case one
      if (this.#isInSubtreeToBeEdited()) {
        return
      }
      // Check for case two, if we're at the root of a subtree to edit.
      const matchingElementInfo = this.#doesStackMatchEditingRule()
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
        const topOfStack = this.#parseStack.at(-1)
        assert(topOfStack)
        topOfStack.element.text = text
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
      const completedStackElement = this.#parseStack.pop()
      const completedElm = completedStackElement?.element
      assert(completedElm)

      // Check for case one
      if (this.#isInSubtreeToBeEdited() === false) {
        // Write the closing tag of the just-completed element
        // to the write stream.
        this.push(toCloseTag(node.name))
        return
      }

      // Check for case two
      assert(this.#elmToEditInfo)
      if (completedElm === this.#elmToEditInfo.element) {
        this.#callUserFuncOnCompletedElementAndWriteToStream()
        return
      }

      // Otherwise, we must be in case three
      const topOfStack = this.#parseStack.at(-1)
      assert(topOfStack)
      topOfStack.element.children.push(completedElm)
    })
  }

  constructor (editingRules: EditingRules, options?: Options) {
    super()
    const defaultOptions = XMLStreamEditorTransformer.defaultOptions
    const mergedOptions = {
      validate: options?.validate ?? defaultOptions.validate,
      saxes: options?.saxes ?? defaultOptions.saxes,
    }

    this.#options = mergedOptions
    this.#rules = new Map<SelectorRule, EditorFunc>()
    for (const [selector, editFunc] of Object.entries(editingRules)) {
      // This will throw if one of the user-provided selectors
      // is invalid.
      const parsedSelector = new SelectorRule(selector)
      this.#rules.set(parsedSelector, editFunc)
    }
    this.#xmlParser = new SaxesParser(this.#options.saxes)
    this.#configureParserCallbacks()
  }

  _transform (chunk: any, encoding: BufferEncoding,
              callback: TransformCallback): void {
    // Don't do any parsing if something threw an error parsing the previous
    // chunk.
    if (this.#error) {
      callback(this.#error)
      return
    }

    this.#xmlParser.write(chunk)

    // And, similarly, don't continuing parsing if we've caught any errors
    // parsing the current chunk. This looks a little redundant, but because
    // the XML from the input stream is parsed asynchronously, this is
    // just an attempt to catch and handle an error as quickly as possible.
    if (this.#error) {
      callback(this.#error)
      return
    }

    callback()
  }
}

// This is the entry point to the library, and is designed / named
// to mirror the naming of transformers in the standard lib
// (e.g., createGzip , createDeflate, etc in the stdlib zlib module,
// or createHmac, createECDH, etc in the stdlib crypto module).
export const createXMLEditor = (rules: EditingRules,
                                options?: Options) => {
  return new XMLStreamEditorTransformer(rules, options)
}
