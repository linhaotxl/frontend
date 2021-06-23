<!-- TOC -->

- [解析 v-for 的值](#解析-v-for-的值)
- [处理 v-for 指令](#处理-v-for-指令)
- [创建生成器 —— processCodegen](#创建生成器--processcodegen)
    - [创建生成器的退出函数](#创建生成器的退出函数)
    - [创建渲染函数的参数 —— createForLoopParams](#创建渲染函数的参数--createforloopparams)

<!-- /TOC -->

**这篇开始详细介绍 `v-for` 指令的相关内容，它属于结构指令，所以最终会被放进作用域中的 `nodeTransforms` 而不是 `directiveTransforms`**  

## 解析 v-for 的值  
先来看一条完整的 `v-for` 指令都有哪些内容  

```html
<div v-for="( item, key, index ) in items"></div>
```  
在后面的内容中，会对出现的各个部分进行命名  
1. 项目 -> `item`  
2. key -> `key`  
3. 索引 -> `index`  
4. 源数据 -> `items`  
5. 原始内容 -> `( item, key, index )`  
6. 有效内容(原始内容去除括号和左右的空白符) -> `item, key, index`  

在源码中，首先会对 `v-for` 的值进行解析，得到解析结果后再进行操作，先来看看解析结果结构  

```ts
export interface ForParseResult {
    source: ExpressionNode              // 源数据节点
    value: ExpressionNode | undefined   // 项目节点
    key: ExpressionNode   | undefined   // key 值节点
    index: ExpressionNode | undefined   // 索引节点
}
```  

其中除了 “源数据节点” 外，剩余三个节点都可以为 `undefined`，当省略了其中的某个内容时，对应的节点就是 `undefined` 了，如下  

```html
<!-- 省略 项目 -->
<div v-for="(, key, index) in items"></div>
<!-- 省略 key -->
<div v-for="(item, , index) in items"></div>
<!-- 省略 索引 -->
<div v-for="(item, key,) in items"></div>
```  

而且每个节点都是 表达式节点 `ExpressionNode`，当开启了 `prefixIdentifiers` 时，就会增加数据来源前缀，对于复杂的表达式就会形成 `CompoundExpressionNode`，如下  

```html
<div v-for="({ foo = bar, baz: [qux = quux] }) in getList()"></div>
```  

接下来看看具体的解析过程  

```ts
export function parseForExpression(
    input: SimpleExpressionNode,  // v-for 指令值，此时 v-for 的值还没有经过任何处理，所以是一个简单表达式
    context: TransformContext     // 作用域
): ForParseResult | undefined {
    // 1. 获取指令值的内容
    const loc = input.loc
    const exp = input.content
    // 2. 匹配 v-for in/of 的左侧内容，匹配到的结果是 [_, left, right]
    //    匹配不到直接退出
    const inMatch = exp.match(forAliasRE)
    if (!inMatch) return
    const [, LHS, RHS] = inMatch
    
    // 3. 创建解析结果，并根据右侧的值生成源数据节点，其余均初始化为 undefined
    const result: ForParseResult = {
        source: createAliasExpression(
            loc,
            RHS.trim(),
            exp.indexOf(RHS, LHS.length)
        ),
        value: undefined,
        key: undefined,
        index: undefined
    }

    // 4. 对源数据增加来源前缀
    if (!__BROWSER__ && context.prefixIdentifiers) {
        result.source = processExpression(
            result.source as SimpleExpressionNode,
            context
        )
    }

    // 5. 获取有效内容，这个变量最终会指向项目，由于现在还不知道是否存在 key 和索引，所以先存储为有效内容
    //    如果存在 key 或索引，就会修改，如果不存在那么现在获取到的就是项目
    let valueContent = LHS.trim()
        .replace(stripParensRE, '')
        .trim()
    // 6. 获取有效内容在原始内容中的偏移
    const trimmedOffset = LHS.indexOf(valueContent)
    // 7. 匹配 key 和索引，匹配到的话结果就是 [_, key, index] 的形式
    const iteratorMatch = valueContent.match(forIteratorRE)
    // 8. 处理存在 key 或 索引的情况
    if (iteratorMatch) {
        // 8.1 修改 valueContent 的值为项目
        valueContent = valueContent.replace(forIteratorRE, '').trim()
        // 8.2 获取 key 的有效内容，以及 key 的偏移
        const keyContent = iteratorMatch[1].trim()
        let keyOffset: number | undefined
        // 8.3 处理存在 key 的情况
        if (keyContent) {
            // 8.3.1 获取 key 的偏移，在 trimmedOffset 的基础上加项目的长度
            keyOffset = exp.indexOf(keyContent, trimmedOffset + valueContent.length)
            // 8.3.2 创建 key 的表达式
            result.key = createAliasExpression(loc, keyContent, keyOffset)
            // 8.3.3 为 key 增加前缀
            if (!__BROWSER__ && context.prefixIdentifiers) {
                result.key = processExpression(result.key, context, true)
            }
        }

        // 8.4 处理存在 index 的情况
        if (iteratorMatch[2]) {
            // 8.4.1 获取 index 的有效内容
            const indexContent = iteratorMatch[2].trim()
            // 8.4.2 如果存在 index 则创建节点
            if (indexContent) {
                result.index = createAliasExpression(
                    loc,
                    indexContent,
                    exp.indexOf(
                        indexContent,
                        result.key
                            ? keyOffset! + keyContent.length        // 存在 key，那么索引的偏移就是 key 的偏移 + key 的长度
                            : trimmedOffset + valueContent.length   // 不存在 key，那么索引的偏移就是 trimmedOffset 加项目的长度
                    )
                )
                // 8.4.3 为 index 增加前缀
                if (!__BROWSER__ && context.prefixIdentifiers) {
                    result.index = processExpression(result.index, context, true)
                }
            }
        }
    }

    // 9. 经过上面的步骤，如果存在项目值，则创建对应的节点，并增加前缀
    if (valueContent) {
        result.value = createAliasExpression(loc, valueContent, trimmedOffset)
        if (!__BROWSER__ && context.prefixIdentifiers) {
            result.value = processExpression(result.value, context, true)
        }
    }

    // 10. 返回结果
    return result
}
```  

## 处理 v-for 指令  
这个函数可以理解为处理 `v-for` 指令的入口函数，其中会创建 `v-for` 的节点，先来看看 `v-for` 的节点结构  

```ts
export interface ForNode extends Node {
    type: NodeTypes.FOR                           // 节点类型
    source: ExpressionNode                        // 源数据节点
    valueAlias: ExpressionNode | undefined        // 项目节点
    keyAlias: ExpressionNode | undefined          // key 节点
    objectIndexAlias: ExpressionNode | undefined  // 索引节点
    parseResult: ForParseResult                   // 解析结果
    children: TemplateChildNode[]                 // 子节点列表
    codegenNode?: ForCodegenNode                  // 生成器
}
```  

接下来看源码中是如何实现的  

```ts
export function processFor(
    node: ElementNode,          // 带有 v-for 指令的节点
    dir: DirectiveNode,         // v-for 指令
    context: TransformContext,  // 作用域
    processCodegen?: (forNode: ForNode) => (() => void) | undefined // 创建生成器的回调，参数是创建好的 v-for 节点
) {
    // 1. 如果 v-for 没有值，直接抛错，并结束转换
    if (!dir.exp) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_FOR_NO_EXPRESSION, dir.loc)
        )
        return
    }

    // 2. 解析 v-for 的值，解析失败直接抛错，并结束转换
    const parseResult = parseForExpression(
        dir.exp as SimpleExpressionNode,
        context
    )
    if (!parseResult) {
        context.onError(
            createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, dir.loc)
        )
        return
    }

    const { addIdentifiers, removeIdentifiers, scopes } = context
    const { source, value, key, index } = parseResult

    // 3. 创建 v-for 节点，并将第 2 步中的解析结果也存入
    const forNode: ForNode = {
        type: NodeTypes.FOR,
        loc: dir.loc,
        source,
        valueAlias: value,
        keyAlias: key,
        objectIndexAlias: index,
        parseResult,
        // 跳过 template 节点
        // 如果节点是 template，则直接将其子节点作为 v-for 的 children，否则只将 node 作为 v-for 的 children
        children: isTemplateNode(node) ? node.children : [node]
    }

    // 4. 替换当前节点为 v-for 节点
    context.replaceNode(forNode)
    // 5. 出现一个 v-for 将作用域中的值 + 1
    scopes.vFor++
    // 6. 将项目、key、索引 添加进 identifiers 列表中，在之后解析子节点的时候，碰见这三个变量不会增加前缀
    if (!__BROWSER__ && context.prefixIdentifiers) {
        value && addIdentifiers(value)
        key && addIdentifiers(key)
        index && addIdentifiers(index)
    }
    
    // 7. 执行创建生成节点的回调
    const onExit = processCodegen && processCodegen(forNode)
    
    // 8. 返回函数，等所有子节点转换完成后再执行
    return () => {
        // 8.1 等到所有子节点转换完成后，可以将作用域中的值 vFor 和 identifiers 中的值恢复
        scopes.vFor--
        if (!__BROWSER__ && context.prefixIdentifiers) {
            value && removeIdentifiers(value)
            key && removeIdentifiers(key)
            index && removeIdentifiers(index)
        }
        // 8.2 执行创建生成节点的退出函数
        if (onExit) onExit()
    }
}
```  

## 创建生成器 —— processCodegen  

`v-for` 节点的生成器是 `ForCodegenNode` 类型，接下来先来看看这个结构  

```ts
// v-for 生成器
export interface ForCodegenNode extends VNodeCall {
    isBlock: true
    tag: typeof FRAGMENT
    props: undefined
    children: ForRenderListExpression
    patchFlag: string
    disableTracking: boolean
}

// v-for 子节点
export interface ForRenderListExpression extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ForIteratorExpression]
}

export interface ForIteratorExpression extends FunctionExpression {
  returns: BlockCodegenNode
}
```  
可以看出，`v-for` 的生成器是一个 `Fragment` 节点的创建，并且子节点是 `renderList` 的函数调用  
`renderList` 有两个参数  
1. 是一个 `ExpressionNode`，其实就是源数据节点  
2. 是一个 `FunctionExpression`，就是具体渲染子节点的函数，这个函数又有三个参数，分别是 项目、`key` 以及索引   

接下来看具体的创建过程  

```ts
return processFor(node, dir, context, forNode => {
    // 1. 创建 renderList 函数调用，参数就是源数据节点
    const renderExp = createCallExpression(helper(RENDER_LIST), [
        forNode.source
    ]) as ForRenderListExpression

    // 2. 查找节点上是否存在 key 属性
    const keyProp = findProp(node, `key`)
    // 3. 创建 key 的属性节点
    //    如果 key 是静态属性，则创建对应的简单表达式(对于静态属性的节点来说，它的值是一个文本)
    //    如果 key 是指令，则直接使用指令值
    const keyProperty = keyProp
        ? createObjectProperty(
            `key`,
            keyProp.type === NodeTypes.ATTRIBUTE
              ? createSimpleExpression(keyProp.value!.content, true)
              : keyProp.exp!
          )
        : null

    // 4. 如果存在 key，那么也会对 key 进行来源前缀的增加
    if (!__BROWSER__ && context.prefixIdentifiers && keyProperty) {
        keyProperty.value = processExpression(
            keyProperty.value as SimpleExpressionNode,
            context
        )
    }

    // 5. 检测生成的 Fragment 是否是稳定的，具体可以参考后面的示例
    const isStableFragment =
        forNode.source.type === NodeTypes.SIMPLE_EXPRESSION &&
        forNode.source.constType > 0

    // 6. 生成 Fragment 的 PatchFlag
    const fragmentFlag = isStableFragment
        ? PatchFlags.STABLE_FRAGMENT
        : keyProp
            ? PatchFlags.KEYED_FRAGMENT
            : PatchFlags.UNKEYED_FRAGMENT

    // 7. 创建生成器
    forNode.codegenNode = createVNodeCall(
        context,
        helper(FRAGMENT),
        undefined,
        renderExp,
        fragmentFlag + (__DEV__
            ? ` /* ${PatchFlagNames[fragmentFlag]} */`
            : ``
        ),
        undefined,
        undefined,
        true                // 生成的 Fragment 始终会开启 Block
        !isStableFragment   // 不稳定的情况下，才会追踪
        node.loc
    ) as ForCodegenNode

    // 8. 生成器的退出函数
    return () => {}
}
```  

注意  
1. 第 8 步中的退出函数会在所有子节点都完成转换时执行，也就是 [处理 v-for 指令](#处理-v-for-指令) 中的 8.2 步骤  
2. 这里简单说下上面出现的三种 `PatchFlag`  
    * `PatchFlags.STABLE_FRAGMENT`: 稳定的 `Fragment`，它的子节点不会发生顺序的变化，但是可能存在动态子节点  
       在更新时只会更新动态子节点，不会全量更新  
    * `PatchFlags.KEYED_FRAGMENT`: 子节点中含有 `key` 的 `Fragment`，它的子节点在更新时会根据 `key` 进行 `diff` 算法来更新  
    * `PatchFlags.UNKEYED_FRAGMENT`: 子节点没有 `key` 的 `Fragment`，它的子节点在更新时会全量更新  

    在第 5 步中，只有源数据是简单表达式，并且存在常量类型时才会被认为是 “稳定” 的，看下面这个示例  

    ```html
    <div v-for="item in 10"></div>
    ```  

    这个示例中的源数据是 `10`，它是一个简单表达式，并且 `constType` 是 `ConstantTypes.CAN_STRINGIFY`，所以生成的 `Fragment` 就是稳定的  
    也就是顺序不会发生变化，始终是 `10` 个  
    
    由于 `v-for` 值的节点初始时都是 `ConstantTypes.NOT_CONSTANT` 的，唯一能发生变化就是 [解析](#解析-v-for-的值) 中的第 4 步  
    通过 `transformExpression` 钩子改变  

3. 在第 7 步创建 `Fragment` 生成器的时候，是否需要追踪是根据 `isStableFragment` 取反决定的  
    * 稳定状态下需要追踪  
    * 不稳定状态下不需要追踪  
    
    具体原因可以参数 [创建生成器的退出函数](#创建生成器的退出函数) 中的 8.3  

### 创建生成器的退出函数  
执行到这个函数的时候，所有子节点的生成器都已经创建好了，直接可以使用  

```ts
return () => {
    // 1. 定义 v-for 具体要渲染的节点，也就是 renderList 函数的内容
    let childBlock: BlockCodegenNode
    // 2. 检测是否是 template 上存在 v-for
    const isTemplate = isTemplateNode(node)
    // 3. 获取子节点列表
    //    如果不是 template，那么 children 就是由存在 v-for 指令的节点组成的数组
    //    如果是 template，那么 children 就是 template 的子节点列表
    const { children } = forNode

    // 4. 检测子节点外面是否需要包裹 Fragment
    //    a. 存在多个子节点，template 下有多个子元素
    //    b. 唯一的子节点不是元素，例如文本，template 下是单个文本
    const needFragmentWrapper =
          children.length !== 1 || children[0].type !== NodeTypes.ELEMENT

    // 5. 获取 slot 节点，以下情况都被视为属于 slot 节点
    //    a. <slot v-for="...">
    //    b. <template v-for="..."><slot/></template>
    const slotOutlet = isSlotOutlet(node)
        ? node
        : isTemplate
            && node.children.length === 1
            && isSlotOutlet(node.children[0])
            ? (node.children[0] as SlotOutletNode)
            : null

    // 6. 处理存在 slotOutlet 的情况
    if (slotOutlet) {
        // 6.1 获取生成器，slot 的生成器是一个 renderSlot 的函数调用
        childBlock = slotOutlet.codegenNode as RenderSlotCall
        // 6.2 如果是 template 且存在 key，那么会将 key 注入到 slot 中，如下
        //     <template v-for="..." :key="..."><slot/></template>
        //     因为 template 并不会渲染出来，真正渲染的是 slot，所以会将 template 上的 key 注入到 slot 中
        if (isTemplate && keyProperty) {
            injectProp(childBlock, keyProperty, context)
        }
    }
    // 7. 处理需要包裹 Fragment 的情况，创建 Fragment 节点
    //    包裹的 Fragment 始终会开启一个新的 block 并追踪，并且是稳定的 Fragment
    else if (needFragmentWrapper) {
        childBlock = createVNodeCall(
            context,
            helper(FRAGMENT),
            keyProperty ? createObjectExpression([keyProperty]) : undefined,
            node.children,
            PatchFlags.STABLE_FRAGMENT +
                (__DEV__
                ? ` /* ${PatchFlagNames[PatchFlags.STABLE_FRAGMENT]} */`
                : ``),
            undefined,
            undefined,
            true
        )
    }
    // 8. 处理普通使用 v-for 的情况，也就是 v-for 里是普通元素或组件
    else {
        // 8.1 直接使用子元素的生成器
        childBlock = (children[0] as PlainElementNode).codegenNode as VNodeCall
        // 8.2 如果是 template 且存在 key，需要将 key 注入到子元素中，例如
        //     <template v-for="item in items" :key="item.id"><div></div></template> 
        if (isTemplate && keyProperty) {
            (childBlock, keyProperty, context)
        }
        // 8.3 重写子元素是否为 block，具体内容可以参考后面的示例
        childBlock.isBlock = !isStableFragment
        if (childBlock.isBlock) {
            helper(OPEN_BLOCK)
            helper(CREATE_BLOCK)
        } else {
            helper(CREATE_VNODE)
        }
    }

    // 9. 向 renerList 函数添加第 2 个参数渲染函数
    //    首先会通过 createForLoopParams 以及 v-for 的解析结果 forNode.parseResult 来创建函数的参数
    //    渲染结果就是 childBlock
    renderExp.arguments.push(createFunctionExpression(
        createForLoopParams(forNode.parseResult),
        childBlock,
        true /* force newline */
    ) as ForIteratorExpression)
}
```  

1. 在 8.3 中，根据稳定状态 `isStableFragment` 重写了子元素是否为 `block`  
    考虑以下情况  

    ```html
    <div v-for="item in 10"></div>
    ```  

    现在是稳定状态，此时会将 `div` 的生成器重写为非 `block`，所以外层的 `Fragment` 必须要追踪变化，也就是必须要开启追踪  
    这也就是解释了为什么 [processcodegen](#创建生成器--processcodegen) 过程中，只有非稳定状态下才会对 `Fragment` 开启的 `block` 进行追踪  

    相反，对于非稳定状态，`Fragment` 开启的 `block` 不必在追踪，而是由 `div` 的生成器来完成  

### 创建渲染函数的参数 —— createForLoopParams  
这个函数主要就是根据解析结果中的 项目、`key` 以及索引，如果有对应的值就创建参数，没有就使用占位符  

```ts
export function createForLoopParams({
    value,
    key,
    index
}: ForParseResult): ExpressionNode[] {
    // 1. 参数列表
    const params: ExpressionNode[] = []
    // 2. 如果存在项目，则将其添加进参数列表中
    if (value) {
        params.push(value)
    }
    // 3. 如果存在 key，则将其添加进参数列表中
    //    首先会兼容不存在项目的情况，项目不存在使用 _ 占位符
    if (key) {
        if (!value) {
            params.push(createSimpleExpression(`_`, false))
        }
        params.push(key)
    }
    // 4. 如果存在索引，则将其添加进参数列表中
    //    首先会兼容不存在 key 和项目的情况，分别使用 _ 和 __ 作为占位符
    if (index) {
        if (!key) {
            if (!value) {
                params.push(createSimpleExpression(`_`, false))
            }
            params.push(createSimpleExpression(`__`, false))
        }
        params.push(index)
    }
    // 5. 返回参数列表
    return params
}
```  
