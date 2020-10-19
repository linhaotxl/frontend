> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [processComponent](#processcomponent)
- [mountComponent](#mountcomponent)
    - [createComponentInstance](#createcomponentinstance)
    - [setupComponent](#setupcomponent)
    - [setupStatefulComponent](#setupstatefulcomponent)
    - [handleSetupResult](#handlesetupresult)
    - [finishComponentSetup](#finishcomponentsetup)

<!-- /TOC -->

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

## handleSetupResult  

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

## finishComponentSetup  

```typescript
function finishComponentSetup(
    instance: ComponentInternalInstance,
    isSSR: boolean
) {
    // 获取组件对象
    const Component = instance.type as ComponentOptions

    // template / render function normalization
    // 处理 template 和 render
    if (__NODE_JS__ && isSSR) {
        if (Component.render) {
            instance.render = Component.render as InternalRenderFunction
        }
    } else if (!instance.render) {
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

    // support for 2.x options
    if (__FEATURE_OPTIONS_API__) {
        currentInstance = instance
        applyOptions(instance, Component)
        currentInstance = null
    }
}
```