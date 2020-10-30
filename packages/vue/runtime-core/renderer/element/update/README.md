> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [其他模块的函数](#其他模块的函数)
- [优化模式](#优化模式)
- [patchElement](#patchelement)
- [patchProps](#patchprops)

<!-- /TOC -->

# 其他模块的函数

# 优化模式  
1. 当前处理的是动态 `vnode`（ 即 `vnode.dynamicChildren` 里 ），在 [patchblockchildren](#patchblockchildren) 中会 `patch` 将新老 `vnode`，注意最后一个参数为 `true`，使用优化模式  

# patchElement  
这个函数用来更新一个节点，并且会在更新前后触发各种钩子函数，此时老 `vnode` 和 新 `vnode` 属于同一类型，所以可以复用对应的真实节点，总共有两步  
1. 处理 `props` 的变化：会根据是否有 `patchFlag` 来决定是局部更新还是全局更新  
2. 处理 `children` 的变化  

```typescript
const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    // 此时新老 vnode 属于相同的节点，所以新 vnode 可以复用老 vnode 的真实 DOM 节点
    const el = (n2.el = n1.el!)
    
    let { patchFlag, dynamicChildren, dirs } = n2
    
    // #1426 take the old vnode's patch flag into account since user may clone a
    // compiler-generated vnode, which de-opts to FULL_PROPS
    // TODO:
    patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS

    // 获取老的 props 和新的 props
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    
    // 保存 vnode 的生命周期钩子
    let vnodeHook: VNodeHook | undefined | null

    // 同步执行 vnode 的 beforeUpdate 钩子
    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
        invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }

    // 同步执行指令的 beforeUpdate 钩子
    if (dirs) {
        invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }

    // 第一步：处理 props，检测 vnode 上是否有动态的 props
    if (patchFlag > 0) {
        // 存在 props 中存在动态 key，则需要对所有的 props 进行处理，因为无法知道这个 key 会如何改变
        if (patchFlag & PatchFlags.FULL_PROPS) {
            patchProps(
                el,
                n2,
                oldProps,
                newProps,
                parentComponent,
                parentSuspense,
                isSVG
            )
        }
        // 否则依次对 class、style 以及会变化的 props 处理
        else {
            // 若存在动态的 class，则对 class 进行设置
            if (patchFlag & PatchFlags.CLASS) {
                if (oldProps.class !== newProps.class) {
                    hostPatchProp(el, 'class', null, newProps.class, isSVG)
                }
            }

            // 若存在动态的 style，则对 style 进行设置
            if (patchFlag & PatchFlags.STYLE) {
                hostPatchProp(el, 'style', oldProps.style, newProps.style, isSVG)
            }

            // 若具有除 class 和 style 之外的动态属性，这些属性都会被存储在 vnode 的动态属性 dynamicProps 上
            // 此时遍历 dynamicProps，如果旧值和新值不相同，则会对其进行设置
            // 如果新值和旧值相同，但是存在强制更新的函数 hostForcePatchProp，则也会更新
            if (patchFlag & PatchFlags.PROPS) {
                const propsToUpdate = n2.dynamicProps!
                for (let i = 0; i < propsToUpdate.length; i++) {
                    const key = propsToUpdate[i]
                    const prev = oldProps[key]
                    const next = newProps[key]
                    if (
                        next !== prev ||
                        (hostForcePatchProp && hostForcePatchProp(el, key))
                    ) {
                        hostPatchProp(
                            el,
                            key,
                            prev,
                            next,
                            isSVG,
                            n1.children as VNode[],
                            parentComponent,
                            parentSuspense,
                            unmountChildren
                        )
                    }
                }
            }
        }

        // 检测是否存在动态文本，且新旧两次文本不一致会进行更新
        if (patchFlag & PatchFlags.TEXT) {
            if (n1.children !== n2.children) {
                hostSetElementText(el, n2.children as string)
            }
        }
    } else if (!optimized && dynamicChildren == null) { // TODO: 为什么非优化以及没有动态子节点不需要处理 props
        // 不存在动态 key，也没有优化策略，也不存在动态子节点
        // 此时需要处理全部的 props
        patchProps(
            el,
            n2,
            oldProps,
            newProps,
            parentComponent,
            parentSuspense,
            isSVG
        )
    }

    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'

    // 第二步：处理 children
    if (dynamicChildren) {
        // 存在动态 children，则只处理动态 children
        patchBlockChildren(
            n1.dynamicChildren!,
            dynamicChildren,
            el,
            parentComponent,
            parentSuspense,
            areChildrenSVG
        )
    } else if (!optimized) {
        // 不存在动态 children，也没有优化策略，则对全部 children 进行处理
        patchChildren(
            n1,
            n2,
            el,
            null,   // TODO: 这里的兄弟节点为什么传 null
            parentComponent,
            parentSuspense,
            areChildrenSVG
        )
    }

    // 处理 vnode 的 updated 钩子，或者指令的 updated 钩子
    // 因为这两个钩子需要异步执行，所以需要将它们放入异步队列中，等待下一轮微任务执行
    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
        queuePostRenderEffect(() => {
            vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
            dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
        }, parentSuspense)
    }
}
```  

**可以看到，在比较一个节点的时候，如果当前处于优化模式，也没有动态子 `children` 时，是不会去处理子 `children` 的，处理完自身也就结束了**  
**也就是说，从使用优化模式的 `vnode` 开始，只会处理动态的子 `children`，而不是全部，依次往下，一直到所有的动态子 `children` 都处理完**   

# patchProps  
这个函数用来全量处理新老 `props` 的差异，并更新  

```typescript
const patchProps = (
    el: RendererElement,
    vnode: VNode,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
) => {
    if (oldProps !== newProps) {
        // 遍历新的 props，过滤掉内置 props 后，如果新 prop 和旧 prop 的值不一致，就会对其进行更新
        // 或者新值和旧值相同，但是存在强制更新 hostForcePatchProp，那么也会更新 prop 的值
        for (const key in newProps) {
            if (isReservedProp(key)) continue
            const next = newProps[key]
            const prev = oldProps[key]
            if (
                next !== prev ||
                (hostForcePatchProp && hostForcePatchProp(el, key))
            ) {
                hostPatchProp(
                    el,
                    key,
                    prev,
                    next,
                    isSVG,
                    vnode.children as VNode[],
                    parentComponent,
                    parentSuspense,
                    unmountChildren
                )
            }
        }
        
        if (oldProps !== EMPTY_OBJ) {
            // 遍历老 props，如果 prop 只存在于老 props，不存在于新 props 中，那么需要将这个 prop 设置为 null
            for (const key in oldProps) {
                if (!isReservedProp(key) && !(key in newProps)) {
                    hostPatchProp(
                        el,
                        key,
                        oldProps[key],
                        null,           // 新的值为 null，表示要删除
                        isSVG,
                        vnode.children as VNode[],
                        parentComponent,
                        parentSuspense,
                        unmountChildren
                    )
                }
            }
        }
    }
}
```