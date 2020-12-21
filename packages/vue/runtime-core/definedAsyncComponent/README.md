> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [工具函数](#工具函数)
    - [createInnerComp](#createinnercomp)
- [异步组件](#异步组件)
    - [defineAsyncComponent](#defineasynccomponent)
    - [load](#load)
        - [重新加载](#重新加载)

<!-- /TOC -->

# 工具函数  
## createInnerComp  
这个函数用来创建一个组件的 `vnode`  

```typescript
/**
 * @param { ConcreteComponent } comp 组件 
 * @param { ComponentInternalInstance } instance 组件实例 
 */
function createInnerComp(
    comp: ConcreteComponent,
    { vnode: { props, children } }: ComponentInternalInstance
) {
    // 创建 vnode
    return createVNode(comp, props, children)
}
```  

# 异步组件  
通过 [defineAsyncComponent](#defineAsyncComponent) 函数可以用来定义异步组件，其中有许多配置参数  

```typescript
export interface AsyncComponentOptions<T = any> {
    loader: AsyncComponentLoader<T> // 异步加载的组件，必须是函数，返回最终需要加载的组件
    loadingComponent?: Component    // loading 中的组件
    errorComponent?: Component      // 出错时的组件，异步过程中出错、或者超时
    delay?: number                  // 延迟时间，多长时间后才开始显示
    timeout?: number                // 超时时间
    suspensible?: boolean
    onError?: (                     // 异步出错时的钩子函数
        error: Error,               // 错误信息
        retry: () => void,          // 重新加载函数
        fail: () => void,           // 
        attempts: number            // 尝试 reload 的次数
    ) => any
}
```  

## defineAsyncComponent  
创建异步组件，参数为异步加载组件的过程，可以是一个函数，也可以是一个对象  
异步组件其实也是通过 [defineComponent](#defineComponent) 定义一个普通组件，只不过在异步过程结束后会重新执行渲染函数，渲染最终要加载的组件  

```typescript
export function defineAsyncComponent<
    T extends Component = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
    // 处理函数的情况
    if (isFunction(source)) {
        source = { loader: source }
    }

    // 解构相关配置
    const {
        loader,
        loadingComponent: loadingComponent,
        errorComponent: errorComponent,
        delay = 200,    // 延迟时间默认 200ms
        timeout,
        suspensible = true,
        onError: userOnError
    } = source

    // 待解析的组件，异步结束之后渲染的组件
    let resolvedComp: ConcreteComponent | undefined

    // 异步加载函数，对 loader 的封装
    const load = () => { /* ... */ }

    // 定义 AsyncComponentWrapper 组件，并返回
    return defineComponent({
        name: 'AsyncComponentWrapper',
        setup () {
            // 获取当前组件实例
            const instance = currentInstance!

            // 如果已经解析过，那么直接渲染组件
            if (resolvedComp) {
                return () => createInnerComp(resolvedComp!, instance)
            }

            // 处理加载过程中出错的情况
            const onError = () => { /* ... */ }

            // 异步过程是否完成，异步过程成功后会设置为 true
            const loaded = ref(false)
            // 异步过程中出现的错误状态
            const error = ref()
            // 延迟状态
            const delayed = ref(!!delay)

            // 如果设置延迟时间，则开启 delay 定时器，时间到了之后将延迟状态设置为 false，表示延迟结束，重新渲染组件
            // 修改延迟状态为宏任务
            if (delay) {
                setTimeout(() => {
                    delayed.value = false
                }, delay)
            }

            // 如果设置超时时间，则开启 timeout 定时器，时间到了之后，如果还没有加载完成，也没有出错
            // 则修改错误状态，重新渲染组件
            // 修改超时状态为宏任务
            if (timeout != null) {
                setTimeout(() => {
                    if (!loaded.value && !error.value) {
                        const err = new Error(
                            `Async component timed out after ${timeout}ms.`
                        )
                        onError(err)
                        error.value = err
                    }
                }, timeout)
            }

            // 调用异步加载函数
            load()
            .then(() => {
                // 加载成功后，更新 loaded，重新执行渲染函数，加载实际组件
                loaded.value = true
            })
            .catch(err => {
                // 记载失败后，更新 error，重新执行渲染函数，加载错误组件
                onError(err)
                error.value = err
            })
            
            // 渲染函数
            return () => {
                // 追踪 loaded，如果异步过程加载成功，则渲染组件
                if (loaded.value && resolvedComp) {
                    return createInnerComp(resolvedComp, instance)
                }
                // 追踪 error，如果异步过程失败，或者超时，则渲染错误组件
                else if (error.value && errorComponent) {
                    return createVNode(errorComponent as ConcreteComponent, {
                        error: error.value
                    })
                }
                // 追踪 delayed，如果延时结束，则渲染 loading 组件
                else if (loadingComponent && !delayed.value) {
                    return createVNode(loadingComponent as ConcreteComponent)
                }
            }
        }
    });
}
```  

下面会简单介绍加载的流程  

`delay` 默认延迟 `200ms`，之后修改延迟状态(**这是一个宏任务**)，所以如果立即渲染这个组件的话，得到的结果应该是一个 *注释节点*  

```typescript
const timeout = (n: number = 0) => new Promise(r => setTimeout(r, n))

const root = document.querySelector('#root')
let resolve: (comp: Component) => void
const Foo = defineAsyncComponent({
    loader: () => new Promise(r => { resolve = r as any }),
    loadingComponent: () => 'loading',
})

createApp(Foo).mount(root)
expect(root.innerHTML).toBe('<!---->')
```  

开始执行 `200ms` 的宏任务，修改延迟状态，重新渲染组件(将组件的 `update` 函数放入 `job` 队列中，并将 `flushJobs` 函数放进微任务队列中，等待刷新队列) 

```typescript
// 通过 timeout 开启一个 200ms 的宏任务，这个宏任务在延迟设置的宏任务之后
// 将 延迟设置的宏任务 内产生的微任务都执行结束，才会看到实际的结果(只会包括 flushJobs)
await timeout(200)
expect(root.innerHTML).toBe('loading')
```  

然后将异步过程设置为成功，渲染出最终的组件  

```typescript
resolve!(() => 'resolved')
```  

成功后会修改加载 `loaded` 状态为 `true`，重新渲染组件  

```typescript
// 通过 timeout 开启一个宏任务，需要将这个宏任务之前的所有微任务执行结束才能看到效果
// 包括 load 自身产生的、调用 load 产生的，以及 flushJobs
await timeout()
expect(root.innerHTML).toBe('resolved')
```  

如果 `delay` 为 `0`，那么加载 `loading` 组件就是一个同步的过程，因为颜值状态初始就是 `false` 了，所以会直接渲染 `loading` 组件  

## load  
`load` 函数是实际执行异步的过程，主要处理成功和失败两种情况  
这里存在一个变量 `pendingRequest`，存储的是异步过程返回的 `Promise`，如果有值，则会执行返回这个 `Promise`，否则会重新调用 `load` 获取 `Promise`  


```typescript
const load = (): Promise<ConcreteComponent> => {
    let thisRequest: Promise<ConcreteComponent>
    return (
        // ① 调用异步过程 loader
        pendingRequest ||
        (thisRequest = pendingRequest = loader()
        .catch(err => {
            // 处理错误为 Error 的实例
            err = err instanceof Error ? err : new Error(String(err))
            // ② 如果存在错误钩子，则调用，这里再返回一个 Promise 是为了无论成功失败，都能让外面捕获到
            if (userOnError) {
                return new Promise((resolve, reject) => {
                    const userRetry = () => resolve(retry())
                    const userFail = () => reject(err)
                    userOnError(err, userRetry, userFail, retries + 1)
                })
            } else {
                throw err
            }
        })
        .then((comp: any) => {
            if (thisRequest !== pendingRequest && pendingRequest) {
                return pendingRequest
            }
            if (__DEV__ && !comp) {
                warn(
                    `Async component loader resolved to undefined. ` +
                    `If you are using retry(), make sure to return its return value.`
                )
            }
            // interop module default
            if (
                comp &&
                (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
            ) {
                comp = comp.default
            }

            if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
                throw new Error(`Invalid async component load result: ${comp}`)
            }
            
            // ③ resolvedComp 为实际需要渲染的函数，这样，当第二次重新渲染这个组件时，就可以直接渲染了，再不需要重新执行异步过程
            resolvedComp = comp
            
            return comp
        }))
    )
}
```  

首先看 ③ 处的意思，如果一个异步组件被 `v-if` 控制，那么当它渲染的时候，会去调用 `loader` 函数加载组件，加载成功后，会将闭包中的 `resolvedComp` 设置为最终渲染的组件，此时将它卸载掉，之后再次将它渲染出来，这个时候由于闭包中的 `resolvedComp` 已经是有值的，所以就直接渲染出 `resolvedComp` 保存的组件，不再需要执行一遍完整的异步流程了  

接下来看错误相关的内容，首先看处理错误的 `onError`  

```typescript
const onError = (err: Error) => {
    // 设置为 null，以便于在 load 函数中，能再一次发起异步过程
    pendingRequest = null
    // 处理错误
    handleError(
        err,
        instance,
        ErrorCodes.ASYNC_COMPONENT_LOADER,
        !errorComponent /* do not throw in dev if user provided error component */
    )
}
```  

这个函数会调用 [handleError](#handleError) 来向上一层一层处理发生的错误，直至顶层 `app` 上的错误钩子  

异步过程出错时，如果没有自定义错误钩子，那么在 `load` 内直接将错误向上抛出，被外面的 `catch` 捕获，首先通过 `onError` 处理完，再修改错误状态 `error`，导致重新渲染    
存在错误组件则渲染错误组件，否则什么也不渲染  

如果定义了自定义错误钩子，那么就会调用钩子函数，调用钩子函数的处于一个新的 `Promise` 内，这样做的目的就是最终肯定要走到外面的 `then` 或者 `catch` 中去修改状态，从而触发重新渲染  
错误钩子接受的两个函数，分别是重新加载 以及 加载失败  
如果加载失败，则会被外面的 `catch` 捕获  
如果重新加载，则再去调用 `load` 函数加载，成功后返回实际组件，最终被外面的 `then` 捕获  

### 重新加载  

```typescript
// 重新加载的次数
let retries = 0
const retry = () => {
    // 次数 +1
    retries++
    // 将 pendingRequest 设置为 null，这样在之后的 load 过程中就可以重新发起异步过程 loader
    pendingRequest = null
    return load()
}
```  