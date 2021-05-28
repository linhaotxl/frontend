<!-- TOC -->

- [解析入口](#解析入口)
- [创建根节点](#创建根节点)
- [解析子节点](#解析子节点)
    - [处理空白符](#处理空白符)
- [判断是否结束 isEnd](#判断是否结束-isend)

<!-- /TOC -->

## 解析入口  
接下来就从解析入口开始，详细了解这一阶段都做了什么  

入口是从 `baseParse` 函数开始，这个函数并不难，只是创建了一些解析过程中会用到的内容  

```ts
export function baseParse(
    content: string,            // 字符串模板内容
    options: ParserOptions = {} // 解析配置
): RootNode {
    // 1. 创建作用域对象
    const context = createParserContext(content, options)
    // 2. 获取光标的初始位置
    const start = getCursor(context)
    // 3. 创建根节点
    return createRoot(
        // 3.1 解析所有子节点，这个函数后面会说
        parseChildren(context, TextModes.DATA, []),
        // 3.2 解析完所有的子节点，获取从模板开始一直到结束的定位
        getSelection(context, start)
    )
}
```

注意：  
1. 在解析所有的子节点后，会获取 “模板开始位置” 到 “模板结束位置” 的定位信息  
    这样，就能获取到整个模板的定位
2. 在始解析子节点时，会按照 `TextModes.DATA` 的模式去解析  

## 创建根节点  
在入口函数中创建了根节点，接下来先看根节点的结构，其中很多属性在这个阶段都还用不到，只需要关注 `type` 和 `children` 即可  

```ts
export interface RootNode extends Node {
    type: NodeTypes.ROOT            // 节点类型为 ROOT
    children: TemplateChildNode[]   // 子节点列表
    helpers: symbol[]
    components: string[]
    directives: string[]
    hoists: (JSChildNode | null)[]
    imports: ImportItem[]
    cached: number
    temps: number
    ssrHelpers?: symbol[]
    codegenNode?: TemplateChildNode | JSChildNode | BlockStatement | undefined
}
```

创建根节点的函数也很简单  

```ts
export function createRoot(
    children: TemplateChildNode[], // 子节点列表
    loc = locStub                  // 整个模板的定位
): RootNode {
    return {
        type: NodeTypes.ROOT,
        children,
        helpers: [],
        components: [],
        directives: [],
        hoists: [],
        imports: [],
        cached: 0,
        temps: 0,
        codegenNode: undefined,
        loc
    }
}
```

## 解析子节点  
由于子节点的类型可以是各种各样的，所以这个函数可以说是包括了所有情况  
先来看看它都有哪些参数  

1. `context`：作用域对象  
2. `mode`：解析子节点的模式  
3. `ancestors`：父节点列表  
    源码中是这样存储每个父节点的：当解析一个元素时，会先解析开始标签，然后将结果存入 `ancestors` 中  
    接着再解析所有的子节点，等到所有的子节点都解析完时，再将前面存进去的节点取出  
    所以，`ancestors` 中的每个元素都是父节点，越往后则越靠向当前解析的内容  

接下来先看大致的流程  

```ts
function parseChildren(
    context: ParserContext,
    mode: TextModes,
    ancestors: ElementNode[]
): TemplateChildNode[] {
    // 1. 获取父节点
    const parent = last(ancestors)
    // 2. 获取命名空间，父节点有延续用父节点的
    const ns = parent ? parent.ns : Namespaces.HTML
    // 3. 定义存储所有子节点的列表
    const nodes: TemplateChildNode[] = []

    // 4. 检测是否结束，结束包括两种：
    //    a. 一个元素内的所有子节点都完成解析
    //    b. 模板中的所有内容都完成解析
    while (!isEnd(context, mode, ancestors)) {
        // 4.1 获取需要解析的模板
        const s = context.source
        // 4.2 解析后的节点
        let node: TemplateChildNode | TemplateChildNode[] | undefined = undefined

        // 4.3 只有 DATA 和 RCDATA 两种模式才会进行下面的解析
        if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
            // 4.3.1 解析插值表达式，必须不存在于 v-pre 指令内，且开头是以插值表达式的分隔符开始的
            if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
                node = parseInterpolation(context, mode)
            } 
            // 4.3.2 解析除插值表达式之外的情况，必须处于 普通模式 且第一个字符是 <
            else if (mode === TextModes.DATA && s[0] === '<') {
                // 4.3.2.1 如果只有一个 < 字符，那么就说明少了标签名，抛错，接下来会被当做文本解析
                if (s.length === 1) {
                    emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 1)
                } 
                // 4.3.2.2 解析以 <! 开头的情况，包括：注释，DOCTYPE，CDATA
                else if (s[1] === '!') {
                    // a 解析注释
                    if (startsWith(s, '<!--')) {
                        node = parseComment(context)
                    }
                    // b 解析 DOCTYPE，会被当做一个无效注释解析
                    else if (startsWith(s, '<!DOCTYPE')) {
                        node = parseBogusComment(context)
                    }
                    // c 解析 CDATA，
                    else if (startsWith(s, '<![CDATA[')) {
                        if (ns !== Namespaces.HTML) {
                            node = parseCDATA(context, ancestors)
                        } else {
                            emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
                            node = parseBogusComment(context)
                        }
                    }
                    // d 剩余情况都会被解析为无效注释，例如 <!、 <!a，同时抛错
                    else {
                        emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
                        node = parseBogusComment(context)
                    }
                }
                // 4.3.2.3 解析以 </ 开头的情况
                else if (s[1] === '/') {
                    // a 如果只有 </，就说明少了结束标签名，抛错，然后会被当做文本解析
                    if (s.length === 2) {
                        emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 2)
                    }
                    // b 如果是 </>，则缺少了结束标签名，会使光标前进 3 个单位，会忽略这三个字符，继续向后面解析，同时抛错
                    else if (s[2] === '>') {
                        emitError(context, ErrorCodes.MISSING_END_TAG_NAME, 2)
                        advanceBy(context, 3)
                        continue
                    }
                    // c 如果是无效的标签名，例如 <div></span></div>，虽然也会将其作为结束标签解析，但是并不会加入到子节点列表中
                    else if (/[a-z]/i.test(s[2])) {
                        emitError(context, ErrorCodes.X_INVALID_END_TAG)
                        parseTag(context, TagType.End, parent)
                        continue
                    }
                    // d 剩余情况都被视为有问题，当做无效注释来解析，并抛错
                    else {
                        emitError(
                            context,
                            ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
                            2
                        )
                        node = parseBogusComment(context)
                    }
                }
                // 4.3.2.3 解析标签，例如 <div></div>
                else if (/[a-z]/i.test(s[1])) {
                    node = parseElement(context, ancestors)
                }
                // 4.3.2.4 解析 <? 情况，由于这种只能出现在 XML 文本中，所以会将其视为无效注释来解析，并抛错
                else if (s[1] === '?') {
                    emitError(
                        context,
                        ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
                        1
                    )
                    node = parseBogusComment(context)
                }
                // 4.3.2.5 剩余情况会被认为是标签名的第一个字符是无效的，例如 a < b，会被当做文本来解析
                else {
                    emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 1)
                }
            }
            
        }

        // 4.4 上面没有匹配的情况，会被当做文本解析
        if (!node) {
            node = parseText(context, mode)
        }

        // 4.5 将解析结果 push 到 nodes 中
        if (isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                pushNode(nodes, node[i])
            }
        } else {
            pushNode(nodes, node)
        }
    }

    // 5. 是否需要删除空白符，这部分内容后面看
    let removedWhitespace = false

    // 6. 返回子节点列表
    return removedWhitespace ? nodes.filter(Boolean) : nodes
}
```

总结：  
1. 文本数据中也是可以解析插值表达式的  

这里只需要先大致熟悉流程，清楚是如何处理不同类型的节点，在接下内容中会依次说到每种类型的节点  
了解完一个类型的节点后，再跳回来对着流程过一遍，会更加理解过程  

### 处理空白符  
这里把这部分单独拿出来，这块逻辑比较简单，不用和上面的流程合在一块看  
主要移除的节点有这么几类  
1. 注释节点  
2. 空白符节点，前提是不在 `pre` 中的  

还要注意一点的是，如果在 `RAWTEXT` 模式下，是不会进行任何操作的，此模式需要保留所有的内容  
接下来看具体实现  

```ts
let removedWhitespace = false
// 排除 RAWTEXT 模式
if (mode !== TextModes.RAWTEXT) {
    // 1. 遍历所有节点，处理非 pre 中的空白符以及注释
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        // 1.1 处理非 pre 中的空白符
        if (!context.inPre && node.type === NodeTypes.TEXT) {
            // 1.1.1 当前节点中只含有空白符时，存在以下情况会将当前节点删除
            //       a. 当前文本节点是 第一个 或 最后一个
            //       b. 当前文本节点前后存在注释
            //       c. 当前文本节点前后都是元素，且当前文本中只含有换行符
            //       否则只会将当前文本节点重置为一个空格
            if (!/[^\t\r\n\f ]/.test(node.content)) {
                const prev = nodes[i - 1]
                const next = nodes[i + 1]
                if (
                    !prev ||
                    !next ||
                    prev.type === NodeTypes.COMMENT ||
                    next.type === NodeTypes.COMMENT ||
                    (prev.type === NodeTypes.ELEMENT &&
                        next.type === NodeTypes.ELEMENT &&
                        /[\r\n]/.test(node.content))
                ) {
                    removedWhitespace = true
                    nodes[i] = null as any
                } else {
                    // {{ name }} \n {{ age }} -> {{ name }} {{ age }}
                    node.content = ' '
                }
            }
            // 1.1.2 如果当前节点存在有效字符，则会将其中的空白符都替换为空格
            else {
                // '   foo  \n    bar     baz     ' -> ' foo bar baz '
                node.content = node.content.replace(/[\t\r\n\f ]+/g, ' ')
            }
        }
        // 1.2 处理注释节点，如果选项 comments 为 false，则会将注释节点移除，只会用于生产环境
        if (
            !__DEV__ &&
            node.type === NodeTypes.COMMENT &&
            !context.options.comments
        ) {
            removedWhitespace = true
            nodes[i] = null as any
        }
    }
    // 2. 如果当前处于 pre 内第一层子节点中，并且第一个节点是文本节点，则会将文本开头的换行符清掉
    if (context.inPre && parent && context.options.isPreTag(parent.tag)) {
        // https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element
        const first = nodes[0]
        if (first && first.type === NodeTypes.TEXT) {
            first.content = first.content.replace(/^\r?\n/, '')
        }
    }
}
```

## 判断是否结束 isEnd  
每次解析完一个节点后，都会调用这个函数来判断是否结束，不同 `TextModes` 的结束标识是不同的，记下来看实现  

```ts
function isEnd(
    context: ParserContext,
    mode: TextModes,
    ancestors: ElementNode[]
): boolean {
    const s = context.source

    switch (mode) {
        // 普通模式
        // 会依次向上检查父节点与当前结束标签是否属于同一个节点
        case TextModes.DATA:
            if (startsWith(s, '</')) {
                for (let i = ancestors.length - 1; i >= 0; --i) {
                    if (startsWithEndTagOpen(s, ancestors[i].tag)) {
                        return true
                    }
                }
            }
            break

        // 文本域、原始文本模式
        // 只会检查一层父节点与当前结束标签是否一致
        case TextModes.RCDATA:
        case TextModes.RAWTEXT: {
            const parent = last(ancestors)
            if (parent && startsWithEndTagOpen(s, parent.tag)) {
                return true
            }
            break
        }

        // CDATA 模式
        // 只会检查是否以 ]]> 结束
        case TextModes.CDATA:
            if (startsWith(s, ']]>')) {
                return true
            }
            break
    }

    // 如果模板还有内容，则代表没有结束；如果没有内容了，则代表已经结束
    return !s
}
```