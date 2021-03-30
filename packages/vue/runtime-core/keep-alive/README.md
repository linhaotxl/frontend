> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [KeepAlive 基本介绍](#keepalive-基本介绍)
- [KeepAlive 组件流程](#keepalive-组件流程)
- [KeepAlive 实现](#keepalive-实现)
    - [检测是否是 KeepAlive 组件](#检测是否是-keepalive-组件)
    - [KeepAlive 组件](#keepalive-组件)
        - [setup](#setup)
            - [getInnerChild](#getinnerchild)
        - [render](#render)
        - [禁用函数 deactivate](#禁用函数-deactivate)
        - [激活函数 activate](#激活函数-activate)
        - [卸载函数 unmount](#卸载函数-unmount)
        - [重置 ShapFlag](#重置-shapflag)
        - [pruneCache](#prunecache)
        - [pruneCacheEntry](#prunecacheentry)
        - [matches](#matches)
        - [卸载 KeepAlive 组件](#卸载-keepalive-组件)
    - [激活和禁用生命周期](#激活和禁用生命周期)
        - [注册钩子函数](#注册钩子函数)

<!-- /TOC -->

# KeepAlive 基本介绍  
`Keepalive` 就是一个普通的组件，所以它被挂载的时候，会执行 [mountComponent]() 来挂载  
这里面会向 `KeepAlive` 的作用域上注入渲染的内部方法，在之后会用到  

```typescript
const mountComponent: MountComponentFn = {
    // ...

    // 如果是 KeepAlive 的 vnode，则向作用域 ctx 上注入渲染器属性 renderer
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // ...
}
```

# KeepAlive 组件流程  

当一个组件 A 是 `keep-alive` 的子节点时，它就拥有了两个生命周期： **激活** 和 **禁用**  
* 当 A 第一次挂载成功后，如果之后需要卸载，则不会将 A 真正卸载的，而是使 A 进入 ”禁用“ 状态  
    “禁用” 是指将 A 移动到 `keep-alive` 自身产生的一个容器(`storageContainer`)内，并执行禁用的钩子函数  
* 当 A 再次渲染时，不会将 A 再次挂载一遍，而是使 A 进入 “激活” 状态  
    “激活” 是值将 A 从 `storageContainer` 移动到真实容器中，并执行激活的钩子函数  


# KeepAlive 实现  

## 检测是否是 KeepAlive 组件  

```typescript
// 带有 __isKeepAlive 属性被视为 KeepAlive 组件
export const isKeepAlive = (vnode: VNode): boolean => (vnode.type as any).__isKeepAlive
```

## KeepAlive 组件  

```typescript
const KeepAliveImpl = {
    name: `KeepAlive`,

    __isKeepAlive: true,

    inheritRef: true,

    props: {
        include: [String, RegExp, Array],
        exclude: [String, RegExp, Array],
        max: [String, Number]
    },

    setup(props: KeepAliveProps, { slots }: SetupContext) {
        // ...
    }
}
```

`KeepAlive` 组件总共接受三个参数，如下  

```typescript
type MatchPattern = string | RegExp | string[] | RegExp[]

export interface KeepAliveProps {
    include?: MatchPattern
    exclude?: MatchPattern
    max?: number | string
}
```

`include`: 需要缓存组件名称白名单，如果是 `string` 可以用 `,` 表示多个组件  
`exclude`: 需要缓存组件名称黑名单，如果是 `string` 可以用 `,` 表示多个组件  
`max`: 缓存组件个数的最大值，如果超出了这个值，则会根据 `LRU` 先删除再添加缓存  

### setup  

```typescript

setup(props: KeepAliveProps, { slots }: SetupContext) {
    // 1. 创建缓存对象 cache，以及缓存组件 key 的集合
    const cache: Cache = new Map()
    const keys: Keys = new Set()
    
    // 2. 声明当前缓存组件的 vnode
    let current: VNode | null = null

    // 3. 获取当前组件实例，即 KeepAlive 组件的实例
    const instance = getCurrentInstance()!
    // 4. 获取组件所在的 suspense context
    const parentSuspense = instance.suspense

    // 5. 解析渲染器方法
    const sharedContext = instance.ctx as KeepAliveContext
    const {
        renderer: {
            p: patch,
            m: move,
            um: _unmount,
            o: { createElement }
        }
    } = sharedContext

    // 6. 创建容器节点
    const storageContainer = createElement('div')

    // 7. 创建激活函数，重新激活时调用
    sharedContext.activate = (vnode, container, anchor, isSVG, optimized) => { /* ... */ }

    // 8. 创建禁用函数，卸载时调用
    sharedContext.deactivate = (vnode: VNode) => { /* ... */ }

    // 9. 封装卸载函数
    function unmount(vnode: VNode) { /* ... */ }

    // 10. 删除缓存函数
    function pruneCache(filter?: (name: string) => boolean) { /* ... */ }

    // 11. 删除缓存中具体的组件函数
    function pruneCacheEntry(key: CacheKey) { /* ... */ }

    // 12. 观察 include 和 exclude 两个属性，当它们发生变化时，修改缓存的数据
    //     这里刷新的方法采用 post 异步刷新，因为回调里要用到 current，所以必须等到 render 结束完之后
    watch(
        () => [props.include, props.exclude],
        ([include, exclude]) => {
            // 删除当前缓存中，不存在于 include 中的组件
            include && pruneCache(name => matches(include, name))
            // 删除当前缓存中，存在于 exclude 中的组件
            exclude && pruneCache(name => !matches(exclude, name))
        },
        { flush: 'post', deep: true }
    )

    // 13. 等待缓存的 key
    let pendingCacheKey: CacheKey | null = null
    // 14. 缓存组件
    const cacheSubtree = () => {
        // fix #1621, the pendingCacheKey could be 0
        if (pendingCacheKey != null) {
            cache.set(pendingCacheKey, getInnerChild(instance.subTree))
        }
    }

    // 15. 挂载挂载完成的钩子
    onMounted(cacheSubtree)
    // 16. 挂载更新完成钩子
    onUpdated(cacheSubtree)
    // 17. 挂载卸载前的钩子
    onBeforeUnmount(() => { /* ... */ });

    // 18. render
    return () => { /* ... */ }
}
```

**集合 `keys` 里的每个元素，是会按照使用的时间排序的，越往前说明使用时间距离现在越远，越往后说明使用时间距离现在越近，在后面会看到具体的使用方法**  

在这里，主要先看 13 - 16 几个步骤，`pendingCacheKey` 的意义就是等待缓存的 `key`，这个值会在 `render` 时被赋值，但也有可能赋值为 `null`  
例如当前这个组件不需要缓存，或者根本就不是一个组件，此时 `pendingCacheKey` 就是 `null` 了  

在 15、16 中，挂载、更新完成之后会执行 `cacheSubtree`  
当在挂载、更新 `KeepAlive` 组件时，会执行渲染函数，并将渲染结果赋值给了 `KeepAlive.subTree`  
所以在 `cacheSubtree` 中会直接缓存 `KeepAlive.subTree` 的结果  

#### getInnerChild  
这个函数主要处理的是 `Suspense` 组件，如果是 `Suspense` 组件的话，那么缓存的就是 `default` 插槽的组件了  

```typescript
function getInnerChild(vnode: VNode) {
    return vnode.shapeFlag & ShapeFlags.SUSPENSE ? vnode.ssContent! : vnode
}
```

接下来先看 `render` 函数，看完之后再回来看上面定义的函数作用  

### render  

```typescript
return () => {
    // 1. 每次更新都需要将 pendingCacheKey 重置，因为不知道当前渲染的 vnode 是否需要缓存
    pendingCacheKey = null

    // 2. 检测 slots 中是否存在 default 插槽，不存在直接返回 null
    if (!slots.default) {
        return null
    }

    // 3. 获取 KeepAlive 唯一的子节点
    const children = slots.default()
    const rawVNode = children[0]

    // 4. 检测子节点个数，如果 > 1，抛出警告
    //    此时依旧会返回所有 children，只不过不会缓存任何 vnode 了
    if (children.length > 1) {
        if (__DEV__) {
          warn(`KeepAlive should contain exactly one component child.`)
        }
        // TODO: 
        current = null
        return children
    }
    // 5. 只有当子节点是 Suspense 组件，或者是 Stateful Component 时，才会执行接下来的缓存操作
    //    文本、元素、函数组件都会进入这个 if，不会缓存
    else if (
        !isVNode(rawVNode) ||
        (!(rawVNode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) &&
          !(rawVNode.shapeFlag & ShapeFlags.SUSPENSE))
    ) {
        current = null
        return rawVNode
    }

    // 6. 获取处理过后的子节点
    let vnode = getInnerChild(rawVNode)
    // 7. 获取组件对象
    const comp = vnode.type as ConcreteComponent
    // 8. 获取子组件名称
    const name = getComponentName(comp)

    // 9. 获取 KeepAlive 的 props
    const { include, exclude, max } = props

    // 10. 检测当前组件是否需要缓存
    if (
        (include && (!name || !matches(include, name))) ||
        (exclude && name && matches(exclude, name))
      ) {
        current = vnode
        return rawVNode
    }

    // 11. 获取组件缓存的 key
    const key = vnode.key == null ? comp : vnode.key
    // 12. 根据缓存 key 从缓存中获取数据
    const cachedVNode = cache.get(key)

    // 13. TODO: 
    if (vnode.el) {
        vnode = cloneVNode(vnode)
        if (rawVNode.shapeFlag & ShapeFlags.SUSPENSE) {
            rawVNode.ssContent = vnode
        }
    }

    // 14. 更新 pendingCacheKey，此时已经确定组件 comp 是需要缓存的
    pendingCacheKey = key

    // 15. 检查缓存数据是否存在
    if (cachedVNode) {
        /* ... */
    } else {
        /* ... */
    }

    // 16. 为节点增加 COMPONENT_SHOULD_KEEP_ALIVE，这样 vnode 在被激活、禁用时才会触发相应的钩子函数
    vnode.shapeFlag |= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE

    // 17. 更新当前缓存的节点
    current = vnode

    // 18. 返回原始节点
    return rawVNode
}
```

接下来对上面几个重要步骤详细说明  
1. 第 *10* 步，主要在检测当前 vnode 是否需要缓存  
    ```typescript
    if (
        (include && (!name || !matches(include, name))) ||  // 不存在名称，或者名称不存在于 include 中
        (exclude && name && matches(exclude, name))         // 名称存在于 exclude 中
    ) {
        current = vnode
        return rawVNode
    }
    ```
    上面的注释标注的是不会缓存组件的情况，还需要额外注意的情况是  
    * 如果没有提供 `include` 和 `exclude`，则会缓存所有组件  
    * 如果 `include` 和 `exclude` 同时包含一个组件，则也不会缓存  
2. *15* 步检查缓存结果  

    ```typescript
    if (cachedVNode) {
        // 15.1 如果能从缓存中获取数据，则复用状态(真实节点，组件实例)
        vnode.el = cachedVNode.el
        vnode.component = cachedVNode.component
        // 15.2
        if (vnode.transition) {
            // recursively update transition hooks on subTree
            setTransitionHooks(vnode, vnode.transition!)
        }
        // 15.3 为子节点增加 COMPONENT_KEPT_ALIVE
        // 这样当之后再次挂载时，是不会重新创建的，直接会执行 active 方法，将其激活
        vnode.shapeFlag |= ShapeFlags.COMPONENT_KEPT_ALIVE
        // 15.4 更新组件的 key 为最新
        keys.delete(key)
        keys.add(key)
    } else {
        // 15.5 如果能从缓存中没有获取到数据，则存储 key
        keys.add(key)
        // 15.6 检测新挂载的节点是否超出了最大限制，如果超出了就删除
        if (max && keys.size > parseInt(max as string, 10)) {
            pruneCacheEntry(keys.values().next().value)
        }
    }
    ```
    重点要注意的是 *15.4*，能进入这里就说明，当前 `key` 对应的组件是 `KeepAlive` 最新一次需要展示并缓存的组件  
    前面说过 `keys` 是按照使用时间排序的，最新的一次应该在最后面，所以需要先删除在添加  
    至于为什么要这样做，答案就在 `else` 里  
    

注意 *15.6*，当需要缓存一个新的组件时，如果已经缓存的个数，超过了最大值 `max`，那么此时就需要删除一个  
    至于要删除哪一个，就是删除最不经常使用的那个，也就是 `keys` 里的第一个，通过 `keys.values().next().value` 获取到的每次都是第一个元素  


### 禁用函数 deactivate  
当一个组件卸载时，会进入 [unmount]() 函数，由于组件已经被标记为 `COMPONENT_SHOULD_KEEP_ALIVE`，所以会被禁用而不是卸载  

```typescript
const unmount: UnmountFn = () => {
    /* ... */
    
    // 调用组件作用域上的 禁用方法
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
        return
    }

    /* ... */
}
```

接下来看具体实现  

```typescript
sharedContext.deactivate = (vnode: VNode) => {
    // 1. 获取组件实例对象
    const instance = vnode.component!
    // 2. 将禁用的 vnode 移动到 storageContainer 中
    move(vnode, storageContainer, null, MoveType.LEAVE, parentSuspense)
    // 3. 向异步队列中添加任务
    queuePostRenderEffect(() => {
        // 3.1 执行组件的 deactive 钩子函数
        if (instance.da) {
            invokeArrayFns(instance.da)
        }
        // 3.2 执行 vnode 的 onVnodeUnmounted 钩子函数
        const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted
        if (vnodeHook) {
            invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
        // 3.3 标记组件状态已禁用
        instance.isDeactivated = true
    }, parentSuspense)
}
```

**禁用的钩子函数都是在异步中执行的**  

### 激活函数 activate  
当一个组件第二次挂载，进入 [processComponent]() 函数时，由于组件已被标记为 `COMPONENT_KEPT_ALIVE`，所以会激活而不是重新挂载  

```typescript
const processComponent = ( /* ... */ ) => {
    if (n1 == null) {
        if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
            ;(parentComponent!.ctx as KeepAliveContext).activate(
                n2,
                container,
                anchor,
                isSVG,
                optimized
            )
        } else {
            mountComponent( /* ... */ )
        }
    }
}
```

接下来看具体实现  

```typescript
sharedContext.activate = (vnode, container, anchor, isSVG, optimized) => {
    // 1. 获取组件实例
    const instance = vnode.component!
    // 2. 将 vnode 从 storageContainer 移动到真实的容器 container 中
    move(vnode, container, anchor, MoveType.ENTER, parentSuspense)
    // 3. 比较新老 vnode 是否发生了变化
    patch(
        instance.vnode,
        vnode,
        container,
        anchor,
        instance,
        parentSuspense,
        isSVG,
        optimized
    )
    // 4. 向异步队列中添加任务
    queuePostRenderEffect(() => {
        // 4.1 标记组件状态已激活
        instance.isDeactivated = false
        // 4.2 执行 active 钩子函数
        if (instance.a) {
            invokeArrayFns(instance.a)
        }
        // 4.3 执行 vnode 的 onVnodeMounted 钩子函数
        const vnodeHook = vnode.props && vnode.props.onVnodeMounted
        if (vnodeHook) {
            invokeVNodeHook(vnodeHook, instance.parent, vnode)
        }
    }, parentSuspense)
}
```

**激活的钩子函数都是在异步中执行的**  

### 卸载函数 unmount  
这里会对原始的 [卸载函数]() 进行封装，之所以要封装，是因为 `vnode` 上还存在 `COMPONENT_SHOULD_KEEP_ALIVE`，所以调用原始卸载函数前需要删除，不删除的话是不会卸载成功的  

```typescript
// 封装卸载函数
function unmount(vnode: VNode) {
    // 重置 ShapFlag
    resetShapeFlag(vnode)
    // 调用原始的卸载函数卸载
    _unmount(vnode, instance, parentSuspense) // 这里并没有实际删除节点
}
```

### 重置 ShapFlag  
这个函数仅仅是将两种 `ShapFlag`(`COMPONENT_SHOULD_KEEP_ALIVE` 和 `COMPONENT_KEPT_ALIVE`) 分别移除  

```typescript
function resetShapeFlag(vnode: VNode) {
    let shapeFlag = vnode.shapeFlag
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
        shapeFlag -= ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
    }
    if (shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        shapeFlag -= ShapeFlags.COMPONENT_KEPT_ALIVE
    }
    vnode.shapeFlag = shapeFlag
}
```

### pruneCache  
这个函数用来删除缓存中的数据，接受一个过滤函数作为参数，当组件名称不满足过滤函数时，就会删除  
这个函数只有当 `include` 或者 `exclude` 被修改时才会调用  

例如下面这个场景就会用到这个函数  

```typescript
const views = {
    one: {},
    two: {},
}
const viewRef = ref('one');
const includeRef = ref('one,two');

// 渲染 one 并缓存
render(
    h(
        KeepAlive,
        { include: includeRef.value },
        () => h(views[viewRef.value]),
    )
);

// 渲染 two 并缓存
viewRef.value = 'two';

// 从 include 中删除 one，修改了 KeepAlive 的 props，就会进入 watch 的回调
includeRef.value = 'two';
```

接下来看源码  

```typescript
function pruneCache(filter?: (name: string) => boolean) {
    // 遍历 cache，并获取当前组件的名称 name，如果 name 不满足 filter 则会删除这个组件
    cache.forEach((vnode, key) => {
        const name = getComponentName(vnode.type as ConcreteComponent)
        if (name && (!filter || !filter(name))) {
            pruneCacheEntry(key)
        }
    })
}
```

**注意，如果这个组件没有名称，则是不会删除它的**  

### pruneCacheEntry  
这个函数用来删除指定 key 对应的缓存数据  

```typescript
function pruneCacheEntry(key: CacheKey) {
    // 1. 根据 key 从缓存中读取数据
    const cached = cache.get(key) as VNode
    // 2. 检测需要 删除的组件 和 当前展示的组件 是否一致
    if (!current || cached.type !== current.type) {
        // 2.1 不一致，则先卸载指定组件
        unmount(cached)
    } else if (current) {
        // 2.2 如果 删除的组件 和 当前展示的组件 一致，则说明当前组件已经不存在于 KeepAlive 中
        // 即不存在于 include 列表中，或者已经存在于 exclude 列表中
        // 所以需要将其 shapFlag 删除，并删除缓存中的数据
        resetShapeFlag(current)
    }
    // 3. 删除 key 的相关缓存
    cache.delete(key)
    keys.delete(key)
}
```

例如下面这个是 *2.2* 的场景  
```typescript
const views = {
    one: {},
    two: {},
}
const viewRef = ref('one');
const includeRef = ref('one,two');

// 渲染 one 并缓存
render(
    h(
        KeepAlive,
        { include: includeRef.value },
        () => h(views[viewRef.value]),
    )
);

// 更新 include，此时缓存中的 one 已经不在 include 里了，而当前展示的组件也是 one
// 所以需要将 one 恢复为普通组件，重置 Shapflag
includeRef.value = 'two';
```

### matches  
这个函数用来检测组件名称是否满足 `include` 和 `exclude` 的规则  

```typescript
function matches(pattern: MatchPattern, name: string): boolean {
    if (isArray(pattern)) {
        // 对每个元素再次调用 matches 方法，当元素返回 true 时，整个方法返回 true
        return pattern.some((p: string | RegExp) => matches(p, name))
    } else if (isString(pattern)) {
        // 字符串，根据 , 分割为数组，检测 name 是否存在于数组中
        return pattern.split(',').indexOf(name) > -1
    } else if (pattern.test) {
        // 正则：匹配成功即可
        return pattern.test(name)
    }
    // 剩余情况都返回 false，代表匹配失败
    return false
}
```  

### 卸载 KeepAlive 组件  
当卸载 `KeepAlive` 组件时，会进入到 `onBeforeUnmount` 钩子函数  
因为 `KeepAlive` 组件都卸载了，所以缓存的那些组件也需要卸载  

```typescript
onBeforeUnmount(() => {
    // 遍历所有缓存的组件，如果和当前展示的不是一个组件，那么就卸载它
    // 如果和展示的一致，则恢复为普通组件，并且调用 deactive 钩子
    cache.forEach(cached => {
        const { subTree, suspense } = instance
        const vnode = getInnerChild(subTree)
        if (cached.type === vnode.type) {
            // 重置 Shapflag 为普通组件
            resetShapeFlag(vnode)
            const da = vnode.component!.da
            da && queuePostRenderEffect(da, suspense)
            return
        }
        unmount(cached)
    })
})
```  

## 激活和禁用生命周期  
被 `KeepAlive` 缓存的组件会增加这两个生命周期，当然，也就有对应的钩子函数  
先来看看它们什么时候会被调用  
* `active`(激活)：
    1. 第一次挂载成功之后，在执行完 `mounted` 后紧接着就会执行 `active`  
        ```typescript
        const setupRenderEffect: SetupRenderEffectFn = ( /* ... */ ) => {
            instance.update = effect(function componentEffect() {
                if (!instance.isMounted) {
                    /* ... */
                    patch( /* ... */ );
                    // 将 mounted 钩子函数入队
                    if (m) {
                        queuePostRenderEffect(m, parentSuspense)
                    }
                    // 将 active 钩子函数入队，必须带有 COMPONENT_SHOULD_KEEP_ALIVE，这个会在 KeepAlive render 是带上
                    const { a } = instance
                    if (
                        a &&
                        initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
                    ) {
                        queuePostRenderEffect(a, parentSuspense)
                    }
                } else { /* ... */ }
            }
        }
        ```  
    2. 激活时会调用，参考 [激活函数](#激活函数-activate)  
* `deactive`(禁用)  
    1. 禁用时调用，参考 [禁用函数](#禁用函数-deactivate)  
    2. 卸载 `KeepAlive` 时，当前正在展示的组件也会被调用，参考 [卸载KeepAlive](#卸载-KeepAlive-组件)

### 注册钩子函数  

先来看注册 `activate` 和 `deactivate` 的函数  

```typescript
export function onActivated(
    hook: Function,
    target?: ComponentInternalInstance | null
) {
    registerKeepAliveHook(hook, LifecycleHooks.ACTIVATED, target)
}

export function onDeactivated(
    hook: Function,
    target?: ComponentInternalInstance | null
) {
    registerKeepAliveHook(hook, LifecycleHooks.DEACTIVATED, target)
}
```  

它们都用了一个方法，只不过传递的 `type` 不一样，接下来再看这个函数做了什么  

```typescript
function registerKeepAliveHook(
    hook: Function & { __wdc?: Function },
    type: LifecycleHooks,
    target: ComponentInternalInstance | null = currentInstance
) {
    // 1. 封装原始的 hooks 函数
    const wrappedHook =
        hook.__wdc ||
        (hook.__wdc = () => {
            // 当前组件只有在全是 actived 树下，才会执行钩子函数，如果上层出现了禁用的组件，则不会执行
            let current: ComponentInternalInstance | null = target
            while (current) {
                if (current.isDeactivated) {
                    return
                }
                current = current.parent
            }
            hook()
        })
        
    // 2. 注册钩子函数
    injectHook(type, wrappedHook, target)

    // 3. 如果上层组件是 KeepAlive，则会向上层 KeepAlive 注入钩子函数
    if (target) {
        let current = target.parent
        while (current && current.parent) {
            if (isKeepAlive(current.parent.vnode)) {
                // 注入到 KeepAlive 的子组件中
                injectToKeepAliveRoot(wrappedHook, type, target, current)
            }
            current = current.parent
        }
    }
}
```  

接下来对几个点详情介绍  
1. 在封装原始 `hook` 时，如果当前组件 A 的上层 B 已经被禁用了，那么此时 A 也就不在真实节点中了，所以钩子函数按理来说也不该触发  
2. 如果 `KeepAlive` 的子组件 A 又嵌套了组件 B，B 又嵌套了组件 C，那么当 A 激活时，C 也需要执行 `activate` 钩子函数(禁用同理)  
    所以会向上层查找到 B，将封装好的 `hook` 函数再次注入到 B 里，而且是在 B 组件里最开始的位置(因为无论是激活还是禁用，应该都是先触发子节点，再触发父节点)  

接下来看 `injectToKeepAliveRoot` 的实现  

```typescript
function injectToKeepAliveRoot(
    hook: Function & { __weh?: Function },      // hook 函数
    type: LifecycleHooks,                       // hook 类型
    target: ComponentInternalInstance,          // 实际注入的组件
    keepAliveRoot: ComponentInternalInstance    // KeepAlive 的子组件
) {
    // 将 hook 注入到 KeepAlive 子组件中，并且在 hook 中的第一个
    const injected = injectHook(type, hook, keepAliveRoot, true /* prepend */)
    // 当前组件卸载时，从 KeepAlive 的子组件中移除注入的钩子函数
    onUnmounted(() => {
        remove(keepAliveRoot[type]!, injected)
    }, target)
}
```  
