import assert from 'node:assert/strict'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { parseString } from 'xml2js'

import { createXMLEditor, newElement } from '../dist/index.js'

const defaultTestFile = './test/assets/sample.xml'

const createTestFileWriteStreamDetails = async () => {
  const tempDirPath = await mkdtemp(join(tmpdir(), 'xml-stream-editor'))
  const randInt = Math.floor(Math.random() * 100000)
  const tempFileName = `output-${randInt}.xml`
  const tempFilePath = join(tempDirPath, tempFileName)
  return {
    stream: createWriteStream(tempFilePath),
    getText: async () => {
      return await readFile(tempFilePath, { encoding: 'utf8' })
    },
    remove: async () => {
      return await unlink(tempFilePath)
    }
  }
}

const stringToXMLObj = async (text) => {
  return new Promise((resolve) => {
    try {
      parseString(text, (err, xmlObj) => {
        const result = {
          error: err,
          text: text,
          obj: xmlObj,
        }
        resolve(result)
      })
    }
    catch (e) {
      resolve({
        error: e,
        text: text,
        obj: null,
      })
    }
  })
}

// The `settings` parameter allows these attributes:
//   - input: string
//     XML file to read (as a stream) for the test. Defaults to
//     test/assets/sample.xml
//   - options: object
//     Optional `Options` settings to pass to the `createXMLEditor` function.
const runTest = async (rules, settings) => {
  const filePath = settings?.input ?? defaultTestFile
  const options = settings?.options
  const readStream = createReadStream(filePath)
  const writeBits = await createTestFileWriteStreamDetails()
  try {
    const transformer = createXMLEditor(rules, options)
    await pipeline(readStream, transformer, writeBits.stream)
    const resultText = await writeBits.getText()
    await writeBits.remove()
    return await stringToXMLObj(resultText)
  }
  catch (e) {
    return {
      error: e,
      text: undefined,
      obj: undefined,
    }
  }
}

const defaultTestFileXMLObj = async () => {
  const defaultText = await readFile(defaultTestFile)
  return await stringToXMLObj(defaultText)
}

