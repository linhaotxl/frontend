<!-- TOC -->

- [什么时候需要转换文本](#什么时候需要转换文本)
- [检测文本](#检测文本)
- [转换为本 —— transformText](#转换为本--transformtext)

<!-- /TOC -->

## 什么时候需要转换文本  
转换文本可能不太好理解，可以将转换更好的理解为 “合并”  
当一个节点内存在**多个连续**的文本和插值时(**只限于这两种类型**)，会将它们合并为一个 “复合表达式节点”  
例如下面的示例，`div` 存在三个子节点，文本 `hello`，简单表达式插值，文本 `.`，现在会将它们三个节点合并为一个节点  

```html
<div>hello {{ name }}.</div>
```  

先来看看复合表达式的结构  
```ts
export interface CompoundExpressionNode extends Node {
    type: NodeTypes.COMPOUND_EXPRESSION // 类型为复合节点
    children: (                         // 合并好的节点列表
        | SimpleExpressionNode
        | CompoundExpressionNode
        | InterpolationNode
        | TextNode
        | string
        | symbol)[]
```  

总共有四种情况会发生文本合并  
1. 元素节点中的子节点会合并  
2. 根节点中的子节点会合并  
3. `v-if` 条件中的子节点会合并  
4. `v-for` 循环中的子节点会合并  

## 检测文本  
在合并的过程中，会将 “文本节点” 和 “插值节点” 都视为文本，所以只有这两种类型的节点可以发生合并  

```ts
export function isText(node: TemplateChildNode): node is TextNode | InterpolationNode {
  return node.type === NodeTypes.INTERPOLATION || node.type === NodeTypes.TEXT
}
```  

## 转换为本 —— transformText  

```ts
export const transformText: NodeTransform = (node, context) => {
    // 只会针对上面说的四种情况
    if (
        node.type === NodeTypes.ROOT ||
        node.type === NodeTypes.ELEMENT ||
        node.type === NodeTypes.FOR ||
        node.type === NodeTypes.IF_BRANCH
    ) {
        // 会等到所有子节点全部处理完成后再执行
        return () => {
            // 1. 获取所有子节点
            const children = node.children
            // 2. 合并后的复合节点
            let currentContainer: CompoundExpressionNode | undefined = undefined
            // 3. 是否存在文本的开关
            let hasText = false

            // 4. 遍历所有子节点
            for (let i = 0; i < children.length; i++) {
                const child = children[i]
                // 4.1 如果出现文本节点
                if (isText(child)) {
                    // 4.1.1 标识存在文本节点
                    hasText = true
                    // 4.1.2 从当前节点开始，遍历后面的所有节点
                    for (let j = i + 1; j < children.length; j++) {
                        const next = children[j]
                        // 4.1.3 如果后面的节点也是文本
                        if (isText(next)) {
                            // 4.1.3.1 将 currentContainer 修改为复合节点，同时也会将文本节点替换为复合节点
                            if (!currentContainer) {
                                currentContainer = children[i] = {
                                    type: NodeTypes.COMPOUND_EXPRESSION,
                                    loc: child.loc,
                                    children: [child]
                                }
                            }
                            // 4.1.3.2 将后面出现的文本节点存入复合节点中，中间用 + 连接
                            currentContainer.children.push(` + `, next)
                            // 4.1.3.3 删除后面出现的文本节点，由于删除一个元素，所以索引 j 也要 - 1
                            children.splice(j, 1)
                            j--
                        }
                        // 4.1.4 如果后面的节点出现非文本的情况，退出内部循环，currentContainer 置为 undefined
                        //       表示一个复合节点已经结束，如果后面还存在可以合并的情况，那么会再合并出一个复合节点
                        else {
                            currentContainer = undefined
                            break
                        }
                    }
                }
            }

            // 5. 经过上面的步骤，已经将子节点中所有能合并的都合并了
            //    如果出现以下情况，则不再进行额外的操作
            //    a. 没有文本
            //    b. 存在文本，只有一个子节点，要么是根节点，要么是原生节点
            if (
                !hasText ||
                // if this is a plain element with a single text child, leave it
                // as-is since the runtime has dedicated fast path for this by directly
                // setting textContent of the element.
                // for component root it's always normalized anyway.
                (children.length === 1 &&
                (node.type === NodeTypes.ROOT ||
                    (node.type === NodeTypes.ELEMENT &&
                    node.tagType === ElementTypes.ELEMENT)))
            ) {
                return
            }

            // 6. 接下来的情况要对文本进行 createTextVNode 的封装调用，这里说下为什么需要 createTextVNode 调用
            //    如果能走到这一步，要么是存在多个子节点，要么是只存在一个子节点的组件，无论哪一种情况，在之后调用 createVNode 时
            //    子节点都必须是一个数组，而数组中的每个元素都必须是 vnode 对象
            //    对于文本就是在这里处理，而对于元素是在元素的钩子中处理
            for (let i = 0; i < children.length; i++) {
                const child = children[i]
                // 6.1 只会处理文本、插值以及复合节点
                if (isText(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
                    // 6.2 调用 createTextVNode 的参数列表
                    const callArgs: CallExpression['arguments'] = []
                    // 当 child 不是空文本时，会将 child 加入参数列表中，之后会通过 createTextVNode 创建这个节点
                    // 6.3 
                    if (child.type !== NodeTypes.TEXT || child.content !== ' ') {
                        callArgs.push(child)
                    }
                    // 6.4 如果 child 的内容不是常量，则加入 PatchFlags.TEXT 参数
                    if (
                        !context.ssr &&
                        getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
                    ) {
                        callArgs.push(
                            PatchFlags.TEXT +
                                (__DEV__ ? ` /* ${PatchFlagNames[PatchFlags.TEXT]} */` : ``)
                        )
                    }
                    
                    // 6.5 将当前节点修改为 TEXT_CALL 节点，并且生成节点是 CREATE_TEXT 的函数调用
                    children[i] = {
                        type: NodeTypes.TEXT_CALL,
                        content: child,
                        loc: child.loc,
                        codegenNode: createCallExpression(
                            context.helper(CREATE_TEXT),
                            callArgs
                        )
                    }
                }
            }
        }
    }
}
```  

最后来看下 `TEXT_CALL` 节点的结构  

```ts
export interface TextCallNode extends Node {
    type: NodeTypes.TEXT_CALL                                       // 节点类型
    content: TextNode | InterpolationNode | CompoundExpressionNode  // 对应的文本型节点
    codegenNode: CallExpression | SimpleExpressionNode              // 生成节点，可以是函数调用
}
```  
