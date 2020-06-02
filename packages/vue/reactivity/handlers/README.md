**为了更加清楚理解源码的意义，代码的顺序做了调整**   

**在代码中会涉及到 `track` 和 `trigger` 两种操作，这两种不会放在本篇中分析，具体可以参考 [track](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#track) 和 [trigger](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#trigger)**

- [非集合型代理](#非集合型代理)
    - [builtInSymbols](#builtinsymbols)
    - [ITERATE_KEY](#iterate_key)
    - [get](#get)
        - [arrayInstrumentations](#arrayinstrumentations)
        - [不同功能的 get](#不同功能的-get)
    - [set](#set)
        - [不同功能的 set](#不同功能的-set)
    - [ownKeys](#ownkeys)
    - [has](#has)
    - [deleteProperty](#deleteproperty)
    - [代理对象总和](#代理对象总和)
- [集合型代理](#集合型代理)
    - [mutableInstrumentations](#mutableinstrumentations)
        - [set](#set-1)
        - [get](#get-1)
        - [add](#add)
        - [deleteEntry](#deleteentry)
        - [clear](#clear)
        - [iterator](#iterator)
        - [createIterableMethod](#createiterablemethod)
        - [createForEach](#createforeach)
    - [readonlyInstrumentations](#readonlyinstrumentations)
        - [createReadonlyMethod](#createreadonlymethod)
- [TODO](#todo)

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

在 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 源码中，我们知道上述 6 种代理方式都作为 `new Proxy` 的第二个参数，所以它们都是一个对象，都含有 `get`、`set`、`has`、`deleteProperty` 和 `ownKeys` 这五种属性，接下来就一个一个来看  

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

## ITERATE_KEY  
这个变量代表了遍历的操作类型，是一个 `Symbol` 值，用于 [ownKeys](#ownKeys)  

```typescript
const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '');
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
    // 如果原始对象是数组，则获取到的就是 ref 对象；否则直接获取到的就是原始值
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

`arrayInstrumentations` 的作用就是解决这个问题存在的  

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
const get                =  createGetter()              // 普通响应对象
const shallowGet         =  createGetter( false, true ) // 普通浅响应对象
const readonlyGet        =  createGetter( true )        // 只读响应对象
const shallowReadonlyGet =  createGetter( true, true )  // 只读浅响应对象
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
        // ⑤
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

1. 首先看 ② 处，对于非浅响应的对象，当 `set` 的值是响应式对象的时候，我们其实设置的是它的原始值  

```typescript
const original3: any = { foo: 1 }
const original4: any = { bar: 2 }
const observed3 = reactive( original3 )
const observed4 = reactive( original4 )
observed3.bar = observed4

observed3.bar === observed4 // true
original3.bar === original4 // true
```  

设置完后，`original3` 的 `bar` 实际都是 `original4`，所以第二个为 `true`，但是通过 `observed3` 访问 `bar`，会被代理，所以返回的是 `original4` 的响应对象，即 `observed4`  

2. 再看 ③ 处，这里的判断目的就是，如果非浅响应对象的某个属性是一个 `ref` 对象，那么我们修改这个属性，就是修改了 `ref` 对象绑定的 `value` 值  

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

但如果我们设置的是一个新的 `ref` 对象的话，那么就相当于要替换掉原来的 `ref`，所以此时就执行正常的 `set` 的流程了，而不是走 `ref` 的 `set` 的流程  

那为什么要判断 `!isArray( target )` 呢？大概是这样  
* 如果一个 `ref` 对象存在于数组中，那么无论是 `get` 还是 `set`，获得、操作的都是那个 `ref` 对象，如果要获取、处理真正绑定的值，是需要再通过 `.value` 属性的  
* 而对于对象就不同了，不管哪种情况，实际获得、操作的都是 `ref` 所绑定的值  

所以，这种情况只能发生在对象中，而不是数组中  

3. 再看 ① 处，如果在浅响应对象情况下，设置值的时候，不会再转换一遍原始值  

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

4. 再看 ④ 处，这里将 `receiver` 用 `toRaw` 转换了一次，先来看看 `receiver` 到底是什么  

在代理对象的 `set` 方法中，存在第四个参数 `receiver`，指向的是操作的原始对象，即 `proxy.bar = 1`，指向 `proxy`  

```typescript
const original = {};
const proxy = new Proxy( original, {
  set ( target, property, value, receiver ) {
    target[ property ] = receiver;
  }
});

proxy.bar = 'bar';
proxy.bar === proxy;  // true
```  

此时，因为调用的是 `proxy.bar = 'bar'`，所以 `receiver` 指向的就是 `proxy`  

```typescript
const children = { type: 'children' };
const parent   = { type: 'parent', bar: null };
const observalParent = new Proxy( parent, {
  set ( target, property, value, receiver ) {
    target[ property ] = receiver;
  }
});
Object.setPrototypeOf( children, observalParent );

children.bar = 'bar';
children.bar = children;  // true
```  

由于 `children` 本身不存在 `bar` 属性，所以设置的时候会去原型链查找，即 `observalParent`，所以会进入 `observalParent` 代理的 `set` 方法中，而此时，`receiver` 参数指向的就是操作的原始对象，即 `children` 而不是 `observalParent`  

弄清了 `receiver` 参数后，再看下面这个示例  

```typescript
let dummy, parentDummy, hiddenValue: any
const obj = reactive<{ prop?: number; type: string }>({ type: 'children' })
const parent = reactive({
  type: 'parent',
  set prop(value) {
    hiddenValue = value
  },
  get prop() {
    return hiddenValue
  }
})

Object.setPrototypeOf(obj, parent)

effect(() => {
  dummy = obj.prop
})
effect(() => {
  parentDummy = parent.prop
})

toRaw(obj).prop = 4
```  

当执行最后一行代码时，执行到 `set` 方法中，`target` 是 `parent` 的原始对象，而 `receiver` 则是 `obj`，所以这里的判断目的是，只有当设置的是对象本身的属性，才会进行 `trigger` 触发追踪  

5. 再看 ⑤ 处，这里会判断新值 `value` 与旧值 `oldValue` 是否有变化，它是根据 `===` 去判断的，同时也处理了 `NaN` 的情况，所以 `NaN` 被认为是相同的值   
也即是说，只有当我们 `set` 的值与旧值不一样的时候，才会触发我们追踪的依赖  

### 不同功能的 set  

通过 `createSetter` 创建两种类型的 `set`，并且这两种都是非只读   

```typescript
const set        = createSetter()       // 普通响应对象
const shallowSet = createSetter( true ) // 普通浅响应对象
```  

对于只读的 `readonlyHandlers` 和 `shallowReadonlyHandlers` 来说，并不具备 `set`，所以重写了 `set` 函数，并且直接返回了 `true`，什么都没有做  

## ownKeys  
`ownKeys` 会拦截遍历的操作，当触发下面这些操作时，就会追踪一个遍历的属性 [ITERATE_KEY](#ITERATE_KEY)
1. `Object.getOwnPropertyNames`: 获取对象自身的所有属性，包括不可枚举属性，但不包括 `Symbol` 属性
2. `Object.getOwnPropertySymbols`: 获取对象自身所有的 `Symbol` 属性
3. `Object.keys`: 
4. `for...in`  

```typescript
function ownKeys( target: object ): (string | number | symbol)[] {
  track( target, TrackOpTypes.ITERATE, ITERATE_KEY )
  return Reflect.ownKeys( target )
}
```

## has  
`has` 会拦截 `prop in obj` 操作，当触发 `in` 操作时，就会追踪指定的属性  

```typescript
function has( target: object, key: string | symbol ): boolean {
  const result = Reflect.has( target, key )
  track( target, TrackOpTypes.HAS, key )
  return result
}
```  

## deleteProperty  
`deleteProperty` 会拦截 `delete obj[prop]` 操作，就会追踪指定的属性  

```typescript
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn( target, key )
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty( target, key )
  // 删除成功，并且删除的是一个已存在的属性才会触发追踪的依赖
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}
```  

## 代理对象总和  
上面就是所有的代理方法，在非集合型的 `handlers` 中，都用到了这几种  

```typescript
// 普通响应对象
const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
```  

```typescript
// 普通浅响应对象
const shallowReactiveHandlers: ProxyHandler<object> = {
  ...mutableHandlers,
  get: shallowGet,
  set: shallowSet
}
```  

```typescript
// 只读响应对象
const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  has,
  ownKeys,
  set(target, key) {
    // 更新不做任何操作
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    // 删除不做任何操作
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}
```  

```typescript
// 只读浅响应对象
const shallowReadonlyHandlers: ProxyHandler<object> = {
  ...readonlyHandlers,
  get: shallowReadonlyGet
}
```

# 集合型代理  

集合型指的是 `Map`、`Set`、`WeakMap` 以及 `WeakSet` 这几种，因为这几种都是原生提供的 API，增删改查都是调用它们的实例方法，所以先对获取实例方法这一层做了一个拦截  

集合型代理主要是 `mutableCollectionHandlers` 和 `readonlyCollectionHandlers` 这两个，先来看它们的定义  

```typescript
// 非只读代理
const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter( mutableInstrumentations )
}

// 只读代理
const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter( readonlyInstrumentations )
}
```  

`createInstrumentationGetter` 函数用来创建 `get` 的代理，如果访问的属性存在于参数 `instrumentations` 中，就会获取到对应的内容，如果不存在，则从自身获取  

```typescript
function createInstrumentationGetter( instrumentations: Record<string, Function> ) {
  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) =>
    Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
}
```  

可以看出，参数中必须要包含 `Set` 和 `Map` 所有的操作方法，分类如下  
`Map`: `get`、`set`
`Set`: `add`
公共: `size`、`has`、`delete`、`clear`、`forEach`、`keys`、`values`、`entries` 和 `Symbol.iterator`

接下来先来看 `mutableInstrumentations` 的内容  

## mutableInstrumentations  

```typescript
const mutableInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReactive)
  },
  get size() {
    return size((this as unknown) as IterableCollections)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false)
}

const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false
  )
})
```  

### set  

`set` 用来对 `Map` 实例设置值，所以它有两个参数，`key` 和 `value`，并且方法中的 `this` 指向的是调用者，即响应对象  

```typescript
function set( this: MapTypes, key: unknown, value: unknown ) {
  // 将值转换为原始值，如果 set 的是一个响应式对象，其实设置的还是它的原始对象
  value = toRaw( value )

  // 获取原始对象 Map
  const target = toRaw( this )
  // 获取原生方法
  const { has, get, set } = getProto( target )

  // 检查是新增还是更新操作，用于之后 trigger 的类型
  let hadKey = has.call( target, key )

  if ( !hadKey ) {
    // 暂时认为是新增操作
    // 此时有两种情况
    //  1. 新增的 key 的确是一个原来没有的 key
    //  2. 新增的 key 是一个响应对象，需要转换为原始对象再做一次检查
    // 所以针对第二种情况，需要将 key 做转换，再查询一次
    key = toRaw( key )
    hadKey = has.call( target, key )
  }

  const oldValue = get.call( target, key )
  const result = set.call( target, key, value )

  // 触发不同类型的 trigger
  if ( !hadKey ) {
    trigger( target, TriggerOpTypes.ADD, key, value )
  } else if ( hasChanged( value, oldValue ) ) {
    trigger( target, TriggerOpTypes.SET, key, value, oldValue )
  }

  return result
}
```  

1. 如果 `key` 为响应对象，那实际设置 `key` 是它的原始对象  

### get  

`get` 用来对 `Map` 实例获取值，它有三个参数  

1. 调用者响应对象  
2. 获取的 `key`
3. 当获取结果为对象时的包装函数  

```typescript
function get(
  target: MapTypes,
  key: unknown,
  wrap: typeof toReactive | typeof toReadonly
) {
  // 此时 target 是响应对象，所以需要获取原始对象
  target = toRaw( target )

  const rawKey = toRaw( key )
  if ( key !== rawKey ) {
    // ①
    // 如果 key 本身是响应对象，那么此时不仅要追踪原始 key 还要追踪响应 key
    track( target, TrackOpTypes.GET, key )
  }
  track( target, TrackOpTypes.GET, rawKey )

  const { has, get } = getProto( target )

  // 如果 key 或者 rawKey 存在，就取出，并且如果是对象转换为响应数据
  if ( has.call( target, key ) ) {
    return wrap( get.call(target, key) )
  } else if ( has.call( target, rawKey ) ) {
    return wrap( get.call( target, rawKey ) )
  }
}
```  

1. 看 ① 处，如果获取的 `key` 是一个响应对象，那么会同时追踪响应对象和原始对象  

    ```typescript
    const raw = new Map();
    const key = reactive({});
    raw.set( key, 1 )
    const map = reactive( raw )

    let dummy
    effect(() => {
      // 获取的 key 是一个响应对象，所以会同时追踪响应和原始
      dummy = map.get( key )
    })
    // dummy -> 1

    map.set(key, 2)
    // dummy -> 2
    ```  

### add   

`add` 用来对 `Set` 实例添加元素，所以它只接受一个参数，并且 `Set` 是不会重复的集合，所以只有第一次添加才会触发追踪的依赖  

```typescript
function add( this: SetTypes, value: unknown ) {
  // 获取添加元素的原始对象
  value = toRaw( value )
  // 获取 Set 实例本身
  const target = toRaw( this )
  const proto = getProto( target )

  const hadKey = proto.has.call(target, value)
  const result = proto.add.call(target, value)

  if ( !hadKey ) {
    trigger( target, TriggerOpTypes.ADD, value, value )
  }

  return result
}
```  

### deleteEntry  

```typescript
function deleteEntry( this: CollectionTypes, key: unknown ) {
  // 获取原始实例
  const target = toRaw( this )
  const { has, get, delete: del } = getProto( target )
  // 检测删除的元素是否存在
  let hadKey = has.call( target, key )
  if ( !hadKey ) {
    // 暂时认为是不存在的
    // 此时有两种情况
    //  1. 删除的 key 的确是一个没有的 key
    //  2. 删除的 key 是一个响应对象，需要转换为原始对象再做一次检查
    key = toRaw( key )
    hadKey = has.call( target, key )
  }

  const oldValue = get ? get.call(target, key) : undefined

  // 调用原生方法删除
  const result = del.call(target, key)
  // 如果删除的元素本身存在，才会触发追踪的依赖
  if ( hadKey ) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }

  return result
}
```  

### clear  

```typescript
function clear( this: IterableCollections ) {
  const target = toRaw( this )
  const hadItems = target.size !== 0

  const oldTarget = __DEV__
    ? target instanceof Map
      ? new Map(target)
      : new Set(target)
    : undefined

  // 调用原生方法清除所有元素
  const result = getProto( target ).clear.call( target )

  // 当实例在 clear 前有元素时才会触发追踪的依赖
  if ( hadItems ) {
    trigger( target, TriggerOpTypes.CLEAR, undefined, undefined, oldTarget )
  }

  return result
}
```  

### iterator  

`Set` 和 `Map` 的 `keys`、`values`、`entries` 和 `Symbol.iterator` 方法返回的都是迭代器对象，继续通过 `next` 方法才能获取到最终的值，不同的方法取出的值可能不一样，先看下面这个示例    

```typescript
const set = new Set([ 'IconMan', 'Nicholas' ]);
const map = new Map([
  [ 'IconMan', 24 ],
  [ 'Nicholas', 25 ]
]);

set.keys().next().value;  // IconMan
map.keys().next().value;  // IconMan

set.values().next().value;  // IconMan
map.values().next().value;  // 24

set.entries().next().value; // [ IconMan, IconMan ]
map.entries().next().value; // [ IconMan, 24 ]

set[Symbol.iterator]().next().value;  // IconMan
map[Symbol.iterator]().next().value;  // [ IconMan, 24 ]
```  

可以看出，只有调用 `entries` 和 `Map` 的 `Symbol.iterator` 这三种情况，获取到的值是一个数组，第一个元素是键名，第二个元素是键值（ 对于 `Set` 来说这两个一样 ），我们称这样获取到的值是成对存在的  

### createIterableMethod  
这个方法接受两个参数  
1. 生成的迭代器函数用在哪个方法，例如 `keys`
2. 是否是只读  

```typescript
function createIterableMethod(method: string | symbol, isReadonly: boolean) {
  return function iterableMethod(this: IterableCollections, ...args: unknown[]) {
    const target = toRaw( this )
    const isMap = target instanceof Map
    // ①
    // 检测值是否是成对存在，只有调用 entries 或者是遍历 Map 对象
    const isPair = method === 'entries' || (method === Symbol.iterator && isMap)
    // 检测是否是 Map 的 keys 方法
    const isKeyOnly = method === 'keys' && isMap
    // 获取迭代器对象
    const innerIterator = getProto(target)[method].apply(target, args)
    // 根据是否只读获取包装函数
    const wrap = isReadonly ? toReadonly : toReactive
    // ②
    // 非只读需要追踪遍历属性
    // 如果访问的是 keys 方法，那么追踪的是 MAP_KEY_ITERATE_KEY 代表只有 key 发生变化
    !isReadonly &&
      track(
        target,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
      )

    // ③
    // 模拟返回迭代器对象
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        // 调用真实的迭代器对象，获取对应值
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
              // 对每个值都进行一次包装处理，如果是对象则要转换为响应对象
              value: isPair ? [ wrap(value[0]), wrap(value[1]) ] : wrap( value ),
              done
            }
      },
      // iterator 接口，返回 return 的这个对象，以后后续调用 next 方法
      [ Symbol.iterator ]() {
        return this
      }
    }
  }
}
```  


1. 以 `entries` 举例来说明这段代码  

    ```typescript
    let dummy;
    const original = new Map([
      [ 'IconMan', 24 ],
      [ 'Nicholas', 25 ]
    ]);
    const observal = reactive( original );

    effect(() => {
      for ( const [ name, age ] of observal.entries() ) {
        dummy += age;
      }
    });

    // dummy -> 49
    ```  

* 在 `for...of` 中，调用 `observal.entries()` 后，会调用 `Symbol.iterator` 获取遍历器对象，这里获取的只是模拟的一个遍历器对象  
* 再调用模拟的 `next` 方法，在 `next` 方法中，调用真实遍历器的 `next` 方法获取 `value` 和 `done`，并对 `value` 进一步处理，最终返回对象，保持和实际遍历器一致  

2. 如果 `Set` 和 `Map` 中含有对象，那么我们在遍历时得到的是对应的响应对象，而不是本身的原始对象  

3. 为什么会对 `map.keys()` 单独追踪 `MAP_KEY_ITERATE_KEY` 而不是追踪遍历的 `ITERATE_KEY`？  
在 [trigger](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/effect#trigger) 中，有这样一个判断，表示我们通过 `map.set` 更新（ 不是增加 ）一个值的时候，也是需要触发遍历的依赖  

```typescript
if (
  isAddOrDelete ||
  (type === TriggerOpTypes.SET && target instanceof Map)
) {
  add( depsMap.get( isArray( target ) ? 'length' : ITERATE_KEY ) )
}
```  

但是通过 `map.keys()` 得到的结果和键值是无关的，只和键名相关，看下面这个示例  

```typescript
let dummy = 0;
let names = [];
const original = new Map([
  [ 24, 'IconMan' ],
  [ 25, 'Nicholas' ]
]);
const observal = reactive( original );
effect(() => {
  dummy = 0;
  // 这里只会追踪遍历 key 的依赖，并且这个依赖在 trigger 中只有新增或者删除的时候才会被触发
  for ( const age of observal.keys() ) {
    dummy += age;
  }
});

effect(() => {
  names = [];
  // 这里会追踪遍历的依赖
  for ( const name of observal.values() ) {
    names.push( name );
  }
});

// dummy -> 49
// names -> [ IconMan, Nicholas ]

observal.set( 24, 'SpiderMan' );

// dummy -> 49
// names -> [ SpiderMan, Nicholas ]
```  

### createForEach  

`forEach` 用来遍历每个数据，其中有几点要注意  
1. 回调的前两个参数分别是键值和键名，如果它们为对象的话，那么得到的就是对应的响应对象  
2. 回调的第三个参数和 `this`，都指向调用者，并且 `this` 没办法修改

```typescript
function createForEach(isReadonly: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    // 获取调用者响应对象
    const observed = this
    // 获取原始对象
    const target = toRaw( observed )
    const wrap = isReadonly ? toReadonly : toReactive
    // 非只读情况下追踪遍历
    !isReadonly && track( target, TrackOpTypes.ITERATE, ITERATE_KEY )
    
    function wrappedCallback( value: unknown, key: unknown ) {
      // 这里的 this 其实是有外部决定的，不过这里没有用到
      // 将 value 和 key 都进行封装
      // this 和第三个参数都指向 observed
      return callback.call( observed, wrap( value ), wrap( key ), observed )
    }

    return getProto( target ).forEach.call( target, wrappedCallback, thisArg )
  }
}
```  

## readonlyInstrumentations  

`readonlyInstrumentations` 简单很多，和 `mutableInstrumentations` 相似的地方前面已经说过了，唯一不同的就是可以修改的几个方法  

```typescript
const readonlyInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReadonly)
  },
  get size() {
    return size((this as unknown) as IterableCollections)
  },
  has,
  add: createReadonlyMethod(TriggerOpTypes.ADD),
  set: createReadonlyMethod(TriggerOpTypes.SET),
  delete: createReadonlyMethod(TriggerOpTypes.DELETE),
  clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
  forEach: createForEach(true)
}
```  

修改的几个方法通过 `createReadonlyMethod` 创建，这个函数其实很简单，什么也不会做  

### createReadonlyMethod  

```typescript
function createReadonlyMethod( type: TriggerOpTypes ): Function {
  return function(this: CollectionTypes, ...args: unknown[]) {
    if (__DEV__) {
      const key = args[0] ? `on key "${args[0]}" ` : ``
      console.warn(
        `${capitalize(type)} operation ${key}failed: target is readonly.`,
        toRaw(this)
      )
    }
    return type === TriggerOpTypes.DELETE ? false : this
  }
}
```

# TODO  
1. `arrayInstrumentations` 中的 `track` 追踪每个元素
2. `createGetter` 中浅下响应式为什么也要追踪
3. `createGetter` 中，如果值是 `ref` 且 `target` 是数组，为什么还要追踪