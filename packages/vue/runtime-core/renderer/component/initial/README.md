> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [源码中用到的工具函数](#源码中用到的工具函数)
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

<!-- /TOC -->

# 源码中用到的工具函数  
1. [invokeArrayFns](#invokeArrayFns)  
2. [invokeVNodeHook](#invokeVNodeHook)  

# processComponent  
这个函数是组件的入口函数，用来处理组件的挂载或者更新  

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
这个函数用来挂载组件，主要做三件事  
1. 创建组件实例  
2. 安装组件  
3. 设置更新函数  

```typescript
const mountComponent: MountComponentFn = (
    initialVNode,       // 组件的 vnode
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

    // 处理 keepAlive
    // inject renderer internals for keepAlive
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

    // 这是组件的渲染函数
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

```typescript
// 组件索引，每次创建一个组件会 + 1
let uid = 0

export function createComponentInstance(
  vnode: VNode,                                 // 组件 vnode
  parent: ComponentInternalInstance | null,     // 父组件实例
  suspense: SuspenseBoundary | null
) {
    // 组件对象
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
        subTree: null!,   // 组件的子节点 vnode
        update: null!,    // 组件的更新函数
        render: null,     // 组件的渲染函数
        proxy: null,      // 对 ctx 的代理，代理 handler 是 PublicInstanceProxyHandlers
        withProxy: null,  // 对 ctx 的代理，并且只有当组件的 render 函数是由模板编译生成时才会设置，代理 handler 是 RuntimeCompiledPublicInstanceProxyHandlers
        effects: null,
        // provides 继承自父组件，如果是根组件的话，会继承 context 中的 provides
        provides: parent ? parent.provides : Object.create(appContext.provides),
        accessCache: null!, // 缓存访问属性的来源，是 setupState、data、props 还是 ctx
        renderCache: [],

        // local resovled assets
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

`props` 的解析函数 [normalizePropsOptions](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/ComponentProps.md#normalizepropsoptions) 有介绍  

## setupComponent  
注册组件，初始化 `props`、`slots`，如果是状态组件，则再处理组件内部的逻辑，如果是函数组件，则什么也不会做  

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

    // 如果是状态组件，则调用 setupStatefulComponent 安装状态组件，如果是函数组件则什么也不做
    // 且只有是异步组件时，才会返回值
    const setupResult = isStateful
        ? setupStatefulComponent(instance, isSSR)
        : undefined
    
    isInSSRComponentSetup = false
    
    return setupResult
}
```  

初始化 `props` 的函数 [initProps](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/ComponentProps.md#initprops) 在这里有介绍  
初始化 `slots` 的函数 [initSlots](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/ComponentSlots.md#initSlots) 在这里有介绍  

## setupStatefulComponent  
注册状态组件，主要就是调用 `setup` 函数并处理返回结果  

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
        const setupContext = (instance.setupContext = ?
            createSetupContext(instance)
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

        // 检测 setup 返回值是否 Promise
        if (isPromise(setupResult)) {
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
`setup` 的返回值有两种类型  
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

**如果 setup 返回对象作为状态时，实际会被代理，而代理lan**

## finishComponentSetup  
这个函数用来设置组件实例的渲染函数 `render`，在渲染节点的时候调用的是组件实例上的渲染函数 `render`  
* 如果组件实例上不存在 `render`，那么就会从组件对象上获取（ 通过模板生成或者本身就存在渲染函数 ）  
* 如果组件实例上存在 `render`，那么就是 `setup` 返回了函数，在 [handleSetupResult](#handleSetupResult) 就已经将 `render` 挂载在组件实例上了  

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
        // 只有 setup 返回函数 这种情况，才不会进入这个 if 中
        
        if (compile && Component.template && !Component.render) {
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
每个组件实例上存在一个 `update` 属性，它是组件的更新函数，会执行组件的渲染函数 `render`，将结果挂载到真实节点上，并且会在特定时期，执行钩子函数  

`update` 实际上是一个 [effect](https://github.com/linhaotxl/frontend/blob/master/packages/vue/reactivity/effect/README.md#effect) 对象，而真正更新的逻辑是放在回调里的  

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

    // 处理组件的 beforeMount 钩子，这里是同步执行
    if (bm) {
        invokeArrayFns(bm)
    }

    // 处理 vnode 的 beforeMount 钩子，这里是同步执行
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
        // 对子节点开始处理，从 patch 开始
        patch(
            null,       // 这里是挂载，所以旧节点写死为 null
            subTree,    
            container,  // 将 subTree 挂载到 container 上
            anchor,   
            instance,   // 当前组件作为子节点的父组件
            parentSuspense,
            isSVG
        )

        // 这里已经将所有的子节点都创建完成
        // 将子节点的真实节点 el 挂载在组件上，组件 vnode 的 el 就是子节点的 el
        initialVNode.el = subTree.el
    }

    // 处理组件的 onMounted 钩子，这里不会立即执行，而是将其放在队列中，等到下一轮微任务再去执行队列
    if (m) {
        queuePostRenderEffect(m, parentSuspense)
    }

    // 处理 vnode 的 onMounted 钩子，这里不会立即执行，而是将其放在队列中，等到下一轮微任务再去执行队列
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