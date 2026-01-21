import assert from 'node:assert'
import { mkdtemp, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream'

import { parseString } from 'xml2js'

import { makeXMLEditor } from '../built/xml_stream_editor.js'

const createTestFileReadStream = async (filename) => {
  const fd = await open(join(__dirname, 'assets', filename))
  return fd.createReadStream()
}

const createTestFileWriteStreamDetails = async (filename) => {
  const tempDirPath = await mkdtemp('xml-stream-editor')
  const tempFilePath = join(tempDirPath, filename)
  const fd = await open(tempFilePath)
  return {
    stream: fd.createWriteStream(),
    getText: async () => {
      await readFile(tempFilePath, { encoding: 'utf8' })
    },
    remove: async () => {
      await unlink(tempFilePath)
    }
  }
}

const createTestPipeline = async (filename, config) => {
  const readStream = await createTestFileReadStream(filename)
  const writeBits = await createTestFileWriteStreamDetails(filename)
  const transformer = makeXMLEditor(config)
  await pipeline(readStream, transformer, writeBits.stream)

  const resultText = await writeBits.getText()
  const testResults = {
    text: resultText,
    parsed: parseString(resultText)
  }

  await writeBits.remove()
  return testResults 
}

describe('Editing XML streams', () => {
  describe('Changing values', async () => {
    const config = {
      "character": (node) => {
        console.log(node)
      }
    }
    console.log("A")
    const result = await createTestPipeline("sample.xml", config)
    console.log(result)
    // it('Changing an ')
  })
})