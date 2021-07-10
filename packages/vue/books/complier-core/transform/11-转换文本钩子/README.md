<!-- TOC -->

- [什么时候需要转换文本](#什么时候需要转换文本)
- [检测文本](#检测文本)
- [转换为本 —— transformText](#转换为本--transformtext)

<!-- /TOC -->

## 什么时候需要转换文本  
转换文本可能不太好理解，可以将转换更好的理解为 “合并”  
当一个节点内存在**多个连续**的文本和插值时(**只限于这两种类型**)，会将它们合并为一个 “复合表达式节点”  
例如下面的示例，`div` 存在三个子节点，文本 `hello`，插值 `{{ name }}`，文本 `.`，现在会将它们三个节点合并为一个节点  

```html
<div>hello {{ name }}.</div>
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
                          	// 4.1.3.1 复合节点不存在，先创建复合节点，并将当前节点作为第一个子节点
                          	// 				 同时将当前节点的位置替换为复合节点
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
          
          	// 在看下面内容之前，先要说明一个指示点，就是创建 vnode 的函数 createVNode，可以在 runtime-core 中找到
          	// 这个函数的第三个参数是子节点
          	// 可以是一个 string，代表文本
          	// 可以是一个 array，代表子节点列表，其中每个元素都必须是 vnode
          	// 所以如果存在 array 的情况，要保证其中的文本都是 vnode，而不再是文本节点、插值、复合表达式了

            // 5. 经过上面的步骤，已经将子节点中所有能合并的都合并了
            //    如果出现以下情况，则不再进行任务处理
            //    a. 没有文本
            //    b. 存在文本，在根节点或原生节点中只存在一个文本子节点，可以将子节点作为 string 创建 vnode
            if (
                !hasText ||
                (children.length === 1 &&
                (node.type === NodeTypes.ROOT ||
                    (node.type === NodeTypes.ELEMENT &&
                    node.tagType === ElementTypes.ELEMENT)))
            ) {
                return
            }

            // 6. 接下来的情况要对文本进行 createTextVNode 的封装调用，形成 vnode
          	//    遍历所有的子节点
            for (let i = 0; i < children.length; i++) {
                const child = children[i]
                // 6.1 只会处理文本、插值以及复合节点
                if (isText(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
                    // 6.2 调用 createTextVNode 的参数列表
                    const callArgs: CallExpression['arguments'] = []
                    // 6.3 满足以下条件会将 child 作为 createTextVNode 的第一个参数
                    //		 child 是插值、复合节点
                    //		 child 不是空的文本节点
                    if (child.type !== NodeTypes.TEXT || child.content !== ' ') {
                        callArgs.push(child)
                    }
                    // 6.4 如果 child 的内容不是常量，则加入 PatchFlags.TEXT 作为第二个参数
                    if (
                        !context.ssr &&
                        getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
                    ) {
                        callArgs.push(
                            PatchFlags.TEXT +
                                (__DEV__ ? ` /* ${PatchFlagNames[PatchFlags.TEXT]} */` : ``)
                        )
                    }
                    
                    // 6.5 将当前节点修改为 TEXT_CALL 节点，并且生成器是 createTextVNode 的函数调用
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
    codegenNode: CallExpression | SimpleExpressionNode              // 生成器
}
```

注意生成器除了函数调用外，还可能是简单表达式，这种情况发生在静态提升的情况下