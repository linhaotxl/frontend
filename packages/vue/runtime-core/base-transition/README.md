<!-- TOC -->

- [BaseTransition 基本介绍](#basetransition-基本介绍)
- [BaseTransition 实现](#basetransition-实现)
    - [BaseTransition 组件](#basetransition-组件)
        - [props](#props)
        - [setup](#setup)
    - [BaseTransition 状态](#basetransition-状态)
    - [获取需要删除的节点集合](#获取需要删除的节点集合)
    - [解析 transition 的 hooks](#解析-transition-的-hooks)
        - [beforeEnter](#beforeenter)
        - [enter](#enter)
        - [leave](#leave)
    - [更新 vnode 的 transition](#更新-vnode-的-transition)

<!-- /TOC -->

# BaseTransition 基本介绍  

`BaseTransition` 是一个普通的内置组件，在节点被挂载、卸载时，会调用一些额外的钩子函数，来控制节点新增、移除的时机   
例如，在新旧节点替换时，是先删除旧节点，再插入新节点；还是先插入新节点，再删除旧节点；能控制时机后，就可以为节点增加动画，实现过渡效果  

# BaseTransition 实现  

## BaseTransition 组件  

```typescript
const TransitionHookValidator = [Function, Array]

const BaseTransitionImpl = {
    name: `BaseTransition`,

    props: {
        mode: String,
        appear: Boolean,
        persisted: Boolean,
        // enter
        onBeforeEnter: TransitionHookValidator,
        onEnter: TransitionHookValidator,
        onAfterEnter: TransitionHookValidator,
        onEnterCancelled: TransitionHookValidator,
        // leave
        onBeforeLeave: TransitionHookValidator,
        onLeave: TransitionHookValidator,
        onAfterLeave: TransitionHookValidator,
        onLeaveCancelled: TransitionHookValidator,
        // appear
        onBeforeAppear: TransitionHookValidator,
        onAppear: TransitionHookValidator,
        onAfterAppear: TransitionHookValidator,
        onAppearCancelled: TransitionHookValidator
    },

    setup(props: BaseTransitionProps, { slots }: SetupContext) {
        // ...
    }
}
```

### props  
组件接受的 `props` 比较多，大致可以分为以下几类  
1. 控制类   
    * `mode`： 在更新时决定新老节点替换的方式  
        1. `default`：默认方式，即先删除老节点，再插入新节点，整个过程都是同步的  
        2. `in-out`：先进再出，即新节点插入成功后再删除老节点  
        3. `out-in`：先出再进，即老节点移除成功后再插入新节点  
    * `appear`：用来控制在第一次插入时，是否调用相关钩子函数  
        对于同一个节点来说，第一次挂载和第二次挂载是不一样的，`appear` 只会控制第一次挂载  
    * `persisted`：// TODO: 

2. 钩子类  
    * `appear` 相关钩子，只会在第一次挂载并且提供 `appear` 才会触发  
        1. `onBeforeAppear`：插入节点之前  
        2. `onAppear`：插入节点后  
        3. `onAfterAppear`：插入节点成功  
        4. `onAppearCancelled` 插入节点失败  
        
    * `enter` 相关钩子，第一次提供 `appear`，但是没有提供 `appear` 相关钩子，或者第一次之后才会触发 
        1. `onBeforeEnter`：插入节点之前  
        2. `onEnter`：插入节点后  
        3. `onAfterEnter`：插入节点成功  
        4. `onEnterCancelled` 插入节点失败  

    * `leave` 相关钩子
        1. `onBeforeLeave`：移除节点之前  
        2. `onLeave`：移除节点后  
        3. `onAfterLeave`：移除节点成功  
        4. `onLeaveCancelled` 移除节点失败  


### setup  
先来看 `setup` 的实现，因为有些代码需要后面的知识，所以可以先看后面的内容，再回头看这部分(这些代码已经用注释标记了)  
以下对节点的挂载称之为 **入场**，卸载称之为 **离场**  

```typescript
setup (props: BaseTransitionProps, { slots }: SetupContext) {
    // 1. 获取 Transition 组件实例
    const instance = getCurrentInstance()!
    // 2. 获取状态对象
    const state = useTransitionState()

    return () => {
        // 3. 获取子节点
        const children = slots.default && getTransitionRawChildren(slots.default(), true)
        if (!children || !children.length) {
            return
        }

        // 4. 检测子节点数量，BaseTransition 要求只能有一个子节点
        if (__DEV__ && children.length > 1) {
            warn(
            '<transition> can only be used on a single element or component. Use ' +
                '<transition-group> for lists.'
            )
        }

        // 3. 获取 props 的原始对象，并检测 mode 是否是指定值
        const rawProps = toRaw(props)
        const { mode } = rawProps
        if (__DEV__ && mode && !['in-out', 'out-in', 'default'].includes(mode)) {
            warn(`invalid <transition> mode: ${mode}`)
        }

        // 4. 获取唯一的子节点
        const child = children[0]

        // 5. 这个逻辑可以先不看，后面用到的时候会说
        //    如果当前还有节点未离场，则会渲染占位符
        //    这里没有判断 mode === out-in，如果 isLeaving 为 true，那么只会发生在 out-in 的情况下
        if (state.isLeaving) {
            return emptyPlaceholder(child)
        }

        // 6. 获取子节点
        // in the case of <transition><keep-alive/></transition>, we need to
        // compare the type of the kept-alive children.
        const innerChild = getKeepAliveChild(child)
        if (!innerChild) {
            return emptyPlaceholder(child)
        }

        // 7. 创建子节点入场的 hooks 对象
        const enterHooks = resolveTransitionHooks(
            innerChild,
            rawProps,
            state,
            instance
        )
        // 8. 设置子节点入场的 hooks 对象
        setTransitionHooks(innerChild, enterHooks)

        // 接下来都是更新的逻辑
        // 9. 获取旧的子节点
        const oldChild = instance.subTree
        const oldInnerChild = oldChild && getKeepAliveChild(oldChild)

        // 10. 
        if (
            oldInnerChild &&
            oldInnerChild.type !== Comment &&
            (!isSameVNodeType(innerChild, oldInnerChild) || transitionKeyChanged)
        ) {
            // 10.1 对旧节点创建离场的 hooks 对象
            const leavingHooks = resolveTransitionHooks(
                oldInnerChild,
                rawProps,
                state,
                instance
            )
            // 10.2 更新旧节点的 hooks 对象
            setTransitionHooks(oldInnerChild, leavingHooks)

            // 10.3 处理 out-in 和 in-out 两种模式，放在后面介绍
            if (mode === 'out-in') { /* ... */ }
            else if (mode === 'in-out') { /* ... */ }
        }

        // 11. 最终返回子节点去渲染
        return child
    }
}
```

可以看到，`setup` 最重要的就是为子节点设置了 `hooks` 对象，所以接下来会终点看这部分的内容  

接下来依次介绍 `setup` 中出现的内容  

## BaseTransition 状态  
每个 `BaseTransition` 组件都对应一个状态，用来标识当前处于什么时期  

```typescript
export interface TransitionState {
    isMounted: boolean      // 是否挂载完成
    isLeaving: boolean      // 是否正在离场，需要 mode 为 out-in 配合，后面会看到用法
    isUnmounting: boolean   // 是否正在卸载
    // 需要删除节点的集合，key 是节点的 type，value 是一个纯对象，其中 key 是节点的 key，value 是需要移除 vnode 对象
    leavingVNodes: Map<any, Record<string, VNode>>
}

export function useTransitionState(): TransitionState {
    const state: TransitionState = {
        isMounted: false,
        isLeaving: false,
        isUnmounting: false,
        leavingVNodes: new Map()
    }
    // 挂载完成后更新状态为已挂载
    onMounted(() => {
        state.isMounted = true
    })
    // TODO: 卸载前更新状态为卸载中
    onBeforeUnmount(() => {
        state.isUnmounting = true
    })
    return state
}
```

## 获取需要删除的节点集合  
上面说了，`leavingVNodes` 的 `key` 是 `vnode` 的 `type`，所以会通过这个函数来获取 `type` 下面的纯对象，如果没有则会设置  

```typescript
function getLeavingNodesForType(
    state: TransitionState, // BaseTransition 状态对象
    vnode: VNode            // vnode 对象
): Record<string, VNode> {
    const { leavingVNodes } = state
    let leavingVNodesCache = leavingVNodes.get(vnode.type)!
    if (!leavingVNodesCache) {
        leavingVNodesCache = Object.create(null)
        leavingVNodes.set(vnode.type, leavingVNodesCache)
    }
    return leavingVNodesCache
}
```

## 解析 transition 的 hooks  
每个 `vnode` 对象上都存在一个 `transition` 属性用来存储 `hooks` 对象，只有 `BaseTransition` 的子节点才会存在这个属性  
这个属性中会包含一些钩子函数，当节点插入、移除时会首先调用这些钩子，再调用传递给 `BaseTransition` 的钩子  

先来看看 `hooks` 对象都有哪些属性  

```typescript
export interface TransitionHooks<
    extends RendererElement = RendererElement
> {
    mode: BaseTransitionProps['mode']
    persisted: boolean
    // 挂载前的钩子
    beforeEnter(el: HostElement): void
    // 挂载后的钩子
    enter(el: HostElement): void
    // 移除时的钩子
    leave(el: HostElement, remove: () => void): void
    clone(vnode: VNode): TransitionHooks<HostElement>
    // 以下几个为可选钩子
    // out-in 模式下会出现
    afterLeave?(): void
    // in-out 模式下会出现
    delayLeave?(
        el: HostElement,
        earlyRemove: () => void,
        delayedLeave: () => void
    ): void
    delayedLeave?(): void
}
```

接下来看具体实现  

```typescript
export function resolveTransitionHooks(
    vnode: VNode,                         // 操作的 vnode 节点
    props: BaseTransitionProps<any>,      // props 的原始对象
    state: TransitionState,               // Transition 状态对象
    instance: ComponentInternalInstance   // Transition 组件实例
): TransitionHooks {
    // 1. 获取 BaseTransition 上的各个钩子
    const {
        appear,
        mode,
        persisted = false,
        onBeforeEnter,
        onEnter,
        onAfterEnter,
        onEnterCancelled,
        onBeforeLeave,
        onLeave,
        onAfterLeave,
        onLeaveCancelled,
        onBeforeAppear,
        onAppear,
        onAfterAppear,
        onAppearCancelled
    } = props
    // 2. 获取 vnode 的 key
    const key = String(vnode.key)
    // 3. 根据 vnode.type 获取需要移除的集合
    const leavingVNodesCache = getLeavingNodesForType(state, vnode)
    // 4. 调用钩子的函数
    const callHook: TransitionHookCaller = (hook, args) => {
        hook &&
        callWithAsyncErrorHandling(
            hook,
            instance,
            ErrorCodes.TRANSITION_HOOK,
            args
        )
    }
    // 5. 定义钩子对象
    const hooks: TransitionHooks<TransitionElement> = {
        mode,
        persisted,
        beforeEnter(el) { /* ... */ },
        enter(el) { /* ... */ },
        leave(el, remove) { /* ... */ },
        clone(el) { /* ... */ },
    }

    return hooks;
}
```

### beforeEnter  
这个钩子被调用是发生在**创建节点后，插入到容器之前**，在 [mountElement]() 中，以下是部分关键代码  

```typescript
const mountElement = () => {
    /* ... */
    // 检测是否需要调用 transition 的 hooks
    const needCallTransitionHooks =
      (!parentSuspense || (parentSuspense && !parentSuspense.pendingBranch)) &&
      transition &&
      !transition.persisted
    if (needCallTransitionHooks) {
        // 调用 beforeEnter 钩子，并将真实节点 el 作为参数
        // 注意，此时的 el 还没有被插入到容器中
        transition!.beforeEnter(el)
    }
    hostInsert(el, container, anchor)
    
    /* ... */
}
```

接下来看 `beforeEnter` 的实现  

```typescript
beforeEnter(el) {
    // 1. 钩子函数默认执行 onBeforeEnter
    let hook = onBeforeEnter
    // 2. 如果是第一次入场，则根据 appear 来决定是否执行钩子函数
    if (!state.isMounted) {
        if (appear) {
            // 提供了 appear，优先执行 onBeforeAppear 钩子，没有再执行 onBeforeEnter
            hook = onBeforeAppear || onBeforeEnter
        } else {
            // 没有提供 appear，则第一次入场什么也不会做
            return
        }
    }
    
    // 3. TODO: 这里的逻辑先可以不用看，后面会说到
    // for same element (v-show)
    if (el._leaveCb) {
        el._leaveCb(true /* cancelled */)
    }

    // 4. TODO: 这里的逻辑先可以不用看，后面会说到
    // 如果在入场时还存在同一个需要删除的节点，则会在这里强制删除
    // 例如：同一个 key 的节点，先卸载，在调用真正的 leave 的 done 之前，又将其挂载
    const leavingVNode = leavingVNodesCache[key]
    if (
        leavingVNode &&
        isSameVNodeType(vnode, leavingVNode) &&
        leavingVNode.el!._leaveCb
    ) {
        leavingVNode.el!._leaveCb()
    }

    // 5. 执行钩子，参数是入场的真实节点 el，此时 el 还未挂载到 container 中
    callHook(hook, [el])
}
```

可以看到，在第一次渲染 `BaseTransition` 的子节点时，会进入 2 的逻辑内，根据 `appear` 来决定执行哪个钩子，或者什么也不做  
而等到 `BaseTransition` 挂载完成后，再入场的节点，就不会进入 2 的逻辑，只会执行 `onBeforeEnter` 钩子了  

要记得在 [创建状态](#basetransition-状态) 中，`BaseTransition` 组件挂载完成就会将 `isMounted` 设置为 `true`  

### enter  
这个钩子被调用是发生在 **插入节点之后**，在 [mountElement]() 中，以下是部分关键代码  

```typescript
const mountElement = () => {
    /* ... */
    hostInsert(el, container, anchor)
    
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
    /* ... */
}
```

**和 `beforeEnter` 不同的是，`enter` 是在异步中执行的**  

接下来看具体实现  

```typescript
// el 此时已经存在于容器内
enter (el) {
    // 1. 获取各个需要执行的钩子
    let hook = onEnter                // 入场钩子，默认为 onEnter
    let afterHook = onAfterEnter      // 入场结束钩子，默认为 onAfterEnter
    let cancelHook = onEnterCancelled // 入场取消钩子，默认为 onEnterCancelled

    // 2. 这里的逻辑和 beforeEnter 一致，不再描述
    if (!state.isMounted) {
        if (appear) {
            // 提供了 appear，则优先执行 appear 的钩子，否则就执行默认钩子
            hook = onAppear || onEnter
            afterHook = onAfterAppear || onAfterEnter
            cancelHook = onAppearCancelled || onEnterCancelled
        } else {
            // 没有提供 appear，则第一次入场什么也不会做
            return
        }
    }

    // 3. 是否执行 done 的开关
    let called = false
    // 4. 定义 done 函数，同时会挂载在真实节点上
    const done = (el._enterCb = (cancelled?) => {
        // 4.1 确保这个函数只会执行一次
        if (called) return
        called = true
        // 4.2 根据参数决定调用哪一个钩子
        if (cancelled) {
            // 调用取消的钩子
            callHook(cancelHook, [el])
        } else {
            // 调用结束的钩子
            callHook(afterHook, [el])
        }
        // 4.3 TODO:
        if (hooks.delayedLeave) {
            hooks.delayedLeave()
        }
        // 4.4 调用结束，清空 el 上的属性
        el._enterCb = undefined
    }

    // 5. 执行钩子
    if (hook) {
        // 接受两个参数：1. 真实节点 el；2. done 函数
        // 如果钩子函数接受的参数小于等于 1，则会立即执行结束后的 done
        // 否则由钩子函数决定什么时候调用 done
        hook(el, done)
        if (hook.length <= 1) {
            done()
        }
    } else {
        // 钩子函数不存在，直接执行 done
        done()
    }
}
```

### leave  
这个钩子被调用是发生在 **卸载节点** 时，在 [remove]() 方法中，部分关键代码如下  

```typescript
const remove: RemoveFn = vnode => {
    /* ... */
    // 执行移除真实节点的函数
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
        // 执行 leave 钩子的函数，
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

注意的是，如果需要调用 `transition hooks` 时，是不会在这里删除真实节点的，而是将删除方法作为参数传递给 `leave` 钩子  
接下来看具体实现  

```typescript
leave(el, remove) {
    // 1. 获取 key
    const key = String(vnode.key)

    // 2. TODO: 这种情况之后会说到
    if (el._enterCb) {
        el._enterCb(true /* cancelled */)
    }

    // 3. TODO: 这种情况之后会说到
    if (state.isUnmounting) {
        return remove()
    }

    // 4. 调用离场前的钩子 onBeforeLeave
    callHook(onBeforeLeave, [el])

    // 5. 是否执行过 done 的开关
    let called = false
    // 6. 定义 done 函数，同时挂载在节点上
    const done = (el._leaveCb = (cancelled?) => {
        // 6.1 确保这个函数只会执行一次
        if (called) return
        called = true
        // 6.2 调用删除节点的函数
        remove()
        // 6.3 根据 cancelled 来决定是执行取消的钩子 onLeaveCancelled 还是离开后的钩子 onAfterLeave
        if (cancelled) {
            callHook(onLeaveCancelled, [el])
        } else {
            callHook(onAfterLeave, [el])
        }
        // 6.4 清空 _leaveCb
        el._leaveCb = undefined
        // 6.5 删除记录的节点
        if (leavingVNodesCache[key] === vnode) {
            delete leavingVNodesCache[key]
        }
    })

    // 6. 记录当前要删除的节点
    leavingVNodesCache[key] = vnode

    // 7. 是否存在 onLeave 钩子
    if (onLeave) {
        // 调用 onLeave 钩子，参数和 enter 钩子一样
        onLeave(el, done)
        if (onLeave.length <= 1) {
            done()
        }
    } else {
        // 不存在，直接调用 done 表示完成
        done()
    }
}
```



## 更新 vnode 的 transition  
通过上一步创建好的 `transition hooks` 对象，需要通过这个函数设置给 `vnode`  

```typescript
export function setTransitionHooks(vnode: VNode, hooks: TransitionHooks) {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT && vnode.component) {
        // 如果 vnode 是组件，并且已经挂载好了的，直接对 subTree 再次调该函数用来设置
        setTransitionHooks(vnode.component.subTree, hooks)
    } else if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
        // Suspense 组件
        vnode.ssContent!.transition = hooks.clone(vnode.ssContent!)
        vnode.ssFallback!.transition = hooks.clone(vnode.ssFallback!)
    } else {
        // 其他情况，都直接设置给 vnode
        vnode.transition = hooks
    }
}
```

如果是组件第一次挂载，也会直接设置在组件的 `vnode` 上，然后执行完组件的 `render` 后，获取到子节点，再将组件上的 `transition` 继承给子节点  
在 [renderComponentRoot]() 里，有继承的逻辑  

```typescript
export function renderComponentRoot(instance: ComponentInternalInstance): VNode {
    /* ... */
    // inherit transition data
    if (vnode.transition) {
      if (__DEV__ && !isElementRoot(root)) {
        warn(
          `Component inside <Transition> renders non-element root node ` +
            `that cannot be animated.`
        )
      }
      root.transition = vnode.transition
    }
    /* ... */
}
```

