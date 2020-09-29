**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [emit 函数生成](#emit-函数生成)
- [emit](#emit)
- [示例](#示例)
    - [处理基本事件函数](#处理基本事件函数)
    - [处理 once 事件](#处理-once-事件)

<!-- /TOC -->

# emit 函数生成
在每一个组件的实例上，都会你绑定一个 `emit` 方法，并且第一个参数就是挂载的组件实例，这个过程发生在创建实例的过程 [createComponentInstance](#createComponentInstance) 中  

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

然后在每个组件的 `setup` 方法中，第二个参数 `setupContext` 里面可以获取到这个 `emit` 方法，在调用 `setup` 方法之前，会先生成 `setupContext` 对象  

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

# emit  

```typescript
/**
 * 触发事件
 * @param { ComponentInternalInstance } instance 组件实例
 * @param { string } event 触发的事件名
 * @param { any[] } args 触发事件携带的参数
 */
export function emit(
  instance: ComponentInternalInstance,
  event: string,
  ...args: any[]
) {
  // 获取使用组件时实际传递的 props
  const props = instance.vnode.props || EMPTY_OBJ

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

    // 拼接事件名：on + 驼峰事件名
    // click-item -> onClick-item
    // clickItem -> onClickItem
    let handlerName = `on${capitalize(event)}`
    // 从 props 获取对应的事件处理函数
    let handler = props[handlerName]
    
    // for v-model update:xxx events, also trigger kebab-case equivalent
    // for props passed via kebab-case
    if (!handler && event.startsWith('update:')) {
        handlerName = `on${capitalize(hyphenate(event))}`
        handler = props[handlerName]
    }

    if (!handler) {
        // 如果上一步还没有获取到事件处理函数，那么就当做这是一个只执行一次的事件，获取 once 对应的事件处理函数
        handler = props[handlerName + `Once`]
        // 如果是第一次，则 emitted 为 null，然后设置以事件名为 key，true 为 value 的对象
        // 如果不是第一次，则会验证 emitted 对象中以事件名为 key 的值，为 true 则会直接 return，从而不会触发第二次
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
            emit('foo')
            emit('foo')
        });
    },
    render() { },
    emits: { foo: null },
})
const fn = () => { console.log( 'fn' ) }

render( h(Foo, { onFooOnce: fn }), root );

// 打印
// fn
```  
第一次触发事件时，会将 `emitted` 设置为 `{ onFoo: true }`，第二次触发时，`onFoo` 已经为 `true` 所以会直接退出