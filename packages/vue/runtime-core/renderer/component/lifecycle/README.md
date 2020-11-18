> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [生命周期的类型](#生命周期的类型)
    - [createHook](#createhook)
    - [injectHook](#injecthook)

<!-- /TOC -->

# 生命周期的类型  
每个组件在创建实例对象 [createcomponentinstance](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#createcomponentinstance) 时，都会创建生命周期钩子属性，例如 `bm`、`m` 等等，它们的值都是数组，保存的是这个生命周期需要触发的回调，每个生命周期的钩子名称，都是存储在 `LifecycleHooks` 枚举里，和实例上的属性名一一对应  

```typescript
export const enum LifecycleHooks {
    BEFORE_CREATE = 'bc',       // before create
    CREATED = 'c',              // created
    BEFORE_MOUNT = 'bm',        // before mount
    MOUNTED = 'm',              // mounted
    BEFORE_UPDATE = 'bu',       // before update
    UPDATED = 'u',              // updated
    BEFORE_UNMOUNT = 'bum',     // before unmount
    UNMOUNTED = 'um',           // unmounted
    DEACTIVATED = 'da',
    ACTIVATED = 'a',
    RENDER_TRIGGERED = 'rtg',
    RENDER_TRACKED = 'rtc',
    ERROR_CAPTURED = 'ec'       // error
}
```  

接下来看看每个生命周期钩子是如何定义的  

```typescript
export const onBeforeMount     = createHook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted         = createHook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate    = createHook(LifecycleHooks.BEFORE_UPDATE)
export const onUpdated         = createHook(LifecycleHooks.UPDATED)
export const onBeforeUnmount   = createHook(LifecycleHooks.BEFORE_UNMOUNT)
export const onUnmounted       = createHook(LifecycleHooks.UNMOUNTED)
export const onRenderTriggered = createHook<DebuggerHook>(LifecycleHooks.RENDER_TRIGGERED)
export const onRenderTracked   = createHook<DebuggerHook>(LifecycleHooks.RENDER_TRACKED)
export const onErrorCaptured   = (
    hook: ErrorCapturedHook,
    target: ComponentInternalInstance | null = currentInstance
) => {
    injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
```  

每个钩子都是通过 [createHook](#createHook) 来定义的，先来看看这个函数做了什么  

## createHook  
这个函数用于定义一个通用的钩子，它只接受一个参数，就是钩子的类型  

```typescript
export const createHook = <T extends Function = () => any>(
    lifecycle: LifecycleHooks
) => (hook: T, target: ComponentInternalInstance | null = currentInstance) =>
  // post-create lifecycle registrations are noops during SSR
  !isInSSRComponentSetup && injectHook(lifecycle, hook, target)
```  

内部其实是用 [injectHook](#injectHook) 来注入一个具体的钩子函数，需要注意的是，如果处于 ssr 环境下则不会进行注入  

`isInSSRComponentSetup` 在执行 `setup` 函数前后被设置和恢复，即在 [setupComponent](https://github.com/linhaotxl/frontend/blob/master/packages/vue/runtime-core/renderer/component/initial/README.md#setupcomponent) 中  

在上面几个钩子中，只有 `onErrorCaptured` 不会区分 ssr 环境，剩余钩子在 ssr 环境都无法注入  

## injectHook  
这个函数会注入一个具体的钩子，总共有两个参数  
1. 第一个参数是回调  
2. 第二个参数是组件实例对象，默认是当前组件 `currentInstance`  

```typescript
export function injectHook(
    type: LifecycleHooks,
    hook: Function & { __weh?: Function },
    target: ComponentInternalInstance | null = currentInstance,
    prepend: boolean = false
): Function | undefined {
    if (target) {
        // 从组件上获取指定类型的钩子集合
        const hooks = target[type] || (target[type] = [])
        
        // 对具体执行的 hook 进行封装
        const wrappedHook =
            hook.__weh ||
            (hook.__weh = (...args: unknown[]) => {
                // 如果组件已经卸载，直接退出，不会执行任何钩子
                if (target.isUnmounted) {
                    return
                }
                // 暂停追踪
                pauseTracking()
                // 设置 currentInstance 为 target，保证每个钩子都是在 target 的环境中执行的
                setCurrentInstance(target)
                // 调用回调
                const res = callWithAsyncErrorHandling(hook, target, type, args)
                // 恢复 currentInstance 为 null
                setCurrentInstance(null)
                // 恢复追踪
                resetTracking()
                
                return res
            })

        // 添加到钩子数组中
        if (prepend) {
            hooks.unshift(wrappedHook)
        } else {
            hooks.push(wrappedHook)
        }
        
        return wrappedHook
    } else if (__DEV__) {
        const apiName = `on${capitalize(ErrorTypeStrings[type].replace(/ hook$/, ''))}`
        warn(
            `${apiName} is called when there is no active component instance to be ` +
                `associated with. ` +
                `Lifecycle injection APIs can only be used during execution of setup().` +
                (__FEATURE_SUSPENSE__
                ? ` If you are using async setup(), make sure to register lifecycle ` +
                    `hooks before the first await statement.`
                : ``)
        )
    }
}
```  

注意：默认情况下，生命周期钩子只能使用在 `setup` 函数内使用，因为只有这个时候 `currentInstance` 才是当前组件实例  