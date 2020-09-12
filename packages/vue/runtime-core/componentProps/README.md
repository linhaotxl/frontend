**为了更加清楚理解源码的意义，代码的顺序做了调整**  

源码中会用到的工具函数  
1. [def 函数](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#def)
2. [camelize 函数]()



# 初始化 props  
初始化 `props` 只会在第一次安装组件的时候执行，也就是 [setupComponent](https://github.com/linhaotxl/frontend/tree/master/packages/vue/runtime-core/component#setupComponent) 函数  
实现流程：  
1. 对于每一个组件来说，都可以定义需要接受的 `props`，然后会遍历我们实际传递的 `props`，检测实际传递的是否存在于组件声明中的，如果存在，会放入组件实例的 `props` 中，否则会放入组价实例的 `attrs` 中  
2. 源码中对每一个属性名都会转驼峰处理，也就是说 `max-age` 和 `maxAge` 是同一个属性  

```typescript
/**
 * @param { ComponentInternalInstance } instance    组件实例
 * @param { Data | null }               rawProps    原始属性集合，即标签上写的
 * @param { number }                    isStateful  是否是状态组件
 * @param { boolean }                   isSSR       是否 ssr
 */
export function initProps(
    instance: ComponentInternalInstance,
    rawProps: Data | null,
    isStateful: number,
    isSSR = false
) {
    // 声明 props 和 attrs 对象，最终会将它们挂载到组件实例上
    const props: Data = {}
    const attrs: Data = {}

    def(attrs, InternalObjectKey, 1)

    // 全量设置组件的 props 和 attrs
    setFullProps(instance, rawProps, props, attrs)

    // 获取组件上声明的 props
    const options = instance.type.props

    if (isStateful) {
        // 状态组件，将 props 挂载到组件实例的 props 上
        instance.props = isSSR ? props : shallowReactive(props)
    } else {
        // 函数组件
        if (!options) {
            // 函数组件上没有定义接受的 props，那么 props 和 attrs 共用
            instance.props = attrs
        } else {
            // 函数组件定义了接受的 props
            instance.props = props
        }
    }
    
    // 将 attrs 挂载到组件实例的 attrs 上
    instance.attrs = attrs
}
```  

可以看到  
1. 对于状态组件，它的 `props` 会经过 `shalloReactive` 的转换  
2. 对于函数组件，如果组件本身没有定义需要接受的 `props`，那么它的 `props` 和 `attrs` 会指向同一对象  

在 `setFullProps` 中会首先调用 `normalizePropsOptions` 这个函数，所以先来看这个函数  

## normalizePropsOptions  
每个组件定义的 `props` 格式会有多种，可以是数组，对象，如下  

```typescript
const Comp1 = {
    props: [ 'name', 'age' ]
}

const Comp2 = {
    props: {
        name: { type: String },
        age: { type: Number, default: 24 },
    }
}
```  

所以这个函数的作用就是将这个 `props` 进行统一的格式处理，将每个 `prop` 转换为特殊的 “配置对象”  

```typescript
/**
 * @param { ComponentPropsOptions | undefined } raw 组件上定义的需要接受的 props
 */
export function normalizePropsOptions( raw: ComponentPropsOptions | undefined ): NormalizedPropsOptions | [] {
    // 处理组件没有定义自己的 props，直接返回空数组
    if (!raw) {
        return EMPTY_ARR as any
    }

    // 在最后会将解析完成的对象挂载在 props 上，如果再次访问的话会直接获取，不会进行第二次的解析
    // 因为组件的 props 是不会变的，所以只需要解析一次就够了
    if ((raw as any)._n) {
        return (raw as any)._n
    }

    // 存储属性名的驼峰名，以及配置对象
    const normalized: NormalizedPropsOptions[0] = {}
    const needCastKeys: NormalizedPropsOptions[1] = []

    // 处理 props
    if ( isArray(raw) ) {
        // props 为数组
        // 遍历 props 数组，将每个 ”属性名“ 转换为驼峰形式，并以 key 存储在 normalized 中，value 为空对象
        for (let i = 0; i < raw.length; i++) {
            // 获取属性名的驼峰形式
            const normalizedKey = camelize(raw[i])
            // 验证是否有效
            if (validatePropName(normalizedKey)) {
                normalized[normalizedKey] = EMPTY_OBJ
            }
        }
    } else {
        // props 为对象
        // 遍历 props
        for (const key in raw) {
            // 将 key 驼峰化
            const normalizedKey = camelize(key)
            if (validatePropName(normalizedKey)) {
                const opt = raw[key]
                // 将驼峰化后的 "属性名" 存储在 normalized 中，并且值为一个对象，type 是其具体的类型
                const prop: NormalizedProp = (normalized[normalizedKey] = isArray(opt) || isFunction(opt)
                    ? { type: opt }
                    : opt)

                if (prop) {
                    // 获取 Boolean 和 String 出现的索引
                    const booleanIndex = getTypeIndex(Boolean, prop.type)
                    const stringIndex = getTypeIndex(String, prop.type)
                    // shouldCast 代表是否有 Boolean prop
                    prop[BooleanFlags.shouldCast] = booleanIndex > -1
                    // shouldCastTrue 代表没有 String prop 或者有 String，而且 Boolean 在 String 之前
                    prop[BooleanFlags.shouldCastTrue] = stringIndex < 0 || booleanIndex < stringIndex
                    // 存在 Boolean prop 或者存在 default，就将驼峰化后的 "属性名" 存进 needCastKeys，后续处理
                    if (booleanIndex > -1 || hasOwn(prop, 'default')) {
                        needCastKeys.push(normalizedKey)
                    }
                }
            }
        }
    }

    const normalizedEntry: NormalizedPropsOptions = [normalized, needCastKeys]

    // 在组件的 props 上定义解析好的结果，下次可以直接获取，不用再解析一次
    def(raw, '_n', normalizedEntry)

    return normalizedEntry
}
```  



# 更新 props