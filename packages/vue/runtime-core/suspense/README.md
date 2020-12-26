> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [Suspense 基本使用](#suspense-基本使用)
- [Suspense 生成步骤](#suspense-生成步骤)
    - [vnode 的生成](#vnode-的生成)
    - [patch Suspense](#patch-suspense)
    - [挂载 Suspense](#挂载-suspense)
    - [创建 Suspense 作用域](#创建-suspense-作用域)
        - [注册异步操作 registerDep](#注册异步操作-registerdep)
        - [完成异步操作 resolve](#完成异步操作-resolve)
    - [patch content 节点](#patch-content-节点)

<!-- /TOC -->

# Suspense 基本使用  
`Suspense` 组件主要用于异步处理，例如当向服务端发送请求的过程中，需要展示 `loading`，就可以用 `Suspense` 组件  
`Suspense` 组件接受两个插槽  
 * `default` 插槽: 可以是异步组件，或者存在 `async setup` 函数的组件，异步过程结束后会展示  
 * `fallback` 插槽: 异步过程结束前会展示  

```typescript
const Comp = defineComponent(() => new Promise(( resolve ) => {
    setTimeout(() => {
        resolve(() => h('div', 'complete'));
    }, 1000);
}));

const App = defineComponent(() => {
    return () => h(
        Suspense,
        null,
        {
            default: h(Comp),
            fallback: h('div', 'loading')
        }
    )
});

const root = nodeOps.createElement('div')
render(h(App), root);

expect(root.innerHTML).toBe(`<div>loading</div>`)

await timeout(1000);
expect(root.innerHTML).toBe(`<div>complete</div>`)
```  

# Suspense 生成步骤

## vnode 的生成  
在调用 `App` 组件的 `render` 函数时生成的 `vnode`，会对 `default` 和 `fallback` 两个插槽进行处理，然后挂载在 `vnode` 上  

```typescript
if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
    const { content, fallback } = normalizeSuspenseChildren(vnode)
    vnode.ssContent = content
    vnode.ssFallback = fallback
}
```  

最终，`ssContent` 就是异步组件的 `vnode`，而 `ssFallback` 就是异步结束之前的 `vnode`   

## patch Suspense  
接着会对 `Suspense` 进行 `patch` 操作，会由 `Suspense` 具体的 `process` 完成  

```typescript
process(
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean,
    // platform-specific impl passed from renderer
    rendererInternals: RendererInternals
) {
    if (n1 == null) {
        // 挂载 Suspense
        mountSuspense(
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            rendererInternals
        )
    } else {
        // 更新 Suspense
        patchSuspense(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            isSVG,
            optimized,
            rendererInternals
        )
    }
}
```  

## 挂载 Suspense  

```typescript
function mountSuspense(
    vnode: VNode,                                       // Suspense vnode
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean,
    rendererInternals: RendererInternals
) {
    const {
        p: patch,
        o: { createElement }
    } = rendererInternals

    // 创建一个空的 div，这个 div 并不会插入到实际的 DOM 树中
    const hiddenContainer = createElement('div')
    // 创建 Suspense 作用域
    const suspense = (vnode.suspense = createSuspenseBoundary(
        vnode,
        parentSuspense,
        parentComponent,
        container,
        hiddenContainer,
        anchor,
        isSVG,
        optimized,
        rendererInternals
    ))

    // ① 将 content 挂载在 pendingBranch 上，表示这是异步操作结束后需要展示的组件
    // 将 content 挂载在隐藏容器上
    // 如果 ssContent 是一个 async setup 组件，那么会将 subtree 设置为注释节点，并挂载到 hiddenContainer 中
    patch(
        null,
        (suspense.pendingBranch = vnode.ssContent!),
        hiddenContainer,
        null,
        parentComponent,
        suspense,   // content 会处于 suspense 作用域内
        isSVG,
        opt
    )
    
    // 检测是否存在异步操作
    if (suspense.deps > 0) {
        // 存在异步操作，则会将 fallback 挂载到真实容器中
        patch(
            null,
            vnode.ssFallback!,
            container,
            anchor,
            parentComponent,
            null, // fallback tree will not have suspense context
            isSVG,
            optimized
        )
        // 设置 suspense 渲染的是 fallback 节点
        setActiveBranch(suspense, vnode.ssFallback!)
    } else {
        // 不存在异步操作
        suspense.resolve()
    }
}
```  

在 ① 处对 `content` 进行 `patch` 操作时，会传入当前 `suspense` 作为父作用域，也就是说，`content` 始终会处于 `suspense` 作用域之内，如果 `content` 是一个异步组件，那么会将 `suspense.deps` 增加，在结束 `patch` 操作后，会检测是否存在异步操作，从而进行不同的渲染  

## 创建 Suspense 作用域  
每个 `Suspense` 组件都会对应一个作用域对象  

```typescript
/**
 * @param { VNode } Suspense 对应的 vnode
 */
function createSuspenseBoundary(
    vnode: VNode,
    parent: SuspenseBoundary | null,
    parentComponent: ComponentInternalInstance | null,
    container: RendererElement,
    hiddenContainer: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean,
    optimized: boolean,
    rendererInternals: RendererInternals,
    isHydrating = false
): SuspenseBoundary {
    const {
        p: patch,
        m: move,
        um: unmount,
        n: next,
        o: { parentNode, remove }
    } = rendererInternals

    const timeout = toNumber(vnode.props && vnode.props.timeout)
    
    const suspense: SuspenseBoundary = {
        vnode,            // Suspense 组件对应的 vnode
        parent,           
        parentComponent,  // Suspense 所在父组件的实例
        isSVG,
        optimized,
        container,        // 实际容器
        hiddenContainer,  // 隐藏容器
        anchor,
        deps: 0,          // Suspense 组件里异步操作的个数
        pendingId: 0,
        timeout: typeof timeout === 'number' ? timeout : -1,
        activeBranch: null,   // 当前需要渲染的 vnode，如果异步过程没有结束，就是 ssFallback，如果异步过程结束，就是 ssContent
        pendingBranch: null,  // 异步过程结束之后的渲染的 vnode
        isInFallback: true,
        isHydrating,
        isUnmounted: false,
        effects: [],

        resolve(resume = false) { /* ... */ },

        fallback(fallbackVNode) { /* ... */ },

        move(container, anchor, type) { /* ... */ },

        next() { /* ... */ },

        registerDep(instance, setupRenderEffect) { /* ... */ },

        unmount(parentSuspense, doRemove) { /* ... */ }
    }

    return suspense
}
```  
当一个组件作为 `Suspense` 的 `default` 插槽时，那么在 `patch` 组件时，始终会处于这个 `suspense` 作用域内，即 `parentSuspent` 始终是指向这个作用域对象  

### 注册异步操作 registerDep   
当一个组件的 `setup` 返回一个 `Promise` 时，此时就会调用这个函数将渲染组件的函数与所在的 `suspense` 关联起来  

```typescript
registerDep(instance, setupRenderEffect) {
    if (!suspense.pendingBranch) {
        return
    }

    // 获取真实节点，在服务端下会存在，客户端下不存在
    const hydratedEl = instance.vnode.el
    // 异步操作 +1
    suspense.deps++
    
    // 异步任务增加 then 和 catch 回调
    instance
    .asyncDep!.catch(err => {
        handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
    })
    .then(asyncSetupResult => {
        // 异步任务结束
        // asyncSetupResult 可以看做是 setup 的返回值，所以应该是一个函数
        if (
            instance.isUnmounted ||
            suspense.isUnmounted ||
            suspense.pendingId !== instance.suspenseId
        ) {
            return
        }

        // 异步操作 -1
        suspense.deps--
        // retry from this component
        instance.asyncResolved = true
        
        const { vnode } = instance
        // 处理 asyncSetupResult 为渲染函数
        handleSetupResult(instance, asyncSetupResult, false)
        
        if (hydratedEl) {
            // vnode may have been replaced if an update happened before the
            // async dep is resolved.
            vnode.el = hydratedEl
        }
        
        // 获取占位节点
        // 在客户端下，在 mountComponent 中，如果组件是异步的话，那么会将注释节点作为其子节点
        // 服务端下不存在
        const placeholder = !hydratedEl && instance.subTree.el
        
        // 为组件增加更新函数并执行
        setupRenderEffect(
            instance,
            vnode,
            // component may have been moved before resolve.
            // if this is not a hydration, instance.subTree will be the comment
            // placeholder.
            parentNode(hydratedEl || instance.subTree.el!)!,
            // anchor will not be used if this is hydration, so only need to
            // consider the comment placeholder case.
            hydratedEl ? null : next(instance.subTree),
            suspense,
            isSVG,
            optimized
        )
        
        // 移除占位节点
        if (placeholder) {
            remove(placeholder)
        }
        
        updateHOCHostEl(instance, vnode.el)
        
        // 检测所有的异步操作是否都完成，完成后执行 resolve
        if (suspense.deps === 0) {
            suspense.resolve()
        }
    })
}
```  

### 完成异步操作 resolve  

```typescript
resolve(resume = false) {
    const {
        vnode,
        activeBranch,
        pendingBranch,
        pendingId,
        effects,
        parentComponent,
        container
    } = suspense

    if (suspense.isHydrating) {
        suspense.isHydrating = false
    } else if (!resume) {
        const delayEnter =
            activeBranch &&
            pendingBranch!.transition &&
            pendingBranch!.transition.mode === 'out-in'
            
        if (delayEnter) {
            activeBranch!.transition!.afterLeave = () => {
                if (pendingId === suspense.pendingId) {
                    move(pendingBranch!, container, anchor, MoveType.ENTER)
                }
            }
        }
        // this is initial anchor on mount
        let { anchor } = suspense
        // unmount current active tree
        if (activeBranch) {
            // if the fallback tree was mounted, it may have been moved
            // as part of a parent suspense. get the latest anchor for insertion
            anchor = next(activeBranch)
            unmount(activeBranch, parentComponent, suspense, true)
        }
        if (!delayEnter) {
            // move content from off-dom container to actual container
            move(pendingBranch!, container, anchor, MoveType.ENTER)
        }
    }

    setActiveBranch(suspense, pendingBranch!)
    suspense.pendingBranch = null
    suspense.isInFallback = false

    // flush buffered effects
    // check if there is a pending parent suspense
    let parent = suspense.parent
    let hasUnresolvedAncestor = false
    while (parent) {
        if (parent.pendingBranch) {
            // found a pending parent suspense, merge buffered post jobs
            // into that parent
            parent.effects.push(...effects)
            hasUnresolvedAncestor = true
            break
        }
        parent = parent.parent
    }
    // no pending parent suspense, flush all jobs
    if (!hasUnresolvedAncestor) {
        queuePostFlushCb(effects)
    }
    suspense.effects = []

    // invoke @resolve event
    const onResolve = vnode.props && vnode.props.onResolve
    if (isFunction(onResolve)) {
        onResolve()
    }
}
```  


## patch content 节点  
如果 `content` 是一个组件，且 `setup` 是一个异步操作，在 [处理 `setup` 返回值结果时](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#setupStatefulComponent)，会将返回的 `Promise` 挂载在组件的 `asyncDep` 上，然后又会 [处理异步组件](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#mountComponent)(*这里的 `parentSuspense` 实际就是上一步生成的作用域对象*)，调用 [注册异步操作](#registerDep) 函数，将 `content` 组件的渲染函数放入异步操作的成功队列中(`then 的调`)，这样当异步任务结束后，就会执行 `content` 的渲染函数将其渲染  

```typescript
// 处理 Suspense 异步组件
if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
    // 将渲染函数注册到 parentSuspense 作用域对象中
    parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect)

    // 客户端下 initialVNode.el 是不存在的
    if (!initialVNode.el) {
        // 认为组件的子节点仅仅是一个注释节点，并将其挂载到 container 中
        const placeholder = (instance.subTree = createVNode(Comment))
        processCommentNode(null, placeholder, container!, anchor)
    }
    return
}
```  

**注意，这一步是发生在 [mountSuspense](#mountSuspense) 中对 `content` 进行 `patch` 的过程中，而传入的容器节点是 `hiddenContainer` 而不是真实的容器节点，所以这里将注释节点是插入插入到隐藏容器中的**  


