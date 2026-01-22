import xmlescape from 'xml-escape';
export const toAttrValue = (value) => {
    return xmlescape(value);
};
export const toOpenTag = (nodeName, attributes) => {
    let string = '<' + nodeName;
    if (attributes) {
        for (const [attrName, attrValue] of Object.entries(attributes)) {
            string += ` ${attrName}="${xmlescape(attrValue)}"`;
        }
    }
    string += '>';
    return string;
};
export const toCloseTag = (nodeName) => {
    return `</${nodeName}>`;
};
export const toBodyText = (text) => {
    return xmlescape(text);
};
