**为了更加清楚理解源码的意义，代码的顺序做了调整**  

# computed  
`computed`  

```typescript
function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 兼容参数只有一个 getter 的情况
  if ( isFunction( getterOrOptions ) ) {
    getter = getterOrOptions
    setter = NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  // 表示当前追踪的值是否发生了变化，只有在发送变化的时候才需要重新计算
  let dirty = true
  let value: T
  let computed: ComputedRef<T>

  // 创建懒加载的 effect
  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      if ( !dirty ) {
        dirty = true
        // ①
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })

  // 创建 computed 对象，挂载上一步创建的 effect，以及 value 属性
  computed = {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        value = runner()
        dirty = false
      }
      // ②
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
  
  return computed
}
```  

1. `computed` 的参数会被创建为一个 `effect`，而且带有 `lazy` 和 `schedule`，所以这个 `effect` 只能在 `.value` 中被手动调用  
2. 追踪的数据是可以被缓存起来，不会重新计算，关键就在于 `dirty` 这个变量  
    当第一次访问 `cValue.value` 时，会调用 `effect` 计算一次，并将 `dirty` 置为 `false`，之后，如果数据不发送变化，都不会再重新计算，还是之前的值  
    只有当数据发生变化时，才会进入 `schedule` 将 `dirty` 置为 `true`，以便下次获取时重新计算  

    ```typescript
    const observal = reactive<{ foo: number }>({ foo: 1 })
    const cValue = computed(() => observal.foo );

    cValue.value;   // 1 计算
    cValue.value;   // 1 dirty 为 false 不会计算

    observal.foo = 2;   // 触发 cValue.effect，进入 schedule 修改 dirty

    cValue.value;   // 2 计算
    ```  

3. 看 ① 和 ② 处，这两个操作是成对出现的  

    ```typescript
    let dummy: number = 0;
    const observal = reactive({ age: 24 });
    const cValue = computed( () => observal.age );
    effect(() => {
        // 这里首先会追踪 observal.age，追踪的 effect 就是 cValue.effect
        // 再追踪 cValue.value，追踪的 effect 就是当前这个 effect
        dummy = cValue.value;
    });

    // dummy -> 0

    // 这里会先触发 cValue.effect.schedule，其中会再触发追踪 cValue.value 的依赖
    observal.age = 25;
    // dummy -> 25
    ```  

    访问 `cValue.value` 时，这个步骤需要被追踪，也就是说，在 `value` 变化的时候，需要执行追踪的 `effect`  
    而只有当 `cValue.effect.schedule` 被调用的时候，就代表 `value` 有了变化，所以需要 `trigger`