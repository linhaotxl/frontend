<!-- TOC -->

- [解析 v-for 的值](#解析-v-for-的值)
- [处理 v-for 指令](#处理-v-for-指令)

<!-- /TOC -->

**这篇开始详细介绍 `v-for` 指令的相关内容，它属于结构指令，所以最终会被放进作用域中的 `nodeTransforms` 而不是 `directiveTransforms`**  

## 解析 v-for 的值  
先来看一条完整的 `v-for` 指令都有哪些内容  

```html
<div v-for="( item, key, index ) in items"></div>
```  
在下面的内容中，会按照以下的名称来对应出现的各个内容  
1. 项目 -> `item`  
2. key -> `key`  
3. 索引 -> `index`  
4. 目标 -> `items`  
5. 原始内容 -> `( item, key, index )`  
6. 有效内容(原始内容去除空格和左右的空白符) -> `item, key, index`  

在源码中，首先会对 `v-for` 的值进行解析，得到解析结果后再进行操作，先来看看解析结果  

```ts
export interface ForParseResult {
    source: ExpressionNode              // 目标节点
    value: ExpressionNode | undefined   // 项目节点
    key: ExpressionNode   | undefined   // key 值节点
    index: ExpressionNode | undefined   // 索引节点
}
```  

其中除了 “目标节点” 外，剩余三个节点都可以为 `undefined`，当省略了其中的某个内容时，对应的节点就是 `undefined` 了，如下  

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

接下来看看源码中是如何解析的  

```ts
export function parseForExpression(
    input: SimpleExpressionNode,  // v-for 指令值，此时 v-for 的值还没有经过任何处理，所以是一个简单表达式
    context: TransformContext     // 作用域
): ForParseResult | undefined {
    // 1. 获取指令值的内容
    const loc = input.loc
    const exp = input.content
    // 2. 匹配 v-for in/of 的左侧、右侧内容，匹配到的结果是 [_, left, right]
    //    匹配不到直接退出
    const inMatch = exp.match(forAliasRE)
    if (!inMatch) return
    const [, LHS, RHS] = inMatch
    
    // 3. 创建解析结果，并根据右侧的值生成目标节点，其余均初始化为 undefined
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

    // 4. 对目标增加来源前缀
    if (!__BROWSER__ && context.prefixIdentifiers) {
        result.source = processExpression(
            result.source as SimpleExpressionNode,
            context
        )
    }

    // 5. 获取有效内容，这个变量最终会指向项目，现在还不知道是否存在 key 和索引，如果存在接下来还会修改，如果不存在那么现在获取到的就是项目
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
            // 8.3.1 获取 key 的偏移
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
                            ? keyOffset! + keyContent.length
                            : trimmedOffset + valueContent.length
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
    source: ExpressionNode                        // 目标节点
    valueAlias: ExpressionNode | undefined        // 项目节点
    keyAlias: ExpressionNode | undefined          // key 节点
    objectIndexAlias: ExpressionNode | undefined  // 索引节点
    parseResult: ForParseResult                   // 解析结果
    children: TemplateChildNode[]                 // 子节点列表
    codegenNode?: ForCodegenNode                  // 生成节点
}
```  

接下来看源码中是如何实现的  

```ts
export function processFor(
    node: ElementNode,          // 带有 v-for 指令的节点
    dir: DirectiveNode,         // v-for 指令
    context: TransformContext,  // 作用域
    processCodegen?: (forNode: ForNode) => (() => void) | undefined // 创建生成节点的回调，参数是创建好的 v-for 节点
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

    // 3. 创建 v-for 节点，并将第 2 步中的结果也存入节点中
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
    // 6. 将项目，key，所以添加进 identifiers 列表中，在之后解析子节点的时候，碰见这三个变量不会增加前缀
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

