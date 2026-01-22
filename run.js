#!/usr/bin/env node

import { mkdtemp, open, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { parseStringPromise } from 'xml2js'

import { makeXMLEditor } from './dist/xml-stream-editor.js'

const createTestFileReadStream = async (filename) => {
  const fd = await open(join('test', 'assets', filename))
  return fd.createReadStream()
}

const createTestFileWriteStreamDetails = async (filename) => {
  const tempDirPath = await mkdtemp(join(tmpdir(), 'xml-stream-editor'));
  const tempFilePath = join(tempDirPath, filename)
  const fd = await open(tempFilePath, 'w')
  return {
    stream: fd.createWriteStream(),
    getText: async () => {
      return await readFile(tempFilePath, { encoding: 'utf8' })
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
  await writeBits.stream.close()

  const resultText = await writeBits.getText()
  const testResults = {
    text: resultText,
    parsed: await parseStringPromise(resultText)
  }

  await writeBits.remove()
  return testResults 
}

(async () => {
  const config = {
    "character": (node) => {
      node.text += " hi"
      return node
    }
  }

  const result = await createTestPipeline("sample.xml", config)
  console.log(result.text)
})()