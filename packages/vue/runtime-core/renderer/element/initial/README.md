> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [其他模块的函数](#其他模块的函数)
- [优化模式](#优化模式)
- [anchor](#anchor)
- [processElement](#processelement)
- [mountElement](#mountelement)
- [mountChildren](#mountchildren)

<!-- /TOC -->

# 其他模块的函数  
1. [invokeDirectiveHook](#invokeDirectiveHook)  
1. [invokeVNodeHook](#invokeVNodeHook)  
1. [isReservedProp](#isReservedProp)  
1. [setScopeId](#setScopeId)  
1. [queuePostRenderEffect](#queuePostRenderEffect)  

# 优化模式  
1. 在创建元素节点时，如果存在子 `children`，且存在动态子 `children`，则使用优化模式  

# anchor  
1. 在挂载子 `children` 的时候，会将 `anchor` 传递为 `null`，保证挂载的顺序和 `children` 是一致的  

# processElement  
这个函数是元素节点的入口函数，用来处理元素的挂载或更新，只会被调用在 [patch](#https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/create/README.md) 函数内  

```typescript
const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    isSVG = isSVG || (n2.type as string) === 'svg'

    if (n1 == null) {
        // 不存在老节点，说明是第一次渲染，进行挂载
        mountElement(
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    } else {
        // 非第一次渲染，且新旧节点属于相同节点，处理新老节点
        patchElement(n1, n2, parentComponent, parentSuspense, isSVG, optimized)
    }
}
```  

# mountElement  
这个函数用来挂载一个新元素节点，并追加到容器节点中，并且会处理一些钩子函数（ 包括 `vnode`、指令 ）  

```typescript
const mountElement = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    let el: RendererElement                     // 保存 vnode 对应的真实 DOM 节点
    let vnodeHook: VNodeHook | undefined | null // 保存 vnode 上的 hooks
    const {
        type,
        props,
        shapeFlag,
        transition,
        scopeId,
        patchFlag,
        dirs
    } = vnode

    if (
        !__DEV__ &&
        vnode.el &&
        hostCloneNode !== undefined &&
        patchFlag === PatchFlags.HOISTED
    ) {
        // If a vnode has non-null el, it means it's being reused.
        // Only static vnodes can be reused, so its mounted DOM nodes should be
        // exactly the same, and we can simply do a clone here.
        // only do this in production since cloned trees cannot be HMR updated.
        el = vnode.el = hostCloneNode(vnode.el)
    } else {
        // 创建真实 DOM 节点并挂载到 vnode 的 el 上
        el = vnode.el = hostCreateElement(
            vnode.type as string,
            isSVG,
            props && props.is
        )

        // 处理子节点
        if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
            // 子节点为文本节点，例如 <span>hello</span>
            // 设置 DOM 节点的子节点
            hostSetElementText(el, vnode.children as string)
        } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
            // 子节点为数组，例如 <div><span>hello</span></div>
            // 挂载所有的子节点到新创建的 el DOM 节点上
            mountChildren(
                vnode.children as VNodeArrayChildren,   // 所有的子 children
                el,                                     // 容器节点为新创建的节点，会将所有的子 children 挂载到 el 上
                null,                                   // 兄弟节点为 null，挂载的时候按照 children 顺序增加
                parentComponent,
                parentSuspense,
                isSVG && type !== 'foreignObject',
                optimized || !!vnode.dynamicChildren    // 如果存在需要追踪的动态子节点，则使用优化策略
            )
        }

        // 同步执行指令的 created 钩子
        if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, 'created')
        }
        
        // 处理 props
        if (props) {
            // 遍历所有的 props 并排除内置 prop，将 prop 设置到真实节点 el 上
            for (const key in props) {
                if (!isReservedProp(key)) {
                    hostPatchProp(
                        el,
                        key,
                        null,
                        props[key],
                        isSVG,
                        vnode.children as VNode[],
                        parentComponent,
                        parentSuspense,
                        unmountChildren
                    )
                }
            }

            // 同步执行 vnode 的 beforeMount 钩子
            if ((vnodeHook = props.onVnodeBeforeMount)) {
                invokeVNodeHook(vnodeHook, parentComponent, vnode)
            }
        }
        
        // scopeId
        setScopeId(el, scopeId, vnode, parentComponent)
    }

    // 同步执行指令的 beforeMount 钩子
    if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
    }

    // #1583 For inside suspense + suspense not resolved case, enter hook should call when suspense resolved
    // #1689 For inside suspense + suspense resolved case, just call it
    const needCallTransitionHooks =
        (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
        transition &&
        !transition.persisted
    if (needCallTransitionHooks) {
        transition!.beforeEnter(el)
    }

    // 已经处理完当前节点下的所有子节点和属性设置，所以可以将 el 插入到父节点 container 中，并插入在兄弟节点 anchor 之前
    hostInsert(el, container, anchor)

    // 处理 vnode 的 mounted 钩子、指令的 mounted 钩子
    // 因为这些 钩子 都需要异步执行，所以会将它们放入异步队列中，等待下一轮微任务
    if (
        (vnodeHook = props && props.onVnodeMounted) ||
        needCallTransitionHooks ||
        dirs
    ) {
        queuePostRenderEffect(() => {
            vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
            needCallTransitionHooks && transition!.enter(el)
            dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
    }
}
```  

# mountChildren  
挂载 `vnode` 的子 `children`，到指定的容器节点 `container`，会从指定位置索引开始挂载  

```typescript
const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    start = 0
) => {
    // 遍历所有的 children，对每一个 vnode 进行 patch 操作
    for ( let i = start; i < children.length; i++ ) {
        const child = (children[i] = optimized
            ? cloneIfMounted(children[i] as VNode)
            : normalizeVNode(children[i]))
        patch(
            null,             // 挂载，所以为 null
            child,
            container,        // 父节点
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
        )
    }
}
```