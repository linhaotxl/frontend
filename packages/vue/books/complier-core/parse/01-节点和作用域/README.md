<!-- TOC -->

- [编译过程](#编译过程)
- [解析](#解析)
- [节点](#节点)
    - [节点类型](#节点类型)
    - [节点定位](#节点定位)
- [作用域](#作用域)
    - [文本模式](#文本模式)
    - [命名空间](#命名空间)

<!-- /TOC -->

## 编译过程  
通过，我们需要将一段模板进行编译，总共需要三个步骤  
1. parse：解析  
2. transform：转换  
3. generate：生成  

每个步骤都非常重要，接下来会根据这三个步骤，从浅到深对源码进行了解  

## 解析  
这个阶段主要是将字符串的模板，解析为更加具象的 `JS` 对象，也就是 `AST` 节点，之后我们可以直接操作 `AST` 节点来做更多的事  

## 节点  
`AST` 节点会有很多类型，不同内容对应不同节点，例如  
* 文本内容 —— 文本节点  
* HTML 元素 —— 元素节点  
* 属性 —— 属性节点  
* 指令 —— 指令节点
...  

总之，在模板中的所有内容，都会有一种节点与之对应  

接下来先看节点的通用结构 `Node`，它并不具体的表示某种类型，但每个具体类型的节点继承它，包含 `Node` 中的属性  

```ts
export interface Node {
    type: NodeTypes     // 节点类型
    loc: SourceLocation // 节点定位
}
```

### 节点类型  
每种节点都会对应一种类型，通过 `type` 字段来确定，它的值是一个枚举，下面只列出了 “parse” 阶段会用到的类型  

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
`loc` 表示定位，指一个具体的内容在整个模板中的位置，它的结构如下  

```ts
export interface SourceLocation {
    start: Position // 内容开始位置
    end: Position   // 内容结束位置
    source: string  // 内容在模板中的源码
}
```
其中，`start` 表示内容开始的位置(即第一个字符的位置)，而 `end` 表示内容结束的位置(即最后一个字符的下一个位置)  
用数学表达式描述 `start` 和 `end`，就是 “左闭右开”，即 `[start, end)`，下面会说为什么是左闭右开  

我们再来看 `start` 和 `end` 的类型 `Position`，它表示了一个字符在当前文件中的内容，它的结构如下  
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

之所以要设计为 “左闭右开”，是为了通过位置获取源代码 `source`，源码中会使用 `String.prototype.slice` 方法，传入 `start` 和 `end` 的 `offset` 来获取  
所以 `end` 要表示为结束的下一个位置，这样才能获取完整的内容  

## 作用域  
在解析开始时，首选会创建一个作用域对象，它里面会存储一些与整个模板有关的内容，在整个解析阶段都会用到  

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
这样在之后使用这些配置时，就不用再去判断它们是否存在了  

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
配置中有一个 `getTextMode` 选项，它表示以什么模式去解析文本(也可以理解为解析**子节点**)  
它返回的值是枚举 `TextModes`，先来看定义 

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

从上面的注释中可以看出每个类型的意义，接下来先来解释上面横向标题的意义  
1. `Elements`：如果子节点为元素，是否可以解析，例如 `div` 中可以解析 `span`，`textarea` 中不能解析 `div`  

    ```html
    <div><span></span></div>
    <textarea><div></div></textarea>
    ```  
2. `Entities`：如果子节点为字符实体，是否可以解析，例如将 `&lt;` 解析为 `<`  
3. `End Sign`：上层节点中哪一个作为父节点  
    * `End tags of ancestors`：上层所有节点都可以作为父节点  
    * `End tag of the parent`：只有上层第一个节点作为父节点  

    ```html  
    <!-- 在 textarea、style、script 中，只有上层第一个节点是父节点，文本 hello world 的父节点只能是 textarea -->
    <textarea>hello world</textarea>

    <!-- 在解析 </div> 时，发现上一个父节点是 span(不匹配)，再向上查找到 div(匹配)，与之形成一个完整的节点 -->
    <div>1<span>2</div>3</span>
    ```  
4. `Inside of`：以上几种情况会出现在哪种标签内

接下来看纵向的每种类型  
1. `DATA`：普通模式  
2. `RCDATA`：文本域模式   
3. `RAWTEXT`：原始文本模式  
4. `CDATA`：`CDATA` 模式，只会解析 `<![CDATA[]]>` 中方括号里的内容，可以视为特殊的文本  
5. `ATTRIBUTE_VALUE`：属性值模式  

### 命名空间  
`getNamespace` 来获取节点处于哪一种命名空间下，返回值是一个枚举 `Namespaces`  

```ts
export const enum Namespaces {
    HTML
}
```  
命名空间用的地方并不是很多，基本上所有的元素都处于同一个命名空间下，即 `Namespaces.HTML`，更多的用法会在之后浏览器环境下的解析阶段说到  
