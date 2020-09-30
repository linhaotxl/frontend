**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [emit 函数生成](#emit-函数生成)
- [normalizeEmitsOptions](#normalizeemitsoptions)
- [emit](#emit)
- [示例](#示例)
    - [处理基本事件函数](#处理基本事件函数)
    - [处理 once 事件](#处理-once-事件)
    - [触发不存在的事件](#触发不存在的事件)
    - [校验事件函数的参数](#校验事件函数的参数)
    - [v-model](#v-model)

<!-- /TOC -->

# emit 函数生成
在每个组件的实例上，都会绑定一个 `emit` 方法，并且第一个参数就是当前组件实例，这个过程发生在创建实例的过程 [createComponentInstance](#createComponentInstance) 中  

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

然后在每个组件的 `setup` 方法中，可以从第二个参数 `setupContext` 里面可以获取到这个 `emit` 方法，在调用 `setup` 方法之前，会先生成 `setupContext` 对象     

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

# normalizeEmitsOptions  
在触发事件后到执行具体的事件函数这个区间内，可以对事件函数的参数进行校验，校验成功则执行具体的函数，否则就不会执行  
在组件里可以声明 `emits` 来标识需要校验的事件，而 `emits` 的格式有多种，所以会先对其进行统一处理  

```typescript
// array
defineComponent({
    emits: [ 'foo' ]
});

// object
defineComponent({
    emits: {
        foo: null,
        bar: arg => arg > 0
    }
});
```  

`emits` 的配置对象会在创建组件实例的时候生成，并挂载到组件实例的 `emitsOptions` 属性上  

```typescript
/**
 * @param { ConcreteComponent } 组件
 */
export function normalizeEmitsOptions(
    comp: ConcreteComponent,
    appContext: AppContext,
    asMixin = false
): ObjectEmitsOptions | null {
    // 获取当前组件所在的 appId
    const appId = appContext.app ? appContext.app._uid : -1
    // 获取组件上的 __emits，这个属性是 comp 组件在不同 app 中的配置对象的集合
    const cache = comp.__emits || (comp.__emits = {})
    // 获取 comp 组件在当前 app 中的配置对象
    const cached = cache[appId]
    // 如果已经有缓存，则直接使用缓存数据
    if (cached !== undefined) {
        return cached
    }

    // 获取组件上声明的 emits
    const raw = comp.emits
    // 最终解析完成的配置对象
    let normalized: ObjectEmitsOptions = {}

    let hasExtends = false

    // 如果 comp 组件没有声明 emits，则直接 comp 组件的配置对象为 null，并返回
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

    // 返回配置对象，并将配置对象缓存到组件的 __emits 上
    return (cache[appId] = normalized)
}
```  

在配置对象中，如果值为 `null` 的 `emit` 代表只需要校验是否监听了这个事件，如果为函数的话，不仅会验证是否监听，还会验证事件函数的参数是否满足指定要求  

# emit  

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
                // 当前触发的 事件 不再配置对象中
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

    // 获取自定义事件属性名，监听的事件会以这个形式通过 prop 传递进来，即 on + 首字母大写的事件名
    // 例如 <div @click="handlerClick"></div> 会被转换为 h( 'div', { onClick: _ctx.handlerClick } )
    let handlerName = `on${capitalize(event)}`
    // 从 props 获取对应的事件处理函数
    let handler = props[handlerName]
    
    // 处理 v-model 的更新事件，当 v-model 的值是一个 kabeb-case 的名称，而 emit 触发的却是 camel-case 的名称
    if (!handler && event.startsWith('update:')) {
        handlerName = `on${capitalize(hyphenate(event))}`
        handler = props[handlerName]
    }

    if (!handler) {
        // 如果前两步还没有获取到事件处理函数，那么就当做这是一个只执行一次的事件，即 once，再获取 once 对应的事件处理函数
        handler = props[handlerName + `Once`]
        // 如果是第一次，则 emitted 为 null，然后设置以事件名为 key，true 为 value 的对象
        // 如果不是第一次，则会验证 emitted 对象中以事件名为 key 的值，为 true 则会直接 return，从而不会再次触发同一个事件
        if (!instance.emitted) {
            ;(instance.emitted = {} as Record<string, boolean>)[handlerName] = true
        } else if (instance.emitted[handlerName]) {
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
通过 `emit` 触发的事件，会拼接 `on` + 首字母大写的事件名为实际出发的事件名，再匹配 `props` 中是否存在这个属性，存在的话才会触发具体的函数  
所以只有 `bar` 和 `!baz` 这两个才会触发  

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
而在触发 `name` 时，`emitted` 中的 `onName` 为 `false`，所以 `name` 事件会只触发一次  

**因为代码中只标注了第一次触发的 once 事件，所以只有第一个 once 事件是有效的，再之后的都会失去 once 这个特性**  

## 触发不存在的事件  
```typescript
const Foo = defineComponent({
    setup( _, { emit } ) {
        emit('bar');

        return null;
    },
    emits: ['foo'],
})

render(h(Foo), root)
```    

```typescript
const Foo = defineComponent({
    setup( _, { emit } ) {
        emit('bar');

        return null;
    },
    emits: { foo: null },
})

render(h(Foo), root)
```  

`Foo` 组件的 `emits` 配置对象会被解析为 `{ foo: null }`，而触发 `bar` 事件时，`foo` 并不在配置对象中，并且也没有传递对应的 `onFoo` 事件，所以会抛出警告  

## 校验事件函数的参数  

```typescript
const Foo = defineComponent({
    setup( _, { emit } ) {
        onMounted(() => {
            emit( 'foo', -1 )
        });

        return null;
    },
    emits: {
        foo: arg => arg > 0
    },
})

render(h(Foo), root)
```  

`Foo` 组件的 `emits` 配置对象被解析为 `{ foo: arg => arg > 0 }`，触发 `foo` 事件时，`foo` 存在于配置对象中，且其值为函数，所以会调用它，但是却返回的 `false`，所以会抛出警告  

## v-model  
```typescript
const Comp = defineComponent({
    setup ( _, { emit } ) {
        onMounted(() => {
            emit( 'update:lastName' );
        });
    },

    render () {}
});
const update = () => { console.log( 'update' ) }

render( h( Comp, { 'onUpdate:last-name': update } ), root )
```  

上面中是 `Comp` 实现了 `v-model:last-name` 这种情况，如果触发的是 `update:last-name` 事件是肯定不会有问题的，但现在却触发了 `update:lastName` 事件，所以在 `emit` 内部对这种情况做了一个处理，会将触发的事件名转换为 **kabeb-case** 的形式，从而能正确匹配到对应的事件  

**官方建议始终使用 kabak-case 的事件名**