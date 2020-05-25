**为了更加清楚理解源码的意义，代码的顺序做了调整**  

- [工具方法](#工具方法)
    - [normalizeClass](#normalizeclass)
    - [normalizeStyle](#normalizestyle)
    - [normalizeChildren](#normalizechildren)
    - [extend](#extend)
    - [mergeProps](#mergeprops)
- [vNode](#vnode)
    - [_createVNode](#_createvnode)

# 工具方法  

## normalizeClass  
这个方法主要是转换 `class` 的方法，最终会转换为字符串的 `class`  

```typescript
function normalizeClass( value: unknown ): string {
  let res = ''

  if ( isString( value ) ) {
    // 处理字符串
    res = value
  } else if ( isArray( value ) ) {
    // 处理数组
    for (let i = 0; i < value.length; i++) {
      res += normalizeClass( value[i] ) + ' '
    }
  } else if ( isObject( value ) ) {
    // 处理对象
    for ( const name in value ) {
      if ( value[name] ) {
        res += name + ' '
      }
    }
  }
  return res.trim()
}
```  

可以接受三种类型的参数  
1. `string`: 直接返回字符串
2. `array`: 遍历数组中的每个元素，对每个元素再次调用该方法，并累加结果
3. `object`: 遍历对象的每个属性，将属性值有效的属性名作为 `class` 并累加结果  

示例  

```typescript
normalizeClass( ' app ' ) ;                                                                  // 'app'  
normalizeClass({ a: true, b: false, c: 0, d: '1', e: '', f: undefined, g: null, h: NaN });   // 'a d'
normalizeClass([ 'a', 'b', { c: true }, { d: 0 } ]);                                         // 'a b c'
```

## normalizeStyle  

这个方法用来转换样式 `style` 的方法，最终被转换为一个 `style` 对象  

```typescript
function normalizeStyle(
  value: unknown
): Record<string, string | number> | undefined {
  if ( isArray( value ) ) {
    // 如果是数组，对每个元素再次调用该方法，并累加结果
    const res: Record<string, string | number> = {}
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeStyle(value[i])
      if (normalized) {
        for (const key in normalized) {
          res[key] = normalized[key]
        }
      }
    }
    return res
  } else if ( isObject( value ) ) {
    // 如果是对象，直接返回
    return value
  }
}
```  

可以接受两种类型的参数  
1. `object[]`:  对每个元素调用该方法，并累加结果
2. `object`: 直接返回  

```typescript
normalizeStyle({ width: 100, height: 100, display: 'block' });  // { width: 100, height: 100, display: 'block' }
normalizeStyle([ { width: 100 }, { height: 100 }, 100 ]);       // { width: 100, height: 100 }
```

## normalizeChildren  

这个方法主要是根据子节点，来设置 `vNode` 的 `children` 和 `shapeFlag` 这两个属性  

```typescript
function normalizeChildren( vnode: VNode, children: unknown ) {
  // 本次需要设置的 shapeFlag 值，默认是 0，即什么都不需要增加
  let type = 0
  // 获取以前的 shapeFlag 值
  const { shapeFlag } = vnode

  if (children == null) {
    children = null
  } else if (isArray(children)) {
    // 子节点是数组
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') {
    // Normalize slot to plain children
    if (
      (shapeFlag & ShapeFlags.ELEMENT || shapeFlag & ShapeFlags.TELEPORT) &&
      (children as any).default
    ) {
      normalizeChildren(vnode, (children as any).default())
      return
    } else {
      type = ShapeFlags.SLOTS_CHILDREN
      if (!(children as RawSlots)._ && !(InternalObjectKey in children!)) {
        // if slots are not normalized, attach context instance
        // (compiled / normalized slots already have context)
        ;(children as RawSlots)._ctx = currentRenderingInstance
      }
    }
  } else if (isFunction(children)) {
    // 子节点是函数
    children = { default: children, _ctx: currentRenderingInstance }
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    // 子节点是字符串
    children = String(children)
    // force teleport children to array so it can be moved around
    if (shapeFlag & ShapeFlags.TELEPORT) {
      type = ShapeFlags.ARRAY_CHILDREN
      children = [createTextVNode(children as string)]
    } else {
      type = ShapeFlags.TEXT_CHILDREN
    }
  }
  
  // 更新节点属性，其中 shapeFlag 通过位运算符，将旧值和新值累加
  vnode.children = children as VNodeNormalizedChildren
  vnode.shapeFlag |= type
}
```

## extend  
这就是一个简单的扩展方法，接受两个对象作为参数，会将第二个参数的所有属性添加到第一个参数中，最后返回第一个参数  

```typescript
const extend = <T extends object, U extends object>(
  a: T,
  b: U
): T & U => {
  for (const key in b) {
    ;(a as any)[key] = b[key]
  }
  return a as any
}
```

## mergeProps  

这是一个合并 `props` 的方法，主要处理了这几种情况  
1. `class`: 将各种情况的 `class` 累加
2. `style`: 将 `style` 对象进行合并
3. 事件: 若存在两个以上，则范进数组
4. 其他: 除了以上三种情况外，剩余的都是直接赋值合并

```typescript
const handlersRE = /^on|^vnode/

function mergeProps(...args: (Data & VNodeProps)[]) {
  // 声明最终合成的对象
  const ret: Data = {}
  // 将第一个参数的内容添加到 ret
  extend(ret, args[0])
  // 从第二个参数开始遍历
  for (let i = 1; i < args.length; i++) {
    const toMerge = args[i]
    for (const key in toMerge) {
      // 处理 class，通过 normalizeClass 累加
      if (key === 'class') {
        if (ret.class !== toMerge.class) {
          ret.class = normalizeClass([ret.class, toMerge.class])
        }
      } else if (key === 'style') {
        // 处理 style，通过 normalizeStyle 合并
        ret.style = normalizeStyle([ret.style, toMerge.style])
      } else if (handlersRE.test(key)) {
        // 处理事件，存在多个则放进数组
        // on*, vnode*
        const existing = ret[key]
        const incoming = toMerge[key]
        if (existing !== incoming) {
          ret[key] = existing
            ? [].concat(existing as any, toMerge[key] as any)
            : incoming
        }
      } else {
        // 其余则是普通的添加
        ret[key] = toMerge[key]
      }
    }
  }
  return ret
}
```  

# vNode  

`vNode` 对象表示一个虚拟 `DOM` 节点，书写在 `<template>` 里的内容，最终都会被编译为 `vNode` 对象，例如下面代码  

```markdown
<div class="app">
  <span class="text">111</span>
</div>
```  

这样的代码会被编译为下面这样  

```typescript
import { createVNode as _createVNode, openBlock as _openBlock, createBlock as _createBlock } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createBlock("div", { class: "app" }, [
    _createVNode("span", { class: "text" }, "111")
  ]))
}
```  

先来解释下上面出现的 `_openBlock` 和 `_createBlock` 中的 `block` 的意义  

`block` 可以理解为一个区域，由数组实现，保存的是会变化的节点，例如 `<div>{{ name }}</div>` 这样的，而不是一个静态节点 `<div>name</div>`，保存下来的目的就是为了在之后 `diff` 的时候，只需要对这些需要变化的节点进行 `diff`，从而避免不必要的操作  

每个 `block` 都会有一个根节点，会将当前的 `block` 挂载到根节点上面

上面代码中的三个方法的作用大致如下，详细会在后面介绍到  

1. `_openBlock`: 开启一个 `block` 区域
2. `_createVNode`: 创建具体 `vNode` 对象的方法  
3. `_createBlock`: 创建一个根节点，基于 `_createVNode` 实现   

## patchFlag  
上面说过，`<div>{{ name }}</div>` 这种是变化节点，但是变化的类型有很多，这只是其中一种，先来看所有的变化类型  

```typescript
const enum PatchFlags {
  // 文本类型，
  TEXT = 1,

  // 动态 class
  CLASS = 1 << 1,

  // 动态样式
  STYLE = 1 << 2,

  // 除了 class 和 style 之外的动态属性
  PROPS = 1 << 3,

  FULL_PROPS = 1 << 4,

  HYDRATE_EVENTS = 1 << 5,

  STABLE_FRAGMENT = 1 << 6,

  KEYED_FRAGMENT = 1 << 7,

  UNKEYED_FRAGMENT = 1 << 8,

  NEED_PATCH = 1 << 9,

  DYNAMIC_SLOTS = 1 << 10,

  HOISTED = -1,

  BAIL = -2
}
```  

每种类型都属性二进制，所以之后的累加，判断等都是通过位运算符实现的  

## _createVNode  

这个方法用来创建一个 `vNode` 节点，接受五个参数  

1. 节点类型  
2. 节点属性  
3. 子节点  
4. 需要变化的类型  
5. 动态属性

```typescript
function _createVNode(
  type: VNodeTypes | ClassComponent,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null
): VNode {
  // 默认为注释 Comment node
  if (!type) {
    type = Comment
  }

  // 处理 Class Component 情况
  if (isFunction(type) && '__vccOpts' in type) {
    type = type.__vccOpts
  }

  // 设置 class 和 style 两种 props
  if (props) {
    // for reactive or proxy objects, we need to clone it to enable mutation.
    // ①
    if (isProxy(props) || InternalObjectKey in props) {
      props = extend({}, props)
    }

    // 序列化 class 为字符串
    let { class: klass, style } = props
    if ( klass && !isString( klass ) ) {
      props.class = normalizeClass( klass )
    }

    if ( isObject( style ) ) {
      // reactive state objects need to be cloned since they are likely to be
      // mutated
      // ②
      if (isProxy(style) && !isArray(style)) {
        style = extend({}, style)
      }

      // 序列化 style 对象
      props.style = normalizeStyle(style)
    }
  }

  // ③
  // 根据 type 来设置不同的 shapeFlag
  const shapeFlag = isString( type )
    ? ShapeFlags.ELEMENT
    : isSuspense( type )
      ? ShapeFlags.SUSPENSE
      : isTeleport( type )
        ? ShapeFlags.TELEPORT
        : isObject( type )
          ? ShapeFlags.STATEFUL_COMPONENT
          : isFunction( type )
            ? ShapeFlags.FUNCTIONAL_COMPONENT
            : 0

  // 创建 vNode 对象
  const vnode: VNode = {
    _isVNode: true,
    type,
    props,
    key: props && props.key !== undefined ? props.key : null,
    ref:
      props && props.ref !== undefined
        ? [currentRenderingInstance!, props.ref]
        : null,
    scopeId: currentScopeId,
    children: null,
    component: null,
    suspense: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetAnchor: null,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null
  }

  // 序列化子节点
  normalizeChildren(vnode, children)

  // ④
  // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  if (
    shouldTrack > 0 &&
    currentBlock &&
    // the EVENTS flag is only for hydration and if it is the only flag, the
    // vnode should not be considered dynamic due to handler caching.
    patchFlag !== PatchFlags.HYDRATE_EVENTS &&
    (patchFlag > 0 ||
      shapeFlag & ShapeFlags.SUSPENSE ||
      shapeFlag & ShapeFlags.STATEFUL_COMPONENT ||
      shapeFlag & ShapeFlags.FUNCTIONAL_COMPONENT)
  ) {
    currentBlock.push(vnode)
  }

  return vnode
}
```