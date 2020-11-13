> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [什么时候需要加载](#什么时候需要加载)
    - [resolveComponent](#resolvecomponent)
    - [resolveDirective](#resolvedirective)
    - [resolveAsset](#resolveasset)
    - [resolve](#resolve)
    - [resolveDynamicComponent](#resolvedynamiccomponent)

<!-- /TOC -->

# 什么时候需要加载  
当使用自定义组件、指令以及动态组件时，都会去加载对应的资源，以供能正常使用  

```html
<Comp v-test></Comp>
```  

会被解析为  

```typescript
const _component_Comp = _resolveComponent("Comp")
const _directive_test = _resolveDirective("test")

_withDirectives((_openBlock(), _createBlock(_component_Comp, null, null, 512 /* NEED_PATCH */)), [
    [_directive_test]
])
```  

可以看到，会分别通过 [resolveComponent](#resolveComponent) 和 [resolveDirective](#resolveDirective) 来加载自定义组件、指令  

## resolveComponent  
加载自定义组件  

```typescript
const COMPONENTS = 'components'

export function resolveComponent(name: string): ConcreteComponent | string | undefined {
    return resolveAsset(COMPONENTS, name) || name
}
```  

## resolveDirective  
加载指令自定义  

```typescript
const DIRECTIVES = 'directives'

export function resolveDirective(name: string): Directive | undefined {
    return resolveAsset(DIRECTIVES, name)
}
```  

## resolveAsset  
这个函数用来加载组件或指令  

```typescript
/**
 * @param { typeof COMPONENTS | typeof DIRECTIVES } type 加载资源类型
 * @param { string } name 资源名称
 * @param { boolean } warnMissing 找不到资源时是否需要抛出警告
 */
function resolveAsset(
    type: typeof COMPONENTS | typeof DIRECTIVES,
    name: string,
    warnMissing = true
) {
    // 获取当前组件实例，必须要处于 setup 内或者 render 内
    const instance = currentRenderingInstance || currentInstance
    
    if (instance) {
        // 获取组件对象
        const Component = instance.type

        // 检测是否加载的组件自身
        // 检测顺序是：资源名称 -> 资源驼峰名称 -> 资源名称首字母大写驼峰
        if (type === COMPONENTS) {
            const selfName = (Component as FunctionalComponent).displayName || Component.name
            if (
                selfName &&
                (selfName === name ||
                selfName === camelize(name) ||
                selfName === capitalize(camelize(name)))
            ) {
                return Component
            }
        }

        const res =
            // 加载本地资源
            // check instance[type] first for components with mixin or extends.
            resolve(instance[type] || (Component as ComponentOptions)[type], name) ||
            // 加载全局资源，组件实例上的 appContext 中存在全局组件 components 和全局指令 directives
            resolve(instance.appContext[type], name)
            
            if (__DEV__ && warnMissing && !res) {
                warn(`Failed to resolve ${type.slice(0, -1)}: ${name}`)
            }
        return res
    } else if (__DEV__) {
        // 当前不处于 setup 或者 render 内，抛出警告
        warn(
            `resolve${capitalize(type.slice(0, -1))} ` +
            `can only be used in render() or setup().`
        )
    }
}
```  

## resolve   
这个函数从指定的数据中查找资源指定名称的资源是否存在，查找的顺序为 资源名 -> 资源驼峰名 -> 资源首字母大写驼峰名

```typescript
function resolve(registry: Record<string, any> | undefined, name: string) {
    return (
        registry &&
        (registry[name] ||
        registry[camelize(name)] ||
        registry[capitalize(camelize(name))])
    )
}
```

## resolveDynamicComponent  
这个函数用来加载动态组件  

```html
<component is="child" />
```  

编译为  

```typescript
resolveDynamicComponent("child")
```  

```typescript
/**
 * @param { any } component 组件名
 */
export function resolveDynamicComponent(component: unknown): VNodeTypes {
    if (isString(component)) {
        // 组件名是字符串，实际就是通过 resolveAsset 解析一个自定义组件
        return resolveAsset(COMPONENTS, component, false) || component
    } else {
        // 组件名不是字符串，直接返回
        return (component || NULL_DYNAMIC_COMPONENT) as any
    }
}
```  

**注意，如果组件名是字符串，并且没有获取到对应的组件，那就会返回组件名称的字符串，这样会被当做一个普通元素处理，类似于 `div`**