describe('XML Stream Editor', () => {
  describe('Empty rule set', () => {
    it('No rule defined', async () => {
      const rules = {}
      const result = await runTest(rules)
      const inputRs = await defaultTestFileXMLObj()

      assert.ifError(result.error)
      assert.equal(JSON.stringify(result.obj), JSON.stringify(inputRs.obj))
    })

    it('Rules that do not match the document', async () => {
      const rules = {
        'does not match anything': (element) => {
          element.text += ' text is edited'
          return element
        }
      }
      const result = await runTest(rules)
      const inputRs = await defaultTestFileXMLObj()

      assert.ifError(result.error)
      assert.equal(JSON.stringify(result.obj), JSON.stringify(inputRs.obj))
    })
  })

  describe('Editing elements', () => {
    it('Edit text of single element ', async () => {
      const rules = {
        'character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.text += ' (edited)'
          }
          return element
        }
      }
      const result = await runTest(rules)
      assert.ifError(result.error)
      assert.match(result.text, /Marge Simpson \(edited\)/)
      const numEditedCount = result.text.match(/\(edited\)/g).length
      assert.equal(numEditedCount, 1)
    })

    it('Edit attribute of single element', async () => {
      const rules = {
        'character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.attributes['target'] = 'set'
          }
          return element
        }
      }
      const result = await runTest(rules)
      assert.ifError(result.error)
      assert.match(result.text, / target="set"/)

      const firstMainChar = result.obj.simpsons.main[0].character[0]
      assert.equal(firstMainChar.$.target, 'set')
    })

    it('Remove element', async () => {
      const rules = {
        'main character': (element) => {
          if (element.text !== 'Marge Simpson') {
            return element
          }
        }
      }

      const result = await runTest(rules)
      const inputRs = await defaultTestFileXMLObj()

      assert.ifError(result.error)
      assert.doesNotMatch(result.text, /Marge Simpson/)

      // In the input file, Marge Simpson is the first character element,
      // and Homer Simpson is the second
      const characterElm = result.obj.simpsons.main[0].character
      const firstMainChar = characterElm[0]
      assert.equal(firstMainChar._, 'Homer Simpson')

      const numCharactersStart = inputRs.obj.simpsons.main[0].character.length
      const numCharactersInEdit = characterElm.length
      assert.equal(numCharactersStart, numCharactersInEdit + 1)
    })

    describe('Adding child elements', () => {
      it('Using "legacy" `newElement` func' , async () => {
        const rules = {
          'main character': (element) => {
            if (element.text === 'Marge Simpson') {
              const newChild = newElement('AddedElement')
              newChild.attributes['new-attr'] = 'new value'
              newChild.text = 'newly added child'
              element.children.push(newChild)
            }
            return  element
          }
        }
        const result = await runTest(rules)
        assert.ifError(result.error)

        const margeElm = result.obj.simpsons.main[0].character[0]
        assert.equal(margeElm.AddedElement.length, 1)

        const addedElm = margeElm.AddedElement[0]
        assert.equal(addedElm._, 'newly added child')
        assert.equal(addedElm.$['new-attr'], 'new value')
      })

      it('Using Element constructor', async () => {
        const rules = {
          main: (element) => {
            const newChild = newElement('character')
            newChild.text = 'Santa\'s Little Helper'
            newChild.attributes['species'] = 'doggo'
            element.children.push(newChild)
            return element
          }
        }

        const result = await runTest(rules)
        assert.ifError(result.error)

        const characterElms = result.obj.simpsons.main[0].character
        assert.equal(characterElms.length, 6)

        const lastCharacter = characterElms.at(-1)
        assert.equal(lastCharacter._, 'Santa\'s Little Helper')
        assert.equal(lastCharacter.$['species'], 'doggo')
      })
    })
  })

  describe('Validation', () => {
    it('Invalid element name', async () => {
      const rules = {
        'main character': (element) => {
          if (element.text === 'Marge Simpson') {
            return newElement('name with space in it')
          }
          return  element
        }
      }

      assert.rejects(async () => {
        await runTest(rules)
      })
    })

    it('Invalid attribute name', async () => {
      const rules = {
        'main character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.attributes['*a^'] = 'bad attribute name'
          }
          return  element
        }
      }

      assert.rejects(async () => {
        await runTest(rules)
      })
    })

    it('Disabling validation allows invalid element names', async () => {
      const rules = {
        'main character': (element) => {
          if (element.text === 'Marge Simpson') {
            const newElm = newElement('bad name')
            newElm.text = "inner text"
            return newElm
          }
          return element
        }
      }
      const settings = {
        options: {
          validate: false
        }
      }

      const result = await runTest(rules, settings)
      assert.ok(result.error)
      assert.match(result.text, /<bad name>inner text<\/bad name>/)
    })

    it('Disabling validation allows invalid attribute names', async () => {
      const rules = {
        'main character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.attributes['*a^'] = 'bad attribute name'
          }
          return  element
        }
      }
      const settings = {
        options: {
          validate: false
        }
      }

      const result = await runTest(rules, settings)
      assert.ok(result.error)
      assert.match(result.text, /\*a\^="bad attribute name">Marge/)
    })
  })

  describe('Selectors', () => {
    it('Different functions for non-overlapping selectors are applied', async () => {
      const rules = {
        'main character': (element) => {
          element.text += ' (main)'
          return element
        },
        'side character': (element) => {
          element.text += ' (side)'
          return element
        }
      }

      const result = await runTest(rules)
      assert.ifError(result.error)

      const numMainElementsEdited = result.text.match(/\(main\)/g).length
      assert.equal(numMainElementsEdited, 5)

      const numSideElementsEdited = result.text.match(/\(side\)/g).length
      assert.equal(numSideElementsEdited, 2)
    })

    it('For overlapping selectors, selector matching most-parent element is called', async () => {
      const rules = {
        'simpsons main character': (element) => {
          element.text = '(parent-rule)'
          return element
        },
        'main character': (element) => {
          element.text = '(middle-rule)'
          return element
        },
      }

      const result = await runTest(rules)
      assert.ifError(result.error)

      const numParentMatches = result.text.match(/\(parent-rule\)/g).length
      assert.equal(5, numParentMatches)

      assert.doesNotMatch(result.text, /\(middle-rule\)/)
    })

    it('Single-element selectors match all elements of that name', async () => {
      let characterCount = 0
      const rules = {
        character: (elm) => {
          characterCount += 1
          elm.text += ` (character: ${characterCount})`
          return elm
        }
      }

      const result = await runTest(rules)
      assert.ifError(result.error)

      const numExpectedCharacters = 7
      const numCharacterCloseTags = result.text.match(/<\/character>/g).length
      assert.equal(numExpectedCharacters, numCharacterCloseTags)

      let characterIndex = 0
      while (characterIndex < numExpectedCharacters) {
        characterIndex += 1
        const expectedText = `(character: ${characterIndex})<`
        assert.ok(result.text.includes(expectedText))
      }
    })

    // This test checks that a selector like "suffix" does not match an
    // element <prefix-suffix> (which in 0.2.0 and earlier could happen
    // in some parse stack states).
    it('Do not match if selector matches an element name suffix', async () => {
      const rules = {
        // We are testing to make sure this does NOT match
        // "<main> <character>".
        'in character': (elm) => {
          elm.text += ' (matched selector in character)'
          return elm
        },
        'side character': (elm) => {
          elm.text += ' (matched selector side character)'
          return elm
        }
      }

      const result = await runTest(rules)
      assert.ifError(result.error)
      const xmlText = result.text

      const inCharacterPattern = /\(matched selector in character\)/g
      const numInCharMatches = xmlText.match(inCharacterPattern)?.length || 0
      assert.equal(numInCharMatches, 0)

      const sideCharacterPattern = /\(matched selector side character\)/g
      const numSideCharMatches = xmlText.match(sideCharacterPattern)?.length
      assert.equal(numSideCharMatches, 2)
    })

    it('Throw on invalid element names in a selector', async () => {
      const badSelector = 'bad!name'
      const rules = {
        [badSelector]: (elm) => {
          elm.text = 'should never happen'
          return elm
        }
      }

      const result = await runTest(rules)
      assert.ok(result.error)
      assert.ok(result.error.message.includes(badSelector))
    })
  })
})