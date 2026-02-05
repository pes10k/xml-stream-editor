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

import { ElementName } from './element.js'

// Single character string that cannot appear in XML element names.
const elmNameSeparator = '@'

// Simple class used for describing elements in an XML document, similar to
// (but much simpler than) XPath rules or CSS selectors.
//
// The syntax is super basic. ElementPath rules are strings containing
// the names of XML elements, separated by spaces. Each element name, left
// to right, describes the immediate parent of the next element, and the
// rule describes the right most element.
//
// So, the rule "a b c" would match the <c> element in the document
// <a><b><c /></b></a>, and would match nothing in the documents <b><c/><b>
// or <a><b><b2><c /></b2></b></a>.
export class ElementPath {
  readonly text: string
  readonly segments: ElementName[]
  readonly forMatching: string

  static parse (text: string): [boolean, ElementName[] | Error] {
    // First, normalize the rule by collapsing runs of whitespace.
    const normalizedRule = text.trim().replace(/ +/g, ' ')
    const segments: ElementName[] = []
    for (const anElmName of normalizedRule.split(' ')) {
      if (xnv.name(anElmName) !== true) {
        const msg = `ElementPath "${text}" contains invalid name "${anElmName}"`
        return [false, new Error(msg)]
      }
      segments.push(anElmName)
    }

    return [true, segments]
  }

  // Constructor can be called in two forms.
  //
  // One, being passed a string, encoding an element path, something like
  //   "parent-element child-element". This is the main way to crete
  //   am ElementPath object. This method will *throw* if the
  //   the rule is invalid (such as if one of the element names in the string
  //   is an invalid XML element name).
  //
  // Two, with an existing ElementPath instance, and then additional
  //   element names / segments to append to it. This form allows skipping
  //   the need to parse a string, and exists mainly for `appendName()`
  //   method. In this form, the additional element names are *not* validated.
  //
  // Parses the element path rule string, and throws if the rule is invalid,
  // such as the rule containing an invalid XML element name.
  constructor (textOrElementPath: string | ElementPath,
               ...names: ElementName[]) {
    if (typeof textOrElementPath === 'string') {
      const [isValid, result] = ElementPath.parse(textOrElementPath)
      if (!isValid) {
        throw result
      }
      this.text = textOrElementPath
      this.segments = result as ElementName[]
      this.forMatching = this.segments.map(x => elmNameSeparator + x).join('')
      return
    }

    this.text = textOrElementPath.text + ' ' + names.join(' ')
    this.segments = textOrElementPath.segments.concat(names)
    this.forMatching = textOrElementPath.forMatching
      + names.map(x => elmNameSeparator + x).join('')
  }

  appendName (elmName: ElementName): ElementPath {
    return new ElementPath(this, elmName)
  }

  // Returns `true` if this element path matches the right-most / leaf
  // child-most / etc element in the `path` instance.
  matches (path: ElementPath): boolean {
    return this.forMatching.endsWith(path.forMatching)
  }
}
