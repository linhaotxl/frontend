<!-- TOC -->

- [追踪 v-slot 作用域的钩子 —— trackSlotScopes](#追踪-v-slot-作用域的钩子--trackslotscopes)
- [追踪 v-for 的钩子 —— trackVForSlotScopes](#追踪-v-for-的钩子--trackvforslotscopes)
- [构建 slots](#构建-slots)
    - [v-slot 指令出现的地方](#v-slot-指令出现的地方)
    - [slot 的两种形式](#slot-的两种形式)
    - [工具方法](#工具方法)
        - [创建插槽函数 —— buildClientSlotFn](#创建插槽函数--buildclientslotfn)
        - [创建 slots 实体插槽对象 —— buildDynamicSlot](#创建-slots-实体插槽对象--builddynamicslot)
    - [创建 slot](#创建-slot)
        - [hasForwardedSlots](#hasforwardedslots)
- [检测是否存在作用域中的引用变量 —— hasScopeRef](#检测是否存在作用域中的引用变量--hasscoperef)

<!-- /TOC -->

**这篇内容主要介绍与 `v-slot` 指令相关的钩子**

## 追踪 v-slot 作用域的钩子 —— trackSlotScopes  
这个函数用来追踪 `v-slot` 产生的 `slot props`，在后面会看到它的用法  

```ts
export const trackSlotScopes: NodeTransform = (node, context) => {
    // 1. 只会处理组件以及 template 节点
    if (
        node.type === NodeTypes.ELEMENT &&
        (node.tagType === ElementTypes.COMPONENT ||
        node.tagType === ElementTypes.TEMPLATE)
    ) {
        // 1.1 查找 v-slot 非空的指令，主要是将 slot props 添加到作用域中，避免在子节点碰到 slot props 增加前缀
        const vSlot = findDir(node, 'slot')
        // 1.2 处理存在指令值的情况
        if (vSlot) {
            // 1.2.1 将 slot props 添加到 identifiers 中，等到转换子节点时，碰见这些 props 不会增加来源前缀
            const slotProps = vSlot.exp
            if (!__BROWSER__ && context.prefixIdentifiers) {
                slotProps && context.addIdentifiers(slotProps)
            }
            // 1.2.2 增加作用域 vSlot 的个数
            context.scopes.vSlot++
            // 1.2.3 退出函数，会等到所有子节点转换完成执行
            return () => {
                // 1.2.3.1 从 identifiers 中移除 slot props，并恢复作用域中的 vSlot 个数
                if (!__BROWSER__ && context.prefixIdentifiers) {
                    slotProps && context.removeIdentifiers(slotProps)
                }
                context.scopes.vSlot--
            }
        }
    }
}
```

## 追踪 v-for 的钩子 —— trackVForSlotScopes  
这个函数用来追踪 `<template v-for v-slot />` 产生的 `v-for` 相关的项目、`key` 以及索引，在后面会看到具体用法  

```ts
export const trackVForSlotScopes: NodeTransform = (node, context) => {
    let vFor
    // 1. 查找 <template v-slot v-for> 的情况，包存储 v-for 节点
    if (
        isTemplateNode(node) &&
        node.props.some(isVSlot) &&
        (vFor = findDir(node, 'for'))
    ) {
        // 1. 解析 v-for 的值
        const result = (vFor.parseResult = parseForExpression(
            vFor.exp as SimpleExpressionNode,
            context
        ))
        // 2. 将项目，key，索引添加到 identifiers 中
        if (result) {
            const { value, key, index } = result
            const { addIdentifiers, removeIdentifiers } = context
            value && addIdentifiers(value)
            key && addIdentifiers(key)
            index && addIdentifiers(index)

            // 2.1 退出函数，将刚才添加的项目、key、索引从 identifiers 中移除
            return () => {
                value && removeIdentifiers(value)
                key && removeIdentifiers(key)
                index && removeIdentifiers(index)
            }
        }
    }
}
```

## 构建 slots  

### v-slot 指令出现的地方  
`v-slot` 指令可以出现在两个标签上，“`template`” 和 “组件” 上，先来看看它们的区别

以下两种写法是等价的，没有区别

```html
<!--写法一：v-slot 在组件上，只适用于存在一个插槽-->
<inner v-slot="slotProps">
	<div>{{slotProps.firstName}}</div>
</inner>

<!--写法二：常规写法-->
<inner>
	<template v-slot="slotProps">
		<div>{{slotProps.firstName}}</div>
	</template>
</inner>

```

但是当 `inner` 内存在多个插槽时，写法一就不支持了，只能通过写法二，例如

```html
<inner>
	<template v-slot="slotProps">
		<div>{{slotProps.firstName}}</div>
	</template>

	<template v-slot:fallback="slotProps">
		<div>{{slotProps.lastName}}</div>
	</template>
</inner>
```

### slot 的两种形式
创建 `slots` 有两种方法，接来下通过每种类型的结构来介绍  

1. 对象创建，其中 `key` 是插槽名，`value` 是渲染子节点的方法(以下称为 “插槽函数”)，同时还存在插槽类型属性(后面会看到)  
	先来看 `slots` 对象的结构  

	```ts
	// slots 对象
    export interface SlotsObjectExpression extends ObjectExpression {
		properties: SlotsObjectProperty[]
    }
	// slots 对象属性
    export interface SlotsObjectProperty extends Property {
		// value 是插槽函数
		value: SlotFunctionExpression
    }
	// 插槽函数
	export interface SlotFunctionExpression extends FunctionExpression {
		returns: TemplateChildNode[]
    }
	```
  
2. 函数创建，通过 `createSlots` 函数创建，只有 `template` 上存在 `v-if` 或 `v-for` 的插槽才会用函数创建，接受两个参数，如下  
	```ts
	export interface DynamicSlotsExpression extends CallExpression {
		callee: typeof CREATE_SLOTS
		arguments: [
			SlotsObjectExpression,	// 静态 slots 对象，包括没有使用 v-if、v-for 的那些插槽以及插槽类型
			DynamicSlotEntries		// slots 实体列表
		]
	}
	
	// slots 实体插槽列表，其中元素只会存在 v-if 生成的条件表达式，以及 v-for 生成的 renderList 函数
	export interface DynamicSlotEntries extends ArrayExpression {
		elements: (ConditionalDynamicSlotNode | ListDynamicSlotNode)[]
	}
	
	// 存在 v-if 的插槽
	export interface ConditionalDynamicSlotNode extends ConditionalExpression {
		consequent: DynamicSlotNode
		// 不满足条件的情况默认是 undefined
		alternate: DynamicSlotNode | SimpleExpressionNode
	}
	
	// slots 实体插槽对象，其中只会有两个属性
	// 第一个是插槽名称属性，key 是 name，value 是具体名称
	// 第二个是插槽函数属性，key 是 fn，value 插槽函数
	export interface DynamicSlotNode extends ObjectExpression {
		properties: [Property, DynamicSlotFnProperty]
	}
	
	export interface DynamicSlotFnProperty extends Property {
		value: SlotFunctionExpression
	}
	
	// 存在 v-for 的插槽，返回值就是 实体插槽对象
	export interface ListDynamicSlotIterator extends FunctionExpression {
		returns: DynamicSlotNode
	}
	```

### 工具方法

先来看几个后面会用到的方法

#### 创建插槽函数 —— buildClientSlotFn

这个函数用来创建上面说的 “插槽函数”，实现很简单  

```ts
export type SlotFnBuilder = (
	slotProps: ExpressionNode | undefined,	// 插槽接受的 slot props
	slotChildren: TemplateChildNode[],		// 子节点列表
	loc: SourceLocation
) => FunctionExpression						// 返回插槽函数

const buildClientSlotFn: SlotFnBuilder = (props, children, loc) => createFunctionExpression(
	props,								// 函数参数
	children,							// 函数返回值
	false, 								// 不需要换行
	true,								// 函数是 slot 生成的
	children.length ? children[0].loc : loc
)
```

#### 创建 slots 实体插槽对象 —— buildDynamicSlot

```ts
function buildDynamicSlot(
	name: ExpressionNode,	// 插槽名称
	fn: FunctionExpression	// 插槽函数
): ObjectExpression {		// 返回对象，其中只有两个属性，插槽名称 name 和插槽函数 fn
	return createObjectExpression([
		createObjectProperty(`name`, name),
		createObjectProperty(`fn`, fn)
	])
}
```

### 创建 slot
这个函数会被调用在 [transformElement]() 中创建组件插槽的时候，先来看它的返回值  

```ts
export function buildSlots(
	node: ElementNode,								// 组件节点
	context: TransformContext,						// 作用域
	buildSlotFn: SlotFnBuilder = buildClientSlotFn	// 创建插槽函数的方法
): {
	slots: SlotsExpression		// slots 表达式
	hasDynamicSlots: boolean	// 是否存在动态 slots
}
```  

其中 `slots` 表达式就是 “`slots` 对象” 和 “`slots` 函数” 的联合类型  
  
```ts
export type SlotsExpression = SlotsObjectExpression | DynamicSlotsExpression
```  

接下来看具体的实现过程  

```ts
export function buildSlots(
	node: ElementNode,
	context: TransformContext,
	buildSlotFn: SlotFnBuilder = buildClientSlotFn
): {
	slots: SlotsExpression
	hasDynamicSlots: boolean
} {
	// 1. 导入 withCtx 模块，在 生成 阶段会用到
	context.helper(WITH_CTX)
	// 2. 获取组件的子节点列表
	const { children, loc } = node
	// 3. 定义对象 slots 的属性列表
	const slotsProperties: Property[] = []
	// 4. 定义函数 slots 的实体插槽列表
	const dynamicSlots: (ConditionalExpression | CallExpression)[] = []

	// 5. 定义创建 default 的插槽属性
	const buildDefaultSlotProperty = (
		props: ExpressionNode | undefined,	// slot props
		children: TemplateChildNode[]		// 子节点
	) => createObjectProperty(
		`default`,
		buildSlotFn(props, children, loc)	// 创建 default 插槽函数
	)

	// 6. 是否存在动态 slots 的开关
	// 	  如果当前节点处于 v-slot、v-for 内，则强制开启处于动态 slots
	let hasDynamicSlots = context.scopes.vSlot > 0 || context.scopes.vFor > 0
	// 7. 检测 node 节点中的内容，是否存引用了作用域中的变量，并将结果重写 hasDynamicSlots
	if (!__BROWSER__ && !context.ssr && context.prefixIdentifiers) {
		hasDynamicSlots = hasScopeRef(node, context.identifiers)
	}

	// 8. 检测组件上是否存在 v-slot 指令
	//    <Comp v-slot="{ prop }"/>、<Comp v-slot />
	const onComponentSlot = findDir(node, 'slot', true)
	if (onComponentSlot) {
		// 8.1 获取组件上 v-slot 的参数和值
		const { arg, exp } = onComponentSlot
		// 8.2 如果参数是动态的，则标记存在动态 slots
		if (arg && !isStaticExp(arg)) {
			hasDynamicSlots = true
		}
		// 8.3 创建插槽属性，并存入 slotsProperties 中
		slotsProperties.push(
			createObjectProperty(
				arg || createSimpleExpression('default', true),	// 参数没有时使用 default 插槽
				buildSlotFn(exp, children, loc)					// 创建插槽函数
			)
		)
	}

	// 9. 是否存在 template 的 slot，即 v-slot 存在于 template 上，<template v-slot:foo="{ prop }">
	let hasTemplateSlots = false
	// 10. 是否存在默认插槽，<template v-slot />、<template v-slot:default="" />
	let hasNamedDefaultSlot = false
	// 11. 隐式存在于 default 插槽内的子节点
	// 	   <Comp>
	// 	     <div></div>
	// 	     <span></span>
	// 	   </Comp>
	const implicitDefaultChildren: TemplateChildNode[] = []
	// 12. 存储静态插槽名的集合，用于检测是否重复出现插槽名
	const seenSlotNames = new Set<string>()

	// 13. 遍历组件所有子节点
	for (let i = 0; i < children.length; i++) {
		const slotElement = children[i]
		let slotDir

		// 13.1 过滤不是 template，也没有 v-slot 的节点，将其视为隐式默认插槽的子节点
		//		<template v-slot>
		if (
			!isTemplateNode(slotElement) ||
			!(slotDir = findDir(slotElement, 'slot', true))
		) {
			if (slotElement.type !== NodeTypes.COMMENT) {
				implicitDefaultChildren.push(slotElement)
			}
			continue
		}

		// 13.2 如果在组件上使用了 v-slot，又在子节点中使用 <template v-slot />，抛错
		// 		  组件已经作为插槽，不能再嵌套使用 v-slot
		if (onComponentSlot) {
			context.onError(
				createCompilerError(ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE, slotDir.loc)
			)
			break
		}

		// 13.3 标记 hasTemplateSlots，template 上存在 v-slot
		hasTemplateSlots = true
		// 13.4 获取 template 的子节点
		const { children: slotChildren, loc: slotLoc } = slotElement
		// 13.5 获取 template 上的 v-slot 的参数(默认是 default)和值(slot props)
		const {
			arg: slotName = createSimpleExpression(`default`, true),
			exp: slotProps,
			loc: dirLoc
		} = slotDir

		// 13.6 定义 v-slot 的静态插槽名
    	// 		如果参数是静态，则获取参数名，否则标记存在动态 slot
		let staticSlotName: string | undefined
		if (isStaticExp(slotName)) {
			staticSlotName = slotName ? slotName.content : `default`
		} else {
			hasDynamicSlots = true
		}

		// 13.4 创建插槽函数
		const slotFunction = buildSlotFn(slotProps, slotChildren, slotLoc)

		// 13.5 定义以下三种指令节点，接下来会用到
		let vIf: DirectiveNode | undefined		// v-if
		let vElse: DirectiveNode | undefined	// v-else-if、v-else
		let vFor: DirectiveNode | undefined		// v-for

		// 13.6 检测 template 上是否存在 v-if，并获取 v-if 指令
		if ((vIf = findDir(slotElement, 'if'))) {
			// 13.6.1 标记动态 slot
			hasDynamicSlots = true
			// 13.6.2 创建 v-if 的实体插槽，是一个条件表达式
			dynamicSlots.push(
				createConditionalExpression(
					vIf.exp!,									// 条件是 v-if 的值
					buildDynamicSlot(slotName, slotFunction),	// 满足条件的节点是实体插槽对象	
					defaultFallback								// 不满足的节点是 undefined
				)
			)
		}
		// 13.7 检测 template 上是否存在 v-else-if、v-else，并获取指令
		else if ((vElse = findDir(slotElement, /^else(-if)?$/, true /* allowEmpty */))) {
			// 13.7.1 从当前 template 开始向前查找，找到第一个不是注释的节点
			let j = i
			let prev
			while (j--) {
				prev = children[j]
				if (prev.type !== NodeTypes.COMMENT) {
					break
				}
			}
			// 13.7.2 如果找到的结果是带有 v-if 的 template，则说明是有效的
			if (prev && isTemplateNode(prev) && findDir(prev, 'if')) {
				// 13.7.2.1 删除当前 template
				children.splice(i, 1)
				i--

				// 13.7.2.2 获取实体插槽列表的最后一个节点，应该是 13.6.2 创建的条件表达式
				let conditional = dynamicSlots[dynamicSlots.length - 1] as ConditionalExpression
				// 13.7.2.3 获取条件表达式中最后一个分支，可能会存在多个 v-else-if，所以需要获取最后一个
				while (conditional.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
					conditional = conditional.alternate
				}
				// 13.7.2.4 更新最后一个分支不满足条件的节点
				conditional.alternate = vElse.exp
					// v-else-if，创建新的条件表达式
					? createConditionalExpression(
						vElse.exp,
						buildDynamicSlot(slotName, slotFunction),
						defaultFallback
					)
					// v-else，创建实体插槽对象
					: buildDynamicSlot(slotName, slotFunction)
			}
			// 13.7.3 如果找到的结果不是带有 v-if 的 template，则说明是无效的，抛错
			else {
				context.onError(
					createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, vElse.loc)
				)
			}
		}
		// 13.8 检测 template 上是否存在 v-for，并获取 v-for 指令
		else if ((vFor = findDir(slotElement, 'for'))) {
			// 13.8.1 标记存在动态 slots
			hasDynamicSlots = true
			// 13.8.2 获取 v-for 指令的解析结果
			const parseResult =
				vFor.parseResult ||
				parseForExpression(vFor.exp as SimpleExpressionNode, context)
			// 13.8.3 解析结果存在，会创建渲染 v-for 的 renderList 函数
			//		  renderList 返回的是实体插槽对象
			if (parseResult) {
				dynamicSlots.push(
					createCallExpression(context.helper(RENDER_LIST), [
						parseResult.source,
						createFunctionExpression(
							createForLoopParams(parseResult),
							buildDynamicSlot(slotName, slotFunction),
							true
						)
					])
				)
			}
			// 13.8.4 v-for 的解析结果不存在，直接抛错
			else {
				context.onError(
					createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, vFor.loc)
				)
			}
		}
		// 13.9 不存在 v-if、v-else-if、v-else 以及 v-for 
		else {
			// 13.9.1 检测 template 上的静态插槽名是否重复出现，如果重复出现会抛错，而且不会再解析后面的
			if (staticSlotName) {
				if (seenSlotNames.has(staticSlotName)) {
					context.onError(
						createCompilerError(
							ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES,
							dirLoc
						)
					)
					continue
				}
				seenSlotNames.add(staticSlotName)
				// 13.9.1.1 如果存在默认插槽，则标识 hasNamedDefaultSlot
				if (staticSlotName === 'default') {
					hasNamedDefaultSlot = true
				}
			}
			// 13.9.2 创建 slotName 的插槽属性，并存入 slotsProperties
			slotsProperties.push(createObjectProperty(slotName, slotFunction))
		}
	}

	// 14. 组件上不存在 v-slot 指令
	if (!onComponentSlot) {
		// 14.1 不存在 template，则说明是隐式的插槽，则为组件的所有子节点创建 default 插槽属性
		if (!hasTemplateSlots) {
			slotsProperties.push(buildDefaultSlotProperty(undefined, children))
		}
		// 14.2 存在 template 插槽，也存在隐式插槽
		else if (implicitDefaultChildren.length) {
			// 14.2.1 如果此时还存在默认插槽，则抛错，default 插槽与隐式插槽冲突
			// 		  <Comp>
			// 		    <div></div>
			// 		    <template v-slot></template>
			//   	  </Comp>
			if (hasNamedDefaultSlot) {
				context.onError(
					createCompilerError(
						ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
						implicitDefaultChildren[0].loc
					)
				)
			}
			// 14.2.2 为隐式节点创建 default 插槽属性
			else {
				slotsProperties.push(
					buildDefaultSlotProperty(undefined, implicitDefaultChildren)
				)
			}
		}
	}

	// 15. 获取插槽类型
	const slotFlag = hasDynamicSlots
		? SlotFlags.DYNAMIC						// 存在动态 slots
			: hasForwardedSlots(node.children)
			? SlotFlags.FORWARDED				// 存在转换 slots
		: SlotFlags.STABLE						// 剩余都是稳定型

	// 16. 创建 slots 对象，在 slotsProperties 的基础上再增加 slots 类型属性 _
	let slots = createObjectExpression(
		slotsProperties.concat(
			createObjectProperty(
				`_`,
				createSimpleExpression(
					slotFlag + (__DEV__ ? ` /* ${slotFlagsText[slotFlag]} */` : ``),
					false
				)
			)
		),
		loc
	) as SlotsExpression
	
	// 17. 如果存在 v-if、v-for 产生的实体插槽，创建 createSlots 函数调用
	if (dynamicSlots.length) {
		slots = createCallExpression(context.helper(CREATE_SLOTS), [
			slots,
			createArrayExpression(dynamicSlots)
		]) as SlotsExpression
	}

	// 18. 返回结果
	return {
		slots,
		hasDynamicSlots
	}
}
```  

1. `slots` 类型  
	`slots` 共有三种类型，分别如下  

	```ts
	export const enum SlotFlags {
		/**
		 * 稳定型：除了以下两种之外，都是稳定型
		 */
		STABLE = 1,
		/**
		 * 动态型：存在动态 slots
		 */
		DYNAMIC = 2,
		/**
		 * 转换型：当插槽内含有 <slot /> 时，这个插槽被称为转换型
		 */
		FORWARDED = 3
	}
	```  


2. 什么时候会进入第 7 步？  
	第 7 步是检测节点自身的 `props` 以及 `children` 中是否存在作用域中的变量，接下来分别举例说明  

	```html
	<div v-for="i in list">
		<Inner v-slot="bar">foo</Inner>
	</div>
	
	<Outer v-slot="foo">
        <Inner v-slot="bar">{{ bar }}</Inner>
	</Outer>
	```
	在解析 `Inner` 的子节点时，由于已经在 `v-for`、`v-slot` 内，所以 `hasDynamicSlots` 先被设置为 `true`，接下来在 `Inner` 内没有找到使用作用域中的变量  
	所以 `hasDynamicSlots` 又被设置为 `false`  

	而下面的示例由于在 `Inner` 内可以找到作用域中的变量，所以 `hasDynamicSlots` 又会被设置为 `true`  
	```html
	<div v-for="i in list">
        <Inner v-slot="bar">{{ i }}</Inner>
	</div>
	
	<Outer v-slot="foo">
        <Inner v-slot="bar">{{ foo }}</Inner>
	</Outer>
	```

3. 执行顺序，为什么以下的两个 `slots` 都是 `STABLE`？  
  
	```html
	<Outer v-slot="foo">
		<Inner v-slot="bar">{{ bar }}</Inner>
	</Outer>
	```  
	
	因为 [transformElement]() 钩子会在 [trackSlotScopes]() 钩子之前，所以 [trackSlotScopes]() 的 “退出函数” 会先执行  
	这就导致在 [transformElement]() 通过 [buildSlots]() 创建 `slots` 时，当前的 `slot props` 已经不在 `identifiers` 中的了，也就无法检测出当前节点在 `identifiers` 中的引用了  
	所以上面示例中，创建 `Inner` 的 `buildSlots` 中，`identifiers.bar` 已经是 `0` 了，所以它是 `STABLE` 的  


3. 13.8.2 中 `v-for` 的解析结果是从哪里解析的呢？  
	就是通过 [trackvforslotscopes](#追踪-v-for-的钩子--trackvforslotscopes) 钩子解析的，所以 [trackvforslotscopes](#追踪-v-for-的钩子--trackvforslotscopes) 钩子的顺序肯定要在 [transformElement]() 之前  


#### hasForwardedSlots  
这个函数用来检测子节点中是否存在 `<slot />`，存在的话就说明插槽是 “转换型”  

```ts
function hasForwardedSlots(children: TemplateChildNode[]): boolean {
	// 遍历子节点
	//   如果子节点是 <slot />，则返回 true
	//   如果子节点是不是 <slot />，而是一个元素，则再次向下递归查找
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (child.type === NodeTypes.ELEMENT) {
			if (
				child.tagType === ElementTypes.SLOT ||
				(child.tagType === ElementTypes.ELEMENT &&
				hasForwardedSlots(child.children))
			) {
				return true
			}
		}
	}
	return false
}
```  

## 检测是否存在作用域中的引用变量 —— hasScopeRef  
这个方法用来检测指定节点中是否引用了作用域中的变量  

```ts
export function hasScopeRef(
	node: TemplateChildNode | IfBranchNode | ExpressionNode | undefined,	// 待检测节点
	ids: TransformContext['identifiers']									// 变量引用集合，也就是作用域中的 identifiers 对象
): boolean {
	// 1. 如果节点不存在，或者引用集合中没有变量，直接返回 false，表示没有引用
	if (!node || Object.keys(ids).length === 0) {
		return false
	}
	// 根据各个类型来检测
	switch (node.type) {
		// 2. 检测元素节点
		case NodeTypes.ELEMENT:
			// 2.1 遍历元素上的所有指令，依次检测指令参数、指令值中是否引用了变量
			for (let i = 0; i < node.props.length; i++) {
				const p = node.props[i]
				if (
					p.type === NodeTypes.DIRECTIVE &&
					(hasScopeRef(p.arg, ids) || hasScopeRef(p.exp, ids))
				) {
					return true
				}
			}
			// 2.2 遍历所有子节点，检测子节点是否引用了遍历
			return node.children.some(c => hasScopeRef(c, ids))
		// 3. 检测 v-for 节点
		case NodeTypes.FOR:
			// 3.1 检测 v-for 的源数据中是否引用了变量
			if (hasScopeRef(node.source, ids)) {
				return true
			}
			// 3.2 遍历所有子节点，检测子节点是否引用了变量
			return node.children.some(c => hasScopeRef(c, ids))
		// 4. 检测 v-if 节点，遍历每个 if 分支，检测分支是否引用了变量
		case NodeTypes.IF:
			return node.branches.some(b => hasScopeRef(b, ids))
		// 5. 检测 if 分支节点
		case NodeTypes.IF_BRANCH:
			// 5.1 检测分支中的条件是否引用了变量
			if (hasScopeRef(node.condition, ids)) {
				return true
			}
			// 5.2 遍历所有子节点，检测子节点是否引用了变量
			return node.children.some(c => hasScopeRef(c, ids))
		// 6. 检测简单表达式，满足以下条件才属于引用了变量
		// 	  a. 必须是动态
		//    b. 变量必须是简单类型
		//    c. 变量在 ids 中的引用数不是 0
		case NodeTypes.SIMPLE_EXPRESSION:
			return (
				!node.isStatic &&
				isSimpleIdentifier(node.content) &&
				!!ids[node.content]
			)
		// 7. 复合表达式，检测每一个子节点是否引用了变量
		case NodeTypes.COMPOUND_EXPRESSION:
			return node.children.some(c => isObject(c) && hasScopeRef(c, ids))
		// 8. 插值，创建文本节点，检测文本内容是否引用了变量
		case NodeTypes.INTERPOLATION:
		case NodeTypes.TEXT_CALL:
			return hasScopeRef(node.content, ids)
		// 9. 文本、注释，都不会引用变量
		case NodeTypes.TEXT:
		case NodeTypes.COMMENT:
			return false
		// 10. 剩余情况均视为不会引用
		default:
			return false
	}
}
```  
