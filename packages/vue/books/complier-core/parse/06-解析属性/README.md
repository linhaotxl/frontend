<!-- TOC -->

- [解析所有属性](#解析所有属性)
- [解析单个属性](#解析单个属性)
- [解析属性值](#解析属性值)
- [举例](#举例)
    - [静态属性节点](#静态属性节点)
    - [指令节点](#指令节点)

<!-- /TOC -->

在上一节中我们知道，在解析标签的方法中，会解析属性并将结果放进 `props` 中，作为属性列表  
接下来就看属性是如何解析的  

## 解析所有属性  
这个函数并没有做具体的解析过程，只是把所有解析好的节点存下来，并检测是否解析完成而已  
注意的是，在开始解析属性前，`context.code` 就已经是以 “属性” 开头的了  

```ts
function parseAttributes(
  context: ParserContext,   // 作用域
  type: TagType             // 标签类型
): (AttributeNode | DirectiveNode)[] {
    // 1. 存储属性、指令节点的集合
    const props = []
    // 2. 存储属性名、指令名的集合，用于验证是否存在重复是属性名
    const attributeNames = new Set<string>()
    // 3. 当还有模板内容，且不是以标签结束符开头时，说明还有需要解析的属性
    while (
        context.source.length > 0 &&
        !startsWith(context.source, '>') &&
        !startsWith(context.source, '/>')
    ) {
        // 3.1 如果是以 / 开头，例如 <div id="a" / class="app"></div>，<div a/b></div> 这种
        //     直接抛错 - 错误出现分割符，并将这个分隔符跳过，并前进后面的空白符
        if (startsWith(context.source, '/')) {
            emitError(context, ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG)
            advanceBy(context, 1)
            advanceSpaces(context)
            continue
        }
        // 3.2 如果在解析结束标签时，还存在属性，则直接抛错 - 结束标签出现属性
        if (type === TagType.End) {
            emitError(context, ErrorCodes.END_TAG_WITH_ATTRIBUTES)
        }

        // 3.3 解析属性，获取属性节点，并将其 push 到 props 中
        const attr = parseAttribute(context, attributeNames)
        if (type === TagType.Start) {
            props.push(attr)
        }

        // 3.4 如果属性名之间不是以空白符间隔，则抛错 - 属性间错误出现分隔符
        if (/^[^\t\r\n\f />]/.test(context.source)) {
            emitError(context, ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES)
        }
        // 3.5 前进多余的空白符，保证解析每个属性时，模板都是以属性开头
        advanceSpaces(context)
    }
    
    // 4. 返回属性节点列表
    return props
}
```  

## 解析单个属性  
属性会包含 “静态属性” 以及 “指令” 两种，但是它们都被视为 “属性”，所以会在同一个函数里去解析，先来看看它们的结构  

1. 静态属性结构  

    ```ts
    export interface AttributeNode extends Node {
        type: NodeTypes.ATTRIBUTE   // 节点类型为 属性
        name: string                // 属性名
        value: TextNode | undefined // 属性值为文本节点
    }
    ```  
2. 指令结构  

    ```ts
    export interface DirectiveNode extends Node {
        type: NodeTypes.DIRECTIVE           // 节点类型为 指令
        name: string                        // 指令名，例如 if、else-if、else 等
        exp: ExpressionNode | undefined     // 指令值，是一个表达式节点
        arg: ExpressionNode | undefined     // 指令参数，是一个表达式节点
        modifiers: string[]                 // 指令修饰符集合
        parseResult?: ForParseResult        // 缓存 v-for 的结果
    }
    ```  

接下来具体实现，注意，解析每个属性时，当前模板内容都是从属性名开头的  

```ts
function parseAttribute(
    context: ParserContext,
    nameSet: Set<string>
): AttributeNode | DirectiveNode {
    // 1. 获取当前所在的光标位置，就是属性开头的位置
    const start = getCursor(context)
    // 2. 匹配属性名，会匹配到空白符、等号、结束符前的所有内容
    const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source)!
    // 3. 获取属性名
    const name = match[0]

    // 4. 检测是否已经存在相同属性名，如果存在则抛出错误 - 属性名重复
    if (nameSet.has(name)) {
        emitError(context, ErrorCodes.DUPLICATE_ATTRIBUTE)
    }

    // 5. 记录下当前解析的属性名
    nameSet.add(name)

    // 6. 如果属性名前出现了 =，例如 <img =src="" />，则抛出错误 - 属性名前错误出现等号
    if (name[0] === '=') {
        emitError(context, ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME)
    }

    // 7. 检测属性名中是否出现了其他字符，包括 ' " < 这三个，例如 <img sr<c="" /> 如果出现了则抛错 - 属性名错误属性未知字符
    {
        const pattern = /["'<]/g
        let m: RegExpExecArray | null
        while ((m = pattern.exec(name))) {
            emitError(
                context,
                ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
                m.index
            )
        }
    }

    // 8. 前进属性名字符的长度
    advanceBy(context, name.length)

    // 9. 存储属性值的变量
    let value: AttributeValue = undefined

    // 10. 如果 = 前出现空白符都是允许的，解析具体的属性值
    if (/^[\t\r\n\f ]*=/.test(context.source)) {
        // 前进出现的空白符长度
        advanceSpaces(context)
        // 前进 1 个长度，即 = 的长度
        advanceBy(context, 1)
        // 前进 = 后面出现空白符的长度
        advanceSpaces(context)
        // 解析属性值，如果解析的值无效，则抛错 - 错误的属性值，例如 <img src= />
        value = parseAttributeValue(context)
        if (!value) {
            emitError(context, ErrorCodes.MISSING_ATTRIBUTE_VALUE)
        }
    }

    // 11. 记录此时的位置与解析前的位置，也就是整个属性的定位
    const loc = getSelection(context, start)

    // 12. 如果当前不处于 v-pre 内，且属性名以 v-、:、@、# 开头，那么会被认为是指令，接下来解析指令
    if (!context.inVPre && /^(v-|:|@|#)/.test(name)) {
        // 12.1 匹配指令的各个值，各个分组意义如下，以 v-on:click.enter.extra 来说
        //      1: 指令名，即 on
        //      2: 参数名，即 click
        //      3: 修饰符，即 .enter.extra
        const match = /(?:^v-([a-z0-9-]+))?(?:(?::|^@|^#)(\[[^\]]+\]|[^\.]+))?(.+)?$/i.exec( name )!
        // 12.2 获取指令名，如果没有解析出指令名，则根据快捷符来解析
        const dirName =
            match[1] ||
            (startsWith(name, ':') ? 'bind' : startsWith(name, '@') ? 'on' : 'slot')
        
        // 12.3 参数表达式节点
        let arg: ExpressionNode | undefined
        // 12.4 如果参数存在则解析参数
        if (match[2]) {
            // 12.4.1 是否是 v-slot 指令
            const isSlot = dirName === 'slot'
            // 12.4.2 获取参数在指令名中的偏移
            const startOffset = name.indexOf(match[2])
            // 12.4.3 TODO: 获取参数的定位，包括动态参数左右两边的 []
            const loc = getSelection(
                context,
                // 获取参数的起始位置：基于 start 向前进 startOffset 长度
                getNewPosition(context, start, startOffset),
                // 获取参数的结束位置：基于 start 向前 startOffset + 参数长度
                // 如果是 v-slot 指令，则还需要再前进 修饰符 的长度，是因为 v-slot 指令的参数需要包含修饰符
                getNewPosition(
                    context,
                    start,
                    startOffset + match[2].length + ((isSlot && match[3]) || '').length
                )
            )

            // 12.4.4 获取参数名
            let content = match[2]
            // 12.4.5 参数是否是静态参数，默认是
            let isStatic = true

            // 12.4.6 检测参数是否是动态参数
            if (content.startsWith('[')) {
                // 修改静态标识
                isStatic = false

                // 如果参数没有以 ] 结尾则抛错 - 动态参数错误结尾
                if (!content.endsWith(']')) {
                    emitError(
                        context,
                        ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END
                    )
                }

                // 解析动态参数的值，即 [] 中间的值
                content = content.substr(1, content.length - 2)
            }
            // 12.4.7 如果是 v-slot 指令，则需要将修饰符拼接到参数后面
            else if (isSlot) {
                content += match[3] || ''
            }

            // 12.4.8 参数节点
            arg = {
                type: NodeTypes.SIMPLE_EXPRESSION,  // 表达式节点
                content,                            // 参数具体的名称
                isStatic,                           // 是否是静态参数
                constType: isStatic // TODO:
                    ? ConstantTypes.CAN_STRINGIFY
                    : ConstantTypes.NOT_CONSTANT,
                loc                                 // 参数定位
            }
        }

        // 12.5 将指令值左右两边的 引号 去除，并修改定位信息，后面会有示例
        if (value && value.isQuoted) {
            const valueLoc = value.loc
            valueLoc.start.offset++
            valueLoc.start.column++
            valueLoc.end = advancePositionWithClone(valueLoc.start, value.content)
            valueLoc.source = valueLoc.source.slice(1, -1)
        }

        // 12.6 返回指令节点
        return {
            type: NodeTypes.DIRECTIVE,
            name: dirName,
            exp: value && {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: value.content,
                isStatic: false,
                // Treat as non-constant by default. This can be potentially set to
                // other values by `transformExpression` to make it eligible for hoisting.
                constType: ConstantTypes.NOT_CONSTANT,
                loc: value.loc
            },
            arg,
            modifiers: match[3] ? match[3].substr(1).split('.') : [],
            loc
        }
    }

    // 13. 返回属性节点
    return {
        type: NodeTypes.ATTRIBUTE,
        name,
        value: value && {
            type: NodeTypes.TEXT,
            content: value.content,
            loc: value.loc
        },
        loc
    }
}
```  

1. 先看将指令的引号去除的意义，存在以下代码  

```html
<div v-on:click.enter.extra="handleClick"></div>
```  

进入 12.5 之前，指令值节点如下  

```ts
{
    content: 'handleClick',
    isQuoted: true,
    loc: {
        start: { column: 29, offset: 28, row: 1 }, 
        end: { column: 42, offset: 41, row: 1 }, 
        source: "'handleClick'",
    }
}
```  

接下来对开始位置 `start` 加了 1，所以 `start` 成为 `{ column: 30, offset: 29, row: 1 }`  
接下来对结束位置 `end`，在 `start` 的基础上，前进了 `content` 的长度(11)，注意此时 `content` 是不包括两个引号的  
所以 `end` 称为了 `{ column: 41, offset: 40, row: 1 }`  

可以看到，`start` 比原来加了一个长度，`end` 比原来少了一个长度，并把原始代码 `source` 中的引号也去掉了，修改后如下  

```ts
{
    content: 'handleClick',
    isQuoted: true,
    loc: {
        start: { column: 30, offset: 29, row: 1 }, 
        end: { column: 41, offset: 40, row: 1 }, 
        source: 'handleClick',
    }
}
```    

## 解析属性值  
属性值不是节点，只是一个普通对象，先来看它的结构  

```ts
type AttributeValue =
    | {
        content: string     // 属性值
        isQuoted: boolean   // 是否包含引号
        loc: SourceLocation // 属性值定位
    }
    | undefined
```  

接下来看实现  
注意：解析属性值时，模板内容肯定是以属性值开头的，前面的等号和空白符已经被解析过了  

```ts
function parseAttributeValue(context: ParserContext): AttributeValue {
    // 1. 获取光标位置，此时是以 属性值 开头的
    const start = getCursor(context)
    // 2. 定义存储属性值内容的变量
    let content: string

    // 3. 获取第一个字符，并检测是否是引号
    const quote = context.source[0]
    const isQuoted = quote === `"` || quote === `'`
    
    // 4. 检测是否以引号开头
    if (isQuoted) {
        // 4.1.1 如果是引号，则前进 1 个长度，就是前面引号的长度
        advanceBy(context, 1)

        // 4.1.2 查询下一个引号出现的位置
        const endIndex = context.source.indexOf(quote)

        // 4.1.3 没有出现结束引号
        if (endIndex === -1) {
            // 如果没有结束的引号，说明语法错误，直接将剩下的模板解析为文本，作为属性值
            content = parseTextData(
                context,
                context.source.length,
                TextModes.ATTRIBUTE_VALUE
            )
        }
        // 4.1.4 出现结束引号
        else {
            // 解析两个引号中间的内容
            content = parseTextData(context, endIndex, TextModes.ATTRIBUTE_VALUE)
            // 前进 1 个长度，即结束引号
            advanceBy(context, 1)
        }
    } else {
        // 4.2.1 不是引号，匹配是否以有效字符开头，如果不是，则直接退出，例如 <img src= />
        const match = /^[^\t\r\n\f >]+/.exec(context.source)
        if (!match) {
            return undefined
        }
        // 4.2.2 在属性值中不能出现以下无效值：' " ` < 和 =，例如 <img src=url' />
        const unexpectedChars = /["'<=`]/g
        let m: RegExpExecArray | null
        while ((m = unexpectedChars.exec(match[0]))) {
            emitError(
                context,
                ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
                m.index
            )
        }
        // 4.2.3 解析文本内容
        content = parseTextData(context, match[0].length, TextModes.ATTRIBUTE_VALUE)
    }

    // 5. 返回属性对象
    return { content, isQuoted, loc: getSelection(context, start) }
}
```  


## 举例  

### 静态属性节点  
    ```html
    <div class="root"></div>
    ```  

    `class` 属性会被解析为  

    ```ts
    {
        type: NodeTypes.ATTRIBUTE,
        name: 'class',
        value: {
            type: NodeTypes.TEXT,
            content: 'root',
            loc: {
                start: { line: 1, column: 12, offset: 11 },
                end: { line: 1, column: 18, offset: 17 },
                source: '"root"'
            }
        },
        loc: {
            start: { line: 1, column: 6, offset: 5 },
            end: { line: 1, column: 18, offset: 17 },
            source: 'class="root"'
        }
    }
    ```  

### 指令节点  

    ```html
    <div v-on:click.enter.extra="handleClick"></div>
    ```  

    `v-on` 指令会被解析为  

    ```ts
    {
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'handleClick',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { line: 1, column: 30, offset: 29 },
            end: { line: 1, column: 41, offset: 40 },
            source: 'handleClick'
          }
        },
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'click',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { line: 1, column: 11, offset: 10 },
            end: { line: 1, column: 16, offset: 15 },
            source: 'click'
          }
        },
        modifiers: ['enter', 'extra'],
        loc: {
            start: { line: 1, column: 6, offset: 5 },
            end: { line: 1, column: 42, offset: 41 },
            source: 'v-on:click.enter.extra="handleClick"'
        }
    }
    ```