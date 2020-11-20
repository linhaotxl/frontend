> 为了更加清楚理解源码的意义，代码的顺序做了调整  

<!-- TOC -->

- [unmount](#unmount)
- [unmountChildren](#unmountchildren)
- [remove](#remove)

<!-- /TOC -->

# unmount  

这个函数是 `vnode` 卸载的入口函数  

```typescript
const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false,	// 是否立即移除真实 DOM 元素
    optimized = false
) => {
    const {
		type,
		props,
		ref,
		children,
		dynamicChildren,
		shapeFlag,
		patchFlag,
		dirs
    } = vnode
    
    // 卸载 ref
    if (ref != null && parentComponent) {
		setRef(ref, null, parentComponent, parentSuspense, null)
    }

    // 处理 keep-alive 组件卸载
    if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
		;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
		return
    }

    // 检测是否存在指令（ 指令都会挂载在元素上，所以要判断是否是元素 ）
    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs

    // 处理 vnode 上的 before unmount 钩子
    let vnodeHook: VNodeHook | undefined | null
    if ((vnodeHook = props && props.onVnodeBeforeUnmount)) {
		invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    if (shapeFlag & ShapeFlags.COMPONENT) {
		// 处理组件的卸载
		unmountComponent(vnode.component!, parentSuspense, doRemove)
    } else {
		// 处理 Suspense 组件卸载
		if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
			vnode.suspense!.unmount(parentSuspense, doRemove)
			return
		}

		// 执行指令的 beforeUnmount 钩子
		if (shouldInvokeDirs) {
			invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
		}

		if (
			dynamicChildren &&
			// #1153: fast path should not be taken for non-stable (v-for) fragments
			(type !== Fragment ||
			(patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
		) {
			// 这里需要卸载所有的子节点，但并不会立即移除真实的 DOM 元素，而是会等到最后，直接将当前节点移除，下面卸载子节点也是同理
			// TODO: 这里卸载子节点，只会卸载第一层的子节点，不会再往下搜索
			// fast path for block nodes: only need to unmount dynamic children.
			unmountChildren(
				dynamicChildren,
				parentComponent,
				parentSuspense,
				false,
				true
			)
		} else if (!optimized && shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
			// 只有当非优化模式，且含有子元素时，才会去卸载子元素，优化模式下不会下载子元素
			unmountChildren(children as VNode[], parentComponent, parentSuspense)
		}

		// 处理 Telport 组件的移除
		if (shapeFlag & ShapeFlags.TELEPORT) {
			;(vnode.type as typeof TeleportImpl).remove(vnode, internals)
		}

		// 检测是否需要立即移除当前节点，是的话立即调用移除函数
		if (doRemove) {
			remove(vnode)
		}
    }

    // 卸载完成，将 vnode 以及指令的 unmounted 钩子放入 post 队列中等待执行
    if ((vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs) {
		queuePostRenderEffect(() => {
			vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
			shouldInvokeDirs &&
			invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
		}, parentSuspense)
    }
}
```



# unmountChildren

这个函数用来卸载子节点列表，对每个子节点调用 [unmount](#unmount) 来实现  

```typescript
const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    optimized = false,
    start = 0
) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove, optimized)
    }
}
```



# remove

这个函数用来移除真实的 DOM 节点  

```typescript
const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode

    // 对 Fragment 节点进行单独的移除处理
    if (type === Fragment) {
      removeFragment(el!, anchor!)
      return
    }

		// 定义实际执行移除的函数
    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        performLeave()
      }
    } else {
      // 调用移除函数
      performRemove()
    }
}
```

