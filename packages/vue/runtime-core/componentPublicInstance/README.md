**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [AccessTypes](#accesstypes)
- [accessCache](#accesscache)
- [proxy](#proxy)
- [PublicInstanceProxyHandlers](#publicinstanceproxyhandlers)
    - [publicPropertiesMap](#publicpropertiesmap)
    - [get](#get)
    - [set](#set)
    - [has](#has)
- [示例](#示例)
    - [getter 和 setter](#getter-和-setter)

<!-- /TOC -->

# AccessTypes  
当在组件的 `template` 或者 `render` 里使用某个属性时，会标记这个属性的来源，是来自于 `setupState` 还是 `props` 等，在源码中使用 `AccessTypes` 来标记不同的来源  

```typescript
const enum AccessTypes {
    SETUP,      // setup state
    DATA,       // data
    PROPS,      // props
    CONTEXT,    // ctx
    OTHER       // 除上面的情况
}
```  

# accessCache  
在每个组件实例上存在 `accessCache` 这个属性，它的类型是 `Record<string, AccessTypes>` 这样的对象，保存的 `key` 是具体访问的属性名，而 `value` 是这个属性的来源，当访问一个属性时，会先从 `accessCache` 中查找是否记录了来源，如果有，则直接从指定的来源中获取数据，如果没有，则依次从不同的来源中查找  

# proxy  
在组件实例上存在属性 `ctx`，其中存在 `_` 属性执行自身实例  

```typescript
export function createComponentInstance (
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null
) {
    const instance: ComponentInternalInstance = { /* ... */ }

    instance.ctx = { _: instance }

    return instance
}
```  

对于每一个状态组件会存在 `proxy` 属性，它对上面的 `ctx` 做了一个代理  

```typescript
function setupStatefulComponent(
  instance: ComponentInternalInstance,
  isSSR: boolean
) {
    /* ... */
    // 创建访问缓存对象
    instance.accessCache = {}

    // 对 ctx 进行代理
    instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
    /* ... */
}
```

这个 `proxy` 对象主要用于组件的 `render` 方法中  

# PublicInstanceProxyHandlers  

## publicPropertiesMap  

```typescript
const publicPropertiesMap: PublicPropertiesMap = extend(Object.create(null), {
    $: i => i,
    $el: i => i.vnode.el,
    $data: i => i.data,
    $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
    $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
    $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
    $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
    $parent: i => i.parent && i.parent.proxy,
    $root: i => i.root && i.root.proxy,
    $emit: i => i.emit,
    $options: i => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
    $forceUpdate: i => () => queueJob(i.update),
    $nextTick: () => nextTick,
    $watch: i => (__FEATURE_OPTIONS_API__ ? instanceWatch.bind(i) : NOOP)
} as PublicPropertiesMap)
```

## get  

```typescript
get({ _: instance }: ComponentRenderContext, key: string) {
    const {
        ctx,
        setupState,
        data,
        props,
        accessCache,
        type,
        appContext
    } = instance

    // let @vue/reactivity know it should never observe Vue public instances.
    if (key === ReactiveFlags.SKIP) {
        return true
    }

    let normalizedProps

    // 处理不是以 $ 开头的属性
    if (key[0] !== '$') {
        // 获取访问来源缓存，如果已经有来源，则直接从不同来源获取数据并返回
        const n = accessCache![key]
        if (n !== undefined) {
            switch (n) {
                case AccessTypes.SETUP:
                    return setupState[key]
                case AccessTypes.DATA:
                    return data[key]
                case AccessTypes.CONTEXT:
                    return ctx[key]
                case AccessTypes.PROPS:
                    return props![key]
                // default: just fallthrough
            }
        } else if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
            // 获取的 key 存在于 setupState 中，在 accessCache 中标记 key 的来源是 setupState，并从 setupState 获取数据返回
            accessCache![key] = AccessTypes.SETUP
            return setupState[key]
        } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
            // 获取的 key 存在于 data 中，在 accessCache 中标记 key 的来源是 data，并从 data 获取数据返回
            accessCache![key] = AccessTypes.DATA
            return data[key]
        } else if (
            // propsOptions[0] 是组件已声明 props 的配置对象集合，所以要从配置对象中检测是否存在于 props 中
            (normalizedProps = instance.propsOptions[0]) &&
            hasOwn(normalizedProps, key)
        ) {
            // 获取的 key 存在于 props 中，在 accessCache 中标记 key 的来源是 props，并从 props 获取数据返回
            accessCache![key] = AccessTypes.PROPS
            return props![key]
        } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
            // 获取的 key 存在于 ctx 中，在 accessCache 中标记 key 的来源是 ctx，并从 ctx 获取数据返回
            accessCache![key] = AccessTypes.CONTEXT
            return ctx[key]
        } else if (!__FEATURE_OPTIONS_API__ || !isInBeforeCreate) {
            accessCache![key] = AccessTypes.OTHER
        }
    }

    // 能执行到这里说明访问的属性是一下几种情况
    // 1. 内置属性，例如 $attrs  
    // 2. 非内置属性，例如 $store
    // 3. 存在于全局的 globalProperties 中的属性，此时在上面几种情况都无法找到，所以会运行到这里继续查找

    // 内置属性获取的 getter 方法
    const publicGetter = publicPropertiesMap[key]
    let cssModule, globalProperties

    // 如果 getter 存在，则直接调用并获取
    if (publicGetter) {
        if (key === '$attrs') {
            // TODO: 为什么需要 track
            track(instance, TrackOpTypes.GET, key)
        }
        return publicGetter(instance)
    } else if (
        // css module (injected by vue-loader)
        (cssModule = type.__cssModules) &&
        (cssModule = cssModule[key])
    ) {
        return cssModule
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        // 这里的 key 是以 $ 开头的自定义属性，例如 $store
        // 获取的 key 存在于 ctx 中，在 accessCache 中标记 key 的来源是 ctx，并从 ctx 获取数据返回
        accessCache![key] = AccessTypes.CONTEXT
        return ctx[key]
    } else if (
        // 检查获取的 key 是否存在于全局的 globalProperties 中
        ((globalProperties = appContext.config.globalProperties),
        hasOwn(globalProperties, key))
    ) {
        // 获取的 key 存在于 globalProperties 中，直接从中获取数据返回
        return globalProperties[key]
    } else if (
        __DEV__ &&
        currentRenderingInstance &&
        (!isString(key) ||
        // #1091 avoid internal isRef/isVNode checks on component instance leading
        // to infinite warning loop
        key.indexOf('__v') !== 0)
    ) {
        if (
            data !== EMPTY_OBJ &&
            (key[0] === '$' || key[0] === '_') &&
            hasOwn(data, key)
        ) {
            warn(
                `Property ${JSON.stringify(
                key
                )} must be accessed via $data because it starts with a reserved ` +
                `character ("$" or "_") and is not proxied on the render context.`
            )
        } else {
            warn(
                `Property ${JSON.stringify(key)} was accessed during render ` +
                `but is not defined on instance.`
            )
        }
    }
}
```

## set  

```typescript
/**
 * 为 proxy 设置值
 * @param { ComponentRenderContext } 组件的 ctx 对象
 * @param { string } key 设置的 key
 * @param { any } value 设置的 value
 */
set( { _: instance }: ComponentRenderContext, key: string, value: any ): boolean {
    const { data, setupState, ctx } = instance

    // 检测是否存在 setupState，并且是否含有设置的 key，如果存在，那么会更新 setupState 中的值
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
        setupState[key] = value
    }
    // 检测是否存在 data key，如果存在，那么会更新 data 中的值
    else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        data[key] = value
    }
    // 检测 key 是否存在于 props 中，如果存在则抛出警告，因为不能修改 props 中的数据
    // 如果是 状态 组件，那么 instance.props 是一个 shallowReactive 的对象
    else if (key in instance.props) {
        __DEV__ &&
        warn(
            `Attempting to mutate prop "${key}". Props are readonly.`,
            instance
        )
        return false
    }

    // 如果修改的是内置的一些属性，例如 $attrs 等，会抛出警告
    if (key[0] === '$' && key.slice(1) in instance) {
        __DEV__ &&
        warn(
            `Attempting to mutate public property "${key}". ` +
            `Properties starting with $ are reserved and readonly.`,
            instance
        )
        return false
    } else {
        // 直接将设置的值挂载到 ctx 上
        ctx[key] = value
    }

    return true
}
```  

在最后可以看到，只要设置的是有效值（不管是在 `setupState` 还是 `data` 中，或者这两者都不是），最终都会挂载到 `ctx` 上面  

## has  

```typescript

```  

# 示例  
## getter 和 setter  

有以下组件  

```typescript
let instanceProxy;
            
const Comp = {
    props: [ 'age' ],
    setup () {
        onMounted(() => {
            instanceProxy = getCurrentInstance().proxy;
        });
        return { name: 'IconMan' };
    }
}

const app = createApp( Comp, { age: 24, score: 90 } );

app.config.globalProperties.global = 'global value';

app.mount( root );
```  

现在通过 `instanceProxy` 访问 `name` 和 `age`，会进入 `PublicInstanceProxyHandlers.get` 分别从 `setupState` 和 `props` 中获取，此时组件的 `accessCache` 会成为这样  

```typescript
accessCache: {
    name: 0,    // setup state
    age: 2,     // props
}
```

接着访问 `$store`，这是一个自定义且以 $ 开头的属性，只会从 `ctx` 和 `global` 两个对象里取找，但是什么也找不到，所以这里什么也不做，接着进行设置操作  

```typescript
instanceProxy.$store = { value: 1 };
```  

现在，会将 `$store` 直接挂载在 `ctx` 上，所以再一次访问时，就可以从 `ctx` 中读取到了，现在 `accessCache` 会是这样  

```typescript
accessCache: {
    name: 0,    // setup state
    age: 2,     // props
    $store: 3,  // ctx
}
```  

最后再访问两个属性，`$attrs` 和 `global`，一个会从 `publicPropertiesMap` 获取，一个会从 `appContext.config.globalProperties` 中获取  

```typescript
// public
console.log( instanceProxy.$attrs );    // { score: 90 }

// global
console.log( instanceProxy.global )     // global value
```