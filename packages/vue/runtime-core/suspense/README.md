> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [Suspense 组件](#suspense-组件)
    - [Suspense 作用域](#suspense-作用域)
- [Suspense 生成步骤](#suspense-生成步骤)
    - [vnode 的生成](#vnode-的生成)
    - [patch Suspense](#patch-suspense)
    - [挂载 Suspense](#挂载-suspense)
        - [收集副作用](#收集副作用)
        - [创建 Suspense 作用域](#创建-suspense-作用域)
            - [移动 Suspense 组件](#移动-suspense-组件)
            - [获取 Suspense 组件的下一个兄弟节点](#获取-suspense-组件的下一个兄弟节点)
            - [卸载 Suspense 组件](#卸载-suspense-组件)
            - [注册异步操作 registerDep](#注册异步操作-registerdep)
            - [完成异步操作 resolve](#完成异步操作-resolve)
    - [设置 Suspense 组件当前展示的 vnode](#设置-suspense-组件当前展示的-vnode)
    - [更新 Suspense](#更新-suspense)

<!-- /TOC -->

# Suspense 组件  
`Suspense` 属于内置组件，它本身就是一个普通对象，所以在创建 `vnode` 时就是将这个对象作为 `createVnode` 的第一个参数   

```typescript
export const Suspense = ((__FEATURE_SUSPENSE__
    ? SuspenseImpl
    : null) as any) as {
    __isSuspense: true
    new (): { $props: VNodeProps & SuspenseProps }
}
```  

```typescript
export const SuspenseImpl = {
    __isSuspense: true,
    process () { /* ... */ },
    hydrate: hydrateSuspense,
    create: createSuspenseBoundary
}
```  

`Suspense` 组件接受两个插槽  
 * `default`: 包含异步过程的组件，异步过程结束后会展示  
 * `fallback`: 异步过程结束前会展示  

## Suspense 作用域  
每个 `Suspense` 组件都会生成一个作用域对象  
 * 当对 `default` 插槽的组件进行 `patch` 操作时，会始终处于 *suspense* 作用域内，即 [patch](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/create/README.md#patch) 的第六个参数 `parentSuspense`  
 * 当对 `fallabck` 插槽的组件进行 `patch` 操作时，是不处于 *suspense* 作用内的，后面会看到  

先来看 *suspense* 作用域的结构  

```typescript
export interface SuspenseBoundary {
    /**
     * Suspense 组件对应的 vnode 对象 
     */
    vnode: VNode<RendererNode, RendererElement, SuspenseProps>
    /**
     * 父级 suspense 作用域，存在 Suspense 嵌套时，里面的 Suspense 就会存在父级作用域 
     */
    parent: SuspenseBoundary | null
    /**
     * Suspense 组件所在的父组件实例 
     */
    parentComponent: ComponentInternalInstance | null
    isSVG: boolean
    optimized: boolean
    /**
     * Suspense 组件所在的真实容器
     */
    container: RendererElement
    /**
     * Suspense 组件自身创建的隐藏容器，后面会看到这个隐藏容器的作用 
     */
    hiddenContainer: RendererElement
    /**
     * Suspense 组件的下一个节点 
     */
    anchor: RendererNode | null
    /**
     *  Suspense 组件当前展示的 vnode，如果在异步过程结束之前，就是 fallback，异步过程结束后就是 default
     */
    activeBranch: VNode | null
    /**
     * Suspense 组件等待渲染的 vnode，如果在异步过程结束之前，就是 default，异步过程结束之后就是 null，表示已经没有需要等待渲染的节点了 
     */
    pendingBranch: VNode | null
    /**
     * Suspense 组件内异步任务的个数 
     */
    deps: number
    pendingId: number
    timeout: number
    isInFallback: boolean
    isHydrating: boolean
    isUnmounted: boolean
    /**
     * default 组件内产生的副作用，因为 fallback 不处于作用域内，所以没有 fallback 产生的副作用 
     */
    effects: Function[]
    /**
     * 所有异步任务结束后调用的函数：将隐藏容器内的节点移动到真实节点
     */
    resolve(force?: boolean): void
    fallback(fallbackVNode: VNode): void
    /**
     * Suspense 组件发生移动调用的函数 
     */
    move(
        container: RendererElement,
        anchor: RendererNode | null,
        type: MoveType
    ): void
    /**
     * 获取 Suspense 组件的下一个节点 
     */
    next(): RendererNode | null
    /**
     * 注册异步任务，当 Suspense 内存在异步组件时调用 
     */
    registerDep(
        instance: ComponentInternalInstance,
        setupRenderEffect: SetupRenderEffectFn
    ): void
    /**
     * 卸载 Suspense 组件 
     */
    unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}
```  

# Suspense 生成步骤

## vnode 的生成  
在创建 `Suspense` 的 `vnode` 时，会对 `default` 和 `fallback` 两个插槽进行处理，然后挂载在 `vnode` 上  

```typescript
if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
    const { content, fallback } = normalizeSuspenseChildren(vnode)
    vnode.ssContent = content
    vnode.ssFallback = fallback
}
```  

最终，`ssContent` 就是异步组件的 `vnode`，而 `ssFallback` 就是异步结束之前的 `vnode`   

## patch Suspense  
接着会对 `Suspense` 进行 `patch` 操作，由 `Suspense` 具体的 `process` 完成  

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
挂载流程：  
1. 每个 `Suspense` 组件都会有一个空的 `div` 容器，称为 `hiddenContainer`，首先会将 `default` `patch` 到空的容器中  
    如果 `default` 中存在异步组件，首先会将异步组件的 `subTree` 设置注释节点，然后将注释插入到异步组件所在的容器中，作为占位符  
    这个占位符表示的就是异步组件实际要渲染的位置  
    注意：如果存在异步组件，是不会执行渲染函数 `render` 的  
2. 如果 `default` 中存在异步组件，则会将 `fallback` 插入到 `Suspense` 组件所在的真实容器中  
3. 等到异步过程结束后可以获取到渲染函数，调用渲染函数插入到占位符的位置，渲染结束后将占位符移除  
    卸载 `fallback`，再将 `hiddenContainer` 中的所有内容移动到 `fallback` 的位置 

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

初始化  
```html
<!-- hiddenContainer -->
<div>
    <!--  -->
</div>

<!-- root -->
<div>
    <div>fallback</div>
</div>
```

异步结束后，会调用渲染函数将结果渲染到注释之前，再删除注释节点  

```html
<!-- hiddenContainer -->
<div>
    <div>complete</div>
</div>

<!-- root -->
<div>
    <div>fallback</div>
</div>
```  

最后在将 `fallback` 卸载，将 `hiddenContainer` 中的内容移动到 `root` 里  

```html
<!-- hiddenContainer -->
<div></div>

<!-- root -->
<div>
    <div>complete</div>
</div>
```  

接下来看挂载的具体实现  

```typescript
function mountSuspense(
    vnode: VNode,
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

    // 1. 创建隐藏容器，并不会插入到实际的 DOM 树中
    const hiddenContainer = createElement('div')
    // 2. 创建 suspense 作用域，并挂载在 vnode 上
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

    // 3. 将 content 挂载在 pendingBranch 上，表示这是 Suspense 需要等待的组件
    patch(
        null,
        (suspense.pendingBranch = vnode.ssContent!),
        hiddenContainer,    // 容器为隐藏容器
        null,
        parentComponent,
        suspense,           // content 会处于 suspense 作用域内
        isSVG,
        optimized
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

注意：在第三步对 `content` 进行 `patch` 操作时，会传入当前 `suspense` 作为父作用域，即之后的所有操作，`parentSuspense` 都是这个作用域  
    如果 `content` 是一个异步组件，那么就会调用 [registerDep](#注册异步操作-registerDep) 来注册一个异步任务  

### 收集副作用  
在挂载的第 3 步对 `default` 进行 `patch` 时，传递了 `suspense` 作用域，可以看到，无论 `default` 的层级有多深，`parentSuspense` 都是这个作用域  
如果组件存在一些副作用(例如生命周期，或者通过 [watch](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/watch/README.md) 监听了值)，那么此时并不会立即入队，而是先会 `push` 到作用域的 `effects` 中，等到异步真正结束的时候再去执行这些副作用   

```typescript
export function queueEffectWithSuspense(fn: Function | Function[], suspense: SuspenseBoundary | null): void {
    // 存在 suspense 作用域，并且异步任务还没有结束，将 fn 存入作用域内
    if (suspense && suspense.pendingBranch) {
        if (isArray(fn)) {
            suspense.effects.push(...fn)
        } else {
            suspense.effects.push(fn)
        }
    } else {
        queuePostFlushCb(fn)
    }
}
```  

### 创建 Suspense 作用域  
每个 `Suspense` 组件都会对应一个作用域对象，里面每个属性的意义可以参考 [Suspense 作用域](#Suspense-作用域)  

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

作用域里的一些函数，可以等到具体用到的时候再回来看详细内容  

#### 移动 Suspense 组件  
当移动的是一个 `Suspense` 组件时，会调用这个函数来实现  

```typescript
move(container, anchor, type) {
    suspense.activeBranch && move(suspense.activeBranch, container, anchor, type)
    suspense.container = container
},
```  

#### 获取 Suspense 组件的下一个兄弟节点  

```typescript
next() {
    // 实际获取的是 activeBranch 的兄弟节点
    return suspense.activeBranch && next(suspense.activeBranch)
},
```  

#### 卸载 Suspense 组件  
当卸载的是一个 `Suspense` 组件时，会调用这个函数  

```typescript
unmount(parentSuspense, doRemove) {
    // 标识作用域对象中的值，标识已经卸载
    suspense.isUnmounted = true
    // 卸载当前展示的 vnode
    if (suspense.activeBranch) {
        unmount(
            suspense.activeBranch,
            parentComponent,
            parentSuspense,
            doRemove
        )
    }
    // 如果在异步过程结束前就卸载了 Suspense，那么也会卸载等待的 vnode
    if (suspense.pendingBranch) {
        unmount(
            suspense.pendingBranch,
            parentComponent,
            parentSuspense,
            doRemove
        )
    }
}
```  

#### 注册异步操作 registerDep   
1. 当在 [挂载阶段](#挂载-Suspense) `patch` `pengingBranch` 时，如果 `setup` 返回一个 `Promise` 时，此时先会在 [setupStatefulComponent](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#setupstatefulcomponent) 中将返回的 `Promise` 挂载在 `asyncDep` 上，接着在 [mountComponent](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#mountComponent) 中调用 *注册函数* 将作用域对象与组件的渲染函数关联起来  
2. 接着在客户端情况下，会将异步组件的 `subTree` 直接设置为注释节点，并将注释插入到异步组件所处的容器中，作为占位符，表示异步组件异步结束后实际渲染的位置  
    这里的容器可能是值前面创建的 `hiddenContainer`，也可能不是，但无论是哪一种情况，都会在 `hiddenContainer` 的里面  

    ```typescript
    // 这种情况，渲染 Comp 时的容器就是 hiddenContainer
    h(Suspense, null, {
        default: h(Comp),
        fallback: h('div', 'loading')
    })

    // 这种情况，渲染 Comp 时的容器就是 div，而 div 又是在 hiddenContainer 里的
    h(Suspense, null, {
        default: h('div', null, [
            h(Comp)
        ]),
        fallback: h('div', 'loading')
    })
    ```  

接下来看实现  

```typescript
/**
 * 注册异步任务
 * @param {} instance 异步组件实例 
 * @param {} setupRenderEffect 渲染函数 
 */
registerDep(instance, setupRenderEffect) {
    if (!suspense.pendingBranch) {
        return
    }

    // 获取真实节点，在服务端会存在，客户端下不存在
    const hydratedEl = instance.vnode.el
    // 异步操作 +1
    suspense.deps++
    
    // setup 返回的异步任务增加 then 和 catch 回调
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
        // 标识异步操作已结束
        instance.asyncResolved = true
        
        const { vnode } = instance
        // 处理 asyncSetupResult 为渲染函数 render
        handleSetupResult(instance, asyncSetupResult, false)
        
        if (hydratedEl) {
            // vnode may have been replaced if an update happened before the
            // async dep is resolved.
            vnode.el = hydratedEl
        }
        
        // 获取占位节点
        // 客户端下，在 mountComponent 中，如果组件是异步的话，那么会将注释节点作为其子节点
        // 服务端下不存在
        const placeholder = !hydratedEl && instance.subTree.el
        
        // 为组件增加更新函数并执行
        setupRenderEffect(
            instance,
            vnode,
            // 客户端情况下，容器就是占位符所在的容器
            parentNode(hydratedEl || instance.subTree.el!)!,
            // 客户端情况下，anchor 就是占位符的下一个节点
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

#### 完成异步操作 resolve  
当调用这个方法时，说明 `Suspense` 异步过程已经结束，需要将真正展示的组件显示出来了  

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

## 设置 Suspense 组件当前展示的 vnode  
无论什么时候调用 `setActiveBranch`，它的第二个参数都是已经 `patch` 过的 `vnode`，所以肯定已经创建了真实节点(存在 `el`)  

```typescript
/**
 * @param { SuspenseBoundary } suspense Suspense 作用域
 * @param { VNode } branch 当前展示的 vnode
 */
function setActiveBranch(suspense: SuspenseBoundary, branch: VNode) {
    // 更新作用域中当前展示的 vnode
    suspense.activeBranch = branch
    const { vnode, parentComponent } = suspense
    // 更新 Suspense 的 vnode 的 el
    const el = (vnode.el = branch.el)
    // 如果 Suspense 所在的父组件只有一个节点且就是 Suspense 组件，那么会向上更新父组件的 vnode 的 el
    if (parentComponent && parentComponent.subTree === vnode) {
        parentComponent.vnode.el = el         // 修改父组件 vnode 的 el
        updateHOCHostEl(parentComponent, el)  // 递归向上修改父组件的 el
    }
}
```  

## 更新 Suspense  

```typescript
function patchSuspense(
  n1: VNode,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  isSVG: boolean,
  optimized: boolean,
  { p: patch, um: unmount, o: { createElement } }: RendererInternals
) {
    // 复用 suspense 作用域
    const suspense = (n2.suspense = n1.suspense)!
    // 更新作用域的 vnode 指向新的 vnode
    suspense.vnode = n2
    // 复用真实节点 el
    n2.el = n1.el

    const newBranch = n2.ssContent!
    const newFallback = n2.ssFallback!

    const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense

    // 检测异步过程是否结束，结束后是不会存在 pendingBranch 的
    if (pendingBranch) {
        // 异步过程未结束

        // 更新作用域中等待的节点为最新需要等待的节点
        suspense.pendingBranch = newBranch

        // 检测新老根节点是否相同
        if (isSameVNodeType(newBranch, pendingBranch)) {
            // 根节点相同，只需要 patch 内容即可
            patch(
                pendingBranch,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                isSVG,
                optimized
            )

            // 检测新节点是否存在异步任务
            if (suspense.deps <= 0) {
                // 不存在异步任务，直接 resolve
                suspense.resolve()
            } else if (isInFallback) {
                // 存在异步任务，patch fallback 到真实的 container 中
                patch(
                    activeBranch,
                    newFallback,
                    container,
                    anchor,
                    parentComponent,
                    null, // fallback 树中不存在 suspense 作用域
                    isSVG,
                    optimized
                )
                // 更新 suspense 当前展示的节点
                setActiveBranch(suspense, newFallback)
            }
        } else {
            // 根节点不同
            if (isHydrating) {
                // if toggled before hydration is finished, the current DOM tree is
                // no longer valid. set it as the active branch so it will be unmounted
                // when resolved
                suspense.isHydrating = false
                suspense.activeBranch = pendingBranch
            } else {
                // 卸载老节点，卸载过程中如果产生副作用会添加到 suspense.effects 中
                unmount(pendingBranch, parentComponent, suspense)

                // 重置异步任务个数
                suspense.deps = 0
                // 清空所有副作用，此时老节点没有挂载，所以不需要执行任何副作用
                suspense.effects.length = 0
                // 重置隐藏容器
                suspense.hiddenContainer = createElement('div')
            }
        }
        
    } else {
        
    }
}
```  
