// Represents the user provided selector strings, for defining which
// XML elements in the XML document they want to edit.
//
// We modify the (simplified) XML paths used to i. allow user to define
// which XML elements they want to edit, and ii. track the position of
// each parsed XML element in the incoming XML document.
//
// This allows us to quickly check whether a user-provided "selector"
// string matches the current XML parse stack with a simple .endsWith()
// call (specifically pathToJustParsedXMLElement.endsWith(userProvidedSelector).
import xnv from 'xml-name-validator'

import { Selector } from './types.js'

// Single character string that cannot appear in XML element names.
const pathSeparator = '@'

// The modified, "internal" version of the user-provided selector strings
// and paths to each element in the parse stack. Really just
// prefixing and replacing spaces in each element path with the above
// "invalid xml element name" string. So, given the the simple XML document:
//
// <parent><child></child></parent>
//
// the user-provided selector "parent child" would match the <child> node.
// And we'd track that selector as "@parent@child".
type PathForMatching = string

type validationResult = [boolean, Error | undefined]

const process = (elementPath: string): PathForMatching => {
  const collapsedWhiteSpace = elementPath.trim().replace(/ +/g, ' ')
  return collapsedWhiteSpace.split(' ').map(x => pathSeparator + x).join('')
}

const validate = (selector: Selector): validationResult => {
  for (const elmName of selector.split(' ')) {
    if (xnv.name(elmName) === true) {
      continue
    }
    const msg = `Selector "${selector}" contains invalid name "${elmName}"`
    return [false, new Error(msg)]
  }
  return [true, undefined]
}

// Simple class used for tracking the path to an element in an XML document,
// when parsing the XML document.
//
// Mostly this is just wrapping how we track the position of each element
// in the XML document as we're parsing it, and annotating that path
// in a way that makes it easy to check if a SelectorRule matches the
// leaf-element in that path.
export class ElementPath {
  readonly path: string
  readonly pathForMatching: PathForMatching

  constructor (path: string) {
    this.path = path
    this.pathForMatching = process(path)
  }

  append (elmName: string): ElementPath {
    return new ElementPath(this.path + ' ' + elmName)
  }

  matches (selector: SelectorRule): boolean {
    return this.pathForMatching.endsWith(selector.text)
  }
}

export class SelectorRule {
  readonly text: Selector
  readonly pathForMatching: PathForMatching

  constructor (selector: Selector) {
    const [isValid, err] = validate(selector)
    if (!isValid) {
      throw err
    }
    this.text = process(selector)
    this.pathForMatching = process(this.text)
  }
}
