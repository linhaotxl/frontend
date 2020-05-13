**为了更加清楚理解源码的意义，代码的顺序做了调整**  

<!-- TOC -->

- [Reactive](#reactive)
    - [原始对象和响应对象映射关系](#原始对象和响应对象映射关系)
        - [isReactive](#isreactive)
        - [isReadonly](#isreadonly)
        - [toRaw](#toraw)
    - [标记为原始对象](#标记为原始对象)
    - [可响应化的数据类型](#可响应化的数据类型)
    - [canObserve](#canobserve)
    - [collectionTypes](#collectiontypes)
    - [createReactiveObject](#createreactiveobject)
    - [reactive](#reactive)
    - [shallowReactive](#shallowreactive)
    - [readonly](#readonly)
    - [shallowReadonly](#shallowreadonly)
    - [注意](#注意)

<!-- /TOC -->

# Reactive  
reactive 也就是响应式对象，在这个版本中是通过 `ES6` 的 `Proxy` 来实现的，我们称代理后的对象为响应对象，代理前的对象称为原始对象，如下  
```typescript
const 响应对象 = new Proxy( 原始对象, { /**/ } );
```  

## 原始对象和响应对象映射关系  
在源码中，定义了几个变量，用来存储 ”原始对象“ 和 ”响应对象“ 的关系，它们都是 `Map` 的实例，所以 `key` 都是对象类型  

```typescript
const rawToReactive = new WeakMap<any, any>() // 原始对象 -> 响应对象
const reactiveToRaw = new WeakMap<any, any>() // 响应对象 -> 原始对象
```  
这两个变量存储的是普通的响应对象和原始对象间的映射关系，是通过 `reactive` 方法产生  

```typescript
const rawToReadonly = new WeakMap<any, any>() // 只读原始对象 -> 只读响应对象
const readonlyToRaw = new WeakMap<any, any>() // 只读响应对象 -> 只读原始对象
```  
这两个变量存储的是只读的响应对象和原始对象间的映射关系，是通过 `readonly` 方法产生  

由这几个变量会引申出几个方法，下面一个一个来看  

### isReactive  
这个方法用来检测一个对象是否是响应对象，根据前面的变量大概可以猜出它的实现方式就是调用 `reactiveToRaw.has` 方法来检测是否含有指定值  

```typescript
function isReactive( value: unknown ): boolean {
  value = readonlyToRaw.get( value ) || value
  return reactiveToRaw.has( value );
}
```  

只要存在于 `reactiveToRaw` 集合中的对象都被认为是响应对象，但为什么会先从 `readonlyToRaw` 获取一次呢？先看下面这个示例  
```typescript
const a = { n: 1 };
const b = reactive( a );
const c = readonly( b );
isReactive( c );  // true
```  

上面代码执行完成后，映射关系如下  
```typescript
rawToReactive: Map { a -> b }
reactiveToRaw: Map { b -> a }
rawToReadonly: Map { b -> c }
readonlyToRaw: Map { c -> b }
```  

当 `readonly` 的参数是一个响应对象时候，那么返回的这个对象（ 示例中的 `c` ）也应该是一个响应对象，因为它只是把原来的响应对象变为只读的了  

所以，如果参数是一个经过 `readonly` 的响应对象，会先获取它的原始对象（ 这个原始对象会是一个普通的响应对象 ），然后再检测这个普通的响应对象

### isReadonly  
这个方法就是用来检测一个对象是否是只读响应对象，它的实现就是单纯的调用 `readonlyToRaw.has`  

```typescript
function isReadonly( value: unknown ): boolean {
  return readonlyToRaw.has( value )
}
```  

### toRaw  
这个方法会获取响应对象的原始对象，如果不是响应对象那么就会返回参数自身  

```typescript
function toRaw<T>(observed: T): T {
  observed = readonlyToRaw.get( observed ) || observed
  // 从 reactiveToRaw 中获取原始对象，如果没有则返回 observed 自身
  return reactiveToRaw.get( observed ) || observed
}
```  

为什么会先从 `readonlyToRaw` 获取一次？基于上面的示例  
```typescript
toRaw( b ) === toRaw( c );  // true
```  
原理和 `isReactive` 相似，在示例中，`b` 和 `c` 的原始对象应该都是同一个，因为 `c` 只是将 `b` 变为只读  
所以在源码中，如果参数是一个经过 `readonly` 的包装对象，会先获取它的原始对象（ 这个原始对象是一个响应对象 ），然后再获取这个响应对象的原始对象  

## 标记为原始对象  
通常，普通的对象是可以进行响应化的，但是我们可以通过 `markRaw` 方法，将某个对象标记为原始类型，那么这个对象就无法再被响应化了，即 `reactive( 被标记对象 )` 的结果还是被标记对象本身，不会进行任何的代理

```typescript
// 保存标记对象的集合
const rawValues = new WeakSet<any>()
function markRaw<T extends object>( value: T ): T {
  rawValues.add( value )
  return value
}
```  
可以看到，只要在 `rawValues` 集合中的对象都被认为被标记的原始对象  

## 可响应化的数据类型  
只有以下几种数据类型是可以被响应化的  

```typescript
// 可观察对象的类型
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)
```  

经过 `makeMap` 处理，最终 `isObservableType` 的形式如下  
```typescript
const obj = {
    'Object': true,
    'Array': true,
    'Map': true,
    'Set': true,
    'WeakMap': true,
    'WeakSet': true,
};
const isObservableType = val => !!obj[ val ];
```  

这个方法就是检测某一数据类型是否可以被响应化  

## canObserve  
这个方法主要是检测某一对象是否可以被响应化，只有同时满足以下的条件才可以  

```typescript
const canObserve = ( value: any ): boolean => {
  return (
    !value._isVue &&                        // vue 实例对象不可观察
    !value._isVNode &&                      // 虚拟节点不可观察
    isObservableType(toRawType(value)) &&   // 满足指定类型对象可观察
    !rawValues.has(value) &&                // 被标记为基本类型的对象不可观察
    !Object.isFrozen(value)                 // 冻结对象不可观察
  )
}
```  
其中 `toRawType( value )` 就是 `Object.prototype.toString.call( value )`  

## collectionTypes  
这个变量主要存储的是几种集合类型，在之后 `new Proxy()` 的时候，代理的操作会和非集合类型有所不同

```typescript
const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
```  

## createReactiveObject  
这个方法是专门用来创建响应对象的，并返回响应对象，接受五个参数，分别是  
1. 原始对象  
2. 原始对象 -> 响应对象的集合，就是上面的 `rawToReactive` 和 `rawToReadonly` 其中之一  
3. 响应对象 -> 原始对象的集合，就是上面的 `reactiveToRaw` 和 `readonlyToRaw` 其中之一  
4. 处理非集合类型的代理  
5. 处理集合类型的代理  

可以看出，这个方法只是创建响应对象，但具体创建哪种类型的，是由外部方法决定的，先来看这个方法的实现  

```typescript
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 检测如果不是对象，直接返回 
  if ( !isObject( target ) ) {
    return target
  }

  // 从 原始 -> 响应 集合中，根据原始对象作为 key 取出对应的值，如果值存在就直接返回该值
  // 这步的目的是如果对同一对象多次进行创建，那么之后获得的都是同一响应对象
  let observed = toProxy.get( target )
  if ( observed !== void 0 ) {
    return observed
  }

  // 检测 响应 -> 原始 集合中，是否存在 target，如果存在直接返回 target
  // 这步的目的是 target 本身就是一个响应对象，那么再次创建不会产生一个新的响应对象，还是之前的那个  
  if ( toRaw.has( target ) ) {
    return target
  }

  // 检测是否可观察，如果不可观察直接返回原始对象
  if ( !canObserve( target ) ) {
    return target
  }

  // 设置不同处理代理的方式
  // 如果 targer 是集合类型，则使用 collectionHandlers 作为代理，否则使用 baseHandlers 作代理
  const handlers = collectionTypes.has( target.constructor )
    ? collectionHandlers
    : baseHandlers
  
  // 为原始对象设置代理
  observed = new Proxy( target, handlers )

  // 更新 原始 -> 响应 和 响应 -> 原始两个集合
  toProxy.set( target, observed )
  toRaw.set( observed, target )

  // 返回响应对象
  return observed
}
```  

这个方法的实现不算太复杂，主要就是为 `target` 设置了代理，并根据数据类型设置不同的代理方式，这里面难的是代理方式，总共会有四种，后面会讲到    

## reactive  
这个方法接受一个原始对象作为参数，会生成一个普通的响应对象  

```typescript
function reactive<T extends object>( target: T ): UnwrapNestedRefs<T> {
  // 如果对一个只读响应对象（ 使用过 readonly 的对象 ）使用 reactive 的话，那么会返回这个只读响应对象，而不会新创建一个
  if ( readonlyToRaw.has( target ) ) {
    return target
  }

  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}
```  

先不看第一个判断条件，最终会调用 `createReactiveObject` 方法生成响应对象，观察传入的参数  
1. 传入的集合分别是 `rawToReactive` 和 `reactiveToRaw`，所以通过 `reactive` 生成的响应对象，会将原始对象和响应对象的关系存入 `rawToReactive` 和 `reactiveToRaw`  
2. 传入的代理方法分别是 `mutableHandlers` 和 `mutableCollectionHandlers`，所以通过 `reactive` 生成的响应对象，如果原始对象是集合类型，代理就是 `mutableCollectionHandlers`，否则就是 `mutableHandlers`    

## shallowReactive  
这个方法和 `reactive` 不同之处就在于，该方法产生的响应对象不会嵌套响应，举例来说  

```typescript
const original = {
    info: {
        name: 'IconMan'
    }
}
const observal1 = reactive( original );
const observal2 = shallowReactive( original );
```  

此时，`observal1.info` 得到的还是一个响应对象，而 `observal2.info` 得到的就是原始对象本身  
它的实现和 `reactive` 不同之处就在于代理方式不同，`shallowReactive` 采用 `shallowReactiveHandlers` 作代理方式  

```typescript
function shallowReactive<T extends object>( target: T ): T {
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    shallowReactiveHandlers,
    mutableCollectionHandlers
  )
}
```

## readonly   
这个方法接受一个原始对象作为参数，会生成一个只读的响应对象  

```typescript
function readonly<T extends object>( target: T ): Readonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}
```   

可以看到，和 `reactive` 不同的就是后面几个参数  
1. 通过 `readonly` 生成的响应对象，会将 ”原始对象“ 和 ”响应对象“ 的关系存入 `rawToReadonly` 和 `readonlyToRaw` 中  
2. 通过 `readonly` 生成的响应对象，如果原始对是集合类型，在会使用 `readonlyCollectionHandlers` 代理，否则使用 `readonlyHandlers` 代理  

## shallowReadonly  
这个方法生成的只读响应对象，也是不可嵌套的，实现也比较简单，采用的是 `shallowReadonlyHandlers` 代理  

```typescript
function shallowReadonly<T extends object>( target: T ): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}
```  

## 注意  
1. 在 `reactive` 方法中，首先会有一个判断条件，目的就在处理参数是响应对象的情况，看下面这个示例  

```typescript
const original = {};
const readObserval = reaconly( original );
const observal = reactive( readObserval );
isReadonly( observal ); // true
```  

可以看到，`observal` 应该也是属于只读响应对象，所以会先判断，如果参数是响应对象，就直接返回，而不会再重新创建一个