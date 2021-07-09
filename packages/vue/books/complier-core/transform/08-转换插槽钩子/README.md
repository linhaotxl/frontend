<!-- TOC -->

- [转换 slot —— transformSlotOutlet](#转换-slot--transformslotoutlet)
    - [获取 slot 的名称以及 props](#获取-slot-的名称以及-props)

<!-- /TOC -->

这篇主要介绍 `<slot></slot>` 标签的转换，`slot` 必须通过 `renderSlot` 渲染，所以在 `slot` 外面会包括一层 `renderSlot` 的调用节点  
它的参数如下  

1. 父组件插槽集合  
2. `slot` 插槽的名称  
3. `slot` 插槽的 `props` 集合  
4. 当父组件没有提供这个名称的插槽时，渲染的内容，也就是 `fallback`  

## 转换 slot —— transformSlotOutlet  

```ts
const transformSlotOutlet: NodeTransform = (node, context) => {
    // 1. 只会处理 slot 插槽标签
    if (isSlotOutlet(node)) {
        // 2. 获取 slot 子节点，并解析 slot 的名称和 props
        const { children, loc } = node
        const { slotName, slotProps } = processSlotOutlet(node, context)

        // 4. renderSlot 函数的参数列表
        const slotArgs: CallExpression['arguments'] = [
            // 如果需要前缀，则从 _ctx.$slots 中获取，否则直接从 $slots 中获取
            context.prefixIdentifiers ? `_ctx.$slots` : `$slots`,
            slotName
        ]

        // 5. 如果存在 props，则将 props 存入参数列表中
        if (slotProps) {
            slotArgs.push(slotProps)
        }

        // 6. 如果 slot 子节点
        if (children.length) {
            // 6.1 兼容没有 props 的情况，插入空的 props 集合
            if (!slotProps) {
                slotArgs.push(`{}`)
            }
            // 6.2 生成返回 children 的函数，并作为 fallback 存入最后一个参数
            slotArgs.push(createFunctionExpression([], children, false, false, loc))
        }

        // 7. slot 的 codegenNode 是一个函数调用节点
        node.codegenNode = createCallExpression(
            context.helper(RENDER_SLOT),
            slotArgs,
            loc
        )
    }
}
```

### 获取 slot 的名称以及 props  
这个函数用来获取 `slot` 插槽的名称以及 `props` 集合，但并不是所有属性都能用在 `slot` 上的，接下来先看返回结果的结构  

```ts
interface SlotOutletProcessResult {
    slotName: string | ExpressionNode       // slot 名称，可以是简单的字符串 default，如果存在 name 属性或指令，那么就是值的节点
    slotProps: PropsExpression | undefined  // slot props 集合，是一个 props 表达式
}
```

接下来看实现  
```ts
export function processSlotOutlet(
    node: SlotOutletNode,       // slot 节点
    context: TransformContext   // 作用域
): SlotOutletProcessResult {
    // 1. slot 名称和 props，名称默认是字符串 "default"，注意 "default" 旁边是带有引号的
  	// 		这个值在 生成 阶段，会以字符串的形式放在第二个参数，所以必须加引号
    let slotName: string | ExpressionNode = `"default"`
    let slotProps: PropsExpression | undefined = undefined

    // 2. 非 name 属性的集合
    const nonNameProps = []
    // 3. 遍历所有 props
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i]
        // 3.1 处理普通静态属性，如果是 name 属性，将其字符串化，存入 slotName
        //     如果不是 name 属性，会将属性名驼峰化，存入 nonNameProps
        if (p.type === NodeTypes.ATTRIBUTE) {
            if (p.value) {
                if (p.name === 'name') {
                    slotName = JSON.stringify(p.value.content)
                } else {
                    p.name = camelize(p.name)
                    nonNameProps.push(p)
                }
            }
        }
        // 3.2 处理指令，如果是 :name 指令，将值作为结果存入 slotName
        //     如果不是，将所有 v-bind 指令的静态参数驼峰化，存入 nonNameProps 中
        else {
            if (p.name === 'bind' && isBindKey(p.arg, 'name')) {
                if (p.exp) slotName = p.exp
            } else {
                if (p.name === 'bind' && p.arg && isStaticExp(p.arg)) {
                    p.arg.content = camelize(p.arg.content)
                }
                nonNameProps.push(p)
            }
        }
    }

    // 4. 如果存在非 name 的属性，则会通过 buildProps 构建，将结果作为 slot 的 props
    //    但如果存在自定义的指令，则会抛错，slot 插槽不能使用自定义指令
    if (nonNameProps.length > 0) {
        const { props, directives } = buildProps(node, context, nonNameProps)
        slotProps = props

        if (directives.length) {
            context.onError(
                createCompilerError(
                    ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET,
                    directives[0].loc
                )
            )
        }
    }

    // 5. 返回 slot 名称和 props
    return {
        slotName,
        slotProps
    }
}
```