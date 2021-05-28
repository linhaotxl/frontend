<!-- TOC -->

- [解析文本](#解析文本)
- [解析文本值](#解析文本值)
- [pushNode](#pushnode)
- [解析插槽表达式](#解析插槽表达式)

<!-- /TOC -->

## 解析文本  
文本是最简单的一种节点，先来看看文本节点的类型  

```ts
export interface TextNode extends Node {
    type: NodeTypes.TEXT    // 节点类型为 Text
    content: string         // 文本内容
}
```

接下来先看具体的实现  

```ts
function parseText(context: ParserContext, mode: TextModes): TextNode {
    // 1. 创建文本结束标识，当文本遇到这些字符时，说明文本结束
    //    默认是 标签符 < 以及 插槽开始符 {{
    //    如果是 CDATA 还会加入 CDATA 的结束符 ]]>
    const endTokens = ['<', context.options.delimiters[0]]
    if (mode === TextModes.CDATA) {
        endTokens.push(']]>')
    }
    // 2. 定义文本结束索引，默认是剩余模板的长度
    let endIndex = context.source.length
    // 3. 遍历结束标识列表，查询第一个结束标识出现的索引
    //    如果出现多个结束符，则以后面的为准，即越往后，优先级越高
    //    例如，在解析 "hello world {{ foo }}<div></div>" 时，结束符应该是 {{ 而不是 <
    for (let i = 0; i < endTokens.length; i++) {
        // 3.1 匹配是从 1 开始
        const index = context.source.indexOf(endTokens[i], 1)
        if (index !== -1 && endIndex > index) {
            endIndex = index
        }
    }

    // 4. 获取解析文本前的位置
    const start = getCursor(context)
    // 5. 解析从头到 endIndex 位置的文本数据
    const content = parseTextData(context, endIndex, mode)

    // 6. 返回 TextNode，并获取解析前后的定位
    return {
        type: NodeTypes.TEXT,
        content,
        loc: getSelection(context, start)
    }
}
```

注意，在 3.1 中匹配是从索引 1 开始的，而不是从 0 开始，这是为什么？  
考虑以下文本内容  

```html
a < b
```

解析这段文本时，先碰到了结束符 `<`，所以先会解析文本 `a ` 并截取 
再解析文本 `< b` 时，会被当做文本来解析，再次进入这个函数

如果从 `0` 开始查找，那么找到的结果 `endIndex` 就是 `0`  
这样的话在第 5 步中解析出来的内容就是 `''`，这是无效的，正确的解析内容应该是 `< b`，所以查找的时候不能从 `0` 开始找  

## 解析文本值  
这个函数用来解析具体的值，用到的地方会很多，例如文本值，插槽内的值，属性值等等  
同时还会解析 “实体字符”，例如将 `&lt;` 解析为 `<`  

```ts
function parseTextData(
    context: ParserContext,	// 作用域
    length: number,					// 解析文本的长度
    mode: TextModes					// 解析模式
): string {
    // 1. 截取文本
    const rawText = context.source.slice(0, length)
    // 2. 使光标前进指定长度
    advanceBy(context, length)
    // 3. 以下情况不需要解析内容，直接返回原始内容
    if (
        mode === TextModes.RAWTEXT ||   // 文本模式为 RAWTEXT
        mode === TextModes.CDATA ||     // 文本模式为 CDATA
        rawText.indexOf('&') === -1     // 内容中不含有 &
    ) {
        return rawText
    }
    // 4. 除此之外都需要解析 实体字符，例如 DATA 和 RCDATA 包含 & 的情况
    else {
        return context.options.decodeEntities(
            rawText,
            mode === TextModes.ATTRIBUTE_VALUE
        )
    }
}
```

总结：  
1. 对于 `RAWTEXT` 和 `CDATA` 两种模式来说，里面的内容即使含有 `&` 也不需要解析  
2. 如果不是以上两个模式，但是存在 `&`，都是需要解析的  

## pushNode  
在解析子节点 `parseChildren` 中，最后会将所有的子节点 `push` 到 `nodes` 中，源码中将这一步封装进了 `pushNode` 函数  
之所以要封装，就是为了处理下面这种情况  

当解析的模板是下面这个时  
```html
a < b
```

最终得到了两个文本节点 `a ` 和 `< b`，但实际这应该是一个文本节点，所以这个函数会将它们合并为一个节点，接下来看实现  

```ts
function pushNode(
    nodes: TemplateChildNode[], // 子节点列表
    node: TemplateChildNode     // 需要存入列表中的节点
): void {
    // 只会处理文本节点
    if (node.type === NodeTypes.TEXT) {
        // 获取前一个节点
        const prev = last(nodes)
        // 如果前一个节点也是文本节点
        // 并且前一个文本节点的结束位置和当前节点的开始位置重合，那么会认为两个文本节点实际是一个，所以接下来会将当前节点合并到上一个
        if (
            prev &&
            prev.type === NodeTypes.TEXT &&
            prev.loc.end.offset === node.loc.start.offset
        ) {
            // 合并内容
            prev.content += node.content
            // 结束位置以当前节点的结束位置
            prev.loc.end = node.loc.end
            // 合并源代码 source
            prev.loc.source += node.loc.source
            return
        }
    }

    nodes.push(node)
}
```

## 解析插槽表达式  
这个函数用来解析插值表达式里的内容，在接下来的内容中，存在几个名词  

1. 原始内容：插值表示式整体，对应下面的 `{{ a &lt; b }}`  
2. 有效内容：插值表达式有效内容，对应下面的 ` a &lt; b ` 
3. 解析内容：插值的有效内容转换后的结果，下面的解析结果就是 ` a < b ` 
4. 去除空白的解析内容：将解析内容去除两边空白符，下面的结果就是 `a < b`  

    ```ts
    {{ a &lt; b }}
    ```

先来看插值表达节点的类型  

```ts
export interface InterpolationNode extends Node {
    type: NodeTypes.INTERPOLATION   // 节点类型为 INTERPOLATION
    content: ExpressionNode         // 内容节点
}
```

**注意：**  

1. 插值节点的 `loc` 是 *原始内容* 的定位信息  
2. 插值节点的 `content` 对应的是 *去除空白的解析内容* 的节点，而 `content.loc` 则是 “去除空白的解析内容” 的定位信息  

接下来看实现  

```ts
function parseInterpolation(
    context: ParserContext,
    mode: TextModes
): InterpolationNode | undefined {
    // 1. 获取插值的 开始符 与 结束符，默认是 {{ 和 }}
    const [open, close] = context.options.delimiters

    // 2. 获取结束符的位置，没有的话则抛错，并返回 undefined
    //    表示没有解析结果，之后会被当做文本由 parseText 继续解析
    const closeIndex = context.source.indexOf(close, open.length)
    if (closeIndex === -1) {
        emitError(context, ErrorCodes.X_MISSING_INTERPOLATION_END)
        return undefined
    }

    // 3. 获取解析前光标位置
    const start = getCursor(context)
    // 4. 使光标前进 开始符 的长度
    advanceBy(context, open.length)
    // 5. 获取此时光标位置，并作为 有效内容 的开始和结束位置，因为在有效内容左右会存在不确定的空白符，所以之后会修改
    const innerStart = getCursor(context)
    const innerEnd = getCursor(context)
    
    // 6. 获取原始内容的长度
    const rawContentLength = closeIndex - open.length
    // 7. 获取原始内容
    const rawContent = context.source.slice(0, rawContentLength)
    
    // 8. 获取解析内容，将原始内容解析，使 context.source 的光标前进原始内容的长度
    const preTrimContent = parseTextData(context, rawContentLength, mode)
    // 9. 获取 去除空白的解析内容
    const content = preTrimContent.trim()

    // 10. 获取 去除空白的解析内容 前面的空白符数量，其实就是看 content 在 preTrimContent 中的位置
    //     由于这个位置肯定是 大于 0 的，所以可以理解为空白符的数量
    const startOffset = preTrimContent.indexOf(content)
    // 11. 如果有空白符，则将 innerStart 前进 startOffset 长度
    if (startOffset > 0) {
        advancePositionWithMutation(innerStart, rawContent, startOffset)
    }
    
    // 12. 获取 去除空白的解析内容尾部 相对于 原始内容 的偏移
    //     先获 去除空白的解析内容尾部 后面空白符的数量：解析内容长度 - 去除空白的解析内容 - 前面的空白符个数
    //     再用原始内容长度 - 后面的空白符数量，就是后面第一个空白符在原始内容中的位置
    //     之所以要计算在原始内容中的位置，是因为原始内容是未转换的，而需要将 innerEnd 前进的长度，必须包含那些未转换的字符
    const endOffset =
        rawContentLength - (preTrimContent.length - content.length - startOffset)

    // 13. 将 innerEnd 前进 endOffset 长度
    advancePositionWithMutation(innerEnd, rawContent, endOffset)
    // 14. 是光标前进 结束符 的长度
    advanceBy(context, close.length)

    // 15. 返回插值节点
    return {
        type: NodeTypes.INTERPOLATION,
        content: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: false,
            // Set `isConstant` to false by default and will decide in transformExpression
            constType: ConstantTypes.NOT_CONSTANT,
            content,
            // 有效内容去除空格的定位
            loc: getSelection(context, innerStart, innerEnd)
        },
        // 插值整体的定位
        loc: getSelection(context, start)
    }
}
```

接下来用下面这个例子来解释  

```html
{{ &quot;abc&quot; }}

<!-- 原始内容长度 rawContentLength：17 -->
<!-- 原始内容 rawContent： ' &quot;abc&quot; ' -->
<!-- 解析内容 preTrimContent：' "abc" ' -->
<!-- 去除空白符的解析内容 content：'"abc"' -->
<!-- content 第一个字符在原始内容中的位置 startOffset：1 -->
<!-- content 后第一个空白符在原始内容中的位置 endOffset：16 -->
```

