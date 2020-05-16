**为了更加清楚理解源码的意义，代码的顺序做了调整**   

- [非集合型代理](#非集合型代理)
    - [builtInSymbols](#builtinsymbols)
    - [get](#get)
        - [arrayInstrumentations](#arrayinstrumentations)
        - [不同功能的 get](#不同功能的-get)
    - [set](#set)
- [集合型代理](#集合型代理)
- [TODO](#todo)

在代码中会涉及到 `track` 和 `trigger` 两种操作，这两种不会放在本篇中分析，具体可以参考 [track](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#track) 和 [trigger](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#trigger)

经过上一节 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 的分析后，我们已经知道创建响应对象的流程了，但其中的难点就是各自的代理方式  

我们已经知道的有 6 中方式，主要可以分为两大类型  
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

在 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 源码中，我们知道上述 6 种代理方式都作为 `new Proxy` 的第二个参数，所以它们都是一个对象，所以都含有 `get`、`set`、`has`、`deleteProperty` 和 `ownKeys` 这五种属性，接下来就一个一个来看  

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
    // 检测访问的是否是数组的 indexOf、lastIndexOf 和 includes 三个属性方法
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

1. `createGetter` 函数返回的 `get` 函数，最终会被用在 `new Proxy( {}, { get } )` 中，所以它有三个参数   
2. 首先看最后的 `return`，会判断读取的结果是否是对象  
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

访问 `observal[ customSymbol ]` 是，实际返回的是经过 `reactive` 处理的响应对象，而访问 `observal[ Symbol.asyncIterator ]` 时，由于 `Symbol.asyncIterator` 属于内置 `Symbol` 值，所以不会再进行处理，直接返回对应的值  

4. 在 ② 处，判断了是否是浅响应式，根据之前说的代理方式可以知道，在 `shallowReactiveHandlers` 和 `shallowReadonlyHandlers` 中，`createGetter` 的参数 `shallow` 肯定为 `true`，所以会进入 `if` 中  

```typescript
const original = { n: { foo: 1 } };
const observal = shallowReactive( original )
isReactive( observal );     // true
isReactive( observal.n );   // false
```   

由于 `observal` 是浅响应式的，在 `observal.n` 中满足条件，就会直接返回对应的值，而不会再对其响应式  

5. 在 ③ 处，判断了结果是否是 `ref`，可以先参考 [ref](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/ref) 的文章了解其内容  
    * 当一个数组里存在 `ref` 元素，我们获取这个元素实际获取到的就是 `ref` 对象  
    * 当一个对象里存在 `ref` 对象，我们获取这个值实际获取到的就是 `ref` 对象绑定的 `value` 值  

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

6. 在整个 `get` 函数中，可以看到只对 “非只读响应对象” 做了 `track` 追踪，这是因为只读对象不可被修改，所以再不必追踪了  

### arrayInstrumentations  
这个变量存储了三个属性，分别是 `indexOf`、`lastIndexOf` 和 `includes`，且值都是一个函数，在 `get` 函数中，如果访问的是数组的这三个方法，那么是不会走正常的流程，而是会执行 `arrayInstrumentations` 中的函数，先来看这个对象的实现  
  
```typescript
const arrayInstrumentations: Record<string, Function> = {}

;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function( ...args: any[] ): any {
    // ①
    // 这里的 this 指向的是 proxy 对象，所以必须先获取原始的数组对象
    // 如果不获取原始对象，那么后面继续在代理对象上调用方法，就会进入 getter 从而再一次进入这里
    // 造成死循环
    const arr = toRaw( this ) as any

    // ②
    // 这里追踪了数组里的每一项元素和 length
    // 目的是如果在 effect 中使用了这三个查找元素的方法
    // 在之后我们修改了数组里的内容，此时是需要执行监听的回调的，如果不追踪的话就不会再走一次回调了
    // reactiveArray.spec.ts -> 第 6 个
    for (let i = 0, l = (this as any).length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }

    // ③
    // 调用原生的查找方法，如果没有找到结果，在将参数转换为原始数据，重新带哦用一次
    // reactiveArray.spec.ts -> 第 4 个
    const res = arr[ key ]( ...args )

    // ④
    if ( res === -1 || res === false ) {
      return arr[ key ]( ...args.map( toRaw ) )
    } else {
      return res
    }
  }
})
```  

1. 那为什么要这三个方法要单独的拿出来处理呢，以 `indexOf` 举例说明，我们来看 `indexOf` 具体会执行哪些步骤  

```typescript
const original1 = { type: '1' };
const original2 = { type: '2' };
const original3 = { type: '3' };
const originalArray = [ original1, original2, original3 ];
const proxyArray = new Proxy( originalArray, {
  get ( target, property, receiver ) {
      console.log( target, ' 上的 ' + property + ' 触发了 get' );
      return Reflect.get( target, property, receiver );
  },
  set ( target, property, value, receiver ) {
      console.log( target, ' 上的 ' + property + ' 触发了 set' );
      return Reflect.set( target, property, value, receiver );
  },
  has ( target, property ) {
      console.log( target, ' 上的 ' + property + ' 触发了 has' );
      return Reflect.has( target, property );
  },
  ownKeys ( target ) {
      console.log( target, ' 上的 ' + 'iterate' + ' 触发了 ownKeys' );
      return Reflect.ownKeys( target );
  },
  deleteProperty ( target, property ) {
      console.log( target, ' 上的 ' + property + ' 触发了 delete' );
      return Reflect.deleteProperty( target, property );
  }
});  

proxyArray.indexOf( original2 );
```  

结果如下  
![indexOf执行流程](https://github.com/linhaotxl/frontend/raw/master/packages/vue/reactivity/handlers/images/indexOf.jpg)  

我们看到，首先会获取 `indexOf` 方法，再获取数组的长度 `length`，然后从 `0` 开始，判断每个元素是否存在，存在的话就获取这个元素，与我们的传的参数比较，直至有相等的结果  

弄清这个流程后我们再来看下面这个示例  

```typescript
const obj = {}
const arr = reactive([ obj, {} ])
const index = arr.indexOf( obj )
```  

按照正常期望，`index` 应该是 `0`，现在结合 `get` 函数与上面 `indexOf` 的调用流程一起来看，首先获取 `indexOf` 方法、长度 `length` 以及判断第 `0` 个元素是否存在都没问题，现在到了获取第 `0` 个元素  

此时，获取到的是一个对象，而在 `get` 函数最后，会检测获取到的值是否是对象，所以，我们实际获取到的是一个经过 `reactive` 的响应对象，而不是原来的 `obj`，同理，第 `1` 个元素也是如此，所以 `index` 实际是 `-1`  

`arrayInstrumentations` 的作用就是解决这个问题存在的，接下来具体看它的实现  

2. 首先看 ① 处的 `this`，这个 `this` 具体指向的是什么？还是基于上面的示例  
在 `get` 函数中，我们只是通过 `return Reflect.get( arrayInstrumentations, key, receiver )` 获得了具体的方法，而真正调用则是由 `arr` 发起的，所以 `this` 其实就是指向 `arr`（ 注意，这里的 `arr` 是响应对象 ）  

然后会获取它的原始对象，为什么要获取原始对象？就是为了解决上面出现的那个问题，我们直接通过原生对象调用，不走代理，那不就没有问题了吗（ ③ 处的调用 ）  

3. 再看 ④ 处，如果查找到了结果，就直接返回结果，那如果没找到的话，又做了一次查找，和之前不一样的是，这次查找将所有参数都通过 `toRaw` 函数转换了一次，也就是说如果数组内是原始对象，而查找的参数是对应的响应对象，这样也是可以查到的  

```typescript
const original1 = {};
const observal1 = reactive( original1 );
const observalArray = reactive([ original1 ]);
observalArray.indexOf( observal1 ); // 0
```  

### 不同功能的 get  
`get` 函数的主要内容就是这些，通过 `createGetter` 的两个参数可以创建不同功能的 `get`  

```typescript
const get                =  createGetter()                // mutableHandlers 中的 get
const shallowGet         =  createGetter( false, true )   // shallowReactiveHandlers 中的 get
const readonlyGet        =  createGetter( true )          // readonlyHandlers 中的 get
const shallowReadonlyGet =  createGetter( true, true )    // shallowReadonlyHandlers 中的 get
```  

## set  
和 `get` 一样，`set` 也有一个工厂方法 `createSetter` 用来创建不同功能的 `set`，它接受一个参数  
1. 是否浅响应（ 就是嵌套响应 ） `shallow`  
之所以没有第二个是否只读的参数，是因为 `set` 只能作用于 ”非只读响应对象“，所以只有 ”非只读“ 这一种情况  

```typescript
function createSetter( shallow = false ) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 获取旧的值
    const oldValue = (target as any)[key]

    // ①
    // 默认情况下，如果 setter 的值是一个响应式对象，其实真正设置的是它的原始对象
    // reactive.spec.ts -> 7
    if ( !shallow ) {
      // ② 将值转换为原始对象
      value = toRaw( value )

      // ③
      // 检测 ref 作为对象的属性值，通过对象.属性名 的方式修改 ref 的值
      // 此时需要通过 ref 的 setter 方法来修改，而不能执行下面的修改逻辑（ 会替换掉原来的 ref ）
      // TODO 为什么需要判断 !isArray( target ) 和 !isRef( value )
      // ref.spec.ts -> 5
      if ( !isArray( target ) && isRef( oldValue ) && !isRef( value ) ) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    // 检测是否存在设置的 key 属性
    // 这个变量用于之后区分是新增还是更新
    const hadKey = hasOwn( target, key )
    // 更新对应的值
    const result = Reflect.set( target, key, value, receiver )
    
    // ④
    // 检测当前操作的对象是否是本身，而不是原型链上的对象
    // 如果 setter 子类的某一属性，但是子类本身并没有，而父类存在，那就回进入到父类的 setter 方法
    // 而此时 target 是父类对象，而 receiver 却是子类对象，所以要保持一直才可以出发追踪
    // effect.spec.ts -> 25
    if ( target === toRaw( receiver ) ) {
      if ( !hadKey ) {
        trigger( target, TriggerOpTypes.ADD, key, value )
      } else if ( hasChanged( value, oldValue ) ) {
        // 只有当值有变化时才可出发对应的追踪，NaN 被视为相等的值
        // effect.spec.ts -> 28 47
        trigger( target, TriggerOpTypes.SET, key, value, oldValue )
      }
    }

    return result
  }
}
```  

1. 首先看 ② 处，当设置一个值为响应式对象的时候，我们其实设置的是它的原始值  

```typescript
const original3: any = { foo: 1 }
const original4: any = { bar: 2 }
const observed3 = reactive( original3 )
const observed4 = reactive( original4 )
observed3.bar = observed4

observed3.bar === observed4 // true
original3.bar === original4 // true
```  

设置完后，`observed3` 和 `original3` 的 `bar` 实际都是 `original4`，所以第二个为 `true`，但是通过 `observed3` 访问 `bar`，会被代理，所以返回的是 `original4` 的响应对象，即 `observed4`  

2. 再看 ③ 处，这里的判断目的就是，如果对象的某个属性是一个 `ref` 对象，那么我们修改这个属性，就是修改了 `ref` 对象绑定的 `value` 值  

```typescript
const bar = ref( 1 );
const orignal = { bar };
const obversal = reactive( orignal );

obversal.bar = 2;

bar.value === 2;          // true
orignal.bar.value === 2;  // true
obversal.bar === 2;       // true
```  

当执行 `obversal.bar = 2` 时，在进入 `set` 函数后，发现 `oldValue` 是一个 `ref` 对象，且 `value` 不是 `ref` 对象，所以此时会直接使用 `ref` 对象的 `set` 进行设置  

但如果我们设置的是一个 `ref` 对象的话，那么就相当于要替换掉原来的 `ref`，所以此时就执行正常的 `set` 的流程了，而不是走 `ref` 的 `set`  

那为什么要判断 `!isArray( target )` 呢？大概是这样  
* 如果一个 `ref` 对象存在于数组中，那么无论是 `get` 还是 `set`，获得、操作的都是那个 `ref` 对象，如果要获取、处理真正绑定的值，是需要再通过 `.value` 属性的  
* 而对于对象就不同了，不管哪种情况，实际获得、操作的都是 `ref` 所绑定的值  

所以，这种情况只能发生在对象中，而不是数组中  

3. 再看 ① 处，可以看出来，如果在浅响应对象情况下，设置值的时候，不会再转换一遍原始值  

```typescript
const original = { prop: {} };
const observal = shallowReactive( original );
observal.prop = reactive({ name: 'IconMan' })
isReactive(observal.prop) // true
```  

并且设置 `ref` 的时候，会直接替换掉原来的 `ref` 对象，而不是修改 `ref` 所绑定的值  

```typescript
const bar = ref(0);
const original2 = { bar };
const observal2 = shallowReactive( original2 );
(observal2.bar as any) = 1;

bar.value === 0;      // true
observal2.bar === 0;  // true
```

# 集合型代理  

# TODO  
1. `arrayInstrumentations` 中的 `track` 追踪每个元素 