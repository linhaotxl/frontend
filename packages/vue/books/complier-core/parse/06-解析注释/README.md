<!-- TOC -->

- [解析注释](#解析注释)
- [解析伪造的注释](#解析伪造的注释)
- [解析 CDATA](#解析-cdata)

<!-- /TOC -->

除了之前介绍的节点，还剩注释和 `CDATA` 这两种节点，接下来就说说这两种节点的解析  

## 解析注释  
先来看注释节点的结构  

```ts
export interface CommentNode extends Node {
    type: NodeTypes.COMMENT // 节点类型
    content: string         // 注释内容
}
```  

接下来看实现  

```ts
function parseComment(context: ParserContext): CommentNode {
    // 1. 获取光标位置，也就是注释开始的位置
    const start = getCursor(context)
    // 2. 注释内容
    let content: string

    // 3. 匹配注释的结束符 -->，
    const match = /--(\!)?>/.exec(context.source)
    // 4. 没有匹配到结束符，抛出错误 - 注释以错误的方式结束
    //    并将后面所有的内容都视为注释内容，使光标移动到最后
    //    注释的开始标签 <!-- 是占 4 个字符，所以会从 4 开始截取，也就是内容的索引
    if (!match) {
        content = context.source.slice(4)
        advanceBy(context, context.source.length)
        emitError(context, ErrorCodes.EOF_IN_COMMENT)
    }
    // 5. 匹配到结束标签
    else {
        // 5.1 最简单的注释 <!----> 中，结束标签的索引也要在 4，所以当匹配到的索引小于 3 时，代表结束标签有问题
        //     例如 <!-->、<!--->
        //     抛错 - 无效的数值
        if (match.index <= 3) {
            emitError(context, ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT)
        }
        // 5.2 如果结束的注释标签中错误出现 !，例如 <!--comment--!>
        //     抛错 - 结束标签不正确
        if (match[1]) {
            emitError(context, ErrorCodes.INCORRECTLY_CLOSED_COMMENT)
        }
        // 5.3 截取注释内容，一直到结束标签前
        content = context.source.slice(4, match.index)

        // 接下来处理是否嵌套注释
        // 5.4 获取注释从头一直到内容结束
        const s = context.source.slice(0, match.index)
        // 上一次出现嵌套注释的索引
        // 无论是初始化，还是之后赋值，都会 + 1，这样是为了查找的时候跳过当前指向的那个注释，避免重复查找
        let prevIndex = 1,
        // 嵌套注释的索引
        nestedIndex = 0
        // 查询内容中是否出现了嵌套索引，会从 prevIndex 开始查
        while ((nestedIndex = s.indexOf('<!--', prevIndex)) !== -1) {
            // 查到一个嵌套索引，会将光标前进到嵌套注释的位置
            // 移动距离的计算公式：当前索引 - 上一个索引 + 1，至于为什么可以参考下面的示例
            advanceBy(context, nestedIndex - prevIndex + 1)
            // 嵌套索引 + 4(也就是嵌套索引的开始标签 <!--)，如果还处于内容中，则被任务是嵌套注释，抛错
            if (nestedIndex + 4 < s.length) {
                emitError(context, ErrorCodes.NESTED_COMMENT)
            }
            // 更新上一个索引的值，需要加 1，跳过开始符 <
            prevIndex = nestedIndex + 1
        }
        // 现在所有的注释都已经解析完，只需要解析注释的结束标签，即 -->
        advanceBy(context, match.index + match[0].length - prevIndex + 1)
    }

    // 6. 返回注释节点
    return {
        type: NodeTypes.COMMENT,
        content,
        loc: getSelection(context, start)
    }
}
```  

```html
<!--a<!--b<!---->
```  

1. 第一次解析嵌套注释  
    `nestedIndex` 是 5，此时要前进到嵌套的注释位置，即 `a<!` 中的 `<`，长度为：5 减去上一个索引 1  
    由于上一个索引 1 是加了 1 的，所以减去的结果并没有算上最开始的 `<`，所以还要加 1，即 5  

2. 第二次解析嵌套注释  
    `nestedIndex` 是 10，此时要前进到嵌套的注释位置，即 `b<!` 中的 `<`，长度为：10 减去上一个索引 6  
    由于上一个索引 6 是加了 1 的，所以减去的结果并没有算上一个最开始的 `<`，所以还要加 1，即 5  

## 解析伪造的注释  
伪造注释也属于注释节点，在解析子节点中可以看到都有哪些情况会解析为伪造注释  

```ts
function parseBogusComment(context: ParserContext): CommentNode | undefined {
    // 1. 获取光标位置，是以 <! 开头的
    const start = getCursor(context)
    // 2. 获取模板是无效注释，还是 xml 内容
    //    无效注释 <!-s> 会将 <! 后面的模板当做内容，即 s
    //    xml <?xml?> 会将 < 后面的模板当做内容，即 ?xml?
    const contentStart = context.source[1] === '?' ? 1 : 2
    // 3. 内容
    let content: string
    // 4. 获取结束标签的索引
    const closeIndex = context.source.indexOf('>')
    // 5. 结束标签不存在，会将开始索引之后的所有模板当做内容，并使光标前进到最后
    if (closeIndex === -1) {
        content = context.source.slice(contentStart)
        advanceBy(context, context.source.length)
    }
    // 6. 存在结束标签，将开始和结束中的模板作为内容，并使光标前进到结束标签的下一个字符
    else {
        content = context.source.slice(contentStart, closeIndex)
        advanceBy(context, closeIndex + 1)
    }
    // 7. 返回注释节点
    return {
        type: NodeTypes.COMMENT,
        content,
        loc: getSelection(context, start)
    }
}
```  

## 解析 CDATA  
`CDATA` 数据的模板是 `<![CDATA[内容]]>` 这样的，其中会将 “内容” 当做文本来解析  
接下来看具体实现  

```ts
function parseCDATA(
    context: ParserContext,
    ancestors: ElementNode[]
): TemplateChildNode[] {
    // 1. 使光标前进 9 个长度，也就是 <![CDATA[ 的长度
    advanceBy(context, 9)
    // 2. 解析 CDATA 的内容，注释是以 TextModes.CDATA 模式解析，所以会将里面的内容当做文本解析
    const nodes = parseChildren(context, TextModes.CDATA, ancestors)
    // 3. 解析完内容后，如果模板为空，则说明缺少 CDATA 的结束符，抛错 - 错误结束 CDATA
    if (context.source.length === 0) {
        emitError(context, ErrorCodes.EOF_IN_CDATA)
    }
    // 4. 如果模板还有内容，则使光标前进 3 个长度，也就是 ]]>
    else {
        advanceBy(context, 3)
    }
    // 5. 返回解析的内容节点列表
    return nodes
}
```  

注意：  
1. 在解析 `CDATA` 时，不会将 `CDATA` 本身作为节点解析，而是会直接解析里面的内容，并作为解析结果  
   例如  
   
   ```html
   <svg><![CDATA[some text]]></svg>
   ```
   `svg` 的子节点中，就是 `some text` 的文本节点  
