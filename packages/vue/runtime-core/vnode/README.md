**为了更加清楚理解源码的意义，代码的顺序做了调整**  

- [工具方法](#工具方法)
    - [normalizeClass](#normalizeclass)
    - [normalizeStyle](#normalizestyle)
    - [normalizeChildren](#normalizechildren)
    - [extend](#extend)
    - [mergeProps](#mergeprops)
- [vNode](#vnode)
    - [openBlock](#openblock)
    - [patchFlag](#patchflag)
    - [shapeFlag](#shapeflag)
    - [createBlock](#createblock)
    - [createVNode](#createvnode)
    - [示例](#示例)
        - [示例一 基本使用](#示例一-基本使用)
        - [示例二 嵌套使用 openBlock](#示例二-嵌套使用-openblock)
        - [示例三 特殊节点也需要追踪](#示例三-特殊节点也需要追踪)


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

这个方法主要是根据子节点，来设置 `vNode` 的 `children` 和 `shapeFlag` 这两个属性，`shapeFlag` 可以参考 [这里](#shapeFlag)   

```typescript
function normalizeChildren( vnode: VNode, children: unknown ) {
  // 本次需要设置的 shapeFlag 值，默认是 0，即什么都不需要增加
  let type = 0
  // 获取以前的 shapeFlag 值
  const { shapeFlag } = vnode

  if (children == null) {
    // 没有子节点
    children = null
  } else if ( isArray( children ) ) {
    // 子节点是数组
    type = ShapeFlags.ARRAY_CHILDREN
  } else if ( typeof children === 'object' ) {
    // Normalize slot to plain children
    if (
      (shapeFlag & ShapeFlags.ELEMENT || shapeFlag & ShapeFlags.TELEPORT) &&
      (children as any).default
    ) {
      normalizeChildren( vnode, (children as any).default() )
      return
    } else {
      type = ShapeFlags.SLOTS_CHILDREN
      if (!(children as RawSlots)._ && !(InternalObjectKey in children!)) {
        // if slots are not normalized, attach context instance
        // (compiled / normalized slots already have context)
        ;(children as RawSlots)._ctx = currentRenderingInstance
      }
    }
  } else if ( isFunction( children ) ) {
    // 子节点是函数
    children = { default: children, _ctx: currentRenderingInstance }
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    // 子节点是字符串
    children = String( children )
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

TODO  

这个方法总结如下   
1. 没有子节点: `shapeFlag` 保持原状，`children` 为 `null`  
2. 子节点为数组(只要子节点不为文本就会是数组): `shapeFlag` 会加上 `ShapeFlags.ARRAY_CHILDREN`，`children` 就是子节点数组  
<!-- 3. 子节点为函数 -->

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
3. 事件: 若存在两个以上，则放进数组
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

`block` 可以理解为一个区域，由数组实现，保存的是会变化的节点，也可以理解为需要追踪的节点，例如 `<div>{{ name }}</div>` 这样的标签，因为 `name` 是随时会发生变化，而不是一个静态节点 `<div>name</div>`  
保存下来的目的就是为了在之后 `diff` 的时候，只需要对这些追踪的节点进行 `diff`，从而优化性能  

上面代码中的三个方法的作用大致使用流程如下  
1. 先开启一个 `block` 区域  
2. 创建 `vNode` 节点，并将需要追踪的节点保存在当前的 `block` 中  
3. 创建根节点，并将当前 `block` 内所有需要追踪的节点挂载到根节点上   

所以，一个 `block` 的生命周期就是从 `openBlock` 开始，直至创建完根节点后，也就是 `createBlock` 后  

## openBlock  

这个函数主要就是开启一个 `block` 区域，从下面代码可以看出，`block` 就是一个数组  

```typescript
function openBlock( disableTracking = false ) {
  blockStack.push( (currentBlock = disableTracking ? null : []) )
}
```  

这里涉及到两个全局变量  
1. `blockStack` 是存储 `block` 的栈，每次开启都会推入栈中，然后在 `createBlock` 中才会释放  
2. `currentBlock` 是当前开启的 `block`，在 `createNode` 中需要将追踪的节点保存在当前 `block` 中  
   
## patchFlag  
上面说过，`<div>{{ name }}</div>` 这种是发生变化的节点，需要追踪，但是变化的类型有很多，这只是其中一种，下面是所有的变化类型  

```typescript
const enum PatchFlags {
  // 文本类型，例如 <div>{{ name }}</div>
  TEXT = 1,
  // 动态 class，例如 <div :class={ bar: true }>text</div>
  CLASS = 1 << 1,
  // 动态样式，例如 <div :style={ width: 100 }>text</div>
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

每种类型都是性二进制，所以之后的累加，判断等操作都是通过位运算符实现的  

## shapeFlag  

## createBlock  

这个方法创建一个根节点，根节点和普通节点一样，都是 `vNode` 对象，但根节点上会保存会变化的子节点  
可以看到，内部会调用 [createVNode](#createVNode) 来创建根节点对象，并且将所有的参数全部传给 `createVNode`，所以这两个函数接受的参数是一样的 

1. 节点类型  
    1. 对于原生 `DOM` 来说，就是标签名称，例如 `'div'`  
    2. 对于 Class Component 来说，就是 Class 本身，并且含有静态属性 `__vccOpts`
2. 节点属性 `props`  
3. 子节点 
4. 需要变化的类型，就是上面 `patchFlag` 几种类型，若存在多个则由 按位或 合成
5. 动态属性  

```typescript
function createBlock(
  type: VNodeTypes | ClassComponent,
  props?: { [key: string]: any } | null,
  children?: any,
  patchFlag?: number,
  dynamicProps?: string[]
): VNode {
  // ①
  // avoid a block with patchFlag tracking itself
  shouldTrack--
  // 创建根节点对应的 vNode 对象
  const vnode = createVNode(type, props, children, patchFlag, dynamicProps)
  // ②
  shouldTrack++

  // ③
  // 将所有的需要变化的子节点挂载到根节点的 dynamicChildren 上
  // 根节点在每个 block 的最后才会创建，在这之前，已经会把所有需要追踪的子节点放进当前 block 中
  vnode.dynamicChildren = currentBlock || EMPTY_ARR

  // 释放 block 栈，并更新当前 block 为栈中的上一个
  blockStack.pop()
  currentBlock = blockStack[blockStack.length - 1] || null

  // a block is always going to be patched, so track it as a child of its
  // parent block
  // ④
  if (currentBlock) {
    currentBlock.push(vnode)
  }

  return vnode
}
```  

主要流程如下  
1. 减去 `shouldTrack`  
2. 创建根节点 `vNode` 对象  
3. 恢复 `shouldTrack`  
4. 将根节点下所有需要追踪的子节点挂载到 `dynamicChildren` 属性中  
5. `block` 出栈  
6. 

## createVNode  

```typescript
function createVNode(
  type: VNodeTypes | ClassComponent,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null
): VNode {
  // 默认为注释 Comment 节点
  if (!type) {
    type = Comment
  }

  // 处理 Class Component 情况
  if ( isFunction(type) && '__vccOpts' in type ) {
    type = type.__vccOpts
  }

  // 设置 class 和 style 两种 props
  if (props) {
    // for reactive or proxy objects, we need to clone it to enable mutation.
    // ①
    if (isProxy(props) || InternalObjectKey in props) {
      props = extend({}, props)
    }

    // 序列化 class 为字符串，并将结果挂载到 props.class 中
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

      // 序列化 style 对象，并将结果挂载到 props.style 中
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
  // 这里主要是处理需要追踪的节点，将 vnode push 到当前 block 中
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

主要分为这么几个步骤  
1. 处理 Class Component 的情况  
2. 设置 `class` 和 `style` 两个属性  
3. 根据 `type` 来设置 `shapeFlag`  
4. 创建 `vNode` 对象  
5. 设置子节点内容和 `shapeFlag`  
6. 如果当前节点需要追踪则放入 `block` 中  

<!-- ## shouldTrack  
这是一个全局变量，它的值是数值，每次创建一个根节点，就会 - 1，创建完成后再 + 1  

因为在 [createNode](#createNode) ④ 中，会判断 `shouldTrack` 是否大于 `0`
  * 如果大于 `0` 则说明当前创建的不是根节点，则根据其他逻辑判断是否将节点存入 `block` 中
  * 如果不是，则说明创建的是根节点，不需要存入 `block` 中  

**所以，这个变量可以用来区分当前创建的节点是否是根节点**    -->

## 示例  

### 示例一 基本使用

```typescript
const node = (_openBlock(), _createBlock("div", { class: "container" }, [
  _createVNode("span", { class: "text1" }, "This is span element.", PatchFlags.TEXT),
  _createVNode("span", { class: "text2" }, "This is static span element.")
]))
```  

这段代码调用顺序是这样的  
1. 开启一个新的 `block`  
2. 创建两个 `span` 节点，并将第一个放入当前 `block` 中，视为需要追踪的节点  
3. 创建根节点 `div`，并挂载需要追踪的节点集合，最后释放当前的 `block`  

根节点的 `dynamicChildren` 保存了追踪的节点 `span`  

### 示例二 嵌套使用 openBlock  

```typescript
const hoist = createVNode('div', { class: 'hoist' });
let vnode1, vnode2, vnode3;
const vnode = (openBlock(), createBlock('div', { class: 'root' }, [
  hoist,
  vnode1 = createVNode('div', { class: 'text1' }, 'text', PatchFlags.TEXT),
  vnode2 = (openBlock(), createBlock('div', { class: 'content' }, [
    hoist,
    vnode3 = createVNode('div', { class: 'text2' }, 'text', PatchFlags.TEXT)
  ]))
]))
```  

1. 开启一个新的 `block`( 称为 `block1` )，创建 `vnode1` 节点，并存入 `block1` 中，需要追踪
2. 在开启一个新的 `block`( 称为 `block2` )，创建 `vnode3` 节点，并存入 `block2` 中，需要追踪  
3. 创建 `vnode2` 根节点，将它的子节点中，需要追踪的节点记录下来，即 `block2` 中的节点  
4. 恢复当前 `block` 为 `block1`，此时会将 `vnode2` 存入 `block1` 中  
5. 创建 `vnode` 根节点，并挂载需要追踪的节点   

### 示例三 特殊节点也需要追踪  

在 `createVNode` ④ 处的逻辑可以看到，需要追踪的节点有以下情况  
1. `patchFlag` 仅仅是 `HYDRATE_EVENTS` 时，不会追踪  
2. `patchFlag` 为有效值，会追踪  
3. suspense 组件、stateful 组件、function component 组件，都需要追踪  

```typescript
let vnode1, vnode2
const vnode = (openBlock(), createBlock('div', { class: 'root' }, [
  vnode1 = createVNode('div', null, 'text', PatchFlags.HYDRATE_EVENTS),
  vnode2 = createVNode('div', null, 'text', PatchFlags.TEXT),
  vnode3 = createVNode({}, null, 'text'),
  vnode4 = createVNode(() => {}, null, 'text'),
  vnode5 = createVNode({ __isSuspense: true }, null, 'text'),
]))
```  

上面代码中，只有 `vnode2`、`vnode3`、`vnode4` 和 `vnode5` 会被视为需要追踪的节点  

## normalizeVNode  

这个