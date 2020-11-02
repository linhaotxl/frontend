> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [源码中用到其他模块的函数](#源码中用到其他模块的函数)
- [emit 函数生成](#emit-函数生成)
- [normalizeEmitsOptions](#normalizeemitsoptions)
- [emit](#emit)
- [示例](#示例)
    - [处理基本事件函数](#处理基本事件函数)
    - [处理 once 事件](#处理-once-事件)
    - [验证事件是否存在以及参数校验](#验证事件是否存在以及参数校验)
    - [v-model](#v-model)

<!-- /TOC -->

# 源码中用到其他模块的函数  
1. [extend](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#extend)  
2. [capitalize](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#capitalize)
3. [hyphenate](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#hyphenate)   
4. [callWithAsyncErrorHandling](https://github.com/linhaotxl/frontend/blob/master/packages/vue/shared/README.md#hyphenate)   

<!-- TODO: -->
# emit 函数生成  
在每个组件的 `setup` 方法中，可以从第二个参数 `setupContext` 里面可以获取到 `emit` 方法，在调用 `setup` 方法之前，会先生成 `setupContext` 对象     

```typescript
/**
 * 创建 setup context
 * @param { ComponentInternalInstance } instance 组件实例
 */
function createSetupContext ( instance: ComponentInternalInstance ): SetupContext {
    return {
        attrs: instance.attrs,
        slots: instance.slots,
        emit: instance.emit
    }
}
```  

之后就可以在 `setup` 中触发自定义事件了   

可以看到，`emit` 函数来自于组件实例上，而它的生成是发生在创建实例的过程 [createComponentInstance](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#createcomponentinstance) 中   

```typescript
export function createComponentInstance(
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null
) {
    // ...
    // 创建组件实例
    const instance: ComponentInternalInstance = { // ... };

    // ...

    // 挂载 emit 方法
    instance.emit = emit.bind( null, instance )
}
```

# normalizeEmitsOptions  
在组件上可以增加 `emits` 选项，可以对事件函数的参数进行校验，校验成功则执行具体的函数，否则就不会执行  
`emits` 选项的如下  

```typescript
// array
const Comp1 = defineComponent({
    emits: [ 'foo' ]
});

// object
const Copm2 = defineComponent({
    emits: {
        foo: null,
        bar: arg => arg > 0
    }
});
```  

可以看到，`emits` 的格式有多种，所以会先对其进行统一处理，通过这个函数生成统一的配置对象，这个过程发生在创建组件实例时，并挂载到组件实例的 `emitsOptions` 属性上    

```typescript
export function createComponentInstance(
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null
) {
    const type = vnode.type as ConcreteComponent
    /* ... */
    const instance: ComponentInternalInstance = {
        /* ... */
        emitsOptions: normalizeEmitsOptions( type, appContext ),
        /* ... */
    }
    /* ... */
}
```

在生成的配置对象中，每个 `emit` 的值可以有两个类型  
1. `null`: 什么也不会做
2. `function`: 需要验证事件函数的参数是否满足条件  

```typescript
/**
 * 生成 emits 配置对象
 * @param { ConcreteComponent } 组件对象
 */
export function normalizeEmitsOptions(
    comp: ConcreteComponent,
    appContext: AppContext,
    asMixin = false
): ObjectEmitsOptions | null {
    // 获取当前组件所在的 appId
    const appId = appContext.app ? appContext.app._uid : -1
    // 获取组件对象上的 __emits，如果是第一次则不存在，会设置一个空对象
    const cache = comp.__emits || (comp.__emits = {})
    // 根据 appId 查找是否有缓存，在第一次转换时，会将转换结果挂载到 comp.__emits[ appId ] 上
    const cached = cache[appId]
    // 存在缓存直接使用，否则进行转换过程
    if (cached !== undefined) {
        return cached
    }

    // 获取组件对象上声明的 emits 选项
    const raw = comp.emits
    // 定义最终解析完成的 emits 配置对象
    let normalized: ObjectEmitsOptions = {}

    let hasExtends = false

    // 组件上没有定义 emits，直接返回 null
    if (!raw && !hasExtends) {
        return (cache[appId] = null)
    }

    // 处理 emits 选项
    if (isArray(raw)) {
        // array，遍历 emits，配置对象中的每个 emit 的值都是 null
        raw.forEach(key => (normalized[key] = null))
    } else {
        // object，拷贝到 normalized 中
        extend(normalized, raw)
    }

    // 第一次转换将结果挂载到 comp.__emits[ appId ] 上
    return (cache[appId] = normalized)
}
```  

# emit  
这个函数用于在组件中，触发自定义监听的事件  

```typescript
/**
 * 触发自定义事件
 * @param { ComponentInternalInstance } instance 组件实例
 * @param { string } event 触发的事件名
 * @param { any[] } args 携带的参数
 */
export function emit(
    instance: ComponentInternalInstance,
    event: string,
    ...args: any[]
) {
    // 获取使用组件时实际传递的 props
    const props = instance.vnode.props || EMPTY_OBJ

    // 验证，仅在 dev 环境下验证
    if (__DEV__) {
        const {
            emitsOptions,                 // emits 配置对象
            propsOptions: [propsOptions]  // props 配置对象
        } = instance
        if ( emitsOptions ) {
            if (!(event in emitsOptions)) {
                // 当前触发的 事件 不再 emits 配置对象中
                // 并且也没有传递这个事件，就会发出警告
                if (!propsOptions || !(`on` + capitalize(event) in propsOptions)) {
                    warn(
                        `Component emitted event "${event}" but it is neither declared in ` +
                        `the emits option nor as an "on${capitalize(event)}" prop.`
                    )
                }
            } else {
                // 当前触发的 事件 存在于配置对象中
                // 则会对其参数进行验证
                const validator = emitsOptions[event]
                if (isFunction(validator)) {
                    const isValid = validator(...args)
                    if (!isValid) {
                        warn(
                            `Invalid event arguments: event validation failed for event "${event}".`
                        )
                    }
                }
            }
        }
    }

    // 获取触发的事件名，在组件上监听，最终会以 “on + 首字母大写的事件名” 这个形式作为 props 传递给组件
    // 例如 <Comp @click="handlerClick"></Comp> 会被转换为 h( 'Comp', { onClick: _ctx.handlerClick } )
    let handlerName = `on${capitalize(event)}`
    // 从 props 获取对应的事件处理函数
    let handler = props[handlerName]
    
    // 处理 v-model 的更新事件
    if (!handler && event.startsWith('update:')) {
        // 上一步获取不到事件函数，现在会将事件名转换为 kabab-case 并将首字母转为大写，再拼接 on，查找是否有这个事件函数
        handlerName = `on${capitalize(hyphenate(event))}`
        handler = props[handlerName]
    }

    if (!handler) {
        // 如果前两步还没有获取到事件处理函数，那么就当做这是一个只执行一次的事件即 once，再获取 once 对应的事件处理函数
        handler = props[handlerName + `Once`]
        
        // 如果是第一次触发，则 emitted 为 null，此时会将其设置为一个空对象，并将当前触发的事件名存入其中，值为 true
        if (!instance.emitted) {
            ;(instance.emitted = {} as Record<string, boolean>)[handlerName] = true
        }
        // 如果不是第一次，则会验证 emitted 对象中当前事件的值是否为 true，如果为 true 则直接退出函数，从而不会再次触发同一个事件
        else if (instance.emitted[handlerName]) {
            return
        }
    }

    // 调用事件处理函数
    if (handler) {
        callWithAsyncErrorHandling(
            handler,
            instance,
            ErrorCodes.COMPONENT_EVENT_HANDLER,
            args
        )
    }
}
```  

**注意，在 emitted 对象中，只记录了第一次触发的事件，也就是说如果有两个 once 事件，那么只会记录第一次触发的那个，至于第二个就是普通事件了，可以重复触发**

# 示例  

## 处理基本事件函数  
```typescript
const Foo = defineComponent({
    setup ( props, { emit } ) {
        onMounted(() => {
            emit('foo')
            emit('bar')
            emit('!baz')
        });
        return {}
    },
    render() {},
});

const onfoo = () => { console.log('onfoo') }
const onBar = () => { console.log('onBar') }
const onBaz = () => { console.log('onBaz') }

const Comp = () => h(Foo, { onfoo, onBar, ['on!baz']: onBaz })

render(h(Comp), root)

// 打印
// onBar
// onBaz
```  

实际触发的事件分别是 `onFoo`、`onBar` 和 `on!baz`，所以只会匹配到两个  

## 处理 once 事件  
```typescript
const Foo = defineComponent({
    setup ( _, { emit } ) {
        onMounted(() => {
            emit('age')
            emit('name')
            emit('age')
            emit('name')
        });

        return null;
    },
})
const handlerChangeName = () => { console.log( 'name' ) }
const handlerChangeAge = () => { console.log( 'age' ) }

render(
    h(Foo, {
        onAgeOnce: handlerChangeAge,
        onNameOnce: handlerChangeName,
    }),
    root
)

// 打印
// age
// name
// name
```  

在第一次触发事件 `age` 时，会将 `emitted` 设置为 `{ onAge: true }`，而当第二次触发 `age` 时，`emitted` 中的 `onAge` 已经为 `true` 所以会直接退出  
而在触发 `name` 时，`emitted` 已经是有效值了，且不存在 `onName` 属性，所以 `name` 事件可以一直被触发 

## 验证事件是否存在以及参数校验  
```typescript
const Foo = defineComponent({
    setup( _, { emit } ) {
        emit('baz');
        emit('bar');
        emit('foo', -1);
        return null;
    },
    emits: {
        bar: null,              // 必须要监听 bar 事件
        foo: arg => arg > 0     // 监听 foo 事件的参数必须大于 0
    },
})

render(h(Foo), root)
```    

`Foo` 组件的 `props` 和 `emits` 配置对象会被解析为  

    ```typescript
    // props
    {
        
    }

    // emits
    {
        bar: null,
        foo: arg => arg > 0
    }
    ```  

1. 触发 `baz` 事件时，`baz` 并不存在于 `emits` 配置对象中，而且 `props` 配置对象中也不存在 `onBaz`，所以抛出警告  
2. 触发 `bar` 事件时，`bar` 存在于 `emits` 配置对象中，但是它的值不是函数，所以什么也不做  
3. 触发 `foo` 事件时，`bar` 存在于 `emits` 配置对象中，它的值是函数，所以调用并传入参数，结果验证不通过，抛出警告  

## v-model  
```typescript
const Comp = defineComponent({
    setup ( _, { emit } ) {
        onMounted(() => {
            // 触发一
            emit( 'update:lastName' );
            // 触发二
            emit( 'update:last-name' );
        });
    },

    render () {}
});
const update = () => { console.log( 'update' ) }

// 渲染一
render( h( Comp, { 'onUpdate:last-name': update } ), root );    // <Comp v-model:last-name />

// 渲染二
render( h( Comp, { 'onUpdate:lastName': update } ), root );     // <Comp v-model:lastName />
```  

这里有四种组合，一个一个来看  

1. 渲染一 + 触发一  
现在触发的事件名( `update:lastName` )不会在 `props` 中找到，而且事件名又是 `update:` 开头，所以会进入处理 `v-model` 的 `if` 中  
首先将事件名转换为 kabab-case，即 ( `update:last-name` ) 再将首字母换大写并拼接 `on`，即 ( `onUpdate:last-name` )，这样就能在 `props` 中直接找到了，从而触发事件函数  

    **v-model:xxx 的是一个 kabab-case，而 emit 的是一个 camel-case 的事件，就会进行特殊处理，从而能匹配到正确的事件**  

2. 渲染一 + 触发二 和 渲染二 + 触发一  
这两种方式可以直接从 `props` 找到事件，并触发  

3. 渲染二 + 触发二  
这种触发的事件不管怎么样都无法从 `props` 中找到，所以不会触发  

**总结**  
1. 监听的事件名是 camel-case，而触发是却是 kabab-case，这种是无法匹配到的（ 渲染二 + 触发二 ）  
2. 监听的事件名是 kabab-case，而触发的却是 camel-case，这种是可以匹配到的（ 渲染一 + 触发一 ）  

**官方建议始终使用 kabak-case 的事件名**  

<!-- TODO: 一个组件监听了 click 事件，组件里的 div 也监听了 click 事件，当点击这个 div 时，会触发两次 click 事件 -->