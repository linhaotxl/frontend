**为了更加清楚理解源码的意义，代码的顺序做了调整**   

# Ref  
`ref` 和 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 类似，都是用来做数据响应化的操作  

通过 [reactive](https://github.com/linhaotxl/frontend/tree/master/packages/vue/reactivity/reactive) 的介绍我们知道，`reactive` 的参数必须是一个对象，那如果我们要对一个原始数据（ 称为原始值 ）进行响应呢，此时就要用 `ref` 了，但是我们没办法对一个原始值进行响应式，所以只能将原始值放进对象里，并且通过 `value` 属性访问、设置，这就是 `ref` 的作用  

其实 `ref` 的参数也可以是对象，只不过处理方法有所不同  
1. 参数为原始值: 直接通过 `.value` 获取到原始值  
2. 参数为对象: 会将对象进行 `reactive` 响应化，再通过 `.value` 获取，此时获取的就是响应对象

## isRef  
这个方法用来检测一个对象是否是 `ref` 对象，每个 `ref` 对象都会有一个标识 `_isRef`，所以只要判断这个标识就行  

```typescript
function isRef( r: any ): r is Ref {
  return r ? r._isRef === true : false
}
```   

## convert  
上面说的，如果参数为对象，会将这个对象 `reactive` 响应化，就是在这一步处理的   

```typescript
const convert = <T extends unknown>( val: T ): T => isObject( val ) ? reactive( val ) : val
```

## createRef   

这是一个工厂方法，有两个参数，用来创建不同功能的 `ref`  
1. 原始值  
2. 是否浅响应  

所以就有两种 `ref`  

```typescript
function ref( value ) {
  return createRef( value )
}

function shallowRef( value ) {
  return createRef( value, true )
}
```  

下面来看 `createRef` 的实现  

```typescript
function createRef( rawValue: unknown, shallow = false ) {
  // 对一个 ref 对象，再次进行 ref 响应，得到的还是原来的那个 ref 对象
  if ( isRef( rawValue ) ) {
    return rawValue
  }

  // ①
  // 声明 value 变量，保存的是最终的原始值
  // 如果是浅度，则直接获取数据，否则先对数据进行转换
  let value = shallow ? rawValue : convert( rawValue );

  // 生成 ref 对象
  const r = {
    _isRef: true,

    // ③
    // value 的 get，用于获取原始值
    get value() {
      track( r, TrackOpTypes.GET, 'value' )
      return value
    },

    // value 的 set，用于设置原始值
    set value( newVal ) {
      // ④
      if ( hasChanged( toRaw( newVal ), rawValue ) ) {
        // 有变化
        // 替换原始值和最终返回的值
        rawValue = newVal

        // ②
        value = shallow ? newVal : convert( newVal )
        
        // 触发 value 追踪的依赖
        trigger(
          r,
          TriggerOpTypes.SET,
          'value',
          __DEV__ ? { newValue: newVal } : void 0
        )
      }
    }
  }

  return r
}
```  

1. 先来看第 ① 和 ② 处，如果是浅响应，则不会转换原始值  

**以下的情况基于原始值为对象讨论**  

对于非浅响应来说，会将原始值转换为 `reactive` 响应对象，如果修改了它的值，就会触发追踪的依赖  
对于浅响应来说，原始值就是那个对象，不会转换为响应对象，所以修改的时候是不会触发追踪的依赖  

非浅响应  

```typescript
let dummy;
const original = { count: 0 };
const sref = ref( original );

effect(() => {
  dummy = sref.value.count;
});

sref.value.count = 2;

dummy === 2;  // true
```  

浅响应  

```typescript
let dummy;
const original = { count: 0 };
const sref = shallowRef( original );

effect(() => {
  dummy = sref.value.count;
});

sref.value.count = 2;

dummy === 0;  // true
```  

2. 再看 ③ 处，这里是 `ref` 的 `value` 属性，可以看到，每次访问的时候，都会追踪 `value` 属性，因为 `ref` 对象的 `value` 是固定不变的，所以这里就写死了  

3. 再看 ④ 处，这里会通过 `toRaw` 将原始值转换一次，这样做的目的就是，当我们设置的是一个响应对象的时候，实际设置的是响应对象的原始值，这个逻辑和 [reactive - set]() 的逻辑是一样的  

## triggerRef   
这个方法会主动触发 `value`追踪的依赖，而不是又 `set` 被动触发的。像上面浅响应的示例中，由于浅响应的 `set` 不会导致触发追踪的依赖，所以可以通过这个方法手动触发  

```typescript
triggerRef( sref );
dummy === 2;  // true
```  

## unref  
这个方法用来解绑 `ref` 对象，也就是直接获取原始值   

```typescript
function unref<T>( ref: T ): T extends Ref<infer V> ? V : T {
  return isRef( ref ) ? ( ref.value as any ) : ref
}
```  

## customRef  
这个方法用来定义自定义的 `ref` 对象，接受一个回调作为参数，回调有两个参数  
1. 追踪 `value` 的方法  
2. 触发 `value` 追踪的依赖  

并且回调要返回一个含有 `get` 和 `set` 方法的对象，这两个方法会在获取和设置 `ref` 的时候被调用  

```typescript
let count: number = 1;
let dummy: number = 0;
const customerRef = customRef(( track, trigger ) => ({
  get () {
    track();
    return count;
  },
  set ( value: number ) {
    count = value;
    trigger();
  }
}));

effect(() => {
  dummy = customerRef.value;
});

customerRef.value === 1;  // true
dummy === 1;              // true

customerRef.value = 2;

customerRef.value === 2;  // true
dummy === 2;              // true
```  

注意: 在 `set` 方法中，一定要先设置值，再触发依赖，因为触发依赖是同步执行的，所以在执行依赖前要修改掉