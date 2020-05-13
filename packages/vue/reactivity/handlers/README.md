**为了更加清楚理解源码的意义，代码的顺序做了调整**    

经过上一节 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 的分析后，我们已经知道创建响应对象的流程了，但其中比较难的是代理的操作方式，这一章主要就看几个代理的处理方式  

我们已经知道的有 4 中方式，主要可以分为两大类型  
1. 非集合型  
    1. `mutableHandlers`: 用于普通响应对象，即 `reactive` 的产物  
    2. `shallowReactiveHandlers`: 用于普通非嵌套响应对象，即 `shallowReactive` 产物  
    3. `readonlyHandlers`: 用于只读响应对象，即 `readonly` 产物  
    4. `shallowReadonlyHandlers`: 用于只读非嵌套响应对象，即 `shallowReadonly` 产物
2. 集合型  
    1. `mutableCollectionHandlers`: 用于所有普通响应对象，即 `reactive` 和 `shallowReactive` 产物  
    2. `readonlyCollectionHandlers`: 用于所有只读响应对象，即 `readonly` 和 `shallowReadonly` 产物  

在源码中，只代理了 5 种操作方式，分别是  
1. `get`: 读取属性  
2. `set`: 更新属性  
3. `has`: 检测指定属性是否存在，`propKey in proxyObj`  
4. `deleteProperty`: 删除属性，`delete proxyObj[propKey]`  
5. `ownKeys`: 迭代属性  

所以接下来就终点讨论这几个的实现方式  

# 非集合型代理  

## builtInSymbols  
这个变量是一个 `Set` 集合，存储的是所有内置的 `Symbol` 值  

```typescript
const builtInSymbols = new Set(
  Object.getOwnPropertyNames( Symbol )
    .map( key => (Symbol as any)[key] )
    .filter( isSymbol )
)
```

## get   
`get` 在源码中会有一个工厂方法 `createGetter` 来创建不同的功能 `get`，这个方法接收两个参数  
1. 是否只读 `isReadonly`  
2. 是否浅响应（ 就是嵌套响应 ） `shallow`  

```typescript
function createGetter( isReadonly = false, shallow = false ) {
  return function get( target: object, key: string | symbol, receiver: object ) {
    // 检测原始对象是否是数组
    const targetIsArray = isArray( target )
    // 检测访问的是否是 indexOf、lastIndexOf 和 includes 三个属性方法
    if ( targetIsArray && hasOwn( arrayInstrumentations, key ) ) {
      // TODO 这里的 receiver 参数还不明白，不过有一个测试用例可以查看
      return Reflect.get( arrayInstrumentations, key, receiver )
    }

    // 获取原属性值
    const res = Reflect.get( target, key, receiver )

    // ①
    // 检测属性是否是内置 Symbol 值，内置属性名不会被追踪，会直接返回其值
    // effect.spec.ts -> 18 ref.spec.ts -> 10
    if ( isSymbol( key ) && builtInSymbols.has( key ) ) {
      return res
    }

    // ②
    // 如果是浅响应式，那么直接返回 get 到的值，并进行追踪
    if ( shallow ) {
      !isReadonly && track(target, TrackOpTypes.GET, key)
      return res
    }

    // ③
    // 检测属性值是否是 ref 对象
    // 如果原始对象是数组，则获取到的就是 ref 对象；否则直接获取到的就是 ref.value
    // const observal = reactive( { b: ref( 0 ) } );
    // observal.b -> 0  observal.b  是一个 ref 对象，直接获取 ref 的原始值
    if ( isRef( res ) ) {
      if (targetIsArray) {
        // TODO
        !isReadonly && track( target, TrackOpTypes.GET, key )
        return res
      } else {
        return res.value
      }
    }

    // ④
    // 非只读属性需要追踪
    !isReadonly && track( target, TrackOpTypes.GET, key )

    // 检测结果是否是对象
    return isObject( res )
      // 是的话，需要对其进行响应式，这也就是 vue3.0 中，只有在 getter 的时候才会对嵌套的对象进行响应化
      // 而不是一开始就递归整个对象
      ? isReadonly
        ? readonly( res )
        : reactive( res )
      : res
  }
}
```  

1. `createGetter` 函数返回的 `get` 方法，最终会被用在 `new Proxy( {}, { get } )` 中，所以它有三个参数   
2. 首先最后的 `return`，会判断读取的结果是否是对象  
    * 如果不是直接返回出来  
    * 如果是话的，会再将这个对象响应化，根据是否只读变量 `isReadonly` 来进行不同的响应化  
    这也就是在 Vue3.0 中，响应化的懒加载处理，并不会一开始就递归将整个对象内部响应化，而是等到真正用的时候才会进行  
3. 在 ① 处，判断了属性 `key` 的类型，如果是内置 `Symbol` 值的话，那么就会直接返回对应的值，不再进行任何处理  

```typescript
const customSymbol = Symbol()
const original = {
    [ Symbol.asyncIterator ]: { a: 1 },
    [ Symbol.unscopables ]: { b: '1' },
    [ customSymbol ]: { c: [ 1, 2, 3 ] }
}
const observal = reacitve( original );

isReactive( observal[ Symbol.asyncIterator ] );  // false
isReactive( observal[ Symbol.unscopables ] );    // false
isReactive( observal[ customSymbol ] );          // true
```   

4. 在 ② 处，判断了是否是浅响应式，根据之前说的代理方式可以知道，在 `shallowReactiveHandlers` 和 `shallowReadonlyHandlers` 中，`createGetter` 的参数 `shallow` 肯定为 `true`，所以会进入 `if` 中  

```typescript
const original = { n: { foo: 1 } };
const observal = shallowReactive( original )
isReactive( observal );     // true
isReactive( observal.n );   // false
```  

5. 在 ③ 处，判断了结果是否是 `ref`，可以先参考 [ref](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/ref) 的文章了解其内容  
    * 当一个数组里存在 `ref` 元素，我们获取这个元素实际获取到的就是 `ref` 对象  
    * 当一个对象里存在 `ref` 对象，我们获取这个值实际获取到的就是 `ref` 对象真正的 `value` 值  

```typescript
const ref = ref( 1 );
const originalArray  = [ ref ];
const originalObject = { ref };
const observalArray  = reactive( originalArray );
const observalObject = reactive( originalObject );

observalArray[0] === ref;   // true
observalArray[0].value;     // 1
observalObject.ref;         // 1
```  

可以看到，当访问 `observalArray[0]` 时，由于获取到的是一个 `ref` 对象，而且原始对象是一个数组，所以会直接返回这个 `ref` 对象，要再进一步获取绑定的值就要访问 `value` 属性  
当访问 `observalObject.ref` 时，原始对象不是数组，所以直接会将 `ref` 对象的绑定的值返回，也就是 `1`

由于 `observal` 是浅响应式的，在 `observal.n` 中满足条件，就会直接返回对应的值，而不会再对其响应式

访问 `observal[ customSymbol ]` 是，实际返回的是经过 `reactive` 处理的响应对象，而访问 `observal[ Symbol.asyncIterator ]` 时，由于 `Symbol.asyncIterator` 属于内置 `Symbol` 值，所以不会再进行处理，直接返回对应的值

# 集合型代理