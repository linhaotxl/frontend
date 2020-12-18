> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [工具函数](#工具函数)
    - [createInnerComp](#createinnercomp)
- [异步组件](#异步组件)
    - [defineAsyncComponent](#defineasynccomponent)

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
    errorComponent?: Component      // 异步过程中出错、或者超时时显示的组件
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
    const load = () => {
        /* ... */
    }

    // 定义 AsyncComponentWrapper 组件，并返回
    return defineComponent({
        name: 'AsyncComponentWrapper',
        setup () {
            // 获取当前组件实例
            const instance = currentInstance!

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
                // 追踪 loaded，如果异步过程成功，则渲染组件
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

异步加载过程  
