<!-- TOC -->

- [什么是响应式对象](#什么是响应式对象)
- [响应式对象的分类](#响应式对象的分类)
- [响应式标识位](#响应式标识位)
- [原始对象和响应对象映射关系](#原始对象和响应对象映射关系)
- [各种类型的响应对象](#各种类型的响应对象)
    - [创建响应式对象](#创建响应式对象)
    - [普通响应式对象](#普通响应式对象)
    - [浅层响应式对象](#浅层响应式对象)
    - [只读普通响应式对象](#只读普通响应式对象)
    - [浅层只读响应式对象](#浅层只读响应式对象)

<!-- /TOC -->

## 什么是响应式对象  
所谓 “响应式”，就是指当数据发生变化的时候，能自动执行一些操作，这些操作本称为 “副作用”  
在 Vue 中，副作用就是更新组件的函数，所以当数据发生变化时，就会自动更新组件，从而实现 数据 -> 视图 的更新  

在 3.x 的版本，响应式对象是通过 `ES6` 的 `Proxy` 来实现的，我们之后称代理后的对象为响应对象，代理前的对象称为原始对象，如下  

```typescript
const 响应对象 = new Proxy( 原始对象, 拦截处理 );
```  

## 响应式对象的分类  
总共可以分为 4 种类型，分别是  
1. 普通响应式对象  
2. 浅层响应式对象  
3. 只读普通响应式对象  
4. 浅层只读响应式对象  

接下来会先解释上面出现的几个名词，明白这些名词的意义，就能弄清这几种类型的区别  

1. 普通  
   这种类型的特点是，当从 “响应对象” 中获取到一个属性值时，如果这个值的类型是对象的话，那么会对这个值再次响应化  
   这样就能做到 “懒响应”，只有当真正用到的时候才会去 “响应化”，而不是一开始就对所有值做 “响应化” 处理  
2. 浅层  
   和 ”普通“ 相反，当从 ”响应对象“ 中获取到一个属性值时，无论是否是对象，都会直接返回获取到的值  
3. 只读  
   从名字上就可以看出，这种类型是无法修改里面的属性值，即使修改也不会成功，而且还会报错    

## 响应式标识位   
在源码中，存在 4 个特殊的标识，也可以理解为特殊的属性，这 4 个属性既可以通过 “原始对象” 访问，也可以通过 “响应对象” 访问，如下  

```ts
export const enum ReactiveFlags {
    SKIP = '__v_skip',                  // 跳过，如果为 true，则说明当前对象不需要进行响应式
    IS_REACTIVE = '__v_isReactive',     // 是否是响应式对象，包括上面说的 4 种类型
    IS_READONLY = '__v_isReadonly',     // 是否是只读响应式对象，只包括只读的两种类型
    RAW = '__v_raw'                     // 获取 响应对象 的 原始对象
}
```  

**注意：**  
1. 上面只有 `SKIP` 这一个属性是真正存在于对象上的   
   而剩下的三个则并没有，这是因为这三个都需要通过 “响应对象” 访问才能获取到，进一步在 “拦截处理” 里被拦截到，获取到最终结果的，在之后的内容中会看到  
2. `IS_REACTIVE` 和 `IS_READONLY` 不会同时为 `true`，它们始终是 互斥的  

## 原始对象和响应对象映射关系  
在源码中，定义了两个 `Map` 对象，用来存储 *原始对象* 和 *响应对象* 间的映射关系，这两个对象被称为 **映射关系对象**  

```typescript
export interface Target {
    [ReactiveFlags.SKIP]?: boolean
    [ReactiveFlags.IS_REACTIVE]?: boolean
    [ReactiveFlags.IS_READONLY]?: boolean
    [ReactiveFlags.RAW]?: any
}

const reactiveMap = new WeakMap<Target, any>()	// 原始对象 -> 响应对象，存储 普通、浅层
const readonlyMap = new WeakMap<Target, any>()	// 原始对象 -> 响应对象，存储 只读普通、浅层只读
```  

每当生成一个响应式对象，就会将其和与之对应的原始对象存入这个集合中  
可以将它们理解为缓存对象，如果对同一个 “原始对象” 多次响应化，那么只会创建一个 “响应对象”，之后每次都会从这个缓存中读取   

## 各种类型的响应对象  
接下来看上面 4 种类型的响应式对象在源码中是如何实现的  

在此之前需要先了解一下原始对象的类型，源码中按照 “集合”、“非集合” 和 “无效” 将原始对象分为三种类型  
  
```ts
// 原始对象的类型
const enum TargetType {
    INVALID = 0,    // 无效
    COMMON = 1,     // 非集合
    COLLECTION = 2  // 集合
}
```  

封装了一个获取类型的函数  
  
```ts
function targetTypeMap(rawType: string) {
    switch (rawType) {
        case 'Object':
        case 'Array':
            return TargetType.COMMON
        case 'Map':
        case 'Set':
        case 'WeakMap':
        case 'WeakSet':
            return TargetType.COLLECTION
        default:
            return TargetType.INVALID
    }
}
```  
“集合” 就是 `Map`、`Set`、`WeakMap` 和 `WeakSet` 这四种，而 “非集合” 就是除这四种之外的对象，例如普通对象，数组  
其中，“无效” 是除上面几种之外的数据，而且 “无效” 的数据不会进行响应化操作  

参数 `rawType` 就是对象的实际类型，通过 `Object.prototype.toString.call` 来获取并截取后面的类型字符串  
这个操作也被封装为一个函数  

```ts
export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string => objectToString.call(value)

export const toRawType = (value: unknown): string => {
  return toTypeString(value).slice(8, -1)
}

function getTargetType(value: Target) {
    return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
        ? TargetType.INVALID
        : targetTypeMap(toRawType(value))
}
```  

可以看出，有两种数据是不会进行响应化的  
1. 带有 `ReactiveFlags.SKIP` 标识的，说明这是一个不需要 “响应化” 的对象  
2. 是一个不可扩展的对象  

### 创建响应式对象  
上面说过的 4 种响应式对象，其实都是通过一个函数来创建的，只不过每种类型的参数不同，接下来先介绍各个参数的意义  
1. `target`：原始对象  
2. `isReadonly`：是否是只读响应对象  
3. `baseHandlers`：非集合响应对象的拦截处理  
4. `collectionHandlers`：集合响应对象的拦截处理  

最后两个参数其实就是 `new Proxy(原始对象，拦截处理)` 的第二个参数，而且 “集合” 和 “非集合” 的拦截处理是不一样的  

先来看具体的实现  

```ts
function createReactiveObject(
    target: Target,
    isReadonly: boolean,
    baseHandlers: ProxyHandler<any>,
    collectionHandlers: ProxyHandler<any>
) {
    // 1. 检测原始对象是否是一个对象，如果不是，则报错，并直接返回
    if (!isObject(target)) {
        if (__DEV__) {
            console.warn(`value cannot be made reactive: ${String(target)}`)
        }
        return target
    }
    
    // 2. 处理 原始对象 是一个 响应对象 的情况，那么会直接返回这个 响应对象
    //    响应对象肯定存在 ReactiveFlags.RAW
    //    只读 - isReadonly 为 true，ReactiveFlags.IS_REACTIVE 为 false
    //    非只读 - isReadonly 为 false
    if (
        target[ReactiveFlags.RAW] &&
        !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
    ) {
        return target
    }
    
    // 3. 根据是否是只读来获取 映射关系对象
    const proxyMap = isReadonly ? readonlyMap : reactiveMap
    
    // 4. 如果 映射关系 中已经存在，则直接返回
    const existingProxy = proxyMap.get(target)
    if (existingProxy) {
        return existingProxy
    }
    
    // 5. 获取原始对象的类型，如果是无效，则直接返回原始对象
    const targetType = getTargetType(target)
    if (targetType === TargetType.INVALID) {
        return target
    }
    
    // 6. 创建 响应对象，并根据原始对象的类型，来决定使用 集合 还是 非集合 的拦截处理
    const proxy = new Proxy(
        target,
        targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
    )
    
    // 7. 将 原始对象 和 响应对象 存储在 映射关系对象 中
    proxyMap.set(target, proxy)
    
    // 8. 返回响应对象
    return proxy
}
```  

这个函数的内容并不复杂，它可以创建 4 种类型中的任意一种，原因就是每种类型的 “拦截处理” 是不一样的，所以 “拦截处理” 是接下来的重点  

接下来看 4 种响应式对象的实现  

### 普通响应式对象  

```ts
export function reactive(target: object) {
	// 如果 target 本身就是一个 只读响应对象，则不会再对其进行响应，直接返回 只读响应对象
	if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
		return target
	}

	return createReactiveObject(
		target,
		false,                      // 非只读
		mutableHandlers,            // 普通响应 - 非集合 拦截处理
		mutableCollectionHandlers   // 普通响应 - 集合 拦截处理
	)
}
```  

注意，如果 “原始对象” 本身就是一个 “只读响应对象” 的话，那么会直接返回这个 “只读响应对象”  

### 浅层响应式对象  
```ts
export function shallowReactive<T extends object>(target: T): T {
    return createReactiveObject(
        target,
        false,                      // 非只读
        shallowReactiveHandlers,    // 浅层响应 - 非集合 拦截处理
        shallowCollectionHandlers   // 浅层响应 - 集合 拦截处理
    )
}
```  

### 只读普通响应式对象  
```ts
export function readonly<T extends object>(
    target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
    return createReactiveObject(
        target,
        true,                       // 只读
        readonlyHandlers,           // 只读普通响应 - 非集合 拦截处理
        readonlyCollectionHandlers  // 只读普通响应 - 集合 拦截处理
    )
}
```  

### 浅层只读响应式对象  
```ts
export function shallowReadonly<T extends object>(
    target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
    return createReactiveObject(
        target,
        true,                       // 只读
        shallowReadonlyHandlers,    // 浅层只读响应 - 非集合 拦截处理
        readonlyCollectionHandlers  // 浅层只读响应 - 集合 拦截处理
    )
}
```  

可以看出，上面总共出现了 8 种拦截处理方式，在之后的小节会按照 “非集合” 与 “集合” 两块来介绍  
不用担心，虽然看着很多，但其实实现方式都是一样的，只不过参数不同，所以结果也就不同而已  
