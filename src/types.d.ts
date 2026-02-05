import { Transform } from 'node:stream'

import { SaxesOptions } from 'saxes'

export declare class Element {
  constructor (name: string, attributes?: Record<string, string>)
  attributes: Record<string, string>
  children: Element[]
  name: string
  text?: string
}

export declare interface Options {
  // Whether to check and enforce the validity of created and modified
  // XML element names and attributes. If true, will throw an error
  // if you create an XML element with a disallowed name (e.g.,
  // <no spaces allowed>) or with an invalid attribute name
  // (<my-elm a:b:c="too many namespaces" d@y="no @ in attr names">)
  //
  // This only checks the syntax of the XML element names and attributes.
  // It does not perform any further validation, like if used namespaces
  // are valid.
  //
  // default: `true`
  validate: boolean // true

  // Options defined by the "saxes" library, and passed to the "saxes" parser
  //
  // eslint-disable-next-line max-len
  // https://github.com/lddubeau/saxes/blob/4968bd09b5fd0270a989c69913614b0e640dae1b/src/saxes.ts#L557
  // https://www.npmjs.com/package/saxes
  saxes?: SaxesOptions
}

// Rules used to specify which XML elements to edit
export type Selector = string
// Functions that receive and can edit the XML elements that match a
// corresponding `Selector` string.
export type EditorFunc = (elm: Element) => Element | undefined
// User provided mapping specifying "I want to edit the XML elements that match
// <key> selector rule with <value> function."
export type EditingRules = Record<Selector, EditorFunc>
// Convenience function to call when you want to create a new child node
// in the document.
export declare const newElement: (name: string) => Element
export declare const createXMLEditor: (
  editingRules: EditingRules, options?: Options) => Transform
