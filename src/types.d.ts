import { Transform } from 'node:stream'

import { SaxesOptions } from 'saxes'

export declare interface Element {
  name: string
  text?: string
  attributes: Record<string, string>
  children: Element[]
}

export type Selector = string
export type EditorFunc = (elm: Element) => Element | undefined
export type Config = Record<Selector, EditorFunc>
export declare const newElement: (name: string) => Element
export declare const createXMLEditor: (
  config: Config, saxesOptions?: SaxesOptions) => Transform
