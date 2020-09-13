**为了更加清楚理解源码的意义，代码的顺序做了调整**  

源码中会用到的工具函数  
1. [def 函数](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#def)
2. [camelize 函数]()

- [初始化 props](#初始化-props)
    - [normalizePropsOptions](#normalizepropsoptions)
    - [setFullProps](#setfullprops)
    - [resolvePropValue](#resolvepropvalue)
- [更新 props](#更新-props)

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

总结  
1. 这个函数返回一个数组，第一个元素是配置对象的集合，第二个元素是需要转换的 `prop` 的名称  
    有两种情况说明这个 `prop` 需要转换  
    * 存在默认值 `default`  
    * 可能是 `Boolean` 的情况，因为 `Boolean` 会有额外的处理，后面会看到  

2. 对于上面生成的两个数据中，所有 `prop` 的名称都会被经过驼峰处理，所以存储的都是驼峰形式的属性名  

## BooleanFlags  
这是一个枚举，有两个值，在 [normalizePropsOptions](#normalizePropsOptions)  函数中，会设置给属性的配置对象，在接下来解析的函数 [resolvePropValue](#resolvePropValue) 中会用到  

```typescript
const enum BooleanFlags {
    shouldCast,
    shouldCastTrue
}
```  

* `shouldCast` 表示是否存在 `Boolean` 的属性  
* `shouldCastTrue` 表示是否需要将属性的值转换为 `true`

## setFullProps  
这个方法会全量的更新组件的 `props`，大致分为两个步骤  
1. 遍历传递给组件的所有 `props`，如果组件定义了需要接受这个 `prop`，那么就会将其放在组件实例的 `props` 上，否则放在 `attrs` 上  
2. 处理需要转换的所有 `props`，将处理结果重新写入组件实例的 `props` 上  

```typescript
/**
 * @param { ComponentInternalInstance } instance 组件实例
 * @param { Data | null }               rawProps 原始 props，也就是标签上写的
 * @param { Data }                      props 最终被挂载在组件实例上的 props
 * @param { Data }                      attrs 最终被挂载在组件实例上的 attrs
 */
function setFullProps(
    instance: ComponentInternalInstance,
    rawProps: Data | null,
    props: Data,
    attrs: Data
) {
    // 获取 props 配置对象和需要转换的 props 集合
    const { 0: options, 1: needCastKeys } = normalizePropsOptions( instance.type.props )
    const emits = instance.type.emits

    // 检测使用组件的时候，是否传递了 props
    if ( rawProps ) {
        // 遍历标签上的 props
        for (const key in rawProps) {
            const value = rawProps[key]
            
            // 过滤内置 prop，内置 prop 不作处理
            if ( isReservedProp(key) ) {
                continue
            }
            
            // 这里的 key 是传递给组件的 prop，所以可能是 kabab-case，会先将其转换为 camel-case 的形式
            // 然后检测其是否在配置对象中，因为配置对象中的属性名也是 camel-case
            let camelKey
            if ( options && hasOwn(options, (camelKey = camelize(key))) ) {
                // 存在放入组件实例的 props 中
                props[camelKey] = value
            } else if ( !emits || !isEmitListener(emits, key) ) {
                // 不存在放入组件实例的 attrs 中，注意这里存放的并不是 camel-case 形式，而是原始的 key
                // Any non-declared (either as a prop or an emitted event) props are put
                // into a separate `attrs` object for spreading. Make sure to preserve
                // original key casing
                attrs[key] = value
            }
        }
    }

    // 处理需要转换的 props
    if ( needCastKeys ) {
        const rawCurrentProps = toRaw( props )
        for (let i = 0; i < needCastKeys.length; i++) {
            const key = needCastKeys[i]
            // 通过 resolvePropValue 来获取转换后的值，然后重写组件实例 props 中的值
            props[key] = resolvePropValue(
                options!,
                rawCurrentProps,
                key,
                rawCurrentProps[key]
            )
        }
    }
}
```  

## resolvePropValue  
这个方法主要处理需要转换的 `prop`，并返回转换后的值，主要有两种情况会转换  
1. 存在默认值 `default`  
2. `Boolean` 类型的属性  

    如果一个属性定义的类型是 `Boolean` 但是实际传入的却不是 `Boolean`，此时就会对其进行转化处理，例如 `Comp` 组件会接受一个 `Boolean` 的属性  
    ```typescript
    const Comp = {
        props: {
            foo: Boolean
        }
    }
    ```  
    但传入的却是其他类型的值  
    ```html
    <!-- 示例一: 不传，此时会被解析为 false -->
    <Comp />
    <!-- 示例二: 传入空字符传，此时会被解析为 false -->
    <Comp foo="" />
    <!-- 示例三: 传入和属性名相同的字符串，此时会被解析为 true -->
    <Comp foo="foo" />
    <!-- 示例四: 剩余情况，都会被解析为 false -->
    <Comp foo="aaa" />
    ```  

接下来具体的实现  

```typescript
/**
 * @param { NormalizedPropsOptions[0] } options 组件的配置对象
 * @param { Data }                      props   组件的配置对象
 * @param { string }                    key     处理的属性名，这是肯定是一个 camel-case 的形式
 * @param { unknown }                   value   当前属性名 key，在组件上传递的属性值
 */
function resolvePropValue(
  options: NormalizedPropsOptions[0],
  props: Data,
  key: string,
  value: unknown
) {
    // 获取执行属性的配置对象
    const opt = options[key]
    if ( opt != null ) {
        // 检测是否存在默认值
        const hasDefault = hasOwn(opt, 'default')

        // 默认值生效的条件是存在默认值，且本身的值是 undefined
        if ( hasDefault && value === undefined ) {
            // 处理 default value
            const defaultValue = opt.default
            value = isFunction(defaultValue) ? defaultValue() : defaultValue
        }

        // 处理 Boolean 的转化
        // 首先检测是否存在 Boolean
        if ( opt[BooleanFlags.shouldCast] ) {
            // 如果没有提供这个 prop，且没有默认值，就把它设置为 false，对应上面的示例一
            if (!hasOwn(props, key) && !hasDefault) {
                value = false
            }
            // 检测是否需要转换为 true，以下两种情况都需要转换
            // 当传递的是空字符串，对应上面的示例二
            // 当传递的值和属性名相同，注意这里会将属性名转换为 kabab-case，
            else if (
                opt[BooleanFlags.shouldCastTrue] &&
                (value === '' || value === hyphenate(key))
            ) {
                // 此时 prop 肯定声明了 boolean，但如果没有声明 string，或者声明了 string，但是 string 在 boolean 的后面
                // 即 [ boolean, string ]
                // 此时会检测 prop 的值，如果为空字符串，或者转换为 kabek-case 与 key 相同，则被视为 true
                value = true
            }
        }
    }
    return value
}
```

# 更新 props