<!-- TOC -->

- [缓存节点](#缓存节点)
- [作用域中缓存的方法](#作用域中缓存的方法)
- [v-once 钩子函数](#v-once-钩子函数)

<!-- /TOC -->

## 缓存节点

先来看缓存表达式的结构

```ts
export interface CacheExpression extends Node {
    type: NodeTypes.JS_CACHE_EXPRESSION	// 类型为缓存表达式
    index: number												// 缓存的个数，从 0 开始
    value: JSChildNode									// 具体缓存的值
    isVNode: boolean										// 缓存的是否是 vnode 节点
}
```

同样还存在创建缓存表达式的方法

```ts
export function createCacheExpression(
    index: number,						// 个数
    value: JSChildNode,				// 值
    isVNode: boolean = false	// 是否是 vnode
): CacheExpression {
    return {
        type: NodeTypes.JS_CACHE_EXPRESSION,
        index,
        value,
        isVNode,
        loc: locStub
    }
}
```

## 作用域中缓存的方法

作用域中存在 `cached` 属性，它表示缓存的个数，初始为 `0`，每次创建缓存节点都会 + 1

而真正创建缓存节点的是作用域中的 `cache` 方法

```ts
cache(
    exp,						// 缓存的值
    isVNode = false	// 缓存的是否是 vnode 节点
) {
  	// 调用 createCacheExpression 创建缓存节点
    return createCacheExpression(++context.cached, exp, isVNode)
}
```

## v-once 钩子函数

`v-once` 比较简单，直接来看源码

```ts
// 存储已经缓存过的节点
const seen = new WeakSet()

export const transformOnce: NodeTransform = (node, context) => {
  	// 1. 只会处理含有 v-once 指令的元素节点
    if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
      	// 1.1 如果节点已经缓存过，则不再做任务处理
        if (seen.has(node)) {
            return
        }
      	// 1.2 记录需要缓存的节点
        seen.add(node)
      	// 1.3 导入 setBlockTracking 模块函数，再生成渲染函数时会用到这个模块
        context.helper(SET_BLOCK_TRACKING)
      	// 1.4 退出函数
        return () => {
          	// 1.4.1 获取当前节点
            const cur = context.currentNode as ElementNode | IfNode | ForNode
            // 1.4.2 当前节点的子节点已经全部转换完成，生成器已经创建好了
            //			 修改生成器为缓存节点
            if (cur.codegenNode) {
                cur.codegenNode = context.cache(cur.codegenNode, true /* isVNode */)
            }
        }
    }
}
```

1. 什么情况下会进入 1.1 的逻辑，也就是同一个节点会进行多次转换？

    只有当替换节点后，才能再次进入同一个节点进行转换，也就是 `v-if` 或 `v-for` 两个指令，例如以下代码的流程就是

    ```html
    <div v-for="i in items" v-once></div>
    ```

    1. `div` 节点会先进入 `v-once` 的钩子中，创建好 1.4 的退出函数
    2. 之后进入 `v-for` 的钩子中，用 `v-for` 节点替换掉了 `div` 节点，接下来会再次对 `div` 节点开始转换
    3. 再次进入 `v-once` 的钩子中，由于是第二次，所以不会再创建退出函数了
    4. 等到所有子节点都处理完成，会进入之前创建好的退出函数，将当前节点(`v-for`)的生成器进行缓存

    
