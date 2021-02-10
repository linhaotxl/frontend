> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [错误类型](#错误类型)
- [错误处理](#错误处理)

<!-- /TOC -->

# 错误类型  
```typescript
export const enum ErrorCodes {
    SETUP_FUNCTION,             // 执行 setup 函数时出错
    RENDER_FUNCTION,            // 执行 render 函数时出错
    WATCH_GETTER,
    WATCH_CALLBACK,
    WATCH_CLEANUP,
    NATIVE_EVENT_HANDLER,
    COMPONENT_EVENT_HANDLER,
    VNODE_HOOK,
    DIRECTIVE_HOOK,
    TRANSITION_HOOK,
    APP_ERROR_HANDLER,          // 执行顶层错误处理函数时再次出错
    APP_WARN_HANDLER,
    FUNCTION_REF,               // ref 为函数时出错
    ASYNC_COMPONENT_LOADER,
    SCHEDULER
}
```

# 错误处理  

```typescript
/**
 * @param { unknown } err 错误对象
 * @param { ComponentInternalInstance | null } instance 出错的组件实例
 * @param { ErrorTypes } type 错误类型
 */
export function handleError(
    err: unknown,
    instance: ComponentInternalInstance | null,
    type: ErrorTypes,
    throwInDev = true
) {
    // 获取出错组件对应的 vnode
    const contextVNode = instance ? instance.vnode : null
    if (instance) {
        // 获取父组件
        let cur = instance.parent
        // the exposed instance is the render proxy to keep it consistent with 2.x
        const exposedInstance = instance.proxy
        // 获取错误信息
        const errorInfo = __DEV__ ? ErrorTypeStrings[type] : type
        // 从当前组件的父组件开始向上查找，如果存在 onErrorCaptured 钩子，则调用它(参数为错误对象、错误产生的组件实例、错误信息)
        // 直到 onErrorCaptured 钩子返回 false 才停止向上查找
        while (cur) {
            const errorCapturedHooks = cur.ec
            if (errorCapturedHooks) {
                for (let i = 0; i < errorCapturedHooks.length; i++) {
                    if (errorCapturedHooks[i](err, exposedInstance, errorInfo) === false) {
                        return
                    }
                }
            }
            cur = cur.parent
        }
        
        // 处理顶层错误钩子函数
        const appErrorHandler = instance.appContext.config.errorHandler
        if (appErrorHandler) {
            callWithErrorHandling(
                appErrorHandler,
                null,
                ErrorCodes.APP_ERROR_HANDLER,
                [err, exposedInstance, errorInfo]
            )
            return
        }
    }
    logError(err, type, contextVNode, throwInDev)
}
```