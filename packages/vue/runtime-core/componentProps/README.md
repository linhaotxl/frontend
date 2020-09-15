**为了更加清楚理解源码的意义，代码的顺序做了调整**  

源码中会用到的工具函数  
1. [def 函数](https://github.com/linhaotxl/frontend/tree/master/packages/vue/shared#def)
2. [camelize 函数]()

<!-- TOC -->

- [initProps](#initprops)
    - [2.1. normalizePropsOptions](#21-normalizepropsoptions)
    - [2.2. BooleanFlags](#22-booleanflags)
    - [2.3. setFullProps](#23-setfullprops)
    - [2.4. resolvePropValue](#24-resolvepropvalue)
- [3. 更新 props](#3-更新-props)
    - [全量更新](#全量更新)
        - [示例一](#示例一)
        - [示例二](#示例二)
    - [优化更新](#优化更新)
        - [示例](#示例)

<!-- /TOC -->

# initProps  
`initProps` 用于初始化组件的 `props`，只会在第一次安装组件的时候执行，也就是 [setupComponent](https://github.com/linhaotxl/frontend/tree/master/packages/vue/runtime-core/component#setupComponent) 里会执行一次  

实现流程：
1. 对于每一个组件来说，都可以定义需要接受的 `props`，然后会遍历我们实际传递的 `props`，检测实际传递的是否存在于组件声明中的，如果存在，会放入组件实例的 `props` 中，否则会放入组价实例的 `attrs` 中  
2. 源码中对每一个属性名都会转驼峰处理，也就是说 `max-age` 和 `maxAge` 是同一个属性  

接下来看 `initProps` 的具体实现  
 
```typescript
/**
 * @param { ComponentInternalInstance } instance    组件实例
 * @param { Data | null }               rawProps    原始属性集合，即标签上写的所有属性集合
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
2. 对于函数组件，如果组件本身没有定义需要接受的 `props`，那么它的 `props` 和 `attrs` 会指向同一对象，就像下面这个组件  
    ```typescript
    const Comp = () => 'Comp';
    ```  
    
`initProps` 会通过 `setFullProps` 来设置，但在 `setFullProps` 中会首先调用 `normalizePropsOptions` 这个函数，所以先来看这个函数做了什么  

## 2.1. normalizePropsOptions  
每个组件定义的 `props` 格式会有多种，可以是数组，对象，如下  

```typescript
const Comp1 = {
    props: [ 'name', 'age' ]
}

const Comp2 = {
    props: {
        name: { type: String },
        age: { type: Number, default: 24 },
        sex: String,
        score: [ String, Number ]
    }
}
```  

所以这个函数的作用就是将 `props` 进行统一的格式处理，将每个 `prop` 转换为特殊的 “配置对象”  

```typescript
/**
 * @param { ComponentPropsOptions | undefined } raw 组件上定义的需要接受的 props
 */
export function normalizePropsOptions( raw: ComponentPropsOptions | undefined ): NormalizedPropsOptions | [] {
    // 处理组件没有定义自己的 props，直接返回空数组
    if (!raw) {
        return EMPTY_ARR as any
    }

    // 在最后会将解析完成的对象挂载在 props 的 _n 上，如果再次访问的话会直接获取，不会进行第二次的解析
    // 因为组件的 props 是不会变的，所以只需要解析一次就够了
    if ((raw as any)._n) {
        return (raw as any)._n
    }

    const normalized: NormalizedPropsOptions[0] = {}    // 配置对象集合
    const needCastKeys: NormalizedPropsOptions[1] = []  // 需要转换的 prop 名称

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
            // 将 “属性名” 驼峰化
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

## 2.2. BooleanFlags  
这是一个枚举，有两个值，在 [normalizePropsOptions](#normalizePropsOptions)  函数中，会设置给属性的配置对象，在接下来解析的函数 [resolvePropValue](#resolvePropValue) 中会用到  

```typescript
const enum BooleanFlags {
    shouldCast,
    shouldCastTrue
}
```  

* `shouldCast` 表示是否存在 `Boolean` 的属性  
* `shouldCastTrue` 表示是否需要将属性的值转换为 `true`

## 2.3. setFullProps  
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
            // 然后检测其是否在配置对象中，因为配置对象中的属性名都是 camel-case
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

注意：
1. 在 `attrs` 中的属性名，依旧是原始的属性名，而在 `props` 里的属性名，都是转换后的 camel-case 形式  

## 2.4. resolvePropValue  
这个方法主要处理需要转换的 `prop`，并返回转换后的值，主要有两种情况会转换  
1. 存在默认值 `default`  
2. 存在 `Boolean` 类型的属性

    如果一个属性定义的类型是 `Boolean` 但是实际传入的却不是 `Boolean`，此时就会对其进行转化处理，例如 `Comp` 组件会接受一个 `Boolean` 的属性 `foo`  
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

接下来看具体的实现  

```typescript
/**
 * @param { NormalizedPropsOptions[0] } options 组件的配置对象
 * @param { Data }                      props   组件实例上的 props
 * @param { string }                    key     待处理的属性名，这肯定是一个 camel-case 的形式
 * @param { unknown }                   value   使用组件传递的值
 */
function resolvePropValue(
  options: NormalizedPropsOptions[0],
  props: Data,
  key: string,
  value: unknown
) {
    // 获取属性的配置对象
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
                value = true
            }
        }
    }
    return value
}
```

# 3. 更新 props  
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
    
    // 获取组件定义的 props
    const rawOptions = instance.type.props
    // 获取组件实例的 props，因为组件的 props 会经过依次 shallowReactive 的转换
    // 所以这里要 toRaw 一次
    const rawCurrentProps = toRaw(props)
    // 获取组件的配置对象
    const { 0: options } = normalizePropsOptions(rawOptions)

    if ((optimized || patchFlag > 0) && !(patchFlag & PatchFlags.FULL_PROPS)) {
        // 优化更新
    } else {
        // 全量更新
    }
}
```  

## 全量更新  
实现流程：既然是全量更新，那肯定会再次调用 [setFullProps](#setFullProps) 方法来实现，调用之后，组件实例上的 `props` 和 `attrs` 肯定都是新的了，但是有一个问题，就是可能会存在之前旧的属性没有清除，所以接下来主要的步骤就是清除老的属性  

```typescript
// 全量更新 props，这一步会将旧的 props 和新的 props 合并到一起
setFullProps(instance, rawProps, props, attrs)

let kebabKey: string

// 遍历组件实例的 props，对于存在默认值的 prop 来说会恢复默认值(重置)，不存在就设置为 undefined(移除)
for (const key in rawCurrentProps) {
    // 什么时候需要重置和移除？
    // 1. 不存在新的 props
    // 2. 存在新的 props
    //  a. prop 为普通值，例如 name，此时如果在最新的 props 里没有这个值，就会被重置或删除
    //  b. prop 不是普通值，例如 max-age、maxAge，如果在最新的 props 里都没有 camel-case 和 kabab-case，就会被重置或移除
    if (
        !rawProps ||  // 新的 props 不存在  ①
        // 先检测最新 props 里是否含有 camel-case 的 key
        (!hasOwn(rawProps, key) &&         // ②
            // 有三种情况 rawProps 里不会存在 key
            // 1. 当前 key 是旧 props 里的 key，而不是新的里面的  name
            // 2. 旧的 key 是 camel-case，新的是 kabab-case    maxAge max-age
            // 3. 当前 key 是一个新的 kabab-case，只不过在这里被转换为 camel-case : max-age
            // 这个条件满足只能说明这个 key 是一个非 camel-case 的值，例如 name，而非 maxAge

            // 如果没有，则验证这是否是一个普通的 prop，如果是一个普通 prop，则证明这个 prop 是旧的，且不在新的里面
            // 需要移除或充值
            ((kebabKey = hyphenate(key)) === key || // ③
            
            // 如果不是一个普通 prop，则再检查是否存在 kabab-case 的 prop
            // 如果不存在，则说明这个 prop 是旧的，且新的里面没有，需要移除或充值
            // 如果存在，则说明当前 prop 是一个 kabab-case，而旧的 prop 却是一个 camel-case
            // 它们两个属于同一个 prop，所以这里也不会对其移除或重置
            !hasOwn(rawProps, kebabKey)))   // ④
    ) {
        // 能进入这个 if 里说明当前 key 是旧 props 里的
        // 需要重置或者移除
        if (options) {
            // 组件上声明了需要接受的 props
            if (rawPrevProps && rawPrevProps[kebabKey!] !== undefined) {
                // 恢复 props 为默认值，如果没有就是 undefined
                props[key] = resolvePropValue(
                    options,
                    rawProps || EMPTY_OBJ,
                    key,
                    undefined
                )
            }
        } else {
            // 组件上没有声明需要接受的 props，直接将这个 key 移除
            // 如果是一个没有声明接受 props 的 FC，那么它的 props 和 attrs 指向同一个对象
            // 在挂载时它接受 props 为 { name: 'IconMan' }，更新变成了 { age: 24 }
            // 此时会进入 else 删除之前旧的 prop
            delete props[key]
        }
    }
}

// 处理 attrs
// 只有没有定义 props 的 FC，它的 props 和 attrs 才指向同一个对象，而它的 props 已经在上面处理过了，所以不需要再对 attrs 处理
if (attrs !== rawCurrentProps) {
    // 遍历了所有的 attrs，此时的 attrs 包含的是旧的和新的，在两种情况下会把这个 prop 移除
    // 1. 没有新的 props 传递，此时会移除所有的 attrs
    // 2. 有新的 props，但是 attr 不在新的 props 中，说明是旧的
    // rawProps 是新的所有 props 集合，如果 key 不存在于其中，那么说明这个 key 是旧的，需要移除
    for (const key in attrs) {
        if (!rawProps || !hasOwn(rawProps, key)) {
            delete attrs[key]
        }
    }
}

```  

### 示例一  
```typescript
const root = document.querySelector( '#root' );
const Comp = defineComponent({
    props: [ 'fooBar' ],
    render() {
        return h('div')
    }
});
/**
 * Comp 的 props 配置对象解析为
 * {
 *   fooBar: {}
 * }
 */

// 渲染 Comp 组件，并传递两个 props，fooBar 和 bar
render( h(Comp, { fooBar: 1, bar: 2 }), root )
// 渲染完成后，Comp 组件实例上的 props 是 { fooBar: 1 }，attrs 是 { bar: 2 }

// 更新 Comp 组件
// 更新过程中，在 ② 处，最新的 props 里没有 fooBar，在 ③ 处 fooBar 和 foo-bar 不相等，在 ④ 处，最新的 props 里存在 foo-bar
// 所以这个属性不会被删除或重置
render( h(Comp, { 'foo-bar': 2, bar: 3, baz: 4 }), root )
// 更新完成后，Comp 组件实例上的 props 是 { fooBar: 2 }, attrs: { bar: 3, baz: 4 }

// 更新 Comp 组件
// 更新过程中，在 ② 处，最新的 props 里没有 fooBar，在 ③ 处 fooBar 和 foo-bar 不相等，在 ④ 处，最新的 props 里存在 foo-bar
// 所以这个属性不会被删除或重置
render( h(Comp, { 'foo-bar': 3, bar: 3, baz: 4 }), root )
// 更新完成后，Comp 组件实例上的 props 是 { fooBar: 3 }, attrs: { bar: 3, baz: 4 }

// 更新 Comp 组件
// 更新过程中，在 ② 处，最新的 props 里没有 fooBar，在 ③ 处 fooBar 和 foo-bar 不相等，在 ④ 处，最新的 props 里也没有 foo-bar
// 所以这个属性会被重置
render( h(Comp, { qux: 5 }), root )
// 更新完成后，Comp 组件实例上的 props 是 { fooBar: undefined }, attrs: { qux: 5 }
```

### 示例二  
```typescript
const root = document.querySelector( '#root' );
const Comp: FunctionalComponent = ( _props, { attrs: _attrs } ) => {
    return h('div');
}

// 挂载 Comp 组件，Comp 组件实例的 props === attrs
render( h(Comp, { foo: 1 }), root );
// 挂载完成后，Comp 组件实例的 props/attrs 是 { foo: 1 }

// 更新 Comp 组件
// 更新过程中，最新的 props 里不存在 foo，所以重置 foo
render(h(Comp, { bar: 2 }), root)
// 更新完成后，Comp 组件实例的 props/attrs 是 { foo: undefined, bar: 2 }
```

## 优化更新  
只需要更新会变化的 `props`，而会变化的 `props` 是记录在 `vnode` 的 `dynamicProps` 上的，所以只需要遍历 `dynamicProps`，  

```typescript
if (patchFlag & PatchFlags.PROPS) {
    // Compiler-generated props & no keys change, just set the updated
    // the props.
    const propsToUpdate = instance.vnode.dynamicProps!
    for (let i = 0; i < propsToUpdate.length; i++) {
        const key = propsToUpdate[i]
        // PROPS flag guarantees rawProps to be non-null
        const value = rawProps![key]
        if (options) {
            // attr / props separation was done on init and will be consistent
            // in this code path, so just check if attrs have it.
            if (hasOwn(attrs, key)) {
                attrs[key] = value
            } else {
                const camelizedKey = camelize(key)
                props[camelizedKey] = resolvePropValue(
                    options,
                    rawCurrentProps,
                    camelizedKey,
                    value
                )
            }
        } else {
            attrs[key] = value
        }
    }
}
```  

### 示例  
```typescript
const foo = ref(1)
const id = ref('a')

const Child = defineComponent({
    props: ['foo'],
    template: `<div>{{ foo }}</div>`
});

const Comp = defineComponent({
    setup() {
        return {
            foo,
            id
        }
    },
    components: { Child },
    template: `<Child :foo="foo" :id="id"/>`
});
```