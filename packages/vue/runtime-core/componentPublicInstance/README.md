**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [AccessTypes](#accesstypes)
- [accessCache](#accesscache)
- [PublicInstanceProxyHandlers](#publicinstanceproxyhandlers)
    - [publicPropertiesMap](#publicpropertiesmap)
    - [get](#get)
    - [set](#set)
    - [has](#has)
- [示例](#示例)
    - [getter 和 setter](#getter-和-setter)
- [RuntimeCompiledPublicInstanceProxyHandlers](#runtimecompiledpublicinstanceproxyhandlers)
    - [get](#get-1)
    - [has](#has-1)

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

# PublicInstanceProxyHandlers  

在组件实例上存在属性 `ctx`，其中存在 `_` 属性，并指向自身实例  

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

这个 `proxy` 对象主要用于组件的 `render` 方法中，可以通过 `this` 来获取到其中的属性  

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
/**
 * 检测 key 是否存在于 ctx 中 
 */
has({ _: { data, setupState, accessCache, ctx, appContext, propsOptions } }: ComponentRenderContext, key: string ) {
    let normalizedProps
    return (
        // 检测是否之前已经访问过这个 key
        accessCache![key] !== undefined ||
        // 检测 data 中是否存在 key
        (data !== EMPTY_OBJ && hasOwn(data, key)) ||
        // 检测 setupState 中是否存在 key
        (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
        // 获取组件 props 的配置对象集合，并检测 key 是否存在于其中
        ((normalizedProps = propsOptions[0]) && hasOwn(normalizedProps, key)) ||
        // 检测是否存在于 ctx 中
        hasOwn(ctx, key) ||
        // 检测是否存在于 publicPropertiesMap
        hasOwn(publicPropertiesMap, key) ||
        // 检测是否在全局属性中
        hasOwn(appContext.config.globalProperties, key)
    )
}
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

```typescript
'age' in instanceProxy;     // true
'name' in instanceProxy;    // true
'$store' in instanceProxy;  // true
'$attrs' in instanceProxy;  // true
'global' in instanceProxy;  // true
```

# RuntimeCompiledPublicInstanceProxyHandlers  
通过 `template` 生成的 `render` 方法时，组件上会存在 `withProxy` 属性，它是对 `ctx` 的代理  

```typescript
function finishComponentSetup(
    instance: ComponentInternalInstance,
    isSSR: boolean
) {
    /* ... */
    // 有 template 生成的 render 方法上都会存在 _rc 属性
    if (instance.render._rc) {
        instance.withProxy = new Proxy(
            instance.ctx,
            RuntimeCompiledPublicInstanceProxyHandlers
        )
    }
    /* ... */
}
```  

`RuntimeCompiledPublicInstanceProxyHandlers` 是基于 `PublicInstanceProxyHandlers` 的，只不过重写了 `get` 和 `has` 放方法，剩下的都一样  

```typescript
export const RuntimeCompiledPublicInstanceProxyHandlers = extend(
    {},
    PublicInstanceProxyHandlers,
    {
        get(target: ComponentRenderContext, key: string) {
            // ...
        },
        has(_: ComponentRenderContext, key: string) {
            // ...
        }
    }
)
```

## get  

在这之前首先要了解 `Symbol.unscopables` 的作用  
可以为任何对象定义 `Symbol.unscopables` 属性，并且它的值是一个对象，里面包含的是这个对象中的属性是否需要排除 `with` 环境  

```typescript
const obj = { 
    foo: 1, 
    bar: 2 
};
obj[Symbol.unscopables] = { 
    foo: false, // foo 属性需要在 with 环境中
    bar: true   // bar 属性不需要再 with 环境中
};
with( obj ) {
    console.log(foo); // 1，相当于 obj.foo
    console.log(bar); // ReferenceError: bar is not defined，相当于 bar
}
```  

可以看到，访问 `bar` 的时候，不再会从 `with` 的环境 `obj` 中去查找，所以会直接报错  
更改这个示例，加上代理对象  

```typescript
const obj = { 
    foo: 1, 
    bar: 2 
};

obj[Symbol.unscopables] = { 
    foo: false, // foo 属性需要在 with 环境中
    bar: true   // bar 属性不需要再 with 环境中
};

const proxy = new Proxy( obj, {
    get ( target, key, reciver ) {
        console.log( 'key is -> ', key )
        return Reflect.get( target, key, reciver )
    }
})

with( proxy ) {
    console.log(foo); // 1，相当于 obj.foo
    console.log(bar); // ReferenceError: bar is not defined，相当于 bar
}

// 输出
// key is ->  Symbol(Symbol.unscopables)
// key is ->  foo
// key is ->  Symbol(Symbol.unscopables)
```  

可以看出，在 `with` 语句中访问属性时，首先会查找环境的 `Symbol.unscopables` 对象，来判断访问的属性是否排除了 `with` 语句，如果没排除，则再一次访问确定的属性，如果排除了，就不会再访问了  

所以在 `RuntimeCompiledPublicInstanceProxyHandlers.get` 中，如果当前访问的是 `Symbol.unscopables` 就会直接过滤掉，什么也不做，如果访问的属性没有被排除，那么会再次触发 `get`，而这一次会通过 `PublicInstanceProxyHandlers.get` 来获取到最终的值  

```typescript
get( target: ComponentRenderContext, key: string ) {
    // fast path for unscopables when using `with` block
    if ((key as any) === Symbol.unscopables) {
        return
    }
    return PublicInstanceProxyHandlers.get!(target, key, target)
}
```  

## has   
因为在 `template` 中，只会存在一种情况会被 `has` 拦截，下面这是一个由 `<div>{{ String('Hello World!') }}</div>` 生成的 `render` 函数  

```typescript
const _Vue = Vue

return function render(_ctx, _cache, $props, $setup, $data, $options) {
    with (_ctx) {
        const { toDisplayString: _toDisplayString, createVNode: _createVNode, openBlock: _openBlock, createBlock: _createBlock } = _Vue

        return (_openBlock(), _createBlock("div", null, _toDisplayString(String('Hello World!')), 1 /* TEXT */))
    }
}
```  

当访问 `_Vue` 或者 `String` 的时候，因为当前在 `with` 的环境中，所以会先去查找是否存在于 `_ctx`，就会被 `has` 拦截  
只有两种情况会被认为不在 `_ctx` 的作用域中  
1. 内置变量，以 `_` 开头  
2. `JS` 的内置对象，`String`、`Number` 等  

```typescript
has( _: ComponentRenderContext, key: string ) {
    const has = key[0] !== '_' && !isGloballyWhitelisted(key)
    if (__DEV__ && !has && PublicInstanceProxyHandlers.has!(_, key)) {
        warn(
            `Property ${JSON.stringify(
                key
            )} should not start with _ which is a reserved prefix for Vue internals.`
        )
    }
    return has
}
```  

[isGloballyWhitelisted](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#isGloballyWhitelisted) 是全局变量的白名单集合，通过它来检测是否是全局对象  
