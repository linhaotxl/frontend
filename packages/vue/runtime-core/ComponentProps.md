> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [源码中会用到的工具函数](#源码中会用到的工具函数)
- [初始化 props](#初始化-props)
    - [normalizePropsOptions](#normalizepropsoptions)
    - [BooleanFlags](#booleanflags)
    - [initProps](#initprops)
    - [setFullProps](#setfullprops)
    - [resolvePropValue](#resolvepropvalue)
- [更新 props](#更新-props)
- [工具函数](#工具函数)
    - [validatePropName](#validatepropname)
    - [getTypeIndex](#gettypeindex)
    - [isSameType](#issametype)
    - [getType](#gettype)
- [示例](#示例)
    - [Boolean转换](#boolean转换)

<!-- /TOC -->

# 源码中会用到的工具函数  
1. [def](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#def)
2. [camelize](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#camelize)  
2. [hyphenate](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#hyphenate)  

# 初始化 props  

## normalizePropsOptions  
每个组件定义的 `props` 格式会有多种，可以是数组，对象，例如下面这几种  

```typescript
const Comp1 = {
    // 接受 name 和 age
    props: [ 'name', 'age' ]
}

const Comp2 = {
    props: {
        name: { type: String },             // 类型为 String
        age: { type: Number, default: 24 }, // 类型为 Number，默认值为 24
        sex: String,                        // 类型为 String
        score: [ String, Number ]           // 类型为 String 或者 Number
    }
}
```  

所以这个函数的作用就是将 `props` 进行统一的格式处理，转换结果是一个数组，包含两个数据  
1. 配置对象，将每个 `prop` 转换为同样对象  
2. 需要处理的 `prop` 名称集合，以下两种情况会对其处理  
    * 存在默认值 `default`  
    * `prop` 的值出现 `Boolean` 的情况，因为 `Boolean` 会有额外的处理，后面会看到  

这个过程发生在创建组件实例的过程中，并将转换结果挂载在示例的 `propsOptions` 上  

```typescript
export function createComponentInstance(
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null
) {
    // 获取组件对象
    const type = vnode.type as ConcreteComponent
    
    // 每个组件继承父组件的 context，如果是根组件，则从 vnode 上获取，根节点的 vnode 会在 mount 时挂载 context
    const appContext = (parent ? parent.appContext : vnode.appContext) || emptyAppContext

    const instance: ComponentInternalInstance = {
        /* ... */
        propsOptions: normalizePropsOptions(type, appContext),
        /* ... */
    }
    /* ... */
}
```  

接下来看具体的实现过程  

```typescript
/**
 * @param { ConcreteComponent } comp 组件对象
 */
export function normalizePropsOptions(
    comp: ConcreteComponent,
    appContext: AppContext,
    asMixin = false
): NormalizedPropsOptions | [] {
    const appId = appContext.app ? appContext.app._uid : -1
    // 获取组件上的 __props，如果是第一次不存在，则会设置一个空对象
    const cache = comp.__props || (comp.__props = {})
    // 根据 appId 查找是否有缓存，在第一次转换时，会将转换结果挂载到 comp.__props[ appId ] 上
    const cached = cache[appId]
    // 存在缓存直接使用，否则进行转换过程
    if (cached) {
        return cached
    }

    // 获取组件需要接受的 props
    const raw = comp.props
    // 定义转换结果的 配置对象 和 需要转换的 `props` 名称集合
    const normalized: NormalizedPropsOptions[0] = {}
    const needCastKeys: NormalizedPropsOptions[1] = []

    let hasExtends = false
    if (!raw && !hasExtends) {
        return (cache[appId] = EMPTY_ARR)
    }

    // 处理 props
    if (isArray(raw)) {
        // props 为数组
        // 遍历 props 数组，将每个 ”属性名“ 转换为驼峰，并以 key 存储在 normalized 中，value 为空对象
        for (let i = 0; i < raw.length; i++) {
            // 当 props 为数组时，里面的元素必须是字符串
            if (__DEV__ && !isString(raw[i])) {
                warn(`props must be strings when using array syntax.`, raw[i])
            }
            const normalizedKey = camelize(raw[i])
            if (validatePropName(normalizedKey)) {
                normalized[normalizedKey] = EMPTY_OBJ
            }
        }
    } else if (raw) {
        // props 不是数组，就必须是对象，不是对象就会抛出警告
        if (__DEV__ && !isObject(raw)) {
            warn(`invalid props options`, raw)
        }
        // 遍历 props
        for (const key in raw) {
            // 将 key 驼峰化
            const normalizedKey = camelize(key)
            if (validatePropName(normalizedKey)) {
                const opt = raw[key]
                // 将驼峰化后的 "属性名" 存储在 normalized 中，值为对象
                const prop: NormalizedProp = (normalized[normalizedKey] = isArray(opt) || isFunction(opt)
                    ? { type: opt } // prop 为数组或者函数时，将其以 type 的值存入 normalized
                    : opt)          // prop 为对象，直接存入 normalized

                if (prop) {
                    // 获取 Boolean 和 String 出现的索引
                    const booleanIndex = getTypeIndex(Boolean, prop.type)
                    const stringIndex = getTypeIndex(String, prop.type)
                    // shouldCast 代表是否有 Boolean prop
                    prop[BooleanFlags.shouldCast] = booleanIndex > -1
                    // shouldCastTrue 代表没有 String prop 或者 Boolean 在 String 之前
                    prop[BooleanFlags.shouldCastTrue] = stringIndex < 0 || booleanIndex < stringIndex
                    // 存在 Boolean prop 或者存在 default，就将驼峰化后的 "属性名" 存进 needCastKeys
                    if (booleanIndex > -1 || hasOwn(prop, 'default')) {
                        needCastKeys.push(normalizedKey)
                    }
                }
            }
        }
    }

    // 第一次转换将结果挂载到 comp.__props[ appId ] 上
    return (cache[appId] = [normalized, needCastKeys])
}
```  

可以看到，在转换结果中的两个数据里，所有 `prop` 的名称都会被经过驼峰处理，存储的都是驼峰形式的属性名  

最终，上面两个示例的 `props` 会被转换为下面这样  

```typescript
// Comp1
{
    name: {},
    age: {}
}

// Comp2
{
    name: { type: String },
    age: { type: Number, default: 24 },
    sex: { type: String },
    score: { type: [ String, Number ] }
}
```  

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

## initProps  
在上一步创建好配置对象后，接下来就会通过 `initProps` 进行初始化  
`initProps` 只会在第一次安装组件的时候执行，也就是 [setupComponent](https://github.com/linhaotxl/frontend/tree/master/packages/vue/runtime-core/component#setupComponent) 里会执行一次  

<!-- 实现流程：
1. 对于每一个组件来说，都可以定义需要接受的 `props`，然后会遍历我们实际传递的 `props`，检测实际传递的是否存在于组件声明中的，如果存在，会放入组件实例的 `props` 中，否则会放入组价实例的 `attrs` 中  
2. 源码中对每一个属性名都会转驼峰处理，也就是说 `max-age` 和 `maxAge` 是同一个属性   -->

接下来看 `initProps` 的具体实现  
 
```typescript
/**
 * @param { ComponentInternalInstance } instance    组件实例
 * @param { Data | null }               rawProps    传递的属性集合，即标签上写的所有属性集合
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

    // 设置 props 和 attrs
    setFullProps(instance, rawProps, props, attrs)

    // 获取组件上声明需要接受的 props
    const options = instance.type.props

    if (isStateful) {
        // 状态组件，将 props 挂载到组件实例的 props 上
        instance.props = isSSR ? props : shallowReactive(props)
    } else {
        // 函数组件
        if (!options) {
            // 函数组件上没有定义接受的 props，那么 props 和 attrs 指向同一个
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

## setFullProps  
这个函数主要做两件事  
1. 将实际传递的 `props` 分类，如果组件需要接受，就放入 `props` 对象中，否则就放入 `attrs` 对象中  
2. 对需要处理的 `prop` 进行处理，也就是之前生成的 `needCastKeys` 集合中的 `prop`  

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
    const [options, needCastKeys] = instance.propsOptions

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
            // 然后检测其是否在配置对象中，因为配置对象中的属性名都是 camel-case，所以直接检测是否存在于 配置对象 中
            let camelKey
            if ( options && hasOwn(options, (camelKey = camelize(key))) ) {
                // 存在放入组件实例的 props 中
                props[camelKey] = value
            }
            // 不存在的话，就会检测是否是声明的 emits，如果不是再回放入 attrs 中，注意这里存放的并不是 camel-case 形式，而是原始的 key
            else if (!isEmitListener(instance.emitsOptions, key)) {
                attrs[key] = value
            }
        }
    }

    // 处理需要转换的 props
    if ( needCastKeys ) {
        const rawCurrentProps = toRaw( props )
        for (let i = 0; i < needCastKeys.length; i++) {
            const key = needCastKeys[i]
            // 通过 resolvePropValue 来获取转换后的值，替换旧值
            props[key] = resolvePropValue(
                options!,
                rawCurrentProps,
                key,
                rawCurrentProps[key],
                instance
            )
        }
    }
}
```  

注意：在 `attrs` 中的属性名，依旧是原始的属性名，而在 `props` 里的属性名，都是转换后的 camel-case 形式  

## resolvePropValue  
这个方法主要处理需要转换的 `prop`，并返回转换后的值，主要有两种情况会转换  
1. 存在默认值 `default`  
2. 存在 `Boolean` 类型的属性  
    如果一个属性定义的类型包含 `Boolean` 但是实际传入的却不是 `Boolean`，此时就会对其进行转化处理  

接下来看具体的实现  

```typescript
/**
 * @param { NormalizedPropsOptions[0] } options 组件的配置对象
 * @param { Data }                      props   组件实例上的 props
 * @param { string }                    key     待处理的属性名，这肯定是一个 camel-case 的形式
 * @param { unknown }                   value   处理前的值
 */
function resolvePropValue(
  options: NormalizedProps,
  props: Data,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance
) {
    const opt = options[key]
    if (opt != null) {
        const hasDefault = hasOwn(opt, 'default')

        if (hasDefault && value === undefined) {
            // 处理 default value
            const defaultValue = opt.default
            if (opt.type !== Function && isFunction(defaultValue)) {
                setCurrentInstance(instance)
                value = defaultValue(props)
                setCurrentInstance(null)
            } else {
                value = defaultValue
            }
        }

        // 处理存在 Boolean 的情况
        if (opt[BooleanFlags.shouldCast]) {
            // prop 中存在 Boolean
            
            // 使用组件时如果没有提供这个 prop，且没有默认值，就把它设置为 false，对应上面示例一
            if (!hasOwn(props, key) && !hasDefault) {
                value = false
            }
            // 如果值为空字符串，或者将 key 进行 kabab-case 转换后与值相等，就会将其转化为 true
            else if (
                opt[BooleanFlags.shouldCastTrue] &&
                (value === '' || value === hyphenate(key))
            ) {
                // 此时如果没有声明 String，或者声明了 String，但是 String 在 Boolean 的后面，即 [ Boolean, String ]
                // 说明现在 Boolean 的优先级高，需要转换
                value = true
            }
        }
    }
    return value
}
```  

关于 `Boolean` 的转换可以参考示例 [Boolean转换](#Boolean转换)  

# 更新 props  
更新步骤可以分为两类  
1. 全量更新，这种情况会遍历所有的 `props` 依次更新  
2. 优化更新，这种情况只会遍历会改变的 `props`  

大致代码如下  

```typescript
/**
 * @param { ComponentInternalInstance } instance  组件实例
 * @param { Data | null }               rawProps  新的原始 props
 * @param { Data | null }               rawProps  旧的原始 props
 * @param { boolean }                   optimized 是否使用优化
 */
function updateProps(
    instance: ComponentInternalInstance,
    rawProps: Data | null,
    rawPrevProps: Data | null,
    optimized: boolean
) {
    // 此时，instance.vnode 已经是更新后的 vnode
    
    const {
        props,
        attrs,
        vnode: { patchFlag }
    } = instance
    const rawCurrentProps = toRaw(props)
    const [options] = instance.propsOptions
    
    if (
        !(__DEV__ && instance.type.__hmrId) &&
        (optimized || patchFlag > 0) &&
        !(patchFlag & PatchFlags.FULL_PROPS)
    ) {
        // 优化更新
        if (patchFlag & PatchFlags.PROPS) {
            // Compiler-generated props & no keys change, just set the updated
            // the props.
            // 从 vnode 上获取动态的 props 遍历
            const propsToUpdate = instance.vnode.dynamicProps!
            for (let i = 0; i < propsToUpdate.length; i++) {
                const key = propsToUpdate[i]
                // PROPS flag guarantees rawProps to be non-null
                const value = rawProps![key]
                if (options) {
                    // 组价上存在 props 选项
                    // 如果更新的 prop 存在于 attrs 中，就更新 attrs 中的值，否则更新 props 中的值
                    if (hasOwn(attrs, key)) {
                        attrs[key] = value
                    } else {
                        const camelizedKey = camelize(key)
                        props[camelizedKey] = resolvePropValue(
                            options,
                            rawCurrentProps,
                            camelizedKey,
                            value,
                            instance
                        )
                    }
                } else {
                    // 组件上不存在 props 选项，就直接更新 attrs 中的值
                    attrs[key] = value
                }
            }
        }
    } else {
        // 全量更新 props，这一步会将新的 props，即 rawProps 设置到组件的 props 和 attrs 上
        // 但是在组件的 props 和 attrs 上可能存在旧的数据，接下来会处理
        setFullProps(instance, rawProps, props, attrs)

        let kebabKey: string

        // 接下来就要处理组件的 props 中的旧数据，如果存在默认值，就恢复为默认值，否则就设置为 undefined

        // 经过上面 setFullProps 步骤后，rawCurrentProps 里已经包含了新数据和旧数据，现在遍历它，处理每一个 prop
        for (const key in rawCurrentProps) {
            // 什么时候需要重置和移除？分为两种情况
            // 不存在新的 props，这时候需要对所有的 props 进行删除或重置
            // 存在新的 props
            //  1. prop 为普通值，例如 name，如果在最新的 props 里没有这个值，就会被重置或删除
            //  2. prop 不是普通值，例如 max-age、maxAge，如果在最新的 props 里都没有 camel-case 和 kabab-case，就会被重置或移除
            if (
                // 不存在新的 props，直接进入 if 进行处理
                !rawProps ||
                // key 不存在于新的 props，继续下面的判断
                (!hasOwn(rawProps, key) &&
                // key 是一个 camel-case，永远不会和 kabab-case 的形式一样，所以这里能满足条件的只有普通值的 prop，即 name 这种
                // 如果条件满足，则进入 if 进行处理，否则继续下面的判断
                ((kebabKey = hyphenate(key)) === key ||
                // 检测 kabab-case 是否存在于 rawProps 中，如果不存在，则进入 if 进行处理
                !hasOwn(rawProps, kebabKey)))
            ) {
                // 能进入这个 if 里说明当前 key 是旧 props 里的，需要重置或者移除
                if (options) {
                    if (
                        rawPrevProps &&
                        // for camelCase
                        (rawPrevProps[key] !== undefined ||
                        // for kebab-case
                        rawPrevProps[kebabKey!] !== undefined)
                    ) {
                        props[key] = resolvePropValue(
                            options,
                            rawProps || EMPTY_OBJ,
                            key,
                            undefined,
                            instance
                        )
                    }
                } else {
                    // 组件上没有声明需要接受的 props，直接将这个 key 移除
                    delete props[key]
                }
            }
        }
        
        // 接下来就要处理组件的 attrs 中的旧数据，会将它们直接移除

        // 对于没有声明接受 props 的 FC 来说，它的 props 和 attrs 始终指向同一对象，而 props 在上面已经处理过了，所以不再需要处理 attrs
        if (attrs !== rawCurrentProps) {
            // 遍历了所有的 attrs，此时的 attrs 包含的是旧的和新的，在两种情况下会将其移除
            // 1. 没有新的 props 传递，此时会移除所有的 attrs
            // 2. 有新的 props，但是并不在新的 props 中，说明是旧的
            for (const key in attrs) {
                if (!rawProps || !hasOwn(rawProps, key)) {
                    delete attrs[key]
                }
            }
        }
    }

    // TODO: trigger updates for $attrs in case it's used in component slots
    trigger(instance, TriggerOpTypes.SET, '$attrs')
}
```  

<style>
    .update-props-table {
        word-wrap: break-word;
    }

    .update-props-table td:not(.remark) {
        width: 280px
    }
</style>

通过两个示例来说明全量更新中的逻辑，说明中的内容是在遍历 `rawCurrentProps` 的过程  

<table class="update-props-table">
    <tr>
        <th>rawPrevProps</th>
        <th>rawProps</th>
        <th>rawCurrentProps</th>
        <th>说明</th>
    </tr>
    <tr>
        <td>{ type: 'text', name: 'IconMan' }</td>
        <td>{ type: 'text' }</td>
        <td>{ type: 'text', name: 'IconMan' }</td>
        <td class="remark">key 是 name 时，不存在于 rawProps，但是其 kabab-case 的形式 name 和 key 本身 name 是相等的，所以可以进入 if 进行重置或删除</td>
    </tr>
    <tr>
        <td>{ type: 'text', max-age: 'IconMan' }/<br/>{ type: 'text', maxAge: 'IconMan' }</td>
        <td>{ type: 'text' }</td>
        <td>{ type: 'text', maxAge: 'IconMan' }</td>
        <td class="remark">key 是 maxAge 时，不存在于 rawProps，且其 kabab-case 的形式 max-age 和 maxAge 不相等，但是其 kabab-case 的形式是不存在于 rawProps 中的，所以可以进入 if 中重置或删除</td>
    </tr>
</table>

# 工具函数  

## validatePropName  
验证 `prop` 的名称是否有效，只要不是 `$` 开头都是可以的  

```typescript
function validatePropName(key: string) {
    if (key[0] !== '$') {
        return true
    } else if (__DEV__) {
        warn(`Invalid prop name: "${key}" is a reserved property.`)
    }
    return false
}
```  

## getTypeIndex  
获取类型在 `prop` 中出现的索引  

```typescript
function getTypeIndex(
    type: Prop<any>,
    expectedTypes: PropType<any> | void | null | true
): number {
    if (isArray(expectedTypes)) {
        // 数组，遍历 prop 的 type 值，直到找到与指定类型一致的 type，返回索引 i
        for (let i = 0, len = expectedTypes.length; i < len; i++) {
            if (isSameType(expectedTypes[i], type)) {
                return i
            }
        }
    } else if (isFunction(expectedTypes)) {
        // 非数组，检查是否和指定 type 一致，一致则返回 0
        return isSameType(expectedTypes, type) ? 0 : -1
    }
    return -1
}
```  

## isSameType  
检测是否是相同类型的 `type`  

```typescript
function isSameType(a: Prop<any>, b: Prop<any>): boolean {
    return getType(a) === getType(b)
}
```  

## getType
获取 `type`  

```typescript
function getType(ctor: Prop<any>): string {
    // 将 type 转换为字符串，截取 function 后面的名称
    const match = ctor && ctor.toString().match(/^\s*function (\w+)/)
    return match ? match[1] : ''
}
```    

# 示例  

## Boolean转换  

```typescript
let proxy: any
const Comp = {
    props: {
        foo: Boolean,
        bar: Boolean,
        baz: Boolean,
        qux: Boolean,
        name: [ Boolean, String ],
        age: [ String, Boolean ],
        score: [ Object, Boolean ]
    },
    render() {
        proxy = this
    }
}

render(
    h(Comp, {
        bar: '',
        baz: 'baz',
        qux: 'ok',
        name: '',
        age: '',
        score: ''
    }),
    document.querySelector( '#root' )
)

// Comp 的 propsOptions 如下
[
    {
        foo: { type: Boolean, '0': true, '1': true },
        bar: { type: Boolean, '0': true, '1': true },
        baz: { type: Boolean, '0': true, '1': true },
        qux: { type: Boolean, '0': true, '1': true },
        name: { type: [ Boolean, String ], '0': true, '1': true },
        age: { type: [ String, Boolean ], '0': true, '1': false },
        score: { type: [ Object, Boolean, '0': true, '1': true ] }
    },
    [
        'foo', 'bar', 'baz', 'qux', 'name', 'age', 'score'
    ]
]
```    

现在对各个 `props` 进行分析，主要看的是 [resolvePropValue](#resolvePropValue) 中第二个 `if` 的逻辑   
调用 [resolvePropValue](#resolvePropValue) 之前，参数 `props` 是  

```typescript
{
    bar: '',
    baz: 'baz',
    qux: 'ok',
    name: '',
    age: '',
    score: ''
}
```

1. `foo`: 不存在于 `props` 中也没有默认值，所以它的值是 `false`  
2. `bar`: `BooleanFlags.shouldCastTrue` 为 `true` 且 `value` 是空字符串，所以它的值是 `true`  
3. `baz/name`: `BooleanFlags.shouldCastTrue` 为 `true` 且 `value` 和 kabab-case 的 `key` 相同，所以它的值是 `true`  
4. `qux`: 不满足任何条件，所以它的值还是原来的 `ok`  
5. `age`: 它的 `String` 优先于 `Boolean`，所以还是原来的 `''`  
6. `score`: 虽然它的 `Object` 优先于 `Boolean`，但是实际传的值却是 `''`，所以会将其转换为 `true`