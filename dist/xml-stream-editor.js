import { strict as assert } from 'node:assert';
import { Transform } from 'node:stream';
import { SaxesParser } from 'saxes';
import { toAttrValue, toBodyText, toCloseTag, toOpenTag } from './markup.js';
class Element {
    name;
    text;
    attributes = {};
    children = [];
    static newForName(name, attrs) {
        return new Element(name, attrs);
    }
    static newForNode(node) {
        // Here we check if each attribute name is simple (and so just a
        // string), or in the namespace representation the "saxes" library
        // uses (in which case attrValue will be a SaxesAttributeNS
        // object, that we have to unpack a bit)
        const attributes = {};
        if (node.attributes) {
            for (const [attrName, attrValue] of Object.entries(node.attributes)) {
                if (typeof attrValue === 'string') {
                    attributes[attrName] = attrValue;
                    continue;
                }
                attributes[attrValue.name] = attrValue.value;
            }
        }
        return new Element(node.name, attributes);
    }
    constructor(name, attributes) {
        this.name = name;
        if (attributes) {
            this.attributes = attributes;
        }
    }
    addChild(elm) {
        this.children.push(elm);
    }
    removeChild(elm) {
        const indexOfChild = this.children.indexOf(elm);
        if (indexOfChild === -1) {
            return false;
        }
        this.children.splice(indexOfChild, 1);
        return true;
    }
}
class XMLEditorTransformer extends Transform {
    // Used to mirror the XML tree as its being parsed. Only used to keep track
    // of when we're parsing (and so buffering) a subtree in the XML document
    // that will be edited when the entire subtree is parsed.
    #elmStack = [];
    // This is a map of (VERY) simple xpaths (i.e., only XML element names;
    // no attributes, no name spaces, etc).
    #config;
    // Handle to the 'saxes' xml parser object.
    #xmlParser;
    // References to the depth of the stack where a to-be-edited subtree starts,
    // the function that's been registered to do that editing,
    // and the element that is the root of the subtree to be edited (we need
    // this second reference to it, outside the stack, so that we still have
    // a handle to the child elements after they've been pop'ed off the stack).
    #subtreeToEditFunc;
    #subtreeToEdit;
    // Store any errors we've been passed by the saxes parser so that we
    // can pass it along in the transformer callback next time we get data.
    #error;
    #isAtRootOfSubtreeToEdit() {
        const currentElementPath = this.#elmStack.map(x => x.name).join(' ');
        for (const [editorFuncPath, editorFunc] of Object.entries(this.#config)) {
            if (currentElementPath.endsWith(editorFuncPath)) {
                // The depth of the root of this subtree in the stack
                const subtreeDepth = this.#elmStack.length - 1;
                assert(subtreeDepth >= 0);
                return { depth: subtreeDepth, path: editorFuncPath, func: editorFunc };
            }
        }
        return null;
    }
    #isInSubtreeToBeEdited() {
        return this.#subtreeToEdit !== undefined;
    }
    #writeElementToStream(element) {
        this.push(toOpenTag(element.name));
        for (const childElm of element.children) {
            this.#writeElementToStream(childElm);
        }
        if (element.text) {
            this.push(toBodyText(element.text));
        }
        this.push(toCloseTag(element.name));
    }
    #writeSubtreeToStream() {
        assert(this.#subtreeToEdit);
        assert(this.#subtreeToEditFunc);
        const editedSubtreeElm = this.#subtreeToEditFunc(this.#subtreeToEdit);
        this.#writeElementToStream(editedSubtreeElm);
        // And now clear related state
        this.#subtreeToEditFunc = undefined;
        this.#subtreeToEdit = undefined;
    }
    #configureParserCallbacks() {
        this.#xmlParser.on('opentag', (node) => {
            // When we hit a new XML opening tag, the following cases are possible:
            //
            // 1. We're a CHILD in a subtree to be edited, in which case we can
            //    avoid a little work and just append ourselves to the stack.
            // 2. We are the ROOT of an subtree to be edited, in which case we
            //    note the current callback function we'll eventually get passed to,
            //    and append ourselves to the stack.
            // 3. We are NOT the root of a subtree to be edited, in which case
            //    we just add ourselves to the stack.
            const newElement = Element.newForNode(node);
            this.#elmStack.push(newElement);
            // Check for case one
            if (this.#isInSubtreeToBeEdited()) {
                return;
            }
            // Check for case two, if we're at the root of a subtree to edit.
            const editorFuncInfo = this.#isAtRootOfSubtreeToEdit();
            if (editorFuncInfo !== null) {
                this.#subtreeToEditFunc = editorFuncInfo.func;
                this.#subtreeToEdit = newElement;
                return;
            }
            // Otherwise we're in case three, so print out the opening tag
            // immediately.
            this.push(toOpenTag(newElement.name, newElement.attributes));
        });
        this.#xmlParser.on('text', (text) => {
            // There are two possible cases here
            //
            // 1. We're in a subtree to be edited, in which case we buffer
            //    the text, or
            // 2. We're not in the subtree being edited, in which case we can
            //    print the text out immediately.
            // Check for case one
            if (this.#isInSubtreeToBeEdited()) {
                const topOfStack = this.#elmStack.at(-1);
                assert(topOfStack);
                topOfStack.text = text;
                return;
            }
            // Otherwise we're in case two, and can print the text out immediately.
            this.push(toBodyText(text));
        });
        this.#xmlParser.on('xmldecl', (decl) => {
            let xmlDecl = '<?xml version="1.0"';
            if (decl.encoding) {
                xmlDecl += ` encoding="${toAttrValue(decl.encoding)}"`;
            }
            if (decl.standalone) {
                xmlDecl += ` standalone="${toAttrValue(decl.standalone)}"`;
            }
            xmlDecl += '?>';
            this.push(xmlDecl + '\n');
        });
        this.#xmlParser.on('error', (error) => {
            this.#error = error;
        });
        this.#xmlParser.on('closetag', (node) => {
            // When we hit an XML element's close tag, three cases are possible.
            //
            // 1. We've completed a node that is NOT in a subtree with an assigned
            //    editing function. In that case we write the element as XML
            //    to the write stream and pop it off the stack.
            // 2. We've completed a ROOT NODE in a subtree being edited,
            //    in which case we pass that buffered subtree to the registered
            //    editing function, write the modified subtree as XML to the
            //    write stream, loose the reference to the buffered subtree,
            //    and pop the element off the stack too.
            // 3. We've completed a CHILD NODE in a subtree being edited,
            //    in which case we append this node to our buffered subtree
            //    and pop it off the stack.
            const completedElm = this.#elmStack.pop();
            assert(completedElm);
            // Check for case one
            if (this.#isInSubtreeToBeEdited() === false) {
                this.push(toCloseTag(node.name));
                return;
            }
            // Check for case two
            if (completedElm === this.#subtreeToEdit) {
                this.#writeSubtreeToStream();
                return;
            }
            // Otherwise, we must be in case three
            assert(this.#elmStack.length > 0);
            this.#elmStack.at(-1)?.addChild(completedElm);
        });
    }
    constructor(config, saxesOptions) {
        super();
        this.#config = config;
        this.#xmlParser = new SaxesParser(saxesOptions);
        this.#configureParserCallbacks();
    }
    _transform(chunk, encoding, callback) {
        if (this.#error) {
            callback(this.#error);
            return;
        }
        this.#xmlParser.write(chunk);
        if (this.#error) {
            callback(this.#error);
            return;
        }
        callback();
    }
}
export const makeXMLEditor = (config, saxesOptions) => {
    return new XMLEditorTransformer(config, saxesOptions);
};
