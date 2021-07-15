<!-- TOC -->

- [作用域中的静态提升内容](#作用域中的静态提升内容)
- [工具方法](#工具方法)
    - [isSingleElementRoot](#issingleelementroot)
    - [getPatchFlag](#getpatchflag)
    - [getNodeProps](#getnodeprops)
- [静态提升](#静态提升)
    - [getGeneratedPropsConstantType](#getgeneratedpropsconstanttype)
- [getConstantType](#getconstanttype)

<!-- /TOC -->

**这篇内容主要介绍静态提升节点的情况**

## 作用域中的静态提升内容  
在作用域中存在一些与静态提升相关的内容，先来依次看看  

```ts
interface TransformContext {
    /* ... */
    /**
     * 是否需要静态提升的开关
     */
    hoistStatic?: boolean

    /**
     * 存储需要静态提升节点的列表
     */
    hoists: (JSChildNode | null)[]

    /**
     * 静态提升的方法，对每个需要静态提升的节点都会调用该方法实现
     */
    hoist(exp: JSChildNode): SimpleExpressionNode 
}
```

接下来先来看看 `hoists` 方法的实现  

```ts
/**
 * @param { JSChildNode } exp 需要静态提升的节点
 * @return { SimpleExpressionNode } 变量名节点
 */
hoist(exp) {
    // 1. 将需要提升的节点存入 hoists 列表中
    context.hoists.push(exp)
    // 2. 创建指向提升节点的变量名 identifier，_hoisted_0、_hoisted_1
    const identifier = createSimpleExpression(
        `_hoisted_${context.hoists.length}`,
        false,
        exp.loc,
        ConstantTypes.CAN_HOIST
    )
    // 3. 将变量名的 hoisted 指向 exp，说明 identifier 需要提升的节点是 exp
    identifier.hoisted = exp
    // 4. 返回变量名节点
    return identifier
},
```
在生成阶段，会根据 `hoists` 列表中的节点生成提升的语句，例如

```ts
const _hoisted_0 = /*原始节点*/
```

而这个函数会将节点的生成器修改为 `identifier` 节点，这样在 生成 阶段时，实际就是上面的变量名   

## 工具方法  

### isSingleElementRoot  
这个方法用来检测根节点的第一个子节点是否是有效节点，必须要同时满足以下条件才属于 “有效”  
1. 根节点中只有一个子节点  
2. 唯一的子节点不是 `<slot />`  

```ts
export function isSingleElementRoot(
    root: RootNode,             // 根节点
    child: TemplateChildNode    // 根节点的第一个子节点
): child is PlainElementNode | ComponentNode | TemplateNode {
    const { children } = root
    return (
        children.length === 1 &&
        child.type === NodeTypes.ELEMENT &&
        !isSlotOutlet(child)
    )
}
```

### getPatchFlag  
这个方法用来获取 `vnode` 生成器上的 `PatchFlag`，并转换为 `number`  

```ts
function getPatchFlag(node: VNodeCall): number | undefined {
    const flag = node.patchFlag
    return flag ? parseInt(flag, 10) : undefined
}
```

### getNodeProps  
这个函数用来获取 `vnode` 生成器中的 `props` 集合，是一个 `PropsExpression`  

```ts
function getNodeProps(node: PlainElementNode) {
    const codegenNode = node.codegenNode!
    if (codegenNode.type === NodeTypes.VNODE_CALL) {
        return codegenNode.props
    }
}
```



## 静态提升  
静态提升发生的时机是在入口函数 [transform]() 中，会从根节点开始，依次向下查找能提升的节点，包括节点本身，`props` 节点   

是否需要提升主要是根据节点的常量类型来判断的，接下来先看看各个常量类型提升情况  

```ts
export const enum ConstantTypes {
    NOT_CONSTANT = 0,   // 不可提升
    CAN_SKIP_PATCH,     // 不可提升
    CAN_HOIST,          // 可提升
    CAN_STRINGIFY       // 可提升
}
```

接下来从静态提升的入口函数 `hoistStatic` 来开始介绍，先来看源码    

```ts
export function hoistStatic(
    root: RootNode,             // 根节点
    context: TransformContext   // 作用域
) {
    // 主要调用 walk 函数来完成，其中第三个参数表示是否禁用静态提升
    walk(
        root,
        context,
        isSingleElementRoot(root, root.children[0])
    )
}
```

为什么需要禁用提升？  
因为很多节点自身会产生 `block`，这些节点是没有办法提升的，例如 根节点，`v-if`、`v-for` 等

还有一种情况是存在多个子节点，例如根节点下存在多个子节点，这种情况会产生带有 `block` 的 `Fragment`，`Fragment` 肯定没法提升，但此时的子节点是可以提升的  
因为提升的入口就是从子节点来检测(下面的 `walk` 函数中会看到)，而不是从 生成器 上的子节点来检测  

接下来看 `walk` 的具体实现  

```ts
function walk(
    node: ParentNode,                   // 根节点
    context: TransformContext,          // 作用域
    doNotHoistNode: boolean = false     // 是否禁止提升
) {
    // 1. 是否存在需要提升节点，而不是提升的 props
    let hasHoistedNode = false
    // 2. 
    let canStringify = true
    // 3. 获取子节点列表，并遍历所有子节点
    const { children } = node
    for (let i = 0; i < children.length; i++) {
        const child = children[i]
        // 3.1 处理普通原生节点
        if (
            child.type === NodeTypes.ELEMENT &&
            child.tagType === ElementTypes.ELEMENT
        ) {
            // 3.1.1 获取节点常量类型
            const constantType = doNotHoistNode
                ? ConstantTypes.NOT_CONSTANT        // 如果禁止提升，则直接是 NOT_CONSTANT，代表不可提升
                : getConstantType(child, context)   // 否则会根据 child 类型获取

            // 3.1.2 只会处理非 NOT_CONSTANT 的类型
            if (constantType > ConstantTypes.NOT_CONSTANT) {
              	// 3.1.2.1 不带有 CAN_STRINGIFY 时，标记 canStringify 为 false
                if (constantType < ConstantTypes.CAN_STRINGIFY) {
                    canStringify = false
                }
                // 3.1.2.2 对类型是 CAN_HOIST、CAN_STRINGIFY 的节点进行提升
                if (constantType >= ConstantTypes.CAN_HOIST) {
                    // 修改升生成器的 PatchFlag 为 HOISTED
                    ;(child.codegenNode as VNodeCall).patchFlag = PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
                    // 对生成器进行提升并修改生成器
                    child.codegenNode = context.hoist(child.codegenNode!)
                    // 更新存在提升节点的开关
                    hasHoistedNode = true
                    continue
                }
            }
            // 3.1.3 处理 NOT_CONSTANT 的类型，NOT_CONSTANT 的节点不会提升，但可能 props 中还存在需要提升的节点
            //       因为是处理 props 中的节点，所以只会检测 vnode 生成器
            else {
                const codegenNode = child.codegenNode!
                if (codegenNode.type === NodeTypes.VNODE_CALL) {
                    // 3.1.3.1 获取生成器的 PatchFlag
                    const flag = getPatchFlag(codegenNode)
                    // 3.1.3.2 当满足以下情况时，说明 props 是可以静态提升的
                    //         1. 不存在 PatchFlag，或者 PatchFlag 仅仅为 TEXT 或 NEED_PATCH
                    //         2. props 集合中常量类型最低的是 CAN_HOIST 或 CAN_STRINGIFY
                    if (
                        (!flag ||
                        flag === PatchFlags.NEED_PATCH || // <div v-foo id="root"></div>
                        flag === PatchFlags.TEXT) &&      // <div id="root">{{name}}</div>
                        getGeneratedPropsConstantType(child, context) >= ConstantTypes.CAN_HOIST
                    ) {
                        // 获取 props 集合，并对生成器中的 props 节点缓存
                        const props = getNodeProps(child)
                        if (props) {
                            codegenNode.props = context.hoist(props)
                        }
                    }
                }
            }
        }
        // 3.2 处理创建文本节点
        else if (child.type === NodeTypes.TEXT_CALL) {
            // 3.2.1 获取文本的常量类型
            const contentType = getConstantType(child.content, context)
            // 3.2.2 只会处理非 NOT_CONSTANT 的类型
            if (contentType > 0) {
                // 3.2.2.1 不带有 CAN_STRINGIFY 时，标记 canStringify 为 false
                if (contentType < ConstantTypes.CAN_STRINGIFY) {
                    canStringify = false
                }
                // 3.2.2.2 当类型是 CAN_HOIST、CAN_STRINGIFY 时，则对生成器进行提升，并标记存在提升的节点 hasHoistedNode
                if (contentType >= ConstantTypes.CAN_HOIST) {
                    child.codegenNode = context.hoist(child.codegenNode)
                    hasHoistedNode = true
                }
            }
        }

        // 3.3 接下来会递归向下检查子节点中可以提升的节点
        //     a. 对于普通节点直接调用 walk 检查子节点
        //     b. 对于存在 v-for 的节点，也会调用 walk 来检测子节点的提升状态
        //          如果只存在一个子节点，<div v-for="i in items" />，由于 div 会产生一个 block，所以要禁用提升
        //          如果存在多个子节点，<template v-for="i in items"><i/><b/></template>，由于多个节点会在外面包裹一层 Fragment
        //            而在第 3 步遍历的时候只会遍历到 i 和 b，它们作为 Fragment 的子元素是可以被提升的，此时就不需要禁止提升了
        //     c. 对于存在 v-if 的节点
        //          会对所有分支调用 walk 来检测子节点的提升状态，对于分支存在一个子节点还是多个子节点，原理和 v-for 一致
        if (child.type === NodeTypes.ELEMENT) {
            walk(child, context)
        } else if (child.type === NodeTypes.FOR) {
            walk(child, context, child.children.length === 1)
        } else if (child.type === NodeTypes.IF) {
            for (let i = 0; i < child.branches.length; i++) {
                walk(
                    child.branches[i],
                    context,
                    child.branches[i].children.length === 1
                )
            }
        }
    }
}
```

### getGeneratedPropsConstantType  
这个函数会获取 `vnode` 生成器的 `props` 集合中，优先级最低的常量类型，会检测所有属性名和属性值  

```ts
function getGeneratedPropsConstantType(
  node: PlainElementNode,
  context: TransformContext
): ConstantTypes {
    // 1. 定义返回结果的常量类型，默认是最高的 CAN_STRINGIFY
    let returnType = ConstantTypes.CAN_STRINGIFY
    // 2. 获取生成器的 props 集合，是一个 props 表达式
    const props = getNodeProps(node)
    // 3. 只会处理 props 是对象的情况
    //    对于 props 合并的情况以及 props 是表达式的情况不会处理，具体可以参考 buildProps
    //    <div v-bind="datas" class="app" />、<div v-bind="datas" />、<div v-on="handlers" />
    if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
        const { properties } = props
        // 3.1 遍历所有 props
        for (let i = 0; i < properties.length; i++) {
            // 3.1.1 获取每个 prop 的属性和值
            const { key, value } = properties[i]
            // 3.1.2 获取属性的常量类型，如果不是常量，则直接返回 NOT_CONSTANT，表示 props 不允许提升
            const keyType = getConstantType(key, context)
            if (keyType === ConstantTypes.NOT_CONSTANT) {
                return keyType
            }
            // 3.1.3 获取优先级更低的类型
            if (keyType < returnType) {
                returnType = keyType
            }
            // 3.1.4 如果 prop 的值不是 简单表达式，则直接返回 NOT_CONSTANT，表示 props 不允许提升
            //       例如存在缓存的事件函数，<div @click="handleClick" /> 
            if (value.type !== NodeTypes.SIMPLE_EXPRESSION) {
                return ConstantTypes.NOT_CONSTANT
            }
            // 3.1.5 获取属性值的常量类型，如果不是常量，则直接返回 NOT_CONSTANT，表示 props 不允许提升
            const valueType = getConstantType(value, context)
            if (valueType === ConstantTypes.NOT_CONSTANT) {
                return valueType
            }
            // 3.1.5 获取优先级更低的类型
            if (valueType < returnType) {
                returnType = valueType
            }
        }
    }
    // 4. 返回结果
    return returnType
}
```

## getConstantType  

这个函数用来获取各个类型节点的常量类型，其中作用域中存在 `constantCache`，它用来缓存元素节点的常量类型

```ts
interface TransformContext {
    /* ... */
  	/**
  	 * 常量缓存
  	 */
    constantCache: Map<TemplateChildNode, ConstantTypes>
}

export function getConstantType(
    node: TemplateChildNode | SimpleExpressionNode, // 待获取节点
    context: TransformContext                       // 作用域
): ConstantTypes {
    // 1. 获取常量缓存对象
    const { constantCache } = context
    // 根绝节点类型不同，检测方式不同
    switch (node.type) {
        // 2. 处理元素
        case NodeTypes.ELEMENT:
            // 2.1 除了普通元素外，剩余的组件、template、slot 都不是常量
            if (node.tagType !== ElementTypes.ELEMENT) {
                return ConstantTypes.NOT_CONSTANT
            }
            // 2.2 如果有缓存则读取缓存
            const cached = constantCache.get(node)
            if (cached !== undefined) {
                return cached
            }
            // 2.3 如果生成器不是 VNODE_CALL，则不是常量
            //     例如可能是 renderSlot
            const codegenNode = node.codegenNode!
            if (codegenNode.type !== NodeTypes.VNODE_CALL) {
                return ConstantTypes.NOT_CONSTANT
            }
            // 2.4 获取生成器的 PatchFlag
            const flag = getPatchFlag(codegenNode)
            // 2.5 处理不存在 PatchFlag 的情况，即使不存在 PatchFlag，但还是会进行以下检查
            if (!flag) {
                // 2.5.1 定义返回的类型，初始为最高级别的 CAN_STRINGIFY
                let returnType = ConstantTypes.CAN_STRINGIFY
                // 2.5.2 先会检查 props 中是否存在 NOT_CONSTANT 的值，如果存在则直接返回，说明当前节点不是常量
                //       例如存在缓存的事件函数 <div @click="handleClick" />
                const generatedPropsType = getGeneratedPropsConstantType(node, context)
                if (generatedPropsType === ConstantTypes.NOT_CONSTANT) {
                    constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                    return ConstantTypes.NOT_CONSTANT
                }

                // 2.5.3 更新最低优先级的类型
                if (generatedPropsType < returnType) {
                    returnType = generatedPropsType
                }

                // 2.5.4 检查所有子节点中是否存在 NOT_CONSTANT，并更新最低优先级的类型
                //       如果子节点中出现不是常量的节点，那么说明这个父节点也不是常量，<div><Comp /></div>
                for (let i = 0; i < node.children.length; i++) {
                    const childType = getConstantType(node.children[i], context)
                    if (childType === ConstantTypes.NOT_CONSTANT) {
                        constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                        return ConstantTypes.NOT_CONSTANT
                    }
                    if (childType < returnType) {
                        returnType = childType
                    }
                }

                // 2.5.5. if the type is not already CAN_SKIP_PATCH which is the lowest non-0
                // type, check if any of the props can cause the type to be lowered
                // we can skip can_patch because it's guaranteed by the absence of a
                // patchFlag.
                if (returnType > ConstantTypes.CAN_SKIP_PATCH) {
                    for (let i = 0; i < node.props.length; i++) {
                        const p = node.props[i]
                        if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.exp) {
                            const expType = getConstantType(p.exp, context)
                            if (expType === ConstantTypes.NOT_CONSTANT) {
                                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                                return ConstantTypes.NOT_CONSTANT
                            }
                            if (expType < returnType) {
                                returnType = expType
                            }
                        }
                    }
                }

                // 2.5.6 only svg/foreignObject could be block here, however if they are
                // static then they don't need to be blocks since there will be no
                // nested updates.
                if (codegenNode.isBlock) {
                    codegenNode.isBlock = false
                    context.helper(CREATE_VNODE)
                }

                // 2.5.7 能执行到这里说明节点不是 NOT_CONSTANT，此时节点的类型就是 returnType 所指的类型，记录并返回
                constantCache.set(node, returnType)
                return returnType
            }
            // 2.6 存在 PatchFLag，则不是常量，记录并返回 NOT_CONSTANT
            else {
                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                return ConstantTypes.NOT_CONSTANT
            }
        // 3. 处理文本、注释，它们的常量类型都属于 CAN_STRINGIFY
        case NodeTypes.TEXT:
        case NodeTypes.COMMENT:
            return ConstantTypes.CAN_STRINGIFY
        // 4. 处理 if、for 以及 if 分支节点，它们都不属于常量
        case NodeTypes.IF:
        case NodeTypes.FOR:
        case NodeTypes.IF_BRANCH:
            return ConstantTypes.NOT_CONSTANT
        // 5. 处理插值和创建文本节点，通过检测它们内容的常量类型
        case NodeTypes.INTERPOLATION:
        case NodeTypes.TEXT_CALL:
            return getConstantType(node.content, context)
        // 7. 简单表达式，直接返回自身的常量类型
        case NodeTypes.SIMPLE_EXPRESSION:
            return node.constType
        // 8. 复合表达式，返回列表中优先级最低的常量类型
        case NodeTypes.COMPOUND_EXPRESSION:
            let returnType = ConstantTypes.CAN_STRINGIFY
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i]
                    if (isString(child) || isSymbol(child)) {
                    continue
                }
                const childType = getConstantType(child, context)
                if (childType === ConstantTypes.NOT_CONSTANT) {
                    return ConstantTypes.NOT_CONSTANT
                } else if (childType < returnType) {
                    returnType = childType
                }
            }
            return returnType
        // 9. 剩余情况都是非常量
        default:
            return ConstantTypes.NOT_CONSTANT
    }
}
```
