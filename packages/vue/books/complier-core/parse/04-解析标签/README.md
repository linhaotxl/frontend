<!-- TOC -->

- [解析元素](#解析元素)
- [解析标签](#解析标签)

<!-- /TOC -->

## 解析元素  
元素的解析由 `parseElement` 完成，一个元素可以分为三部分  
1. 开始标签(包括属性、指令)  
2. 子元素  
3. 结束标签  

子元素之前说过是由 `parseChildren` 完成解析，而剩下的两个标签也是由下面的 [parseTag](#解析标签) 来完成  
那好像这个函数什么也没做，其实不是，它除了完成上面三个步骤的调用外，还有许多其他任务，接下来先来看具体实现  

```ts
function parseElement(
    context: ParserContext,     // 作用域
    ancestors: ElementNode[]    // 父节点列表
): ElementNode | undefined {
    // 1. 检查当前元素是否处于 pre 标签内
    const wasInPre = context.inPre
    // 2. 检查当前元素是否处于 v-pre 指令内
    const wasInVPre = context.inVPre
    // 3. 获取父节点
    const parent = last(ancestors)
    // 4. 解析开始标签的所有内容：标签名 + 属性
    //    如果是 pre 标签，或者存在 v-pre 指令，那么会将作用域中的 inPre、inVPre 设置为 true
    const element = parseTag(context, TagType.Start, parent)
    // 5. 检查是否是 pre 标签、v-pre 的边界
    //    边界：是否是产生 pre 或 v-pre 的元素
    //    之所以要检测边界，是为了在解析完子节点后，需要将作用域中的 inPre、inVPre 恢复，具体的检测方法会在后面说
    const isPreBoundary = context.inPre && !wasInPre
    const isVPreBoundary = context.inVPre && !wasInVPre

    // 6. 如果是自闭和元素，则直接返回元素节点，不再需要解析子节点和尾标签
    if (element.isSelfClosing || context.options.isVoidTag(element.tag)) {
        return element
    }

    // 7. 存储父节点，开始解析子节点
    ancestors.push(element)
    // 8. 获取解析子节点的模式
    const mode = context.options.getTextMode(element, parent)
    // 9. 解析子节点
    const children = parseChildren(context, mode, ancestors)
    // 10. 子节点解析完成，删除父节点
    ancestors.pop()
    // 11. 将子节点存储在父节点上
    element.children = children

    // 12. 检测标签是否结束
    if (startsWithEndTagOpen(context.source, element.tag)) {
        // 12.1 解析结束标签
        parseTag(context, TagType.End, parent)
    } else {
        // 12.2 抛错，错误的结束标签
        emitError(context, ErrorCodes.X_MISSING_END_TAG, 0, element.loc.start)
        if (context.source.length === 0 && element.tag.toLowerCase() === 'script') {
            const first = children[0]
            if (first && startsWith(first.loc.source, '<!--')) {
                emitError(context, ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT)
            }
        }
    }
    // 13. 更新定位信息，从开始标签一直到结束标签
    element.loc = getSelection(context, element.loc.start)

    // 14. 如果当前是 pre 或者 v-pre 的边界，则需要恢复作用域中的值
    if (isPreBoundary) {
        context.inPre = false
    }
    if (isVPreBoundary) {
        context.inVPre = false
    }

    // 15. 返回元素节点
    return element
}
```

1. 检测 `pre`、`v-pre` 边界  

    ```ts
    const isPreBoundary = context.inPre && !wasInPre
    const isVPreBoundary = context.inVPre && !wasInVPre
    ```
    在解析完开始标签后，先判断作用域中的 `inPre`、`inVPre`  
    * 如果为 `true`，可能是以下两种情况之一  
        1. 这是一个 `pre` 标签，或者存在 `v-pre` 指令  
        2. 当前已经存在于 `pre` 标签，或者 `v-pre` 指令内  
        再来检测之前作用域中的值，如果之前的值为 `false`，说明现在就是 “情况a”，是边界；否则就是 “情况b”，不是边界  
    * 如果为 `false`，则说明以上两种情况都不是，那么肯定不是边界  

2. 可以看出，元素节点 `element` 是由 `parseTag` 产生的，而 `parseElement` 只是进一步做了其他处理  

## 解析标签  
解析开始标签和结束标签是同一个函数，用下面这个枚举来表示两种标签  

```ts
const enum TagType {
    Start,
    End
}
```

同时，由于模板中存在许多内置指令，所以会用接下来这个变量来检测，后面会用到  

```ts
const isSpecialTemplateDirective = /*#__PURE__*/ makeMap(
    `if,else,else-if,for,slot`
)

// 上面内容实际会被转换为下面的对象
// {
//     'if': true,
//     'else: true,
//     'else-if': true,
//     'for': true,
//     'slot': true,
// }
```

元素节点又可以分为以下 4 种，通过该枚举来表示  

```ts
export const enum ElementTypes {
    ELEMENT,    // 普通元素：<div />
    COMPONENT,  // 组件：<a-button />
    SLOT,       // 插槽：<slot />
    TEMPLATE    // 模板：<template />
}
```

接下来看看元素节点的结构(其中 `codegenNode` 和 `ssrCodegenNode` 可以先不同看，这一阶段不涉及)  

```ts
export type ElementNode =
    | PlainElementNode  // 普通元素
    | ComponentNode     // 组件
    | SlotOutletNode    // 插槽
    | TemplateNode      // 模板

export interface BaseElementNode extends Node {
    type: NodeTypes.ELEMENT                     // 节点类型
    ns: Namespace                               // 命名空间
    tag: string                                 // 标签名
    tagType: ElementTypes                       // 元素类型
    isSelfClosing: boolean                      // 是否是自闭和标签
    props: Array<AttributeNode | DirectiveNode> // 属性，指令集合
    children: TemplateChildNode[]               // 子节点
}

// 普通元素节点
export interface PlainElementNode extends BaseElementNode {
    tagType: ElementTypes.ELEMENT       // 元素类型为 ELEMENT
    codegenNode:
        | VNodeCall
        | SimpleExpressionNode // when hoisted
        | CacheExpression // when cached by v-once
        | undefined
    ssrCodegenNode?: TemplateLiteral
}

// 组件节点
export interface ComponentNode extends BaseElementNode {
    tagType: ElementTypes.COMPONENT     // 元素类型为 COMPONENT
    codegenNode:
        | VNodeCall
        | CacheExpression // when cached by v-once
        | undefined
    ssrCodegenNode?: CallExpression
}

// 插槽节点
export interface SlotOutletNode extends BaseElementNode {
    tagType: ElementTypes.SLOT          // 元素类型为 SLOT
    codegenNode:
        | RenderSlotCall
        | CacheExpression // when cached by v-once
        | undefined
    ssrCodegenNode?: CallExpression
}

// 模板节点
export interface TemplateNode extends BaseElementNode {
    tagType: ElementTypes.TEMPLATE      // 元素类型为 TEMPLATE
    // TemplateNode is a container type that always gets compiled away
    codegenNode: undefined
}
```

接下来看具体的实现  

```ts
function parseTag(
    context: ParserContext,             // 作用域对象
    type: TagType,                      // 开始标签还是结束标签
    parent: ElementNode | undefined     // 父节点
): ElementNode {
    // 1. 获取解析前的光标位置
    const start = getCursor(context)
    // 2. 解析标签名
    //    例如 <div></div>，解析到的就是 <div 和 </div ，并且会在第一个分组
    const match = /^<\/?([a-z][^\t\r\n\f />]*)/i.exec(context.source)!
    const tag = match[1]

    // 3. 获取命名空间
    const ns = context.options.getNamespace(tag, parent)

    // 4. 前进匹配到的长度，例如前进 <div 或 </div 的长度
    advanceBy(context, match[0].length)
    // 5. 前进空白符的长度，例如 <div 和属性 id="root" 中间的空白符
    advanceSpaces(context)

    // 6. 获取此时的光标位置，以及模板内容，是从属性开头的
    const cursor = getCursor(context)
    const currentSource = context.source

    // 7. 解析所有属性，此时 context.source 是一第一个属性开头的
    let props = parseAttributes(context, type)

    // 8. 检测是否是 pre 标签，如果是的话将作用域中的 inPre 置为 true
    if (context.options.isPreTag(tag)) {
        context.inPre = true
    }

    // 9. 如果存在 v-pre 指令，则需要进一步操作
    //    如果嵌套 v-pre，则里面的 v-pre 不会进行这一步
    if (
        !context.inVPre &&
        props.some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'pre')
    ) {
        // 9.1 更新作用域 inVPre 的值
        context.inVPre = true
        // 9.2 将作用域中的光标和模板内容重置为解析属性之前的值
        extend(context, cursor)
        context.source = currentSource
        // 9.3 再次对属性解析，因为在 v-pre 内，属性的解析有不同的行为
        //     解析完成后会过滤掉 v-pre 指令
        props = parseAttributes(context, type).filter(p => p.name !== 'v-pre')
    }

    // 到这一步，标签里还差最后一个结束标签符 (> 或者 /> )还没有解析，并且此时模板内容是以结束标签符开头的
    // 解析属性的过程中会将空白符去掉

    // 10. 是否是自闭和标签
    let isSelfClosing = false
    // 11. 检测模板是否还有内容
    if (context.source.length === 0) {
        // 如果没有内容则抛错，错误结束标签，例如 <div
        emitError(context, ErrorCodes.EOF_IN_TAG)
    } else {
        // 检测是否是自闭和标签
        isSelfClosing = startsWith(context.source, '/>')
        // 如果在解析结束标签时，又发现了自闭和标签，则抛错，例如 <div></div/>
        if (type === TagType.End && isSelfClosing) {
            emitError(context, ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS)
        }
        // 根据是否是自闭和标签前进 1 或 2 个长度
        advanceBy(context, isSelfClosing ? 2 : 1)
    }

    // 12. 元素类型，默认为普通元素
    let tagType = ElementTypes.ELEMENT

    const options = context.options

    // 13. 接下来的操作是解析元素类型
    //     只有不处于 v-pre 指令内，以及不是普通元素才需要解析
    if (!context.inVPre && !options.isCustomElement(tag)) {
        // 13.1 检查是否有 v-is 属性
        const hasVIs = props.some( p => p.type === NodeTypes.DIRECTIVE && p.name === 'is' )

        // 13.2 以下情况都会标记为组件类型
        //      a. 没有 v-is 指令，且也不是原生标签
        //      b. 存在 v-is 指令
        //      c. 核心组件，包括 Suspense、Telport、KeepAlive、BaseTransition
        //      d. 平台下的内置组件
        //      e. 首字母大写的标签
        //      f. component 标签
        if (options.isNativeTag && !hasVIs) {
            if (!options.isNativeTag(tag)) tagType = ElementTypes.COMPONENT
        } else if (
            hasVIs ||
            isCoreComponent(tag) ||
            (options.isBuiltInComponent && options.isBuiltInComponent(tag)) ||
            /^[A-Z]/.test(tag) ||
            tag === 'component'
        ) {
            tagType = ElementTypes.COMPONENT
        }

        // 13.3 如果是 slot 标签，则标记元素类型为 SLOT
        if (tag === 'slot') {
            tagType = ElementTypes.SLOT
        }
        // 13.4 如果是 template 标签，且含有模板指令，则标记元素类型为 TEMPLATE
        else if (
            tag === 'template' &&
            props.some(p => p.type === NodeTypes.DIRECTIVE && isSpecialTemplateDirective(p.name)})
        ) {
            tagType = ElementTypes.TEMPLATE
        }
    }

    // 14. 返回元素节点
    return {
        type: NodeTypes.ELEMENT,            // 节点类型
        ns,                                 // 命名空间
        tag,                                // 标签名
        tagType,                            // 元素类型
        props,                              // 属性集合
        isSelfClosing,                      // 是否是自闭和标签
        children: [],                       // 子节点，之后解析完成后会添加
        loc: getSelection(context, start),  // 开始标签的定位
        codegenNode: undefined // to be created during transform phase
    }
}
```

注意：  
1. `v-is` 会将指定的组件渲染到当前位置，例如 `<tr v-is="'comp'"></tr>` 会将 `comp` 代替 `tr`，所以带有 `v-is` 指令的其实也是一个组件  
2. 不带有模板内置指令的 `template`，只是一个普通类型的元素  
3. 存在 `v-pre` 指令的元素，所有的属性和指令都会被视为普通静态属性，其中所有的子节点都被视为普通元素