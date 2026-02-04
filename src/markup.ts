import xmlescape from 'xml-escape'

export const toAttrValue = (value: string): string => {
  return xmlescape(value)
}

export const toOpenTag = (nodeName: string,
                          attributes?: Record<string, string>): string => {
  let string = '<' + nodeName
  if (attributes) {
    for (const [attrName, attrValue] of Object.entries(attributes)) {
      string += ` ${attrName}="${xmlescape(attrValue)}"`
    }
  }
  string += '>'
  return string
}

export const toCloseTag = (nodeName: string): string => {
  return `</${nodeName}>`
}

export const toBodyText = (text: string) => {
  return xmlescape(text)
}
