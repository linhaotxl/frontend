<!-- TOC -->

- [v-if 节点](#v-if-节点)
- [if 分支节点](#if-分支节点)
- [if 条件表达式节点](#if-条件表达式节点)
- [v-if 转换函数 —— transformIf](#v-if-转换函数--transformif)
- [创建指令转换函数 —— createStructuralDirectiveTransform](#创建指令转换函数--createstructuraldirectivetransform)
- [转换函数 —— processIf](#转换函数--processif)
- [创建生成器回调 —— processCodegen](#创建生成器回调--processcodegen)
- [获取最近的 if 表达式 —— getParentCondition](#获取最近的-if-表达式--getparentcondition)
- [根据分支创建生成器节点 —— createCodegenNodeForBranch](#根据分支创建生成器节点--createcodegennodeforbranch)
- [创建子节点的生成器节点 —— createChildrenCodegenNode](#创建子节点的生成器节点--createchildrencodegennode)

<!-- /TOC -->

## v-if 节点  
先来看 `if` 节点的结构  

```ts
export interface IfNode extends Node {
    // 节点类型
    type: NodeTypes.IF
    // 节点分支集合
    branches: IfBranchNode[]
    // if 生成器节点
    codegenNode?: IfConditionalExpression | CacheExpression // <div v-if v-once>
}
```

这个 `IfNode` 类型，实际并不代表 `v-if`，而是代表一整套的 `v-if`、`v-else-if` 和 `v-else`  

上面这三种指令就属于 `if` 分支节点，即 `IfBranchNode`，它们作为 `branches` 属性存在于 `IfNode` 中  
`IfNode.branches` 最少也会有一个元素，就是 `v-if` 分支  

## if 分支节点  
先来看分支节点的结构  

```ts
export interface IfBranchNode extends Node {
    type: NodeTypes.IF_BRANCH               // 节点类型为 if 分支
    condition: ExpressionNode | undefined   // 分支的条件，v-else 不存在条件
    children: TemplateChildNode[]           // 分支子节点
    userKey?: AttributeNode | DirectiveNode
}
```  

其中 `children` 所指的就是分支所在的节点，而且一定是数组  

这里先了解下大致的转换过程，例如以下代码  

```html
<div v-if="a">a</div>
<div v-else-if="b">b</div>
<div v-else>c</div>
```

会被转换为下面的节点(伪代码)  

```ts
{
    type: NodeTypes.IF,
    branches: [
        {
            type: NodeTypes.IF_BRANCH,
            condition: 'a',
            children: ['<div>a</div>']
        },
        {
            type: NodeTypes.IF_BRANCH,
            condition: 'b',
            children: ['<div>b</div>']
        },
        {
            type: NodeTypes.IF_BRANCH,
            condition: undefined,
            children: ['<div>c</div>']
        },
    ]
}
```

接下来看创建分支节点的过程  

```ts
function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
    return {
        type: NodeTypes.IF_BRANCH,  // 节点类型为 if 分支
        loc: node.loc,              // 定位为节点的定位
        // 条件，v-else 为 undefined，v-if、v-else-if 为指令节点的值
        condition: dir.name === 'else' ? undefined : dir.exp,
        // 子节点
        // 不带有 v-foo 的 template，就是 template 的子元素
        // 剩余情况都是元素自身组成的数组
        children:
            node.tagType === ElementTypes.TEMPLATE && !findDir(node, 'for')
                ? node.children
                : [node],
        userKey: findProp(node, `key`)
    }
}
```  

可以看到，针对于没有 `v-for` 的 `template` 元素，相当于跳过了 `template`，直接获取了子元素，例如  

```html
<template v-if="a">
    <div>a</div>
    <div>b</div>
</template>
```

会被转换为  

```ts
{
    type: NodeTypes.IF,
    branches: [
        {
            type: NodeTypes.IF_BRANCH,
            condition: 'a',
            children: [
                '<div>a</div>',
                '<div>b</div>',
            ]
        },
    ]
}
```  

## if 条件表达式节点  
可以看到，`if` 节点的生成器可能是 `if` 条件表达式 —— `IfConditionalExpression`，这个节点能描述 `if..else if..else` 这种形式，先来看它的结构  

```ts
export interface IfConditionalExpression extends ConditionalExpression {
    // 满足条件的节点
    consequent: BlockCodegenNode
    // 不满足条件的节点
    alternate: BlockCodegenNode | IfConditionalExpression
}
```  

我们先来看单独的 条件表达式 的结构  

```ts
export interface ConditionalExpression extends Node {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION   // 节点类型
    test: JSChildNode                           // 条件语句
    consequent: JSChildNode                     // 满足条件的节点
    alternate: JSChildNode                      // 不满足条件的节点
    newline: boolean
}
```  

再来看 `if` 条件表达式中，不满足条件的 `alternate` 可能还是一个 `IfConditionalExpression`，这里为什么会出现嵌套关系？
实际就是把 `else..if` 又当做一个 `if` 看待，这样就能描述多个 `else..if` 了  

例如有下面代码  

```ts
if (a) { console.log(a) }
else if (b) { console.log(b) }
else if (c) { console.log(c) }
else { console.log(d) }

// 用下面的结构就可以描述上面的 if 表达式
{
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test: 'a',
    consequent: 'console.log(a)',
    alternate: {
        type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
        test: 'b',
        consequent: 'console.log(b)',
        alternate: alternate: {
            type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
            test: 'c',
            consequent: 'console.log(c)',
            alternate: 'console.log(d)'
        }
    }
}
``` 

## v-if 转换函数 —— transformIf  
`transformIf` 的实现很简单，只是一个封装函数  

```ts
export const transformIf = createStructuralDirectiveTransform(
    /^(if|else|else-if)$/,
    (node, dir, context) => {
        return processIf(node, dir, context, (ifNode, branch, isRoot) => {
            /* ... */
        })
    }
)
```

`transformIf` 最终会被用在 `transform.options.nodeTransforms` 数组中，所以 `createStructuralDirectiveTransform` 的返回值类型必须是 `NodeTransform`  

接下来看看这个函数具体做了什么  

## 创建指令转换函数 —— createStructuralDirectiveTransform  
这个函数会创建一个指令转换函数，它只对匹配的指令调用回调 `fn`，并保存转换完成的回调  

```ts
export function createStructuralDirectiveTransform(
    name: string | RegExp,              // 需要处理的指令名
    fn: StructuralDirectiveTransform    // 具体的处理方法
): NodeTransform {
    // 匹配函数
    const matches = isString(name)
        ? (n: string) => n === name
        : (n: string) => name.test(n)

    // 返回转换函数，被 traverseNode 调用
    return (node, context) => {
        // 1. 过滤非元素节点
        if (node.type === NodeTypes.ELEMENT) {
            const { props } = node
            // 2. 不会处理带有 v-slot 的 template 元素，它会被 v-slot 的转换函数处理
            if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
                return
            }
            
            // 3. 转换完成回调列表，当 node 的所有子元素被转换完成后，会从后往前依次执行
            const exitFns = []
            
            // 4. 遍历所有的 props
            for (let i = 0; i < props.length; i++) {
                const prop = props[i]
                // 4.1 过滤掉不是指令的节点，以及不满足指令名称的节点
                if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
                    // 4.1.1 将指令从节点中移除
                    props.splice(i, 1)
                    i--
                    // 4.1.2 对指令执行回调
                    const onExit = fn(node, prop, context)
                    // 4.1.3 保存转换完成的回调
                    if (onExit) exitFns.push(onExit)
                }
            }

            // 5. 转换完成回调列表
            return exitFns
        }
    }
}
```

这个函数会被用在很多指令，算是一个创建转换的标准函数  

## 转换函数 —— processIf  
这个函数是转换 `v-if` 的真正函数，被 [transformIf](#v-if-转换函数--transformif) 调用

```ts
export function processIf(
    node: ElementNode,          // 元素节点
    dir: DirectiveNode,         // 指令节点
    context: TransformContext,  // 作用域对象
    processCodegen?: (          // 创建生成器的回调
        node: IfNode,           // if 节点
        branch: IfBranchNode,   // 分支节点
        isRoot: boolean         // 是否是 v-if 分支，false 代表是 v-else-if 或 v-else
    ) => (() => void) | undefined
) {
    // 1. 检测指令的合法性：如果不是 v-else，并且也没有有效值
    if (
        dir.name !== 'else' &&
        (!dir.exp || !(dir.exp as SimpleExpressionNode).content.trim())
    ) {
        const loc = dir.exp ? dir.exp.loc : node.loc
        context.onError(
            createCompilerError(ErrorCodes.X_V_IF_NO_EXPRESSION, dir.loc)
        )
        // TODO: 将值改写为 true 表达式，注意这里并不是静态表达式
        dir.exp = createSimpleExpression(`true`, false, loc)
    }

    // 2. 处理指令值是复杂表达式的情况，由 processExpression 完成复杂表达式的转换，并更新到指令值
    //    例如 v-if="a + b"
    if (!__BROWSER__ && context.prefixIdentifiers && dir.exp) {
        dir.exp = processExpression(dir.exp as SimpleExpressionNode, context)
    }

    // 3. 处理 v-if
    if (dir.name === 'if') {
        // 3.1 创建 v-if 分支节点
        const branch = createIfBranch(node, dir)
        // 3.2 创建 if 节点，并将 v-if 分支存入 branches 中
        const ifNode: IfNode = {
            type: NodeTypes.IF,
            loc: node.loc,
            branches: [branch]
        }
        // 3.3 将当前节点替换为 if 节点，替换后成功后，在 traverseNode 中，会对每个分支节点进行遍历
        context.replaceNode(ifNode)
        // 3.4 执行节点生成器回调，并退出回调返回的函数，最终记录在转换完成的回调中
        if (processCodegen) {
            return processCodegen(ifNode, branch, true)
        }
    }
    // 4. 处理 v-else-if、v-else
    else {
        // 4.1 获取所有子节点
        const siblings = context.parent!.children
        // 4.2 存放注释的列表
        const comments = []
        // 4.3 获取当前节点的索引位置
        let i = siblings.indexOf(node)
        // 4.4 从当前节点 node 开始向前遍历
        while (i-- >= -1) {
            // 4.4.1 获取前一个节点
            const sibling = siblings[i]
            // 4.4.2 如果前一个节点是注释，那么会把注释移除，并存入 comments 中
            if (__DEV__ && sibling && sibling.type === NodeTypes.COMMENT) {
                context.removeNode(sibling)
                comments.unshift(sibling)
                continue
            }

            // 4.4.3 如果前一个节点是空白的文本节点，将文本移除
            if (
                sibling &&
                sibling.type === NodeTypes.TEXT &&
                !sibling.content.trim().length
            ) {
                context.removeNode(sibling)
                continue
            }

            // 4.4.4 如果前一个节点是 if 节点
            if (sibling && sibling.type === NodeTypes.IF) {
                // 4.4.5 将当前节点移除
                context.removeNode()
                // 4.4.6 为当前节点创建分支节点
                const branch = createIfBranch(node, dir)
                // 4.4.7 如果当前节点前存在注释，那么会将注释放在当前节点前
                if (__DEV__ && comments.length) {
                    branch.children = [...comments, ...branch.children]
                }

                // 4.4.8 将当前分支存入 if 节点中
                sibling.branches.push(branch)
                // 4.4.9 执行节点生成器回调
                const onExit = processCodegen && processCodegen(sibling, branch, false)
                // 4.4.10 新创建的分支节点还没有遍历，所以需要重新遍历
                traverseNode(branch, context)
                // 4.4.11 在所有的子节点遍历完成后，调用退出函数
                if (onExit) onExit()
                // TODO:
                context.currentNode = null
            }
            // 4.4.5 v-else-if、v-else 前面没有 v-if，抛错
            else {
                context.onError(
                    createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc)
                )
            }
            break
        }
    }
}
```

接下来看生成器节点的创建  

## 创建生成器回调 —— processCodegen  
```ts
return processIf(node, dir, context, (ifNode, branch, isRoot) => {
    // 1. 获取子节点集合
    const siblings = context.parent!.children
    // 2. 获取当前 if 节点所在的位置
    let i = siblings.indexOf(ifNode)
    // 3. 分支的 key，初始为前面所有的 if 节点分支数之和
    let key = 0
    while (i-- >= 0) {
        const sibling = siblings[i]
        if (sibling && sibling.type === NodeTypes.IF) {
            key += sibling.branches.length
        }
    }

    // 4. 退出函数，当所有子节点都完成转换时再调用
    return () => {
        // 4.1 处理 v-if 节点，创建生成器节点，并挂载在 if 节点上
        if (isRoot) {
            ifNode.codegenNode = createCodegenNodeForBranch(
                branch,
                key,
                context
            ) as IfConditionalExpression
        }
        // 4.2 处理 v-else-if、v-else 节点
        else {
            // 4.2.1 首先获取父级条件表达式语句
            const parentCondition = getParentCondition(ifNode.codegenNode!)
            // 4.2.2 修改 alternate 分支
            parentCondition.alternate = createCodegenNodeForBranch(
                branch,
                key + ifNode.branches.length - 1,
                context
            )
        }
    }
})
```

1. 可以看到，源码中对每一个分支都创建了 `key`，并且在同一层子节点中，`key` 是依次递增的，无论有多少个 `if`，例如  

    ```html
    <div v-if="a">a</div>
    <div v-else-if="b">b</div>
    <div v-else="b">c</div>
    <div v-if="d">d</div>
    ```

    上面 4 个分支的 `key` 依次为 0，1，2，3  

2. 在 [上面](#if-条件表达式节点) 介绍过 `ifNode` 的生成器类型，从 4.1 可以看出的确是 `IfConditionalExpression`  
    而之前也说过，`if` 条件表达式会出现嵌套情况，就是发生在 4.2.2 的
   但在这之前会先获取 “最近的 `if` 条件表达式”(通过 4.2.1)，因为嵌套的 `v-else-if`、`v-else` 需要修改最近的 `alternate`
   参考下面的示例

    ```html
    <div v-if="a">a</div>
    <div v-else-if="b">b</div>
    <div v-else-if="c">c</div>
    <div v-else>d</div>
    ```  
    转换结果(`b` 修改的还是 `a` 产生的 “条件表达式”，而 `c` 修改的是最近的，即 `b` 产生的 “条件表达式”)  
    ```ts
    {
        type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
        test: 'a',
        consequent: '<div>a</div>',
        altername: {
            type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
            test: 'b',
            consequent: '<div>b</div>',
            altername: {
                type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
                test: 'c',
                consequent: '<div>c</div>',
                altername: '<div>d</div>'
            }
        }
    }
    ```  

接下来先看如果获取 “最近的 `if` 表达式”  

## 获取最近的 if 表达式 —— getParentCondition  
获取最近的条件表达式节点  

```ts
function getParentCondition(
    node: IfConditionalExpression | CacheExpression // 这个节点肯定是 if 节点上的生成器节点，即 v-if 产生的 条件表达式
): IfConditionalExpression {
    while (true) {
        if (node.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
            if (node.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
                // 存在嵌套，修改 node 为嵌套的 条件表达式，继续查找，直到没有嵌套为止
                node = node.alternate
            } else {
                // 没有嵌套，直接返回 v-if 产生的 条件表达式
                return node
            }
        } else if (node.type === NodeTypes.JS_CACHE_EXPRESSION) {
            node = node.value as IfConditionalExpression
        }
    }
}
```  

## 根据分支创建生成器节点 —— createCodegenNodeForBranch  
这个函数用来创建每个分支的生成器节点  
对于有条件的分支(`v-if`、`v-else-if`)来说，生成器节点是一个 `if` 条件表达式  
至于没有条件的分支(`v-else`)，它的生成器节点就是 `v-else` 所在节点的生成器节点   

接下来看创建分支生成器节点的具体实现  

```ts
function createCodegenNodeForBranch(
    branch: IfBranchNode,     // 分支节点
    keyIndex: number,         // 分支 key
    context: TransformContext // 作用域
): IfConditionalExpression | BlockCodegenNode {
    // 处理 v-if、v-else-if
    if (branch.condition) {
        // 创建条件表达式节点
        return createConditionalExpression(
            branch.condition,
            // 创建满足条件的节点
            createChildrenCodegenNode(branch, keyIndex, context),
            // 创建不满足条件的节点，v-if 和 v-else-if 不满足条件的节点都是注释
            createCallExpression(context.helper(CREATE_COMMENT), [
                __DEV__ ? '"v-if"' : '""',
                'true'
            ])
        ) as IfConditionalExpression
    }
    // 处理 v-else
    else {
        return createChildrenCodegenNode(branch, keyIndex, context)
    }
}
```

## 创建子节点的生成器节点 —— createChildrenCodegenNode  
这个函数会创建不同分支的生成器节点  

```ts
function createChildrenCodegenNode(
    branch: IfBranchNode,     // 分支节点
    keyIndex: number,         // 分支 key
    context: TransformContext // 作用域对象
): BlockCodegenNode {
    const { helper } = context
    // 1. 创建分支 key 的属性节点
    const keyProperty = createObjectProperty(
        `key`,
        // 创建 key 的表达式，非静态
        createSimpleExpression(
            `${keyIndex}`,
            false,
            locStub,
            // TODO: 为什么是 CAN_HOIST
            ConstantTypes.CAN_HOIST
        )
    )

    // 2. 获取第一个子节点
    const { children } = branch
    const firstChild = children[0]
    // 3. 检测是否需要包裹 Fragment 节点，满足一下任意条件就需要包裹
    //    a. 有多个子节点
    //    b. 第一个节点不是元素
    const needFragmentWrapper =
        children.length !== 1 ||
        firstChild.type !== NodeTypes.ELEMENT

    // 4. 需要 Fragment
    if (needFragmentWrapper) {
        // 4.1
        if (children.length === 1 && firstChild.type === NodeTypes.FOR) {
            // optimize away nested fragments when child is a ForNode
            const vnodeCall = firstChild.codegenNode!
            injectProp(vnodeCall, keyProperty, context)
            return vnodeCall
        }
        // 4.2 存在多个子节点，创建 Fragment 的生成器节点
        else {
            return createVNodeCall(
                context,
                helper(FRAGMENT),
                // if 所产生的 key 作用在了 Fragment 上
                createObjectExpression([keyProperty]),
                children,
                // Fragment 的 PatchFlag 为 STABLE_FRAGMENT
                PatchFlags.STABLE_FRAGMENT +
                (__DEV__
                    ? ` /* ${PatchFlagNames[PatchFlags.STABLE_FRAGMENT]} */`
                    : ``),
                undefined,
                undefined,
                true,
                false,
                branch.loc
            )
        }
    }
    // 5. 不需要 Fragment
    else {
        // 5.1 获取第一个子元素的生成器节点，此时所有子元素都已经转换完成，所以肯定会存在生成器节点
        const vnodeCall = (firstChild as ElementNode).codegenNode as BlockCodegenNode
        // 5.2 如果是生成器是节点，则标识需要开启 Block
        if (vnodeCall.type === NodeTypes.VNODE_CALL) {
            vnodeCall.isBlock = true
            helper(OPEN_BLOCK)
            helper(CREATE_BLOCK)
        }
        // 5.3 注入 if 分支产生的 key
        injectProp(vnodeCall, keyProperty, context)
        // 5.4 返回第一个子节点的生成器节点
        return vnodeCall
    }
}
```  

1. 对于生成器是节点，必须开启 `block`，例如  

```html
<div v-if="a">a</div>
```  

会被转换为    

```ts
(_ctx.a)
    ? (_openBlock(), _createBlock("div", { key: 0 }, "a"))
    : (_openBlock(), _createBlock("div", { key: 1 }, "b"))
```  

可以看到，每个分支都会创建一个 `block`  

2. 在 [创建 if 分支节点](#创建分支节点--createifbranch) 中我们知道，分支的子元素只有在 `<template />` 这种情况下，才会有多个  
   所以如果是通过多个子元素来包裹 `Fragment` 也只有这一种情况  

    ```html
    <template v-if="a">
        <span>1</span>
        <span>2</span>
    </template>
    ```  
    被转换为  
    ```ts
    (_ctx.a)
        ? (_openBlock(), _createBlock(_Fragment, { key: 0 }, [
            _createVNode("span", null, "1"),
            _createVNode("span", null, "2")
        ], 64 /* STABLE_FRAGMENT */))
        : _createCommentVNode("v-if", true)
    ```  

3. 对于生成器不是节点类型来说，是不需要开启 `block` 的，例如 `slot`，如下  

```html
<slot v-if="b" />
```  

被转换为  

```ts
(_ctx.b)
    ? _renderSlot(_ctx.$slots, "default", { key: 0 })
    : _createCommentVNode("v-if", true)
```  
