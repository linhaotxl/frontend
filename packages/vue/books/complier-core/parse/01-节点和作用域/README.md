<!-- TOC -->

- [编译过程](#编译过程)
- [解析](#解析)
- [节点](#节点)
    - [节点类型](#节点类型)
    - [节点定位](#节点定位)
- [作用域](#作用域)
    - [文本模式](#文本模式)

<!-- /TOC -->

## 编译过程  
通过，我们需要将一段模板进行编译，总共需要三个步骤  
1. parse：解析  
2. transform：转换  
3. generate：生成  

每个步骤都非常重要，接下来会根据这三个步骤，从浅到深对源码进行了解  

## 解析  
这个阶段的被称为 “解析”，也就是 “parse”，主要目的就是将字符串的模板，转换为更加具象的 `JS` 对象，也就是 `AST`  
这个 “对象” 被称为节点，我们可以直接操作节点来做更多的事  

## 节点  
节点会有很多类型，不同内容对应不同节点，例如  
* 文本内容 —— 文本节点  
* HTML 元素 —— 元素节点  
...  

总之，在模板中的所有内容，都会有一种节点与之对应  

接下来先看节点的通用结构 `Node`，它并不具体的表示某种类型，但每个节点的结构都会继承它，包含 `Node` 中的属性  

```ts
export interface Node {
    type: NodeTypes     // 节点类型
    loc: SourceLocation // 节点定位
}
```

### 节点类型  
每种节点都会对应一种类型，就是用 `type` 字段来确定，它的值是一个枚举，下面只列出了 “parse” 阶段会用到的类型  

```ts
export const enum NodeTypes {
    ROOT,                   // 根节点
    ELEMENT,                // 元素节点
    TEXT,                   // 文本节点
    COMMENT,                // 注释节点
    SIMPLE_EXPRESSION,      // 简单表达式节点
    INTERPOLATION,          // 插值节点
    ATTRIBUTE,              // 属性节点
    DIRECTIVE,              // 指令节点

    /* ... */
}
```

现在不需要记住每种类型，只需要知道 `type` 表示节点类型即可，在接下来的内容中会一个一个了解  

### 节点定位  
定位：一个节点的内容在整个模板中的位置，它的结构如下  

```ts
export interface SourceLocation {
    start: Position // 节点内容开始位置
    end: Position   // 节点内容结束位置
    source: string  // 对应源代码
}
```
其中，`start` 表示内容开始的位置(即第一个字符的位置)，而 `end` 表示内容结束的位置(即最后一个字符的下一个位置)  
用数学表达式描述 `start` 和 `end`，就是 “左闭右开”，即 `[start, end)`  

我们再来看 “位置”，它表示了一个字符在当前文件中的内容，它的结构如下  
```ts
export interface Position {
    offset: number  // 相对于文件开始的偏移，也可以理解为字符之前的所有字符数，默认为 0
    line: number    // 行数，字符所占第 line 行，默认为 1
    column: number  // 列数，字符所占第 column 列，默认为 1
}
```

接下来举例说明，例如有以下内容  

```html
<div>hello world</div>
```

`div` 的子节点会生成一个文本节点，它的内容就是 `hello world`(长度为 `11`)，这个文本节点的定位如下  

```ts
{
    // 表示 h 的位置
    start: {
        line: 1,
        column: 6,
        offset: 5,
    },
    // 表示 d 的下一个位置，即 <
    end: {
        line: 1,
        column: 17,
        offset: 16,
    },
    content: 'hello world'
}
```

之所以要设计为 “左闭右开”，是为了通过定位获取对应源代码 `source` ，源码中会使用 `String.prototype.slice` 方法，传入 `start` 和 `end` 的 `offset` 来获取  
所以 `end` 要表示为结束的下一个位置  

## 作用域  
在解析一段模板时，首选会创建一个作用域对象，它里面会存储一些与整个模板有关的内容，在整个解析阶段都会用到  
**一段模板只会对应一个作用域**  

先来看创建作用域的配置对象  

```ts
export interface ParserOptions {
    /**
     * 检测是否是平台的原生 tag，例如浏览器下的 <div></div>
     */
    isNativeTag?: (tag: string) => boolean
    /**
     * 检测是否是自闭和 tag，例如浏览器下的 <img />
     */
    isVoidTag?: (tag: string) => boolean
    /**
     * 检测是否是需要保留空白符的 tag，例如浏览器下的 <pre></pre>
     */
    isPreTag?: (tag: string) => boolean
    /**
     * 检测是否是平台内置组件，例如浏览器下的 <transition-group />
     */
    isBuiltInComponent?: (tag: string) => symbol | void
    /**
     * Separate option for end users to extend the native elements list
     */
    isCustomElement?: (tag: string) => boolean | void
    /**
     * 获取命名空间
     */
    getNamespace?: (tag: string, parent: ElementNode | undefined) => Namespace
    /**
     * 获取解析文本的模式
     */
    getTextMode?: (node: ElementNode, parent: ElementNode | undefined) => TextModes
    /**
     * 插值表达式的分隔符，分别是开始符和结束符
     */
    delimiters?: [string, string]
    /**
     * 对特殊字符的解码，例如 &lt; 需要被解析为 <
     */
    decodeEntities?: (rawText: string, asAttr: boolean) => string
    /**
     * 解析错误时的钩子函数
     */
    onError?: (error: CompilerError) => void
    /**
     * 是否需要保留注释节点
     */
    comments?: boolean
}
```

默认的配置对象如下  

```ts
export const defaultParserOptions: MergedParserOptions = {
    delimiters: [`{{`, `}}`],
    getNamespace: () => Namespaces.HTML,
    getTextMode: () => TextModes.DATA,
    isVoidTag: NO,
    isPreTag: NO,
    isCustomElement: NO,
    decodeEntities: (rawText: string): string =>
        rawText.replace(decodeRE, (_, p1) => decodeMap[p1]),
    onError: defaultOnError,
    comments: false
}
```

它的类型是 `MergedParserOptions`，如下  
```ts
type OptionalOptions = 'isNativeTag' | 'isBuiltInComponent'
type MergedParserOptions = Omit<Required<ParserOptions>, OptionalOptions> &
  Pick<ParserOptions, OptionalOptions>
```

可以理解为将 `ParserOptions ` 中除了 `isNativeTag ` 和 `isBuiltInComponent` 外，所有的属性都变为一定存在，因为默认配置对象就缺少了这两个属性  

接下来看看作用域的结构

```ts
export interface ParserContext {
    options: MergedParserOptions    // parse 阶段的配置
    readonly originalSource: string // 原始模板内容，不会被修改
    source: string                  // 模板内容，解析成功一段就会截取一段，最终解析完成就会是空字符串
    offset: number                  // 当前解析位置的偏移
    line: number                    // 当前解析位置的行数
    column: number                  // 当前解析位置的列数
    inPre: boolean                  // 是否处于 pre 标签内，会保留空白内容
    inVPre: boolean                 // 是否处于 v-pre 指令内，不会处理指令和插值表达式
}
```

创建作用域的函数很简单，就是将所有配置进行了合并，返回了作用域对象  

```ts
function createParserContext(
    content: string,					// 模板内容
    rawOptions: ParserOptions	// 配置对象
): ParserContext {
    const options = extend({}, defaultParserOptions)
    for (const key in rawOptions) {
        options[key] = rawOptions[key] || defaultParserOptions[key]
    }
    return {
        options,
        column: 1,
        line: 1,
        offset: 0,
        originalSource: content,
        source: content,
        inPre: false,
        inVPre: false
    }
}
```

### 文本模式  
配置中有一个 “获取解析文本的模式”，它表示以什么模式去解析文本
它的值是枚举 `TextModes`，先来看定义 

```ts
export const enum TextModes {
    //          | Elements | Entities | End sign              | Inside of
    DATA, //    | ✔        | ✔        | End tags of ancestors |
    RCDATA, //  | ✘        | ✔        | End tag of the parent | <textarea>
    RAWTEXT, // | ✘        | ✘        | End tag of the parent | <style>,<script>
    CDATA,
    ATTRIBUTE_VALUE
}
```

接下来先来解释上面出现的关键字  
`Elements`：是否可以解析元素，例如解析 `<div></div>` 等  
`Entities`：是否可以解析实体，例如将 `&lt;` 解析为 `<`  

`DATA` 表示普通模式，也就是该怎么解析就怎么解析，遇到元素解析元素，遇到插值表达式就解析插值表达式，遇到文本解析文本等等  
`RCDATA` 表示文本域模式，只会解析实体，也就是 `textarea` 中的内容会以这种模式解析  
`RAWTEXT` 表示原始文本，什么都不会解析，原样输出，也就是 `script` 里的内容会以这种模式解析  
`CDATA` 表示 `<![CDATA[]]>` 里的文本，也是什么都不会解析，也就是 `CDATA` 中的内容会以这种模式解析  
`ATTRIBUTE_VALUE` 表示属性值，它只有一个地方会用到，就是 `decodeEntities` 配置中的第二个参数，如果解析的是属性值，则第二个参数为 `true`  