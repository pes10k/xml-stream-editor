import { SaxesOptions, TagForOptions } from 'saxes'

import xnv from 'xml-name-validator'

type SaxesNode = TagForOptions<SaxesOptions>

const isValidName = xnv.qname

export type ElementAttributes = Record<string, string>
export type ElementName = string

export class Element {
  attributes: ElementAttributes
  children: Element[] = []
  name: ElementName
  text?: string

  constructor (name: ElementName, attributes?: ElementAttributes) {
    this.name = name
    this.attributes = attributes
      ? JSON.parse(JSON.stringify(attributes))
      : Object.create(null)
  }

  validate (): [boolean, Error | undefined] {
    if (typeof this.name !== 'string') {
      return [false, new Error('No name provided for element')]
    }

    if (!isValidName(this.name)) {
      return [false, new Error(`"${this.name}" is not a valid element name`)]
    }

    if (typeof this.attributes !== 'object' || this.attributes === null) {
      return [false, new Error('"attributes" property is not an object')]
    }

    for (const attrName of Object.keys(this.attributes)) {
      if (!isValidName(attrName)) {
        return [false, new Error(`"${attrName}" is not a valid attribute name`)]
      }
    }

    for (const child of this.children) {
      const [isChildValid, childError] = child.validate()
      if (!isChildValid) {
        return [false, childError]
      }
    }
    return [true, undefined]
  }
}

export class ParsedElement extends Element {
  children: ParsedElement[] = []

  static fromSaxesNode (node: SaxesNode): ParsedElement {
    // Here we check if each attribute name is simple (and so just a
    // string), or in the namespace representation the "saxes" library
    // uses (in which case attrValue will be a SaxesAttributeNS
    // object, that we have to unpack a bit)
    const attributes: ElementAttributes = Object.create(null)
    if (node.attributes) {
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        if (typeof attrValue === 'string') {
          attributes[attrName] = attrValue
          continue
        }
        attributes[attrValue.name] = attrValue.value
      }
    }
    return new ParsedElement(node.name, attributes)
  }

  clone (): ParsedElement {
    const cloneElm = new ParsedElement(this.name, this.attributes)
    cloneElm.text = this.text
    cloneElm.children = []
    for (const aChildElm of this.children) {
      cloneElm.children.push(aChildElm.clone())
    }
    return cloneElm
  }
}

export const newElement = (name: ElementName,
                           attributes?: ElementAttributes): Element => {
  return new Element(name, attributes)
}
