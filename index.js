// 配合parse2，将HTML代码转为ast
var ElementType = require("domelementtype");

var re_whitespace = /\s+/g;
var NodePrototype = require("./lib/node");
var ElementPrototype = require("./lib/element");

function DomHandler(callback, options, elementCB){
	// 对重载处理，分为 DomHandler(callback: (error: Error, ast: any)=>void, options: object, elementCB: function)、DomHandler(options: object, elementCB: function)、 DomHandler(callback: function, elementCB: function)
	if(typeof callback === "object"){
		elementCB = options;
		options = callback;
		callback = null;
	} else if(typeof options === "function"){
		elementCB = options;
		options = defaultOpts;
	}

	// 会有多次调用_callback的可能性吗？
	this._callback = callback;
	this._options = options || defaultOpts;
	this._elementCB = elementCB;
	// DOM树的数组
	this.dom = [];
	this._done = false;
	// 当前DOM树的栈，会随着opentag和closetag进栈出栈。主要用于协助生成DOM树
	this._tagStack = [];
	this._parser = this._parser || null;
}

//default options
var defaultOpts = {
	// 是否应对文本节点中的空白进行规范化（所有空格都应替换为单个空格）。
	normalizeWhitespace: false, //Replace all whitespace with single spaces
	// 是否有startIndex
	withStartIndices: false, //Add startIndex properties to nodes
	// 是否有endIndex
	withEndIndices: false, //Add endIndex properties to nodes
	// 将DOM级别1属性添加到所有元素。
	// withDomLvl1: false
};

DomHandler.prototype.onparserinit = function(parser){
	this._parser = parser;
};

// 重新初始化一次
DomHandler.prototype.onreset = function(){
	DomHandler.call(this, this._callback, this._options, this._elementCB);
};

// 结束
DomHandler.prototype.onend = function(){
	if(this._done) return;
	this._done = true;
	this._parser = null;
	this._handleCallback(null);
};

// 对错误处理
DomHandler.prototype._handleCallback =
DomHandler.prototype.onerror = function(error){
	// 一旦发现错误，会立刻终吗？
	if(typeof this._callback === "function"){
		this._callback(error, this.dom);
	} else {
		if(error) throw error;
	}
};

DomHandler.prototype.onclosetag = function(){
	//if(this._tagStack.pop().name !== name) this._handleCallback(Error("Tagname didn't match!"));
	
	var elem = this._tagStack.pop();

	if(this._options.withEndIndices && elem){
		elem.endIndex = this._parser.endIndex;
	}

	if(this._elementCB) this._elementCB(elem);
};

// 创建element或者node的ast节点
DomHandler.prototype._createDomElement = function(properties){
	if (!this._options.withDomLvl1) return properties;

	var element;
	if (properties.type === "tag") {
		element = Object.create(ElementPrototype);
	} else {
		element = Object.create(NodePrototype);
	}

	for (var key in properties) {
		if (properties.hasOwnProperty(key)) {
			element[key] = properties[key];
		}
	}

	return element;
};

DomHandler.prototype._addDomElement = function(element){
	var parent = this._tagStack[this._tagStack.length - 1];
	// 如果没有父节点，就直接创建新树
	var siblings = parent ? parent.children : this.dom;
	var previousSibling = siblings[siblings.length - 1];

	element.next = null;

	if(this._options.withStartIndices){
		element.startIndex = this._parser.startIndex;
	}
	if(this._options.withEndIndices){
		element.endIndex = this._parser.endIndex;
	}

	if(previousSibling){
		element.prev = previousSibling;
		previousSibling.next = element;
	} else {
		element.prev = null;
	}

	siblings.push(element);
	element.parent = parent || null;
};

// 打开标签
DomHandler.prototype.onopentag = function(name, attribs){
	var properties = {
		type: name === "script" ? ElementType.Script : name === "style" ? ElementType.Style : ElementType.Tag,
		name: name,
		attribs: attribs,
		children: []
	};

	// 创建一个element的节点对象
	var element = this._createDomElement(properties);

	// 加入当前DOM树中
	this._addDomElement(element);

	// 创建完会压栈
	this._tagStack.push(element);
};

DomHandler.prototype.ontext = function(data){
	//the ignoreWhitespace is officially dropped, but for now,
	//it's an alias for normalizeWhitespace
	var normalize = this._options.normalizeWhitespace || this._options.ignoreWhitespace;

	var lastTag;

	if(!this._tagStack.length && this.dom.length && (lastTag = this.dom[this.dom.length-1]).type === ElementType.Text){
		// 如果已经存在了一个文本节点，则在给文档节点中append新内容
		if(normalize){
			lastTag.data = (lastTag.data + data).replace(re_whitespace, " ");
		} else {
			lastTag.data += data;
		}
	} else {
		if(
			this._tagStack.length &&
			(lastTag = this._tagStack[this._tagStack.length - 1]) &&
			(lastTag = lastTag.children[lastTag.children.length - 1]) &&
			lastTag.type === ElementType.Text
		){
			if(normalize){
				lastTag.data = (lastTag.data + data).replace(re_whitespace, " ");
			} else {
				lastTag.data += data;
			}
		} else {
			// 创建一个文本节点对象
			if(normalize){
				data = data.replace(re_whitespace, " ");
			}

			var element = this._createDomElement({
				data: data,
				type: ElementType.Text
			});

			this._addDomElement(element);
		}
	}
};

DomHandler.prototype.oncomment = function(data){
	var lastTag = this._tagStack[this._tagStack.length - 1];

	if(lastTag && lastTag.type === ElementType.Comment){
		lastTag.data += data;
		return;
	}

	var properties = {
		data: data,
		type: ElementType.Comment
	};

	var element = this._createDomElement(properties);

	this._addDomElement(element);
	this._tagStack.push(element);
};

DomHandler.prototype.oncdatastart = function(){
	var properties = {
		children: [{
			data: "",
			type: ElementType.Text
		}],
		type: ElementType.CDATA
	};

	var element = this._createDomElement(properties);

	this._addDomElement(element);
	this._tagStack.push(element);
};

DomHandler.prototype.oncommentend = DomHandler.prototype.oncdataend = function(){
	this._tagStack.pop();
};
// ???
DomHandler.prototype.onprocessinginstruction = function(name, data){
	var element = this._createDomElement({
		name: name,
		data: data,
		type: ElementType.Directive
	});

	this._addDomElement(element);
};

module.exports = DomHandler;
