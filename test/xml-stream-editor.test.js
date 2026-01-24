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
    parseString(text, (err, xmlObj) => {
      const result = {
        error: err,
        text: text,
        obj: xmlObj,
      }
      resolve(result)
    })
  })
}

const runTest = async (config, optionalFilePath) => {
  const filePath = optionalFilePath || defaultTestFile
  const readStream = createReadStream(filePath)
  const writeBits = await createTestFileWriteStreamDetails()
  const transformer = createXMLEditor(config)

  await pipeline(readStream, transformer, writeBits.stream)
  const resultText = await writeBits.getText()
  await writeBits.remove()
  return await stringToXMLObj(resultText)
}

const defaultTestFileXMLObj = async () => {
  const defaultText = await readFile(defaultTestFile)
  return await stringToXMLObj(defaultText)
}

describe('XML Stream Editor', () => {
  describe('No editing rules', () => {
    it('empty config', async () => {
      const config = {}
      const result = await runTest(config)
      const inputRs = await defaultTestFileXMLObj()

      assert.ifError(result.error)
      assert.equal(JSON.stringify(result.obj), JSON.stringify(inputRs.obj))
    })

    it('Editing rules match nothing', async () => {
      const config = {
        'does not match anything': (element) => {
          element.text += ' text is edited'
          return element
        }
      }
      const result = await runTest(config)
      const inputRs = await defaultTestFileXMLObj()

      assert.ifError(result.error)
      assert.equal(JSON.stringify(result.obj), JSON.stringify(inputRs.obj))
    })
  })

  describe('Editing elements', () => {
    it('Edit text of single element ', async () => {
      const config = {
        'character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.text += ' (edited)'
          }
          return element
        }
      }
      const result = await runTest(config)
      assert.ifError(result.error)
      assert.match(result.text, /Marge Simpson \(edited\)/)
      const numEditedCount = result.text.match(/\(edited\)/g).length
      assert.equal(numEditedCount, 1)
    })

    it('Edit attribute of single element', async () => {
      const config = {
        'character': (element) => {
          if (element.text === 'Marge Simpson') {
            element.attributes['target'] = 'set'
          }
          return element
        }
      }
      const result = await runTest(config)
      assert.ifError(result.error)
      assert.match(result.text, / target="set"/)

      const firstMainChar = result.obj.simpsons.main[0].character[0]
      assert.equal(firstMainChar.$.target, 'set')
    })

    it('Remove element', async () => {
      const config = {
        'main character': (element) => {
          if (element.text !== 'Marge Simpson') {
            return element
          }
        }
      }

      const result = await runTest(config)
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

    it('Add child element', async () => {
      const config = {
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
      const result = await runTest(config)
      assert.ifError(result.error)

      const margeElm = result.obj.simpsons.main[0].character[0]
      assert.equal(margeElm.AddedElement.length, 1)

      const addedElm = margeElm.AddedElement[0]
      assert.equal(addedElm._, 'newly added child')
      assert.equal(addedElm.$['new-attr'], 'new value')
    })

    it('Error on invalid element name', async () => {
      const config = {
        'main character': (element) => {
          if (element.text === 'Marge Simpson') {
            return newElement('name with space in it')
          }
          return  element
        }
      }

      assert.rejects(async () => {
        await runTest(config)
      })
    })
  })

  describe('Multiple rules', () => {
    it('Non-overlapping rules are all applied', async () => {
      const config = {
        'main character': (element) => {
          element.text += ' (main)'
          return element
        },
        'side character': (element) => {
          element.text += ' (side)'
          return element
        }
      }

      const result = await runTest(config)
      assert.ifError(result.error)

      const numMainElementsEdited = result.text.match(/\(main\)/g).length
      assert.equal(numMainElementsEdited, 5)

      const numSideElementsEdited = result.text.match(/\(side\)/g).length
      assert.equal(numSideElementsEdited, 2)
    })

    it('When rules overlap, only parent rule is applied', async () => {
      const config = {
        'simpsons main character': (element) => {
          element.text = '(parent-rule)'
          return element
        },
        'main character': (element) => {
          element.text = '(middle-rule)'
          return element
        },
      }

      const result = await runTest(config)
      assert.ifError(result.error)

      const numParentMatches = result.text.match(/\(parent-rule\)/g).length
      assert.equal(5, numParentMatches)

      assert.doesNotMatch(result.text, /\(middle-rule\)/)
    })
  })
})