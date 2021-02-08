> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [什么时候会发生卸载](#什么时候会发生卸载)
- [unmount](#unmount)
    - [unmountComponent](#unmountcomponent)
- [remove](#remove)
    - [removeFragment](#removefragment)

<!-- /TOC -->

# 什么时候会发生卸载  
1. 当 [patch]() 两个节点时，如果新老节点不属于同一类型，那么就会卸载老节点，挂载新节点  
2. 当对新老 `children` 进行 `diff` 比较时，在新 `children` 中移除了某些节点，需要卸载  

# unmount  
这个函数主要用于处理卸载的公共逻辑，由于每种节点卸载的情况不一致，所以会由不同的函数来做  

```typescript
const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false
) => {
    const {
        type,
        props,
        ref,
        children,
        dynamicChildren,
        shapeFlag,
        patchFlag,
        dirs
    } = vnode
    
    // 1. 卸载 ref
    if (ref != null) {
        setRef(ref, null, parentSuspense, null)
    }

    // 2. 卸载 keep-alive 组件
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
        return
    }

    // 是否存在指令，如果存在的话会执行指令的卸载钩子
    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs

    // 3. 执行 vnode 的 before unmount 钩子函数
    let vnodeHook: VNodeHook | undefined | null
    if ((vnodeHook = props && props.onVnodeBeforeUnmount)) {
        invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    if (shapeFlag & ShapeFlags.COMPONENT) {
        // 4. 处理组件的卸载
        unmountComponent(vnode.component!, parentSuspense, doRemove)
    } else {
        // 5. 处理 Suspense 组件的卸载
        if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
            vnode.suspense!.unmount(parentSuspense, doRemove)
            return
        }

        // 6. 执行指令的 before unmount 钩子函数
        if (shouldInvokeDirs) {
            invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
        }

        if (
            dynamicChildren &&
            // #1153: fast path should not be taken for non-stable (v-for) fragments
            (type !== Fragment ||
                (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
        ) {
            // fast path for block nodes: only need to unmount dynamic children.
            unmountChildren(
                dynamicChildren,
                parentComponent,
                parentSuspense,
                false,
                true
            )
        } else if (
            (type === Fragment &&
                (patchFlag & PatchFlags.KEYED_FRAGMENT ||
                patchFlag & PatchFlags.UNKEYED_FRAGMENT)) ||
            (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN)
        ) {
            unmountChildren(children as VNode[], parentComponent, parentSuspense)
        }

        // an unmounted teleport should always remove its children if not disabled
        if (
            shapeFlag & ShapeFlags.TELEPORT &&
            (doRemove || !isTeleportDisabled(vnode.props))
        ) {
            ;(vnode.type as typeof TeleportImpl).remove(vnode, internals)
        }

        if (doRemove) {
            remove(vnode)
        }
    }

    if ((vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs) {
        queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
            invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
        }, parentSuspense)
    }
}
```  

## unmountComponent  
这个函数主要处理卸载组件的逻辑  

```typescript
const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean
) => {
    const { bum, effects, update, subTree, um } = instance
    
    // 1. 执行组件的 before unmount 钩子函数
    if (bum) {
        invokeArrayFns(bum)
    }

    // 2. 停止组件上所有的副作用
    if (effects) {
        for (let i = 0; i < effects.length; i++) {
            stop(effects[i])
        }
    }
    
    // 3. 如果组件的更新函数 update 存在，则停止 update 函数(如果是一个异步组件，则可能不存在 update 函数)
    //    接着卸载组件的子节点
    if (update) {
        stop(update)
        unmount(subTree, instance, parentSuspense, doRemove)
    }
    // 4. 卸载完了所有的子节点，将 unmount 钩子函数入队
    if (um) {
        queuePostRenderEffect(um, parentSuspense)
    }
    // 5. 入队一个新的函数，用于标识组件已经卸载完成
    queuePostRenderEffect(() => {
        instance.isUnmounted = true
    }, parentSuspense)

    // A component with async dep inside a pending suspense is unmounted before
    // its async dep resolves. This should remove the dep from the suspense, and
    // cause the suspense to resolve immediately if that was the last dep.
    if (
        __FEATURE_SUSPENSE__ &&
        parentSuspense &&
        parentSuspense.pendingBranch &&
        !parentSuspense.isUnmounted &&
        instance.asyncDep &&
        !instance.asyncResolved &&
        instance.suspenseId === parentSuspense.pendingId
    ) {
        parentSuspense.deps--
        if (parentSuspense.deps === 0) {
            parentSuspense.resolve()
        }
    }
}
```   


# remove  
这个函数用来移除真实的 DOM 节点  

```typescript
const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    // 1. 删除 Fragment 节点
    if (type === Fragment) {
        removeFragment(el!, anchor!)
        return
    }

    // 2. 删除 Static 静态节点
    if (type === Static) {
        removeStaticNode(vnode)
        return
    }

    // 具体删除节点的函数
    const performRemove = () => {
        hostRemove(el!)
        if (transition && !transition.persisted && transition.afterLeave) {
            transition.afterLeave()
        }
    }

    if (
        vnode.shapeFlag & ShapeFlags.ELEMENT &&
        transition &&
        !transition.persisted
    ) {
        const { leave, delayLeave } = transition
        const performLeave = () => leave(el!, performRemove)
        if (delayLeave) {
            delayLeave(vnode.el!, performRemove, performLeave)
        } else {
            performLeave()
        }
    } else {
        performRemove()
    }
}
```  

## removeFragment  
这个函数用来移除 `Fragment` 节点，需要将 “开始文本节点” - “结束文本节点” 之间的所有内容（ 包括自身 ）都移除  

```typescript
/**
 * @param { RendererNode } cur 指向开始文本节点的指针
 * @param { RendererNode } end 指向结束文本节点的指针
 */
const removeFragment = (cur: RendererNode, end: RendererNode) => {
    // 当 cur 和 end 指向的不是同一内容时，移除 cur 指向的节点，并将 cur 指向下一个兄弟节点
    // 直至 cur 指向最后一个节点 end
    let next
    while (cur !== end) {
        next = hostNextSibling(cur)!
        hostRemove(cur)
        cur = next
    }
    // 再删除 end 指向的节点
    hostRemove(end)
}
```