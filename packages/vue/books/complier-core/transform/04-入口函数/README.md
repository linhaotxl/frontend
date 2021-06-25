<!-- TOC -->

- [转换入口 —— transform](#转换入口--transform)
    - [转换节点 —— traverseNode](#转换节点--traversenode)
    - [转换子节点 —— traverseChildren](#转换子节点--traversechildren)
- [创建结构指令 —— createStructuralDirectiveTransform](#创建结构指令--createstructuraldirectivetransform)

<!-- /TOC -->

这篇从入口函数 [transform](#转换入口--transform) 开始，大致了解转换的过程  

## 转换入口 —— transform  
这个函数内容比较简单，先看源码   

```ts
export function transform(
    root: RootNode,             // 解析完的根节点
    options: TransformOptions   // 作用域配置对象
) {
    // 1. 创建作用域
    const context = createTransformContext(root, options)
    // 2. 从根节点开始依次向下转换
    traverseNode(root, context)
    // 3. 对节点进行静态提升
    if (options.hoistStatic) {
        hoistStatic(root, context)
    }
    // 4. 创建根节点的生成器
    if (!options.ssr) {
        createRootCodegen(root, context)
    }
    // 5. 将作用域中的属性挂载在根节点上
    root.helpers = [...context.helpers]
    root.components = [...context.components]
    root.directives = [...context.directives]
    root.imports = [...context.imports]
    root.hoists = context.hoists
    root.temps = context.temps
    root.cached = context.cached
}
```  

第 5 步中将作用域中的内容挂载在了根节点上，接下来复习下根节点的结构  

```ts
export interface RootNode extends Node {
    type: NodeTypes.ROOT            // 节点类型为 ROOT
    children: TemplateChildNode[]   // 子节点列表
    helpers: symbol[]               // 帮助模块列表
    components: string[]            // 自定义组件列表
    directives: string[]            // 自定义指令列表
    hoists: (JSChildNode | null)[]  // 静态提升节点列表
    imports: ImportItem[]           
    cached: number                  // 缓存个数
    temps: number                   // 临时变量个数
    ssrHelpers?: symbol[]
    codegenNode?: TemplateChildNode | JSChildNode | BlockStatement | undefined
}
```  

### 转换节点 —— traverseNode  
这个函数转换具体的节点，会依次调用所有的钩子函数，并再处理子节点  

```ts
export function traverseNode(
    node: RootNode | TemplateChildNode, // 待转换的节点
    context: TransformContext           // 作用域
) {
    // 1. 在作用域中保存当前转换的节点
    context.currentNode = node
    // 2. 获取节点钩子函数列表
    const { nodeTransforms } = context
    // 3. 退出函数列表
    const exitFns = []
    // 4. 遍历所有钩子函数
    for (let i = 0; i < nodeTransforms.length; i++) {
        // 4.1 执行钩子函数，钩子函数的返回值是退出函数
        //     如果退出函数存在，则将其保存在 exitFns 中，等到所有子节点完成转换再执行
        const onExit = nodeTransforms[i](node, context)
        if (onExit) {
            if (isArray(onExit)) {
                exitFns.push(...onExit)
            } else {
                exitFns.push(onExit)
            }
        }
        // 4.2 如果在转换过程中当前节点被移除了，则不再执行后面的钩子以及退出函数
        if (!context.currentNode) {
            return
        }
        // 4.3 如果没有删除，则会更新 node 为正在转换的节点
        //     如果在钩子函数中执行了替换节点 replaceNode，则 currentNode 就是替换后的节点
        //     接下来就会转换替换后的节点，至于替换前的旧节点，接下来还会处理，可以参考后面的示例
        else {
            node = context.currentNode
        }
    }

    // 5. 根据节点类型，执行不同操作
    switch (node.type) {
        // 5.1 注释节点，导入 createComment 模块函数
        case NodeTypes.COMMENT:
            if (!context.ssr) {
                // inject import for the Comment symbol, which is needed for creating
                // comment nodes with `createVNode`
                context.helper(CREATE_COMMENT)
            }
            break
        // 5.2 插槽节点
        //     不需要再转换，只需要导入 toDisplayString 模块，插槽内的内容都会被转换为 string
        case NodeTypes.INTERPOLATION:
            if (!context.ssr) {
                context.helper(TO_DISPLAY_STRING)
            }
            break

        // 5.3 v-if 节点
        //     遍历分支节点，对每个节点进行转换
        case NodeTypes.IF:
            for (let i = 0; i < node.branches.length; i++) {
                traverseNode(node.branches[i], context)
            }
            break
            
        // 5.4 以下节点都需要转换子节点
        //     1.if 分支节点
        //     2. v-for 节点
        //     3. 元素节点
        //     4. 根节点
        case NodeTypes.IF_BRANCH:
        case NodeTypes.FOR:
        case NodeTypes.ELEMENT:
        case NodeTypes.ROOT:
            traverseChildren(node, context)
            break
    }

    // 6. 当前节点以及所有子节点转换完成后，需要恢复 currentNode 仍然是当前节点
    context.currentNode = node
    // 7. 从后往前依次执行退出函数
    let i = exitFns.length
    while (i--) {
        exitFns[i]()
    }
}
```  

下面以 `v-if` 举例说明，有以下代码  

```html
<div v-if="a"></div>
```  

`div` 由于存在 `v-if` 指令，它的转换过程大致如下  
1. 创建 `if` 分支节点(类型是 `NodeTypes.IF_BRANCH`)，并将 `div` 放入分支 `children` 中 
2. 创建 `if` 节点(类型是 `NodeTypes.IF`)，将上一步创建好的分支放入分支列表 `branchs` 中  
3. 将当前正在转换的节点(`div`)替换为 `if` 节点  

这样，在 4.3 中，重写的 `node` 就是 `if` 节点，接下来就会继续转换 `if` 节点  
在 5.3 中会将 `if` 的所有分支进行转换，转换分支节点又会进入 5.4 转换子节点，从而完成对 `div` 的所有转换  

可以看出，`div` 实际上做了两次转换，一次是最开始的转化，一次是作为分支的子节点转换  
那如何保证作为分支的子节点转换时，不会再一次进入创建 `if` 节点的逻辑呢  
答案可以在 [创建结构指令](#创建结构指令--createstructuraldirectivetransform) 中找到(可以先透露下，其实是 `props` 中删除了 `v-if` 节点)  

这也就解释了 4.3 的目的以及替换后的节点如何继续转换  


### 转换子节点 —— traverseChildren  
从上面可以看出，只有 4 种类型的节点需要转换子节点，因为只有这 4 种节点才会拥有节点 `children`  

```ts
export type ParentNode = RootNode | ElementNode | IfBranchNode | ForNode

export function traverseChildren(
    parent: ParentNode,         // 父节点
    context: TransformContext   // 作用域
) {
    // 1. 遍历子节点的索引
    let i = 0
    // 2. 删除节点的钩子
    const nodeRemoved = () => {
        i--
    }
    // 3. 遍历子节点
    for (; i < parent.children.length; i++) {
        // 3.1 如果子节点是 string，则不需要转换
        const child = parent.children[i]
        if (isString(child)) continue
        // 3.2 更新作用域中的父节点 parent 以及子节点索引 childIndex
        context.parent = parent
        context.childIndex = i
        // 3.3 更新删除节点的钩子
        context.onNodeRemoved = nodeRemoved
        // 3.4 转换子节点
        traverseNode(child, context)
    }
}
```  

当调用作用域中的 `removeNode` 删除节点时，在具体删除之前，会先调用这里的钩子，将索引向前移动一位，即减1  
这样在转换下一个节点时，对索引加 1 后，才能正确指向删除的那个位置

## 创建结构指令 —— createStructuralDirectiveTransform   
因为接下来的需要看 `v-if` 以及 `v-for` 两个钩子的源码，而这两个钩子都会由这个函数创建，所以把这块内容放在这里  

什么是结构指令？  
结构指令就是会修改原有节点的类型  
例如 [traversenode](#转换节点--traversenode) 中提到的 `v-if`，会先创建 `if` 节点并替换原有的节点(其实 `v-for` 也是这样操作的)  

我们称这样的指令为 “结构指令”(目前就只有 `v-if` 和 `v-for` 两个)  

接下来先看这个函数都做了什么  

```ts
export function createStructuralDirectiveTransform(
    name: string | RegExp,              // 匹配需要处理的指令名，例如 v-for、/^(if|else|else-if)$/
    fn: StructuralDirectiveTransform    // 具体指令的钩子函数
): NodeTransform {
    // 1. 匹配是否满足指定名称的函数
    const matches = isString(name)
        ? (n: string) => n === name
        : (n: string) => name.test(n)

    // 2. 返回钩子函数，这里返回的钩子函数就是被放进 nodeTransforms 中的
    return (node, context) => {
        // 2.1 节点类型必须是元素
        if (node.type === NodeTypes.ELEMENT) {
            const { props } = node
            // 2.1.1 不会处理 template 上的 v-slot，这个指令会在 v-slot 的钩子中单独处理
            //       <template v-slot:fallback /> <template #falback />
            if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
                return
            }
            // 2.1.2 退出函集合
            const exitFns = []
            // 2.1.3 遍历所有 props
            for (let i = 0; i < props.length; i++) {
                const prop = props[i]
                // 2.1.3.1 只会处理满足条件的指令
                if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
                    // 如果满足条件，会将指令从 props 中删除，避免无限递归
                    props.splice(i, 1)
                    i--
                    // 执行具体的转换函数，并存储退出函数
                    const onExit = fn(node, prop, context)
                    if (onExit) exitFns.push(onExit)
                }
            }
            // 2.1.4 返回退出函数列表，在转换完所有的子节点后才会执行
            return exitFns
        }
    }
}
```  
