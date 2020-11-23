> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [源码中用到的工具函数](#源码中用到的工具函数)
- [名词解释](#名词解释)
- [processComponent](#processcomponent)
- [mountComponent](#mountcomponent)
    - [createComponentInstance](#createcomponentinstance)
    - [setupComponent](#setupcomponent)
    - [setupStatefulComponent](#setupstatefulcomponent)
        - [createSetupContext](#createsetupcontext)
    - [handleSetupResult](#handlesetupresult)
    - [finishComponentSetup](#finishcomponentsetup)
    - [setupRenderEffect](#setuprendereffect)
        - [挂载](#挂载)
        - [更新](#更新)
            - [updateHOCHostEl](#updatehochostel)
- [updateComponent](#updatecomponent)
    - [shouldUpdateComponent](#shouldupdatecomponent)
    - [hasPropsChanged](#haspropschanged)
- [示例](#示例)
    - [HOC更新](#hoc更新)

<!-- /TOC -->

# 源码中用到的工具函数  
1. [invokeArrayFns](#invokeArrayFns)  
2. [invokeVNodeHook](#invokeVNodeHook)  
3. [callWithErrorHandling](#callWithErrorHandling)  
3. [queuePostRenderEffect](#queuePostRenderEffect)  

# 名词解释  
1. 有如下的组件 `Comp`，这之后会称这个对象为 **“组件对象”**  
  
    ```typescript
    const Comp = {
        setup () {
            // ...
        },
        render () {
            // ... 
        }
    }
    ```

# processComponent  
这个函数是组件的入口函数，用来处理组件的挂载或者更新，只会在 [patch](#patch) 中被调用  

```typescript
const processComponent = (
    n1: VNode | null,           // 旧组件节点
    n2: VNode,                  // 新组件节点
    container: RendererElement, // 父节点
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,  // 父组件
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
) => {
    if (n1 == null) {
        // 挂载
        if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
            ;(parentComponent!.ctx as KeepAliveContext).activate(
                n2,
                container,
                anchor,
                isSVG,
                optimized
            )
        } else {
            mountComponent(
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                isSVG,
                optimized
            )
        }
    } else {
        // 更新
        updateComponent(n1, n2, optimized)
    }
}
```  

# mountComponent  
这个函数用来挂载组件，主要做这件事  
1. 创建组件实例  
2. 安装组件（ 对于状态组件和函数组件有不同的处理方式 ）  
3. 处理异步组件  
4. 设置组件更新函数  

```typescript
const mountComponent: MountComponentFn = (
    initialVNode,       // 挂载组件的 vnode
    container,          // 父节点
    anchor,
    parentComponent,    // 父组件实例
    parentSuspense,
    isSVG,
    optimized
) => {
    // 创建组件实例，并挂载到 vnode 的 component 上
    const instance: ComponentInternalInstance = (initialVNode.component = createComponentInstance(
        initialVNode,
        parentComponent,
        parentSuspense
    ))

    // 处理 keepAlive 组件
    if (isKeepAlive(initialVNode)) {
        ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // 安装组件
    setupComponent(instance)

    // 处理 Suspense 异步组件
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
        parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect)

        // Give it a placeholder if this is not hydration
        // TODO handle self-defined fallback
        if (!initialVNode.el) {
            const placeholder = (instance.subTree = createVNode(Comment))
            processCommentNode(null, placeholder, container!, anchor)
        }
        return
    }

    // 设置组件的更新函数
    setupRenderEffect(
        instance,
        initialVNode,
        container,
        anchor,
        parentSuspense,
        isSVG,
        optimized
    )
}
```  

## createComponentInstance  
每个组件都会对应一个实例对象，记录着组件的所有信息。组件的 `vnode` 以及实例对象会相互关联，`vnode.component` 会指向实例，而 `实例.vnode` 会指向 `vnode` 对象  

```typescript
// 组件索引，每次创建一个组件会 + 1
let uid = 0

export function createComponentInstance(
  vnode: VNode,                                 // 组件 vnode
  parent: ComponentInternalInstance | null,     // 父组件实例
  suspense: SuspenseBoundary | null
) {
    // 获取组件对象
    const type = vnode.type as ConcreteComponent
    
    // 每个组件继承父组件的 appContext，如果是根组件，则从 vnode 上获取，根节点的 vnode 会在 mount 时挂载 appContext
    const appContext = (parent ? parent.appContext : vnode.appContext) || emptyAppContext

    // 定义组件实例
    const instance: ComponentInternalInstance = {
        uid: uid++,
        vnode,
        type,
        parent,
        appContext,
        root: null!,      // 根组件实例
        next: null,
        subTree: null!,   // 组件子节点的 vnode
        update: null!,    // 组件的更新函数，更新整个组件的入口函数
        render: null,     // 组件的渲染函数，也就是组件对象上的 render
        proxy: null,      // 对 ctx 的代理，代理 handler 是 PublicInstanceProxyHandlers
        withProxy: null,  // 对 ctx 的代理，并且只有当组件的 render 函数是由模板编译生成时才会设置，代理 handler 是 RuntimeCompiledPublicInstanceProxyHandlers
        effects: null,
        // provides 继承自父组件，如果是根组件的话，会继承 context 中的 provides
        provides: parent ? parent.provides : Object.create(appContext.provides),
        accessCache: null!, // 缓存访问属性的来源，是 setupState、data、props 还是 ctx
        renderCache: [],

        // 组件加载的自定义组件以及指令
        components: null,
        directives: null,

        // 解析组件对象定义的 props 为配置对象
        propsOptions: normalizePropsOptions(type, appContext),
        // 解析组件对象定义的 emits 为配置对象
        emitsOptions: normalizeEmitsOptions(type, appContext),

        emit: null as any,  // 触发自定义事件的 emit 函数，下面就会设置
        emitted: null,      // 保存只执行一次的事件

        ctx: EMPTY_OBJ,
        data: EMPTY_OBJ,        // data 选项的值
        props: EMPTY_OBJ,       // 解析好的 props 值，key 都是 camel-case
        attrs: EMPTY_OBJ,       // 不存在于 props 中的值
        slots: EMPTY_OBJ,       
        refs: EMPTY_OBJ,        // ref 对象
        setupState: EMPTY_OBJ,  // setup 返回的对象
        setupContext: null,

        // suspense related
        suspense,
        suspenseId: suspense ? suspense.pendingId : 0,
        asyncDep: null,
        asyncResolved: false,

        // 生命周期钩子
        isMounted: false,       // 组件是否挂载
        isUnmounted: false,     // 组件是否卸载
        isDeactivated: false,
        bc: null,               // beforeCreate 钩子
        c: null,                // created 钩子
        bm: null,               // beforeMount 钩子
        m: null,                // mounted 钩子
        bu: null,               // beforeUpdate 钩子
        u: null,                // updated 钩子
        um: null,               // unmounted 钩子
        bum: null,              // beforeUnMounted 钩子
        da: null,
        a: null,
        rtg: null,
        rtc: null,
        ec: null
    }

    // 设置 ctx 状态
    instance.ctx = { _: instance }
    
    // 设置 root 属性
    instance.root = parent ? parent.root : instance
    // 设置 emit
    instance.emit = emit.bind(null, instance)

    return instance
}
```   

1. `proxy`  
    这个属性在 [setupStatefulComponent](#setupStatefulComponent) 中会被设置为代理对象  
    通过 `setup` 返回函数，以及组件对象上本身存在渲染函数这两种情况生成的 `render` 函数中，它的 `this` 指向以及第一个参数就是 `proxy` 属性，可以通过 `proxy` 来访问到组件上的一些属性，可以参考 [PublicInstanceProxyHandlers](#PublicInstanceProxyHandlers)
2. `withProxy`  
    这个属性在 [finishComponentSetup](#finishComponentSetup) 中会被设置为代理对象  
    在组件的 `template` 中，我们可以直接访问状态值，此时会被 [RuntimeCompiledPublicInstanceProxyHandlers](#RuntimeCompiledPublicInstanceProxyHandlers) 拦截，从而访问到具体的值   
3. `propsOptions`  
    通过 [normalizePropsOptions](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/props/README.md#normalizePropsOptions) 函数处理组件的 `props`  
4. `emitsOptions`  
    通过 [normalizeEmitsOptions](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/emits/README.md#normalizeemitsoptions) 函数处理组件的 `emits`  

## setupComponent  
安装组件，初始化 `props`、`slots`，如果是状态组件，则会再处理状态组件内部的逻辑，如果是函数组件，则直接安装完成  

```typescript
export function setupComponent(
    instance: ComponentInternalInstance,
    isSSR = false
) {
    isInSSRComponentSetup = isSSR

    // props 是从 vnode 上获取的，所以包含了所有的 props
    const { props, children, shapeFlag } = instance.vnode
    // 检测是否是状态组件
    const isStateful = shapeFlag & ShapeFlags.STATEFUL_COMPONENT
    // 初始化 props
    initProps(instance, props, isStateful, isSSR)
    // 初始化 slot
    initSlots(instance, children)

    // 如果是状态组件，则调用 setupStatefulComponent 安装状态组件，如果是函数则安装完成
    // 且只有是异步组件时，才会返回值
    const setupResult = isStateful
        ? setupStatefulComponent(instance, isSSR)
        : undefined
    
    isInSSRComponentSetup = false
    
    return setupResult
}
```  

通过 [initProps](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/props/README.md#initprops) 对组件的 `props` 进行初始化  
通过 [initSlots](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/slots/README.md#initSlot) 对组件的 `slots` 进行初始化    

## setupStatefulComponent  
安装状态组件，主要就是调用 `setup` 函数并处理返回结果  

```typescript
function setupStatefulComponent(
    instance: ComponentInternalInstance,
    isSSR: boolean
) {
    // 获取组件对象
    const Component = instance.type as ComponentOptions

    // 设置属性来源的对象
    instance.accessCache = {}
    // 创建组件渲染 render 函数的代理
    instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
    
    // 调用 setup 函数
    const { setup } = Component
    if (setup) {
        // 创建 setup 函数的参数，并挂载在 instance.setupContext 上
        const setupContext = (instance.setupContext =
            ? createSetupContext(instance)
            : null
        )

        // 调用 setup 之前，将组件记录在全局变量中，并暂停追踪
        currentInstance = instance
        pauseTracking()
        
        // 调用 setup 函数
        const setupResult = callWithErrorHandling(
            setup,
            instance,
            ErrorCodes.SETUP_FUNCTION,
            [instance.props, setupContext]
        )

        // 执行 setup 后，恢复追踪，并清空全局变量
        resetTracking()
        currentInstance = null

        // 检测 setup 返回值
        if (isPromise(setupResult)) {
            // setup 返回 Promise
            if (isSSR) {
                // return the promise so server-renderer can wait on it
                return setupResult.then((resolvedResult: unknown) => {
                    handleSetupResult(instance, resolvedResult, isSSR)
                })
            } else if (__FEATURE_SUSPENSE__) {
                // async setup returned Promise.
                // bail here and wait for re-entry.
                instance.asyncDep = setupResult
            } else if (__DEV__) {
                warn(
                `setup() returned a Promise, but the version of Vue you are using ` +
                    `does not support it yet.`
                )
            }
        } else {
            // setup 返回结果不是 Promise，需要进一步处理结果
            handleSetupResult(instance, setupResult, isSSR)
        }
    } else {
        // 不存在 setup 函数，直接处理渲染函数
        finishComponentSetup(instance, isSSR)
    }
}
```  

**currentInstance 只有在调用 setup 前会被设置为组件实例，调用后会重置为 null**  

### createSetupContext  
创建 `setup` 函数的第二个参数  

```typescript
function createSetupContext(instance: ComponentInternalInstance): SetupContext {
    return {
        attrs: instance.attrs,
        slots: instance.slots,
        emit: instance.emit
    }
}
```

## handleSetupResult  
这个函数用来处理 `setup` 的返回值，总共有两种类型  
1. 函数: 将作为组件的 `render` 渲染函数  
2. 对象: 将作为组件的 `setupState` 状态  

```typescript
export function handleSetupResult(
    instance: ComponentInternalInstance,
    setupResult: unknown,
    isSSR: boolean
) {
    if (isFunction(setupResult)) {
        // setup 返回函数，则作为组件的渲染函数 render
        instance.render = setupResult as InternalRenderFunction
    } else if (isObject(setupResult)) {
        // setup 返回对象，作为组件的 setupState 状态，并且会为其做一层代理
        instance.setupState = proxyRefs(setupResult)
    }
    
    // 设置组件的渲染函数 render
    finishComponentSetup(instance, isSSR)
}
```  

**如果 setup 返回对象作为状态时，实际会被 [proxyRefs](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/ref/README.md#proxyRefs) 代理**

## finishComponentSetup  
这个函数用来设置组件实例上的渲染函数 `render`，因为 `render` 的来源有很多，所以会统一挂载在组件实例上  

渲染函数 `render` 的来源  
1. 组件对象存在 `template`，经过编译会将其转换为渲染函数，并挂载在组件对象的 `render` 上  
2. 组件对象本身就存在 `render` 渲染函数  
3. `setup` 返回函数，会作为渲染函数 `render`  

```typescript
function finishComponentSetup(
    instance: ComponentInternalInstance,
    isSSR: boolean
) {
    // 获取组件对象
    const Component = instance.type as ComponentOptions

    // 处理服务端渲染
    if (__NODE_JS__ && isSSR) {
        if (Component.render) {
            instance.render = Component.render as InternalRenderFunction
        }
    }
    // 客户端渲染
    else if (!instance.render) {
        // 组件实例上不存在 render 函数
        // 上述 1、2 两种情况
        
        if (compile && Component.template && !Component.render) {
            // 上述 1 情况
            // 组件对象存在模板，且不存在渲染函数，才会模板编译为渲染函数，并挂载在组件对象上
            Component.render = compile(Component.template, {
                isCustomElement: instance.appContext.config.isCustomElement,
                delimiters: Component.delimiters
            })
        }

        // 将组件对象的渲染函数挂载在组件实例上
        // 包括组件对象本身存在 render 函数，或者是由模板编译成渲染函数的
        instance.render = (Component.render || NOOP) as InternalRenderFunction

        // 由模板编译成的渲染函数，是存在 _rc 属性的，设置 withProxy 代理，用于模板生成的渲染函数
        if (instance.render._rc) {
            instance.withProxy = new Proxy(
                instance.ctx,
                RuntimeCompiledPublicInstanceProxyHandlers
            )
        }
    }

    // 支持 2.x 版本的选项 api
    if (__FEATURE_OPTIONS_API__) {
        currentInstance = instance
        applyOptions(instance, Component)
        currentInstance = null
    }
}
```  

## setupRenderEffect   
每个组件实例上存在一个 `update` 属性，它是组件的更新函数，会执行组件的渲染函数 `render`，将结果挂载到真实节点上，所以不管是挂载还是更新都会执行组件的 `update` 函数   

`update` 实际上是一个 [effect](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/effect/README.md#effect) 对象，因为需要追踪状态值，当状态发生变化时更新组件  

```typescript
const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
) => {
    instance.update = effect(function componentEffect() {
        if (!instance.isMounted) {
            // 挂载...
        } else {
            // 更新...
        }
    }, prodEffectOptions)
}
```  

```typescript
const prodEffectOptions = {
    scheduler: queueJob,
    // #1801, #2043 component render effects should allow recursive updates
    allowRecurse: true
}
```  

### 挂载  

```typescript
if (!instance.isMounted) {
    let vnodeHook: VNodeHook | null | undefined
    const { el, props } = initialVNode
    const { bm, m, parent } = instance

    // 同步执行组件的 beforeMount 钩子函数
    if (bm) {
        invokeArrayFns(bm)
    }

    // 同步执行处理组件 vnode 的 beforeMount 钩子函数
    if ((vnodeHook = props && props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHook, parent, initialVNode)
    }

    // 解析组件的子节点，并挂载到 subTree 上
    const subTree = (instance.subTree = renderComponentRoot(instance))

    // 处理子节点
    if (el && hydrateNode) {
        // 服务端渲染
        // vnode has adopted host node - perform hydration instead of mount.
        hydrateNode(
            initialVNode.el as Node,
            subTree,
            instance,
            parentSuspense
        )
    } else {
        // 客户端渲染
        // 对子节点开始处理
        patch(
            null,       // 挂载
            subTree,    
            container,  // 容器节点，将 subTree 挂载到里面
            anchor,   
            instance,   // 当前组件作为子 vnode 的父组件
            parentSuspense,
            isSVG
        )

        // 这里已经将所有的子节点都创建完成，并挂载在容器里，将组件的 vnode.el 指向子 vnode 的 el
        initialVNode.el = subTree.el
    }

    // 处理组件的 onMounted 钩子，这里不会立即执行，而是将其放在队列中，等到下一轮微任务再去执行队列
    if (m) {
        queuePostRenderEffect(m, parentSuspense)
    }

    // 处理组件 vnode 的 onMounted 钩子，这里不会立即执行，而是将其放在队列中，等到下一轮微任务再去执行队列
    if ((vnodeHook = props && props.onVnodeMounted)) {
        queuePostRenderEffect(() => {
            invokeVNodeHook(vnodeHook!, parent, initialVNode)
        }, parentSuspense)
    }
    
    // 处理执行 onActivated 钩子函数该钩子只用作 keep-alive 组件
    // activated hook for keep-alive roots.
    // #1742 activated hook must be accessed after first render
    // since the hook may be injected by a child keep-alive
    const { a } = instance
    if (
        a &&
        initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
    ) {
        queuePostRenderEffect(a, parentSuspense)
    }

    // 标识已经挂载完成
    instance.isMounted = true
}
```  

### 更新  
组件的更新来源有两个  
1. 组件内部状态的更新，此时会通过异步更新来执行组件的 `update` 函数  
2. 父组件的更新，导致子组件更新，此时会通过 [patch](#patch) -> [processComponent](#processComponent) -> [updateComponent](#updateComponent) 来更新子组件  

```typescript
// next 是最新的 vnode，在上述第一种情况下，next 为 null；第二种情况下 next 为最新 vnode，即 n2
let { next, bu, u, parent, vnode } = instance
let originNext = next
let vnodeHook: VNodeHook | null | undefined

// 检测是组价内部状态的更新，还是父组件更新导致组件的更新
if (next) {
    // 父组件更新导致，需要更新 props 和 slots
    updateComponentPreRender(instance, next, optimized)
} else {
    // 组件内部状态变化，将组件 vnode 赋值给 next，确保 next 始终指向最新的 vnode
    next = vnode
}

// 更新最新 vnode 的 el，复用老的真实 DOM；这句代码主要针对的情况就是父组件更新，那么 next 就是新 vnode，是不存在 el 的
next.el = vnode.el

// 同步执行组件的 before update 钩子
if (bu) {
    invokeArrayFns(bu)
}

// 同步执行 vnode 的 before update 钩子
if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
    invokeVNodeHook(vnodeHook, parent, next, vnode)
}

// 调用 render 函数获取子节点 vnode
const nextTree = renderComponentRoot(instance)

// 保存旧的子 children，并更新 新的 children
const prevTree = instance.subTree
instance.subTree = nextTree

// reset refs
// only needed if previous patch had refs
if (instance.refs !== EMPTY_OBJ) {
    instance.refs = {}
}

// 对比新老 children
patch(
    prevTree,
    nextTree,
    // parent may have changed if it's in a teleport
    hostParentNode(prevTree.el!)!,
    // anchor may have changed if it's in a fragment
    getNextHostNode(prevTree),
    instance,
    parentSuspense,
    isSVG
)

// 更新 el
next.el = nextTree.el

// 更新 HOC 情况下，组件的 el
if (originNext === null) {
    updateHOCHostEl(instance, nextTree.el)
}

// 此时已经更新完成，所以处理组件的 updated 钩子，将其放入 post 任务队列中等待执行
if (u) {
    queuePostRenderEffect(u, parentSuspense)
}

// 所以处理 vnode 的 updated 钩子，将其放入 post 任务队列中等待执行
if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
    queuePostRenderEffect(() => {
    invokeVNodeHook(vnodeHook!, parent, next!, vnode)
    }, parentSuspense)
}
```  

#### updateHOCHostEl
这个函数用来更新通过 HOC 生成的那些组件的 `el` 属性；当一个组件被多个 HOC 包裹，并且在组件内部状态变化时，导致子节点发生了变化，这时候子组件的 `vnode.el` 会更新成功，但是上层 HOC 组件则不会自动更新，所以需要通过这个函数来做这件事  

```typescript
/**
 * @param { ComponentInternalInstance } 组件实例 
 * @param { typeof vnode.el } el 更新的真实节点 
 */
export function updateHOCHostEl(
    { vnode, parent }: ComponentInternalInstance,   // vnode 为当前组件，parent 为父组件
    el: typeof vnode.el
) {
    // 父组件存在，且当前 vnode 为父组件的子节点
    while (parent && parent.subTree === vnode) {
        // vnode 向上移动为父组件的 vnode，并更新 el
        ;(vnode = parent.vnode).el = el
        // parent 向上移动为父组件
        parent = parent.parent
    }
}

```  

具体使用可以参考 [示例](#HOC更新)  

# updateComponent  
这个函数用来更新一个组件，并且这种情况只会出现在父组件发生了更新，导致子组件更新  

```typescript
const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
    const instance = (n2.component = n1.component)!
    // 检测是否需要更新
    if (shouldUpdateComponent(n1, n2, optimized)) {
        if (
            __FEATURE_SUSPENSE__ &&
            instance.asyncDep &&
            !instance.asyncResolved
        ) {
            // 异步组件更新
            // async & still pending - just update props and slots
            // since the component's reactive effect for render isn't set-up yet
            updateComponentPreRender(instance, n2, optimized)
            return
        } else {
            // 普通组件更新
            // 将新 vnode 挂载在 next 上，之后在调用 instance.update() 中会用到
            instance.next = n2
            // in case the child component is also queued, remove it to avoid
            // double updating the same child component in the same flush.
            invalidateJob(instance.update)
            // 手动调用 update 函数来重新渲染
            instance.update()
        }
    } else {
        // 不需要更新，只是拷贝一些属性
        n2.component = n1.component
        n2.el = n1.el
        // 保证组件上的 vnode 为最新的 vnode
        instance.vnode = n2
    }
}
```  

可以看到，首先会通过 [shouldUpdateComponent](#shouldUpdateComponent) 函数来决定是否更新，如果一个组件的 props 没有发生任何变化，那么它就不应该被更新  

## shouldUpdateComponent  
这个函数用来检测一个组件是否需要更新  

```typescript

export function shouldUpdateComponent(
    prevVNode: VNode,
    nextVNode: VNode,
    optimized?: boolean
): boolean {
    const { props: prevProps, children: prevChildren, component } = prevVNode
    const { props: nextProps, children: nextChildren, patchFlag } = nextVNode
    const emits = component!.emitsOptions

    // 如果组件存在指令或者 transition，则会强制更新
    if (nextVNode.dirs || nextVNode.transition) {
        return true
    }

    if (optimized && patchFlag > 0) {
        if (patchFlag & PatchFlags.DYNAMIC_SLOTS) {
            // slot content that references values that might have changed,
            // e.g. in a v-for
            return true
        }
        if (patchFlag & PatchFlags.FULL_PROPS) {
            if (!prevProps) {
                return !!nextProps
            }
            // presence of this flag indicates props are always non-null
            return hasPropsChanged(prevProps, nextProps!, emits)
        } else if (patchFlag & PatchFlags.PROPS) {
            const dynamicProps = nextVNode.dynamicProps!
            for (let i = 0; i < dynamicProps.length; i++) {
                const key = dynamicProps[i]
                if (
                    nextProps![key] !== prevProps![key] &&
                    !isEmitListener(emits, key)
                ) {
                    return true
                }
            }
        }
    } else {
        // this path is only taken by manually written render functions
        // so presence of any children leads to a forced update
        if (prevChildren || nextChildren) {
            if (!nextChildren || !(nextChildren as any).$stable) {
                return true
            }
        }

        // 新老 props 没有发生变化，不需要更新
        if (prevProps === nextProps) {
            return false
        }

        // 老 props 不存在，是否更新取决于新 props 的值
        // 例如 h( Comp ) -> h( Comp, { name: 'IconMan' } )
        if (!prevProps) {
            return !!nextProps
        }

        // 老 props 存在，但是新 props 不存在，说明需要更新
        // 例如 h( Comp, { name: 'IconMan' } ) -> h( Comp )
        if (!nextProps) {
            return true
        }

        // 检查新老 props 里的值是否发生了变化
        return hasPropsChanged(prevProps, nextProps, emits)
    }

    return false
}
```    

## hasPropsChanged  
这个函数用来检测新老 `props` 是否发生了变化  

```typescript
function hasPropsChanged(
    prevProps: Data,
    nextProps: Data,
    emitsOptions: ComponentInternalInstance['emitsOptions']
): boolean {
    // 获取新 props 中的所有 key
    const nextKeys = Object.keys(nextProps)

    // 检测新老 props 的长度是否相同，不同的话说明有变化，需要更新
    if (nextKeys.length !== Object.keys(prevProps).length) {
        return true
    }

    // 遍历新 props，如果和旧 props 中的值不一致，且不是一个通过 emits 声明的事件，就会更新
    // 之所以会判断是否是事件，是因为事件的变化并不应该导致组件重新渲染
    for (let i = 0; i < nextKeys.length; i++) {
        const key = nextKeys[i]
        if (
            nextProps[key] !== prevProps[key] &&
            !isEmitListener(emitsOptions, key)
        ) {
            return true
        }
    }
    return false
}
```  


# 示例  

## HOC更新  

```typescript
const value = ref(true)
let parentVnode: VNode
let middleVnode: VNode
let childVnode1: VNode
let childVnode2: VNode

const Parent = {
    render: () => parentVnode = h(Middle)
}

const Middle = {
    render: () => middleVnode = h(Child)
}

const Child = {
    render: () => value.value
        ? (childVnode1 = h('div'))
        : (childVnode2 = h('span'))
}

const root = nodeOps.createElement('div')
render(h(Parent), root)

console.log(parentVnode!.el === childVnode1!.el); // true
console.log(middleVnode!.el === childVnode1!.el); // true

value.value = false
await nextTick()
console.log(parentVnode!.el === childVnode2!.el); // true
console.log(middleVnode!.el === childVnode2!.el); // true
```  

在更新 `Child` 时，已经运行完了 `div` 和 `span` 的 `patch`，接下来会执行 `next.el = nextTree.el` 来更新最新 `vnode` 的 el 为 `span`，接着就到了更新 HOC 上层组件的地方 [updateHOCHostEl](#updateHOCHostEl)  

1. 第一次循环：`vnode` 为 `Child`，`parent` 为 `Middle` 组件，此时 `Child` 的确是 `Middle` 的子节点，所以将 `vnode` 修改为 `Middle`，再将其 `el` 修改为 `span`，`parent` 向上移动为 `Parent`  
2. 第二次循环：`vnode` 为 `Middle`，`parent` 为 `Parent` 组件，此时 `Middle` 的确是 `Parent` 的子节点，所以将 `vnode` 修改为 `Parent`，再将其 `el` 修改为 `span`，`parent` 向上移动为 `null`，停止循环  

最终，将 `Middle` 和 `Parent` 两个 `vnode.el` 也指向了 `span`  
